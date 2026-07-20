import React from "react";
import { createBrowserRouter, createHashRouter, RouterProvider } from "react-router-dom";
import { InsforgeAuthProvider } from "./contexts/InsforgeAuthContext.jsx";
import { AccountViewProvider } from "./contexts/AccountViewContext.jsx";
import { LocaleProvider } from "./ui/foundation/LocaleProvider.jsx";
import { CurrencyProvider } from "./ui/foundation/CurrencyProvider.jsx";
import { shouldUseHashRouter } from "./lib/router-mode.js";
import App from "./App.jsx";

const createRouter = shouldUseHashRouter(import.meta.env.VITE_TOKENTRACKER_HASH_ROUTER)
  ? createHashRouter
  : createBrowserRouter;
const router = createRouter([{ path: "*", element: <App /> }]);

export function AppRuntime() {
  return (
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
    </React.StrictMode>
  );
}
