import React, { useState, useEffect, useMemo } from "react";
import { Link } from "react-router-dom";
import { motion, useReducedMotion } from "motion/react";
import { cn } from "../../lib/cn";
import { getDashboardEntryPath } from "../../lib/host-mode";
import { HeaderGithubStar } from "../components/HeaderGithubStar.jsx";
import { InsforgeUserHeaderControls } from "../../components/InsforgeUserHeaderControls.jsx";
import { useInsforgeAuth } from "../../contexts/InsforgeAuthContext.jsx";
import { useLoginModal } from "../../contexts/LoginModalContext.jsx";
import { STATUSPAGE_URL } from "../../lib/config";
import LaserFlow from "./components/LaserFlow.jsx";
import LightRays from "./components/LightRays.jsx";
import { LogoCarousel } from "./LogoCarousel.jsx";
import { SpotlightCard } from "./components/SpotlightCard.jsx";
import { TiltedCard } from "./components/TiltedCard.jsx";
import { BorderGlow } from "./components/BorderGlow.jsx";
import { AGENT_LOGOS } from "./agent-logos.js";
import { detectOS } from "../../lib/os";

function AppleIcon({ className }) {
  return (
    <svg viewBox="0 0 384 512" className={className} fill="currentColor">
      <path d="M318.7 268.7c-.2-36.7 16.4-64.4 50-84.8-18.8-26.9-47.2-41.7-84.7-44.6-35.5-2.8-74.3 20.7-88.5 20.7-15 0-49.4-19.7-76.4-19.7C63.3 141.2 4 184.8 4 273.5q0 39.3 14.4 81.2c12.8 36.7 59 126.7 107.2 125.2 25.2-.6 43-17.9 75.8-17.9 31.8 0 48.3 17.9 76.4 17.9 48.6-.7 90.4-82.5 102.6-119.3-65.2-30.7-61.7-90-61.7-91.9zm-56.6-164.2c27.3-32.4 24.8-61.9 24-72.5-24.1 1.4-52 16.4-67.9 34.9-17.5 19.8-27.8 44.3-25.6 71.9 26.1 2 49.9-11.4 69.5-34.3z" />
    </svg>
  );
}

function GithubIcon({ className }) {
  return (
    <svg viewBox="0 0 16 16" className={className} fill="currentColor">
      <path d="M8 0c4.42 0 8 3.58 8 8a8.013 8.013 0 0 1-5.45 7.59c-.4.08-.55-.17-.55-.38 0-.27.01-1.13.01-2.2 0-.75-.25-1.23-.54-1.48 1.78-.2 3.65-.88 3.65-3.95 0-.88-.31-1.59-.82-2.15.08-.2.36-1.02-.08-2.12 0 0-.67-.22-2.2.82-.64-.18-1.32-.27-2-.27-.68 0-1.36.09-2 .27-1.53-1.03-2.2-.82-2.2-.82-.44 1.1-.16 1.92-.08 2.12-.51.56-.82 1.28-.82 2.15 0 3.06 1.86 3.75 3.64 3.95-.23.2-.44.55-.51 1.07-.46.21-1.61.55-2.33-.66-.15-.24-.6-.83-1.23-.82-.67.01-.27.38.01.53.34.19.73.9.82 1.13.16.45.68 1.31 2.69.94 0 .67.01 1.3.01 1.49 0 .21-.15.45-.55.38A7.995 7.995 0 0 1 0 8c0-4.42 3.58-8 8-8Z" />
    </svg>
  );
}

function WindowsIcon({ className }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden="true">
      <path d="M3 5.46 10.2 4.5v6.92H3V5.46Zm0 13.08 7.2.96v-6.84H3v5.88Zm8.04 1.08L21 21V12.46h-9.96v7.16ZM11.04 4.38 21 3v8.46h-9.96V4.38Z" />
    </svg>
  );
}

function DownloadIcon({ className }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
      <polyline points="7 10 12 15 17 10"></polyline>
      <line x1="12" y1="15" x2="12" y2="3"></line>
    </svg>
  );
}

function CopyIcon({ className }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
    </svg>
  );
}

function CheckIcon({ className }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <polyline points="20 6 9 17 4 12"></polyline>
    </svg>
  );
}

