import React from "react";
import { createRoot } from "react-dom/client";
import { applyDocumentIdentity } from "./lib/app-identity.js";
import { AppBootSplash } from "./components/AppBootSplash.jsx";
import "@fontsource/geist-mono/400.css";
import "@fontsource/geist-mono/500.css";
import "@fontsource/geist-mono/700.css";
import "@fontsource/geist-mono/900.css";
import "./styles.css";
import "./ui/foundation/apple-glass.css";

applyDocumentIdentity();
performance.mark?.("token-eyes-react-start");
document.documentElement.dataset.tokenEyesBoot = "react-starting";

const root = createRoot(document.getElementById("root"));
root.render(<AppBootSplash />);

requestAnimationFrame(() => {
  requestAnimationFrame(() => {
    document.documentElement.dataset.tokenEyesBoot = "interactive";
    performance.mark?.("token-eyes-interactive");
    import("./AppRuntime.jsx")
      .then(({ AppRuntime }) => root.render(<AppRuntime />))
      .catch((error) => {
        console.error("[Token Eyes] application runtime failed to load", error);
      });
  });
});
