const mockParams = "mock=1&mock_seed=baseline&mock_today=2025-12-31&mock_now=2025-12-31T12:00:00Z";
const landingParams = "screenshot=1";
const dashboardReadySelector = '[data-testid="dashboard-primary-workspace"]';
const usageReadySelector = '[data-testid="usage-chart-token-services-layout"]:has([data-testid="usage-trend-plot"]):has([data-testid="token-service-cards"])';

export function createScreenshotThemeSetup(targetUrl) {
  let theme;
  try {
    theme = new URL(targetUrl).searchParams.get("theme");
  } catch {
    return null;
  }

  if (theme !== "light" && theme !== "dark") return null;
  return {
    colorScheme: theme,
    localStorageTheme: theme,
  };
}

export function createBaselineJobs(baseUrl) {
  return [
    {
      name: "dashboard-desktop",
      url: `${baseUrl}/?screenshot=1&${mockParams}`,
      width: 1512,
      height: 997,
      dpr: 2,
      readySelector: dashboardReadySelector,
    },
    {
      name: "dashboard-mobile",
      url: `${baseUrl}/?screenshot=1&${mockParams}`,
      width: 390,
      height: 844,
      dpr: 2,
      readySelector: dashboardReadySelector,
    },
    {
      name: "spend-usage-light-1180",
      url: `${baseUrl}/spend/usage?screenshot=1&theme=light&${mockParams}`,
      width: 1180,
      height: 760,
      dpr: 1,
      readySelector: usageReadySelector,
    },
    {
      name: "spend-usage-dark-1180",
      url: `${baseUrl}/spend/usage?screenshot=1&theme=dark&${mockParams}`,
      width: 1180,
      height: 760,
      dpr: 1,
      readySelector: usageReadySelector,
    },
    {
      name: "spend-usage-narrow-390",
      url: `${baseUrl}/spend/usage?screenshot=1&theme=light&${mockParams}`,
      width: 390,
      height: 844,
      dpr: 2,
      readySelector: usageReadySelector,
    },
    {
      name: "landing-desktop",
      url: `${baseUrl}/landing?${landingParams}`,
      width: 1440,
      height: 900,
      dpr: 2,
      readySelector: '[data-testid="marketing-landing"]',
    },
  ];
}
