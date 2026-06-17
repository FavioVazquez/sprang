import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  dts: true,
  sourcemap: true,
  // Bundle @sprang/core inline so the published npm package is self-contained.
  // @sprang/core's own npm deps (chokidar, simple-git, etc.) remain external
  // and are listed as direct dependencies in package.json so npm installs them.
  noExternal: ['@sprang/core'],
  // Keep node built-ins external
  platform: 'node',
  target: 'node22',
  // Don't wipe the dist/ directory — dashboard and MCP server files are copied
  // there by the publish workflow before `npm publish` runs prepublishOnly.
  clean: false,
});
