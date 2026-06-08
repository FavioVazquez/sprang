import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  X,
  FileText,
  Zap,
  Box,
  Settings,
  Server,
  Globe,
  Circle,
  AlertTriangle,
  GitCommit,
  Users,
  ExternalLink,
  ChevronRight,
  HelpCircle,
  Shield,
  CheckCircle,
} from 'lucide-react';
import { Button } from './ui/Button';
import { Badge } from './ui/Badge';
import { Tooltip } from './ui/Tooltip';
import { SmellBadge } from './SmellBadge';
import { getRiskColor, getRiskLabel } from '../api/graphApi';
import type { SprangNode, KnowledgeGraph, NodeType, RiskFactor } from '../types';

interface NodePanelProps {
  node: SprangNode | null;
  graph: KnowledgeGraph;
  onClose: () => void;
}

const NODE_ICONS: Record<NodeType, React.ComponentType<{ className?: string }>> = {
  file: FileText,
  function: Zap,
  class: Box,
  module: Circle,
  concept: Globe,
  config: Settings,
  document: FileText,
  service: Server,
  table: Circle,
  endpoint: Globe,
  pipeline: Circle,
  schema: Box,
  resource: Circle,
  domain: Globe,
  flow: Circle,
  step: ChevronRight,
  article: FileText,
  entity: Globe,
  topic: Circle,
  claim: Circle,
  source: FileText,
};

function NodeIcon({ type, className }: { type: NodeType; className?: string }) {
  const Icon = NODE_ICONS[type] ?? Circle;
  return <Icon className={className} />;
}

const RISK_FACTOR_LABELS: Record<RiskFactor, string> = {
  high_coupling: 'High Coupling',
  no_test_coverage: 'No Tests',
  frequent_changes: 'Frequent Changes',
  large_blast_radius: 'Large Blast Radius',
  critical_path: 'Critical Path',
  single_author: 'Single Author',
  recent_churn: 'Recent Churn',
  has_structural_warnings: 'Structural Warnings',
};

const COMPLEXITY_VARIANT = {
  simple: 'info' as const,
  moderate: 'warning' as const,
  complex: 'risk-high' as const,
};

function AuthorAvatar({ name }: { name: string }) {
  const initials = name
    .split(/[\s@._-]+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('');

  const colors = [
    'bg-surface-700 text-sprang-300',
    'bg-surface-700 text-blue-300',
    'bg-surface-700 text-green-300',
    'bg-surface-700 text-amber-300',
  ];
  const colorIdx =
    name.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0) % colors.length;

  return (
    <div
      title={name}
      className={`inline-flex items-center justify-center w-7 h-7 rounded-full text-[10px] font-bold ${colors[colorIdx]} border border-surface-700 flex-shrink-0`}
    >
      {initials || '?'}
    </div>
  );
}

function Section({
  title,
  tooltip,
  children,
}: {
  title: string;
  tooltip?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2 pt-1">
      <div className="flex items-center gap-1.5 border-t border-surface-800 pt-3 -mt-1">
        <h3 className="text-[11px] font-medium text-surface-400">{title}</h3>
        {tooltip && (
          <Tooltip content={tooltip} side="right" delayDuration={200}>
            <HelpCircle className="w-3 h-3 text-surface-600 hover:text-surface-400 cursor-help transition-colors flex-shrink-0" />
          </Tooltip>
        )}
      </div>
      {children}
    </div>
  );
}

