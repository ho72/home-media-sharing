/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_MAPTILER_KEY?: string;
  readonly VITE_UPLOAD_API_BASE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
