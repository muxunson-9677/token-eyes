//! Hermes 本地会话用量同步
//!
//! 从 `~/.hermes/state.db` (SQLite) 的 `sessions` 表中提取 token 使用数据，
//! 映射到 `proxy_request_logs` 标准表。
//!
//! ## 数据流
//! ```text
//! ~/.hermes/state.db
//!   → sessions 表 (id, model, tokens, cost, started_at)
//!   → 过滤 & 归一化
//!   → proxy_request_logs 表
//! ```

use crate::database::{lock_conn, Database};
use crate::error::AppError;
use crate::hermes_config::get_hermes_dir;
use crate::proxy::usage::calculator::CostCalculator;
use crate::proxy::usage::parser::TokenUsage;
use crate::services::session_usage::{
    get_sync_state, metadata_modified_nanos, update_sync_state, SessionSyncResult,
};
use crate::services::usage_stats::{find_model_pricing, should_skip_session_insert, DedupKey};
use rust_decimal::Decimal;
use std::fs;

/// Hermes sessions 表中的一行
struct HermesSession {
    id: String,
    model: String,
    billing_provider: Option<String>,
    started_at: i64,
    input_tokens: u32,
    output_tokens: u32,
    cache_read_tokens: u32,
    cache_write_tokens: u32,
    reasoning_tokens: u32,
    estimated_cost_usd: f64,
    actual_cost_usd: f64,
}

/// 同步 Hermes 本地用量数据
pub fn sync_hermes_usage(db: &Database) -> Result<SessionSyncResult, AppError> {
    let db_path = get_hermes_dir().join("state.db");

    if !db_path.exists() {
        return Ok(SessionSyncResult {
            imported: 0,
            skipped: 0,
            files_scanned: 0,
            errors: vec![],
        });
    }

    let db_path_str = db_path.to_string_lossy().to_string();

    // 检查文件修改时间，包括 WAL 文件
    let metadata = fs::metadata(&db_path)
        .map_err(|e| AppError::Config(format!("无法读取 state.db 元数据: {e}")))?;
    let mut file_modified = metadata_modified_nanos(&metadata);

    let wal_path = db_path.with_extension("db-wal");
    if let Ok(wal_meta) = fs::metadata(&wal_path) {
        file_modified = file_modified.max(metadata_modified_nanos(&wal_meta));
    }

    // 文件未变化则跳过
    let (last_modified, _) = get_sync_state(db, &db_path_str)?;
    if file_modified <= last_modified {
        return Ok(SessionSyncResult {
            imported: 0,
            skipped: 0,
            files_scanned: 1,
            errors: vec![],
        });
    }

    // 只读打开 Hermes state.db
    let hermes_conn =
        rusqlite::Connection::open_with_flags(&db_path, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY)
            .map_err(|e| AppError::Database(format!("无法打开 Hermes state.db: {e}")))?;

    let sessions = query_sessions(&hermes_conn)?;

    let mut result = SessionSyncResult {
        imported: 0,
        skipped: 0,
        files_scanned: 1,
        errors: vec![],
    };

    for session in &sessions {
        let request_id = format!("hermes_session:{}", session.id);

        match insert_hermes_session(db, &request_id, session) {
            Ok(true) => result.imported += 1,
            Ok(false) => result.skipped += 1,
            Err(e) => {
                let msg = format!("Hermes 会话插入失败 {}: {e}", session.id);
                log::warn!("[HERMES-SYNC] {msg}");
                result.errors.push(msg);
                result.skipped += 1;
            }
        }
    }

    // 推进文件级同步状态
    update_sync_state(db, &db_path_str, file_modified, 0)?;

    if result.imported > 0 {
        log::info!(
            "[HERMES-SYNC] 同步完成: 导入 {} 条, 跳过 {} 条",
            result.imported,
            result.skipped,
        );
    }

    Ok(result)
}

