use tauri::State;

use crate::error::AppError;
use crate::store::AppState;

// ---------------------------------------------------------------------------
// Structures
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SubscriptionFeeInput {
    pub agent_type: String,
    pub plan_label: String,
    pub monthly_fee: String,
    pub currency: Option<String>,
    pub billing_day: i64,
    pub effective_from: i64,
    pub effective_to: Option<i64>,
    pub note: Option<String>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SubscriptionFee {
    pub id: i64,
    pub agent_type: String,
    pub plan_label: String,
    pub monthly_fee: String,
    pub currency: String,
    pub billing_day: i64,
    pub effective_from: i64,
    pub effective_to: Option<i64>,
    pub note: Option<String>,
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

fn validate_input(input: &SubscriptionFeeInput) -> Result<String, AppError> {
    if input.agent_type.trim().is_empty() {
        return Err(AppError::InvalidInput("agent_type 不能为空".into()));
    }
    if input.plan_label.trim().is_empty() {
        return Err(AppError::InvalidInput("plan_label 不能为空".into()));
    }

    // monthly_fee: 非负十进制字符串
    let fee_trimmed = input.monthly_fee.trim();
    match fee_trimmed.parse::<f64>() {
        Ok(v) if v < 0.0 => {
            return Err(AppError::InvalidInput(
                "monthly_fee 不能为负数".into(),
            ));
        }
        Ok(_) => {}
        Err(_) => {
            return Err(AppError::InvalidInput(
                "monthly_fee 必须是有效的十进制数字".into(),
            ));
        }
    }

    // currency: 空默认 USD，非空必须三位大写字母
    let currency = match &input.currency {
        Some(c) if !c.trim().is_empty() => {
            let c = c.trim().to_uppercase();
            if c.len() != 3 || !c.bytes().all(|b| b.is_ascii_uppercase()) {
                return Err(AppError::InvalidInput(
                    "currency 必须是三位大写字母".into(),
                ));
            }
            c
        }
        _ => "USD".to_string(),
    };

    // billing_day: 1..=31
    if !(1..=31).contains(&input.billing_day) {
        return Err(AppError::InvalidInput(
            "billing_day 必须在 1 到 31 之间".into(),
        ));
    }

    // effective_to 不早于 effective_from
    if let Some(to) = input.effective_to {
        if to < input.effective_from {
            return Err(AppError::InvalidInput(
                "effective_to 不能早于 effective_from".into(),
            ));
        }
    }

    // note: 空字符串保存为 None
    // (在调用方处理，此处只做校验通过)

    Ok(currency)
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn row_to_fee(row: &rusqlite::Row) -> rusqlite::Result<SubscriptionFee> {
    Ok(SubscriptionFee {
        id: row.get(0)?,
        agent_type: row.get(1)?,
        plan_label: row.get(2)?,
        monthly_fee: row.get(3)?,
        currency: row.get(4)?,
        billing_day: row.get(5)?,
        effective_from: row.get(6)?,
        effective_to: row.get(7)?,
        note: row.get(8)?,
    })
}

const SELECT_COLS: &str =
    "id, agent_type, plan_label, monthly_fee, currency, billing_day, \
     effective_from, effective_to, note";

// ---------------------------------------------------------------------------
// Tauri commands
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn create_subscription_fee(
    state: State<'_, AppState>,
    input: SubscriptionFeeInput,
) -> Result<SubscriptionFee, AppError> {
    let currency = validate_input(&input)?;
    let note = input.note.as_deref().and_then(|n| {
        let t = n.trim();
        if t.is_empty() { None } else { Some(t) }
    });

    let db = state.db.clone();
    let conn = crate::database::lock_conn!(db.conn);

    conn.execute(
        "INSERT INTO subscription_fees \
         (agent_type, plan_label, monthly_fee, currency, billing_day, \
          effective_from, effective_to, note) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        rusqlite::params![
            input.agent_type.trim(),
            input.plan_label.trim(),
            input.monthly_fee.trim(),
            currency,
            input.billing_day,
            input.effective_from,
            input.effective_to,
            note,
        ],
    )
    .map_err(|e| AppError::Database(format!("插入订阅费失败: {e}")))?;

    let id = conn.last_insert_rowid();

    let fee = conn
        .query_row(
            &format!("SELECT {SELECT_COLS} FROM subscription_fees WHERE id = ?1"),
            rusqlite::params![id],
            row_to_fee,
        )
        .map_err(|e| AppError::Database(format!("查询新建记录失败: {e}")))?;

    Ok(fee)
}

#[tauri::command]
pub fn list_subscription_fees(
    state: State<'_, AppState>,
    agent_type: Option<String>,
    include_inactive: Option<bool>,
) -> Result<Vec<SubscriptionFee>, AppError> {
    let db = state.db.clone();
    let conn = crate::database::lock_conn!(db.conn);
    let now = chrono::Utc::now().timestamp();

    let include = include_inactive.unwrap_or(false);

    let (sql, params): (String, Vec<Box<dyn rusqlite::types::ToSql>>) = if include {
        // 全部记录
        match &agent_type {
            Some(at) => (
                format!("SELECT {SELECT_COLS} FROM subscription_fees WHERE agent_type = ?1 ORDER BY id"),
                vec![Box::new(at.clone())],
            ),
            None => (
                format!("SELECT {SELECT_COLS} FROM subscription_fees ORDER BY id"),
                vec![],
            ),
        }
    } else {
        // 仅有效记录
        let base = "effective_from <= ?1 AND (effective_to IS NULL OR effective_to >= ?1)";
        match &agent_type {
            Some(at) => (
                format!(
                    "SELECT {SELECT_COLS} FROM subscription_fees \
                     WHERE agent_type = ?2 AND {base} ORDER BY id"
                ),
                vec![Box::new(now), Box::new(at.clone())],
            ),
            None => (
                format!(
                    "SELECT {SELECT_COLS} FROM subscription_fees \
                     WHERE {base} ORDER BY id"
                ),
                vec![Box::new(now)],
            ),
        }
    };

    let mut stmt = conn
        .prepare(&sql)
        .map_err(|e| AppError::Database(format!("准备查询失败: {e}")))?;

    let rows = stmt
        .query_map(rusqlite::params_from_iter(params.iter()), row_to_fee)
        .map_err(|e| AppError::Database(format!("查询订阅费列表失败: {e}")))?;

    let mut fees = Vec::new();
    for row in rows {
        fees.push(row.map_err(|e| AppError::Database(format!("读取行失败: {e}")))?);
    }

    Ok(fees)
}

#[tauri::command]
pub fn update_subscription_fee(
    state: State<'_, AppState>,
    id: i64,
    input: SubscriptionFeeInput,
) -> Result<SubscriptionFee, AppError> {
    let currency = validate_input(&input)?;
    let note = input.note.as_deref().and_then(|n| {
        let t = n.trim();
        if t.is_empty() { None } else { Some(t) }
    });

    let db = state.db.clone();
    let conn = crate::database::lock_conn!(db.conn);

    let rows = conn
        .execute(
            "UPDATE subscription_fees SET \
             agent_type = ?1, plan_label = ?2, monthly_fee = ?3, currency = ?4, \
             billing_day = ?5, effective_from = ?6, effective_to = ?7, note = ?8 \
             WHERE id = ?9",
            rusqlite::params![
                input.agent_type.trim(),
                input.plan_label.trim(),
                input.monthly_fee.trim(),
                currency,
                input.billing_day,
                input.effective_from,
                input.effective_to,
                note,
                id,
            ],
        )
        .map_err(|e| AppError::Database(format!("更新订阅费失败: {e}")))?;

    if rows == 0 {
        return Err(AppError::InvalidInput(format!(
            "id={id} 的订阅费记录不存在"
        )));
    }

    let fee = conn
        .query_row(
            &format!("SELECT {SELECT_COLS} FROM subscription_fees WHERE id = ?1"),
            rusqlite::params![id],
            row_to_fee,
        )
        .map_err(|e| AppError::Database(format!("查询更新后记录失败: {e}")))?;

    Ok(fee)
}

#[tauri::command]
pub fn delete_subscription_fee(
    state: State<'_, AppState>,
    id: i64,
) -> Result<bool, AppError> {
    let db = state.db.clone();
    let conn = crate::database::lock_conn!(db.conn);

    let rows = conn
        .execute(
            "DELETE FROM subscription_fees WHERE id = ?1",
            rusqlite::params![id],
        )
        .map_err(|e| AppError::Database(format!("删除订阅费失败: {e}")))?;

    Ok(rows > 0)
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    fn valid_input() -> SubscriptionFeeInput {
        SubscriptionFeeInput {
            agent_type: "claude".into(),
            plan_label: "Pro".into(),
            monthly_fee: "20.00".into(),
            currency: None,
            billing_day: 1,
            effective_from: 1700000000,
            effective_to: None,
            note: None,
        }
    }

    // -- Validation tests --

    #[test]
    fn reject_empty_agent_type() {
        let mut input = valid_input();
        input.agent_type = "".into();
        assert!(validate_input(&input).is_err());
    }

    #[test]
    fn reject_empty_plan_label() {
        let mut input = valid_input();
        input.plan_label = "  ".into();
        assert!(validate_input(&input).is_err());
    }

    #[test]
    fn reject_negative_fee() {
        let mut input = valid_input();
        input.monthly_fee = "-1".into();
        assert!(validate_input(&input).is_err());
    }

    #[test]
    fn reject_non_numeric_fee() {
        let mut input = valid_input();
        input.monthly_fee = "abc".into();
        assert!(validate_input(&input).is_err());
    }

    #[test]
    fn accept_zero_fee() {
        let mut input = valid_input();
        input.monthly_fee = "0".into();
        assert!(validate_input(&input).is_ok());
    }

    #[test]
    fn default_currency_to_usd() {
        let input = valid_input();
        let currency = validate_input(&input).unwrap();
        assert_eq!(currency, "USD");
    }

    #[test]
    fn reject_invalid_currency() {
        let mut input = valid_input();
        input.currency = Some("us".into());
        assert!(validate_input(&input).is_err());

        input.currency = Some("usd1".into());
        assert!(validate_input(&input).is_err());
    }

    #[test]
    fn accept_valid_currency() {
        let mut input = valid_input();
        input.currency = Some("cny".into());
        let currency = validate_input(&input).unwrap();
        assert_eq!(currency, "CNY");
    }

    #[test]
    fn reject_billing_day_out_of_range() {
        let mut input = valid_input();
        input.billing_day = 0;
        assert!(validate_input(&input).is_err());

        input.billing_day = 32;
        assert!(validate_input(&input).is_err());
    }

    #[test]
    fn reject_effective_to_before_effective_from() {
        let mut input = valid_input();
        input.effective_from = 1700000000;
        input.effective_to = Some(1699999999);
        assert!(validate_input(&input).is_err());
    }

    #[test]
    fn accept_effective_to_equal_to_effective_from() {
        let mut input = valid_input();
        input.effective_from = 1700000000;
        input.effective_to = Some(1700000000);
        assert!(validate_input(&input).is_ok());
    }

    // -- CRUD tests using in-memory SQLite --

    fn setup_db() -> rusqlite::Connection {
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE subscription_fees (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                agent_type TEXT NOT NULL,
                plan_label TEXT NOT NULL,
                monthly_fee TEXT NOT NULL,
                currency TEXT NOT NULL DEFAULT 'USD',
                billing_day INTEGER NOT NULL CHECK (billing_day BETWEEN 1 AND 31),
                effective_from INTEGER NOT NULL,
                effective_to INTEGER,
                note TEXT
            );",
        )
        .unwrap();
        conn
    }

    fn insert_fee(conn: &rusqlite::Connection, input: &SubscriptionFeeInput) -> i64 {
        let currency = input
            .currency
            .as_deref()
            .unwrap_or("USD");
        let note = input.note.as_deref().and_then(|n| {
            let t = n.trim();
            if t.is_empty() { None } else { Some(t) }
        });
        conn.execute(
            "INSERT INTO subscription_fees \
             (agent_type, plan_label, monthly_fee, currency, billing_day, \
              effective_from, effective_to, note) \
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            rusqlite::params![
                input.agent_type.trim(),
                input.plan_label.trim(),
                input.monthly_fee.trim(),
                currency,
                input.billing_day,
                input.effective_from,
                input.effective_to,
                note,
            ],
        )
        .unwrap();
        conn.last_insert_rowid()
    }

    #[test]
    fn crud_insert_and_read() {
        let conn = setup_db();
        let input = valid_input();
        let id = insert_fee(&conn, &input);

        let fee: SubscriptionFee = conn
            .query_row(
                &format!("SELECT {SELECT_COLS} FROM subscription_fees WHERE id = ?1"),
                rusqlite::params![id],
                row_to_fee,
            )
            .unwrap();

        assert_eq!(fee.id, id);
        assert_eq!(fee.agent_type, "claude");
        assert_eq!(fee.plan_label, "Pro");
        assert_eq!(fee.monthly_fee, "20.00");
        assert_eq!(fee.currency, "USD");
        assert_eq!(fee.billing_day, 1);
        assert_eq!(fee.effective_from, 1700000000);
        assert!(fee.effective_to.is_none());
        assert!(fee.note.is_none());
    }

    #[test]
    fn crud_update() {
        let conn = setup_db();
        let id = insert_fee(&conn, &valid_input());

        conn.execute(
            "UPDATE subscription_fees SET monthly_fee = '25.00' WHERE id = ?1",
            rusqlite::params![id],
        )
        .unwrap();

        let fee: SubscriptionFee = conn
            .query_row(
                &format!("SELECT {SELECT_COLS} FROM subscription_fees WHERE id = ?1"),
                rusqlite::params![id],
                row_to_fee,
            )
            .unwrap();

        assert_eq!(fee.monthly_fee, "25.00");
    }

    #[test]
    fn crud_delete() {
        let conn = setup_db();
        let id = insert_fee(&conn, &valid_input());

        let rows = conn
            .execute(
                "DELETE FROM subscription_fees WHERE id = ?1",
                rusqlite::params![id],
            )
            .unwrap();
        assert_eq!(rows, 1);

        // 再删一次应该返回 0
        let rows = conn
            .execute(
                "DELETE FROM subscription_fees WHERE id = ?1",
                rusqlite::params![id],
            )
            .unwrap();
        assert_eq!(rows, 0);
    }

    #[test]
    fn list_filters_by_agent_type() {
        let conn = setup_db();
        let mut input1 = valid_input();
        input1.agent_type = "claude".into();
        insert_fee(&conn, &input1);

        let mut input2 = valid_input();
        input2.agent_type = "codex".into();
        insert_fee(&conn, &input2);

        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM subscription_fees WHERE agent_type = 'claude'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(count, 1);
    }

    #[test]
    fn note_empty_string_stores_as_null() {
        let conn = setup_db();
        let mut input = valid_input();
        input.note = Some("  ".into());
        let id = insert_fee(&conn, &input);

        let note: Option<String> = conn
            .query_row(
                "SELECT note FROM subscription_fees WHERE id = ?1",
                rusqlite::params![id],
                |row| row.get(0),
            )
            .unwrap();
        assert!(note.is_none());
    }
}
