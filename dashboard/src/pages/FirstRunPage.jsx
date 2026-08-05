import React, { useCallback, useEffect, useMemo, useState } from "react";
import { CheckCircle2, CircleAlert, Database, RefreshCw, ShieldCheck } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import {
  detectLocalDataDirectories,
  getLocalSettings,
  setLocalSettings,
  triggerLocalSync,
} from "../lib/api";
import { copy } from "../lib/copy";

export const FIRST_RUN_COMPLETED_KEY = "tokentracker.firstRun.completed.v1";

const SOURCES = ["claude", "codex", "cursor", "trae", "codebuddy", "gemini", "hermes", "openclaw", "opencode", "antigravity"];

function mergeDirectories(current, detected) {
  const saved = current && typeof current === "object" ? current : {};
  const found = detected && typeof detected === "object" ? detected : {};
  return Object.fromEntries(SOURCES.map((source) => [source, found[source] || saved[source] || ""]));
}

function normalizeSourceState(result) {
  if (result?.trackingReady || result?.status === "ready") return "ready";
  if (result?.status === "detected") return "no-logs";
  if (result?.status === "permission-denied") return "permission";
  if (result?.status === "unsupported") return "unsupported";
  if (result?.status === "path-error") return "path-error";
  return "not-detected";
}

function sourceStateCopyKey(state) {
  return `first_run.source.${state.replaceAll("-", "_")}`;
}

