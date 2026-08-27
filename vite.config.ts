import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  base: '/RMS-catalogue/',
  define: {
    __APP_VERSION__: JSON.stringify(`v${process.env.npm_package_version ?? '0.1.0'}`),
    __BUILD_REF__: JSON.stringify(process.env.GITHUB_SHA?.slice(0, 7) ?? 'local'),
  },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon-192.png', 'icon-512.png'],
      manifest: {
        name: 'RMS Catalogue Selection',
        short_name: 'RMS Catalogue',
        description: 'Select RMS catalogue artworks and generate a working Word document.',
        theme_color: '#343b3e',
        background_color: '#2b3033',
        display: 'standalone',
        start_url: '/RMS-catalogue/',
        scope: '/RMS-catalogue/',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
        ],
      },
      workbox: {
        navigateFallback: '/RMS-catalogue/index.html',
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        runtimeCaching: [{ urlPattern: /^https:\/\/docs\.google\.com\/spreadsheets\//, handler: 'NetworkOnly' }],
      },
    }),
  ],
})
