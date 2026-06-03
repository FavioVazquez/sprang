import { useEffect, useMemo, useState } from 'react';
import { Highlight, themes } from 'prism-react-renderer';
import { X, Maximize2, Minimize2, FileCode, AlertCircle, Loader2 } from 'lucide-react';
import { useDashboardStore } from '../store';

// ─── Types ────────────────────────────────────────────────────────────────────

interface SourceFile {
  path: string;
  language: string;
  content: string;
}

type SourceState =
  | { status: 'idle' | 'loading'; source: null; error: null }
  | { status: 'loaded'; source: SourceFile; error: null }
  | { status: 'error'; source: null; error: string };

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fallbackLanguage(filePath: string | undefined): string {
  const ext = filePath?.split('.').pop()?.toLowerCase();
  const byExt: Record<string, string> = {
    ts: 'typescript', tsx: 'tsx', js: 'javascript', jsx: 'jsx',
    py: 'python', go: 'go', rs: 'rust', java: 'java', kt: 'kotlin',
    cs: 'csharp', rb: 'ruby', php: 'php', c: 'c', cpp: 'cpp',
    css: 'css', scss: 'scss', html: 'markup', md: 'markdown',
    json: 'json', yaml: 'yaml', yml: 'yaml', sh: 'bash', sql: 'sql',
    toml: 'toml', graphql: 'graphql',
  };
  return ext ? (byExt[ext] ?? 'text') : 'text';
}

function formatLines(count: number): string {
  return `${count.toLocaleString()} line${count === 1 ? '' : 's'}`;
}

// ─── Component ────────────────────────────────────────────────────────────────

export interface CodeViewerProps {
  /** 'sidebar' = narrow panel inside GraphView; 'modal' = full expanded overlay */
  presentation?: 'sidebar' | 'modal';
  onClose?: () => void;
  onExpand?: () => void;
}

