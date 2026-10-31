import path from 'path'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'
import { inspectAttr } from 'kimi-plugin-inspect-react'

export default defineConfig({
  base: './',
  plugins: [
    inspectAttr(),
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['demo.mp4', 'icon.svg'],
      manifest: {
        name: 'VELM — Local Video Studio',
        short_name: 'VELM',
        description: 'Private, browser-only video editing with on-device AI.',
        theme_color: '#171814',
        background_color: '#171814',
        display: 'standalone',
        start_url: './',
        icons: [
          { src: './icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: './icon-512.png', sizes: '512x512', type: 'image/png' },
        ],
      },
      workbox: {
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
        globPatterns: ['**/*.{js,css,html,png,svg,mp4,woff2}'],
        navigateFallback: 'index.html',
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.pathname.endsWith('.wasm'),
            handler: 'CacheFirst',
            options: { cacheName: 'velm-wasm-runtime', expiration: { maxEntries: 4 } },
          },
        ],
      },
    }),
  ],
  server: { port: 3000 },
  resolve: { alias: { '@': path.resolve(__dirname, './src') } },
  worker: { format: 'es' },
})