/// 查询 sessions 表
fn query_sessions(conn: &rusqlite::Connection) -> Result<Vec<HermesSession>, AppError> {
    let mut stmt = conn
        .prepare(
            "SELECT id, model, billing_provider, started_at,
                    message_count, input_tokens, output_tokens,
                    cache_read_tokens, cache_write_tokens, reasoning_tokens,
                    estimated_cost_usd, actual_cost_usd
             FROM sessions
             WHERE model IS NOT NULL AND TRIM(model) != ''",
        )
        .map_err(|e| AppError::Database(format!("准备 Hermes 会话查询失败: {e}")))?;

    let rows = stmt
        .query_map([], |row| {
            Ok(HermesSession {
                id: row.get::<_, String>(0)?,
                model: row.get::<_, String>(1)?,
                billing_provider: row.get::<_, Option<String>>(2)?,
                started_at: row.get::<_, i64>(3)?,
                input_tokens: row.get::<_, i64>(5).unwrap_or(0).max(0) as u32,
                output_tokens: row.get::<_, i64>(6).unwrap_or(0).max(0) as u32,
                cache_read_tokens: row.get::<_, i64>(7).unwrap_or(0).max(0) as u32,
                cache_write_tokens: row.get::<_, i64>(8).unwrap_or(0).max(0) as u32,
                reasoning_tokens: row.get::<_, i64>(9).unwrap_or(0).max(0) as u32,
                estimated_cost_usd: row.get::<_, f64>(10).unwrap_or(0.0),
                actual_cost_usd: row.get::<_, f64>(11).unwrap_or(0.0),
            })
        })
        .map_err(|e| AppError::Database(format!("查询 Hermes 会话失败: {e}")))?;

    let mut sessions = Vec::new();
    for row in rows {
        let s = row.map_err(|e| AppError::Database(format!("读取 Hermes 会话行失败: {e}")))?;
        if s.id.is_empty() {
            continue;
        }
        // 跳过所有 token 和成本都为 0 的行
        if s.input_tokens == 0
            && s.output_tokens == 0
            && s.cache_read_tokens == 0
            && s.cache_write_tokens == 0
            && s.reasoning_tokens == 0
            && s.estimated_cost_usd <= 0.0
            && s.actual_cost_usd <= 0.0
        {
            continue;
        }
        sessions.push(s);
    }

    Ok(sessions)
}

/// 归一化 billing_provider
///
/// - `anthropic/claude` -> `anthropic`
/// - `openai/openai_codex` -> `openai`
/// - `google/gemini/vertex` -> `google`
/// - 其它值转小写，`-` 替换为 `_`
fn normalize_billing_provider(provider: &str) -> String {
    let lower = provider.to_lowercase();
    if lower.starts_with("anthropic") {
        return "anthropic".to_string();
    }
    if lower.starts_with("openai") {
        return "openai".to_string();
    }
    if lower.starts_with("google") || lower.starts_with("gemini") || lower.starts_with("vertex") {
        return "google".to_string();
    }
    lower.replace('-', "_")
}

