export type NativeTheme = "light" | "dark" | "system";
export type NativeSettingValue =
  | string
  | number
  | boolean
  | null
  | readonly NativeSettingValue[]
  | { readonly [key: string]: NativeSettingValue };
export type NativeSettings = Readonly<Record<string, NativeSettingValue>>;

export function getCachedNativeSystemDark(): boolean | null;
export function subscribeNativeSystemAppearance(
  callback: (isDark: boolean) => void,
): () => void;

export function isNativeApp(): boolean;
export function isTauriApp(): boolean;
export function isNativeEmbed(): boolean;
export function isNativeWindowsApp(): boolean;
export function isBridgeAvailable(): boolean;

export function requestNativeSettings(): boolean;
export function setNativeSetting(key: string, value: NativeSettingValue): boolean;
export function nativeAction(name: string): boolean;
export function requestNativeSystemAppearance(): boolean;
export function syncNativeChromeAppearance(
  resolvedTheme: Exclude<NativeTheme, "system">,
  theme: NativeTheme,
): void;
export function onNativeSettings(
  handler: (settings: NativeSettings) => void,
): () => void;