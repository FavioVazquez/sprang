import React, { useState, useMemo } from 'react';
import {
  AlertTriangle,
  AlertCircle,
  Activity,
  Network,
  TrendingUp,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Ghost,
  RefreshCw,
} from 'lucide-react';
import { Badge } from '../components/ui/Badge';
import { SmellBadge } from '../components/SmellBadge';
import { getRiskColor, getRiskLabel } from '../api/graphApi';
import type { KnowledgeGraph, SmellCategory, SprangNode } from '../types';

interface HealthViewProps {
  graph: KnowledgeGraph;
  onNodeSelect: (nodeId: string) => void;
}

type SortDir = 'asc' | 'desc';

function StatCard({
  label,
  value,
  icon: Icon,
  accent,
  sub,
}: {
  label: string;
  value: number | string;
  icon: React.ComponentType<{ className?: string }>;
  accent?: string;
  sub?: string;
}) {
  return (
    <div className="p-4 rounded-xl bg-surface-900 border border-surface-800 space-y-3">
      <div className="flex items-center gap-2">
        <Icon className="w-4 h-4 text-surface-500" />
        <span className="text-xs text-surface-500 font-medium">
          {label}
        </span>
      </div>
      <div>
        <p
          className="text-2xl font-bold tabular-nums"
          style={accent ? { color: accent } : undefined}
        >
          {value}
        </p>
        {sub && <p className="text-xs text-surface-500 mt-0.5">{sub}</p>}
      </div>
    </div>
  );
}

const SMELL_DESCRIPTIONS: Record<SmellCategory, string> = {
  god_node: 'A node with too many responsibilities or connections',
  circular_dependency: 'Nodes that depend on each other in a cycle',
  unstable_interface: 'Frequently changing public API',
  unclear_coupling: 'Tight coupling without clear relationship',
  over_connected: 'Node with excessive number of edges',
  duplicate_logic: 'Similar logic found in multiple places',
  orphan_node: 'Node with no connections to the rest of the graph',
  low_cohesion: 'Node whose responsibilities are loosely related',
};

const SMELL_SEVERITY: Record<SmellCategory, 'high' | 'medium' | 'low'> = {
  god_node: 'high',
  circular_dependency: 'high',
  unstable_interface: 'high',
  unclear_coupling: 'medium',
  over_connected: 'medium',
  duplicate_logic: 'medium',
  orphan_node: 'low',
  low_cohesion: 'low',
};

const SEVERITY_ORDER = { high: 0, medium: 1, low: 2 };

function SortIcon({
  field,
  current,
  dir,
}: {
  field: string;
  current: string;
  dir: SortDir;
}) {
  if (field !== current)
    return <ArrowUpDown className="w-3 h-3 text-surface-600" />;
  return dir === 'asc' ? (
    <ArrowUp className="w-3 h-3 text-sprang-400" />
  ) : (
    <ArrowDown className="w-3 h-3 text-sprang-400" />
  );
}

