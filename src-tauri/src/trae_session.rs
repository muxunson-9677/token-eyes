//! Official TRAE CN OAuth binding and quota synchronization.
//!
//! Token Eyes stores credentials only in the per-account native app-data
//! directory. The dashboard receives only a binding reference and sanitized
//! quota values.

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use rand::RngCore;
use ring::{
    rand::SystemRandom,
    signature::{EcdsaKeyPair, KeyPair, ECDSA_P256_SHA256_FIXED_SIGNING},
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::fs;
use std::io::{Read, Write};
use std::net::TcpListener;
use std::path::{Path, PathBuf};
use std::sync::mpsc::{self, Receiver, TryRecvError};
use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Manager, State};
use tauri_plugin_opener::OpenerExt;

const SESSION_PREFIX: &str = "token-plan/trae/session/";
const CLIENT_ID: &str = "ono9krqynydwx5";
const TRAE_APP_VERSION: &str = "3.5.66";
/// Official Trae CN browser authorization origin (Cockpit successful OAuth link).
/// Distinct from GetLoginGuidance API hosts such as api.trae.cn.
const BROWSER_AUTH_ORIGIN_CN: &str = "https://www.trae.cn";
const BROWSER_AUTH_PATH: &str = "/authorization";
const DEFAULT_LOGIN_HOST: &str = "https://www.trae.cn";
const API_ROOTS: [&str; 3] = [
    "https://api.trae.cn",
    "https://api.trae.com.cn",
    "https://api.marscode.com",
];
const LOGIN_GUIDANCE_ENDPOINTS: [&str; 3] = [
    "https://api.trae.cn/cloudide/api/v3/trae/GetLoginGuidance",
    "https://api.trae.com.cn/cloudide/api/v3/trae/GetLoginGuidance",
    "https://www.trae.cn/cloudide/api/v3/trae/GetLoginGuidance",
];
const AUTH_CODE_EXCHANGE_PATH: &str = "/trae/api/v3/oauth/ExchangeToken";
const REFRESH_TOKEN_EXCHANGE_PATH: &str = "/cloudide/api/v3/trae/oauth/ExchangeToken";
const GET_USER_INFO_PATH: &str = "/cloudide/api/v3/trae/GetUserInfo";
/// Cockpit CN refresh prefers pay usage + entitlement list (v2 first, v1 fallback).
const QUOTA_PATHS: [&str; 3] = [
    "/trae/api/v2/pay/ide_user_ent_usage",
    "/trae/api/v1/pay/ide_user_ent_usage",
    "/trae/api/v2/pay/user_current_entitlement_list",
];
const PRODUCT_TYPE_PROMO_CODE: i64 = 3;
const PRODUCT_TYPE_CN_EXPRESS: i64 = 100;
const PRODUCT_TYPE_PRO: i64 = 1;
const PRODUCT_TYPE_PRO_PLUS: i64 = 4;
const PRODUCT_TYPE_PRO_PLUS_PACK: i64 = 5;
const PRODUCT_TYPE_ULTRA: i64 = 6;
const PRODUCT_TYPE_LITE: i64 = 8;
const PRODUCT_TYPE_TRIAL: i64 = 9;
const PRODUCT_TYPE_FREE: i64 = 0;

#[derive(Debug)]
struct OAuthCallback {
    auth_code: Option<String>,
    refresh_token: Option<String>,
    state: Option<String>,
    login_host: Option<String>,
    cloudide_token: Option<String>,
}

