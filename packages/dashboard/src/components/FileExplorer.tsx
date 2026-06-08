import { useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronRight, ChevronDown, File, Folder, FolderOpen } from 'lucide-react';
import { useDashboardStore } from '../store';
import type { SprangNode } from '../types';

// ─── Tree model ───────────────────────────────────────────────────────────────

interface FileEntry {
  name: string;
  path: string;
  type: 'folder' | 'file';
  children: FileEntry[];
  nodeId?: string;
  nodeType?: string;
}

function normalizeFilePath(filePath: string): string | null {
  const normalized = filePath.replace(/\\/g, '/').replace(/^\/+/, '').replace(/^\.\//, '');
  if (!normalized || normalized === '.' || normalized.includes('\0')) return null;
  if (normalized.split('/').some((part) => part === '..')) return null;
  return normalized;
}

function bestNode(existing: SprangNode | undefined, candidate: SprangNode): SprangNode {
  if (!existing) return candidate;
  if (existing.type !== 'file' && candidate.type === 'file') return candidate;
  return existing;
}

function buildFileTree(nodes: SprangNode[]): FileEntry[] {
  const files = new Map<string, SprangNode>();
  for (const node of nodes) {
    const fp = node.filePath ?? node.location?.file;
    if (!fp) continue;
    const normalized = normalizeFilePath(fp);
    if (!normalized) continue;
    files.set(normalized, bestNode(files.get(normalized), node));
  }

  const root: FileEntry = { name: '', path: '', type: 'folder', children: [] };
  const folders = new Map<string, FileEntry>([['', root]]);

  for (const [filePath, node] of files) {
    const parts = filePath.split('/');
    let parent = root;
    let currentPath = '';

    for (let i = 0; i < parts.length; i++) {
      const name = parts[i] ?? '';
      currentPath = currentPath ? `${currentPath}/${name}` : name;
      const isFile = i === parts.length - 1;

      if (isFile) {
        parent.children.push({
          name,
          path: currentPath,
          type: 'file',
          children: [],
          nodeId: node.id,
          nodeType: node.type,
        });
        continue;
      }

      let folder = folders.get(currentPath);
      if (!folder) {
        folder = { name, path: currentPath, type: 'folder', children: [] };
        folders.set(currentPath, folder);
        parent.children.push(folder);
      }
      parent = folder;
    }
  }

  const sortEntries = (entries: FileEntry[]): FileEntry[] =>
    entries
      .sort((a, b) => {
        if (a.type !== b.type) return a.type === 'folder' ? -1 : 1;
        return a.name.localeCompare(b.name);
      })
      .map((entry) => ({ ...entry, children: sortEntries(entry.children) }));

  return sortEntries(root.children);
}

function countFiles(entries: FileEntry[]): number {
  return entries.reduce(
    (n, e) => n + (e.type === 'file' ? 1 : countFiles(e.children)),
    0,
  );
}

// ─── Tree row ─────────────────────────────────────────────────────────────────

function FileTreeRow({
  entry,
  depth,
  expanded,
  selectedNodeId,
  toggleFolder,
  openFile,
}: {
  entry: FileEntry;
  depth: number;
  expanded: Set<string>;
  selectedNodeId: string | null;
  toggleFolder: (path: string) => void;
  openFile: (nodeId: string, openViewer?: boolean) => void;
}) {
  const isExpanded = expanded.has(entry.path);
  const isSelected = entry.nodeId === selectedNodeId;
  const paddingLeft = 10 + depth * 12;

  if (entry.type === 'folder') {
    return (
      <>
        <button
          type="button"
          onClick={() => toggleFolder(entry.path)}
          className="w-full flex items-center gap-1.5 py-1 pr-3 text-left text-[11px] text-surface-400 hover:text-surface-200 hover:bg-surface-800/50 transition-colors"
          style={{ paddingLeft }}
          title={entry.path}
        >
          <motion.span
            animate={{ rotate: isExpanded ? 90 : 0 }}
            transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
            style={{ display: 'inline-flex', flexShrink: 0 }}
          >
            <ChevronRight className="w-3 h-3 text-surface-500" />
          </motion.span>
          {isExpanded
            ? <FolderOpen className="w-3 h-3 text-sprang-400 shrink-0" />
            : <Folder className="w-3 h-3 text-surface-500 shrink-0" />}
          <span className="truncate font-medium">{entry.name}</span>
        </button>
        <AnimatePresence initial={false}>
          {isExpanded && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
              style={{ overflow: 'hidden' }}
            >
              {entry.children.map((child) => (
                <FileTreeRow
                  key={child.path}
                  entry={child}
                  depth={depth + 1}
                  expanded={expanded}
                  selectedNodeId={selectedNodeId}
                  toggleFolder={toggleFolder}
                  openFile={openFile}
                />
              ))}
            </motion.div>
          )}
        </AnimatePresence>
      </>
    );
  }

  return (
    <button
      type="button"
      onClick={() => entry.nodeId && openFile(entry.nodeId, false)}
      className={`w-full flex items-center gap-1.5 py-1 pr-3 text-left text-[11px] transition-colors ${
        isSelected
          ? 'text-sprang-300 bg-sprang-500/10 border-l-2 border-sprang-400'
          : 'text-surface-400 hover:text-surface-200 hover:bg-surface-800/50'
      }`}
      style={{ paddingLeft: isSelected ? paddingLeft - 2 : paddingLeft }}
      title={`${entry.path} — click to select, double-click to open source`}
      onDoubleClick={() => entry.nodeId && openFile(entry.nodeId, true)}
    >
      <span className="w-3 shrink-0" />
      <File className="w-3 h-3 text-surface-600 shrink-0" />
      <span className="truncate font-mono">{entry.name}</span>
    </button>
  );
}

