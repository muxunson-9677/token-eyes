#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_only_official_https_auth_urls() {
        assert!(validate_auth_url(
            "https://chatgpt.com/auth/authorize?client_id=token-eyes-test"
        ));
        assert!(!validate_auth_url(
            "https://chatgpt.com.evil.example/auth/authorize"
        ));
        assert!(!validate_auth_url("http://chatgpt.com/auth/authorize"));
    }

    #[test]
    fn parses_matching_login_completion_notification() {
        let message = serde_json::json!({
            "method": "account/login/completed",
            "params": { "loginId": "login-1", "success": true }
        });
        assert_eq!(
            parse_login_completed(&message, "login-1"),
            LoginCompletion::Succeeded
        );
    }

    #[test]
    fn parses_sanitized_rate_limit_windows() {
        let message = serde_json::json!({
            "id": 7,
            "result": {
                "rateLimits": {
                    "primary": {
                        "usedPercent": 25.5,
                        "windowDurationMins": 300,
                        "resetsAt": 1783900800
                    },
                    "secondary": {
                        "usedPercent": 50,
                        "windowDurationMins": 10080,
                        "resetsAt": 1784505600
                    }
                }
            }
        });
        let quota = parse_rate_limits_response(&message).expect("rate limits should parse");
        assert_eq!(quota.windows.len(), 2);
        assert_eq!(quota.windows[0].kind, "rolling_5_hour");
        assert_eq!(quota.windows[0].used_percent, 25.5);
        assert_eq!(quota.windows[1].kind, "rolling_weekly");
    }
}