#[derive(Debug)]
struct PendingTraeOAuth {
    verifier: String,
    receiver: Mutex<Receiver<Result<OAuthCallback, String>>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct StoredTraeTokens {
    access_token: String,
    #[serde(default)]
    refresh_token: String,
    #[serde(default)]
    login_host: String,
    #[serde(default)]
    cloudide_token: String,
    #[serde(default)]
    account_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct TraeQuotaWindow {
    pub kind: String,
    pub unit: String,
    pub total: f64,
    pub used: f64,
    pub remaining: f64,
    pub percentage: f64,
    pub resets_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct TraeQuota {
    pub account_id: String,
    pub plan_name: String,
    pub total_quota: f64,
    pub used_quota: f64,
    pub remaining_quota: f64,
    pub quota_windows: Vec<TraeQuotaWindow>,
    pub provider_reported_at: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct TraeSessionStatus {
    pub connected: bool,
    pub authorized: bool,
    pub session_ref: String,
    pub state_code: String,
    pub error_code: String,
    pub error_message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub quota: Option<TraeQuota>,
}

#[derive(Default)]
pub struct TraeSessionState {
    pending: HashMap<String, PendingTraeOAuth>,
}

fn status(session_ref: &str, state_code: &str) -> TraeSessionStatus {
    TraeSessionStatus {
        connected: state_code == "connected",
        authorized: matches!(state_code, "authorized" | "connected"),
        session_ref: session_ref.to_string(),
        state_code: state_code.to_string(),
        error_code: String::new(),
        error_message: String::new(),
        quota: None,
    }
}

fn failed(session_ref: &str, code: &str, message: impl Into<String>) -> TraeSessionStatus {
    TraeSessionStatus {
        connected: false,
        authorized: false,
        session_ref: session_ref.to_string(),
        state_code: "failed".to_string(),
        error_code: code.to_string(),
        error_message: message.into(),
        quota: None,
    }
}

/// Auth file / tokens may exist while entitlement parse fails — never "connected" with zeros.
fn sync_failed(session_ref: &str, code: &str, message: impl Into<String>) -> TraeSessionStatus {
    TraeSessionStatus {
        connected: false,
        authorized: true,
        session_ref: session_ref.to_string(),
        state_code: "sync_failed".to_string(),
        error_code: code.to_string(),
        error_message: message.into(),
        quota: None,
    }
}

fn session_suffix(session_ref: &str) -> Result<&str, String> {
    let suffix = session_ref
        .strip_prefix(SESSION_PREFIX)
        .ok_or_else(|| "Invalid TRAE session reference".to_string())?;
    if suffix.is_empty()
        || suffix.len() > 80
        || !suffix
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_'))
    {
        return Err("Invalid TRAE session reference".to_string());
    }
    Ok(suffix)
}

fn account_dir(app: &AppHandle, session_ref: &str) -> Result<PathBuf, String> {
    let suffix = session_suffix(session_ref)?;
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|_| "Unable to resolve Token Eyes app-data directory".to_string())?
        .join("trae-accounts")
        .join(suffix))
}

fn token_path(dir: &Path) -> PathBuf {
    dir.join("auth.json")
}

fn load_tokens(dir: &Path) -> Result<StoredTraeTokens, String> {
    let raw = fs::read_to_string(token_path(dir))
        .map_err(|_| "TRAE authorization was not found; reconnect this account".to_string())?;
    serde_json::from_str(&raw).map_err(|_| "Stored TRAE authorization is invalid".to_string())
}

fn save_tokens(dir: &Path, tokens: &StoredTraeTokens) -> Result<(), String> {
    fs::create_dir_all(dir).map_err(|_| "Unable to create TRAE account storage".to_string())?;
    let raw = serde_json::to_vec(tokens)
        .map_err(|_| "Unable to encode TRAE authorization".to_string())?;
    fs::write(token_path(dir), raw).map_err(|_| "Unable to save TRAE authorization".to_string())
}

fn random_urlsafe(bytes: usize) -> String {
    let mut value = vec![0u8; bytes];
    rand::thread_rng().fill_bytes(&mut value);
    URL_SAFE_NO_PAD.encode(value)
}

fn first_query_value(values: &HashMap<String, String>, keys: &[&str]) -> Option<String> {
    keys.iter().find_map(|key| {
        values
            .get(*key)
            .map(|value| value.trim())
            .filter(|value| !value.is_empty())
            .map(str::to_string)
    })
}

fn callback_auth_code(values: &HashMap<String, String>) -> Result<Option<String>, String> {
    if let Some(code) = first_query_value(
        values,
        &[
            "authCode",
            "auth_code",
            "AuthCode",
            "authorization_code",
            "code",
        ],
    ) {
        return Ok(Some(code));
    }
    let Some(raw) = first_query_value(values, &["authCodeInfo", "auth_code_info", "AuthCodeInfo"])
    else {
        return Ok(None);
    };
    let value: Value = serde_json::from_str(&raw)
        .map_err(|_| "TRAE callback authCodeInfo was invalid".to_string())?;
    Ok(recursive_string(
        &value,
        &["AuthCode", "authCode", "auth_code", "code"],
    ))
}

fn callback_from_target(target: &str) -> Result<OAuthCallback, String> {
    let parsed = url::Url::parse(&format!("http://localhost{target}"))
        .map_err(|_| "Invalid TRAE OAuth callback".to_string())?;
    if parsed.path() != "/authorize" {
        return Err("Invalid TRAE OAuth callback path".to_string());
    }
    let values = parsed.query_pairs().into_owned().collect::<HashMap<_, _>>();
    if let Some(error) = first_query_value(&values, &["error", "error_code", "err", "errorCode"]) {
        return Err(format!("TRAE authorization failed: {error}"));
    }
    let auth_code = callback_auth_code(&values)?;
    let refresh_token = first_query_value(
        &values,
        &[
            "refreshToken",
            "refresh_token",
            "RefreshToken",
            "refresh-token",
        ],
    );
    if auth_code.is_none() && refresh_token.is_none() {
        return Err(
            "TRAE callback did not include authCodeInfo/AuthCode or refreshToken".to_string(),
        );
    }
    Ok(OAuthCallback {
        auth_code,
        refresh_token,
        state: first_query_value(&values, &["state"]),
        login_host: first_query_value(
            &values,
            &[
                "loginHost",
                "login_host",
                "LoginHost",
                "host",
                "consoleHost",
            ],
        ),
        cloudide_token: first_query_value(
            &values,
            &["cloudideToken", "cloudide_token", "CloudideToken", "token"],
        ),
    })
}

/// Browser auth origin is never the GetLoginGuidance API host.
/// Cockpit success URL: `https://www.trae.cn/authorization?login_version=1&auth_from=trae&...`
fn resolve_browser_auth_origin(_login_host: &str) -> Result<url::Url, String> {
    url::Url::parse(BROWSER_AUTH_ORIGIN_CN)
        .map_err(|_| "TRAE browser authorization origin is invalid".to_string())
}

fn build_authorization_url(
    login_host: &str,
    redirect_uri: &str,
    trace_id: &str,
    challenge: &str,
) -> Result<url::Url, String> {
    // login_host may be api.trae.cn (guidance/API). Do NOT Url::parse(login_host)+set_path.
    let mut auth_url = resolve_browser_auth_origin(login_host)?;
    auth_url.set_path(BROWSER_AUTH_PATH);
    auth_url.set_query(None);
    let machine_id = random_urlsafe(18);
    let device_id = random_urlsafe(18);
    // Query param set mirrors Cockpit `build_verification_uri` for Trae CN (auth_from=trae).
    auth_url
        .query_pairs_mut()
        .append_pair("login_version", "1")
        .append_pair("auth_from", "trae")
        .append_pair("login_channel", "native_ide")
        .append_pair("plugin_version", "local")
        .append_pair("auth_type", "local")
        .append_pair("client_id", CLIENT_ID)
        .append_pair("redirect", "0")
        .append_pair("login_trace_id", trace_id)
        .append_pair("auth_callback_url", redirect_uri)
        .append_pair("machine_id", &machine_id)
        .append_pair("device_id", &device_id)
        .append_pair("x_device_id", &device_id)
        .append_pair("x_machine_id", &machine_id)
        .append_pair("x_device_brand", "windows")
        .append_pair("x_device_type", "desktop")
        .append_pair("x_os_version", "Windows 10")
        .append_pair("x_env", "prod")
        .append_pair("x_app_version", TRAE_APP_VERSION)
        .append_pair("x_app_type", "stable")
        .append_pair("code_challenge", challenge)
        .append_pair("code_challenge_method", "S256");
    Ok(auth_url)
}

fn start_listener(
    login_host: &str,
    trace_id: String,
) -> Result<(PendingTraeOAuth, String), String> {
    let listener = TcpListener::bind(("127.0.0.1", 0))
        .map_err(|_| "Unable to start the TRAE OAuth callback listener".to_string())?;
    let port = listener
        .local_addr()
        .map_err(|_| "Unable to resolve the TRAE OAuth callback port".to_string())?
        .port();
    let redirect_uri = format!("http://127.0.0.1:{port}/authorize");
    let verifier = random_urlsafe(64);
    let challenge = URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()));
    let auth_url = build_authorization_url(login_host, &redirect_uri, &trace_id, &challenge)?;
    let (sender, receiver) = mpsc::channel();
    std::thread::spawn(move || {
        let result = listener
            .accept()
            .map_err(|_| "Unable to receive the TRAE OAuth callback".to_string())
            .and_then(|(mut stream, _)| {
                let _ = stream.set_read_timeout(Some(Duration::from_secs(180)));
                let mut buffer = [0u8; 8192];
                let read = stream
                    .read(&mut buffer)
                    .map_err(|_| "Unable to read the TRAE OAuth callback".to_string())?;
                let request = String::from_utf8_lossy(&buffer[..read]);
                let target = request
                    .lines()
                    .next()
                    .and_then(|line| line.split_whitespace().nth(1))
                    .ok_or_else(|| "Invalid TRAE OAuth callback request".to_string())?;
                let parsed = callback_from_target(target);
                let body = if parsed.is_ok() {
                    "<!doctype html><meta charset=utf-8><title>Token Eyes</title><h1>TRAE 授权已完成</h1><p>此页面将自动关闭。</p><script>setTimeout(()=>window.close(),800)</script>"
                } else {
                    "<!doctype html><meta charset=utf-8><title>Token Eyes</title><h1>TRAE 授权失败</h1><p>请返回 Token Eyes 查看原因。</p>"
                };
                let response = format!("HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}", body.as_bytes().len(), body);
                let _ = stream.write_all(response.as_bytes());
                parsed
            });
        let _ = sender.send(result);
    });
    Ok((
        PendingTraeOAuth {
            verifier,
            receiver: Mutex::new(receiver),
        },
        auth_url.to_string(),
    ))
}

