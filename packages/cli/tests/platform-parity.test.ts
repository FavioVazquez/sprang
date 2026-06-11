import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

// Repo root is three levels up from packages/cli/tests
const REPO_ROOT = resolve(__dirname, '../../..');

// The canonical 11-skill set shared by every platform surface
const SKILLS = [
  'sprang',
  'sprang-analyze',
  'sprang-chat',
  'sprang-diff',
  'sprang-domain',
  'sprang-explain',
  'sprang-health',
  'sprang-knowledge',
  'sprang-onboard',
  'sprang-team',
  'sprang-why',
].sort();

const MCP_TOOLS = [
  'sprang_query',
  'sprang_node',
  'sprang_diff_impact',
  'sprang_tour',
  'sprang_domain',
  'sprang_health',
  'sprang_why',
  'sprang_annotate',
  'sprang_respond',
];

function readJson(relPath: string): any {
  return JSON.parse(readFileSync(join(REPO_ROOT, relPath), 'utf-8'));
}

function listDirNames(relPath: string): string[] {
  return readdirSync(join(REPO_ROOT, relPath)).sort();
}

/** Extract the YAML frontmatter block from a SKILL.md (between the leading --- fences). */
function parseFrontmatter(content: string): { name: string; description: string } | null {
  if (!content.startsWith('---')) return null;
  const end = content.indexOf('\n---', 3);
  if (end === -1) return null;
  const block = content.slice(3, end);
  const nameMatch = block.match(/^name:\s*(.+)$/m);
  const descMatch = block.match(/^description:\s*(.+)$/m);
  return {
    name: nameMatch ? nameMatch[1].trim() : '',
    description: descMatch ? descMatch[1].trim() : '',
  };
}

describe('manifests', () => {
  const MANIFESTS = [
    '.claude-plugin/plugin.json',
    '.claude-plugin/marketplace.json',
    '.copilot-plugin/plugin.json',
    '.devin/config.json',
    '.mcp.json',
    '.vscode/mcp.json',
  ];

  it.each(MANIFESTS)('%s parses as JSON', (relPath) => {
    expect(() => readJson(relPath)).not.toThrow();
  });

  it('plugin manifests share the CLI package version and name "sprang"', () => {
    const cliVersion = readJson('packages/cli/package.json').version;
    expect(cliVersion).toBeTruthy();
    for (const relPath of ['.claude-plugin/plugin.json', '.copilot-plugin/plugin.json']) {
      const manifest = readJson(relPath);
      expect(manifest.name, `${relPath} name`).toBe('sprang');
      expect(manifest.version, `${relPath} version`).toBe(cliVersion);
    }
  });

  it('.copilot-plugin/plugin.json skills path resolves to a directory with all 11 skills', () => {
    const manifest = readJson('.copilot-plugin/plugin.json');
    expect(typeof manifest.skills).toBe('string');
    const skillsDir = resolve(REPO_ROOT, '.copilot-plugin', manifest.skills);
    expect(existsSync(skillsDir), `skills dir ${skillsDir}`).toBe(true);
    expect(statSync(skillsDir).isDirectory()).toBe(true);
    for (const skill of SKILLS) {
      const skillMd = join(skillsDir, skill, 'SKILL.md');
      expect(existsSync(skillMd), `${skillMd} should exist`).toBe(true);
    }
  });

  it('.claude-plugin/plugin.json skills paths and MCP server path resolve from repo root', () => {
    // marketplace.json declares source "./" — the plugin root IS the repo root
    const marketplace = readJson('.claude-plugin/marketplace.json');
    expect(marketplace.plugins[0].source).toBe('./');

    const manifest = readJson('.claude-plugin/plugin.json');
    expect(Array.isArray(manifest.skills)).toBe(true);
    for (const skillPath of manifest.skills) {
      const resolved = resolve(REPO_ROOT, skillPath);
      expect(existsSync(resolved), `${skillPath} should resolve from repo root`).toBe(true);
      expect(statSync(resolved).isDirectory()).toBe(true);
    }

    const serverArg = manifest.mcpServers.sprang.args[0];
    const serverPath = serverArg.replace('${CLAUDE_PLUGIN_ROOT}', REPO_ROOT);
    expect(serverPath).toContain('packages/mcp/dist/server.js');
    expect(existsSync(serverPath), `${serverPath} should exist (repo must be built)`).toBe(true);
  });

  it('.devin/config.json, .mcp.json, .vscode/mcp.json reference the built MCP server and set SPRANG_ROOT', () => {
    expect(existsSync(join(REPO_ROOT, 'packages/mcp/dist/server.js'))).toBe(true);
    for (const relPath of ['.devin/config.json', '.mcp.json', '.vscode/mcp.json']) {
      const manifest = readJson(relPath);
      // .vscode/mcp.json uses VS Code's "servers" key; the others use "mcpServers"
      const server = (manifest.mcpServers ?? manifest.servers)?.sprang;
      expect(server, `${relPath} should define a sprang server`).toBeTruthy();
      expect(server.args, `${relPath} args`).toContain('packages/mcp/dist/server.js');
      expect(server.env?.SPRANG_ROOT, `${relPath} env.SPRANG_ROOT`).toBeTruthy();
    }
  });
});

