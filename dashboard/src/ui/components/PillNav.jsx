import React, { useEffect, useId, useRef, useState } from "react";
import { LayoutGroup, motion, useReducedMotion } from "motion/react";

const INDICATOR_DURATION_SECONDS = 0.19;

export function PillNav({
  value,
  options,
  onValueChange,
  ariaLabel,
}) {
  const groupId = useId();
  const rootRef = useRef(null);
  const buttonRefs = useRef(new Map());
  const optionValues = options.map((option) => option.value);
  const optionKey = optionValues.join("\u0000");
  const selectedValue = optionValues.includes(value) ? value : optionValues[0];
  const [previewValue, setPreviewValue] = useState(null);
  const [rovingValue, setRovingValue] = useState(selectedValue);
  const shouldReduceMotion = Boolean(useReducedMotion());
  const visiblePreview = optionValues.includes(previewValue)
    ? previewValue
    : selectedValue;

  useEffect(() => {
    const hasFocus = rootRef.current?.contains(document.activeElement);
    if (!hasFocus || !optionValues.includes(rovingValue)) {
      setRovingValue(selectedValue);
    }
    if (previewValue != null && !optionValues.includes(previewValue)) {
      setPreviewValue(null);
    }
  }, [optionKey, previewValue, rovingValue, selectedValue]);

  const moveFocus = (currentValue, offset) => {
    const currentIndex = optionValues.indexOf(currentValue);
    if (currentIndex < 0 || options.length === 0) return;
    const nextIndex = (currentIndex + offset + options.length) % options.length;
    const nextValue = options[nextIndex].value;
    setRovingValue(nextValue);
    setPreviewValue(nextValue);
    buttonRefs.current.get(nextValue)?.focus();
  };

  return (
    <LayoutGroup id={groupId}>
      <nav
        ref={rootRef}
        className="pill-nav"
        aria-label={ariaLabel}
        data-preview-value={visiblePreview}
        data-reduced-motion={shouldReduceMotion ? "true" : "false"}
        onMouseLeave={() => setPreviewValue(null)}
        onBlur={(event) => {
          if (event.currentTarget.contains(event.relatedTarget)) return;
          setPreviewValue(null);
          setRovingValue(selectedValue);
        }}
      >
        {options.map((option) => {
          const isSelected = option.value === selectedValue;
          const isPreview = option.value === visiblePreview;
          return (
            <button
              ref={(node) => {
                if (node) buttonRefs.current.set(option.value, node);
                else buttonRefs.current.delete(option.value);
              }}
              type="button"
              className="pill-nav__item"
              aria-pressed={isSelected}
              tabIndex={option.value === rovingValue ? 0 : -1}
              key={option.value}
              onMouseEnter={() => setPreviewValue(option.value)}
              onFocus={() => {
                setRovingValue(option.value);
                setPreviewValue(option.value);
              }}
              onClick={() => onValueChange(option.value)}
              onKeyDown={(event) => {
                if (event.key === "ArrowRight") {
                  event.preventDefault();
                  moveFocus(option.value, 1);
                } else if (event.key === "ArrowLeft") {
                  event.preventDefault();
                  moveFocus(option.value, -1);
                }
              }}
            >
              {isPreview ? (
                <motion.span
                  className="pill-nav__indicator"
                  layoutId="pill-nav-indicator"
                  data-testid="pill-nav-indicator"
                  data-motion-duration={
                    shouldReduceMotion ? 0 : INDICATOR_DURATION_SECONDS
                  }
                  transition={
                    shouldReduceMotion
                      ? { duration: 0 }
                      : {
                        duration: INDICATOR_DURATION_SECONDS,
                        ease: [0.22, 1, 0.36, 1],
                      }
                  }
                  aria-hidden
                />
              ) : null}
              <span className="pill-nav__label">{option.label}</span>
            </button>
          );
        })}
      </nav>
    </LayoutGroup>
  );
}
