export function shouldReportAutoRefreshError(error, isMounted) {
  return Boolean(isMounted && error?.name !== "AbortError");
}
