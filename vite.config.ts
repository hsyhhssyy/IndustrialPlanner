import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { APP_VERSION } from './src/migrations/versioning'
import { DEFAULT_ZH_APP_TITLE, formatDocumentTitle } from './src/app/documentTitle'

function resolveReleaseTag() {
  const releaseTag = process.env.VITE_RELEASE_TAG?.trim()
  return releaseTag && releaseTag.length > 0 ? releaseTag : APP_VERSION
}

// https://vite.dev/config/
export default defineConfig({
  define: {
    'import.meta.env.VITE_DOCUMENT_TITLE': JSON.stringify(formatDocumentTitle(DEFAULT_ZH_APP_TITLE, resolveReleaseTag())),
  },
  base: './',
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    allowedHosts: true,
  },
})
