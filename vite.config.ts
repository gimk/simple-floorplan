import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      // 'autoUpdate': a new service worker skips waiting and takes control at once. Pages are
      // network-first (see runtimeCaching), so a refresh shows a new deploy right away.
      registerType: 'autoUpdate',
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
        // Large chunks (pdfjs) must be precached too, or the app breaks offline.
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
        cleanupOutdatedCaches: true,
        // Disable vite-plugin-pwa's default NavigationRoute to index.html and workbox's
        // directoryIndex (/ -> index.html) so precache does not answer navigations.
        navigateFallback: null,
        directoryIndex: null,
        // Page loads go to the network first, so one refresh after a deploy gives the new
        // index.html (and with it the new hashed bundles). The cached page is used only offline
        // or when the network is slower than 3 s.
        runtimeCaching: [
          {
            urlPattern: ({ request }) => request.mode === 'navigate',
            handler: 'NetworkFirst',
            options: {
              cacheName: 'pages',
              networkTimeoutSeconds: 3,
              matchOptions: { ignoreSearch: true },
              expiration: { maxEntries: 10 },
              plugins: [
                {
                  handlerDidError: async () =>
                    (await (
                      globalThis as unknown as {
                        caches: {
                          match: (req: string, opts: { ignoreSearch: boolean }) => Promise<Response | undefined>
                        }
                      }
                    ).caches.match('/index.html', { ignoreSearch: true })) ?? Response.error(),
                },
              ],
            },
          },
        ],
      },
    }),
  ],  server: { proxy: { '/api': 'http://localhost:8788' } },
})
