const DEFAULT_PUBLIC_KEY_SPKI_BASE64 =
  "MCowBQYDK2VwAyEAp3URX2TAbzttOKE0YQeu0cjtDvzH9swTfQ+J6x0H+eU=";
const DEFAULT_MAX_PAYLOAD_BYTES = 512 * 1024;
const PRIVATE_ENTRY_FIELDS = new Set(["account_id", "device_id", "email", "user_id"]);

function containsPrivateField(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsPrivateField);
  if (!value || typeof value !== "object") return false;
  return Object.entries(value as Record<string, unknown>).some(([field, child]) => (
    PRIVATE_ENTRY_FIELDS.has(field.toLowerCase()) || containsPrivateField(child)
  ));
}

type SignedEnvelope = {
  version?: unknown;
  algorithm?: unknown;
  key_id?: unknown;
  payload_b64?: unknown;
  signature_b64?: unknown;
};

type VerifyOptions = {
  publicKeySpkiBase64?: string;
  expectedSchema?: string;
  expectedSnapshotKey?: string;
  nowMs?: number;
  maxEntries?: number;
  maxPayloadBytes?: number;
};

function configuredPublicKeySpkiBase64(): string {
  const configured = typeof import.meta !== "undefined"
    ? String(import.meta.env?.VITE_STATIC_FEED_PUBLIC_KEY_SPKI_BASE64 || "").trim()
    : "";
  return configured || DEFAULT_PUBLIC_KEY_SPKI_BASE64;
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/u, "");
}

function decodeBase64Url(value: unknown, label: string): Uint8Array {
  if (typeof value !== "string" || !value || !/^[A-Za-z0-9_-]+$/u.test(value)) {
    throw new TypeError(`${label} must be canonical Base64URL`);
  }
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  let binary: string;
  try {
    binary = atob(padded);
  } catch {
    throw new TypeError(`${label} must be canonical Base64URL`);
  }
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  if (bytesToBase64Url(bytes) !== value) {
    throw new TypeError(`${label} must be canonical Base64URL`);
  }
  return bytes;
}

function decodeBase64(value: string): Uint8Array {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function ownedArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

function requireExactIso(value: unknown, label: string): number {
  const parsed = typeof value === "string" ? Date.parse(value) : Number.NaN;
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== value) {
    throw new TypeError(`${label} must be an ISO timestamp`);
  }
  return parsed;
}

export async function verifySignedStaticFeedEnvelope(
  envelope: SignedEnvelope,
  {
    publicKeySpkiBase64 = configuredPublicKeySpkiBase64(),
    expectedSchema,
    expectedSnapshotKey,
    nowMs = Date.now(),
    maxEntries,
    maxPayloadBytes = DEFAULT_MAX_PAYLOAD_BYTES,
  }: VerifyOptions = {},
): Promise<Record<string, any>> {
  if (!envelope || typeof envelope !== "object" || Array.isArray(envelope)) {
    throw new TypeError("signed feed envelope must be an object");
  }
  if (envelope.version !== 1 || envelope.algorithm !== "Ed25519") {
    throw new TypeError("unsupported signed feed envelope");
  }
  if (typeof envelope.key_id !== "string" || !/^[a-z0-9][a-z0-9._-]{0,79}$/u.test(envelope.key_id)) {
    throw new TypeError("signed feed key id is invalid");
  }

  const payloadBytes = decodeBase64Url(envelope.payload_b64, "payload_b64");
  const signatureBytes = decodeBase64Url(envelope.signature_b64, "signature_b64");
  if (payloadBytes.byteLength > maxPayloadBytes || signatureBytes.byteLength !== 64) {
    throw new TypeError("signed feed envelope length is invalid");
  }
  const publicKey = await globalThis.crypto.subtle.importKey(
    "spki",
    ownedArrayBuffer(decodeBase64(publicKeySpkiBase64)),
    { name: "Ed25519" },
    false,
    ["verify"],
  );
  const valid = await globalThis.crypto.subtle.verify(
    { name: "Ed25519" },
    publicKey,
    ownedArrayBuffer(signatureBytes),
    ownedArrayBuffer(payloadBytes),
  );
  if (!valid) throw new Error("signed feed signature verification failed");

  let payload: Record<string, any>;
  try {
    payload = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(payloadBytes));
  } catch {
    throw new TypeError("signed feed payload is not valid JSON");
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new TypeError("signed feed payload must be an object");
  }
  if (expectedSchema && payload.schema_version !== expectedSchema) {
    throw new TypeError("signed feed schema does not match");
  }
  if (expectedSnapshotKey && payload.snapshot_key !== expectedSnapshotKey) {
    throw new TypeError("signed feed snapshot key does not match");
  }
  if (requireExactIso(payload.generated_at, "signed feed generated_at") > nowMs + 5 * 60_000) {
    throw new TypeError("signed feed generated_at is in the future");
  }
  if (maxEntries !== undefined) {
    if (!Array.isArray(payload.entries) || payload.entries.length > maxEntries) {
      throw new TypeError("signed feed entry count exceeds the limit");
    }
    for (const entry of payload.entries) {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
        throw new TypeError("signed feed entry must be an object");
      }
      if (containsPrivateField(entry)) {
        throw new TypeError("signed feed entry contains a private identifier");
      }
    }
  }
  return payload;
}
