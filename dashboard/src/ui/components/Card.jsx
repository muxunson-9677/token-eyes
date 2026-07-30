import React from "react";

/**
 * Card - 简化版卡片组件
 */
export function Card({
  children,
  title,
  subtitle,
  variant = "default",
  className = "",
  bodyClassName = "",
}) {
  const surfaceClassName =
    variant === "nested" ? "tt-surface-nested" : "tt-surface";

  return (
    <div className={`${surfaceClassName} rounded-[var(--tt-card-radius)] transition-colors duration-200 ${className}`}>
      {(title || subtitle) && (
        <div className="px-5 py-4 border-b border-oai-gray-200 dark:border-oai-gray-800 transition-colors duration-200">
          {title && (
            <h3 className="text-sm font-medium text-oai-gray-500 dark:text-oai-gray-300 uppercase tracking-wide transition-colors duration-200">{title}</h3>
          )}
          {subtitle && (
            <p className="text-sm text-oai-gray-500 dark:text-oai-gray-300 mt-1 transition-colors duration-200">{subtitle}</p>
          )}
        </div>
      )}
      <div className={`p-5 ${bodyClassName}`}>{children}</div>
    </div>
  );
}
