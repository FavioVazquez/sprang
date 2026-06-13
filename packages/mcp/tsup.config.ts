import { defineConfig } from 'tsup';

export default defineConfig([
  // CJS standalone bundle used by sprang init (.mcp.json).
  // Bundles all non-Node deps so the file is self-contained for npm users
  // who don't have @modelcontextprotocol/sdk or @sprang/core installed separately.
  {
    entry: ['src/server.ts'],
    format: ['cjs'],
    outExtension: () => ({ js: '.cjs' }),
    outDir: 'dist',
    sourcemap: true,
    noExternal: ['@sprang/core', '@modelcontextprotocol/sdk'],
    platform: 'node',
    target: 'node22',
    splitting: false,
  },
  // ESM build for monorepo usage and type declarations
  {
    entry: ['src/server.ts'],
    format: ['esm'],
    dts: true,
    sourcemap: false,
    noExternal: ['@sprang/core'],
    platform: 'node',
    target: 'node22',
  },
]);
