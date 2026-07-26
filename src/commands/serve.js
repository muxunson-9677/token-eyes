const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const fssync = require("node:fs");

const { resolveTrackerPaths } = require("../lib/tracker-paths");
const {
  createLocalApiHandler,
  resolveQueuePath,
  validateLocalApiRequest,
} = require("../lib/local-api");
const { ensurePricingLoaded } = require("../lib/pricing");
const { serveStaticFile } = require("../lib/static-server");
const { openInBrowser } = require("../lib/browser-auth");

const DEFAULT_PORT = 7680;
const DEFAULT_MAX_PORT_ATTEMPTS = 20;
const NPM_PACKAGE_NAME = "tokentracker-cli";
const LOCAL_BIND_HOST = "127.0.0.1";

function buildPortInUseHint(port) {
  return `Port ${port} is already in use. Try: npx ${NPM_PACKAGE_NAME} serve --port ${port + 1}\n`;
}

function isPortUnavailableError(error) {
  return error?.code === "EADDRINUSE" || error?.code === "EACCES" || error?.code === "EPERM";
}

function getLocalServerUrl(port) {
  return `http://${LOCAL_BIND_HOST}:${port}`;
}

function createServeRequestListener({
  handleApi,
  dashboardDir,
  getPort,
  serveStaticFileFn = serveStaticFile,
} = {}) {
  return async function serveRequestListener(req, res) {
    try {
      const port = getPort();
      const requestSecurity = validateLocalApiRequest(req, {
        listeningPort: port,
        bindHost: LOCAL_BIND_HOST,
      });
      if (!requestSecurity.ok) {
        res.writeHead(403, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Forbidden" }));
        return;
      }
      const url = new URL(req.url || "/", getLocalServerUrl(port));

      const isApiPath = (
        url.pathname.startsWith("/functions/")
        || url.pathname.startsWith("/api/")
        || url.pathname.startsWith("/proxy/")
      );
      if (req.method === "OPTIONS" && !isApiPath) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Not Found" }));
        return;
      }

      if (isApiPath) {
        const handled = await handleApi(req, res, url);
        if (handled) return;
        res.writeHead(404, {
          "Content-Type": "application/json",
          ...requestSecurity.corsHeaders,
        });
        res.end(JSON.stringify({ error: "Not Found" }));
        return;
      }

      const served = await serveStaticFileFn(dashboardDir, url.pathname, res);
      if (served) return;
      await serveStaticFileFn(dashboardDir, "/index.html", res);
    } catch (error) {
      if (!res.headersSent) {
        res.writeHead(500, { "Content-Type": "text/plain" });
        res.end("Internal Server Error");
      } else if (!res.writableEnded) {
        if (typeof res.destroy === "function") res.destroy(error);
        else res.end();
      }
    }
  };
}