fn extract_login_guidance_host(value: &Value) -> Option<String> {
    let host = recursive_string(value, &["LoginHost", "loginHost", "LoginURL", "loginUrl"])?;
    let host = host.trim();
    if host.is_empty() {
        None
    } else if host.starts_with("https://") {
        Some(host.to_string())
    } else {
        Some(format!("https://{}", host.trim_start_matches("http://")))
    }
}

async fn resolve_login_guidance_host(trace_id: &str) -> String {
    let client = reqwest::Client::new();
    let body = json!({ "loginTraceID": trace_id, "login_trace_id": trace_id });
    for endpoint in LOGIN_GUIDANCE_ENDPOINTS {
        if let Ok(response) = client
            .post(endpoint)
            .json(&body)
            .timeout(Duration::from_secs(8))
            .send()
            .await
        {
            if response.status().is_success() {
                if let Ok(value) = response.json::<Value>().await {
                    if let Some(host) = extract_login_guidance_host(&value) {
                        return host;
                    }
                }
            }
        }
    }
    DEFAULT_LOGIN_HOST.to_string()
}

fn recursive_string(value: &Value, keys: &[&str]) -> Option<String> {
    match value {
        Value::Object(map) => {
            for key in keys {
                if let Some(found) = map
                    .get(*key)
                    .and_then(Value::as_str)
                    .filter(|v| !v.is_empty())
                {
                    return Some(found.to_string());
                }
            }
            map.values().find_map(|item| recursive_string(item, keys))
        }
        Value::Array(items) => items.iter().find_map(|item| recursive_string(item, keys)),
        _ => None,
    }
}

fn as_object<'a>(value: &'a Value) -> Option<&'a serde_json::Map<String, Value>> {
    value.as_object()
}

fn nested_object<'a>(
    value: &'a Value,
    keys: &[&str],
) -> Option<&'a serde_json::Map<String, Value>> {
    let mut current = value;
    for key in keys {
        current = as_object(current)?.get(*key)?;
    }
    as_object(current)
}

fn object_number(map: &serde_json::Map<String, Value>, key: &str) -> Option<f64> {
    map.get(key)
        .and_then(|item| item.as_f64().or_else(|| item.as_i64().map(|n| n as f64)))
        .or_else(|| map.get(key).and_then(Value::as_str)?.parse().ok())
}

fn object_i64(map: &serde_json::Map<String, Value>, key: &str) -> Option<i64> {
    map.get(key)
        .and_then(|item| item.as_i64().or_else(|| item.as_f64().map(|n| n as i64)))
}

fn object_string(map: &serde_json::Map<String, Value>, key: &str) -> Option<String> {
    map.get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

fn collect_usage_roots(value: &Value) -> Vec<&Value> {
    let mut roots = vec![value];
    if let Some(map) = as_object(value) {
        for key in [
            "data",
            "Result",
            "result",
            "payload",
            "user_current_entitlement_list",
            "ide_user_ent_usage",
        ] {
            if let Some(nested) = map.get(key) {
                roots.push(nested);
            }
        }
    }
    roots
}

fn usage_pack_list(value: &Value) -> Vec<&Value> {
    for root in collect_usage_roots(value) {
        if let Some(list) = as_object(root)
            .and_then(|map| map.get("user_entitlement_pack_list"))
            .and_then(Value::as_array)
        {
            return list.iter().collect();
        }
    }
    Vec::new()
}

fn pack_product_type(pack: &Value) -> Option<i64> {
    nested_object(pack, &["entitlement_base_info"])
        .and_then(|base| object_i64(base, "product_type"))
        .or_else(|| as_object(pack).and_then(|map| object_i64(map, "product_type")))
}

fn pack_quota_map(pack: &Value) -> Option<&serde_json::Map<String, Value>> {
    nested_object(pack, &["entitlement_base_info", "quota"])
        .or_else(|| {
            nested_object(
                pack,
                &[
                    "entitlement_base_info",
                    "product_extra",
                    "subscription_extra",
                    "quota",
                ],
            )
        })
        .or_else(|| {
            nested_object(
                pack,
                &[
                    "entitlement_base_info",
                    "product_extra",
                    "package_extra",
                    "quota",
                ],
            )
        })
}

fn pack_usage_map(pack: &Value) -> Option<&serde_json::Map<String, Value>> {
    nested_object(pack, &["usage"])
}

fn pack_is_visible_active(pack: &Value) -> bool {
    let Some(map) = as_object(pack) else {
        return false;
    };
    if map.get("is_hide").and_then(Value::as_bool) == Some(true) {
        return false;
    }
    match object_i64(map, "status").or_else(|| object_i64(map, "entitlement_status")) {
        None | Some(1) => true,
        _ => false,
    }
}

fn select_cn_pack<'a>(packs: &[&'a Value]) -> Option<&'a Value> {
    let filtered: Vec<&Value> = packs
        .iter()
        .copied()
        .filter(|pack| pack_product_type(pack) != Some(PRODUCT_TYPE_PROMO_CODE))
        .collect();
    let find = |product_type: i64| {
        filtered
            .iter()
            .copied()
            .find(|pack| pack_product_type(pack) == Some(product_type))
    };
    find(PRODUCT_TYPE_CN_EXPRESS)
        .or_else(|| find(PRODUCT_TYPE_ULTRA))
        .or_else(|| find(PRODUCT_TYPE_PRO_PLUS_PACK))
        .or_else(|| find(PRODUCT_TYPE_PRO_PLUS))
        .or_else(|| find(PRODUCT_TYPE_PRO))
        .or_else(|| find(PRODUCT_TYPE_TRIAL))
        .or_else(|| find(PRODUCT_TYPE_LITE))
        .or_else(|| find(PRODUCT_TYPE_FREE))
}

