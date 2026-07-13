import React from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, createHashRouter, RouterProvider } from "react-router-dom";
import { InsforgeAuthProvider } from "./contexts/InsforgeAuthContext.jsx";
import { AccountViewProvider } from "./contexts/AccountViewContext.jsx";
import { LocaleProvider } from "./ui/foundation/LocaleProvider.jsx";
import { CurrencyProvider } from "./ui/foundation/CurrencyProvider.jsx";
import { applyDocumentIdentity } from "./lib/app-identity.js";
import App from "./App.jsx";
import "@fontsource/geist-mono/400.css";
import "@fontsource/geist-mono/500.css";
import "@fontsource/geist-mono/700.css";
import "@fontsource/geist-mono/900.css";
import "./styles.css";

applyDocumentIdentity();

const useHashRouter =
  String(import.meta.env.VITE_TOKENTRACKER_HASH_ROUTER || "").toLowerCase() === "1" ||
  String(import.meta.env.VITE_TOKENTRACKER_HASH_ROUTER || "").toLowerCase() === "true";
const createRouter = useHashRouter ? createHashRouter : createBrowserRouter;
const router = createRouter([{ path: "*", element: <App /> }]);

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <LocaleProvider>
      <CurrencyProvider>
        <InsforgeAuthProvider>
          <AccountViewProvider>
            <RouterProvider router={router} />
          </AccountViewProvider>
        </InsforgeAuthProvider>
      </CurrencyProvider>
    </LocaleProvider>
  </React.StrictMode>,
);
