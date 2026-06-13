import type { AgentContext, AgentResult } from './base.js';
import { BaseAgent } from './base.js';
import { readFile } from 'node:fs/promises';
import type { SecurityWarning, SecurityCategory, SprangNode } from '../schema/types.js';

// Pattern definitions: [category, severity, regex, description]
type PatternDef = [SecurityCategory, SecurityWarning['severity'], RegExp, string];

const PATTERNS: PatternDef[] = [
  // Hardcoded secrets
  ['hardcoded_secret', 'high', /(?:password|passwd|pwd)\s*[:=]\s*['"`][^'"`]{4,}['"`]/i, 'Hardcoded password literal'],
  ['hardcoded_secret', 'high', /(?:api_key|apikey|api_secret)\s*[:=]\s*['"`][^'"`]{8,}['"`]/i, 'Hardcoded API key'],
  ['hardcoded_secret', 'high', /(?:secret|token|auth_token)\s*[:=]\s*['"`][^'"`]{8,}['"`]/i, 'Hardcoded secret/token'],
  ['hardcoded_secret', 'medium', /(?:private_key|privatekey)\s*[:=]\s*['"`][^'"`]{4,}['"`]/i, 'Hardcoded private key'],
  // SQL injection
  ['sql_injection', 'high', /["'`]\s*\+\s*\w+.*(?:SELECT|INSERT|UPDATE|DELETE|DROP)/i, 'SQL query built with string concatenation'],
  ['sql_injection', 'high', /(?:query|execute|exec)\s*\(\s*['"`][^'"`]*['"`]\s*\+/i, 'SQL string concatenation in query call'],
  // XSS
  ['xss_risk', 'high', /\.innerHTML\s*=\s*(?!['"`])/i, 'innerHTML assigned from variable (XSS risk)'],
  ['xss_risk', 'medium', /document\.write\s*\(/i, 'document.write() usage'],
  ['xss_risk', 'medium', /\.outerHTML\s*=\s*(?!['"`])/i, 'outerHTML assigned from variable'],
  // Unsafe eval
  ['unsafe_eval', 'high', /\beval\s*\(/i, 'eval() usage'],
  ['unsafe_eval', 'high', /new\s+Function\s*\(/i, 'new Function() — dynamic code execution'],
  ['unsafe_eval', 'medium', /setTimeout\s*\(\s*['"`]/i, 'setTimeout with string argument'],
  // Unsafe exec (Python/Node)
  ['unsafe_exec', 'high', /subprocess\s*\.\s*(?:call|run|Popen)\s*\([^)]*shell\s*=\s*True/i, 'subprocess with shell=True'],
  ['unsafe_exec', 'high', /os\s*\.\s*system\s*\(/i, 'os.system() call'],
  ['unsafe_exec', 'medium', /child_process\s*\.\s*exec\s*\(/i, 'child_process.exec() — prefer execFile'],
  // Unsafe deserialization
  ['unsafe_deserialization', 'high', /pickle\s*\.\s*loads?\s*\(/i, 'pickle.load/loads — unsafe deserialization'],
  ['unsafe_deserialization', 'medium', /yaml\s*\.\s*load\s*\([^)]*\)(?!\s*,\s*Loader)/i, 'yaml.load without Loader — use yaml.safe_load'],
  // Path traversal
  ['path_traversal', 'medium', /(?:readFile|readFileSync|createReadStream)\s*\([^)]*\+/i, 'File read with concatenated path (traversal risk)'],
  // Weak crypto
  ['weak_crypto', 'medium', /(?:md5|sha1)\s*\(/i, 'Weak hash algorithm (md5/sha1)'],
  ['weak_crypto', 'low', /Math\.random\s*\(\)/i, 'Math.random() — not cryptographically secure'],
];

function scanCode(code: string, _filePath: string): SecurityWarning[] {
  const lines = code.split('\n');
  const warnings: SecurityWarning[] = [];

  for (const [category, severity, pattern, description] of PATTERNS) {
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] ?? '';
      // Skip comment lines
      const trimmed = line.trim();
      if (trimmed.startsWith('//') || trimmed.startsWith('#') || trimmed.startsWith('*')) continue;
      if (pattern.test(line)) {
        warnings.push({
          category,
          severity,
          description,
          line: i + 1,
          pattern: pattern.source.slice(0, 60),
          snippet: line.trim().slice(0, 80),
        });
        // Only one match per pattern per line
        break;
      }
    }
  }

  return warnings;
}

function buildSecuritySummary(nodes: SprangNode[]) {
  const bySeverity = { high: 0, medium: 0, low: 0 };
  const byCategory: Partial<Record<SecurityCategory, number>> = {};
  let total = 0;

  for (const node of nodes) {
    for (const w of node.security_warnings ?? []) {
      total++;
      bySeverity[w.severity]++;
      byCategory[w.category] = (byCategory[w.category] ?? 0) + 1;
    }
  }

  return { total, by_severity: bySeverity, by_category: byCategory };
}

export class SecurityScannerAgent extends BaseAgent {
  readonly id = 'security-scanner';
  readonly phase = 2 as const;

  async run(ctx: AgentContext): Promise<AgentResult> {
    const graph = ctx.graph;
    const fileNodes = graph.nodes.filter((n) => n.type === 'file' && n.location?.file);

    for (const node of fileNodes) {
      const relPath = node.location!.file;
      const absPath = `${ctx.projectRoot}/${relPath}`;
      let code: string;
      try {
        code = await readFile(absPath, 'utf-8');
      } catch {
        continue;
      }

      const warnings = scanCode(code, relPath);
      if (warnings.length > 0) {
        node.security_warnings = warnings;
        // Boost risk score for high severity security findings
        if (warnings.some((w) => w.severity === 'high') && node.risk_score !== undefined) {
          node.risk_score = Math.min(1.0, (node.risk_score ?? 0) + 0.15);
        }
      }
    }

    // Build and store summary in stats
    const summary = buildSecuritySummary(graph.nodes);
    graph.stats.security_summary = summary;

    await this.writeIntermediate(ctx, 'security-scan.json', summary);
    return this.success(ctx, graph);
  }
}
