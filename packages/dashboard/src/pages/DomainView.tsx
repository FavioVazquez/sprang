import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ChevronRight,
  ChevronDown,
  Globe,
  ArrowRight,
  Info,
  Layers,
  Terminal,
} from 'lucide-react';
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

export function DomainView({ graph, onNodeSelect }: DomainViewProps) {
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
    <div className="flex-1 overflow-y-auto bg-surface-950">
      <div className="max-w-3xl mx-auto px-6 py-8 space-y-6">
        {/* Heading */}
        <div className="space-y-1">
          <h1 className="text-xl font-bold text-surface-50">Business Domain Explorer</h1>
          <p className="text-sm text-surface-500">
            {graph.domains.length} domain{graph.domains.length !== 1 ? 's' : ''} ·{' '}
            {graph.domains.reduce((sum, d) => sum + d.flows.length, 0)} flows mapped
          </p>
        </div>

        {/* Info banner */}
        <div className="flex items-start gap-2 px-3 py-2.5 rounded-lg bg-blue-950/50 border border-blue-900/50">
          <Info className="w-3.5 h-3.5 text-blue-400 flex-shrink-0 mt-0.5" />
          <p className="text-xs text-blue-300">
            Click any node chip to jump to it in the graph view. Expand flows to see step
            details and entry points.
          </p>
        </div>

        {/* Domain cards */}
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
  );
}
