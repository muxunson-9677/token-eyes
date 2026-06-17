//! 花销聚合查询服务
//!
//! 把 token 消耗成本和手动订阅费合并成统一查询结果。
//! 本阶段 Dashboard 展示口径使用 USD，不做汇率换算。

use chrono::Datelike;
use crate::database::{lock_conn, Database};
use crate::error::AppError;
use crate::services::usage_stats::effective_usage_log_filter;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// 花销聚合查询参数
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CostLedgerQuery {
    pub start_date: Option<i64>,
    pub end_date: Option<i64>,
    pub agent_type: Option<String>,
}

/// 单个 agent 维度的花销明细
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CostLedgerByAgent {
    pub agent_type: String,
    pub token_cost_usd: String,
    pub subscription_cost_usd: String,
    pub total_cost_usd: String,
}

/// 花销聚合查询结果
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CostLedgerSummary {
    pub period_start: i64,
    pub period_end: i64,
    pub token_cost_usd: String,
    pub subscription_cost_usd: String,
    pub total_cost_usd: String,
    pub cumulative_token_cost_usd: String,
    pub cumulative_subscription_cost_usd: String,
    pub cumulative_total_cost_usd: String,
    pub by_agent: Vec<CostLedgerByAgent>,
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

/// 当前自然月月初 00:00:00 UTC（Unix 秒）
fn current_month_start_utc() -> i64 {
    let now = chrono::Utc::now();
    let first_day = now
        .date_naive()
        .with_day(1)
        .expect("month 1 always exists");
    first_day
        .and_hms_opt(0, 0, 0)
        .expect("midnight is valid")
        .and_utc()
        .timestamp()
}

/// 从 `base_ts`（Unix 秒）所在月的 1 号开始，逐月迭代，直到处理完包含 `end_ts` 的那个月。
/// 对每个月调用 `f(year, month)`，month ∈ 1..=12。
fn for_each_month_in_range(base_ts: i64, end_ts: i64, mut f: impl FnMut(i32, u32)) {
    let base = chrono::DateTime::from_timestamp(base_ts, 0)
        .expect("valid timestamp")
        .date_naive();
    let end = chrono::DateTime::from_timestamp(end_ts, 0)
        .expect("valid timestamp")
        .date_naive();

    let mut year = base.year();
    let mut month = base.month();

    loop {
        f(year, month);
        if chrono::NaiveDate::from_ymd_opt(
            if month == 12 { year + 1 } else { year },
            if month == 12 { 1 } else { month + 1 },
            1,
        )
        .expect("next month is valid")
        > end
        {
            break;
        }
        if month == 12 {
            year += 1;
            month = 1;
        } else {
            month += 1;
        }
    }
}

// ---------------------------------------------------------------------------
// impl Database
// ---------------------------------------------------------------------------

impl Database {
    /// 花销聚合查询：合并 token 成本和订阅费
    pub fn get_cost_ledger_summary(
        &self,
        query: CostLedgerQuery,
    ) -> Result<CostLedgerSummary, AppError> {
        let now_ts = current_month_start_utc();
        let period_start = query.start_date.unwrap_or(now_ts);
        let period_end = query.end_date.unwrap_or_else(|| {
            chrono::Utc::now().timestamp()
        });

        if period_end < period_start {
            return Err(AppError::InvalidInput(
                "end_date must be >= start_date".into(),
            ));
        }

        let agent_filter = query.agent_type.as_deref();

        // --- period token cost (dual-source) ---
        let period_token = self.query_token_cost_sum(
            Some(period_start),
            Some(period_end),
            agent_filter,
            false,
        )?;

        // --- cumulative token cost (all history → period_end) ---
        let cumulative_token = self.query_token_cost_sum(
            None,
            Some(period_end),
            agent_filter,
            false,
        )?;

        // --- period subscription cost ---
        let period_sub = self.query_subscription_cost_sum(period_start, period_end, agent_filter)?;

        // --- cumulative subscription cost ---
        let cumulative_sub = self.query_subscription_cost_sum(0, period_end, agent_filter)?;

        // --- by_agent: token costs grouped by app_type ---
        let token_by_agent = self.query_token_cost_by_agent(
            Some(period_start),
            Some(period_end),
            agent_filter,
        )?;

        // --- by_agent: subscription costs grouped by agent_type ---
        let sub_by_agent =
            self.query_subscription_cost_by_agent(period_start, period_end, agent_filter)?;

        // merge
        let mut agents: HashMap<String, (f64, f64)> = HashMap::new();
        for (k, v) in token_by_agent {
            agents.entry(k).or_default().0 += v;
        }
        for (k, v) in sub_by_agent {
            agents.entry(k).or_default().1 += v;
        }
        let mut by_agent: Vec<CostLedgerByAgent> = agents
            .into_iter()
            .map(|(agent_type, (tok, sub))| {
                let total = tok + sub;
                CostLedgerByAgent {
                    agent_type,
                    token_cost_usd: format!("{tok:.6}"),
                    subscription_cost_usd: format!("{sub:.6}"),
                    total_cost_usd: format!("{total:.6}"),
                }
            })
            .collect();
        by_agent.sort_by(|a, b| a.agent_type.cmp(&b.agent_type));

        let period_total = period_token + period_sub;
        let cumulative_total = cumulative_token + cumulative_sub;

        Ok(CostLedgerSummary {
            period_start,
            period_end,
            token_cost_usd: format!("{period_token:.6}"),
            subscription_cost_usd: format!("{period_sub:.6}"),
            total_cost_usd: format!("{period_total:.6}"),
            cumulative_token_cost_usd: format!("{cumulative_token:.6}"),
            cumulative_subscription_cost_usd: format!("{cumulative_sub:.6}"),
            cumulative_total_cost_usd: format!("{cumulative_total:.6}"),
            by_agent,
        })
    }

    // -----------------------------------------------------------------------
    // private helpers
    // -----------------------------------------------------------------------

    /// Dual-source token cost sum (proxy_request_logs + usage_daily_rollups).
    fn query_token_cost_sum(
        &self,
        start_date: Option<i64>,
        end_date: Option<i64>,
        agent_type: Option<&str>,
        _distinct: bool,
    ) -> Result<f64, AppError> {
        let conn = lock_conn!(self.conn);

        // detail subquery
        let mut detail_conditions = vec![effective_usage_log_filter("l")];
        let mut detail_params: Vec<Box<dyn rusqlite::ToSql>> = Vec::new();
        if let Some(s) = start_date {
            detail_conditions.push("l.created_at >= ?".into());
            detail_params.push(Box::new(s));
        }
        if let Some(e) = end_date {
            detail_conditions.push("l.created_at <= ?".into());
            detail_params.push(Box::new(e));
        }
        if let Some(at) = agent_type {
            detail_conditions.push("l.app_type = ?".into());
            detail_params.push(Box::new(at.to_string()));
        }
        let detail_where = format!("WHERE {}", detail_conditions.join(" AND "));

        // rollup subquery — only full days fully covered by range
        let mut rollup_conditions: Vec<String> = Vec::new();
        let mut rollup_params: Vec<Box<dyn rusqlite::ToSql>> = Vec::new();
        if let Some(s) = start_date {
            // day starts at 00:00 UTC → s // 86400 is the day index
            rollup_conditions.push("r.date >= ?".into());
            rollup_params.push(Box::new(s));
        }
        if let Some(e) = end_date {
            rollup_conditions.push("r.date <= ?".into());
            rollup_params.push(Box::new(e));
        }
        if let Some(at) = agent_type {
            rollup_conditions.push("r.app_type = ?".into());
            rollup_params.push(Box::new(at.to_string()));
        }
        let rollup_where = if rollup_conditions.is_empty() {
            String::new()
        } else {
            format!("WHERE {}", rollup_conditions.join(" AND "))
        };

        let sql = format!(
            "SELECT COALESCE(d.cost, 0) + COALESCE(r.cost, 0)
             FROM
               (SELECT COALESCE(SUM(CAST(l.total_cost_usd AS REAL)), 0) as cost
                FROM proxy_request_logs l {detail_where}) d,
               (SELECT COALESCE(SUM(CAST(r.total_cost_usd AS REAL)), 0) as cost
                FROM usage_daily_rollups r {rollup_where}) r"
        );

        let mut all_params: Vec<Box<dyn rusqlite::ToSql>> = detail_params;
        all_params.extend(rollup_params);
        let param_refs: Vec<&dyn rusqlite::ToSql> = all_params.iter().map(|p| p.as_ref()).collect();

        let total: f64 = conn.query_row(&sql, param_refs.as_slice(), |row| row.get(0))?;
        Ok(total)
    }

    /// Token cost grouped by app_type (detail + rollup, UNION ALL).
    fn query_token_cost_by_agent(
        &self,
        start_date: Option<i64>,
        end_date: Option<i64>,
        agent_type: Option<&str>,
    ) -> Result<HashMap<String, f64>, AppError> {
        let conn = lock_conn!(self.conn);

        let mut detail_conditions = vec![effective_usage_log_filter("l")];
        let mut detail_params: Vec<Box<dyn rusqlite::ToSql>> = Vec::new();
        if let Some(s) = start_date {
            detail_conditions.push("l.created_at >= ?".into());
            detail_params.push(Box::new(s));
        }
        if let Some(e) = end_date {
            detail_conditions.push("l.created_at <= ?".into());
            detail_params.push(Box::new(e));
        }
        if let Some(at) = agent_type {
            detail_conditions.push("l.app_type = ?".into());
            detail_params.push(Box::new(at.to_string()));
        }
        let detail_where = format!("WHERE {}", detail_conditions.join(" AND "));

        let mut rollup_conditions: Vec<String> = Vec::new();
        let mut rollup_params: Vec<Box<dyn rusqlite::ToSql>> = Vec::new();
        if let Some(s) = start_date {
            rollup_conditions.push("r.date >= ?".into());
            rollup_params.push(Box::new(s));
        }
        if let Some(e) = end_date {
            rollup_conditions.push("r.date <= ?".into());
            rollup_params.push(Box::new(e));
        }
        if let Some(at) = agent_type {
            rollup_conditions.push("r.app_type = ?".into());
            rollup_params.push(Box::new(at.to_string()));
        }
        let rollup_where = if rollup_conditions.is_empty() {
            String::new()
        } else {
            format!("WHERE {}", rollup_conditions.join(" AND "))
        };

        let sql = format!(
            "SELECT agent_type, SUM(cost) FROM (
                SELECT l.app_type as agent_type,
                       COALESCE(SUM(CAST(l.total_cost_usd AS REAL)), 0) as cost
                FROM proxy_request_logs l {detail_where}
                GROUP BY l.app_type
                UNION ALL
                SELECT r.app_type as agent_type,
                       COALESCE(SUM(CAST(r.total_cost_usd AS REAL)), 0) as cost
                FROM usage_daily_rollups r {rollup_where}
                GROUP BY r.app_type
             ) GROUP BY agent_type"
        );

        let mut all_params: Vec<Box<dyn rusqlite::ToSql>> = detail_params;
        all_params.extend(rollup_params);
        let param_refs: Vec<&dyn rusqlite::ToSql> = all_params.iter().map(|p| p.as_ref()).collect();

        let mut stmt = conn.prepare(&sql)?;
        let rows = stmt.query_map(param_refs.as_slice(), |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, f64>(1)?))
        })?;

        let mut map = HashMap::new();
        for row in rows {
            let (agent, cost) = row?;
            map.insert(agent, cost);
        }
        Ok(map)
    }

    /// 订阅费合计：只取 USD，按自然月计次。
    fn query_subscription_cost_sum(
        &self,
        start_ts: i64,
        end_ts: i64,
        agent_type: Option<&str>,
    ) -> Result<f64, AppError> {
        let conn = lock_conn!(self.conn);

        let mut conditions = vec!["currency = 'USD'".to_string()];
        let mut params_vec: Vec<Box<dyn rusqlite::ToSql>> = Vec::new();

        // 与查询范围有交集的订阅
        conditions.push("effective_from <= ?".into());
        params_vec.push(Box::new(end_ts));
        conditions.push("(effective_to IS NULL OR effective_to >= ?)".into());
        params_vec.push(Box::new(start_ts));

        if let Some(at) = agent_type {
            conditions.push("agent_type = ?".into());
            params_vec.push(Box::new(at.to_string()));
        }

        let where_clause = format!("WHERE {}", conditions.join(" AND "));
        let sql = format!(
            "SELECT agent_type, monthly_fee, effective_from, effective_to
             FROM subscription_fees {where_clause}"
        );

        let param_refs: Vec<&dyn rusqlite::ToSql> = params_vec.iter().map(|p| p.as_ref()).collect();

        let mut stmt = conn.prepare(&sql)?;
        let rows = stmt.query_map(param_refs.as_slice(), |row| {
            Ok((
                row.get::<_, i64>(2)?, // effective_from
                row.get::<_, Option<i64>>(3)?, // effective_to
                row.get::<_, String>(1)?.trim().parse::<f64>().unwrap_or(0.0), // monthly_fee
            ))
        })?;

        let subs: Vec<(i64, Option<i64>, f64)> = rows.collect::<Result<_, _>>()?;
        let mut total = 0.0f64;

        for_each_month_in_range(start_ts, end_ts, |year, month| {
            let month_start = chrono::NaiveDate::from_ymd_opt(year, month, 1)
                .expect("valid date")
                .and_hms_opt(0, 0, 0)
                .unwrap()
                .and_utc()
                .timestamp();
            let next_month = if month == 12 {
                chrono::NaiveDate::from_ymd_opt(year + 1, 1, 1)
            } else {
                chrono::NaiveDate::from_ymd_opt(year, month + 1, 1)
            }
            .expect("next month valid")
            .and_hms_opt(0, 0, 0)
            .unwrap()
            .and_utc()
            .timestamp();

            for &(eff_from, eff_to, fee) in &subs {
                let sub_active = eff_from < next_month
                    && eff_to.map_or(true, |to| to >= month_start);
                if sub_active {
                    total += fee;
                }
            }
        });

        Ok(total)
    }

    /// 订阅费按 agent_type 分组
    fn query_subscription_cost_by_agent(
        &self,
        start_ts: i64,
        end_ts: i64,
        agent_type: Option<&str>,
    ) -> Result<HashMap<String, f64>, AppError> {
        let conn = lock_conn!(self.conn);

        let mut conditions = vec!["currency = 'USD'".to_string()];
        let mut params_vec: Vec<Box<dyn rusqlite::ToSql>> = Vec::new();

        conditions.push("effective_from <= ?".into());
        params_vec.push(Box::new(end_ts));
        conditions.push("(effective_to IS NULL OR effective_to >= ?)".into());
        params_vec.push(Box::new(start_ts));

        if let Some(at) = agent_type {
            conditions.push("agent_type = ?".into());
            params_vec.push(Box::new(at.to_string()));
        }

        let where_clause = format!("WHERE {}", conditions.join(" AND "));
        let sql = format!(
            "SELECT agent_type, monthly_fee, effective_from, effective_to
             FROM subscription_fees {where_clause}"
        );

        let param_refs: Vec<&dyn rusqlite::ToSql> = params_vec.iter().map(|p| p.as_ref()).collect();

        let mut stmt = conn.prepare(&sql)?;
        let rows = stmt.query_map(param_refs.as_slice(), |row| {
            Ok((
                row.get::<_, String>(0)?, // agent_type
                row.get::<_, i64>(2)?, // effective_from
                row.get::<_, Option<i64>>(3)?, // effective_to
                row.get::<_, String>(1)?.trim().parse::<f64>().unwrap_or(0.0), // monthly_fee
            ))
        })?;

        let subs: Vec<(String, i64, Option<i64>, f64)> = rows.collect::<Result<_, _>>()?;
        let mut map: HashMap<String, f64> = HashMap::new();

        for_each_month_in_range(start_ts, end_ts, |year, month| {
            let month_start = chrono::NaiveDate::from_ymd_opt(year, month, 1)
                .expect("valid date")
                .and_hms_opt(0, 0, 0)
                .unwrap()
                .and_utc()
                .timestamp();
            let next_month = if month == 12 {
                chrono::NaiveDate::from_ymd_opt(year + 1, 1, 1)
            } else {
                chrono::NaiveDate::from_ymd_opt(year, month + 1, 1)
            }
            .expect("next month valid")
            .and_hms_opt(0, 0, 0)
            .unwrap()
            .and_utc()
            .timestamp();

            for (agent, eff_from, eff_to, fee) in &subs {
                let sub_active = eff_from < &next_month
                    && eff_to.map_or(true, |to| to >= month_start);
                if sub_active {
                    *map.entry(agent.clone()).or_default() += fee;
                }
            }
        });

        Ok(map)
    }
}

