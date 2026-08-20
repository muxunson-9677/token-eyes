const fs = require("node:fs");
const readline = require("node:readline");

const tracePath = String(process.env.TOKEN_EYES_CODEX_APP_SERVER_TRACE || "").trim();

function trace(method) {
  if (!tracePath || !method) return;
  fs.appendFileSync(tracePath, `${method}\n`, "utf8");
}

function respond(id, result) {
  process.stdout.write(`${JSON.stringify({ id, result })}\n`);
}

const input = readline.createInterface({ input: process.stdin });
input.on("line", (line) => {
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    return;
  }
  const method = String(message?.method || "");
  trace(method);
  if (!Object.prototype.hasOwnProperty.call(message, "id")) return;

  if (method === "initialize" || method === "account/login/cancel") {
    respond(message.id, {});
    return;
  }
  if (method === "account/read") {
    respond(message.id, { account: { type: "chatgpt" } });
    return;
  }
  if (method === "account/login/start") {
    respond(message.id, {
      loginId: "ui-acceptance-login",
      authUrl: "https://auth.openai.com/authorize",
    });
    return;
  }
  if (method === "account/rateLimits/read") {
    process.stdout.write(`${JSON.stringify({
      id: message.id,
      error: { code: -32001, message: "synthetic quota unavailable" },
    })}\n`);
    return;
  }
  respond(message.id, {});
});