const REPO_URL = "https://github.com/mm7894215/TokenTracker";
// The releases page lists every asset (used for the "other platforms" link and
// as the fallback when we can't detect the OS).
const RELEASES_URL = "https://github.com/mm7894215/TokenTracker/releases/latest";
// Stable, version-less asset names so these deep links survive version bumps.
// macOS: TokenTrackerBar.dmg (already stable). Windows: TokenTracker-Setup.exe
// (the per-user installer; release-windows.yml uploads this alias every release).
const MAC_DMG_URL = `${RELEASES_URL}/download/TokenTrackerBar.dmg`;
const WIN_SETUP_URL = `${RELEASES_URL}/download/TokenTracker-Setup.exe`;

function buttonClass(variant = "default", size = "md", className) {
  const base =
    "inline-flex items-center justify-center rounded font-medium transition-colors duration-200 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-oai-brand-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-oai-gray-950";
  const variants = {
    default:
      "bg-oai-gray-900 text-white hover:bg-oai-gray-800 active:bg-oai-gray-950 dark:bg-white dark:text-oai-gray-900 dark:hover:bg-oai-gray-100 dark:active:bg-oai-gray-200",
    ghost:
      "text-oai-gray-600 hover:text-oai-gray-900 hover:bg-oai-gray-100 active:bg-oai-gray-200 dark:text-oai-gray-400 dark:hover:text-white dark:hover:bg-oai-gray-800 dark:active:bg-oai-gray-700",
  };
  const sizes = {
    sm: "h-9 px-4 text-sm",
    md: "h-11 px-6 text-sm",
    lg: "h-12 px-8 text-base",
  };
  return cn(base, variants[variant], sizes[size], className);
}

