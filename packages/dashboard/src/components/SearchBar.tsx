import React, { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Search, X, FileText, Zap, Box, Settings, Server, Globe, Circle } from 'lucide-react';
import Fuse from 'fuse.js';
import { Badge } from './ui/Badge';
import { getRiskColor } from '../api/graphApi';
import type { KnowledgeGraph, SprangNode, NodeType } from '../types';

interface SearchBarProps {
  graph: KnowledgeGraph;
  onSelect: (nodeId: string) => void;
  onClose: () => void;
}

const NODE_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  file: FileText,
  function: Zap,
  class: Box,
  config: Settings,
  service: Server,
  domain: Globe,
  module: Circle,
  concept: Globe,
  document: FileText,
  table: Circle,
  endpoint: Globe,
  pipeline: Circle,
  schema: Box,
  resource: Circle,
  flow: Circle,
};

function NodeTypeIcon({ type }: { type: NodeType }) {
  const Icon = NODE_ICONS[type] ?? Circle;
  return <Icon className="w-4 h-4" />;
}

interface FuseResult {
  item: SprangNode;
  score?: number;
}

export function SearchBar({ graph, onSelect, onClose }: SearchBarProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<FuseResult[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const fuse = useRef(
    new Fuse(graph.nodes, {
      keys: [
        { name: 'label', weight: 2 },
        { name: 'summary', weight: 1 },
        { name: 'type', weight: 0.5 },
        { name: 'tags', weight: 0.5 },
      ],
      threshold: 0.35,
      includeScore: true,
      distance: 100,
    }),
  );

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    if (query.trim() === '') {
      // Show top nodes by risk score when no query
      const topNodes = [...graph.nodes]
        .sort((a, b) => (b.risk_score ?? 0) - (a.risk_score ?? 0))
        .slice(0, 8)
        .map((item) => ({ item }));
      setResults(topNodes);
    } else {
      const fuseResults = fuse.current.search(query).slice(0, 10);
      setResults(fuseResults);
    }
    setActiveIndex(0);
  }, [query, graph.nodes]);

  const handleSelect = useCallback(
    (nodeId: string) => {
      onSelect(nodeId);
      onClose();
    },
    [onSelect, onClose],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActiveIndex((i) => Math.min(i + 1, results.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActiveIndex((i) => Math.max(i - 1, 0));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const result = results[activeIndex];
        if (result) handleSelect(result.item.id);
      } else if (e.key === 'Escape') {
        onClose();
      }
    },
    [results, activeIndex, handleSelect, onClose],
  );

  // Scroll active item into view
  useEffect(() => {
    const activeEl = listRef.current?.querySelector(`[data-idx="${activeIndex}"]`);
    activeEl?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex]);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.15 }}
      className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh]"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />

      {/* Command palette */}
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: -16 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: -16 }}
        transition={{ type: 'spring', stiffness: 400, damping: 32 }}
        className="relative w-full max-w-xl mx-4 bg-surface-900 border border-surface-700 rounded-xl shadow-2xl shadow-black/70 overflow-hidden"
        role="dialog"
        aria-label="Search nodes"
        aria-modal="true"
      >
        {/* Search input */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-surface-800">
          <Search className="w-4 h-4 text-surface-500 flex-shrink-0" />
          <input
            ref={inputRef}
            type="text"
            placeholder="Search nodes, files, functions..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            className="flex-1 bg-transparent text-sm text-surface-100 placeholder:text-surface-600 outline-none"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
          />
          {query && (
            <button
              onClick={() => setQuery('')}
              className="text-surface-500 hover:text-surface-300 transition-colors"
              aria-label="Clear search"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
          <kbd className="hidden sm:inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] text-surface-600 bg-surface-800 border border-surface-700 font-mono">
            ESC
          </kbd>
        </div>

        {/* Results */}
        <div ref={listRef} className="max-h-[360px] overflow-y-auto py-1.5">
          {results.length === 0 ? (
            <div className="px-4 py-8 text-center">
              <p className="text-sm text-surface-500">No results for "{query}"</p>
            </div>
          ) : (
            <>
              {query === '' && (
                <p className="px-4 pt-1 pb-2 text-[10px] text-surface-600 font-medium">
                  Top by risk score
                </p>
              )}
              {results.map(({ item: node }, idx) => (
                <button
                  key={node.id}
                  data-idx={idx}
                  onClick={() => handleSelect(node.id)}
                  onMouseEnter={() => setActiveIndex(idx)}
                  className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors ${
                    idx === activeIndex ? 'bg-surface-800' : 'hover:bg-surface-800/50'
                  }`}
                  role="option"
                  aria-selected={idx === activeIndex}
                >
                  {/* Type icon */}
                  <span
                    className={`flex-shrink-0 ${
                      idx === activeIndex ? 'text-sprang-400' : 'text-surface-500'
                    }`}
                  >
                    <NodeTypeIcon type={node.type} />
                  </span>

                  {/* Label + summary */}
                  <div className="flex-1 min-w-0">
                    <p
                      className={`text-sm font-medium truncate ${
                        idx === activeIndex ? 'text-surface-50' : 'text-surface-200'
                      }`}
                    >
                      {node.label}
                    </p>
                    {node.summary && (
                      <p className="text-xs text-surface-500 truncate mt-0.5">
                        {node.summary}
                      </p>
                    )}
                  </div>

                  {/* Type badge */}
                  <Badge variant="outline" className="flex-shrink-0 text-[10px]">
                    {node.type}
                  </Badge>

                  {/* Risk dot */}
                  {node.risk_score != null && (
                    <span
                      className="w-2 h-2 rounded-full flex-shrink-0"
                      title={`Risk: ${(node.risk_score * 100).toFixed(0)}%`}
                      style={{ backgroundColor: getRiskColor(node.risk_score) }}
                    />
                  )}
                </button>
              ))}
            </>
          )}
        </div>

        {/* Footer hint */}
        <div className="px-4 py-2 border-t border-surface-800 flex items-center gap-3">
          <span className="text-[10px] text-surface-600">
            <kbd className="font-mono bg-surface-800 border border-surface-700 rounded px-1">↑↓</kbd>{' '}
            navigate
          </span>
          <span className="text-[10px] text-surface-600">
            <kbd className="font-mono bg-surface-800 border border-surface-700 rounded px-1">↵</kbd>{' '}
            select
          </span>
          <span className="ml-auto text-[10px] text-surface-600">
            {results.length} result{results.length !== 1 ? 's' : ''}
          </span>
        </div>
      </motion.div>
    </motion.div>
  );
}
