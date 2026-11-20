import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const API = process.env.VITE_API_PROXY || 'http://localhost:4000';

export default defineConfig(({ mode }) => {
  // Vite only reads client/.env* and only exposes VITE_-prefixed variables to the browser bundle.
  // The Gemini key lives in the project-root .env, which Vite never loads. As a safety net, refuse to
  // start/build if a secret-looking variable would be shipped to the browser.
  const exposed = Object.keys(loadEnv(mode, process.cwd(), 'VITE_'));
  const leaked = exposed.filter((k) => /GEMINI|API_KEY|SECRET|TOKEN|PASS|SMTP/i.test(k));
  if (leaked.length) {
    throw new Error(`Refusing to expose secrets to the browser: remove ${leaked.join(', ')} from client/.env. Backend secrets belong in the root .env.`);
  }

  return {
    plugins: [react(), tailwindcss()],
    server: {
      port: 5173,
      // changeOrigin: false keeps the browser's Host header, so the API recognises proxied requests as
      // same-origin whichever port/address Vite is served on (5173, 5174, LAN IP…).
      proxy: {
        '/api': { target: API, changeOrigin: false },
        '/uploads': { target: API, changeOrigin: false },
      },
    },
    build: {
      chunkSizeWarningLimit: 900,
    },
  };
});