type FileTreeRowAdapterProps = Omit<React.ComponentProps<typeof FileTreeRow>, 'openFile'> & {
  onSelectNode: (nodeId: string) => void;
  onOpenViewer: (nodeId: string) => void;
};

function FileTreeRowAdapter({ onSelectNode, onOpenViewer, ...rest }: FileTreeRowAdapterProps) {
  return (
    <FileTreeRow
      {...rest}
      openFile={(nodeId, openViewer = false) => {
        onSelectNode(nodeId);
        if (openViewer) onOpenViewer(nodeId);
      }}
    />
  );
}

// ─── Public component ─────────────────────────────────────────────────────────

export function FileExplorer() {
  const { graph, selectedNodeId, navigateToNode, openCodeViewer } = useDashboardStore();
  const entries = useMemo(() => buildFileTree(graph?.nodes ?? []), [graph]);
  const totalFiles = useMemo(() => countFiles(entries), [entries]);

  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [search, setSearch] = useState('');

  const toggleFolder = (folderPath: string) => {
    setExpanded((cur) => {
      const next = new Set(cur);
      next.has(folderPath) ? next.delete(folderPath) : next.add(folderPath);
      return next;
    });
  };

  const handleSelectNode = (nodeId: string) => navigateToNode(nodeId);
  const handleOpenViewer = (nodeId: string) => {
    navigateToNode(nodeId);
    openCodeViewer(nodeId);
  };

  // Flatten all file entries for search
  const flatFiles = useMemo(() => {
    const out: FileEntry[] = [];
    const walk = (items: FileEntry[]) => {
      for (const e of items) {
        if (e.type === 'file') out.push(e);
        else walk(e.children);
      }
    };
    walk(entries);
    return out;
  }, [entries]);

  const filteredFiles = useMemo(() => {
    if (!search.trim()) return null;
    const q = search.toLowerCase();
    return flatFiles.filter((f) => f.name.toLowerCase().includes(q) || f.path.toLowerCase().includes(q));
  }, [search, flatFiles]);

  if (!graph) {
    return (
      <div className="h-full flex items-center justify-center p-5 text-sm text-surface-500">
        No graph loaded
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col min-h-0 bg-surface-950">
      {/* Header */}
      <div className="px-3 py-2.5 border-b border-surface-800 shrink-0">
        <div className="text-[10px] font-semibold uppercase tracking-wider text-sprang-400 mb-1.5">
          Files
        </div>
        <div className="text-[10px] text-surface-500 mb-2">
          {totalFiles} file{totalFiles === 1 ? '' : 's'} from graph
        </div>
        {/* Search */}
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Filter files…"
          className="w-full bg-surface-800 border border-surface-700 rounded text-[11px] text-surface-200 placeholder-surface-600 px-2 py-1 focus:outline-none focus:border-sprang-500/60"
        />
      </div>

      {/* Tree / search results */}
      <div className="flex-1 overflow-auto py-1">
        {filteredFiles !== null ? (
          filteredFiles.length === 0 ? (
            <div className="px-3 py-4 text-[11px] text-surface-500">No files match "{search}"</div>
          ) : (
            filteredFiles.map((entry) => (
              <FileTreeRowAdapter
                key={entry.path}
                entry={entry}
                depth={0}
                expanded={expanded}
                selectedNodeId={selectedNodeId}
                toggleFolder={toggleFolder}
                onSelectNode={handleSelectNode}
                onOpenViewer={handleOpenViewer}
              />
            ))
          )
        ) : entries.length === 0 ? (
          <div className="px-3 py-4 text-[11px] text-surface-500">
            No file paths found in graph. Run <code className="text-sprang-400">npx sprang scan</code> to generate file nodes.
          </div>
        ) : (
          entries.map((entry) => (
            <FileTreeRowAdapter
              key={entry.path}
              entry={entry}
              depth={0}
              expanded={expanded}
              selectedNodeId={selectedNodeId}
              toggleFolder={toggleFolder}
              onSelectNode={handleSelectNode}
              onOpenViewer={handleOpenViewer}
            />
          ))
        )}
      </div>
    </div>
  );
}