fn identity_from_product_type(product_type: i64) -> &'static str {
    match product_type {
        PRODUCT_TYPE_CN_EXPRESS => "CNExpress",
        PRODUCT_TYPE_ULTRA => "Ultra",
        PRODUCT_TYPE_PRO_PLUS | PRODUCT_TYPE_PRO_PLUS_PACK => "Pro+",
        PRODUCT_TYPE_PRO | PRODUCT_TYPE_TRIAL => "Pro",
        PRODUCT_TYPE_LITE => "Lite",
        PRODUCT_TYPE_FREE => "Free",
        _ => "Unknown",
    }
}

fn civil_from_days(days: i64) -> (i32, u32, u32) {
    // Howard Hinnant civil_from_days (same as cursor_session).
    let z = days + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = (z - era * 146_097) as u64;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146_096) / 365;
    let y = yoe as i64 + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if m <= 2 { y + 1 } else { y };
    (y as i32, m as u32, d as u32)
}

fn unix_seconds_to_rfc3339(seconds: i64) -> String {
    if seconds <= 0 {
        return String::new();
    }
    let days = seconds.div_euclid(86_400);
    let time_of_day = seconds.rem_euclid(86_400) as u32;
    let hour = time_of_day / 3600;
    let minute = (time_of_day % 3600) / 60;
    let second = time_of_day % 60;
    let (year, month, day) = civil_from_days(days);
    format!("{year:04}-{month:02}-{day:02}T{hour:02}:{minute:02}:{second:02}Z")
}

fn pack_reset_at(pack: &Value) -> String {
    let end_time = nested_object(pack, &["entitlement_base_info"])
        .and_then(|base| object_i64(base, "end_time"))
        .filter(|value| *value > 0);
    // Cockpit: plan_reset_at = end_time + 1
    end_time
        .map(|value| unix_seconds_to_rfc3339(value + 1))
        .unwrap_or_default()
}

fn fast_request_totals(packs: &[&Value]) -> Option<(f64, f64, f64)> {
    let active: Vec<&Value> = packs
        .iter()
        .copied()
        .filter(|pack| pack_is_visible_active(pack))
        .collect();
    if active.is_empty() {
        return None;
    }
    let mut has_fast_evidence = false;
    let mut limits = Vec::new();
    let mut used = 0.0;
    for pack in &active {
        let quota = pack_quota_map(pack);
        let usage = pack_usage_map(pack);
        if quota
            .map(|map| map.contains_key("premium_model_fast_request_limit"))
            .unwrap_or(false)
            || usage
                .map(|map| map.contains_key("premium_model_fast_amount"))
                .unwrap_or(false)
        {
            has_fast_evidence = true;
        }
        if let Some(limit) =
            quota.and_then(|map| object_number(map, "premium_model_fast_request_limit"))
        {
            limits.push(limit);
        }
        used += usage
            .and_then(|map| object_number(map, "premium_model_fast_amount"))
            .unwrap_or(0.0);
    }
    if !has_fast_evidence {
        return None;
    }
    if limits.is_empty() {
        return None;
    }
    if limits.iter().any(|limit| *limit < 0.0) {
        return None;
    }
    let total = limits.iter().sum::<f64>();
    if total <= 0.0 {
        return None;
    }
    let used = used.clamp(0.0, total);
    let remaining = (total - used).max(0.0);
    Some((total, used, remaining))
}

fn extract_account_id(value: &Value) -> Option<String> {
    recursive_string(
        value,
        &[
            "user_id",
            "userId",
            "UserID",
            "uid",
            "account_id",
            "accountId",
        ],
    )
}

/// Parse Trae CN entitlement/usage JSON using Cockpit field paths.
/// Missing plan / total / remaining / reset / account_id → error (never invent connected zeros).
pub fn parse_trae_quota_snapshot(value: &Value, account_id: &str) -> Result<TraeQuota, String> {
    if let Some(code) = as_object(value).and_then(|map| object_i64(map, "code")) {
        if code != 0 {
            return Err(format!("TRAE entitlement API returned code {code}"));
        }
    }
    let packs = usage_pack_list(value);
    if packs.is_empty() {
        return Err("TRAE usage response missing user_entitlement_pack_list".to_string());
    }
    let selected = select_cn_pack(&packs)
        .ok_or_else(|| "TRAE usage response had no selectable entitlement pack".to_string())?;
    let (total, used, remaining) = fast_request_totals(&packs).ok_or_else(|| {
        "TRAE usage response missing premium_model_fast_request_limit / premium_model_fast_amount"
            .to_string()
    })?;
    let plan_name = as_object(selected)
        .and_then(|map| object_string(map, "display_desc"))
        .or_else(|| {
            pack_product_type(selected).map(|product_type| {
                identity_from_product_type(product_type).to_string()
            })
        })
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "TRAE usage response missing plan/display_desc".to_string())?;
    let resets_at = pack_reset_at(selected);
    if resets_at.is_empty() {
        return Err("TRAE usage response missing entitlement_base_info.end_time".to_string());
    }
    let resolved_account_id = {
        let trimmed = account_id.trim();
        if !trimmed.is_empty() {
            trimmed.to_string()
        } else {
            extract_account_id(value).unwrap_or_default()
        }
    };
    if resolved_account_id.is_empty() {
        return Err("TRAE quota parse missing account_id".to_string());
    }
    let percentage = if total > 0.0 {
        (used / total * 100.0).clamp(0.0, 100.0)
    } else {
        0.0
    };
    Ok(TraeQuota {
        account_id: resolved_account_id,
        plan_name,
        total_quota: total,
        used_quota: used,
        remaining_quota: remaining,
        quota_windows: vec![TraeQuotaWindow {
            kind: "fast_request".to_string(),
            unit: "requests".to_string(),
            total,
            used,
            remaining,
            percentage,
            resets_at,
        }],
        provider_reported_at: String::new(),
    })
}

