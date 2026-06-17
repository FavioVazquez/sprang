import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { defineConfig } from 'tsup';

// Read the package version at build time and inject it as a compile-time
// constant. This keeps the MCP server's advertised serverInfo.version in lockstep
// with package.json across both the CJS and ESM bundles (import.meta.url / __dirname
// resolution differs between the two formats, so a build-time define is the most
// robust way to surface the version without a fragile runtime file read).
const version = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'package.json'), 'utf8'),
).version as string;

const define = { __SPRANG_VERSION__: JSON.stringify(version) };

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
    define,
  },
  // ESM build for monorepo usage and type declarations.
  // This bundle is what .mcp.json / .vscode/mcp.json and the Claude plugin launch
  // (`node packages/mcp/dist/server.js`). @sprang/core is inlined, which pulls in
  // CJS-only transitive deps (fast-glob, etc.) that call require() at runtime — and
  // ESM has no require by default, so esbuild's shim throws "Dynamic require of os".
  // The createRequire banner provides a real require so those bundled CJS deps work.
  {
    entry: ['src/server.ts'],
    format: ['esm'],
    dts: true,
    sourcemap: false,
    noExternal: ['@sprang/core'],
    platform: 'node',
    target: 'node22',
    define,
    banner: {
      js: "import { createRequire as __sprangCreateRequire } from 'module'; const require = __sprangCreateRequire(import.meta.url);",
    },
  },
]);