/// 插入单条 Hermes 会话记录到 proxy_request_logs
fn insert_hermes_session(
    db: &Database,
    request_id: &str,
    session: &HermesSession,
) -> Result<bool, AppError> {
    let conn = lock_conn!(db.conn);

    // created_at: 支持秒或毫秒
    let created_at = if session.started_at > 1_000_000_000_000 {
        session.started_at / 1000
    } else {
        session.started_at
    };

    // output_tokens 包含 reasoning_tokens
    let output_with_reasoning = session.output_tokens + session.reasoning_tokens;

    let dedup_key = DedupKey {
        app_type: "hermes",
        model: &session.model,
        input_tokens: session.input_tokens,
        output_tokens: output_with_reasoning,
        cache_read_tokens: session.cache_read_tokens,
        cache_creation_tokens: session.cache_write_tokens,
        created_at,
    };
    if should_skip_session_insert(&conn, request_id, &dedup_key)? {
        return Ok(false);
    }

    // 成本规则: actual > 0 优先，否则 estimated > 0，否则用 CostCalculator
    let (input_cost, output_cost, cache_read_cost, cache_creation_cost, total_cost) =
        if session.actual_cost_usd > 0.0 {
            (
                "0".to_string(),
                "0".to_string(),
                "0".to_string(),
                "0".to_string(),
                session.actual_cost_usd.to_string(),
            )
        } else if session.estimated_cost_usd > 0.0 {
            (
                "0".to_string(),
                "0".to_string(),
                "0".to_string(),
                "0".to_string(),
                session.estimated_cost_usd.to_string(),
            )
        } else {
            let usage = TokenUsage {
                input_tokens: session.input_tokens,
                output_tokens: output_with_reasoning,
                cache_read_tokens: session.cache_read_tokens,
                cache_creation_tokens: session.cache_write_tokens,
                model: Some(session.model.clone()),
                message_id: None,
            };

            let normalized_provider = session
                .billing_provider
                .as_deref()
                .map(normalize_billing_provider)
                .unwrap_or_default();

            // 先尝试 {provider}/{model}，再尝试 {model}
            let pricing = if !normalized_provider.is_empty() {
                let candidate = format!("{}/{}", normalized_provider, session.model);
                find_model_pricing(&conn, &candidate)
                    .or_else(|| find_model_pricing(&conn, &session.model))
            } else {
                find_model_pricing(&conn, &session.model)
            };

            match pricing {
                Some(p) => {
                    let cost =
                        CostCalculator::calculate_for_app("hermes", &usage, &p, Decimal::from(1));
                    (
                        cost.input_cost.to_string(),
                        cost.output_cost.to_string(),
                        cost.cache_read_cost.to_string(),
                        cost.cache_creation_cost.to_string(),
                        cost.total_cost.to_string(),
                    )
                }
                None => (
                    "0".to_string(),
                    "0".to_string(),
                    "0".to_string(),
                    "0".to_string(),
                    "0".to_string(),
                ),
            }
        };

    let inserted_rows = conn.execute(
        "INSERT OR IGNORE INTO proxy_request_logs (
            request_id, provider_id, app_type, model, request_model,
            input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens,
            input_cost_usd, output_cost_usd, cache_read_cost_usd, cache_creation_cost_usd, total_cost_usd,
            latency_ms, first_token_ms, status_code, error_message, session_id,
            provider_type, is_streaming, cost_multiplier, created_at, data_source
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21, ?22, ?23, ?24)",
        rusqlite::params![
            request_id,
            "_hermes_session",
            "hermes",
            session.model,
            session.model,
            session.input_tokens,
            output_with_reasoning,
            session.cache_read_tokens,
            session.cache_write_tokens,
            input_cost,
            output_cost,
            cache_read_cost,
            cache_creation_cost,
            total_cost,
            0i64,
            Option::<i64>::None,
            200i64,
            Option::<String>::None,
            Some(session.id.clone()),
            Some("hermes_session"),
            1i64,
            "1.0",
            created_at,
            "hermes_session",
        ],
    )
    .map_err(|e| AppError::Database(format!("插入 Hermes 会话日志失败: {e}")))?;

    Ok(inserted_rows > 0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_normalize_billing_provider() {
        assert_eq!(normalize_billing_provider("anthropic/claude"), "anthropic");
        assert_eq!(normalize_billing_provider("ANTHROPIC"), "anthropic");
        assert_eq!(normalize_billing_provider("openai/openai_codex"), "openai");
        assert_eq!(normalize_billing_provider("google/gemini/vertex"), "google");
        assert_eq!(normalize_billing_provider("gemini"), "google");
        assert_eq!(normalize_billing_provider("vertex"), "google");
        assert_eq!(normalize_billing_provider("some-provider"), "some_provider");
        assert_eq!(
            normalize_billing_provider("Custom.Provider"),
            "custom.provider"
        );
    }

    #[test]
    fn test_query_sessions_skips_empty_model() {
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE sessions (
                id TEXT, model TEXT, billing_provider TEXT, started_at INTEGER,
                message_count INTEGER, input_tokens INTEGER, output_tokens INTEGER,
                cache_read_tokens INTEGER, cache_write_tokens INTEGER, reasoning_tokens INTEGER,
                estimated_cost_usd REAL, actual_cost_usd REAL
             );
             INSERT INTO sessions VALUES ('s1', '', NULL, 1000, 1, 100, 200, 0, 0, 0, 0.01, 0);
             INSERT INTO sessions VALUES ('s2', 'claude-3', NULL, 1000, 1, 100, 200, 0, 0, 0, 0.01, 0);",
        )
        .unwrap();

        let sessions = query_sessions(&conn).unwrap();
        assert_eq!(sessions.len(), 1);
        assert_eq!(sessions[0].id, "s2");
    }

    #[test]
    fn test_query_sessions_skips_zero_tokens_and_cost() {
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE sessions (
                id TEXT, model TEXT, billing_provider TEXT, started_at INTEGER,
                message_count INTEGER, input_tokens INTEGER, output_tokens INTEGER,
                cache_read_tokens INTEGER, cache_write_tokens INTEGER, reasoning_tokens INTEGER,
                estimated_cost_usd REAL, actual_cost_usd REAL
             );
             INSERT INTO sessions VALUES ('s1', 'claude-3', NULL, 1000, 0, 0, 0, 0, 0, 0, 0.0, 0.0);
             INSERT INTO sessions VALUES ('s2', 'claude-3', NULL, 1000, 1, 100, 0, 0, 0, 0, 0.0, 0.0);",
        )
        .unwrap();

        let sessions = query_sessions(&conn).unwrap();
        assert_eq!(sessions.len(), 1);
        assert_eq!(sessions[0].id, "s2");
    }

    #[test]
    fn test_insert_hermes_session_basic() {
        let db = Database::memory().expect("创建内存数据库失败");

        let session = HermesSession {
            id: "test-session-1".to_string(),
            model: "claude-sonnet-4-20250514".to_string(),
            billing_provider: Some("anthropic/claude".to_string()),
            started_at: 1718000000,
            input_tokens: 1000,
            output_tokens: 500,
            cache_read_tokens: 200,
            cache_write_tokens: 50,
            reasoning_tokens: 100,
            estimated_cost_usd: 0.0,
            actual_cost_usd: 0.005,
        };

        let request_id = "hermes_session:test-session-1";
        let inserted = insert_hermes_session(&db, request_id, &session).unwrap();
        assert!(inserted, "第一条插入应成功");

        // 验证插入的数据
        let conn = lock_conn!(db.conn);
        let mut stmt = conn
            .prepare(
                "SELECT request_id, app_type, model, data_source,
                        input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens,
                        total_cost_usd, provider_type, session_id
                 FROM proxy_request_logs WHERE request_id = ?1",
            )
            .unwrap();
        let row = stmt
            .query_row([request_id], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, String>(2)?,
                    r.get::<_, String>(3)?,
                    r.get::<_, i64>(4)?,
                    r.get::<_, i64>(5)?,
                    r.get::<_, i64>(6)?,
                    r.get::<_, i64>(7)?,
                    r.get::<_, String>(8)?,
                    r.get::<_, Option<String>>(9)?,
                    r.get::<_, Option<String>>(10)?,
                ))
            })
            .unwrap();

        assert_eq!(row.0, "hermes_session:test-session-1");
        assert_eq!(row.1, "hermes");
        assert_eq!(row.2, "claude-sonnet-4-20250514");
        assert_eq!(row.3, "hermes_session");
        assert_eq!(row.4, 1000);
        assert_eq!(row.5, 600); // output + reasoning
        assert_eq!(row.6, 200);
        assert_eq!(row.7, 50);
        assert!((row.8.parse::<f64>().unwrap() - 0.005).abs() < 1e-10);
        assert_eq!(row.9, Some("hermes_session".to_string()));
        assert_eq!(row.10, Some("test-session-1".to_string()));

        // 重复插入应跳过
        let skipped = insert_hermes_session(&db, request_id, &session).unwrap();
        assert!(!skipped, "重复插入应被跳过");
    }

    #[test]
    fn test_insert_uses_estimated_cost_when_actual_is_zero() {
        let db = Database::memory().expect("创建内存数据库失败");

        let session = HermesSession {
            id: "test-est".to_string(),
            model: "gpt-4o".to_string(),
            billing_provider: None,
            started_at: 1718000000,
            input_tokens: 500,
            output_tokens: 200,
            cache_read_tokens: 0,
            cache_write_tokens: 0,
            reasoning_tokens: 0,
            estimated_cost_usd: 0.003,
            actual_cost_usd: 0.0,
        };

        let inserted = insert_hermes_session(&db, "hermes_session:test-est", &session).unwrap();
        assert!(inserted);

        let conn = lock_conn!(db.conn);
        let total: String = conn
            .query_row(
                "SELECT total_cost_usd FROM proxy_request_logs WHERE request_id = 'hermes_session:test-est'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert!((total.parse::<f64>().unwrap() - 0.003).abs() < 1e-10);
    }
}