export function NodePanel({ node, graph, onClose }: NodePanelProps) {
  const getNeighbors = (nodeId: string) => {
    const neighborIds = new Set<string>();
    for (const edge of graph.edges) {
      if (edge.source === nodeId) neighborIds.add(edge.target);
      if (edge.target === nodeId) neighborIds.add(edge.source);
    }
    return Array.from(neighborIds)
      .map((id) => graph.nodes.find((n) => n.id === id))
      .filter(Boolean) as typeof graph.nodes;
  };

  const layer = node?.layer
    ? graph.layers.find((l) => l.id === node.layer)
    : undefined;

  return (
    <AnimatePresence>
      {node && (
        <motion.aside
          key="node-panel"
          initial={{ x: 400, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          exit={{ x: 400, opacity: 0 }}
          transition={{ type: 'spring', stiffness: 320, damping: 32 }}
          className="w-[400px] h-full flex-shrink-0 bg-surface-900 border-l border-surface-700 flex flex-col overflow-hidden"
        >
          {/* Header */}
          <div className="flex items-start gap-3 px-5 pt-5 pb-4 border-b border-surface-800">
            <div className="flex-shrink-0 mt-0.5 p-2 rounded-lg bg-surface-800 text-sprang-400">
              <NodeIcon type={node.type} className="w-4 h-4" />
            </div>
            <div className="flex-1 min-w-0">
              <h2 className="text-sm font-semibold text-surface-50 leading-snug break-all">
                {node.label}
              </h2>
              {node.location && (
                <p className="text-xs text-surface-500 font-mono mt-0.5 truncate">
                  {node.location.file}
                  {node.location.start_line != null &&
                    `:${node.location.start_line}`}
                </p>
              )}
            </div>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={onClose}
              className="flex-shrink-0 -mr-1 -mt-1"
              aria-label="Close panel"
            >
              <X className="w-4 h-4" />
            </Button>
          </div>

          {/* Scrollable body */}
          <div className="flex-1 overflow-y-auto px-5 py-4 space-y-6">
            {/* Type + layer + complexity badges */}
            <div className="flex flex-wrap gap-1.5">
              <Badge variant="accent">{node.type}</Badge>
              {layer && <Badge variant="layer">{layer.name}</Badge>}
              {node.complexity && (
                <Badge variant={COMPLEXITY_VARIANT[node.complexity]}>
                  {node.complexity}
                </Badge>
              )}
              {node.tags?.map((tag) => (
                <Badge key={tag} variant="outline">
                  {tag}
                </Badge>
              ))}
            </div>

            {/* Risk score */}
            {node.risk_score != null && (
              <Section title="Risk Score" tooltip="Likelihood that a change to this node causes downstream failures. Composite of blast radius (0.35), coupling (0.25), test coverage (0.25), and churn (0.15). Above 0.7 is high risk.">
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-surface-400">
                      {getRiskLabel(node.risk_score)}
                    </span>
                    <span
                      className="text-sm font-bold tabular-nums"
                      style={{ color: getRiskColor(node.risk_score) }}
                    >
                      {(node.risk_score * 100).toFixed(0)}%
                    </span>
                  </div>
                  <div className="h-1.5 rounded-full bg-surface-800 overflow-hidden">
                    <motion.div
                      initial={{ width: 0 }}
                      animate={{ width: `${node.risk_score * 100}%` }}
                      transition={{ type: 'spring', stiffness: 200, damping: 30 }}
                      className="h-full rounded-full"
                      style={{ backgroundColor: getRiskColor(node.risk_score) }}
                    />
                  </div>
                </div>
              </Section>
            )}

            {/* Summary */}
            {node.summary && (
              <Section title="Summary">
                <p className="text-sm text-surface-300 leading-relaxed">
                  {node.summary}
                </p>
              </Section>
            )}

            {/* Risk factors */}
            {node.risk_factors && node.risk_factors.length > 0 && (
              <Section title="Risk Factors" tooltip="Specific signals that drove the risk score up. Address 'no_test_coverage' and 'large_blast_radius' first — they have the highest weight.">
                <div className="flex flex-wrap gap-1.5">
                  {node.risk_factors.map((factor) => (
                    <span
                      key={factor}
                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-surface-800 text-surface-300 border border-surface-700"
                    >
                      <AlertTriangle className="w-2.5 h-2.5 text-amber-500 flex-shrink-0" />
                      {RISK_FACTOR_LABELS[factor] ?? factor}
                    </span>
                  ))}
                </div>
              </Section>
            )}

            {/* Structural warnings */}
            {node.structural_warnings && node.structural_warnings.length > 0 && (
              <Section title="Structural Warnings" tooltip="Heuristic code smells detected by static analysis — no LLM involved. god_node, circular_dependency, and unstable_interface are the most critical to address.">
                <div className="space-y-2">
                  {node.structural_warnings.map((warning, i) => (
                    <div
                      key={i}
                      className="p-3 rounded-lg bg-surface-800 border border-surface-700 space-y-1.5"
                    >
                      <SmellBadge warning={warning} />
                      <p className="text-xs text-surface-400 leading-relaxed">
                        {warning.description}
                      </p>
                      <code className="block text-[10px] font-mono text-surface-500 bg-surface-900 px-2 py-1 rounded">
                        {warning.heuristic}
                      </code>
                    </div>
                  ))}
                </div>
              </Section>
            )}

            {/* Security warnings */}
            {node.security_warnings && node.security_warnings.length > 0 && (
              <Section title="Security Issues" tooltip="Security vulnerabilities detected by static pattern analysis. High severity issues increase the risk score by 0.15.">
                <div className="space-y-2">
                  {node.security_warnings.map((warning, i) => (
                    <div
                      key={i}
                      className={`p-3 rounded-lg border space-y-1.5 ${
                        warning.severity === 'high' ? 'bg-red-950 border-red-900' :
                        warning.severity === 'medium' ? 'bg-amber-950 border-amber-900' :
                        'bg-surface-800 border-surface-700'
                      }`}
                    >
                      <div className="flex items-center gap-1.5">
                        <Shield className={`w-3.5 h-3.5 flex-shrink-0 ${
                          warning.severity === 'high' ? 'text-red-400' :
                          warning.severity === 'medium' ? 'text-amber-400' : 'text-surface-400'
                        }`} />
                        <span className={`text-xs font-medium ${
                          warning.severity === 'high' ? 'text-red-300' :
                          warning.severity === 'medium' ? 'text-amber-300' : 'text-surface-300'
                        }`}>
                          {warning.category.replace(/_/g, ' ')}
                          {warning.line && <span className="opacity-60 font-normal ml-1.5">line {warning.line}</span>}
                        </span>
                        <span className={`ml-auto text-[10px] px-1.5 py-0.5 rounded border uppercase font-bold ${
                          warning.severity === 'high' ? 'text-red-300 border-red-800' :
                          warning.severity === 'medium' ? 'text-amber-300 border-amber-800' :
                          'text-surface-400 border-surface-700'
                        }`}>
                          {warning.severity}
                        </span>
                      </div>
                      <p className="text-xs text-surface-400 leading-relaxed">{warning.description}</p>
                      {warning.snippet && (
                        <code className="block text-[10px] font-mono text-surface-500 bg-surface-900/60 px-2 py-1 rounded truncate">
                          {warning.snippet}
                        </code>
                      )}
                    </div>
                  ))}
                </div>
              </Section>
            )}

            {/* Detected patterns */}
            {node.detected_patterns && node.detected_patterns.length > 0 && (
              <Section title="Design Patterns" tooltip="Design patterns detected by static analysis. These are architectural strengths.">
                <div className="flex flex-wrap gap-1.5">
                  {node.detected_patterns.map((pattern) => (
                    <span
                      key={pattern}
                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-green-950 text-green-300 border border-green-900"
                    >
                      <CheckCircle className="w-2.5 h-2.5 flex-shrink-0" />
                      {pattern.replace(/_/g, ' ')}
                    </span>
                  ))}
                </div>
              </Section>
            )}

            {/* Decision context */}
            {node.decision_context && (
              <Section title="Decision Context" tooltip="Git history analysis: who changed this file and why, extracted from commit messages. Rationale snippets are LLM-summarized commit message patterns.">
                <div className="space-y-3">
                  {/* Authors */}
                  {node.decision_context.primary_authors.length > 0 && (
                    <div className="flex items-center gap-2">
                      <Users className="w-3.5 h-3.5 text-surface-500 flex-shrink-0" />
                      <div className="flex items-center gap-1 flex-wrap">
                        {node.decision_context.primary_authors.map((author) => (
                          <AuthorAvatar key={author} name={author} />
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Last changed + frequency */}
                  <div className="grid grid-cols-2 gap-2">
                    <div className="p-2 rounded-lg bg-surface-800 border border-surface-700">
                      <p className="text-[10px] text-surface-500">
                        Last Changed
                      </p>
                      <p className="text-xs text-surface-200 mt-0.5 font-medium">
                        {new Date(node.decision_context.last_changed).toLocaleDateString(
                          'en-US',
                          { month: 'short', day: 'numeric', year: 'numeric' },
                        )}
                      </p>
                    </div>
                    <div className="p-2 rounded-lg bg-surface-800 border border-surface-700">
                      <p className="text-[10px] text-surface-500">
                        90-Day Changes
                      </p>
                      <p className="text-xs text-surface-200 mt-0.5 font-bold">
                        {node.decision_context.change_frequency}×
                      </p>
                    </div>
                  </div>

                  {/* Rationale snippets */}
                  {node.decision_context.rationale_snippets.slice(0, 3).map(
                    (snippet, i) => (
                      <div
                        key={i}
                        className="bg-surface-800/60 rounded-md px-3 py-2"
                      >
                        <p className="text-xs text-surface-400 italic leading-relaxed">
                          "{snippet}"
                        </p>
                      </div>
                    ),
                  )}

                  {/* PR references */}
                  {node.decision_context.pr_references.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {node.decision_context.pr_references.map((pr) => (
                        <span
                          key={pr}
                          className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs bg-blue-950 text-blue-300 border border-blue-900"
                        >
                          <ExternalLink className="w-2.5 h-2.5" />
                          {pr}
                        </span>
                      ))}
                    </div>
                  )}

                  {/* Recent commits */}
                  {node.decision_context.commits.slice(0, 3).map((commit) => (
                    <div
                      key={commit.sha}
                      className="flex items-start gap-2 p-2 rounded-lg bg-surface-800 border border-surface-700"
                    >
                      <GitCommit className="w-3 h-3 text-surface-500 flex-shrink-0 mt-0.5" />
                      <div className="min-w-0 flex-1">
                        <p className="text-xs text-surface-300 truncate">
                          {commit.message}
                        </p>
                        <p className="text-[10px] text-surface-500 mt-0.5 font-mono">
                          {commit.sha} · {commit.author}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </Section>
            )}

            {/* Neighbors */}
            {(() => {
              const neighbors = getNeighbors(node.id);
              if (neighbors.length === 0) return null;
              return (
                <Section title={`Neighbors (${neighbors.length})`}>
                  <div className="space-y-1">
                    {neighbors.slice(0, 12).map((neighbor) => (
                      <div
                        key={neighbor.id}
                        className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-surface-800 transition-colors"
                      >
                        <NodeIcon
                          type={neighbor.type}
                          className="w-3.5 h-3.5 text-surface-500 flex-shrink-0"
                        />
                        <span className="text-xs text-surface-300 truncate flex-1">
                          {neighbor.label}
                        </span>
                        <Badge variant="outline" className="text-[10px] flex-shrink-0">
                          {neighbor.type}
                        </Badge>
                      </div>
                    ))}
                    {neighbors.length > 12 && (
                      <p className="text-xs text-surface-500 px-2">
                        +{neighbors.length - 12} more
                      </p>
                    )}
                  </div>
                </Section>
              );
            })()}

            {/* Annotations (stored as raw markdown strings) */}
            {node.annotations && node.annotations.length > 0 && (
              <Section title="Annotations">
                <div className="space-y-2">
                  {node.annotations.map((annotation, i) => (
                    <div
                      key={i}
                      className="p-3 rounded-lg bg-surface-800 border border-surface-700"
                    >
                      <p className="text-xs text-surface-300 leading-relaxed whitespace-pre-wrap">
                        {annotation}
                      </p>
                    </div>
                  ))}
                </div>
              </Section>
            )}
          </div>
        </motion.aside>
      )}
    </AnimatePresence>
  );
}
