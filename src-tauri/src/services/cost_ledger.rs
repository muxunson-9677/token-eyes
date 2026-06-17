//! 花销聚合查询服务
//!
//! 把 token 消耗成本和手动订阅费合并成统一查询结果。
//! 本阶段 Dashboard 展示口径使用 USD，不做汇率换算。

use chrono::Datelike;
use crate::database::{lock_conn, Database};
use crate::error::AppError;
use crate::services::usage_stats::{
    compute_rollup_date_bounds, effective_usage_log_filter, push_rollup_date_filters,
};
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

        let period_token = self.query_token_cost_sum(
            Some(period_start), Some(period_end), agent_filter,
        )?;
        let cumulative_token = self.query_token_cost_sum(
            None, Some(period_end), agent_filter,
        )?;
        let period_sub = self.query_subscription_cost_sum(period_start, period_end, agent_filter)?;
        let cumulative_sub = self.query_subscription_cost_sum(0, period_end, agent_filter)?;

        let token_by_agent = self.query_token_cost_by_agent(
            Some(period_start), Some(period_end), agent_filter,
        )?;
        let sub_by_agent = self.query_subscription_cost_by_agent(period_start, period_end, agent_filter)?;

        let mut agents: HashMap<String, (f64, f64)> = HashMap::new();
        for (k, v) in token_by_agent { agents.entry(k).or_default().0 += v; }
        for (k, v) in sub_by_agent { agents.entry(k).or_default().1 += v; }
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

    fn query_token_cost_sum(
        &self, start_date: Option<i64>, end_date: Option<i64>, agent_type: Option<&str>,
    ) -> Result<f64, AppError> {
        let conn = lock_conn!(self.conn);

        let mut detail_conditions = vec![effective_usage_log_filter("l")];
        let mut detail_params: Vec<Box<dyn rusqlite::ToSql>> = Vec::new();
        if let Some(s) = start_date { detail_conditions.push("l.created_at >= ?".into()); detail_params.push(Box::new(s)); }
        if let Some(e) = end_date { detail_conditions.push("l.created_at <= ?".into()); detail_params.push(Box::new(e)); }
        if let Some(at) = agent_type { detail_conditions.push("l.app_type = ?".into()); detail_params.push(Box::new(at.to_string())); }
        let detail_where = format!("WHERE {}", detail_conditions.join(" AND "));

        let rollup_bounds = compute_rollup_date_bounds(start_date, end_date)?;
        let mut rollup_conditions: Vec<String> = Vec::new();
        let mut rollup_params: Vec<Box<dyn rusqlite::ToSql>> = Vec::new();
        push_rollup_date_filters(&mut rollup_conditions, &mut rollup_params, "r.date", &rollup_bounds);
        if let Some(at) = agent_type { rollup_conditions.push("r.app_type = ?".into()); rollup_params.push(Box::new(at.to_string())); }
        let rollup_where = if rollup_conditions.is_empty() { String::new() } else { format!("WHERE {}", rollup_conditions.join(" AND ")) };

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

    fn query_token_cost_by_agent(
        &self, start_date: Option<i64>, end_date: Option<i64>, agent_type: Option<&str>,
    ) -> Result<HashMap<String, f64>, AppError> {
        let conn = lock_conn!(self.conn);

        let mut detail_conditions = vec![effective_usage_log_filter("l")];
        let mut detail_params: Vec<Box<dyn rusqlite::ToSql>> = Vec::new();
        if let Some(s) = start_date { detail_conditions.push("l.created_at >= ?".into()); detail_params.push(Box::new(s)); }
        if let Some(e) = end_date { detail_conditions.push("l.created_at <= ?".into()); detail_params.push(Box::new(e)); }
        if let Some(at) = agent_type { detail_conditions.push("l.app_type = ?".into()); detail_params.push(Box::new(at.to_string())); }
        let detail_where = format!("WHERE {}", detail_conditions.join(" AND "));

        let rollup_bounds = compute_rollup_date_bounds(start_date, end_date)?;
        let mut rollup_conditions: Vec<String> = Vec::new();
        let mut rollup_params: Vec<Box<dyn rusqlite::ToSql>> = Vec::new();
        push_rollup_date_filters(&mut rollup_conditions, &mut rollup_params, "r.date", &rollup_bounds);
        if let Some(at) = agent_type { rollup_conditions.push("r.app_type = ?".into()); rollup_params.push(Box::new(at.to_string())); }
        let rollup_where = if rollup_conditions.is_empty() { String::new() } else { format!("WHERE {}", rollup_conditions.join(" AND ")) };

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
        for row in rows { let (agent, cost) = row?; map.insert(agent, cost); }
        Ok(map)
    }

    fn query_subscription_cost_sum(
        &self, start_ts: i64, end_ts: i64, agent_type: Option<&str>,
    ) -> Result<f64, AppError> {
        let conn = lock_conn!(self.conn);
        let mut conditions = vec!["currency = 'USD'".to_string()];
        let mut params_vec: Vec<Box<dyn rusqlite::ToSql>> = Vec::new();
        conditions.push("effective_from <= ?".into()); params_vec.push(Box::new(end_ts));
        conditions.push("(effective_to IS NULL OR effective_to >= ?)".into()); params_vec.push(Box::new(start_ts));
        if let Some(at) = agent_type { conditions.push("agent_type = ?".into()); params_vec.push(Box::new(at.to_string())); }
        let where_clause = format!("WHERE {}", conditions.join(" AND "));
        let sql = format!("SELECT agent_type, monthly_fee, effective_from, effective_to FROM subscription_fees {where_clause}");
        let param_refs: Vec<&dyn rusqlite::ToSql> = params_vec.iter().map(|p| p.as_ref()).collect();
        let mut stmt = conn.prepare(&sql)?;
        let rows = stmt.query_map(param_refs.as_slice(), |row| {
            Ok((row.get::<_, i64>(2)?, row.get::<_, Option<i64>>(3)?, row.get::<_, String>(1)?.trim().parse::<f64>().unwrap_or(0.0)))
        })?;
        let subs: Vec<(i64, Option<i64>, f64)> = rows.collect::<Result<_, _>>()?;
        let mut total = 0.0f64;
        for_each_month_in_range(start_ts, end_ts, |year, month| {
            let month_start = chrono::NaiveDate::from_ymd_opt(year, month, 1).unwrap().and_hms_opt(0,0,0).unwrap().and_utc().timestamp();
            let next_month = if month == 12 { chrono::NaiveDate::from_ymd_opt(year+1,1,1) } else { chrono::NaiveDate::from_ymd_opt(year,month+1,1) }.unwrap().and_hms_opt(0,0,0).unwrap().and_utc().timestamp();
            for &(eff_from, eff_to, fee) in &subs {
                if eff_from < next_month && eff_to.map_or(true, |to| to >= month_start) { total += fee; }
            }
        });
        Ok(total)
    }

    fn query_subscription_cost_by_agent(
        &self, start_ts: i64, end_ts: i64, agent_type: Option<&str>,
    ) -> Result<HashMap<String, f64>, AppError> {
        let conn = lock_conn!(self.conn);
        let mut conditions = vec!["currency = 'USD'".to_string()];
        let mut params_vec: Vec<Box<dyn rusqlite::ToSql>> = Vec::new();
        conditions.push("effective_from <= ?".into()); params_vec.push(Box::new(end_ts));
        conditions.push("(effective_to IS NULL OR effective_to >= ?)".into()); params_vec.push(Box::new(start_ts));
        if let Some(at) = agent_type { conditions.push("agent_type = ?".into()); params_vec.push(Box::new(at.to_string())); }
        let where_clause = format!("WHERE {}", conditions.join(" AND "));
        let sql = format!("SELECT agent_type, monthly_fee, effective_from, effective_to FROM subscription_fees {where_clause}");
        let param_refs: Vec<&dyn rusqlite::ToSql> = params_vec.iter().map(|p| p.as_ref()).collect();
        let mut stmt = conn.prepare(&sql)?;
        let rows = stmt.query_map(param_refs.as_slice(), |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, i64>(2)?, row.get::<_, Option<i64>>(3)?, row.get::<_, String>(1)?.trim().parse::<f64>().unwrap_or(0.0)))
        })?;
        let subs: Vec<(String, i64, Option<i64>, f64)> = rows.collect::<Result<_, _>>()?;
        let mut map: HashMap<String, f64> = HashMap::new();
        for_each_month_in_range(start_ts, end_ts, |year, month| {
            let month_start = chrono::NaiveDate::from_ymd_opt(year, month, 1).unwrap().and_hms_opt(0,0,0).unwrap().and_utc().timestamp();
            let next_month = if month == 12 { chrono::NaiveDate::from_ymd_opt(year+1,1,1) } else { chrono::NaiveDate::from_ymd_opt(year,month+1,1) }.unwrap().and_hms_opt(0,0,0).unwrap().and_utc().timestamp();
            for (agent, eff_from, eff_to, fee) in &subs {
                if eff_from < &next_month && eff_to.map_or(true, |to| to >= month_start) { *map.entry(agent.clone()).or_default() += fee; }
            }
        });
        Ok(map)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn insert_log(db: &Database, request_id: &str, app_type: &str, cost_usd: &str, created_at: i64) {
        db.conn.lock().unwrap().execute(
            "INSERT INTO proxy_request_logs (request_id, provider_id, app_type, model, input_tokens, output_tokens, cache_creation_tokens, cache_read_tokens, total_cost_usd, latency_ms, status_code, created_at, data_source) VALUES (?1, 'tp', ?2, 'unknown', 100, 50, 0, 0, ?3, 0, 200, ?4, 'proxy')",
            rusqlite::params![request_id, app_type, cost_usd, created_at],
        ).expect("insert log");
    }

    fn insert_rollup(db: &Database, date: &str, app_type: &str, cost_usd: &str) {
        db.conn.lock().unwrap().execute(
            "INSERT INTO usage_daily_rollups (date, app_type, provider_id, model, request_model, pricing_model, request_count, success_count, input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens, total_cost_usd, avg_latency_ms) VALUES (?1, ?2, 'tp', 'unknown', '', '', 1, 1, 100, 50, 0, 0, ?3, 0)",
            rusqlite::params![date, app_type, cost_usd],
        ).expect("insert rollup");
    }

    fn insert_fee(db: &Database, agent_type: &str, monthly_fee: &str, effective_from: i64, effective_to: Option<i64>) {
        db.conn.lock().unwrap().execute(
            "INSERT INTO subscription_fees (agent_type, plan_label, monthly_fee, currency, billing_day, effective_from, effective_to) VALUES (?1, 'test-plan', ?2, 'USD', 1, ?3, ?4)",
            rusqlite::params![agent_type, monthly_fee, effective_from, effective_to],
        ).expect("insert fee");
    }

    fn ts(year: i32, month: u32, day: u32) -> i64 {
        chrono::NaiveDate::from_ymd_opt(year, month, day).unwrap().and_hms_opt(0,0,0).unwrap().and_utc().timestamp()
    }

    #[test]
    fn only_token_cost() {
        let db = Database::memory().unwrap();
        insert_log(&db, "r1", "claude", "1.500000", ts(2026,6,10));
        insert_log(&db, "r2", "claude", "2.500000", ts(2026,6,15));
        let r = db.get_cost_ledger_summary(CostLedgerQuery { start_date: Some(ts(2026,6,1)), end_date: Some(ts(2026,6,30)), agent_type: None }).unwrap();
        assert_eq!(r.token_cost_usd, "4.000000");
        assert_eq!(r.subscription_cost_usd, "0.000000");
        assert_eq!(r.total_cost_usd, "4.000000");
        assert_eq!(r.by_agent.len(), 1);
        assert_eq!(r.by_agent[0].agent_type, "claude");
    }

    #[test]
    fn only_subscription_cost() {
        let db = Database::memory().unwrap();
        insert_fee(&db, "claude", "20.00", ts(2026,1,1), None);
        let r = db.get_cost_ledger_summary(CostLedgerQuery { start_date: Some(ts(2026,6,1)), end_date: Some(ts(2026,6,30)), agent_type: None }).unwrap();
        assert_eq!(r.token_cost_usd, "0.000000");
        assert_eq!(r.subscription_cost_usd, "20.000000");
        assert_eq!(r.total_cost_usd, "20.000000");
    }

    #[test]
    fn token_plus_subscription() {
        let db = Database::memory().unwrap();
        insert_log(&db, "r1", "claude", "3.000000", ts(2026,6,10));
        insert_fee(&db, "claude", "10.00", ts(2026,1,1), None);
        let r = db.get_cost_ledger_summary(CostLedgerQuery { start_date: Some(ts(2026,6,1)), end_date: Some(ts(2026,6,30)), agent_type: None }).unwrap();
        assert_eq!(r.token_cost_usd, "3.000000");
        assert_eq!(r.subscription_cost_usd, "10.000000");
        assert_eq!(r.total_cost_usd, "13.000000");
        assert_eq!(r.cumulative_subscription_cost_usd, "60.000000");
        assert_eq!(r.cumulative_total_cost_usd, "63.000000");
    }

    #[test]
    fn cross_month_subscription_counted_per_month() {
        let db = Database::memory().unwrap();
        insert_fee(&db, "claude", "25.00", ts(2026,6,1), Some(ts(2026,7,31)));
        let r = db.get_cost_ledger_summary(CostLedgerQuery { start_date: Some(ts(2026,6,1)), end_date: Some(ts(2026,7,31)), agent_type: None }).unwrap();
        assert_eq!(r.subscription_cost_usd, "50.000000");
    }

    #[test]
    fn end_before_start_returns_error() {
        let db = Database::memory().unwrap();
        let r = db.get_cost_ledger_summary(CostLedgerQuery { start_date: Some(ts(2026,6,30)), end_date: Some(ts(2026,6,1)), agent_type: None });
        assert!(r.is_err());
        match r.unwrap_err() { AppError::InvalidInput(msg) => assert!(msg.contains("end_date")), other => panic!("{other:?}") }
    }

    #[test]
    fn rollup_rows_counted_when_date_fully_in_range() {
        let db = Database::memory().unwrap();
        insert_rollup(&db, "2026-06-10", "claude", "7.500000");
        let r = db.get_cost_ledger_summary(CostLedgerQuery { start_date: Some(ts(2026,6,1)), end_date: Some(ts(2026,6,30)), agent_type: None }).unwrap();
        assert_eq!(r.token_cost_usd, "7.500000");
    }

    #[test]
    fn rollup_and_detail_costs_summed() {
        let db = Database::memory().unwrap();
        insert_log(&db, "r1", "claude", "2.000000", ts(2026,6,15));
        insert_rollup(&db, "2026-06-20", "claude", "3.000000");
        let r = db.get_cost_ledger_summary(CostLedgerQuery { start_date: Some(ts(2026,6,1)), end_date: Some(ts(2026,6,30)), agent_type: None }).unwrap();
        assert_eq!(r.token_cost_usd, "5.000000");
    }

    #[test]
    fn partial_boundary_range_excludes_non_full_day_rollup() {
        let db = Database::memory().unwrap();
        insert_rollup(&db, "2026-06-15", "claude", "5.000000");
        let start = ts(2026,6,15) + 12 * 3600;
        let end = ts(2026,6,30) + 23 * 3600 + 59 * 60;
        let r = db.get_cost_ledger_summary(CostLedgerQuery { start_date: Some(start), end_date: Some(end), agent_type: None }).unwrap();
        assert_eq!(r.token_cost_usd, "0.000000");
    }
}