// ---------------------------------------------------------------------------
// tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    /// Helper: insert a proxy_request_log row
    fn insert_log(
        db: &Database,
        request_id: &str,
        app_type: &str,
        cost_usd: &str,
        created_at: i64,
    ) {
        let conn = db.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO proxy_request_logs
             (request_id, provider_id, app_type, model,
              input_tokens, output_tokens,
              cache_creation_tokens, cache_read_tokens,
              total_cost_usd, latency_ms, status_code, created_at, data_source)
             VALUES (?1, 'test-provider', ?2, 'unknown',
                     100, 50, 0, 0, ?3, 0, 200, ?4, 'proxy')",
            rusqlite::params![request_id, app_type, cost_usd, created_at],
        )
        .expect("insert log");
    }

    /// Helper: insert a subscription_fee row
    fn insert_fee(
        db: &Database,
        agent_type: &str,
        monthly_fee: &str,
        effective_from: i64,
        effective_to: Option<i64>,
    ) {
        let conn = db.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO subscription_fees
             (agent_type, plan_label, monthly_fee, currency, billing_day,
              effective_from, effective_to)
             VALUES (?1, 'test-plan', ?2, 'USD', 1, ?3, ?4)",
            rusqlite::params![agent_type, monthly_fee, effective_from, effective_to],
        )
        .expect("insert fee");
    }

    /// Helper: timestamp for a given UTC date
    fn ts(year: i32, month: u32, day: u32) -> i64 {
        chrono::NaiveDate::from_ymd_opt(year, month, day)
            .expect("valid date")
            .and_hms_opt(0, 0, 0)
            .unwrap()
            .and_utc()
            .timestamp()
    }

    // ---- test: only token cost ----

    #[test]
    fn only_token_cost() {
        let db = Database::memory().expect("memory db");
        insert_log(&db, "r1", "claude", "1.500000", ts(2026, 6, 10));
        insert_log(&db, "r2", "claude", "2.500000", ts(2026, 6, 15));

        let result = db
            .get_cost_ledger_summary(CostLedgerQuery {
                start_date: Some(ts(2026, 6, 1)),
                end_date: Some(ts(2026, 6, 30)),
                agent_type: None,
            })
            .expect("query");

        assert_eq!(result.token_cost_usd, "4.000000");
        assert_eq!(result.subscription_cost_usd, "0.000000");
        assert_eq!(result.total_cost_usd, "4.000000");
        assert_eq!(result.by_agent.len(), 1);
        assert_eq!(result.by_agent[0].agent_type, "claude");
        assert_eq!(result.by_agent[0].token_cost_usd, "4.000000");
        assert_eq!(result.by_agent[0].subscription_cost_usd, "0.000000");
    }

    // ---- test: only subscription cost ----

    #[test]
    fn only_subscription_cost() {
        let db = Database::memory().expect("memory db");
        // subscription active for the whole month of June 2026
        insert_fee(&db, "claude", "20.00", ts(2026, 1, 1), None);

        let result = db
            .get_cost_ledger_summary(CostLedgerQuery {
                start_date: Some(ts(2026, 6, 1)),
                end_date: Some(ts(2026, 6, 30)),
                agent_type: None,
            })
            .expect("query");

        assert_eq!(result.token_cost_usd, "0.000000");
        assert_eq!(result.subscription_cost_usd, "20.000000");
        assert_eq!(result.total_cost_usd, "20.000000");
        assert_eq!(result.by_agent.len(), 1);
        assert_eq!(result.by_agent[0].subscription_cost_usd, "20.000000");
    }

    // ---- test: token cost + subscription cost ----

    #[test]
    fn token_plus_subscription() {
        let db = Database::memory().expect("memory db");
        insert_log(&db, "r1", "claude", "3.000000", ts(2026, 6, 10));
        insert_fee(&db, "claude", "10.00", ts(2026, 1, 1), None);

        let result = db
            .get_cost_ledger_summary(CostLedgerQuery {
                start_date: Some(ts(2026, 6, 1)),
                end_date: Some(ts(2026, 6, 30)),
                agent_type: None,
            })
            .expect("query");

        assert_eq!(result.token_cost_usd, "3.000000");
        assert_eq!(result.subscription_cost_usd, "10.000000");
        assert_eq!(result.total_cost_usd, "13.000000");
        // cumulative covers Jan–Jun = 6 months * $10 + $3 token = $63
        assert_eq!(result.cumulative_subscription_cost_usd, "60.000000");
        assert_eq!(result.cumulative_total_cost_usd, "63.000000");
    }

    // ---- test: cross-month subscription counting ----

    #[test]
    fn cross_month_subscription_counted_per_month() {
        let db = Database::memory().expect("memory db");
        // subscription from June 1 to July 31 (two full months)
        insert_fee(&db, "claude", "25.00", ts(2026, 6, 1), Some(ts(2026, 7, 31)));

        // query covers June + July
        let result = db
            .get_cost_ledger_summary(CostLedgerQuery {
                start_date: Some(ts(2026, 6, 1)),
                end_date: Some(ts(2026, 7, 31)),
                agent_type: None,
            })
            .expect("query");

        // 25 per month * 2 months = 50
        assert_eq!(result.subscription_cost_usd, "50.000000");
        assert_eq!(result.total_cost_usd, "50.000000");
    }

    // ---- test: end_date < start_date returns error ----

    #[test]
    fn end_before_start_returns_error() {
        let db = Database::memory().expect("memory db");

        let result = db.get_cost_ledger_summary(CostLedgerQuery {
            start_date: Some(ts(2026, 6, 30)),
            end_date: Some(ts(2026, 6, 1)),
            agent_type: None,
        });

        assert!(result.is_err());
        match result.unwrap_err() {
            AppError::InvalidInput(msg) => {
                assert!(msg.contains("end_date must be >= start_date"));
            }
            other => panic!("expected InvalidInput, got: {other:?}"),
        }
    }
}