pub fn normalize_quota(value: &Value) -> Result<TraeQuota, String> {
    let account_id = value
        .pointer("/_fixture/account_id")
        .and_then(Value::as_str)
        .or_else(|| value.get("account_id").and_then(Value::as_str))
        .unwrap_or("");
    parse_trae_quota_snapshot(value, account_id)
}

fn pem_wrap(label: &str, der: &[u8]) -> String {
    let encoded = base64::engine::general_purpose::STANDARD.encode(der);
    let mut pem = format!("-----BEGIN {label}-----\n");
    for chunk in encoded.as_bytes().chunks(64) {
        pem.push_str(std::str::from_utf8(chunk).unwrap_or_default());
        pem.push('\n');
    }
    pem.push_str(&format!("-----END {label}-----\n"));
    pem
}

fn generate_device_public_key() -> Result<String, String> {
    const P256_SPKI_PREFIX: &[u8] = &[
        0x30, 0x59, 0x30, 0x13, 0x06, 0x07, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x02, 0x01, 0x06, 0x08,
        0x2a, 0x86, 0x48, 0xce, 0x3d, 0x03, 0x01, 0x07, 0x03, 0x42, 0x00,
    ];
    let rng = SystemRandom::new();
    let pkcs8 = EcdsaKeyPair::generate_pkcs8(&ECDSA_P256_SHA256_FIXED_SIGNING, &rng)
        .map_err(|_| "Unable to generate the TRAE device key".to_string())?;
    let key_pair = EcdsaKeyPair::from_pkcs8(&ECDSA_P256_SHA256_FIXED_SIGNING, pkcs8.as_ref(), &rng)
        .map_err(|_| "Unable to read the TRAE device key".to_string())?;
    let public_key = key_pair.public_key().as_ref();
    if public_key.len() != 65 || public_key.first().copied() != Some(0x04) {
        return Err("TRAE generated an invalid P-256 device key".to_string());
    }
    let mut der = Vec::with_capacity(P256_SPKI_PREFIX.len() + public_key.len());
    der.extend_from_slice(P256_SPKI_PREFIX);
    der.extend_from_slice(public_key);
    Ok(pem_wrap("PUBLIC KEY", &der))
}

fn exchange_roots(login_host: Option<&str>) -> Vec<String> {
    let mut roots = Vec::new();
    if let Some(host) = login_host {
        if let Ok(url) = url::Url::parse(host) {
            if let Some(name) = url.host_str() {
                roots.push(format!("{}://{}", url.scheme(), name));
                if let Some(stripped) = name.strip_prefix("www.") {
                    roots.push(format!("{}://api.{}", url.scheme(), stripped));
                }
            }
        }
    }
    roots.extend(API_ROOTS.iter().map(|root| root.to_string()));
    roots.dedup();
    roots
}

async fn exchange_tokens(
    pending: &PendingTraeOAuth,
    callback: OAuthCallback,
) -> Result<StoredTraeTokens, String> {
    let client = reqwest::Client::new();
    let login_host = callback
        .login_host
        .clone()
        .unwrap_or_else(|| API_ROOTS[0].to_string());
    let (path, body) = if let Some(auth_code) = callback.auth_code.as_deref() {
        let device_public_key = generate_device_public_key()?;
        (
            AUTH_CODE_EXCHANGE_PATH,
            json!({
                "ClientID": CLIENT_ID,
                "AuthCode": auth_code,
                "CodeVerifier": pending.verifier,
                "IDEVersion": TRAE_APP_VERSION,
                "DeviceInfo": {
                    "DeviceID": random_urlsafe(18),
                    "MachineID": random_urlsafe(18),
                    "PlatformCode": "IDE_PC",
                    "DeviceType": "PC",
                    "DeviceName": "Token Eyes",
                    "DeviceModel": "Microsoft",
                    "ClientVersion": TRAE_APP_VERSION,
                    "DevicePublicKey": device_public_key,
                    "DeviceBrand": "Microsoft",
                    "DeviceCPU": "",
                    "OSInfo": "windows",
                    "OSVersion": "Windows 10",
                },
            }),
        )
    } else if let Some(refresh_token) = callback.refresh_token.as_deref() {
        (
            REFRESH_TOKEN_EXCHANGE_PATH,
            json!({
                "ClientID": CLIENT_ID,
                "RefreshToken": refresh_token,
                "ClientSecret": "-",
                "UserID": "",
            }),
        )
    } else {
        return Err("TRAE callback did not contain usable credentials".to_string());
    };
    for root in exchange_roots(Some(&login_host)) {
        let mut request = client
            .post(format!("{root}{path}"))
            .header("Accept", "application/json")
            .header("Content-Type", "application/json")
            .json(&body)
            .timeout(Duration::from_secs(20));
        if path == AUTH_CODE_EXCHANGE_PATH {
            request = request.header("x-cloudide-token", "");
        } else if let Some(token) = callback.cloudide_token.as_deref() {
            request = request.header("x-cloudide-token", token);
        }
        let response = request.send().await;
        let Ok(response) = response else { continue };
        if !response.status().is_success() {
            continue;
        }
        let value: Value = response
            .json()
            .await
            .map_err(|_| "TRAE token response was invalid".to_string())?;
        if let Some(access_token) = recursive_string(
            &value,
            &[
                "AccessToken",
                "access_token",
                "accessToken",
                "Token",
                "token",
            ],
        ) {
            return Ok(StoredTraeTokens {
                access_token,
                refresh_token: recursive_string(
                    &value,
                    &["RefreshToken", "refresh_token", "refreshToken"],
                )
                .or(callback.refresh_token.clone())
                .unwrap_or_default(),
                login_host,
                cloudide_token: callback.cloudide_token.unwrap_or_default(),
                account_id: extract_account_id(&value).unwrap_or_default(),
            });
        }
    }
    Err("TRAE OAuth token exchange failed".to_string())
}

