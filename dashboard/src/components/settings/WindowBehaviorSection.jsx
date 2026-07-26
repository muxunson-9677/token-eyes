import React, { useEffect, useState } from "react";
import { isTauriApp } from "../../lib/native-bridge.js";
import { copy } from "../../lib/copy";
import { Select } from "../../ui/components";
import {
  getWindowPrefs,
  setLaunchOnStartup,
  setMinimizeToTrayOnClose,
  setSilentStartup,
} from "../../lib/window-prefs.js";
import { SectionCard, SettingsRow, ToggleSwitch } from "./Controls.jsx";

const CLOSE_MINIMIZE = "minimize";
const CLOSE_EXIT = "exit";

function closeBehaviorOptions() {
  return [
    { value: CLOSE_MINIMIZE, label: copy("settings.window.close_option_minimize") },
    { value: CLOSE_EXIT, label: copy("settings.window.close_option_exit") },
  ];
}

export function WindowBehaviorSection() {
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [minimizeToTrayOnClose, setMinimize] = useState(true);
  const [launchOnStartup, setLaunch] = useState(false);
  const [silentStartup, setSilent] = useState(false);

  useEffect(() => {
    if (!isTauriApp()) return undefined;
    let cancelled = false;
    (async () => {
      try {
        const prefs = await getWindowPrefs();
        if (cancelled) return;
        setMinimize(Boolean(prefs?.minimizeToTrayOnClose));
        setLaunch(Boolean(prefs?.launchOnStartup));
        setSilent(Boolean(prefs?.silentStartup));
        setReady(true);
      } catch (err) {
        if (cancelled) return;
        setError(err?.message || copy("settings.window.load_failed"));
        setReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!isTauriApp()) return null;
  if (!ready) return null;

  const closeValue = minimizeToTrayOnClose ? CLOSE_MINIMIZE : CLOSE_EXIT;

  async function runUpdate(updater) {
    setBusy(true);
    setError("");
    try {
      await updater();
    } catch (err) {
      setError(err?.message || copy("settings.window.update_failed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <SectionCard title={copy("settings.section.window_behavior")}>
        <SettingsRow
          label={copy("settings.window.close_behavior")}
          hint={copy("settings.window.close_behavior_hint")}
          control={
            <Select
              value={closeValue}
              onValueChange={(value) => {
                const next = value === CLOSE_MINIMIZE;
                const prev = minimizeToTrayOnClose;
                setMinimize(next);
                runUpdate(async () => {
                  try {
                    await setMinimizeToTrayOnClose(next);
                  } catch (err) {
                    setMinimize(prev);
                    throw err;
                  }
                });
              }}
              options={closeBehaviorOptions()}
              disabled={busy}
              ariaLabel={copy("settings.window.close_behavior")}
              className="px-2.5 py-1.5 text-xs font-medium min-w-[9rem]"
            />
          }
        />
      </SectionCard>

      <SectionCard title={copy("settings.section.auto_start")}>
        <SettingsRow
          label={copy("settings.window.launch_on_startup")}
          hint={copy("settings.window.launch_on_startup_hint")}
          control={
            <ToggleSwitch
              checked={launchOnStartup}
              disabled={busy}
              ariaLabel={copy("settings.window.launch_on_startup")}
              onChange={() => {
                const next = !launchOnStartup;
                const prev = launchOnStartup;
                setLaunch(next);
                runUpdate(async () => {
                  try {
                    await setLaunchOnStartup(next);
                  } catch (err) {
                    setLaunch(prev);
                    throw err;
                  }
                });
              }}
            />
          }
        />
        {launchOnStartup ? (
          <SettingsRow
            label={copy("settings.window.silent_startup")}
            hint={copy("settings.window.silent_startup_hint")}
            control={
              <ToggleSwitch
                checked={silentStartup}
                disabled={busy}
                ariaLabel={copy("settings.window.silent_startup")}
                onChange={() => {
                  const next = !silentStartup;
                  const prev = silentStartup;
                  setSilent(next);
                  runUpdate(async () => {
                    try {
                      await setSilentStartup(next);
                    } catch (err) {
                      setSilent(prev);
                      throw err;
                    }
                  });
                }}
              />
            }
          />
        ) : null}
      </SectionCard>

      {error ? (
        <p className="text-xs text-red-600 dark:text-red-400" role="alert">
          {error}
        </p>
      ) : null}
    </>
  );
}
