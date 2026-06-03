import { useRef, useEffect } from 'react';
import { Download, FileJson, FileText, Image, Copy, Check } from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';
import { useState } from 'react';
import { useDashboardStore } from '../store';

// ─── Export helpers ───────────────────────────────────────────────────────────

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function exportJSON(data: unknown, filename: string) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  downloadBlob(blob, filename);
}

function exportMarkdown(content: string, filename: string) {
  const blob = new Blob([content], { type: 'text/markdown' });
  downloadBlob(blob, filename);
}

function graphToMarkdown(graph: ReturnType<typeof useDashboardStore.getState>['graph']): string {
  if (!graph) return '';
  const lines: string[] = [
    `# ${graph.project_name} — Knowledge Graph`,
    `> Generated ${new Date(graph.generated_at).toLocaleString()} · Phase: ${graph.phase}`,
    '',
    `## Stats`,
    `- **Nodes:** ${graph.stats.node_count}`,
    `- **Edges:** ${graph.stats.edge_count}`,
    `- **High risk:** ${graph.stats.risk_summary.high}`,
    `- **Medium risk:** ${graph.stats.risk_summary.medium}`,
    `- **Low risk:** ${graph.stats.risk_summary.low}`,
    '',
  ];

  if (graph.layers.length > 0) {
    lines.push('## Layers', '');
    for (const layer of graph.layers) {
      lines.push(`### ${layer.name}`, layer.description ?? '', `${layer.node_ids.length} nodes`, '');
    }
  }

  if (graph.tours.length > 0) {
    lines.push('## Guided Tours', '');
    for (const tour of graph.tours) {
      lines.push(`### ${tour.title}`, tour.description, '');
      tour.steps.forEach((step, i) => {
        lines.push(`**Step ${i + 1}: ${step.step_title}**`, step.explanation, '');
      });
    }
  }

  lines.push('## High Risk Nodes', '');
  const highRisk = graph.nodes.filter((n) => (n.risk_score ?? 0) >= 0.7);
  for (const node of highRisk) {
    lines.push(`- **${node.label}** (\`${node.type}\`) — risk score ${(node.risk_score ?? 0).toFixed(2)}`);
    if (node.summary) lines.push(`  > ${node.summary}`);
  }

  return lines.join('\n');
}

function exportSVG() {
  const svgEl = document.querySelector('.sigma-container svg, canvas.sigma-canvas');
  if (!svgEl) {
    alert('SVG export requires the graph canvas to be visible. Switch to the Graph view first.');
    return;
  }
  const serializer = new XMLSerializer();
  const svgStr = serializer.serializeToString(svgEl);
  const blob = new Blob([svgStr], { type: 'image/svg+xml' });
  downloadBlob(blob, 'sprang-graph.svg');
}

// ─── Menu component ───────────────────────────────────────────────────────────

interface MenuItem {
  label: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  action: () => void;
}

export function ExportMenu() {
  const { exportMenuOpen, toggleExportMenu, graph } = useDashboardStore();
  const [copied, setCopied] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!exportMenuOpen) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) toggleExportMenu();
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [exportMenuOpen, toggleExportMenu]);

  const projectSlug = graph?.project_name?.replace(/[^a-z0-9]/gi, '-').toLowerCase() ?? 'sprang';
  const ts = new Date().toISOString().slice(0, 10);

  const menuItems: MenuItem[] = [
    {
      label: 'Export knowledge-graph.json',
      description: 'Full graph JSON with all nodes, edges, tours and layers',
      icon: FileJson,
      action: () => {
        if (!graph) return;
        exportJSON(graph, `${projectSlug}-knowledge-graph-${ts}.json`);
        toggleExportMenu();
      },
    },
    {
      label: 'Export summary as Markdown',
      description: 'High-risk nodes, guided tours and layer summaries',
      icon: FileText,
      action: () => {
        if (!graph) return;
        exportMarkdown(graphToMarkdown(graph), `${projectSlug}-graph-summary-${ts}.md`);
        toggleExportMenu();
      },
    },
    {
      label: 'Copy graph JSON to clipboard',
      description: 'Paste into any editor or LLM prompt',
      icon: copied ? Check : Copy,
      action: () => {
        if (!graph) return;
        navigator.clipboard.writeText(JSON.stringify(graph, null, 2)).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        });
        toggleExportMenu();
      },
    },
    {
      label: 'Export graph as SVG',
      description: 'Vector image of the current graph view',
      icon: Image,
      action: () => {
        exportSVG();
        toggleExportMenu();
      },
    },
  ];

  return (
    <div ref={menuRef} className="relative">
      {/* Trigger */}
      <button
        type="button"
        onClick={toggleExportMenu}
        disabled={!graph}
        className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium border transition-colors ${
          exportMenuOpen
            ? 'bg-surface-800 border-surface-600 text-surface-200'
            : 'bg-transparent border-surface-700 text-surface-500 hover:text-surface-300 hover:border-surface-600'
        } disabled:opacity-40 disabled:cursor-not-allowed`}
        title="Export graph data"
      >
        <Download className="w-3.5 h-3.5" />
        Export
      </button>

      {/* Dropdown */}
      <AnimatePresence>
        {exportMenuOpen && (
          <motion.div
            initial={{ opacity: 0, y: -6, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.97 }}
            transition={{ duration: 0.15, ease: [0.22, 1, 0.36, 1] }}
            className="absolute top-full mt-2 right-0 z-50 w-72 bg-surface-900 border border-surface-700 rounded-xl shadow-2xl shadow-black/60 overflow-hidden py-1"
          >
            <p className="px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-surface-500 border-b border-surface-800 mb-1">
              Export
            </p>
            {menuItems.map((item) => (
              <button
                key={item.label}
                type="button"
                onClick={item.action}
                className="w-full flex items-start gap-3 px-3 py-2.5 text-left hover:bg-surface-800 transition-colors"
              >
                <item.icon className={`w-4 h-4 shrink-0 mt-0.5 ${item.label.includes('clipboard') && copied ? 'text-green-400' : 'text-sprang-400'}`} />
                <div>
                  <p className="text-xs font-medium text-surface-200">{item.label}</p>
                  <p className="text-[10px] text-surface-500 mt-0.5">{item.description}</p>
                </div>
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