export function MarketingLanding({
  copy,
  signInUrl,
  signUpUrl,
  installCommand,
  installCopied,
  onCopyInstallCommand,
}) {
  const reduceMotion = useReducedMotion();
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 10);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const isLocalMode =
    typeof window !== "undefined" &&
    (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1");
  const { signedIn, loading: authLoading } = useInsforgeAuth();
  const { openLoginModal } = useLoginModal();

  // Auto-detect the visitor's OS so the primary native-app download names their
  // platform ("Download for macOS" / "Download for Windows") and deep-links the
  // right installer. Unknown OS → the releases page. Detected once on mount.
  const os = useMemo(() => detectOS(), []);
  const macDownload = { href: MAC_DMG_URL, label: copy("landing.v2.install.os_macos"), Icon: AppleIcon };
  const winDownload = { href: WIN_SETUP_URL, label: copy("landing.v2.install.os_windows"), Icon: WindowsIcon };
  const nativeDownload =
    os === "windows"
      ? { href: WIN_SETUP_URL, label: copy("landing.v2.install.win_cta"), Icon: WindowsIcon }
      : os === "mac"
        ? { href: MAC_DMG_URL, label: copy("landing.v2.install.mac_cta"), Icon: AppleIcon }
        : { href: RELEASES_URL, label: copy("landing.v2.install.desktop_cta"), Icon: DownloadIcon };
  // Secondary links name the OTHER platform(s) directly (no generic "other
  // platforms"): on macOS → Windows, on Windows → macOS, unknown → both.
  const secondaryDownloads =
    os === "windows" ? [macDownload] : os === "mac" ? [winDownload] : [macDownload, winDownload];

  // Canonical supported-agent list shared with the dashboard auth gate; names
  // are metadata (React keys + a11y), not rendered text, so no copy entry needed.

  const spring = reduceMotion ? { duration: 0 } : undefined;

  return (
    <div className="relative min-h-screen bg-oai-gray-950 text-oai-white font-oai antialiased dark">
      {/* LightRays — covers header + hero, behind all content */}
      <div className="absolute inset-0 z-0 pointer-events-none" style={{ height: "100vh" }}>
        <LightRays
          raysOrigin="top-center"
          raysColor="#b8b3ff"
          raysSpeed={1}
          lightSpread={0.5}
          rayLength={3}
          pulsating={false}
          fadeDistance={1}
          saturation={1}
          followMouse
          mouseInfluence={0.1}
          noiseAmount={0}
          distortion={0}
        />
      </div>
      <header className={cn("sticky top-0 z-50 transition-all duration-300", scrolled ? "bg-oai-gray-950/80 backdrop-blur-md border-b border-oai-gray-900" : "bg-transparent border-b border-transparent")}>
        <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-4 sm:px-6">
          <div className="flex items-center gap-3 sm:gap-5">
            <Link
              to={signUpUrl || "/"}
              className="flex items-center gap-3 no-underline outline-none rounded focus-visible:ring-2 focus-visible:ring-oai-brand-500 focus-visible:ring-offset-2 dark:ring-offset-oai-gray-950 transition-opacity hover:opacity-80"
            >
              <img src="/app-icon.png" alt="" width={24} height={24} className="rounded-md" />
              <span className="text-sm font-semibold tracking-wide text-white uppercase whitespace-nowrap">
                Token Tracker
              </span>
            </Link>
            <div className="hidden sm:block">
              <HeaderGithubStar />
            </div>
          </div>
          <div className="flex items-center justify-end gap-3 sm:gap-5 md:gap-6">
            {/* Leaderboard 纯文字导航链接 — 移动端收起（正文有醒目的榜单 CTA 兜底） */}
            <Link
              to="/leaderboard"
              className="hidden sm:inline text-sm font-medium text-oai-gray-400 hover:text-white transition-colors duration-200 select-none outline-none focus-visible:underline"
            >
              {copy("nav.leaderboard")}
            </Link>

            {/* 未登录场景下，Open Dashboard 应该作为次级文字导航链接并排展示 */}
            {(!signedIn && !authLoading) && (
              <Link
                to={getDashboardEntryPath()}
                className="hidden sm:inline text-sm font-medium text-oai-gray-400 hover:text-white transition-colors duration-200 select-none outline-none focus-visible:underline"
              >
                {copy("landing.v2.cta.primary")}
              </Link>
            )}

            {/* Dashboard / Sign In 按钮及头像区 */}
            <div className="flex items-center gap-2.5 sm:gap-3.5">
              {authLoading ? (
                <div className="h-8 w-16 animate-pulse rounded-[8px] bg-white/10" aria-hidden />
              ) : signedIn ? (
                // 已登录：Open Dashboard 升级为主行动实色按钮
                <>
                  <Link
                    to={getDashboardEntryPath()}
                    className="inline-flex h-8 items-center justify-center rounded-[8px] bg-white px-3.5 text-xs font-bold text-oai-gray-950 hover:bg-oai-gray-100 transition-all duration-200 active:scale-[0.98] shadow-sm select-none"
                  >
                    {copy("landing.v2.cta.primary")}
                  </Link>
                  {/* 已登录时，优雅挂载头像控件 */}
                  <InsforgeUserHeaderControls />
                </>
              ) : (
                // 未登录：Sign In 展示为主行动实色按钮，点击唤起 Modal
                <button
                  type="button"
                  onClick={openLoginModal}
                  className="inline-flex h-8 min-w-[80px] items-center justify-center rounded-[8px] bg-white px-3.5 text-xs font-bold text-oai-gray-950 hover:bg-oai-gray-100 transition-all duration-200 active:scale-[0.98] shadow-sm select-none"
                >
                  {copy("header.auth.sign_in_aria")}
                </button>
              )}
            </div>
          </div>
        </div>
      </header>

      <main>
        <section className="relative py-16 sm:py-24 lg:py-32 overflow-hidden">
          <div className="relative z-10 mx-auto max-w-7xl px-4 sm:px-6 flex flex-col items-center text-center gap-12 sm:gap-20 lg:gap-36">
            <motion.div
              initial={reduceMotion ? false : { opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={spring || { duration: 0.5 }}
              className="w-full max-w-3xl relative z-20"
            >
                <h1 className="text-balance text-4xl font-semibold tracking-tight text-white sm:text-6xl lg:text-[4rem] leading-[1.1] sm:leading-tight lg:leading-[1.05]">
                  {copy("landing.v2.hero.title_line1")}
                  <br />
                  <span 
                    className="bg-gradient-to-b from-white via-oai-gray-200 to-oai-gray-500 bg-clip-text text-transparent font-bold tracking-tight"
                    style={{ WebkitTextStroke: "1px rgba(255, 255, 255, 0.15)" }}
                  >
                    {copy("landing.v2.hero.title_line2")}
                  </span>
                </h1>
                <p className="mt-5 sm:mt-6 text-base sm:text-lg leading-relaxed text-oai-gray-400">
                  {copy("landing.v2.hero.subtagline")} {copy("landing.v2.install.availability")}
                </p>

                <div className="mt-8 w-full max-w-lg mx-auto">
                  <motion.div
                    whileHover={{ scale: 1.01, y: -1 }}
                    transition={{ type: "spring", stiffness: 400, damping: 25 }}
                    className="group relative inline-block w-full overflow-hidden rounded-2xl"
                    style={{ padding: "1.5px 0" }}
                  >
                    {/* Star border orbs */}
                    <div
                      className="absolute w-[300%] h-[50%] opacity-70 bottom-[-11px] right-[-250%] rounded-full animate-star-movement-bottom z-0"
                      style={{
                        background: "radial-gradient(circle, #fbdfff, transparent 10%)",
                        animationDuration: "6s",
                      }}
                    />
                    <div
                      className="absolute w-[300%] h-[50%] opacity-70 top-[-10px] left-[-250%] rounded-full animate-star-movement-top z-0"
                      style={{
                        background: "radial-gradient(circle, #fbdfff, transparent 10%)",
                        animationDuration: "6s",
                      }}
                    />

                    <div className="relative z-[1] flex items-center justify-between w-full bg-[#0a0a0a] border border-oai-gray-800 rounded-2xl p-1.5 pl-5 shadow-2xl shadow-black/50">
                      <div className="flex items-center gap-3 overflow-hidden">
                        <span className="text-oai-gray-600 font-mono select-none" aria-hidden="true">›</span>
                        <code className="font-mono text-sm text-oai-gray-200 overflow-x-auto whitespace-nowrap py-2 [scrollbar-width:none]">
                          {installCommand ? installCommand.split(' ').map((part, i) => (
                            <span key={i} className={
                              part === 'npx' || part === 'tokentracker-cli'
                                ? 'text-white font-medium'
                                : part === '--yes'
                                  ? 'text-oai-gray-500'
                                  : 'text-oai-brand-400'
                            }>
                              {part}{' '}
                            </span>
                          )) : null}
                        </code>
                      </div>

                      <button
                        type="button"
                        onClick={onCopyInstallCommand}
                        aria-label={
                          installCopied ? copy("landing.install.action.copied") : copy("landing.install.action.copy")
                        }
                        className="shrink-0 flex h-9 w-9 items-center justify-center text-oai-gray-200 bg-oai-gray-900 border border-oai-gray-700 rounded-lg hover:bg-oai-gray-800 hover:text-white active:scale-95 transition-all duration-200 shadow-sm"
                      >
                        {installCopied ? (
                          <CheckIcon className="h-4 w-4 text-green-400" aria-hidden />
                        ) : (
                          <CopyIcon className="h-4 w-4 opacity-70" aria-hidden />
                        )}
                      </button>
                    </div>
                  </motion.div>
                  
                  {/* Primary native-app download — auto-detects the visitor's OS
                      and deep-links the right installer. A compact centered pill
                      (not full-width) so it balances with the npx command above
                      instead of dominating it. Availability is stated up in the
                      hero subtitle, so no caption here. */}
                  <div className="mt-5 flex justify-center">
                    <a
                      href={nativeDownload.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="group inline-flex h-11 items-center justify-center gap-2 rounded-full bg-white px-7 text-sm font-semibold text-oai-gray-950 shadow-lg shadow-black/30 transition-all duration-200 hover:bg-oai-gray-100 active:scale-[0.98]"
                    >
                      <nativeDownload.Icon className="h-4 w-4" />
                      {nativeDownload.label}
                    </a>
                  </div>

                  {/* Secondary: the other platform(s) by name, plus the source repo. */}
                  <div className="mt-4 flex flex-wrap items-center justify-center gap-x-6 gap-y-3">
                    {secondaryDownloads.map((d) => (
                      <a key={d.href} href={d.href} target="_blank" rel="noopener noreferrer" className="group flex items-center gap-2 text-sm font-medium text-oai-gray-400 hover:text-white transition-colors">
                        <d.Icon className="h-4 w-4 text-oai-gray-500 group-hover:text-white" />
                        {d.label}
                      </a>
                    ))}
                    <a href={REPO_URL} target="_blank" rel="noopener noreferrer" className="group flex items-center gap-2 text-sm font-medium text-oai-gray-400 hover:text-white transition-colors">
                      <GithubIcon className="h-4 w-4 text-oai-gray-500 group-hover:text-white" />
                      {copy("landing.cta.secondary")}
                    </a>
                  </div>
                  <span className="sr-only" aria-live="polite">
                    {installCopied ? copy("landing.install.action.copied") : ""}
                  </span>
                </div>
            </motion.div>

            <div className="relative group w-full">
              <motion.div
                initial={reduceMotion ? false : { opacity: 0, y: 24 }}
                animate={{ opacity: 1, y: 0 }}
                transition={spring || { duration: 0.6, delay: 0.1 }}
                className="relative w-full"
              >
                {/* LaserFlow: z-index低于图片，光柱从天空落在图片顶边 */}
                <div
                  style={{
                    position: 'absolute',
                    top: '-256px',
                    left: 0,
                    right: 0,
                    height: '510px',
                    zIndex: 3,
                    pointerEvents: 'none',
                  }}
                >
                  <LaserFlow
                    color="#8a7aff"
                    wispDensity={2}
                    flowSpeed={0.28}
                    verticalSizing={2.2}
                    horizontalSizing={1.0}
                    fogIntensity={4.0}
                    fogScale={0.1}
                    wispSpeed={18}
                    wispIntensity={6}
                    flowStrength={0.12}
                    decay={1.1}
                    falloffStart={0.95}
                    fogFallSpeed={0.5}
                    horizontalBeamOffset={0.22}
                    verticalBeamOffset={0}
                    style={{ width: '100%', height: '100%' }}
                  />
                </div>

                {/* 图片容器：发亮、暗亮变化的渐变边框 */}
                <div className="relative rounded-xl p-[1px] shadow-2xl bg-gradient-to-b from-[rgba(138,122,255,0.6)] via-[rgba(138,122,255,0.15)] to-[rgba(138,122,255,0.05)]"
                  style={{
                    position: 'relative',
                    zIndex: 10,
                    boxShadow: '0 20px 60px -10px rgba(138,122,255,0.15), 0 4px 20px rgba(0,0,0,0.4)',
                  }}
                >
                  <div className="relative rounded-[11px] overflow-hidden bg-oai-gray-950">
                    {/* 顶部光线渗透渐变 */}
                    <div
                      style={{
                        position: 'absolute',
                        top: 0,
                        left: 0,
                        right: 0,
                        height: '180px',
                        background: 'linear-gradient(to bottom, rgba(138,122,255,0.35) 0%, rgba(138,122,255,0.12) 40%, transparent 100%)',
                        mixBlendMode: 'screen',
                        zIndex: 20,
                        pointerEvents: 'none',
                      }}
                    />
                    {/* 顶部亮线 */}
                    <div
                      style={{
                        position: 'absolute',
                        top: 0,
                        left: 0,
                        right: 0,
                        height: '1px',
                        background: 'linear-gradient(90deg, transparent 0%, rgba(138,122,255,0.9) 30%, rgba(180,168,255,1) 50%, rgba(138,122,255,0.9) 70%, transparent 100%)',
                        zIndex: 25,
                        pointerEvents: 'none',
                      }}
                    />
                    <img
                      src="/dashboard-dark.png"
                      alt={copy("landing.screenshot.alt")}
                      className="block h-auto w-full object-cover"
                      style={{ position: 'relative', zIndex: 10 }}
                      loading="eager"
                      decoding="async"
                    />
                  </div>
                </div>
              </motion.div>
            </div>
          </div>
        </section>

        <section className="border-y border-oai-gray-900 bg-oai-gray-950/50 py-12 lg:py-16">
          <div className="mx-auto max-w-6xl px-4 sm:px-6">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-10">
              <p className="text-sm font-semibold uppercase tracking-wider text-oai-gray-400 shrink-0 md:max-w-[16rem]">
                {copy("landing.v2.models.title")}
              </p>
              <div className="flex justify-center md:justify-end">
                <LogoCarousel logos={AGENT_LOGOS} columnCount={6} />
              </div>
            </div>
          </div>
        </section>

        <section className="border-t border-oai-gray-900 py-14 sm:py-20 lg:py-32 relative bg-oai-gray-950">
          <div className="mx-auto max-w-6xl px-4 sm:px-6 relative z-10">
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 sm:gap-12 lg:gap-8 items-start">
              
              {/* Left Column: Geek Text & Call To Action */}
              <div className="lg:col-span-5 space-y-6 text-left">
                <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-oai-gray-800 bg-[#080808] text-[10px] font-bold tracking-widest uppercase text-oai-gray-400">
                  <span className="relative flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-oai-brand-500 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-oai-brand-500"></span>
                  </span>
                  {copy("landing.v2.leaderboard.kicker")}
                </div>
                
                <h2 className="text-3xl font-semibold tracking-tight text-white sm:text-4xl text-balance leading-tight">
                  {copy("landing.v2.leaderboard.title")}
                </h2>
                
                <p className="text-base leading-relaxed text-oai-gray-400">
                  {copy("landing.v2.leaderboard.subtitle")}
                </p>
                
                <div className="pt-4">
                  <Link
                    to="/leaderboard"
                    className="inline-flex h-9 items-center justify-center rounded-[8px] bg-white px-6 text-xs font-bold text-oai-gray-950 hover:bg-oai-gray-100 transition-all duration-200 shadow-sm active:scale-[0.98] select-none whitespace-nowrap"
                  >
                    {copy("landing.v2.leaderboard.view_more")}
                  </Link>
                </div>
              </div>
              
              {/* Right Column: Unified IDE Console-style Leaderboard Board - perfectly stretched for edge justification */}
              <div className="lg:col-span-7 w-full">
                <TiltedCard rotateMax={4} className="w-full">
                  <BorderGlow
                    edgeSensitivity={30}
                    glowColor="247 100 74"
                    backgroundColor="#09090b"
                    borderRadius={16}
                    glowRadius={35}
                    glowIntensity={1.0}
                    coneSpread={25}
                    animated={false}
                    colors={['#8a7aff', '#f472b6', '#38bdf8']}
                    className="w-full"
                  >
                    {/* Panel Header */}
                    <div className="flex items-center justify-between px-4 sm:px-5 py-3 border-b border-oai-gray-800/80 bg-white/[0.025] backdrop-blur-xs text-[10px] tracking-widest text-oai-gray-500 font-bold uppercase select-none">
                      <span>Community Rankings (Global)</span>
                      <span className="flex items-center gap-1.5 font-mono text-oai-brand-400">
                        <span className="h-1.5 w-1.5 rounded-full bg-oai-brand-500 animate-pulse" />
                        Realtime
                      </span>
                    </div>

                    {/* Table rows list - perfectly justified */}
                    <div className="divide-y divide-oai-gray-800/60">
                      
                      {/* Row 1 - VOLT */}
                      <div className="flex items-center justify-between px-4 sm:px-5 py-4 hover:bg-white/[0.02] transition-colors group">
                        <div className="flex items-center gap-3.5 min-w-0">
                          <span className="font-mono text-xs font-bold text-yellow-500 w-4">01</span>
                          <span className="text-oai-gray-700 font-mono text-xs select-none">›</span>
                          <span className="font-bold text-white text-sm tracking-wide truncate">VOLT</span>
                          <span className="text-[9px] font-bold tracking-widest px-1.5 py-0.5 rounded border border-oai-gray-800 bg-oai-gray-950 text-oai-gray-500 font-mono scale-90">
                            CHAMP
                          </span>
                        </div>
                        <div className="flex items-center gap-6 shrink-0">
                          {/* Micro spark progress bar */}
                          <div className="hidden sm:block w-16 h-[2px] bg-oai-gray-950 rounded-full overflow-hidden">
                            <div className="h-full bg-yellow-500 w-[98.4%]" />
                          </div>
                          <div className="text-right">
                            <div className="text-sm font-semibold text-white font-mono leading-none">1,420,850</div>
                            <div className="text-[10px] text-yellow-500 font-semibold font-mono mt-1">98.4% Eff.</div>
                          </div>
                        </div>
                      </div>

                      {/* Row 2 - ALEX */}
                      <div className="flex items-center justify-between px-4 sm:px-5 py-4 hover:bg-white/[0.02] transition-colors group">
                        <div className="flex items-center gap-3.5 min-w-0">
                          <span className="font-mono text-xs font-bold text-oai-gray-500 w-4">02</span>
                          <span className="text-oai-gray-700 font-mono text-xs select-none">›</span>
                          <span className="font-semibold text-oai-gray-200 text-sm tracking-wide truncate">ALEX</span>
                        </div>
                        <div className="flex items-center gap-6 shrink-0">
                          <div className="hidden sm:block w-16 h-[2px] bg-oai-gray-950 rounded-full overflow-hidden">
                            <div className="h-full bg-oai-gray-600 w-[92.1%]" />
                          </div>
                          <div className="text-right">
                            <div className="text-sm font-medium text-oai-gray-300 font-mono leading-none">924,110</div>
                            <div className="text-[10px] text-oai-gray-400 font-medium font-mono mt-1">92.1% Eff.</div>
                          </div>
                        </div>
                      </div>

                      {/* Row 3 - CHARLIE */}
                      <div className="flex items-center justify-between px-4 sm:px-5 py-4 hover:bg-white/[0.02] transition-colors group">
                        <div className="flex items-center gap-3.5 min-w-0">
                          <span className="font-mono text-xs font-bold text-oai-gray-500 w-4">03</span>
                          <span className="text-oai-gray-700 font-mono text-xs select-none">›</span>
                          <span className="font-semibold text-oai-gray-200 text-sm tracking-wide truncate">CHARLIE</span>
                        </div>
                        <div className="flex items-center gap-6 shrink-0">
                          <div className="hidden sm:block w-16 h-[2px] bg-oai-gray-950 rounded-full overflow-hidden">
                            <div className="h-full bg-oai-gray-600 w-[89.5%]" />
                          </div>
                          <div className="text-right">
                            <div className="text-sm font-medium text-oai-gray-300 font-mono leading-none">740,560</div>
                            <div className="text-[10px] text-oai-gray-400 font-medium font-mono mt-1">89.5% Eff.</div>
                          </div>
                        </div>
                      </div>

                    </div>

                    {/* IDE-style bottom Status Bar */}
                    <div className="px-4 sm:px-5 py-2.5 border-t border-oai-gray-800/80 bg-black/[0.15] flex items-center justify-between text-[9px] font-mono tracking-widest text-oai-gray-600 select-none">
                      <span>SYSTEM: // LEADERBOARD_PREVIEW_FEED</span>
                      <span>42 DAY ACTIVE STREAK</span>
                    </div>
                  </BorderGlow>
                </TiltedCard>
              </div>
              
            </div>
          </div>
        </section>

        <section className="py-14 sm:py-20 lg:py-32 border-t border-oai-gray-900/60 bg-[#0c0c0e]">
          <div className="mx-auto max-w-6xl px-4 sm:px-6 grid grid-cols-1 lg:grid-cols-12 gap-10 sm:gap-12 lg:gap-16 items-start">
            
            {/* Left Column - Purified to reduce height */}
            <div className="lg:col-span-5 max-w-md text-left">
              <p className="text-xs font-bold tracking-widest uppercase text-oai-brand-500">
                {copy("landing.v2.compare.kicker")}
              </p>
              <h2 className="mt-4 text-3xl font-semibold tracking-tight text-white sm:text-4xl text-balance leading-tight">
                {copy("landing.v2.compare.title")}
              </h2>
              <p className="mt-6 text-sm leading-relaxed text-oai-gray-400">
                {copy("landing.v2.compare.subtitle")}
              </p>
            </div>

            {/* Right Column - Enriched with 4 items & footer commands to raise height */}
            <div className="lg:col-span-7 grid grid-cols-1 sm:grid-cols-2 gap-x-8 sm:gap-x-12 gap-y-8 sm:gap-y-10 w-full">
              
              {/* With Column - Terminal Diff Style */}
              <div className="space-y-5">
                <div className="border-t border-oai-gray-800/80 pt-4">
                  <h3 className="text-xs font-mono font-bold tracking-widest text-white flex items-center gap-2 select-none">
                    <span className="text-oai-brand-400">[+]</span>
                    {copy("landing.v2.compare.with.title")}
                  </h3>
                </div>
                <ul className="space-y-4 mt-5 text-xs font-mono text-oai-gray-300">
                  <li className="flex gap-2.5 items-start">
                    <span className="text-oai-brand-400 shrink-0 font-bold select-none">+</span>
                    <span className="leading-relaxed">{copy("landing.v2.compare.with.p1")}</span>
                  </li>
                  <li className="flex gap-2.5 items-start">
                    <span className="text-oai-brand-400 shrink-0 font-bold select-none">+</span>
                    <span className="leading-relaxed">{copy("landing.v2.compare.with.p2")}</span>
                  </li>
                  <li className="flex gap-2.5 items-start">
                    <span className="text-oai-brand-400 shrink-0 font-bold select-none">+</span>
                    <span className="leading-relaxed">{copy("landing.v2.compare.with.p3")}</span>
                  </li>
                  <li className="flex gap-2.5 items-start">
                    <span className="text-oai-brand-400 shrink-0 font-bold select-none">+</span>
                    <span className="leading-relaxed">{copy("landing.v2.compare.with.p4")}</span>
                  </li>
                </ul>
              </div>

              {/* Without Column - Terminal Diff Style */}
              <div className="space-y-5">
                <div className="border-t border-oai-gray-800/80 pt-4">
                  <h3 className="text-xs font-mono font-bold tracking-widest text-oai-gray-500 flex items-center gap-2 select-none">
                    <span className="text-oai-gray-600">[-]</span>
                    {copy("landing.v2.compare.without.title")}
                  </h3>
                </div>
                <ul className="space-y-4 mt-5 text-xs font-mono text-oai-gray-500">
                  <li className="flex gap-2.5 items-start">
                    <span className="text-oai-gray-600 shrink-0 font-bold select-none">-</span>
                    <span className="leading-relaxed text-oai-gray-400">{copy("landing.v2.compare.without.p1")}</span>
                  </li>
                  <li className="flex gap-2.5 items-start">
                    <span className="text-oai-gray-600 shrink-0 font-bold select-none">-</span>
                    <span className="leading-relaxed text-oai-gray-400">{copy("landing.v2.compare.without.p2")}</span>
                  </li>
                  <li className="flex gap-2.5 items-start">
                    <span className="text-oai-gray-600 shrink-0 font-bold select-none">-</span>
                    <span className="leading-relaxed text-oai-gray-400">{copy("landing.v2.compare.without.p3")}</span>
                  </li>
                  <li className="flex gap-2.5 items-start">
                    <span className="text-oai-gray-600 shrink-0 font-bold select-none">-</span>
                    <span className="leading-relaxed text-oai-gray-400">{copy("landing.v2.compare.without.p4")}</span>
                  </li>
                </ul>
              </div>

            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-oai-gray-900 bg-oai-gray-950 py-12">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-6 px-4 sm:px-6 text-sm text-oai-gray-400 sm:flex-row">
          <p>{copy("landing.v2.footer.line")}</p>
          <div className="flex items-center gap-6">
            <a
              href={STATUSPAGE_URL}
              className="font-medium text-oai-gray-400 hover:text-white transition-colors"
              target="_blank"
              rel="noopener noreferrer"
            >
              {copy("landing.v2.nav.status")}
            </a>
            <a
              href={REPO_URL}
              className="font-medium text-oai-gray-400 hover:text-white transition-colors"
              target="_blank"
              rel="noopener noreferrer"
            >
              {copy("landing.v2.nav.github")}
            </a>
            {isLocalMode && (
              <Link
                to={signInUrl}
                className="font-medium text-oai-brand-500 hover:text-oai-brand-400 transition-colors"
              >
                {copy("landing.cta.primary")} &rarr;
              </Link>
            )}
          </div>
        </div>
      </footer>
    </div>
  );
}
