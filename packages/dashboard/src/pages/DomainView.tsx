import React, { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ChevronRight,
  ChevronDown,
  Globe,
  ArrowRight,
  Info,
  Layers,
  Terminal,
  LayoutList,
  Workflow,
} from 'lucide-react';
import { ReactFlow, Background, Controls, MiniMap, type Node, type Edge } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { Badge } from '../components/ui/Badge';
import type { KnowledgeGraph, Domain, DomainFlow, DomainStep } from '../types';

interface DomainViewProps {
  graph: KnowledgeGraph;
  onNodeSelect: (nodeId: string) => void;
}

function StepChip({
  nodeId,
  graph,
  onNodeSelect,
}: {
  nodeId: string;
  graph: KnowledgeGraph;
  onNodeSelect: (id: string) => void;
}) {
  const node = graph.nodes.find((n) => n.id === nodeId);
  if (!node) {
    return (
      <span className="px-2 py-0.5 rounded text-[10px] bg-surface-800 text-surface-500 border border-surface-700 font-mono">
        {nodeId}
      </span>
    );
  }
  return (
    <button
      onClick={() => onNodeSelect(nodeId)}
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] bg-surface-800 text-surface-300 border border-surface-700 hover:bg-surface-700 hover:text-surface-50 transition-colors font-medium"
    >
      {node.label}
      <Badge variant="accent" className="text-[9px] px-1 py-0">
        {node.type}
      </Badge>
    </button>
  );
}