export function HealthView({ graph, onNodeSelect }: HealthViewProps) {
  const [riskSort, setRiskSort] = useState<{ field: string; dir: SortDir }>({
    field: 'risk_score',
    dir: 'desc',
  });
  const [smellSort, setSmellSort] = useState<{ field: string; dir: SortDir }>({
    field: 'severity',
    dir: 'asc',
  });

  const toggleRiskSort = (field: string) => {
    setRiskSort((s) =>
      s.field === field
        ? { field, dir: s.dir === 'asc' ? 'desc' : 'asc' }
        : { field, dir: 'desc' },
    );
  };

  const toggleSmellSort = (field: string) => {
    setSmellSort((s) =>
      s.field === field
        ? { field, dir: s.dir === 'asc' ? 'desc' : 'asc' }
        : { field, dir: 'asc' },
    );
  };

  const smellStats = useMemo(() => {
    return (Object.entries(graph.stats.smell_summary) as [SmellCategory, number][])
      .map(([category, count]) => ({
        category,
        count,
        severity: SMELL_SEVERITY[category] ?? 'low',
        description: SMELL_DESCRIPTIONS[category] ?? '',
      }))
      .sort((a, b) => {
        if (smellSort.field === 'severity') {
          const diff =
            SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity];
          return smellSort.dir === 'asc' ? diff : -diff;
        }
        if (smellSort.field === 'count') {
          return smellSort.dir === 'asc' ? a.count - b.count : b.count - a.count;
        }
        return 0;
      });
  }, [graph.stats.smell_summary, smellSort]);

  const totalSmells = Object.values(graph.stats.smell_summary).reduce(
    (s, v) => s + (v ?? 0),
    0,
  );

  const riskyNodes = useMemo(() => {
    return [...graph.nodes]
      .filter((n) => n.risk_score != null)
      .sort((a, b) => {
        const av = a[riskSort.field as keyof SprangNode];
        const bv = b[riskSort.field as keyof SprangNode];
        if (typeof av === 'number' && typeof bv === 'number') {
          return riskSort.dir === 'asc' ? av - bv : bv - av;
        }
        const as_ = String(av ?? '');
        const bs_ = String(bv ?? '');
        return riskSort.dir === 'asc'
          ? as_.localeCompare(bs_)
          : bs_.localeCompare(as_);
      })
      .slice(0, 10);
  }, [graph.nodes, riskSort]);

  // Circular dependencies: nodes involved in circular_dependency warnings
  const circularNodes = useMemo(() => {
    const ids = new Set<string>();
    graph.nodes.forEach((n) => {
      n.structural_warnings?.forEach((w) => {
        if (w.category === 'circular_dependency') {
          ids.add(n.id);
          w.related_node_ids.forEach((id) => ids.add(id));
        }
      });
    });
    return Array.from(ids)
      .map((id) => graph.nodes.find((n) => n.id === id))
      .filter(Boolean) as typeof graph.nodes;
  }, [graph.nodes]);

  const orphanNodes = useMemo(() => {
    const connectedIds = new Set<string>();
    graph.edges.forEach((e) => {
      connectedIds.add(e.source);
      connectedIds.add(e.target);
    });
    return graph.nodes.filter((n) => !connectedIds.has(n.id));
  }, [graph.nodes, graph.edges]);

  return (
    <div className="flex-1 overflow-y-auto bg-surface-950">
      <div className="max-w-5xl mx-auto px-6 py-8 space-y-8">
        {/* Heading */}
        <div>
          <h1 className="text-xl font-bold text-surface-50">
            Structural Health Report
          </h1>
          <p className="text-sm text-surface-500 mt-1">
            {graph.project_name} — generated{' '}
            {new Date(graph.stats.generated_at).toLocaleDateString('en-US', {
              weekday: 'short',
              month: 'short',
              day: 'numeric',
              year: 'numeric',
            })}
          </p>
        </div>

        {/* Stats cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <StatCard
            label="Nodes"
            value={graph.stats.node_count}
            icon={Network}
            sub={`${graph.stats.edge_count} edges`}
          />
          <StatCard
            label="High Risk"
            value={graph.stats.risk_summary.high}
            icon={AlertTriangle}
            accent="#ef4444"
            sub={`${graph.stats.risk_summary.medium} medium`}
          />
          <StatCard
            label="Smells"
            value={totalSmells}
            icon={AlertCircle}
            accent="#f59e0b"
            sub={`${smellStats.length} categories`}
          />
          <StatCard
            label="Orphans"
            value={orphanNodes.length}
            icon={Ghost}
            sub="disconnected nodes"
          />
        </div>

        {/* Risk summary bar */}
        <div className="p-4 rounded-xl bg-surface-900 border border-surface-800 space-y-3">
          <h2 className="text-xs font-semibold text-surface-400">
            Risk Distribution
          </h2>
          <div className="flex rounded-full overflow-hidden h-3 bg-surface-800 gap-px">
            {[
              {
                key: 'high',
                color: '#ef4444',
                count: graph.stats.risk_summary.high,
              },
              {
                key: 'medium',
                color: '#f59e0b',
                count: graph.stats.risk_summary.medium,
              },
              {
                key: 'low',
                color: '#22c55e',
                count: graph.stats.risk_summary.low,
              },
            ].map(({ key, color, count }) => {
              const total =
                graph.stats.risk_summary.high +
                graph.stats.risk_summary.medium +
                graph.stats.risk_summary.low;
              const pct = total ? (count / total) * 100 : 0;
              if (pct === 0) return null;
              return (
                <div
                  key={key}
                  title={`${key}: ${count}`}
                  className="h-full transition-[width] duration-500"
                  style={{ width: `${pct}%`, backgroundColor: color }}
                />
              );
            })}
          </div>
          <div className="flex gap-4 text-xs">
            {[
              { label: 'High', color: '#ef4444', count: graph.stats.risk_summary.high },
              {
                label: 'Medium',
                color: '#f59e0b',
                count: graph.stats.risk_summary.medium,
              },
              { label: 'Low', color: '#22c55e', count: graph.stats.risk_summary.low },
            ].map(({ label, color, count }) => (
              <span key={label} className="flex items-center gap-1.5 text-surface-400">
                <span
                  className="w-2 h-2 rounded-full"
                  style={{ backgroundColor: color }}
                />
                {label}: <strong className="text-surface-200">{count}</strong>
              </span>
            ))}
          </div>
        </div>

        {/* Smell breakdown */}
        {smellStats.length > 0 && (
          <section className="space-y-3">
            <h2 className="text-sm font-semibold text-surface-200">
              Code Smell Breakdown
            </h2>
            <div className="rounded-xl border border-surface-800 overflow-hidden">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-surface-900 border-b border-surface-800">
                    <th className="px-4 py-3 text-left text-surface-500 font-medium uppercase tracking-wider">
                      Category
                    </th>
                    <th
                      className="px-4 py-3 text-left text-surface-500 font-medium uppercase tracking-wider cursor-pointer hover:text-surface-300 select-none"
                      onClick={() => toggleSmellSort('count')}
                    >
                      <span className="flex items-center gap-1">
                        Count{' '}
                        <SortIcon
                          field="count"
                          current={smellSort.field}
                          dir={smellSort.dir}
                        />
                      </span>
                    </th>
                    <th
                      className="px-4 py-3 text-left text-surface-500 font-medium uppercase tracking-wider cursor-pointer hover:text-surface-300 select-none"
                      onClick={() => toggleSmellSort('severity')}
                    >
                      <span className="flex items-center gap-1">
                        Severity{' '}
                        <SortIcon
                          field="severity"
                          current={smellSort.field}
                          dir={smellSort.dir}
                        />
                      </span>
                    </th>
                    <th className="px-4 py-3 text-left text-surface-500 font-medium uppercase tracking-wider hidden md:table-cell">
                      Description
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {smellStats.map((row, idx) => (
                    <tr
                      key={row.category}
                      className={`border-b border-surface-800 last:border-0 ${
                        idx % 2 === 0 ? 'bg-surface-950' : 'bg-surface-900/40'
                      }`}
                    >
                      <td className="px-4 py-3">
                        <Badge
                          variant={
                            row.severity === 'high'
                              ? 'risk-high'
                              : row.severity === 'medium'
                              ? 'risk-medium'
                              : 'info'
                          }
                        >
                          {row.category.replace(/_/g, ' ')}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 font-bold tabular-nums text-surface-200">
                        {row.count}
                      </td>
                      <td className="px-4 py-3">
                        <Badge
                          variant={
                            row.severity === 'high'
                              ? 'risk-high'
                              : row.severity === 'medium'
                              ? 'risk-medium'
                              : 'info'
                          }
                        >
                          {row.severity}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 text-surface-400 hidden md:table-cell">
                        {row.description}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {/* Top risky nodes */}
        {riskyNodes.length > 0 && (
          <section className="space-y-3">
            <div className="flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-risk-high" />
              <h2 className="text-sm font-semibold text-surface-200">
                Top Risky Nodes
              </h2>
            </div>
            <div className="rounded-xl border border-surface-800 overflow-hidden">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-surface-900 border-b border-surface-800">
                    <th
                      className="px-4 py-3 text-left text-surface-500 font-medium uppercase tracking-wider cursor-pointer hover:text-surface-300 select-none"
                      onClick={() => toggleRiskSort('label')}
                    >
                      <span className="flex items-center gap-1">
                        Node{' '}
                        <SortIcon
                          field="label"
                          current={riskSort.field}
                          dir={riskSort.dir}
                        />
                      </span>
                    </th>
                    <th className="px-4 py-3 text-left text-surface-500 font-medium uppercase tracking-wider">
                      Type
                    </th>
                    <th
                      className="px-4 py-3 text-left text-surface-500 font-medium uppercase tracking-wider cursor-pointer hover:text-surface-300 select-none"
                      onClick={() => toggleRiskSort('risk_score')}
                    >
                      <span className="flex items-center gap-1">
                        Risk Score{' '}
                        <SortIcon
                          field="risk_score"
                          current={riskSort.field}
                          dir={riskSort.dir}
                        />
                      </span>
                    </th>
                    <th className="px-4 py-3 text-left text-surface-500 font-medium uppercase tracking-wider hidden lg:table-cell">
                      Factors
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {riskyNodes.map((node, idx) => (
                    <tr
                      key={node.id}
                      className={`border-b border-surface-800 last:border-0 cursor-pointer transition-colors hover:bg-surface-800 ${
                        idx % 2 === 0 ? 'bg-surface-950' : 'bg-surface-900/40'
                      }`}
                      onClick={() => onNodeSelect(node.id)}
                    >
                      <td className="px-4 py-3">
                        <p className="font-medium text-surface-200 truncate max-w-[200px]">
                          {node.label}
                        </p>
                        {node.location && (
                          <p className="text-surface-600 font-mono text-[10px] truncate mt-0.5">
                            {node.location.file}
                          </p>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <Badge variant="accent">{node.type}</Badge>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2 min-w-[100px]">
                          <div className="flex-1 h-1.5 rounded-full bg-surface-800 overflow-hidden">
                            <div
                              className="h-full rounded-full"
                              style={{
                                width: `${(node.risk_score ?? 0) * 100}%`,
                                backgroundColor: getRiskColor(node.risk_score ?? 0),
                              }}
                            />
                          </div>
                          <span
                            className="font-bold tabular-nums text-xs w-8 text-right"
                            style={{ color: getRiskColor(node.risk_score ?? 0) }}
                          >
                            {((node.risk_score ?? 0) * 100).toFixed(0)}%
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-3 hidden lg:table-cell">
                        <div className="flex flex-wrap gap-1">
                          {node.risk_factors?.slice(0, 3).map((factor) => (
                            <span
                              key={factor}
                              className="px-1.5 py-0.5 rounded text-[10px] bg-surface-800 text-surface-400 border border-surface-700"
                            >
                              {factor.replace(/_/g, ' ')}
                            </span>
                          ))}
                          {(node.risk_factors?.length ?? 0) > 3 && (
                            <span className="text-[10px] text-surface-600">
                              +{(node.risk_factors?.length ?? 0) - 3}
                            </span>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {/* Circular dependencies */}
        {circularNodes.length > 0 && (
          <section className="space-y-3">
            <div className="flex items-center gap-2">
              <RefreshCw className="w-4 h-4 text-risk-high" />
              <h2 className="text-sm font-semibold text-surface-200">
                Circular Dependencies ({circularNodes.length} nodes affected)
              </h2>
            </div>
            <div className="p-4 rounded-xl bg-surface-900 border border-surface-800">
              <div className="flex flex-wrap gap-2">
                {circularNodes.map((node) => (
                  <button
                    key={node.id}
                    onClick={() => onNodeSelect(node.id)}
                    className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-red-950 text-red-300 border border-red-900 text-xs hover:bg-red-900 transition-colors"
                  >
                    <RefreshCw className="w-2.5 h-2.5" />
                    {node.label}
                  </button>
                ))}
              </div>
            </div>
          </section>
        )}

        {/* Orphan nodes */}
        {orphanNodes.length > 0 && (
          <section className="space-y-3">
            <div className="flex items-center gap-2">
              <Ghost className="w-4 h-4 text-surface-500" />
              <h2 className="text-sm font-semibold text-surface-200">
                Orphan Nodes ({orphanNodes.length})
              </h2>
            </div>
            <div className="p-4 rounded-xl bg-surface-900 border border-surface-800">
              <div className="flex flex-wrap gap-2">
                {orphanNodes.slice(0, 30).map((node) => (
                  <button
                    key={node.id}
                    onClick={() => onNodeSelect(node.id)}
                    className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-surface-800 text-surface-400 border border-surface-700 text-xs hover:bg-surface-700 hover:text-surface-200 transition-colors"
                  >
                    {node.label}
                  </button>
                ))}
                {orphanNodes.length > 30 && (
                  <span className="text-xs text-surface-600 self-center">
                    +{orphanNodes.length - 30} more
                  </span>
                )}
              </div>
            </div>
          </section>
        )}

        {/* Node smells detail */}
        {graph.nodes.some((n) => (n.structural_warnings?.length ?? 0) > 0) && (
          <section className="space-y-3">
            <div className="flex items-center gap-2">
              <Activity className="w-4 h-4 text-amber-500" />
              <h2 className="text-sm font-semibold text-surface-200">
                Nodes with Structural Warnings
              </h2>
            </div>
            <div className="space-y-2">
              {graph.nodes
                .filter((n) => (n.structural_warnings?.length ?? 0) > 0)
                .slice(0, 15)
                .map((node) => (
                  <div
                    key={node.id}
                    className="flex items-center gap-3 p-3 rounded-lg bg-surface-900 border border-surface-800 hover:border-surface-700 cursor-pointer transition-colors"
                    onClick={() => onNodeSelect(node.id)}
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-surface-200 truncate">
                        {node.label}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-1 justify-end">
                      {node.structural_warnings?.map((w, i) => (
                        <SmellBadge key={i} warning={w} compact />
                      ))}
                    </div>
                  </div>
                ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