async fn fetch_account_id(tokens: &StoredTraeTokens) -> Option<String> {
    if !tokens.account_id.trim().is_empty() {
        return Some(tokens.account_id.trim().to_string());
    }
    let client = reqwest::Client::new();
    for root in exchange_roots(Some(&tokens.login_host)) {
        let response = client
            .post(format!("{root}{GET_USER_INFO_PATH}"))
            .header(
                "Authorization",
                format!("Cloud-IDE-JWT {}", tokens.access_token),
            )
            .header("Accept", "application/json")
            .header("User-Agent", "Trae/1.0.0 Token-Eyes")
            .json(&json!({}))
            .timeout(Duration::from_secs(15))
            .send()
            .await;
        let Ok(response) = response else { continue };
        if !response.status().is_success() {
            continue;
        }
        let Ok(value) = response.json::<Value>().await else {
            continue;
        };
        if let Some(account_id) = extract_account_id(&value) {
            return Some(account_id);
        }
    }
    None
}

async fn fetch_quota(tokens: &StoredTraeTokens) -> Result<TraeQuota, String> {
    let client = reqwest::Client::new();
    let account_id = fetch_account_id(tokens).await.unwrap_or_default();
    let mut last_error = "Unable to reach the TRAE entitlement service".to_string();
    for path in QUOTA_PATHS {
        for root in API_ROOTS {
            let response = client
                .post(format!("{root}{path}"))
                .header(
                    "Authorization",
                    format!("Cloud-IDE-JWT {}", tokens.access_token),
                )
                .header("Accept", "application/json")
                .header("User-Agent", "Trae/1.0.0 Token-Eyes")
                .json(&json!({ "require_usage": true }))
                .timeout(Duration::from_secs(15))
                .send()
                .await;
            let Ok(response) = response else { continue };
            if response.status() == reqwest::StatusCode::UNAUTHORIZED
                || response.status() == reqwest::StatusCode::FORBIDDEN
            {
                last_error = "TRAE authorization expired; reconnect this account".to_string();
                continue;
            }
            if !response.status().is_success() {
                last_error = format!(
                    "TRAE entitlement service returned HTTP {}",
                    response.status()
                );
                continue;
            }
            let value: Value = response
                .json()
                .await
                .map_err(|_| "TRAE entitlement response was invalid".to_string())?;
            match parse_trae_quota_snapshot(&value, &account_id) {
                Ok(mut quota) => {
                    quota.provider_reported_at = unix_seconds_to_rfc3339(
                        std::time::SystemTime::now()
                            .duration_since(std::time::UNIX_EPOCH)
                            .map(|duration| duration.as_secs() as i64)
                            .unwrap_or(0),
                    );
                    return Ok(quota);
                }
                Err(error) => last_error = error,
            }
        }
    }
    Err(last_error)
}

async fn refresh_access_token(tokens: &StoredTraeTokens) -> Result<StoredTraeTokens, String> {
    if tokens.refresh_token.trim().is_empty() {
        return Err("TRAE authorization expired; reconnect this account".to_string());
    }
    let client = reqwest::Client::new();
    let body = json!({
        "ClientID": CLIENT_ID,
        "RefreshToken": tokens.refresh_token,
        "ClientSecret": "-",
        "UserID": "",
    });
    for root in exchange_roots(Some(&tokens.login_host)) {
        let mut request = client
            .post(format!("{root}{REFRESH_TOKEN_EXCHANGE_PATH}"))
            .header("Accept", "application/json")
            .header("Content-Type", "application/json")
            .json(&body)
            .timeout(Duration::from_secs(20));
        if !tokens.cloudide_token.is_empty() {
            request = request.header("x-cloudide-token", &tokens.cloudide_token);
        }
        let Ok(response) = request.send().await else {
            continue;
        };
        if !response.status().is_success() {
            continue;
        }
        let Ok(value) = response.json::<Value>().await else {
            continue;
        };
        if let Some(access_token) = recursive_string(
            &value,
            &[
                "AccessToken",
                "access_token",
                "accessToken",
                "Token",
                "token",
            ],
        ) {
            return Ok(StoredTraeTokens {
                access_token,
                refresh_token: recursive_string(
                    &value,
                    &["RefreshToken", "refresh_token", "refreshToken"],
                )
                .unwrap_or_else(|| tokens.refresh_token.clone()),
                login_host: tokens.login_host.clone(),
                cloudide_token: tokens.cloudide_token.clone(),
                account_id: extract_account_id(&value)
                    .unwrap_or_else(|| tokens.account_id.clone()),
            });
        }
    }
    Err("TRAE refresh-token exchange failed; reconnect this account".to_string())
}

async fn fetch_quota_resilient(
    dir: &Path,
    tokens: &mut StoredTraeTokens,
) -> Result<TraeQuota, String> {
    match fetch_quota(tokens).await {
        Ok(quota) => Ok(quota),
        Err(error) if error.contains("expired") && !tokens.refresh_token.is_empty() => {
            *tokens = refresh_access_token(tokens).await?;
            save_tokens(dir, tokens)?;
            fetch_quota(tokens).await
        }
        Err(error) => Err(error),
    }
}

#[tauri::command]
pub async fn open_trae_console_login(
    app: AppHandle,
    state: State<'_, Mutex<TraeSessionState>>,
    session_ref: String,
) -> Result<TraeSessionStatus, String> {
    let _dir = account_dir(&app, &session_ref)?;
    let trace_id = random_urlsafe(24);
    let login_host = resolve_login_guidance_host(&trace_id).await;
    let (pending, auth_url) = start_listener(&login_host, trace_id)?;
    state
        .lock()
        .map_err(|_| "TRAE session state is unavailable".to_string())?
        .pending
        .insert(session_ref.clone(), pending);
    app.opener()
        .open_url(auth_url, None::<&str>)
        .map_err(|_| "Unable to open the TRAE authorization page".to_string())?;
    Ok(status(&session_ref, "login_started"))
}