function FlowStep({
  step,
  index,
  graph,
  onNodeSelect,
}: {
  step: DomainStep;
  index: number;
  graph: KnowledgeGraph;
  onNodeSelect: (id: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="relative pl-8">
      {/* Timeline connector */}
      <div className="absolute left-3 top-0 bottom-0 w-px bg-surface-800" />
      <div className="absolute left-[7px] top-3 w-4 h-4 rounded-full bg-surface-800 border-2 border-surface-700 flex items-center justify-center">
        <span className="text-[9px] font-bold text-surface-400">{index + 1}</span>
      </div>

      <div className="pb-4">
        <button
          className="flex items-start gap-2 w-full text-left group"
          onClick={() => step.node_ids.length > 0 && setExpanded((v) => !v)}
        >
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-surface-200 group-hover:text-surface-50 transition-colors">
                {step.label}
              </span>
              {step.node_ids.length > 0 && (
                <ChevronRight
                  className={`w-3.5 h-3.5 text-surface-600 transition-transform ${
                    expanded ? 'rotate-90' : ''
                  }`}
                />
              )}
            </div>
            {step.summary && (
              <p className="text-xs text-surface-500 mt-0.5 leading-relaxed">
                {step.summary}
              </p>
            )}
          </div>
          <span className="text-[10px] text-surface-600 flex-shrink-0 mt-0.5">
            {(step.weight * 100).toFixed(0)}%
          </span>
        </button>

        <AnimatePresence>
          {expanded && step.node_ids.length > 0 && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
              className="overflow-hidden"
            >
              <div className="mt-2 flex flex-wrap gap-1.5">
                {step.node_ids.map((nodeId) => (
                  <StepChip
                    key={nodeId}
                    nodeId={nodeId}
                    graph={graph}
                    onNodeSelect={onNodeSelect}
                  />
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

function FlowCard({
  flow,
  index,
  graph,
  onNodeSelect,
}: {
  flow: DomainFlow;
  index: number;
  graph: KnowledgeGraph;
  onNodeSelect: (id: string) => void;
}) {
  const [expanded, setExpanded] = useState(index === 0);

  return (
    <div className="rounded-xl border border-surface-800 overflow-hidden bg-surface-900/50">
      {/* Flow header */}
      <button
        className="w-full flex items-center gap-3 px-4 py-3.5 text-left hover:bg-surface-800/40 transition-colors"
        onClick={() => setExpanded((v) => !v)}
      >
        <div
          className={`flex-shrink-0 w-6 h-6 rounded-md flex items-center justify-center text-xs font-bold ${
            expanded ? 'bg-sprang-900 text-sprang-300' : 'bg-surface-800 text-surface-500'
          }`}
        >
          {index + 1}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-surface-100">{flow.label}</p>
          {flow.summary && !expanded && (
            <p className="text-xs text-surface-500 truncate mt-0.5">{flow.summary}</p>
          )}
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <span className="text-xs text-surface-600">{flow.steps.length} steps</span>
          <ChevronDown
            className={`w-4 h-4 text-surface-500 transition-transform duration-200 ${
              expanded ? 'rotate-180' : ''
            }`}
          />
        </div>
      </button>

      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            initial={{ height: 0 }}
            animate={{ height: 'auto' }}
            exit={{ height: 0 }}
            transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
            className="overflow-hidden"
          >
            <div className="px-4 pt-1 pb-4 border-t border-surface-800 space-y-3">
              {flow.summary && (
                <p className="text-xs text-surface-400 leading-relaxed">{flow.summary}</p>
              )}

              {/* Entry points */}
              {flow.entry_points && flow.entry_points.length > 0 && (
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[10px] uppercase tracking-widest text-surface-600 font-medium">
                    Entry
                  </span>
                  {flow.entry_points.map((ep) => (
                    <StepChip
                      key={ep}
                      nodeId={ep}
                      graph={graph}
                      onNodeSelect={onNodeSelect}
                    />
                  ))}
                </div>
              )}

              {/* Business rules */}
              {flow.business_rules && flow.business_rules.length > 0 && (
                <div className="space-y-1">
                  <p className="text-[10px] uppercase tracking-widest text-surface-600 font-medium">
                    Business Rules
                  </p>
                  <ul className="space-y-0.5">
                    {flow.business_rules.map((rule, i) => (
                      <li key={i} className="flex items-start gap-2 text-xs text-surface-400">
                        <ArrowRight className="w-3 h-3 text-surface-600 mt-0.5 flex-shrink-0" />
                        {rule}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Steps timeline */}
              {flow.steps.length > 0 && (
                <div className="mt-2">
                  {flow.steps.map((step, i) => (
                    <FlowStep
                      key={step.id}
                      step={step}
                      index={i}
                      graph={graph}
                      onNodeSelect={onNodeSelect}
                    />
                  ))}
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function DomainCard({
  domain,
  graph,
  onNodeSelect,
}: {
  domain: Domain;
  graph: KnowledgeGraph;
  onNodeSelect: (id: string) => void;
}) {
  const [expanded, setExpanded] = useState(true);

  return (
    <div className="rounded-2xl border border-surface-800 bg-surface-900/30 overflow-hidden">
      {/* Domain header */}
      <button
        className="w-full flex items-start gap-4 px-5 py-4 text-left hover:bg-surface-800/20 transition-colors"
        onClick={() => setExpanded((v) => !v)}
      >
        <div className="flex-shrink-0 p-2.5 rounded-xl bg-surface-800 text-sprang-400 mt-0.5">
          <Globe className="w-4 h-4" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h2 className="text-base font-bold text-surface-50">{domain.label}</h2>
            <Badge variant="accent" className="text-[10px]">
              {domain.flows.length} flow{domain.flows.length !== 1 ? 's' : ''}
            </Badge>
          </div>
          {domain.summary && (
            <p className="text-sm text-surface-400 mt-1 leading-relaxed">
              {domain.summary}
            </p>
          )}
          {domain.entities && domain.entities.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-2">
              {domain.entities.map((entity) => (
                <span
                  key={entity}
                  className="px-2 py-0.5 rounded text-[10px] bg-surface-800 text-surface-400 border border-surface-700"
                >
                  {entity}
                </span>
              ))}
            </div>
          )}
        </div>
        <ChevronDown
          className={`w-5 h-5 text-surface-500 flex-shrink-0 mt-1 transition-transform duration-200 ${
            expanded ? 'rotate-180' : ''
          }`}
        />
      </button>

      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            initial={{ height: 0 }}
            animate={{ height: 'auto' }}
            exit={{ height: 0 }}
            transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
            className="overflow-hidden"
          >
            <div className="px-5 pb-5 pt-1 border-t border-surface-800 space-y-3">
              {domain.flows.map((flow, idx) => (
                <FlowCard
                  key={flow.id}
                  flow={flow}
                  index={idx}
                  graph={graph}
                  onNodeSelect={onNodeSelect}
                />
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── React Flow domain graph ─────────────────────────────────────────────────

const DOMAIN_COLORS = [
  '#d946ef', '#3b82f6', '#22c55e', '#f59e0b',
  '#ec4899', '#06b6d4', '#84cc16', '#f97316',
];

function DomainFlowGraph({
  domains,
  onNodeSelect,
}: {
  domains: Domain[];
  onNodeSelect: (id: string) => void;
}) {
  const { nodes, edges } = useMemo(() => {
    const rfNodes: Node[] = [];
    const rfEdges: Edge[] = [];
    const DOMAIN_GAP_X = 340;
    const FLOW_GAP_Y = 90;
    const DOMAIN_HEADER_H = 60;

    domains.forEach((domain, di) => {
      const domainColor = DOMAIN_COLORS[di % DOMAIN_COLORS.length];
      const domainX = di * DOMAIN_GAP_X;

      rfNodes.push({
        id: `domain:${domain.id}`,
        type: 'default',
        position: { x: domainX, y: 0 },
        data: { label: domain.label },
        style: {
          background: domainColor + '18',
          border: `1.5px solid ${domainColor}50`,
          borderRadius: 12,
          color: domainColor,
          fontWeight: 700,
          fontSize: 12,
          padding: '6px 12px',
          minWidth: 160,
          textAlign: 'center',
        },
      });

      domain.flows.forEach((flow, fi) => {
        const flowY = DOMAIN_HEADER_H + fi * FLOW_GAP_Y;
        rfNodes.push({
          id: `flow:${flow.id}`,
          type: 'default',
          position: { x: domainX + 20, y: flowY },
          data: { label: flow.label },
          style: {
            background: '#18181b',
            border: `1px solid #3f3f46`,
            borderRadius: 8,
            color: '#a1a1aa',
            fontSize: 11,
            padding: '4px 10px',
            minWidth: 140,
          },
        });
        rfEdges.push({
          id: `e-domain-${domain.id}-flow-${flow.id}`,
          source: `domain:${domain.id}`,
          target: `flow:${flow.id}`,
          style: { stroke: domainColor + '60', strokeWidth: 1 },
          animated: false,
        });
      });
    });

    return { nodes: rfNodes, edges: rfEdges };
  }, [domains]);

  return (
    <div className="w-full h-full">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodeClick={(_e, node) => {
          if (node.id.startsWith('flow:')) {
            const flowId = node.id.replace('flow:', '');
            for (const domain of domains) {
              const flow = domain.flows.find((f) => f.id === flowId);
              if (flow?.steps[0]?.node_ids[0]) {
                onNodeSelect(flow.steps[0].node_ids[0]);
              }
            }
          }
        }}
        fitView
        colorMode="dark"
        proOptions={{ hideAttribution: true }}
        style={{ background: '#09090b' }}
      >
        <Background color="#27272a" gap={20} size={1} />
        <Controls
          style={{ background: '#18181b', border: '1px solid #3f3f46', color: '#a1a1aa' }}
        />
        <MiniMap
          style={{ background: '#18181b', border: '1px solid #3f3f46' }}
          nodeColor="#3f3f46"
          maskColor="rgba(0,0,0,0.7)"
        />
      </ReactFlow>
    </div>
  );
}

// ─── Main view ────────────────────────────────────────────────────────────────

export function DomainView({ graph, onNodeSelect }: DomainViewProps) {
  const [viewMode, setViewMode] = useState<'list' | 'flow'>('list');

  if (!graph.domains || graph.domains.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center bg-surface-950">
        <div className="text-center space-y-4 max-w-sm px-6">
          <div className="mx-auto w-14 h-14 rounded-2xl bg-surface-800 border border-surface-700 flex items-center justify-center">
            <Layers className="w-7 h-7 text-surface-600" />
          </div>
          <div>
            <h2 className="text-base font-semibold text-surface-300">
              No domain analysis yet
            </h2>
            <p className="text-sm text-surface-500 mt-1 leading-relaxed">
              Run the sprang scanner to generate domain flows and business logic
              mapping.
            </p>
          </div>
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-surface-900 border border-surface-800 text-left">
            <Terminal className="w-4 h-4 text-sprang-400 flex-shrink-0" />
            <code className="text-xs text-surface-300 font-mono">sprang scan</code>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-surface-950">
      {/* Sub-nav */}
      <div className="flex items-center justify-between px-6 py-3 border-b border-surface-800 shrink-0">
        <div>
          <h1 className="text-sm font-bold text-surface-100">Business Domain Explorer</h1>
          <p className="text-xs text-surface-500 mt-0.5">
            {graph.domains.length} domain{graph.domains.length !== 1 ? 's' : ''} ·{' '}
            {graph.domains.reduce((sum, d) => sum + d.flows.length, 0)} flows
          </p>
        </div>
        <div className="flex items-center gap-1 bg-surface-800 rounded-lg p-0.5 border border-surface-700">
          <button
            type="button"
            onClick={() => setViewMode('list')}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors ${
              viewMode === 'list'
                ? 'bg-surface-700 text-surface-100'
                : 'text-surface-500 hover:text-surface-300'
            }`}
          >
            <LayoutList className="w-3.5 h-3.5" />
            List
          </button>
          <button
            type="button"
            onClick={() => setViewMode('flow')}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors ${
              viewMode === 'flow'
                ? 'bg-surface-700 text-surface-100'
                : 'text-surface-500 hover:text-surface-300'
            }`}
          >
            <Workflow className="w-3.5 h-3.5" />
            Graph
          </button>
        </div>
      </div>

      {viewMode === 'list' ? (
        <div className="flex-1 overflow-y-auto">
          <div className="max-w-3xl mx-auto px-6 py-6 space-y-6">
            {/* Info banner */}
            <div className="flex items-start gap-2 px-3 py-2.5 rounded-lg bg-blue-950/50 border border-blue-900/50">
              <Info className="w-3.5 h-3.5 text-blue-400 flex-shrink-0 mt-0.5" />
              <p className="text-xs text-blue-300">
                Click any node chip to jump to it in the graph view. Expand flows to see step details and entry points.
              </p>
            </div>
            {graph.domains.map((domain) => (
              <DomainCard
                key={domain.id}
                domain={domain}
                graph={graph}
                onNodeSelect={onNodeSelect}
              />
            ))}
          </div>
        </div>
      ) : (
        <div className="flex-1 min-h-0">
          <DomainFlowGraph domains={graph.domains} onNodeSelect={onNodeSelect} />
        </div>
      )}
    </div>
  );
}
