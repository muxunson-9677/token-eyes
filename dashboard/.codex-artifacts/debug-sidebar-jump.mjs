import { chromium } from "playwright";

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1220, height: 912 } });

function compact(samples) {
  return samples.filter((sample, index) => {
    const previous = samples[index - 1];
    return !previous || JSON.stringify(sample) !== JSON.stringify(previous);
  });
}

try {
  await page.goto("http://127.0.0.1:5173/leaderboard?native_windows_preview=1", {
    waitUntil: "networkidle",
  });
  await page.locator(".tt-desktop-sidebar").waitFor({ state: "visible" });

  const readLayout = () => page.evaluate(() => {
    const aside = document.querySelector(".tt-desktop-sidebar");
    const nav = aside?.querySelector("nav");
    const firstItem = nav?.querySelector(".tt-sidebar-item");
    const bottom = aside?.lastElementChild;
    const rect = (element) => {
      if (!element) return null;
      const box = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return {
        x: box.x,
        y: box.y,
        width: box.width,
        height: box.height,
        paddingLeft: style.paddingLeft,
        paddingRight: style.paddingRight,
        gap: style.gap,
        fontSize: style.fontSize,
      };
    };
    return {
      route: location.pathname,
      aside: rect(aside),
      nav: rect(nav),
      firstItem: rect(firstItem),
      bottom: rect(bottom),
    };
  });

  async function traceClick(route) {
    const samples = [];
    await page.locator(`.tt-desktop-sidebar a[href="${route}"]`).first().click();
    for (let frame = 0; frame < 45; frame += 1) {
      samples.push(await readLayout());
      await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(resolve)));
    }
    return compact(samples);
  }

  const initial = await readLayout();
  const toDashboard = await traceClick("/dashboard");
  const toLeaderboard = await traceClick("/leaderboard");
  console.log(JSON.stringify({ initial, toDashboard, toLeaderboard }, null, 2));
} finally {
  await browser.close();
}
