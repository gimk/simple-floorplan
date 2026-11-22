import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      // 'prompt' instead of 'autoUpdate': the new service worker is downloaded and
      // precached in the background, but it only takes over when the user taps
      // "Reload" in the update toast (src/features/projects/UpdateToast.tsx). An
      // automatic reload in the middle of a survey would be disruptive.
      registerType: 'prompt',
      includeAssets: ['icon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'Simple Floorplan',
        short_name: 'Floorplan',
        description: 'Draw a floorplan and measure it on site, offline.',
        theme_color: '#c2410c',
        background_color: '#ffffff',
        display: 'standalone',
        start_url: '/',
        scope: '/',
        icons: [
          { src: 'pwa-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'pwa-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          { src: 'icon.svg', sizes: 'any', type: 'image/svg+xml' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        // Large chunks (pdfjs, jspdf) must be precached too, or the app breaks offline.
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
        navigateFallback: 'index.html',
        navigateFallbackDenylist: [/^\/api\//],
        cleanupOutdatedCaches: true,
        // Only these two API calls are cached. Every other /api call goes straight
        // to the network (the outbox handles offline writes).
        runtimeCaching: [
          {
            urlPattern: ({ url, request }) => request.method === 'GET' && url.pathname.startsWith('/api/images/'),
            handler: 'CacheFirst',
            options: {
              cacheName: 'fp-images',
              expiration: { maxEntries: 300, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [200] },
            },
          },
          {
            // Share-link viewers send a Bearer token: do not cache their responses in this browser.
            urlPattern: ({ url, request }) => request.method === 'GET' && !request.headers.has('Authorization') && /^\/api\/projects\/[^/]+$/.test(url.pathname),
            handler: 'NetworkFirst',
            options: {
              cacheName: 'fp-projects',
              networkTimeoutSeconds: 4,
              expiration: { maxEntries: 30 },
              cacheableResponse: { statuses: [200] },
            },
          },
        ],
      },
    }),
  ],
  server: { proxy: { '/api': 'http://localhost:8788' } },
})