#[tauri::command]
pub async fn verify_trae_console_session(
    app: AppHandle,
    state: State<'_, Mutex<TraeSessionState>>,
    session_ref: String,
) -> Result<TraeSessionStatus, String> {
    let dir = account_dir(&app, &session_ref)?;
    let has_pending = state
        .lock()
        .map_err(|_| "TRAE session state is unavailable".to_string())?
        .pending
        .contains_key(&session_ref);
    if !has_pending {
        if let Ok(mut tokens) = load_tokens(&dir) {
            // Auth file exists ≠ sync success. Quota must parse with real fields.
            return Ok(match fetch_quota_resilient(&dir, &mut tokens).await {
                Ok(quota) => {
                    if tokens.account_id.trim().is_empty() && !quota.account_id.is_empty() {
                        tokens.account_id = quota.account_id.clone();
                        let _ = save_tokens(&dir, &tokens);
                    }
                    TraeSessionStatus {
                        quota: Some(quota),
                        ..status(&session_ref, "connected")
                    }
                }
                Err(message) => sync_failed(&session_ref, "TRAE_QUOTA_FAILED", message),
            });
        }
    }
    let callback = {
        let guard = state
            .lock()
            .map_err(|_| "TRAE session state is unavailable".to_string())?;
        let Some(pending) = guard.pending.get(&session_ref) else {
            return Ok(status(&session_ref, "session_not_found"));
        };
        let receiver = pending
            .receiver
            .lock()
            .map_err(|_| "TRAE OAuth callback state is unavailable".to_string())?;
        match receiver.try_recv() {
            Ok(result) => Some(result?),
            Err(TryRecvError::Empty) => None,
            Err(TryRecvError::Disconnected) => {
                return Ok(failed(
                    &session_ref,
                    "CALLBACK_CLOSED",
                    "TRAE OAuth callback listener stopped",
                ))
            }
        }
    };
    let Some(callback) = callback else {
        return Ok(status(&session_ref, "awaiting_verification"));
    };
    let pending = state
        .lock()
        .map_err(|_| "TRAE session state is unavailable".to_string())?
        .pending
        .remove(&session_ref)
        .ok_or_else(|| "TRAE OAuth session disappeared".to_string())?;
    let mut tokens = exchange_tokens(&pending, callback).await?;
    if let Some(account_id) = fetch_account_id(&tokens).await {
        tokens.account_id = account_id;
    }
    save_tokens(&dir, &tokens)?;
    Ok(match fetch_quota_resilient(&dir, &mut tokens).await {
        Ok(quota) => {
            if tokens.account_id.trim().is_empty() && !quota.account_id.is_empty() {
                tokens.account_id = quota.account_id.clone();
                let _ = save_tokens(&dir, &tokens);
            }
            TraeSessionStatus {
                quota: Some(quota),
                ..status(&session_ref, "connected")
            }
        }
        // Tokens saved, but entitlement missing critical fields → sync_failed, not connected.
        Err(message) => sync_failed(&session_ref, "TRAE_QUOTA_FAILED", message),
    })
}

#[tauri::command]
pub async fn sync_trae_console_quota(
    app: AppHandle,
    session_ref: String,
) -> Result<TraeSessionStatus, String> {
    let dir = account_dir(&app, &session_ref)?;
    let mut tokens = match load_tokens(&dir) {
        Ok(tokens) => tokens,
        Err(message) => return Ok(failed(&session_ref, "TRAE_AUTH_MISSING", message)),
    };
    Ok(match fetch_quota_resilient(&dir, &mut tokens).await {
        Ok(quota) => {
            if tokens.account_id.trim().is_empty() && !quota.account_id.is_empty() {
                tokens.account_id = quota.account_id.clone();
                let _ = save_tokens(&dir, &tokens);
            }
            TraeSessionStatus {
                quota: Some(quota),
                ..status(&session_ref, "connected")
            }
        }
        Err(message) => sync_failed(&session_ref, "TRAE_QUOTA_FAILED", message),
    })
}