async function cmdServe(argv) {
  const opts = parseArgs(argv);

  // 0. First-time setup: if tracker dir doesn't exist, run init first
  const { trackerDir } = await resolveTrackerPaths();
  if (!fssync.existsSync(path.join(trackerDir, "cursors.json"))) {
    process.stdout.write("First time? Setting up Token Tracker...\n\n");
    try {
      const { cmdInit } = require("./init");
      await cmdInit(["--yes"]);
    } catch (e) {
      process.stdout.write(`Init warning: ${e?.message || e}\n`);
    }
  }

  try {
    const { installLocalTrackerApp } = require("./init");
    await installLocalTrackerApp({ appDir: path.join(trackerDir, "app") });
  } catch (e) {
    process.stdout.write(`Runtime refresh warning: ${e?.message || e}\n`);
  }

  // 1. Optional sync
  if (opts.sync) {
    process.stdout.write("Syncing local data...\n");
    try {
      const { cmdSync } = require("./sync");
      await cmdSync(["--auto"]);
      process.stdout.write("Sync done.\n");
    } catch (e) {
      process.stdout.write(`Sync warning: ${e?.message || e}\n`);
    }
  }

  // 2. Resolve paths
  const queuePath = resolveQueuePath();
  const dashboardDir = resolveDashboardDir();

  // 2.1 Refresh LiteLLM pricing data in the background. The seed snapshot is
  //     already loaded synchronously at require-time, so cost calculation is
  //     functional right now; ensurePricingLoaded() only upgrades to fresh
  //     disk cache or upstream data. Awaiting it here would block startup
  //     for the full 10s fetch timeout when offline / behind a firewall.
  const { cacheDir } = await resolveTrackerPaths();
  ensurePricingLoaded({ cachePath: path.join(cacheDir, "pricing.json") }).catch(
    (e) => process.stdout.write(`Pricing refresh warning: ${e?.message || e}\n`),
  );

  if (!dashboardDir) {
    process.stderr.write(
      [
        "Dashboard not found.",
        "",
        "If you cloned the repo, run:",
        "  cd dashboard && npm run build",
        "",
        "If you installed via npm, the package may be missing dashboard/dist/.",
        "",
      ].join("\n"),
    );
    process.exitCode = 1;
    return;
  }

  // 3. Create handler. Requests cannot arrive until listen succeeds and
  // updates this value to the actual fallback port.
  let port = opts.port;
  const handleApi = createLocalApiHandler({
    queuePath,
    listeningPort: () => port,
    bindHost: LOCAL_BIND_HOST,
  });

  // 3.1 F03: Token Plan 鑷姩鍒锋柊璋冨害鍣ㄣ€?
  //     鍚姩鏃跺仛涓€娆?due refresh锛堜笉闃诲鐩戝惉锛夛紝鐒跺悗鍚姩鍚庡彴瀹氭椂鍣ㄣ€?
  //     瀹氭椂鍣ㄤ娇鐢?unref锛岃繘绋嬮€€鍑烘椂涓嶄細 hang銆?
  try {
    await handleApi.runTokenPlanDueRefresh();
  } catch (e) {
    process.stdout.write(`Token plan due refresh warning: ${e?.message || e}\n`);
  }
  handleApi.startTokenPlanScheduler();

  const server = http.createServer(createServeRequestListener({
    handleApi,
    dashboardDir,
    getPort: () => port,
  }));

  // 4. Listen. Default startup follows README behavior and picks the next
  // available port; an explicit --port/PORT remains strict.
  try {
    port = await listenOnAvailablePort(server, opts.port, {
      allowFallback: !opts.portExplicit,
      onRetry: (failedPort) => {
        process.stdout.write(`Port ${failedPort} unavailable, trying ${failedPort + 1}...\n`);
      },
    });
  } catch (e) {
    if (isPortUnavailableError(e)) {
      process.stderr.write(buildPortInUseHint(opts.port));
    } else {
      process.stderr.write(`Server error: ${e.message}\n`);
    }
    process.exitCode = 1;
    return;
  }

  {
    const url = getLocalServerUrl(port);
    process.stdout.write(
      [
        "",
        `  tokentracker dashboard running at:`,
        "",
        `    ${url}`,
        "",
        `  Data: ${queuePath}`,
        `  Press Ctrl+C to stop.`,
        "",
      ].join("\n"),
    );

    if (opts.open) {
      openInBrowser(url);
    }
  }

  server.on("error", (e) => {
    process.stderr.write(`Server error: ${e.message}\n`);
    process.exitCode = 1;
  });

  // 5. Graceful shutdown
  const shutdown = () => {
    process.stdout.write("\nShutting down...\n");
    try { handleApi.stopTokenPlanScheduler(); } catch (_e) {}
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 3000);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  // Keep process alive
  await new Promise(() => {});
}

function listenOnce(server, port, host) {
  return new Promise((resolve, reject) => {
    let settled = false;

    const cleanup = () => {
      server.off("listening", onListening);
      server.off("error", onError);
    };
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      cleanup();
      fn(value);
    };
    const onListening = () => finish(resolve);
    const onError = (error) => finish(reject, error);

    server.once("listening", onListening);
    server.once("error", onError);
    try {
      server.listen(port, host);
    } catch (error) {
      finish(reject, error);
    }
  });
}

async function listenOnAvailablePort(
  server,
  startPort,
  {
    host = LOCAL_BIND_HOST,
    allowFallback = false,
    maxAttempts = DEFAULT_MAX_PORT_ATTEMPTS,
    onRetry = null,
  } = {},
) {
  const attempts = allowFallback ? Math.max(1, maxAttempts) : 1;
  let port = startPort;
  let lastError = null;

  for (let i = 0; i < attempts && port < 65536; i++, port++) {
    try {
      await listenOnce(server, port, host);
      return port;
    } catch (error) {
      lastError = error;
      if (!allowFallback || !isPortUnavailableError(error) || port >= 65535) {
        throw error;
      }
      if (typeof onRetry === "function") {
        onRetry(port, error);
      }
    }
  }

  throw lastError || new Error(`No available port found from ${startPort}`);
}

function resolveDashboardDir() {
  const candidates = [
    path.resolve(__dirname, "../../dashboard/dist"),
    path.resolve(__dirname, "../dashboard/dist"),
  ];
  for (const dir of candidates) {
    if (fssync.existsSync(path.join(dir, "index.html"))) return dir;
  }
  return null;
}

function parsePort(value) {
  const n = parseInt(value, 10);
  return Number.isFinite(n) && n > 0 && n < 65536 ? n : null;
}

function parseArgs(argv, env = process.env) {
  const envPort = parsePort(env.PORT);
  const opts = {
    port: envPort || DEFAULT_PORT,
    portExplicit: Boolean(envPort),
    open: true,
    sync: true,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--port" && i + 1 < argv.length) {
      const n = parsePort(argv[++i]);
      if (n) {
        opts.port = n;
        opts.portExplicit = true;
      }
    } else if (arg === "--no-open") {
      opts.open = false;
    } else if (arg === "--no-sync") {
      opts.sync = false;
    }
  }
  return opts;
}

module.exports = {
  cmdServe,
  buildPortInUseHint,
  createServeRequestListener,
  NPM_PACKAGE_NAME,
  LOCAL_BIND_HOST,
  isPortUnavailableError,
  listenOnAvailablePort,
  getLocalServerUrl,
  parseArgs,
};
