import {
  clearLocalApiAuthToken,
  getLocalApiAuthHeaders,
} from "./local-api-auth";
import { buildLocalApiUrl, isTauriRuntime } from "./local-api-url";

const LOCAL_AUTH_REQUIRED_HEADER = "x-tokentracker-local-auth-required";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function resolveLocalInput(input: RequestInfo | URL): Promise<RequestInfo | URL> {
  if (
    typeof input === "string"
    && input.startsWith("/")
    && isTauriRuntime()
  ) {
    return buildLocalApiUrl(input);
  }
  return input;
}

export async function fetchAuthenticatedLocalApi(
  input: RequestInfo | URL,
  init: RequestInit = {},
): Promise<Response> {
  const resolvedInput = await resolveLocalInput(input);
  const requestTemplate = resolvedInput instanceof Request
    ? resolvedInput.clone()
    : null;
  const headers = new Headers(requestTemplate?.headers);
  new Headers(init.headers).forEach((value, name) => headers.set(name, value));

  const method = String(requestTemplate?.method || init.method || "GET").toUpperCase();
  const canRetryTransport = method === "GET" || method === "HEAD";
  const send = async (authHeaders: Record<string, string>): Promise<Response> => {
    for (const [name, value] of Object.entries(authHeaders)) {
      headers.set(name, value);
    }
    const attempts = isTauriRuntime() && canRetryTransport ? 10 : 1;
    let lastError: unknown = null;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      try {
        if (requestTemplate) {
          return await fetch(new Request(requestTemplate.clone(), {
            ...init,
            headers,
          }));
        }
        return await fetch(resolvedInput, { ...init, headers });
      } catch (error) {
        lastError = error;
        if (attempt < attempts - 1) await sleep(250);
      }
    }
    throw lastError;
  };

  const response = await send(await getLocalApiAuthHeaders());
  if (
    response.status !== 401
    || response.headers.get(LOCAL_AUTH_REQUIRED_HEADER) !== "1"
  ) {
    return response;
  }

  clearLocalApiAuthToken();
  return send(await getLocalApiAuthHeaders());
}
