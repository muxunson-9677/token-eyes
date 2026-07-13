import { useEffect, useState } from "react";
import { getTokenPlans } from "../lib/api";

export function useTokenServicePlans(refreshRevision = 0) {
  const [state, setState] = useState({ plans: [], loading: true, error: null });

  useEffect(() => {
    let cancelled = false;
    setState((current) => ({ ...current, loading: true, error: null }));

    getTokenPlans()
      .then((result) => {
        if (cancelled) return;
        setState({
          plans: Array.isArray(result?.records) ? result.records : [],
          loading: false,
          error: null,
        });
      })
      .catch((error) => {
        if (cancelled) return;
        console.error("[SpendUsagePage] Failed to load Token services:", error);
        setState((current) => ({ ...current, loading: false, error }));
      });

    return () => { cancelled = true; };
  }, [refreshRevision]);

  return state;
}
