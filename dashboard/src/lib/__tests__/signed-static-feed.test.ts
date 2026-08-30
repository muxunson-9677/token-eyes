import { generateKeyPairSync, sign } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

import { verifySignedStaticFeedEnvelope } from "../signed-static-feed";

const NOW = Date.parse("2026-08-30T08:00:00.000Z");

function signedEnvelope(payload: Record<string, unknown>) {
  const keys = generateKeyPairSync("ed25519");
  const payloadBytes = Buffer.from(JSON.stringify(payload), "utf8");
  return {
    publicKeySpkiBase64: keys.publicKey.export({ type: "spki", format: "der" }).toString("base64"),
    envelope: {
      version: 1,
      algorithm: "Ed25519",
      key_id: "token-eyes-static-2026-01",
      payload_b64: payloadBytes.toString("base64url"),
      signature_b64: sign(null, payloadBytes, keys.privateKey).toString("base64url"),
    },
  };
}

function payload(overrides: Record<string, unknown> = {}) {
  return {
    schema_version: "token-eyes.leaderboard-snapshot/v1",
    snapshot_key: "total/tokens/all",
    generated_at: new Date(NOW).toISOString(),
    entries: [{ rank: 1, display_name: "Anonymous", total_tokens: "42" }],
    ...overrides,
  };
}

describe("browser signed static feed verification", () => {
  it("verifies Ed25519 bytes and returns only the requested Top 50 snapshot", async () => {
    const signed = signedEnvelope(payload());

    await expect(verifySignedStaticFeedEnvelope(signed.envelope, {
      publicKeySpkiBase64: signed.publicKeySpkiBase64,
      expectedSchema: "token-eyes.leaderboard-snapshot/v1",
      expectedSnapshotKey: "total/tokens/all",
      nowMs: NOW,
      maxEntries: 50,
    })).resolves.toMatchObject({ snapshot_key: "total/tokens/all" });
  });

  it("uses an explicitly configured staging public key without changing the production default", async () => {
    const signed = signedEnvelope(payload());
    vi.stubEnv("VITE_STATIC_FEED_PUBLIC_KEY_SPKI_BASE64", signed.publicKeySpkiBase64);

    await expect(verifySignedStaticFeedEnvelope(signed.envelope, {
      expectedSchema: "token-eyes.leaderboard-snapshot/v1",
      expectedSnapshotKey: "total/tokens/all",
      nowMs: NOW,
      maxEntries: 50,
    })).resolves.toMatchObject({ snapshot_key: "total/tokens/all" });

    vi.unstubAllEnvs();
  });

  it("rejects tampering, wrong dimensions, oversized lists, and private identifiers", async () => {
    const wrongDimension = signedEnvelope(payload({ snapshot_key: "today/tokens/all" }));
    await expect(verifySignedStaticFeedEnvelope(wrongDimension.envelope, {
      publicKeySpkiBase64: wrongDimension.publicKeySpkiBase64,
      expectedSchema: "token-eyes.leaderboard-snapshot/v1",
      expectedSnapshotKey: "total/tokens/all",
      nowMs: NOW,
      maxEntries: 50,
    })).rejects.toThrow("snapshot key");

    const tampered = signedEnvelope(payload());
    tampered.envelope.payload_b64 = Buffer.from(JSON.stringify(payload({ generated_at: "2026-08-30T08:01:00.000Z" }))).toString("base64url");
    await expect(verifySignedStaticFeedEnvelope(tampered.envelope, {
      publicKeySpkiBase64: tampered.publicKeySpkiBase64,
      expectedSchema: "token-eyes.leaderboard-snapshot/v1",
      expectedSnapshotKey: "total/tokens/all",
      nowMs: NOW,
      maxEntries: 50,
    })).rejects.toThrow("signature");

    const tooMany = signedEnvelope(payload({ entries: Array.from({ length: 51 }, (_, rank) => ({ rank })) }));
    await expect(verifySignedStaticFeedEnvelope(tooMany.envelope, {
      publicKeySpkiBase64: tooMany.publicKeySpkiBase64,
      expectedSchema: "token-eyes.leaderboard-snapshot/v1",
      expectedSnapshotKey: "total/tokens/all",
      nowMs: NOW,
      maxEntries: 50,
    })).rejects.toThrow("entry count");

    const privateEntry = signedEnvelope(payload({
      entries: [{ rank: 1, source_breakdown: [{ user_id: "private" }] }],
    }));
    await expect(verifySignedStaticFeedEnvelope(privateEntry.envelope, {
      publicKeySpkiBase64: privateEntry.publicKeySpkiBase64,
      expectedSchema: "token-eyes.leaderboard-snapshot/v1",
      expectedSnapshotKey: "total/tokens/all",
      nowMs: NOW,
      maxEntries: 50,
    })).rejects.toThrow("private identifier");
  });
});
