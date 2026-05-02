/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_DISABLE_DEV_SEEDS?: string;
}

declare const __STUDIO_API_URL__: string;
declare const __STUDIO_API_TOKEN__: string;