#[tauri::command]
pub fn delete_trae_console_session(
    app: AppHandle,
    state: State<'_, Mutex<TraeSessionState>>,
    session_ref: String,
) -> Result<(), String> {
    let dir = account_dir(&app, &session_ref)?;
    state
        .lock()
        .map_err(|_| "TRAE session state is unavailable".to_string())?
        .pending
        .remove(&session_ref);
    if dir.exists() {
        fs::remove_dir_all(dir)
            .map_err(|_| "Unable to delete the TRAE account binding".to_string())?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_credentials_as_session_references() {
        assert!(session_suffix("token-plan/trae/session/account-a").is_ok());
        assert!(session_suffix("token-plan/trae/session/").is_err());
        assert!(session_suffix("Bearer secret").is_err());
    }

    fn load_fixture(name: &str) -> Value {
        let path = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("tests/fixtures/trae")
            .join(name);
        let raw = std::fs::read_to_string(&path)
            .unwrap_or_else(|error| panic!("read fixture {}: {error}", path.display()));
        serde_json::from_str(&raw)
            .unwrap_or_else(|error| panic!("parse fixture {}: {error}", path.display()))
    }

    #[test]
    fn parses_cn_fast_request_quota_fixture_with_plan_remaining_and_reset() {
        let value = load_fixture("quota.json");
        let quota = parse_trae_quota_snapshot(&value, "").expect("quota");
        assert_eq!(quota.account_id, "4267669818716825");
        assert_eq!(quota.plan_name, "速通 Pro");
        assert_eq!(quota.total_quota, 100.0);
        assert_eq!(quota.used_quota, 25.0);
        assert_eq!(quota.remaining_quota, 75.0);
        assert!((quota.quota_windows[0].percentage - 25.0).abs() < f64::EPSILON);
        // Cockpit: resetAt = entitlement_base_info.end_time + 1
        assert_eq!(quota.quota_windows[0].resets_at, "2026-07-31T16:03:00Z");
        assert_eq!(quota.quota_windows[0].kind, "fast_request");
    }

    #[test]
    fn rejects_payloads_without_provider_quota() {
        assert!(normalize_quota(&json!({ "data": { "status": "ok" } })).is_err());
        assert!(parse_trae_quota_snapshot(
            &json!({
                "code": 0,
                "user_entitlement_pack_list": [{
                    "status": 1,
                    "display_desc": "速通 Pro",
                    "entitlement_base_info": {
                        "product_type": 100,
                        "end_time": 1785513779,
                        "quota": {}
                    },
                    "usage": {}
                }]
            }),
            "4267669818716825"
        )
        .is_err());
    }

    #[test]
    fn missing_account_id_is_parse_failure_not_connected_zero() {
        let mut value = load_fixture("quota.json");
        if let Some(map) = value.as_object_mut() {
            map.remove("user_id");
            map.remove("_fixture");
        }
        let err = parse_trae_quota_snapshot(&value, "").expect_err("missing account");
        assert!(err.contains("account_id"));
    }

    #[test]
    fn extracts_nested_login_guidance_host() {
        let value = load_fixture("login-guidance.json");
        assert_eq!(
            extract_login_guidance_host(&value).as_deref(),
            Some("https://www.trae.cn")
        );
    }

    #[test]
    fn sync_failed_is_authorized_but_not_connected() {
        let status = sync_failed("token-plan/trae/session/a", "TRAE_QUOTA_FAILED", "missing");
        assert!(!status.connected);
        assert!(status.authorized);
        assert_eq!(status.state_code, "sync_failed");
        assert!(status.quota.is_none());
    }

    #[test]
    fn guidance_fallbacks_prefer_current_public_routes() {
        assert_eq!(
            LOGIN_GUIDANCE_ENDPOINTS.first().copied(),
            Some("https://api.trae.cn/cloudide/api/v3/trae/GetLoginGuidance")
        );
        assert!(LOGIN_GUIDANCE_ENDPOINTS
            .iter()
            .any(|endpoint| endpoint.contains("api.trae.com.cn/cloudide/api/v3/trae")));
        assert!(LOGIN_GUIDANCE_ENDPOINTS
            .iter()
            .all(|endpoint| endpoint.contains("/cloudide/api/v3/trae/")));
    }

    #[test]
    fn quota_lookup_prefers_cn_v2_and_keeps_official_fallbacks() {
        assert_eq!(QUOTA_PATHS[0], "/trae/api/v2/pay/ide_user_ent_usage");
        assert!(QUOTA_PATHS.contains(&"/trae/api/v1/pay/ide_user_ent_usage"));
        assert!(QUOTA_PATHS.contains(&"/trae/api/v2/pay/user_current_entitlement_list"));
    }

    #[test]
    fn accepts_auth_code_info_callback_without_state() {
        let callback = callback_from_target(
            "/authorize?authCodeInfo=%7B%22Result%22%3A%7B%22AuthCode%22%3A%22abc-123%22%7D%7D&loginHost=https%3A%2F%2Fapi.trae.cn",
        )
        .expect("callback");
        assert_eq!(callback.auth_code.as_deref(), Some("abc-123"));
        assert!(callback.refresh_token.is_none());
        assert!(callback.state.is_none());
        assert_eq!(callback.login_host.as_deref(), Some("https://api.trae.cn"));
    }

    #[test]
    fn accepts_refresh_token_callback_without_auth_code() {
        let callback =
            callback_from_target("/authorize?refreshToken=refresh-123&cloudideToken=cloud-123")
                .expect("callback");
        assert_eq!(callback.refresh_token.as_deref(), Some("refresh-123"));
        assert_eq!(callback.cloudide_token.as_deref(), Some("cloud-123"));
        assert!(callback.auth_code.is_none());
    }

    #[test]
    fn builds_authorization_url_from_guidance_host_with_official_client_fields() {
        let url = build_authorization_url(
            "https://www.trae.cn",
            "http://127.0.0.1:1455/authorize",
            "trace-1",
            "challenge-1",
        )
        .expect("url");
        assert_eq!(url.host_str(), Some("www.trae.cn"));
        assert_eq!(url.path(), "/authorization");
        let params = url
            .query_pairs()
            .collect::<std::collections::HashMap<_, _>>();
        assert_eq!(
            params.get("auth_from").map(|value| value.as_ref()),
            Some("trae")
        );
        assert_eq!(
            params.get("login_version").map(|value| value.as_ref()),
            Some("1")
        );
        assert_eq!(
            params.get("x_app_version").map(|value| value.as_ref()),
            Some("3.5.66")
        );
        assert_eq!(
            params.get("auth_callback_url").map(|value| value.as_ref()),
            Some("http://127.0.0.1:1455/authorize")
        );
        assert!(!params.contains_key("response_type"));
        assert!(!params.contains_key("state"));
    }

    #[test]
    fn browser_auth_url_uses_www_even_when_guidance_host_is_api() {
        // GetLoginGuidance is served from api.trae.cn, but Cockpit's successful
        // browser URL is always https://www.trae.cn/authorization?...
        // Blindly rewriting the API host path must not produce api.trae.cn/authorization.
        let url = build_authorization_url(
            "https://api.trae.cn",
            "http://127.0.0.1:1455/authorize",
            "trace-api-host",
            "challenge-api-host",
        )
        .expect("url");
        assert_eq!(url.host_str(), Some("www.trae.cn"));
        assert_eq!(url.path(), "/authorization");
        assert!(url
            .query_pairs()
            .any(|(key, value)| key == "login_version" && value == "1"));
        assert!(url
            .query_pairs()
            .any(|(key, value)| key == "auth_from" && value == "trae"));
        assert!(url
            .query_pairs()
            .any(|(key, value)| key == "auth_type" && value == "local"));
        assert!(url
            .query_pairs()
            .any(|(key, value)| key == "code_challenge_method" && value == "S256"));
    }

    #[test]
    fn exchange_routes_match_official_native_client_protocol() {
        assert_eq!(AUTH_CODE_EXCHANGE_PATH, "/trae/api/v3/oauth/ExchangeToken");
        assert_eq!(
            REFRESH_TOKEN_EXCHANGE_PATH,
            "/cloudide/api/v3/trae/oauth/ExchangeToken"
        );
    }
}
