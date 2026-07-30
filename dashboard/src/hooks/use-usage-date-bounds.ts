import { useEffect, useState } from "react";
import { getUsageBounds } from "../lib/api";

type UsageDateBounds = {
  from: string | null;
  to: string | null;
  loading: boolean;
};

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function getCacheKey(timeZone?: string, tzOffsetMinutes?: number) {
  return `token-eyes:usage-date-bounds:v1:${timeZone || "local"}:${tzOffsetMinutes ?? "auto"}`;
}

function readCachedBounds(timeZone?: string, tzOffsetMinutes?: number): UsageDateBounds | null {
  if (typeof window === "undefined") return null;
  try {
    const parsed = JSON.parse(
      window.localStorage.getItem(getCacheKey(timeZone, tzOffsetMinutes)) || "null",
    );
    if (!DATE_PATTERN.test(parsed?.from || "") || !DATE_PATTERN.test(parsed?.to || "")) {
      return null;
    }
    return { from: parsed.from, to: parsed.to, loading: false };
  } catch {
    return null;
  }
}

function writeCachedBounds(
  timeZone: string | undefined,
  tzOffsetMinutes: number | undefined,
  from: string,
  to: string,
) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      getCacheKey(timeZone, tzOffsetMinutes),
      JSON.stringify({ from, to }),
    );
  } catch {
    // A fresh native response still renders when browser storage is unavailable.
  }
}

export function useUsageDateBounds({
  timeZone,
  tzOffsetMinutes,
}: {
  timeZone?: string;
  tzOffsetMinutes?: number;
} = {}): UsageDateBounds {
  const [state, setState] = useState<UsageDateBounds>(() => (
    readCachedBounds(timeZone, tzOffsetMinutes) || {
      from: null,
      to: null,
      loading: true,
    }
  ));

  useEffect(() => {
    let active = true;
    const cached = readCachedBounds(timeZone, tzOffsetMinutes);
    if (cached) setState(cached);
    getUsageBounds({ timeZone, tzOffsetMinutes })
      .then((result) => {
        if (!active) return;
        const from = typeof result?.from === "string" && DATE_PATTERN.test(result.from)
          ? result.from
          : null;
        const to = typeof result?.to === "string" && DATE_PATTERN.test(result.to)
          ? result.to
          : null;
        if (from && to) writeCachedBounds(timeZone, tzOffsetMinutes, from, to);
        setState({
          from,
          to,
          loading: false,
        });
      })
      .catch(() => {
        if (active && !cached) setState({ from: null, to: null, loading: false });
      });
    return () => {
      active = false;
    };
  }, [timeZone, tzOffsetMinutes]);

  return state;
}
