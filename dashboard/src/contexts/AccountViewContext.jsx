import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import { useInsforgeAuth } from "./InsforgeAuthContext.jsx";
import { isLocalDashboardHost } from "../lib/cloud-sync-prefs";

/**
 * Local desktop/localhost dashboards always read local usage, regardless of
 * login. A public web dashboard may keep its authenticated cloud account view.
 */
const AccountViewContext = createContext(null);

export function AccountViewProvider({ children }) {
  const auth = useInsforgeAuth();
  const signedIn = Boolean(auth?.signedIn);
  const authEnabled = Boolean(auth?.enabled);
  const authLoading = Boolean(auth?.loading);
  const [localHost, setLocalHost] = useState(() => isLocalDashboardHost());
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    setLocalHost(isLocalDashboardHost());
  }, []);

  const accountView = authEnabled && signedIn && !localHost;
  const lastResolved = React.useRef(accountView);
  useEffect(() => {
    if (lastResolved.current !== accountView) {
      lastResolved.current = accountView;
      setRevision((value) => value + 1);
    }
  }, [accountView]);

  const resolving = authLoading && authEnabled && !localHost;
  const value = useMemo(
    () => ({ accountView, revision, localHost, resolving }),
    [accountView, revision, localHost, resolving],
  );

  return (
    <AccountViewContext.Provider value={value}>{children}</AccountViewContext.Provider>
  );
}

export function useAccountView() {
  const ctx = useContext(AccountViewContext);
  if (ctx) return ctx;
  return { accountView: false, revision: 0, localHost: true, resolving: false };
}
