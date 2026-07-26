#!/usr/bin/env node
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.resolve(__dirname, "../dashboard/package.json"));
const { chromium } = require("playwright");
const htmlPath = path.resolve(__dirname, "../trae-contest-submission/token-eyes-demo.html");

const html = fs.readFileSync(htmlPath, "utf8");
const rootIdx = html.indexOf('id="root"');
const scriptIdx = html.indexOf('<script type="module">');
console.log("root at", rootIdx);
console.log("big script at", scriptIdx, "after root?", scriptIdx > rootIdx);

const fileUrl = `file:///${htmlPath.replace(/\\/g, "/").replace(/ /g, "%20")}`;

function startHttpServer() {
  return new Promise((resolve) => {
    const srv = http.createServer((_req, res) => {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(html);
    });
    srv.listen(0, "127.0.0.1", () => {
      const port = srv.address().port;
      resolve({ srv, url: `http://127.0.0.1:${port}/` });
    });
  });
}

const { srv: server, url: httpUrl } = await startHttpServer();
const browser = await chromium.launch();
const modes = [
  { name: "file", url: fileUrl },
  { name: "http", url: httpUrl },
];

let ok = false;
for (const mode of modes) {
  console.log("\n--- mode:", mode.name, mode.url);
  const page = await browser.newPage();
  await page.setViewportSize({ width: 1400, height: 900 });
  const consoleErrors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err) => consoleErrors.push(String(err)));

  await page.goto(mode.url, { waitUntil: "networkidle", timeout: 60000 });
  await page.waitForTimeout(3000);
  // Navigate to usage stats via sidebar (expand 支出 → 使用统计).
  const spendGroup = page.getByRole("button", { name: /支出/ });
  if (await spendGroup.count()) {
    await spendGroup.first().click();
    await page.waitForTimeout(400);
  }
  const spendUsageLink = page.getByRole("link", { name: "使用统计" });
  if (await spendUsageLink.count()) {
    await spendUsageLink.first().click();
    await page.waitForTimeout(5000);
  }
  await page.screenshot({
    path: path.resolve(__dirname, `../trae-contest-submission/_verify-${mode.name}.png`),
    fullPage: false,
  });

  const splash = await page.locator(".boot-splash").count();
  const dashboardNav = await page.locator("nav, [class*='sidebar'], [class*='Sidebar']").count();
  const bodyText = await page.locator("body").innerText();
  const errorBanner = await page.locator('[style*="background:#7f1d1d"]').count();
  console.log("splash count", splash);
  console.log("nav/sidebar count", dashboardNav);
  console.log("error banners", errorBanner);
  console.log("body preview", bodyText.slice(0, 800).replace(/\s+/g, " "));
  if (consoleErrors.length) console.log("console errors:", consoleErrors.slice(0, 5));

  const pass =
    splash === 0 &&
    errorBanner === 0 &&
    /使用统计/.test(bodyText) &&
    /请求日志|Provider 统计|真实消耗/.test(bodyText) &&
    !/趋势数据加载失败/.test(bodyText) &&
    !/登录/.test(bodyText.slice(0, 120));
  console.log(pass ? "PASS" : "FAIL", "for", mode.name);
  ok = ok || pass;
  await page.close();
}

server.close();
await browser.close();
process.exit(ok ? 0 : 1);
