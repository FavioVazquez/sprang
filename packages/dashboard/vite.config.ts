import path from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { registerRoutes } from './src/server/routes.js';

// Mutable project root — can be overridden at runtime via POST /analyze
let currentRoot: string = process.env['SPRANG_ROOT'] ?? process.cwd();

const getRoot = () => currentRoot;
const setRoot = (r: string) => { currentRoot = r; };

type ConnectServer = { middlewares: import('vite').Connect.Server };

function attachSprangMiddlewares(server: ConnectServer) {
  registerRoutes(
    (prefix, handler) => server.middlewares.use(prefix, handler),
    getRoot,
    setRoot,
  );
}

// Works in both `vite` (dev) and `vite preview` modes.
const sprangGraphPlugin = () => ({
  name: 'sprang-graph-serve',
  configureServer(server: import('vite').ViteDevServer) {
    attachSprangMiddlewares(server);
  },
  configurePreviewServer(server: import('vite').PreviewServer) {
    attachSprangMiddlewares(server);
  },
});

export default defineConfig({
  plugins: [react(), sprangGraphPlugin()],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
    },
  },
  build: {
    // @xyflow/react (React Flow) + ELK are inherently large (~1.5 MB combined).
    // They're lazy-loaded — only downloaded when visiting Architecture/Domains views.
    // The main bundle is ~142 KB; this limit silences the warning for the lazy chunk.
    chunkSizeWarningLimit: 1600,
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          if (!id.includes('node_modules')) return;
          // Isolate react-force-graph and its entire dependency stack in their own chunk.
          // react-force-graph → 3d-force-graph → three.js + d3-force, creating circular deps
          // with vendor (React) and vendor-graph (Sigma/D3). Isolating the whole stack
          // prevents the circular that corrupts Sigma.js (EventEmitter undefined crash).
          // Graph3DCanvas imports 3d-force-graph + react-kapsule directly (not react-force-graph).
          // Isolate the entire 3D force-graph stack to keep it out of the eagerly-loaded
          // vendor chunk (mixing it in creates circular chunk deps that crash Sigma.js init).
          if (id.includes('3d-force-graph') || id.includes('three-forcegraph') ||
              id.includes('three-render-objects') || id.includes('super-three') ||
              id.includes('react-kapsule') || id.includes('kapsule') ||
              id.includes('ngraph') || id.includes('d3-force-3d') ||
              id.includes('d3-binarytree') || id.includes('d3-octree') ||
              id.includes('accessor-fn') || id.includes('data-bind-mapper') ||
              id.includes('tinycolor2') || id.includes('index-array-by') ||
              id.includes('float-tooltip') || id.includes('jerrypick') ||
              id.includes('canvas-color-tracker') || id.includes('@tweenjs') ||
              id.includes('nipplejs') || id.includes('bezier-js') ||
              id.includes('/three/') || id.includes('/three@') ||
              id.includes('three.module') || id.includes('three.cjs')) {
            return 'vendor-3d';
          }
          // Co-locate `events` (Node.js EventEmitter polyfill) with Sigma.js to avoid
          // circular chunk initialization order that corrupts EventEmitter (undefined crash).
          if (id.includes('sigma') || id.includes('graphology') || id.includes('d3-force') ||
              id.includes('/events/') || id.includes('/events@')) {
            return 'vendor-graph';
          }
          if (id.includes('@xyflow') || id.includes('elkjs')) {
            return 'vendor-flow';
          }
          if (id.includes('framer-motion')) {
            return 'vendor-motion';
          }
          if (id.includes('prism-react-renderer')) {
            return 'vendor-prism';
          }
          if (id.includes('@radix-ui') || id.includes('cmdk') || id.includes('lucide-react') || id.includes('class-variance') || id.includes('clsx') || id.includes('tailwind-merge')) {
            return 'vendor-ui';
          }
          // React and react-dom share internals — keep them together in the main vendor chunk
          return 'vendor';
        },
      },
    },
  },
  server: {
    port: 7338,
    host: true,
  },
  preview: {
    port: 7777,
    host: true,
  },
});
