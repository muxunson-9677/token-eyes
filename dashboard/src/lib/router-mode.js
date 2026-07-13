export function shouldUseHashRouter(value) {
  const normalized = String(value ?? "").toLowerCase();
  return normalized === "1" || normalized === "true";
}
