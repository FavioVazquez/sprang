#!/usr/bin/env node
/**
 * Generate the per-platform agent asset trees from their canonical sources.
 *
 * Sprang ships the same skills and rules to Devin, Claude Code and Copilot CLI,
 * each of which reads them from a different directory. Before v0.3.0 those copies
 * were maintained by hand and had already drifted — `skills/sprang/SKILL.md` and
 * `.windsurf/skills/sprang/SKILL.md` gave the agent materially different
 * instructions. This script makes the copies derived, and `--check` makes CI fail
 * the moment they diverge again.
 *
 * Canonical sources (edit these):
 *   skills/<name>/**      — the 11 skills
 *   .devin/rules/*.md     — the always-on / glob rules
 *
 * Generated (never edit):
 *   .devin/skills/<name>/**
 *   .claude/skills/<name>/**
 *   .claude/rules/*.md
 *   .claude/hooks/*.sh
 *
 * Copilot CLI needs no copy: its plugin manifest points straight at `skills/`.
 *
 * Usage:
 *   node scripts/sync-agent-assets.mjs           # write the copies
 *   node scripts/sync-agent-assets.mjs --check   # verify only, exit 1 on drift
 */

import { readdirSync, readFileSync, writeFileSync, mkdirSync, rmSync, existsSync, chmodSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CHECK_ONLY = process.argv.includes('--check');

const GENERATED_BANNER_SKIP = new Set(['.png', '.jpg', '.jpeg', '.gif', '.ico', '.webp']);

/** Directory pairs to mirror: [canonical source, generated destination]. */
const MIRRORS = [
  ['skills', '.devin/skills'],
  ['skills', '.claude/skills'],
  ['.devin/rules', '.claude/rules'],
  ['.devin/hooks', '.claude/hooks'],
];

/** Files that must stay executable after being copied. */
const EXECUTABLE_EXT = new Set(['.sh']);

function walk(dir, base = dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full, base));
    else if (entry.isFile()) out.push(relative(base, full));
  }
  return out;
}

const problems = [];
let written = 0;

for (const [srcRel, destRel] of MIRRORS) {
  const srcDir = join(REPO_ROOT, srcRel);
  const destDir = join(REPO_ROOT, destRel);

  if (!existsSync(srcDir)) {
    problems.push(`missing canonical source: ${srcRel}`);
    continue;
  }

  const srcFiles = walk(srcDir).sort();

  if (!CHECK_ONLY) {
    // A stale symlink from the pre-0.3 layout would make us write through it
    // into the canonical tree, so replace whatever is there outright.
    if (existsSync(destDir)) rmSync(destDir, { recursive: true, force: true });
    mkdirSync(destDir, { recursive: true });
  }

  for (const rel of srcFiles) {
    const srcPath = join(srcDir, rel);
    const destPath = join(destDir, rel);
    const content = readFileSync(srcPath);

    if (CHECK_ONLY) {
      if (!existsSync(destPath)) {
        problems.push(`${destRel}/${rel} is missing (run: pnpm sync:agents)`);
      } else if (!readFileSync(destPath).equals(content)) {
        problems.push(`${destRel}/${rel} differs from ${srcRel}/${rel} (run: pnpm sync:agents)`);
      }
      continue;
    }

    mkdirSync(dirname(destPath), { recursive: true });
    writeFileSync(destPath, content);
    if (EXECUTABLE_EXT.has(rel.slice(rel.lastIndexOf('.')))) chmodSync(destPath, 0o755);
    if (!GENERATED_BANNER_SKIP.has(rel.slice(rel.lastIndexOf('.')))) written++;
  }

  if (CHECK_ONLY && existsSync(destDir)) {
    const destFiles = walk(destDir).sort();
    for (const rel of destFiles) {
      if (!srcFiles.includes(rel)) {
        problems.push(`${destRel}/${rel} is stale — no longer in ${srcRel} (run: pnpm sync:agents)`);
      }
    }
  }
}

if (CHECK_ONLY) {
  if (problems.length > 0) {
    console.error('Agent assets are out of sync with their canonical sources:\n');
    for (const p of problems) console.error(`  ✖ ${p}`);
    console.error('\nEdit the canonical source, then run: pnpm sync:agents');
    process.exit(1);
  }
  console.log('✓ Agent assets are in sync');
} else {
  if (problems.length > 0) {
    for (const p of problems) console.error(`  ✖ ${p}`);
    process.exit(1);
  }
  console.log(`✓ Synced ${written} files into ${MIRRORS.map(([, d]) => d).join(', ')}`);
}
