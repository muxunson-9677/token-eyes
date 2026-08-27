import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import {
  BarChart3,
  DollarSign,
  Settings as SettingsIcon,
  Menu,
  X,
  Sun,
  Moon,
  Monitor,
  ChevronRight,
  Trophy,
  History,
  PanelsTopLeft,
  RotateCw,
} from "lucide-react";
import { triggerLocalSync } from "../../lib/api";
import { copy } from "../../lib/copy";
import { cn } from "../../lib/cn";
import { useTheme } from "../../hooks/useTheme.js";
import { useLocale } from "../../hooks/useLocale.js";
import { InsforgeUserHeaderControls } from "../../components/InsforgeUserHeaderControls.jsx";
import { useInsforgeAuth } from "../../contexts/InsforgeAuthContext.jsx";
import { CodexResetBanner } from "../../components/CodexResetBanner";
import { useCodexResetEvents } from "../../hooks/use-codex-reset-events";
import { isNativeApp, isNativeEmbed, isNativeWindowsApp } from "../../lib/native-bridge.js";

const STORAGE_KEY = "tt.sidebarCollapsed";
// v2.0 IA: remembers which parent groups the user has expanded so the
// choice persists across navigations within a session.
const EXPANDED_KEY = "tt.sidebarExpanded";

// v2.0 IA: overview destinations are direct items; usage/cost and settings
// are parents that expand to show their child routes. A click on
// an active parent toggles its children; a click on an inactive parent opens
// its default child.
export function getNavGroups() {
  // copy() must be called at render time so locale switches apply.
  // Validator regex picks up these literal calls.
  return [
    {
      id: "overview",
      label: copy("nav.group.overview"),
      items: [
        { id: "usage", to: "/dashboard", icon: BarChart3, label: copy("nav.usage") },
        { id: "leaderboard", to: "/leaderboard", icon: Trophy, label: copy("nav.leaderboard") },
        {
          id: "reset-history",
          to: "/reset-history",
          icon: History,
          label: copy("nav.reset_history"),
          codexResetAttention: true,
        },
        { id: "widgets", to: "/widgets", icon: PanelsTopLeft, label: copy("nav.widgets") },
      ],
    },
    {
      id: "spend",
      label: copy("nav.group.spend"),
      sectionLabel: copy("nav.section.spend"),
      icon: DollarSign,
      defaultChildTo: "/spend/usage",
      children: [
        { id: "spend-usage", to: "/spend/usage", label: copy("nav.spend.usage") },
        { id: "spend-cost", to: "/spend/cost", label: copy("nav.spend.cost") },
        { id: "spend-plans", to: "/spend/plans", label: copy("nav.spend.plans") },
        { id: "spend-realtime-sessions", to: "/spend/realtime-sessions", label: copy("nav.spend.realtime_sessions") },
      ],
    },
    {
      id: "settings",
      label: copy("nav.group.settings"),
      sectionLabel: copy("nav.section.settings"),
      icon: SettingsIcon,
      defaultChildTo: "/settings/basic",
      children: [
        { id: "settings-basic", to: "/settings/basic", label: copy("nav.settings.basic") },
        { id: "settings-cost", to: "/settings/cost", label: copy("nav.settings.cost") },
        { id: "settings-data", to: "/settings/data", label: copy("nav.settings.data") },
      ],
    },
  ];
}

