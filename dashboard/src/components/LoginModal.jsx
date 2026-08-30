import React, { useEffect, useRef } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { X } from "lucide-react";
import { useInsforgeAuth } from "../contexts/InsforgeAuthContext.jsx";
import { useLoginModal } from "../contexts/LoginModalContext.jsx";
import { LoginCard } from "./LoginCard.jsx";
import { copy } from "../lib/copy";

export function LoginModal() {
  const { isOpen, options, closeLoginModal } = useLoginModal();
  const { enabled, activateAuth } = useInsforgeAuth();
  const dialogRef = useRef(null);
  const closeButtonRef = useRef(null);
  const reduceMotion = useReducedMotion();

  // Keep keyboard interaction inside the dialog while it is open.
  useEffect(() => {
    if (!isOpen) return;
    activateAuth?.();
    const previouslyFocused = document.activeElement;
    const frame = window.requestAnimationFrame(() => closeButtonRef.current?.focus());
    const onKey = (e) => {
      if (e.key === "Escape") {
        closeLoginModal();
        return;
      }
      if (e.key !== "Tab") return;
      const focusable = Array.from(
        dialogRef.current?.querySelectorAll(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ) || [],
      );
      if (focusable.length === 0) {
        e.preventDefault();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      const activeIsFocusable = focusable.includes(active);
      if (e.shiftKey && (active === first || !activeIsFocusable)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (active === last || !activeIsFocusable)) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("keydown", onKey);
      previouslyFocused?.focus?.();
    };
  }, [activateAuth, isOpen, closeLoginModal]);

  if (!enabled) return null;

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          className="tt-modal-motion fixed inset-0 z-[100] flex items-center justify-center p-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: reduceMotion ? 0 : 0.2 }}
        >
          {/* Backdrop */}
          <motion.div
            aria-hidden="true"
            className="tt-modal-backdrop tt-modal-motion absolute inset-0"
            onClick={closeLoginModal}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: reduceMotion ? 0 : 0.2 }}
          />

          {/* Card Wrapper */}
          <motion.div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-label={copy("login.title")}
            className="tt-surface tt-modal-popup tt-modal-motion tt-login-focus-scope relative w-full max-w-[420px] overflow-hidden rounded-[var(--tt-card-radius)]"
            initial={reduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.95, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={reduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.95, y: 10 }}
            transition={{ duration: reduceMotion ? 0 : 0.2 }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Close button */}
            <button
              ref={closeButtonRef}
              type="button"
              aria-label={copy("login.dismiss")}
              onClick={closeLoginModal}
              className="tt-pressable tt-product-focusable absolute right-4 top-4 z-10 grid h-8 w-8 place-items-center rounded-[var(--tt-control-radius)] text-oai-gray-400 hover:bg-white/70 hover:text-oai-black dark:text-oai-gray-500 dark:hover:bg-white/10 dark:hover:text-white"
            >
              <X className="h-5 w-5" />
            </button>

            {/* LoginCard Form */}
            <LoginCard
              emailOnly={options?.emailOnly === true}
              title={options?.leaderboardParticipation === true
                ? copy("login_modal.subtitle")
                : copy("login.title")}
              onSuccess={closeLoginModal}
              className="p-6 bg-transparent"
            />
            {options?.leaderboardParticipation === true ? (
              <div className="tt-surface-nested mx-6 mb-6 rounded-[var(--tt-control-radius)] px-4 py-3 text-xs leading-relaxed text-oai-gray-500 dark:text-oai-gray-400">
                <p>{copy("login_modal.leaderboard_participation")}</p>
                <p className="mt-1">{copy("login_modal.upload_boundary")}</p>
                <p className="mt-1">{copy("login_modal.delete_participation")}</p>
              </div>
            ) : null}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
