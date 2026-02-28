import { defineConfig } from 'vite';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
// Root models/ directory — served at /models/ during dev (mirrors nginx in prod)
const MODELS_DIR = path.resolve(__dirname, '../models');

const COOP_HEADERS = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
};

export default defineConfig({
  // Required for SharedArrayBuffer used by picoLLM-web and Cheetah-web
  server: {
    headers: COOP_HEADERS,
    // Allow Vite to serve files from outside webapp/ (needed for ../models)
    fs: { allow: ['..'] },
  },
  preview: {
    headers: COOP_HEADERS,
  },
  plugins: [
    {
      // Dev-only: serve root models/ directory at /models/ — mirrors nginx prod behavior
      name: 'serve-root-models',
      configureServer(server) {
        server.middlewares.use('/models', (req, res, next) => {
          const filePath = path.join(MODELS_DIR, req.url.replace(/^\//, ''));
          if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
            res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
            res.setHeader('Cache-Control', 'public, max-age=3600');
            fs.createReadStream(filePath).pipe(res);
          } else {
            next();
          }
        });
      },
    },
  ],
  // PicoVoice SDKs load WASM internally — exclude from Vite pre-bundling
  optimizeDeps: {
    exclude: [
      '@picovoice/cheetah-web',
      '@picovoice/orca-web',
      '@picovoice/picollm-web',
    ],
  },
  build: {
    target: 'esnext',
  },
});