export function FirstRunPage() {
  const navigate = useNavigate();
  const [phase, setPhase] = useState("detecting");
  const [detected, setDetected] = useState({});
  const [error, setError] = useState("");
  const sourceRows = useMemo(
    () => SOURCES.map((source) => ({
      source,
      result: detected[source] || null,
      state: normalizeSourceState(detected[source]),
    })),
    [detected],
  );
  const readyCount = sourceRows.filter((row) => row.state === "ready").length;

  const runDetection = useCallback(async () => {
    setPhase("detecting");
    setError("");
    try {
      const [settings, detection] = await Promise.all([
        getLocalSettings(),
        detectLocalDataDirectories(),
      ]);
      const directories = mergeDirectories(settings?.dataDirectories, detection?.dataDirectories);
      setDetected(detection?.detected || {});
      await setLocalSettings({ dataDirectories: directories });
      setPhase("syncing");
      try {
        await triggerLocalSync();
        setPhase("ready");
      } catch (syncError) {
        setError(syncError?.message || copy("first_run.sync_error"));
        setPhase("sync-error");
      }
    } catch (detectionError) {
      setError(detectionError?.message || copy("first_run.detect_error"));
      setPhase("error");
    }
  }, []);

  useEffect(() => {
    void runDetection();
  }, [runDetection]);

  const viewUsage = () => {
    window.localStorage.setItem(FIRST_RUN_COMPLETED_KEY, "1");
    navigate("/dashboard", { replace: true });
  };

  const isWorking = phase === "detecting" || phase === "syncing";
  const hasResults = phase !== "detecting" && phase !== "error";
  const PhaseIcon = isWorking
    ? RefreshCw
    : phase === "error" || phase === "sync-error"
      ? CircleAlert
      : CheckCircle2;
  const phaseIconClassName = isWorking
    ? "mt-0.5 h-5 w-5 shrink-0 animate-spin text-oai-brand"
    : phase === "error" || phase === "sync-error"
      ? "mt-0.5 h-5 w-5 shrink-0 text-amber-600"
      : "mt-0.5 h-5 w-5 shrink-0 text-emerald-600";

  return (
    <main className="min-h-screen bg-oai-gray-50 px-5 py-8 text-oai-black dark:bg-oai-black dark:text-oai-white sm:px-8">
      <div className="mx-auto max-w-4xl">
        <header className="mb-6">
          <div className="mb-3 inline-flex h-10 w-10 items-center justify-center rounded-xl bg-oai-brand text-white">
            <Database className="h-5 w-5" aria-hidden="true" />
          </div>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{copy("first_run.title")}</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-oai-gray-600 dark:text-oai-gray-300">
            {copy("first_run.subtitle")}
          </p>
        </header>

        <section
          className="rounded-2xl border border-oai-gray-200 bg-white p-4 shadow-sm dark:border-oai-gray-800 dark:bg-oai-gray-900 sm:p-5"
          data-testid="first-run-phase"
          data-phase={phase}
          aria-live="polite"
        >
          <div className="flex items-start gap-3">
            <PhaseIcon className={phaseIconClassName} aria-hidden="true" />
            <div>
              <h2 className="font-semibold">{copy(`first_run.phase.${phase.replaceAll("-", "_")}`)}</h2>
              <p className="mt-1 text-sm text-oai-gray-600 dark:text-oai-gray-300">
                {phase === "detecting"
                  ? copy("first_run.detecting_detail")
                  : phase === "syncing"
                    ? copy("first_run.syncing_detail", { count: readyCount })
                    : copy("first_run.result_detail", { count: readyCount })}
              </p>
              {error ? <p className="mt-2 text-sm text-amber-700 dark:text-amber-300">{error}</p> : null}
            </div>
          </div>

          {hasResults ? (
            <div className="mt-5 grid gap-2 sm:grid-cols-2">
              {sourceRows.map(({ source, result, state }) => (
                <div
                  key={source}
                  className="rounded-xl border border-oai-gray-200 px-3 py-3 dark:border-oai-gray-800"
                  data-testid={`first-run-source-${source}`}
                  data-source-state={state}
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-medium">{copy(`settings.data_dirs.${source}`)}</span>
                    <span className={state === "ready" ? "text-xs font-semibold text-emerald-700 dark:text-emerald-300" : "text-xs font-semibold text-oai-gray-500 dark:text-oai-gray-400"}>
                      {copy(sourceStateCopyKey(state))}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-oai-gray-500 dark:text-oai-gray-400">
                    {result?.environment ? copy("first_run.source_environment", { environment: result.environment }) : copy("first_run.source_no_path")}
                  </p>
                  {state !== "ready" ? (
                    <Link
                      to="/settings/basic#data-directories"
                      className="mt-2 inline-flex min-h-10 items-center text-xs font-semibold text-oai-brand hover:underline"
                      data-testid={`first-run-fix-${source}`}
                    >
                      {copy("first_run.fix_path")}
                    </Link>
                  ) : null}
                </div>
              ))}
            </div>
          ) : null}
        </section>

        <section
          className="mt-4 flex items-start gap-3 rounded-xl border border-oai-gray-200 bg-white px-4 py-3 text-sm dark:border-oai-gray-800 dark:bg-oai-gray-900"
          data-testid="first-run-privacy"
        >
          <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" aria-hidden="true" />
          <div>
            <h2 className="font-semibold">{copy("first_run.privacy_title")}</h2>
            <p className="mt-1 leading-6 text-oai-gray-600 dark:text-oai-gray-300">{copy("first_run.privacy_detail")}</p>
            <Link to="/settings/data#privacy-data" className="mt-1 inline-flex min-h-10 items-center font-semibold text-oai-brand hover:underline">
              {copy("first_run.privacy_manage")}
            </Link>
          </div>
        </section>

        <div className="mt-6 flex flex-wrap items-center justify-end gap-3">
          {phase === "error" ? (
            <>
              <Link to="/settings/basic#data-directories" className="inline-flex min-h-11 items-center rounded-lg px-4 text-sm font-semibold text-oai-gray-700 hover:bg-oai-gray-100 dark:text-oai-gray-200 dark:hover:bg-oai-gray-800">
                {copy("first_run.manual_setup")}
              </Link>
              <button type="button" onClick={runDetection} className="inline-flex min-h-11 items-center rounded-lg bg-oai-brand px-5 text-sm font-semibold text-white hover:bg-oai-brand-dark">
                {copy("first_run.retry")}
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={phase === "sync-error" ? runDetection : viewUsage}
              disabled={isWorking || !readyCount}
              className="inline-flex min-h-11 items-center rounded-lg bg-oai-brand px-5 text-sm font-semibold text-white hover:bg-oai-brand-dark disabled:cursor-not-allowed disabled:opacity-50"
            >
              {phase === "sync-error" ? copy("first_run.retry") : copy("first_run.view_usage")}
            </button>
          )}
        </div>
      </div>
    </main>
  );
}
