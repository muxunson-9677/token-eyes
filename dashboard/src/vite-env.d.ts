interface ImportMetaEnv {
  readonly DEV: boolean;
  readonly VITE_APP_VERSION?: string;
  readonly APP_VERSION?: string;
  readonly VITE_TOKENTRACKER_HTTP_TIMEOUT_MS?: string;
  readonly VITE_TOKENTRACKER_MOCK?: string;
  readonly VITE_TOKENTRACKER_MOCK_NOW?: string;
  readonly VITE_TOKENTRACKER_MOCK_TODAY?: string;
  readonly VITE_TOKENTRACKER_MOCK_SEED?: string;
  readonly VITE_TOKENTRACKER_MOCK_MISSING?: string;
  readonly VITE_TOKENTRACKER_BACKEND_BASE_URL?: string;
  readonly VITE_TOKENTRACKER_BACKEND_ANON_KEY?: string;
  readonly VITE_INSFORGE_BASE_URL?: string;
  readonly VITE_INSFORGE_ANON_KEY?: string;
  readonly VITE_LEADERBOARD_PUBLIC_BASE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare module "*?raw" {
  const content: string;
  export default content;
}
