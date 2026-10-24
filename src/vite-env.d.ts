/// <reference types="vite/client" />

interface ViteTypeOptions {
  strictImportMetaEnv: unknown
}

interface ImportMetaEnv {
  /** API base path or URL. Defaults to "/api", which Vite proxies to Django in dev. */
  readonly VITE_API_BASE_URL?: string
  /** "1" runs the in-browser demo API with a visible "Демо-режим" banner. */
  readonly VITE_USE_MOCK?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
