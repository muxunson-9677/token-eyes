import { chromium } from "playwright";

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 900, height: 600 } });
  await page.addInitScript(() => {
    localStorage.setItem("theme", "light");
    localStorage.setItem("tt.theme", "light");
  });
  await page.goto("http://127.0.0.1:5173/reset-history?native_windows_preview=1", {
    waitUntil: "domcontentloaded",
  });
  await page.waitForTimeout(1_800);
  await page.evaluate(() => {
    window.scrollTo(0, 0);
    for (const element of document.querySelectorAll("*")) {
      if (element.scrollTop) element.scrollTop = 0;
      if (element.scrollLeft) element.scrollLeft = 0;
    }
  });
  await page.screenshot({ path: ".codex-artifacts/ui-repair-baseline/minimum-light-reset-final.png" });
  await page.locator("[data-testid='reset-history-activity']").screenshot({
    path: ".codex-artifacts/ui-repair-baseline/minimum-light-reset-activity-final.png",
  });
} finally {
  await browser.close();
}
