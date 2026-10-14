import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { execSync } from 'child_process';
import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

// Which commit this build came from. The checkout payload carries it
// (p_sale_data.clientBuild), so the server can count calls per app version.
// Vercel provides the SHA; a local build asks git; otherwise 'dev'.
function resolveAppBuild(): string {
  const vercelSha = (process.env.VERCEL_GIT_COMMIT_SHA || '').trim();
  if (vercelSha) return vercelSha.slice(0, 7);
  try {
    const sha = execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();
    if (/^[0-9a-f]{4,40}$/i.test(sha)) return sha;
  } catch {
    // Not a git checkout, or git is not installed.
  }
  return 'dev';
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '');
  const appBuild = resolveAppBuild();
  return {
    define: {
      __APP_BUILD__: JSON.stringify(appBuild),
    },
    plugins: [
      react(),
      tailwindcss(),
      VitePWA({
        registerType: 'prompt',
        includeAssets: ['favicon.ico', 'apple-touch-icon.png', 'mask-icon.svg', 'icon.png'],
        manifest: {
          name: 'VapeTrax POS',
          short_name: 'VapeTrax',
          description: 'Premium Vape Shop Management System',
          theme_color: '#8b5cf6',
          background_color: '#f3f4f9',
          display: 'standalone',
          orientation: 'portrait',
          icons: [
            {
              src: 'icon.png',
              sizes: '192x192',
              type: 'image/png'
            },
            {
              src: 'icon.png',
              sizes: '512x512',
              type: 'image/png'
            },
            {
              src: 'icon.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'any maskable'
            }
          ]
        },
        workbox: {
          globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
          runtimeCaching: [
            {
              urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
              handler: 'CacheFirst',
              options: {
                cacheName: 'google-fonts-cache',
                expiration: {
                  maxEntries: 10,
                  maxAgeSeconds: 60 * 60 * 24 * 365, // 365 days
                },
                cacheableResponse: {
                  statuses: [0, 200],
                },
              },
            },
            {
              urlPattern: /^https:\/\/fonts\.gstatic\.com\/.*/i,
              handler: 'CacheFirst',
              options: {
                cacheName: 'gstatic-fonts-cache',
                expiration: {
                  maxEntries: 10,
                  maxAgeSeconds: 60 * 60 * 24 * 365, // 365 days
                },
                cacheableResponse: {
                  statuses: [0, 200],
                },
              },
            },
            // Supabase API should NOT be cached by workbox in a way that breaks it.
            // VitePWA defaults to letting them pass through, but we can be explicit.
            {
              urlPattern: /supabase\.co/,
              handler: 'NetworkOnly',
            }
          ]
        }
      })
    ],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modifyâ€”file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
    },
  };
});