function readCollapsed() {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function useSidebarCollapsed() {
  const [collapsed, setCollapsed] = useState(readCollapsed);

  const toggle = useCallback(() => {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        if (typeof window !== "undefined") {
          window.localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
        }
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const onStorage = (e) => {
      if (e.key === STORAGE_KEY) setCollapsed(e.newValue === "1");
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  return { collapsed, toggle };
}

function isActive(pathname, to) {
  if (!pathname) return false;
  const normalized = pathname.replace(/\/+$/, "") || "/";
  if (to === "/dashboard") {
    return normalized === "/dashboard" || normalized === "/";
  }
  return normalized === to;
}

// v2.0 IA: a parent is active when the current path is any of its children.
function isParentActive(pathname, group) {
  if (!pathname || !group?.children) return false;
  const normalized = pathname.replace(/\/+$/, "") || "/";
  return group.children.some((child) => normalized === child.to);
}

function readExpanded() {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(EXPANDED_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? new Set(parsed) : null;
  } catch {
    return null;
  }
}

function writeExpanded(set) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(EXPANDED_KEY, JSON.stringify(Array.from(set)));
  } catch {
    /* ignore */
  }
}

function NavGroupLabel({ label, collapsed, first }) {
  if (collapsed) {
    if (first) return null;
    return <div className="mx-2 my-2 h-px bg-oai-gray-200/70 dark:bg-oai-gray-800/70" aria-hidden />;
  }
  return (
    <div
      className={cn(
        "px-3 pb-1 text-[10px] uppercase tracking-wider text-oai-gray-500 dark:text-oai-gray-500",
        first ? "pt-2" : "pt-4",
      )}
    >
      {label}
    </div>
  );
}

function UnreadDot({ count }) {
  if (!count) return null;
  return (
    <span
      className="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500 ring-2 ring-oai-white dark:ring-oai-gray-900"
      aria-label={copy("codex_reset.nav.unread")}
      title={copy("codex_reset.nav.unread")}
    />
  );
}

function NavItem({ item, collapsed, active, onClick, unreadCount = 0 }) {
  const Icon = item.icon;
  return (
    <Link
      to={item.to}
      onClick={onClick}
      title={collapsed ? item.label : undefined}
      aria-current={active ? "page" : undefined}
      className={cn(
        "tt-sidebar-item tt-sidebar-focusable tt-pressable flex min-h-10 items-center gap-2 rounded-md px-2 py-1.5 text-[13px] no-underline",
        collapsed && "justify-center px-0 py-2",
        active
          ? "text-oai-black font-medium dark:text-white"
          : "text-oai-gray-600 dark:text-oai-gray-400 hover:text-oai-black dark:hover:text-white",
      )}
    >
      <span className="relative flex h-5 w-5 shrink-0 items-center justify-center">
        <Icon className="h-[15px] w-[15px]" aria-hidden />
        {collapsed && item.codexResetAttention ? (
          <span className="absolute -right-0.5 -top-0.5">
            <UnreadDot count={unreadCount} />
          </span>
        ) : null}
      </span>
      {!collapsed && (
        <>
          <span className="truncate flex-1">{item.label}</span>
          {item.codexResetAttention ? <UnreadDot count={unreadCount} /> : null}
        </>
      )}
    </Link>
  );
}

/**
 * v2.0 IA: NavParent — a clickable parent that expands its children and
 * navigates to the default child route. Clicking an active parent toggles
 * its children without changing the current route. The expand state is controlled
 * by the caller so it can persist across renders and sync with the
 * mobile drawer.
 *
 * The parent itself renders as a button element (keyboard focusable)
 * with aria-expanded. Children render in a list with an aria-label so
 * screen readers can identify the sub-navigation group.
 */
function NavParent({
  group,
  collapsed,
  expanded,
  onToggleExpand,
  onItemClick,
  unreadCount = 0,
}) {
  const location = useLocation();
  const pathname = location?.pathname || "/";
  const navigate = useNavigate();
  const Icon = group.icon;
  const active = isParentActive(pathname, group);
  const childrenListId = `nav-children-${group.id}`;

  const handleClick = useCallback(() => {
    if (active) {
      onToggleExpand(group.id);
      return;
    }
    if (!expanded) onToggleExpand(group.id);
    navigate(group.defaultChildTo);
    // In the mobile drawer, onItemClick === onClose. Close the drawer so
    // the user sees the destination page instead of the nav overlay.
    // Desktop passes undefined (no-op).
    onItemClick?.();
  }, [active, expanded, group.defaultChildTo, group.id, navigate, onToggleExpand, onItemClick]);

  return (
    <div className="flex flex-col">
      <button
        type="button"
        onClick={handleClick}
        title={collapsed ? group.label : undefined}
        aria-current={active ? "page" : undefined}
        aria-expanded={expanded}
        aria-controls={childrenListId}
        aria-label={group.label}
        className={cn(
          "tt-sidebar-item tt-sidebar-focusable tt-pressable flex min-h-10 w-full items-center gap-2 rounded-md px-2 py-1.5 text-[13px]",
          collapsed && "justify-center px-0 py-2",
          active
            ? "text-oai-black font-medium dark:text-white"
            : "text-oai-gray-600 dark:text-oai-gray-400 hover:text-oai-black dark:hover:text-white",
        )}
      >
        <span className="relative flex h-5 w-5 shrink-0 items-center justify-center">
          <Icon className="h-[15px] w-[15px]" aria-hidden />
          {collapsed && group.codexResetAttention ? (
            <span className="absolute -right-0.5 -top-0.5">
              <UnreadDot count={unreadCount} />
            </span>
          ) : null}
        </span>
        {!collapsed && (
          <>
            <span className="truncate flex-1 text-left">{group.label}</span>
            {group.codexResetAttention ? <UnreadDot count={unreadCount} /> : null}
            <ChevronRight
              className={cn(
                "h-3.5 w-3.5 shrink-0 text-oai-gray-400 transition-transform",
                expanded && "rotate-90",
              )}
              aria-hidden
            />
          </>
        )}
      </button>
      {!collapsed && expanded && (
        <ul
          id={childrenListId}
          aria-label={group.label}
          className="mt-0.5 ml-7 flex flex-col gap-0.5"
        >
          {group.children.map((child) => {
            const childActive = isActive(pathname, child.to);
            return (
              <li key={child.id}>
                <Link
                  to={child.to}
                  onClick={onItemClick}
                  aria-current={childActive ? "page" : undefined}
                  className={cn(
                    "tt-sidebar-item tt-sidebar-focusable tt-pressable flex min-h-10 items-center rounded-md px-2 py-1.5 text-[13px] no-underline",
                    childActive
                      ? "text-oai-black font-medium dark:text-white"
                      : "text-oai-gray-600 dark:text-oai-gray-400 hover:text-oai-black dark:hover:text-white",
                  )}
                >
                  <span className="truncate flex-1">{child.label}</span>
                  {child.codexResetAttention ? <UnreadDot count={unreadCount} /> : null}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/**
 * Tertiary icon button 鈥?uniform 40脳40 (meets WCAG 2.5.5 close enough; AAA prefers 44).
 */
function IconButton({ as = "button", title, onClick, href, children, className: extraClassName, ...rest }) {
  const className = cn(
    "tt-sidebar-focusable flex h-10 w-10 items-center justify-center rounded-lg text-oai-gray-600 dark:text-oai-gray-400 hover:bg-oai-gray-200/60 dark:hover:bg-oai-gray-800 hover:text-oai-black dark:hover:text-white transition-colors no-underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-oai-brand-500",
    extraClassName,
  );
  if (as === "a") {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" title={title} aria-label={title} className={className} {...rest}>
        {children}
      </a>
    );
  }
  return (
    <button type="button" title={title} aria-label={title} onClick={onClick} className={className} {...rest}>
      {children}
    </button>
  );
}

/**
 * Compact theme pill 鈥?opens a popover with Light / Dark / System options.
 * Popover opens upward (bottom-left anchored).
 */
function buildThemeOptions() {
  return [
    { value: "light", label: copy("settings.appearance.theme.light"), Icon: Sun },
    { value: "dark", label: copy("settings.appearance.theme.dark"), Icon: Moon },
    { value: "system", label: copy("settings.appearance.theme.system"), Icon: Monitor },
  ];
}

function ThemePill({ theme, resolvedTheme, onSetTheme, glassChrome = false, collapsed = false }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);
  const ActiveIcon = resolvedTheme === "dark" ? Moon : Sun;
  const themeLabel = copy("settings.appearance.theme.label");
  const resolvedThemeLabel = copy(`settings.appearance.theme.${resolvedTheme}`);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        aria-label={themeLabel}
        aria-expanded={open}
        aria-haspopup="menu"
        title={themeLabel}
        onClick={() => setOpen((o) => !o)}
        className={cn(
          "tt-theme-trigger tt-sidebar-focusable tt-pressable inline-flex h-8 items-center justify-center rounded-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-oai-brand-500",
          collapsed ? "w-8" : "gap-1.5 px-2.5",
          glassChrome
            ? "border backdrop-blur-[2px] text-oai-gray-700 dark:text-oai-gray-300 hover:text-oai-black dark:hover:text-white"
            : "border text-oai-gray-600 dark:text-oai-gray-400 hover:text-oai-black dark:hover:text-white",
        )}
      >
        <ActiveIcon className="h-3.5 w-3.5" aria-hidden />
        {!collapsed && <span className="text-[11px] font-medium">{resolvedThemeLabel}</span>}
      </button>
      {open && (
        <div
          role="menu"
          className="tt-theme-menu absolute bottom-full left-0 mb-2 z-50 min-w-[140px] py-1 rounded-lg"
        >
          {buildThemeOptions().map(({ value, label, Icon }) => {
            const active = theme === value;
            return (
              <button
                key={value}
                type="button"
                role="menuitem"
                onClick={() => { onSetTheme(value); setOpen(false); }}
                className={cn(
                  "tt-sidebar-focusable flex min-h-10 w-full items-center gap-2.5 px-3 py-2 text-[13px] transition-colors",
                  active
                    ? "text-oai-black dark:text-white bg-oai-gray-100 dark:bg-oai-gray-800"
                    : "text-oai-gray-600 dark:text-oai-gray-400 hover:bg-oai-gray-50 dark:hover:bg-oai-gray-800/60 hover:text-oai-black dark:hover:text-white",
                )}
              >
                <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden />
                <span>{label}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function SystemStatusControl() {
  const [refreshing, setRefreshing] = useState(false);

  const refreshLocalData = useCallback(async () => {
    if (refreshing) return;
    setRefreshing(true);
    try {
      await triggerLocalSync();
    } finally {
      setRefreshing(false);
    }
  }, [refreshing]);

  return (
    <div className="tt-theme-trigger tt-system-status-control" aria-label={copy("native.window.status.label")}>
      <span className="tt-native-status-dot" aria-hidden />
      <span>{copy("native.window.status.label")}</span>
      <strong className="tt-native-status-value">{copy("native.window.status.connected")}</strong>
      <button
        type="button"
        aria-label={copy("native.window.refresh_local_data")}
        title={copy("native.window.refresh_local_data")}
        className="tt-system-status-refresh tt-sidebar-focusable"
        disabled={refreshing}
        onClick={refreshLocalData}
      >
        <RotateCw className={refreshing ? "animate-spin" : ""} aria-hidden />
      </button>
    </div>
  );
}

/**
 * SidebarBody 鈥?shared markup used by both desktop sticky Sidebar and mobile Drawer.
 *
 * @param {boolean} collapsed - desktop collapsed state (always false in mobile drawer)
 * @param {() => void} onToggleCollapsed - toggle handler (only shown on desktop)
 * @param {() => void} onItemClick - called after a nav item is clicked (used by drawer to close)
 * @param {boolean} showCloseButton - show X close button instead of collapse toggle (mobile)
 * @param {() => void} onClose - close handler for mobile drawer
 */
function SidebarBody({ collapsed, onToggleCollapsed, onItemClick, showCloseButton = false, onClose, glassChrome = false }) {
  const location = useLocation();
  const pathname = location?.pathname || "/";
  const { theme, resolvedTheme, setTheme } = useTheme();
  // Re-compute copy() via getNavGroups when locale changes, otherwise the
  // labels stay stale after a language switch.
  const { resolvedLocale } = useLocale();
  const { signedIn } = useInsforgeAuth();
  const { unreadCount } = useCodexResetEvents();
  const showSystemStatus = !showCloseButton && isNativeWindowsApp();
  const navGroups = useMemo(() => getNavGroups(), [resolvedLocale]);

  // v2.0 IA: expanded parent groups. Initial state: a parent is expanded
  // if the current route is one of its children (so the active sub-nav is
  // always visible) or if the user previously expanded it this session.
  const [expandedSet, setExpandedSet] = useState(() => {
    const stored = readExpanded();
    const initial = stored ?? new Set(["spend", "settings"]);
    navGroups.forEach((group) => {
      if (group.children && isParentActive(pathname, group)) {
        initial.add(group.id);
      }
    });
    return initial;
  });

  // Auto-expand a parent when navigating to one of its children (so the
  // sub-nav stays visible on deep links and refreshes).
  useEffect(() => {
    setExpandedSet((prev) => {
      let changed = false;
      const next = new Set(prev);
      navGroups.forEach((group) => {
        if (group.children && isParentActive(pathname, group) && !next.has(group.id)) {
          next.add(group.id);
          changed = true;
        }
      });
      return changed ? next : prev;
    });
  }, [pathname, navGroups]);

  // Persist expand state so it survives navigation and reloads.
  useEffect(() => {
    writeExpanded(expandedSet);
  }, [expandedSet]);

  const handleToggleExpand = useCallback((groupId) => {
    setExpandedSet((prev) => {
      const next = new Set(prev);
      if (!next.has(groupId)) {
        next.add(groupId);
        return next;
      }
      // Toggling an already-expanded group collapses it while preserving the
      // active child route.
      next.delete(groupId);
      return next;
    });
  }, []);

  return (
    <>
      {/* Top: identity only 鈥?full-width, aligned with nav items (px-2) */}
      {signedIn || showCloseButton ? (
        <div className={cn("px-2 pt-2 pb-2", collapsed && "flex justify-center")}>
          {showCloseButton ? (
            <div className="flex items-center gap-2">
              <div className="flex-1 min-w-0">
                {signedIn ? (
                  <InsforgeUserHeaderControls
                    variant="sidebar"
                    collapsed={collapsed}
                    onAfterAction={onItemClick}
                  />
                ) : null}
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label={copy("nav.close_menu")}
                title={copy("nav.close_menu")}
                className="tt-sidebar-focusable flex h-10 w-10 shrink-0 items-center justify-center rounded-md text-oai-gray-500 dark:text-oai-gray-500 hover:bg-oai-gray-200/60 dark:hover:bg-oai-gray-800 hover:text-oai-gray-900 dark:hover:text-oai-gray-200 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-oai-brand-500"
              >
                <X className="h-4 w-4" strokeWidth={1.75} aria-hidden />
              </button>
            </div>
          ) : (
            <InsforgeUserHeaderControls
              variant="sidebar"
              collapsed={collapsed}
              onAfterAction={onItemClick}
            />
          )}
        </div>
      ) : null}

      {/* Nav */}
      <nav
        aria-label={copy("nav.nav_label")}
        className="flex-1 px-2 pb-2 flex flex-col overflow-y-auto"
      >
        {navGroups.map((group, groupIdx) => (
          <div key={group.id} className="flex flex-col">
            {/* The overview links start immediately; only grouped sections keep a heading. */}
            {group.id === "overview" ? null : (
              <NavGroupLabel
                label={group.children ? group.sectionLabel : group.label}
                collapsed={collapsed}
                first={groupIdx === 0}
              />
            )}
            <div className="flex flex-col gap-0.5">
              {group.children ? (
                <NavParent
                  group={group}
                  collapsed={collapsed}
                  expanded={expandedSet.has(group.id)}
                  onToggleExpand={handleToggleExpand}
                  onItemClick={onItemClick}
                  unreadCount={unreadCount}
                />
              ) : (
                group.items.map((item) => (
                  <NavItem
                    key={item.id}
                    item={item}
                    collapsed={collapsed}
                    active={isActive(pathname, item.to)}
                    onClick={onItemClick}
                    unreadCount={unreadCount}
                  />
                ))
              )}
            </div>
          </div>
        ))}
      </nav>

      {/* Bottom utility row */}
      <div
        className={cn(
          "flex items-center px-2 py-3",
          collapsed ? "flex-col justify-center gap-2" : "justify-between gap-2",
        )}
      >
        <ThemePill theme={theme} resolvedTheme={resolvedTheme} onSetTheme={setTheme} glassChrome={glassChrome} collapsed={collapsed} />
        {showSystemStatus && !collapsed ? <SystemStatusControl /> : null}
        <div className="flex items-center gap-1.5">
          {/* TEMP: collapse button hidden 鈥?restore when ready
          {!showCloseButton && (
            <button
              type="button"
              onClick={onToggleCollapsed}
              aria-label={collapsed ? copy("nav.expand") : copy("nav.collapse")}
              title={collapsed ? copy("nav.expand") : copy("nav.collapse")}
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-oai-gray-500 dark:text-oai-gray-500 hover:bg-oai-gray-200/60 dark:hover:bg-oai-gray-800 hover:text-oai-gray-900 dark:hover:text-oai-gray-200 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-oai-brand-500"
            >
              {collapsed ? (
                <ChevronRight className="h-4 w-4" strokeWidth={1.75} aria-hidden />
              ) : (
                <ChevronLeft className="h-4 w-4" strokeWidth={1.75} aria-hidden />
              )}
            </button>
          )}
          */}
        </div>
      </div>
    </>
  );
}

/**
 * Desktop Sidebar 鈥?visible only on lg+. Fills its parent's height (which is
 * already bounded by AppLayout's fixed-viewport flex container).
 */
function Sidebar({ collapsed, onToggleCollapsed }) {
  const nativeGlass = useMemo(() => {
    if (typeof window === "undefined") return false;
    return isNativeEmbed() || isNativeApp();
  }, []);

  return (
    <aside
      aria-label={copy("nav.aside_label")}
      className={cn(
        "tt-sidebar-material tt-desktop-sidebar hidden min-[900px]:flex flex-col shrink-0 h-full min-h-0",
        collapsed
          ? "w-[72px] min-w-[72px] max-w-[72px] basis-[72px]"
          : "w-[252px] min-w-[252px] max-w-[252px] basis-[252px]",
      )}
    >
      <SidebarBody collapsed={collapsed} onToggleCollapsed={onToggleCollapsed} glassChrome={nativeGlass} />
    </aside>
  );
}

/**
 * Mobile drawer 鈥?slides in from the left, full-height overlay.
 */
function MobileDrawer({ open, onClose }) {
  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // Lock body scroll when open
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  if (!open) return null;
  return (
    <div className="tt-mobile-navigation min-[900px]:hidden fixed inset-0 z-[80] flex">
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden
      />
      <aside
        aria-label={copy("nav.aside_label")}
        className="tt-sidebar-material tt-mobile-drawer relative flex w-[260px] max-w-[80vw] flex-col"
      >
        <SidebarBody
          collapsed={false}
          showCloseButton
          onClose={onClose}
          onItemClick={onClose}
        />
      </aside>
    </div>
  );
}

/**
 * Mobile top bar 鈥?shows hamburger + brand on screens < lg.
 */
function MobileTopBar({ onOpenDrawer }) {
  return (
    <div className="tt-mobile-navigation min-[900px]:hidden flex items-center justify-between gap-2 px-3 h-14 border-b border-oai-gray-200 dark:border-oai-gray-800">
      <IconButton title={copy("nav.menu")} onClick={onOpenDrawer}>
        <Menu className="h-5 w-5" aria-hidden />
      </IconButton>
      <Link
        to="/landing"
        className="tt-sidebar-focusable flex items-center gap-2 no-underline hover:opacity-80 transition-opacity"
        aria-label={copy("shared.app_name")}
      >
        <img src="/app-icon.png" alt="" width={24} height={24} className="rounded-md" />
        <span className="text-sm font-semibold text-oai-black dark:text-oai-white">
          {copy("shared.app_name")}
        </span>
      </Link>
      <div className="w-10 shrink-0" aria-hidden />
    </div>
  );
}

/**
 * AppLayout 鈥?outer wash + sidebar + rounded content card on the right.
 *
 * Desktop (lg+): sticky sidebar on the left, rounded content card on the right.
 * Mobile (< lg): full-width content card with a top bar (hamburger + brand);
 *                tapping hamburger opens a slide-in drawer with the same nav.
 */
export function AppLayout({ children }) {
  const location = useLocation();
  const { collapsed, toggle } = useSidebarCollapsed();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const openDrawer = useCallback(() => setDrawerOpen(true), []);
  const closeDrawer = useCallback(() => setDrawerOpen(false), []);

  /** macOS WKWebView锛氬簳灞傜敱 NSVisualEffectView 鎻愪緵妯＄硦锛學eb 鏍瑰竷灞€閫忔槑锛屼晶鏍忔诞鍦ㄨ儗鏅笂锛涙祻瑙堝櫒浠嶇敤鐏拌壊搴曘€?*/
  const nativeEmbed = useMemo(() => {
    if (typeof window === "undefined") return false;
    return isNativeEmbed() || isNativeApp();
  }, []);
  const nativeWindows = useMemo(() => {
    if (typeof window === "undefined") return false;
    return isNativeWindowsApp();
  }, []);
  const referenceRoute = useMemo(() => {
    const pathname = location?.pathname || "/dashboard";
    if (pathname === "/dashboard") return "dashboard";
    if (pathname === "/leaderboard") return "leaderboard";
    if (pathname === "/reset-history") return "reset-history";
    if (pathname === "/widgets") return "widgets";
    if (pathname === "/spend/usage") return "spend-usage";
    if (pathname === "/spend/cost") return "spend-cost";
    if (pathname === "/spend/plans") return "spend-plans";
    if (pathname === "/spend/realtime-sessions") return "spend-realtime-sessions";
    if (pathname === "/settings/basic") return "settings-basic";
    if (pathname === "/settings/cost") return "settings-cost";
    if (pathname === "/settings/data") return "settings-data";
    return "default";
  }, [location?.pathname]);

  useEffect(() => {
    if (!nativeWindows || typeof document === "undefined") return undefined;
    document.documentElement.classList.add("native-windows-app");
    return () => document.documentElement.classList.remove("native-windows-app");
  }, [nativeWindows]);

  let nativeHeader = null;
  if (nativeEmbed && !nativeWindows) {
    nativeHeader = (
      <div
        className="h-7 shrink-0"
        style={{ WebkitAppRegion: "drag" }}
        aria-hidden
      />
    );
  }

  return (
    <div
      className={cn(
        "tt-app-shell fixed inset-0 flex flex-col text-oai-black dark:text-oai-white font-sans overflow-hidden",
        nativeWindows && "tt-native-glass-shell",
        nativeWindows && `tt-reference-route-${referenceRoute}`,
        nativeWindows
          ? "bg-oai-gray-100/80 dark:bg-oai-gray-950"
          : nativeEmbed
            ? "bg-transparent"
            : "bg-oai-gray-100/80 dark:bg-oai-gray-950",
      )}
      data-reference-route={nativeWindows ? referenceRoute : undefined}
    >
      {nativeHeader}
      <div className="flex-1 min-h-0 flex">
        <Sidebar collapsed={nativeWindows ? false : collapsed} onToggleCollapsed={toggle} />
        <MobileDrawer open={drawerOpen} onClose={closeDrawer} />
        {/* lg锛氫笌渚ф爮鍐呭鍖哄榻?鈥?渚ф爮搴曢儴鎸夐挳鍖轰负 px-2 py-3锛涗富鍗″彸渚?搴曚晶鐢?pr-3 pb-3 涓?py-3 瑙嗚涓€鑷达紝閬垮厤浠呴潬 p-2 鏄惧緱璐磋竟 */}
        {/* Mac App锛歚lg:pr-3 lg:pb-3` (12pt) 椤讳笌 Swift `DashboardChromeMetrics.mainGutterPoints` 涓€鑷达紝涓诲崱鍦嗚鐢?`--tt-main-card-radius` 娉ㄥ叆 */}
        <div className="tt-native-main-frame flex-1 min-w-0 min-h-0 p-2 min-[900px]:pl-0 min-[900px]:pr-3 min-[900px]:pb-3 flex flex-col">
          <div
            className={cn(
              "tt-main-work-surface flex-1 min-h-0 flex flex-col overflow-hidden",
              nativeEmbed ? "tt-native-main-card" : "rounded-xl",
            )}
          >
            <MobileTopBar onOpenDrawer={openDrawer} />
            <CodexResetBanner />
            <div className="tt-main-scroll-region flex-1 min-h-0 overflow-y-auto">
              {children}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
