import { useCallback, useEffect, useState } from "react";
import { getLimitAccounts } from "../lib/api";

export function useLimitAccounts({ initialRefresh = false }: { initialRefresh?: boolean } = {}) {
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const load = useCallback(async (refresh = false) => {
    try {
      const next = await getLimitAccounts({ refresh });
      setData(next && typeof next === "object" ? next : null);
      setError(null);
      return next;
    } catch (err) {
      setError((err as Error)?.message || String(err));
      return null;
    }
  }, []);
  useEffect(() => {
    let cancelled = false;
    load(initialRefresh).finally(() => { if (!cancelled) setIsLoading(false); });
    return () => { cancelled = true; };
  }, [initialRefresh, load]);
  return { data, error, isLoading, refresh: () => load(true) };
}
