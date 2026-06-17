import React, { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { FolderOpen, Github, Sparkles, ArrowRight, Loader2, AlertCircle, RefreshCw } from 'lucide-react';
import { Button } from './ui/Button';

export interface AnalyzeParams {
  path?: string;
  githubUrl?: string;
}

interface Props {
  onAnalyze: (params: AnalyzeParams) => Promise<void>;
  onRetry?: () => void;
  autoScan?: boolean;
  defaultPath?: string;
}

type InputMode = 'local' | 'github';
type Status = 'idle' | 'cloning' | 'scanning' | 'error';

const SCAN_MESSAGES = [
  'Reading file structure…',
  'Building import graph…',
  'Detecting frameworks…',
  'Parsing source files…',
  'Computing blast radius…',
  'Detecting code smells…',
  'Scoring risk…',
  'Assembling knowledge graph…',
];

const CLONE_MESSAGES = [
  'Connecting to GitHub…',
  'Cloning repository…',
  'Fetching file tree…',
];

const GH_PATTERN = /^(https?:\/\/)?(www\.)?github\.com\/[\w.-]+\/[\w.-]+|^[\w.-]+\/[\w.-]+$/;

function detectMode(value: string): InputMode {
  const trimmed = value.trim();
  if (
    trimmed.startsWith('github.com/') ||
    trimmed.startsWith('https://github.com/') ||
    trimmed.startsWith('http://github.com/') ||
    GH_PATTERN.test(trimmed)
  ) return 'github';
  return 'local';
}

export function LandingScreen({ onAnalyze, onRetry, autoScan = false, defaultPath = '' }: Props) {
  const [input, setInput] = useState(defaultPath);
  const [mode, setMode] = useState<InputMode>('local');
  const [status, setStatus] = useState<Status>('idle');
  const [errorMsg, setErrorMsg] = useState('');
  const [msgIndex, setMsgIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const autoFiredRef = useRef(false);

  // Cycle progress messages during scan/clone
  useEffect(() => {
    if (status !== 'scanning' && status !== 'cloning') return;
    const messages = status === 'cloning' ? CLONE_MESSAGES : SCAN_MESSAGES;
    setMsgIndex(0);
    const id = setInterval(() => {
      setMsgIndex((i) => (i + 1) % messages.length);
    }, 2200);
    return () => clearInterval(id);
  }, [status]);

  const handleInput = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setInput(val);
    setMode(detectMode(val));
    if (status === 'error') setErrorMsg('');
  }, [status]);

  const submit = useCallback(async (overrideInput?: string) => {
    const value = (overrideInput ?? input).trim();
    if (!value && !autoScan) return;

    setStatus(mode === 'github' || detectMode(value) === 'github' ? 'cloning' : 'scanning');
    setErrorMsg('');

    const params: AnalyzeParams = detectMode(value) === 'github'
      ? { githubUrl: value }
      : { path: value || undefined };

    try {
      await onAnalyze(params);
    } catch (err) {
      setStatus('error');
      setErrorMsg(err instanceof Error ? err.message : 'Analysis failed. Check the path and try again.');
    }
  }, [input, mode, onAnalyze, autoScan]);

  // Auto-scan: fire once if ?autoScan=1 was set by CLI
  useEffect(() => {
    if (autoScan && !autoFiredRef.current) {
      autoFiredRef.current = true;
      void submit(defaultPath || undefined);
    }
  }, [autoScan, defaultPath, submit]);

  // Focus input on mount
  useEffect(() => {
    if (!autoScan) inputRef.current?.focus();
  }, [autoScan]);

  const isLoading = status === 'scanning' || status === 'cloning';
  const messages = status === 'cloning' ? CLONE_MESSAGES : SCAN_MESSAGES;

  return (
    <div className="fixed inset-0 bg-surface-950 flex flex-col items-center justify-center z-50 px-6">
      {/* Logo */}
      <motion.div
        initial={{ opacity: 0, y: -16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
        className="flex flex-col items-center gap-3 mb-10"
      >
        <div className="relative">
          <div className="absolute inset-0 rounded-2xl bg-sprang-500/20 blur-xl" />
          <div className="relative w-14 h-14 rounded-2xl bg-surface-800 border border-surface-700 flex items-center justify-center shadow-xl">
            <Sparkles className="w-7 h-7 text-sprang-400" />
          </div>
        </div>
        <div className="text-center">
          <h1 className="text-lg font-bold text-surface-100 tracking-tight">Sprang</h1>
          <p className="text-xs text-surface-500 mt-0.5">Knowledge graph for any codebase</p>
        </div>
      </motion.div>

      {/* Input card */}
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1], delay: 0.08 }}
        className="w-full max-w-lg space-y-4"
      >
        {/* Smart input */}
        <div className={`relative flex items-center gap-2 px-4 py-3 rounded-xl bg-surface-900 border transition-colors duration-150 ${
          status === 'error' ? 'border-red-500/60' : 'border-surface-700 focus-within:border-sprang-500/60'
        }`}>
          {/* Mode icon */}
          <AnimatePresence mode="wait">
            <motion.span
              key={mode}
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.8 }}
              transition={{ duration: 0.15 }}
              className="flex-shrink-0"
            >
              {mode === 'github'
                ? <Github className="w-4 h-4 text-sprang-400" />
                : <FolderOpen className="w-4 h-4 text-surface-500" />}
            </motion.span>
          </AnimatePresence>

          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={handleInput}
            onKeyDown={(e) => { if (e.key === 'Enter' && !isLoading) void submit(); }}
            placeholder={mode === 'github' ? 'github.com/owner/repo' : '/path/to/your/project'}
            disabled={isLoading}
            className="flex-1 bg-transparent text-sm text-surface-200 placeholder-surface-600 outline-none font-mono disabled:opacity-40"
          />

          {/* Mode badge */}
          <AnimatePresence mode="wait">
            <motion.span
              key={mode}
              initial={{ opacity: 0, x: 6 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -6 }}
              transition={{ duration: 0.15 }}
              className={`flex-shrink-0 text-[10px] font-medium px-1.5 py-0.5 rounded ${
                mode === 'github'
                  ? 'bg-sprang-500/15 text-sprang-400'
                  : 'bg-surface-800 text-surface-500'
              }`}
            >
              {mode === 'github' ? 'GitHub' : 'Local'}
            </motion.span>
          </AnimatePresence>
        </div>

        {/* Error */}
        <AnimatePresence>
          {status === 'error' && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="flex items-start gap-2 px-3 py-2.5 rounded-lg bg-red-500/10 border border-red-500/20"
            >
              <AlertCircle className="w-3.5 h-3.5 text-red-400 mt-0.5 flex-shrink-0" />
              <p className="text-xs text-red-300">{errorMsg}</p>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Analyze button / loading state */}
        <AnimatePresence mode="wait">
          {isLoading ? (
            <motion.div
              key="loading"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex flex-col items-center gap-3 py-2"
            >
              <div className="flex items-center gap-2.5">
                <Loader2 className="w-4 h-4 text-sprang-400 animate-spin" />
                <AnimatePresence mode="wait">
                  <motion.span
                    key={msgIndex}
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -4 }}
                    transition={{ duration: 0.25 }}
                    className="text-sm text-surface-400"
                  >
                    {messages[msgIndex % messages.length]}
                  </motion.span>
                </AnimatePresence>
              </div>
              <div className="w-48 h-0.5 bg-surface-800 rounded-full overflow-hidden">
                <motion.div
                  className="h-full bg-sprang-500 rounded-full"
                  animate={{ x: ['-100%', '200%'] }}
                  transition={{ duration: 1.6, repeat: Infinity, ease: 'easeInOut' }}
                />
              </div>
            </motion.div>
          ) : (
            <motion.div key="button" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <Button
                variant="default"
                className="w-full gap-2 h-10"
                onClick={() => void submit()}
                disabled={!input.trim()}
              >
                {status === 'error' ? (
                  <><RefreshCw className="w-4 h-4" />Try again</>
                ) : (
                  <><Sparkles className="w-4 h-4" />Analyze<ArrowRight className="w-3.5 h-3.5 ml-auto" /></>
                )}
              </Button>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Examples */}
        {status === 'idle' && !isLoading && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.3 }}
            className="flex flex-wrap items-center gap-1.5 justify-center pt-1"
          >
            <span className="text-[10px] text-surface-600">Try:</span>
            {[
              { label: 'faviovazquez/sprang', value: 'github.com/faviovazquez/sprang' },
              { label: 'Lum1104/Understand-Anything', value: 'github.com/Lum1104/Understand-Anything' },
              { label: '~/my-project', value: '~/my-project' },
            ].map(({ label, value }) => (
              <button
                key={value}
                onClick={() => {
                  setInput(value);
                  setMode(detectMode(value));
                }}
                className="text-[10px] text-surface-500 hover:text-sprang-400 font-mono transition-colors px-1.5 py-0.5 rounded bg-surface-900 border border-surface-800 hover:border-sprang-500/40"
              >
                {label}
              </button>
            ))}
          </motion.div>
        )}
      </motion.div>

      {/* Footer note */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.5 }}
        className="absolute bottom-8 flex flex-col items-center gap-2"
      >
        <p className="text-[10px] text-surface-700 text-center">
          Phase 1 runs locally in under 60 seconds — no API key needed.
          <br />
          GitHub repos are cloned to a temp folder and never stored.
        </p>
        {onRetry && !isLoading && (
          <button
            onClick={onRetry}
            className="flex items-center gap-1 text-[10px] text-surface-600 hover:text-surface-400 transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-sprang-500 rounded px-1.5 py-0.5"
          >
            <RefreshCw className="w-2.5 h-2.5" />
            Retry loading existing graph
          </button>
        )}
      </motion.div>
    </div>
  );
}
