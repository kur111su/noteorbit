import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({
  base: './',
  plugins: [
    react(),
    {
      name: 'local-development-csp',
      apply: 'serve',
      transformIndexHtml(html) {
        // React's development refresh preamble is inline. The production CSP stays strict.
        return html
          .replace("script-src 'self'", "script-src 'self' 'unsafe-inline'")
          .replace("frame-src 'none'", "frame-src 'self'");
      },
    },
  ],
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    watch: { ignored: ['**/release/**', '**/.runtime/**'] },
  },
  build: { target: 'chrome130', sourcemap: true },
});
