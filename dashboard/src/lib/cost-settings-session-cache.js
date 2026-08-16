const sessionCache = new Map();

export function readCostSettingsSessionCache(key) {
  return sessionCache.get(key) ?? null;
}

export function writeCostSettingsSessionCache(key, value) {
  sessionCache.set(key, value);
}

export function clearCostSettingsSessionCache(key) {
  if (key) sessionCache.delete(key);
  else sessionCache.clear();
}
