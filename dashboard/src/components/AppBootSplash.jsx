import React from "react";
import { copy } from "../lib/copy";

export function AppBootSplash() {
  const appName = copy("shared.app_name");
  return (
    <div className="boot-splash" role="status" aria-label={copy("app.boot.loading_aria")}>
      <div className="boot-splash__mark" aria-hidden="true">{appName.slice(0, 1)}</div>
      <div className="boot-splash__text">
        <div className="boot-splash__title">{appName}</div>
        <div className="boot-splash__subtitle">{copy("app.boot.loading")}</div>
      </div>
    </div>
  );
}