export function CodeViewer({ presentation = 'sidebar', onClose, onExpand }: CodeViewerProps) {
  const { codeViewerNodeId, nodesById, closeCodeViewer } = useDashboardStore();
  const node = codeViewerNodeId ? (nodesById.get(codeViewerNodeId) ?? null) : null;

  const [state, setState] = useState<SourceState>({ status: 'idle', source: null, error: null });

  useEffect(() => {
    if (!node?.filePath) {
      if (node) {
        setState({ status: 'error', source: null, error: 'This node does not have a file path.' });
      }
      return;
    }

    const controller = new AbortController();
    setState({ status: 'loading', source: null, error: null });

    const url = `/file-content.json?path=${encodeURIComponent(node.filePath)}`;
    fetch(url, { signal: controller.signal })
      .then(async (res) => {
        const data = await res.json() as SourceFile | { error?: string };
        if (!res.ok) {
          throw new Error('error' in data && data.error ? data.error : 'Source unavailable');
        }
        setState({ status: 'loaded', source: data as SourceFile, error: null });
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setState({
          status: 'error', source: null,
          error: err instanceof Error ? err.message : String(err),
        });
      });

    return () => controller.abort();
  }, [node?.filePath, node]);

  const highlightedRange = useMemo(() => {
    if (!node?.lineRange) return null;
    return { start: node.lineRange[0], end: node.lineRange[1] };
  }, [node?.lineRange]);

  const handleClose = onClose ?? closeCodeViewer;
  const isModal = presentation === 'modal';
  const language = state.source?.language ?? fallbackLanguage(node?.filePath);
  const displayName = node?.name ?? node?.label ?? node?.filePath ?? '—';

  if (!node) {
    return (
      <div className="h-full w-full flex items-center justify-center bg-surface-900">
        <div className="text-center text-surface-500 text-xs space-y-2">
          <FileCode className="w-8 h-8 mx-auto opacity-40" />
          <p>Select a node to view its source</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full w-full flex flex-col bg-surface-950 overflow-hidden">
      {/* Header */}
      <div className="flex items-start gap-3 px-3 py-2.5 bg-surface-900 border-b border-surface-800 shrink-0">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded border border-sprang-500/30 bg-sprang-500/10 text-sprang-400">
              {language}
            </span>
            {highlightedRange && (
              <span className="text-[10px] text-surface-500">
                lines {highlightedRange.start}–{highlightedRange.end}
              </span>
            )}
          </div>
          <div className="text-xs font-semibold text-surface-200 truncate" title={displayName}>
            {displayName}
          </div>
          {node.filePath && (
            <div className="text-[10px] font-mono text-surface-500 truncate mt-0.5" title={node.filePath}>
              {node.filePath}
            </div>
          )}
        </div>

        <div className="flex items-center gap-1 shrink-0 mt-0.5">
          {onExpand && (
            <button
              type="button"
              onClick={onExpand}
              className="p-1 rounded text-surface-500 hover:text-surface-300 hover:bg-surface-800 transition-colors"
              title={isModal ? 'Collapse' : 'Expand'}
            >
              {isModal ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
            </button>
          )}
          <button
            type="button"
            onClick={handleClose}
            className="p-1 rounded text-surface-500 hover:text-surface-300 hover:bg-surface-800 transition-colors"
            title="Close"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 min-h-0 overflow-auto bg-surface-950 text-[11px] font-mono">
        {state.status === 'loading' && (
          <div className="flex items-center gap-2 p-4 text-surface-500">
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
            <span>Loading source…</span>
          </div>
        )}

        {state.status === 'error' && (
          <div className="p-4">
            <div className="flex items-start gap-2 rounded-lg border border-surface-700 bg-surface-900 p-3">
              <AlertCircle className="w-4 h-4 text-risk-high shrink-0 mt-0.5" />
              <div>
                <p className="text-xs font-medium text-surface-200 mb-1">Source unavailable</p>
                <p className="text-[11px] text-surface-400 leading-relaxed">{state.error}</p>
              </div>
            </div>
          </div>
        )}

        {state.status === 'loaded' && state.source && (
          <>
            {/* File meta bar */}
            <div className="px-3 py-1.5 border-b border-surface-800 bg-surface-900 text-[10px] text-surface-500 flex items-center justify-between">
              <span>{formatLines(state.source.content.split('\n').length)}</span>
              <span>{state.source.path}</span>
            </div>

            <Highlight
              code={state.source.content}
              language={language}
              theme={themes.vsDark}
            >
              {({ className, style, tokens, getLineProps, getTokenProps }) => (
                <pre
                  className={`${className} m-0 p-0 min-w-max ${isModal ? 'text-xs leading-5' : 'text-[11px] leading-5'}`}
                  style={{ ...style, background: 'transparent' }}
                >
                  {tokens.map((line, index) => {
                    const lineNumber = index + 1;
                    const isHighlighted =
                      highlightedRange !== null &&
                      lineNumber >= highlightedRange.start &&
                      lineNumber <= highlightedRange.end;
                    const lineProps = getLineProps({ line });
                    return (
                      <div
                        key={lineNumber}
                        {...lineProps}
                        className={`${lineProps.className ?? ''} flex ${
                          isHighlighted
                            ? 'bg-sprang-500/15 border-l-2 border-sprang-400'
                            : 'hover:bg-surface-900/60'
                        }`}
                      >
                        <span className="w-11 shrink-0 select-none text-right pr-3 text-surface-600 bg-surface-950/60 border-r border-surface-800">
                          {lineNumber}
                        </span>
                        <span className="pl-3 pr-6 whitespace-pre">
                          {line.map((token, key) => (
                            <span key={key} {...getTokenProps({ token })} />
                          ))}
                        </span>
                      </div>
                    );
                  })}
                </pre>
              )}
            </Highlight>
          </>
        )}
      </div>
    </div>
  );
}