describe('skills parity (Windsurf/Devin + Copilot)', () => {
  it('skills/ and .windsurf/skills/ contain exactly the canonical 11 folders', () => {
    expect(listDirNames('skills')).toEqual(SKILLS);
    expect(listDirNames('.windsurf/skills')).toEqual(SKILLS);
  });

  it('every SKILL.md in both locations has frontmatter with matching name and non-empty description', () => {
    for (const base of ['skills', '.windsurf/skills']) {
      for (const skill of SKILLS) {
        const path = join(REPO_ROOT, base, skill, 'SKILL.md');
        expect(existsSync(path), `${base}/${skill}/SKILL.md should exist`).toBe(true);
        const content = readFileSync(path, 'utf-8');
        const fm = parseFrontmatter(content);
        expect(fm, `${base}/${skill}/SKILL.md should have YAML frontmatter`).not.toBeNull();
        expect(fm!.name, `${base}/${skill} frontmatter name`).toBe(skill);
        expect(fm!.description.length, `${base}/${skill} description`).toBeGreaterThan(0);
      }
    }
  });

  it('every .windsurf skill description contains "Use when" trigger phrasing', () => {
    for (const skill of SKILLS) {
      const content = readFileSync(join(REPO_ROOT, '.windsurf/skills', skill, 'SKILL.md'), 'utf-8');
      const fm = parseFrontmatter(content);
      expect(fm!.description, `.windsurf/skills/${skill} description`).toContain('Use when');
    }
  });

  it('sprang-analyze merge.py helper exists in both skill trees', () => {
    expect(existsSync(join(REPO_ROOT, '.windsurf/skills/sprang-analyze/scripts/merge.py'))).toBe(true);
    expect(existsSync(join(REPO_ROOT, 'skills/sprang-analyze/scripts/merge.py'))).toBe(true);
  });
});

describe('workflows / commands parity', () => {
  const expectedFiles = SKILLS.map((s) => `${s}.md`).sort();

  it('.windsurf/workflows/ contains exactly one <skill>.md per skill', () => {
    expect(listDirNames('.windsurf/workflows')).toEqual(expectedFiles);
  });

  it('.claude/commands/ contains exactly one <skill>.md per skill', () => {
    expect(listDirNames('.claude/commands')).toEqual(expectedFiles);
  });
});

describe('rules parity', () => {
  const RULES = ['cascade-messaging.md', 'sprang-context.md', 'sprang-highrisk.md'].sort();

  it('.windsurf/rules/ and .devin/rules/ contain exactly the 3 rules, byte-identical', () => {
    expect(listDirNames('.windsurf/rules')).toEqual(RULES);
    expect(listDirNames('.devin/rules')).toEqual(RULES);
    for (const rule of RULES) {
      const windsurf = readFileSync(join(REPO_ROOT, '.windsurf/rules', rule));
      const devin = readFileSync(join(REPO_ROOT, '.devin/rules', rule));
      expect(windsurf.equals(devin), `${rule} should be byte-identical between .windsurf and .devin`).toBe(true);
    }
  });

  it('.claude/rules/ contains the same 3 rule names', () => {
    expect(listDirNames('.claude/rules')).toEqual(RULES);
  });
});

describe('hooks wiring', () => {
  it('.windsurf/hooks.json and .devin/hooks.json wire post_cascade_response_with_transcript to save-conversation.py', () => {
    for (const relPath of ['.windsurf/hooks.json', '.devin/hooks.json']) {
      const config = readJson(relPath);
      const entries = config.hooks?.post_cascade_response_with_transcript;
      expect(Array.isArray(entries), `${relPath} hook array`).toBe(true);
      expect(entries.length, `${relPath} hook entries`).toBeGreaterThan(0);
      expect(entries[0].command, `${relPath} command`).toContain('.windsurf/hooks/save-conversation.py');
    }
    expect(existsSync(join(REPO_ROOT, '.windsurf/hooks/save-conversation.py'))).toBe(true);
  });

  it('.claude/settings.json wires SessionStart and PostToolUse to executable scripts', () => {
    const settings = readJson('.claude/settings.json');
    expect(settings.hooks).toBeTruthy();
    expect(Array.isArray(settings.hooks.SessionStart)).toBe(true);
    expect(settings.hooks.SessionStart.length).toBeGreaterThan(0);
    expect(Array.isArray(settings.hooks.PostToolUse)).toBe(true);
    expect(settings.hooks.PostToolUse.length).toBeGreaterThan(0);

    for (const script of ['.claude/hooks/session-start.sh', '.claude/hooks/post-tool-use.sh']) {
      const path = join(REPO_ROOT, script);
      expect(existsSync(path), `${script} should exist`).toBe(true);
      expect(statSync(path).mode & 0o111, `${script} should be executable`).not.toBe(0);
    }
  });
});

describe('copilot extras', () => {
  it('.github/copilot-instructions.md mentions all 9 MCP tools', () => {
    const path = join(REPO_ROOT, '.github/copilot-instructions.md');
    expect(existsSync(path)).toBe(true);
    const content = readFileSync(path, 'utf-8');
    for (const tool of MCP_TOOLS) {
      expect(content, `copilot-instructions should mention ${tool}`).toContain(tool);
    }
  });

  it('packaged Windsurf extension artifact exists at repo root', () => {
    expect(existsSync(join(REPO_ROOT, 'cascade-messaging-0.1.0.vsix'))).toBe(true);
  });
});
