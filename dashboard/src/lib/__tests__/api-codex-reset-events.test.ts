import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  acknowledgeCodexResetEvent,
  checkCodexResetEvents,
  getCodexResetEvents,
  markCodexResetEventDelivered,
} from "../api";
import { clearLocalApiAuthToken } from "../local-api-auth";
import { resetLocalApiOriginForTests } from "../local-api-url";

const ORIGIN = "http://127.0.0.1:17680";

describe("Codex reset local API client", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    clearLocalApiAuthToken();
    resetLocalApiOriginForTests();
    Object.defineProperty(window, "__TAURI__", {
      configurable: true,
      value: {
        core: {
          invoke: vi.fn().mockResolvedValue({ running: true, url: ORIGIN }),
        },
      },
    });
  });

  it("reads events and authenticates acknowledgement and manual checks", async () => {
    const payload = {
      ok: true,
      status: {
        enabled: true,
        configured: true,
        running: false,
        last_checked_at: "2026-07-20T08:00:00.000Z",
        last_successful_at: "2026-07-20T08:00:00.000Z",
        next_check_at: "2026-07-20T08:10:00.000Z",
        last_error_code: null,
        failure_count: 0,
        unread_count: 1,
        feed_enabled: true,
        feed_last_checked_at: "2026-07-20T08:00:00.000Z",
        feed_error_code: null,
      },
      events: [{
        id: "official:reset",
        type: "official_reset_announcement",
        window: null,
        created_at: "2026-07-20T08:00:00.000Z",
        reset_at: null,
        official_url: "https://chatgpt.com/codex",
        source_url: "https://x.com/thsottiaux/status/2078990367241046272",
        source_author: "thsottiaux",
        source_post_id: "2078990367241046272",
        title: "Codex 重置活动",
        summary: "请前往官方页面确认。",
        expires_at: "2026-08-20T08:00:00.000Z",
        source: "signed_feed",
      }],
    };
    const fetchMock = vi.fn(async (url: string | URL | Request) => {
      const target = String(url);
      const body = target.endsWith("/api/local-auth")
        ? { token: "local-token" }
        : payload;
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(getCodexResetEvents()).resolves.toEqual(payload);
    await acknowledgeCodexResetEvent("official:reset");
    await markCodexResetEventDelivered("official:reset", "windows_notification");
    await expect(checkCodexResetEvents(true)).resolves.toEqual(payload);

    expect(fetchMock).toHaveBeenCalledWith(
      `${ORIGIN}/functions/tokentracker-codex-reset-events`,
      expect.objectContaining({ cache: "no-store" }),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      `${ORIGIN}/functions/tokentracker-codex-reset-events/ack`,
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "x-tokentracker-local-auth": "local-token",
        }),
        body: JSON.stringify({ event_id: "official:reset" }),
      }),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      `${ORIGIN}/functions/tokentracker-codex-reset-events/delivered`,
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "x-tokentracker-local-auth": "local-token",
        }),
        body: JSON.stringify({
          event_id: "official:reset",
          channel: "windows_notification",
        }),
      }),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      `${ORIGIN}/functions/tokentracker-codex-reset-events/check`,
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ force: true }),
      }),
    );
  });
});
