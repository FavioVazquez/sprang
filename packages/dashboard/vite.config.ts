import fs from 'node:fs';
import path from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Serve knowledge-graph.json from SPRANG_ROOT or the nearest .sprang/ directory
const sprangGraphPlugin = () => ({
  name: 'sprang-graph-serve',
  configureServer(server: import('vite').ViteDevServer) {
    server.middlewares.use('/knowledge-graph.json', (_req: import('http').IncomingMessage, res: import('http').ServerResponse) => {
      const root = process.env['SPRANG_ROOT'] ?? process.cwd();
      const candidates = [
        path.join(root, '.sprang', 'knowledge-graph.json'),
        path.join(root, 'knowledge-graph.json'),
      ];
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('X-Frame-Options', 'DENY');
      for (const candidate of candidates) {
        if (fs.existsSync(candidate)) {
          res.setHeader('Content-Type', 'application/json');
          res.end(fs.readFileSync(candidate));
          return;
        }
      }
      res.statusCode = 404;
      res.end('Not Found');
    });
  },
});

export default defineConfig({
  plugins: [react(), sprangGraphPlugin()],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
    },
  },
  server: {
    port: 7338,
  },
});
