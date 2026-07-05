import { fileURLToPath } from 'node:url';
import node from '@astrojs/node';
import vercel from '@astrojs/vercel';
import react from '@astrojs/react';
import sitemap from '@astrojs/sitemap';
import sentry from '@sentry/astro';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'astro/config';

const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
const isVercel = !!process.env.VERCEL;

export default defineConfig({
  output: 'server',
  site: process.env.PUBLIC_SITE_URL ?? 'https://mnema.example.com',
  security: {
    // JWT-based auth on every API request makes Astro's CSRF origin check
    // redundant — and it blocks multipart form POSTs from the browser.
    checkOrigin: false,
  },
  // Use @astrojs/vercel when building on Vercel; fall back to standalone
  // Node.js server for local dev and manual builds.
  adapter: isVercel ? vercel() : node({ mode: 'standalone' }),
  integrations: [
    react(),
    sitemap(),
    sentry({
      dsn: process.env.SENTRY_DSN,
      environment: process.env.SENTRY_ENVIRONMENT ?? 'development',
      tracesSampleRate: 0.1,
    }),
  ],
  server: { port: 5173 },
  vite: {
    envDir: repoRoot,
    plugins: [tailwindcss()],
    server: {
      proxy: {
        '/api': {
          target: 'http://localhost:8080',
          changeOrigin: true,
        },
      },
    },
  },
});

