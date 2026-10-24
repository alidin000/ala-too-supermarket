/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'
import type { ProxyOptions } from 'vite'

export default defineConfig(({ mode }) => {
  // VITE_DEV_API_PROXY lets a developer point the dev proxy at another Django port.
  const env = loadEnv(mode, '.', '')
  const apiTarget = env.VITE_DEV_API_PROXY || 'http://127.0.0.1:8000'

  // changeOrigin: false keeps the browser's Host (localhost:5173), as in production where
  // Django serves the app and the API on one origin. The staff session cookie, the CSRF
  // origin check and SameSite=Strict then behave exactly as they do live.
  const toDjango: ProxyOptions = { target: apiTarget, changeOrigin: false }

  return {
    plugins: [react()],
    // History fallback: /admin, /admin/orders/AT-000123 and /admin/login get index.html in
    // `vite` and `vite preview`, like Django's catch-all in production.
    appType: 'spa',
    server: {
      proxy: {
        '/api': toDjango,
        // Django admin ("Расширенные настройки" for superusers) and its CSS/JS.
        '/backoffice': toDjango,
        '/static': toDjango,
      },
    },
    test: {
      include: ['src/**/*.test.ts'],
      environment: 'node',
    },
  }
})
