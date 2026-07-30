import React from "react";

/**
 * Button - OpenAI 风格的按钮组件
 *
 * @param {Object} props
 * @param {React.ReactNode} props.children - 按钮内容
 * @param {'primary'|'secondary'|'ghost'} [props.variant='primary'] - 按钮变体
 * @param {'sm'|'md'|'lg'} [props.size='md'] - 按钮尺寸
 * @param {function} [props.onClick] - 点击事件处理函数
 * @param {boolean} [props.disabled=false] - 是否禁用
 * @param {string} [props.className] - 额外的 CSS 类名
 * @param {React.ElementType} [props.as] - 渲染的元素类型
 */
export function Button({
  children,
  variant = "primary",
  size = "md",
  onClick,
  disabled = false,
  className = "",
  as: Component = "button",
  ...props
}) {
  const baseStyles =
    "tt-pressable inline-flex items-center justify-center rounded-[var(--tt-control-radius)] font-medium focus:outline-none focus:ring-2 focus:ring-oai-blue/30";

  const variantStyles = {
    primary:
      "border border-transparent bg-oai-black text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.22),0_1px_2px_rgba(15,23,42,0.2)] hover:bg-oai-gray-800 active:bg-oai-gray-900 disabled:bg-oai-gray-300 disabled:text-oai-gray-500 focus:ring-oai-brand/30 dark:bg-oai-white dark:text-oai-black dark:hover:bg-oai-gray-200 dark:active:bg-oai-gray-300 dark:disabled:bg-oai-gray-700 dark:disabled:text-oai-gray-400",
    secondary:
      "border border-white/80 bg-oai-white text-oai-black shadow-[inset_0_1px_0_rgba(255,255,255,0.95),inset_0_-1px_0_rgba(15,23,42,0.08),0_1px_2px_rgba(15,23,42,0.1)] hover:border-oai-brand hover:text-oai-brand active:border-oai-brand-dark active:bg-oai-gray-50 disabled:border-oai-gray-200 disabled:text-oai-gray-400 focus:ring-oai-brand/30 dark:border-white/10 dark:bg-oai-gray-900 dark:text-oai-white dark:hover:border-oai-brand dark:active:bg-oai-gray-800 dark:disabled:border-oai-gray-700 dark:disabled:text-oai-gray-500",
    ghost:
      "border border-transparent bg-transparent text-oai-gray-600 hover:bg-oai-brand-50/50 hover:text-oai-brand active:bg-oai-brand-50 disabled:text-oai-gray-400 focus:ring-oai-brand/30 dark:text-oai-gray-300 dark:hover:bg-oai-brand-950/30 dark:active:bg-oai-brand-900/50 dark:disabled:text-oai-gray-500",
  };

  const sizeStyles = {
    sm: "h-8 px-3 text-sm",
    md: "h-10 px-4 text-sm",
    lg: "h-12 px-6 text-base",
  };

  const disabledStyles = disabled
    ? "cursor-not-allowed opacity-60"
    : "cursor-pointer";

  const mergedClassName = `${baseStyles} ${variantStyles[variant]} ${sizeStyles[size]} ${disabledStyles} ${className}`;
  const isLiteralAnchor = Component === "a";
  const isCustomLink = typeof Component !== "string" && props.href != null;
  const isDisabledLink = disabled && (isLiteralAnchor || isCustomLink);
  const suppressInteraction = (event) => {
    event.preventDefault();
    event.stopPropagation();
  };
  const handleClick = disabled
    ? suppressInteraction
    : onClick;
  const disabledProps = isDisabledLink
    ? {
        href: undefined,
        disabled: undefined,
        "aria-disabled": true,
        tabIndex: -1,
        onAuxClick: suppressInteraction,
        ...(props.role == null ? { role: "link" } : {}),
      }
    : { disabled };

  return (
    <Component
      {...props}
      {...disabledProps}
      className={mergedClassName}
      onClick={handleClick}
    >
      {children}
    </Component>
  );
}
