import React, { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Sparkles, Send, Loader2, X, AlertCircle } from 'lucide-react';

interface CascadeResponse {
  response: string;
  question: string | null;
  written_at: string;
}

type PanelState = 'idle' | 'waiting' | 'done' | 'error' | 'unavailable';

const POLL_INTERVAL_MS = 1500;
const POLL_TIMEOUT_MS = 120_000; // 2 min max wait

async function postAsk(message: string): Promise<boolean> {
  try {
    const res = await fetch('/cascade-ask', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function pollResponse(): Promise<CascadeResponse | null | 'unavailable'> {
  try {
    const res = await fetch('/cascade-response');
    if (res.status === 204) return null; // not ready yet
    if (res.status === 404) return 'unavailable';
    if (!res.ok) return null;
    return (await res.json()) as CascadeResponse;
  } catch {
    return null;
  }
}

async function clearResponse(): Promise<void> {
  try { await fetch('/cascade-response', { method: 'DELETE' }); } catch { /* ignore */ }
}

export function AskCascadePanel() {
  const [open, setOpen] = useState(false);
  const [question, setQuestion] = useState('');
  const [state, setState] = useState<PanelState>('idle');
  const [response, setResponse] = useState<CascadeResponse | null>(null);
  const [errorMsg, setErrorMsg] = useState('');
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const timeoutTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const stopPolling = useCallback(() => {
    if (pollTimerRef.current) { clearInterval(pollTimerRef.current); pollTimerRef.current = null; }
    if (timeoutTimerRef.current) { clearTimeout(timeoutTimerRef.current); timeoutTimerRef.current = null; }
  }, []);

  useEffect(() => () => stopPolling(), [stopPolling]);

  const startPolling = useCallback((sentQuestion: string) => {
    setState('waiting');
    stopPolling();

    pollTimerRef.current = setInterval(async () => {
      const result = await pollResponse();
      if (result === 'unavailable') {
        stopPolling();
        setState('unavailable');
        return;
      }
      if (result && result.written_at) {
        stopPolling();
        setResponse(result);
        setState('done');
      }
    }, POLL_INTERVAL_MS);

    timeoutTimerRef.current = setTimeout(() => {
      stopPolling();
      setErrorMsg(`No response received within 2 minutes for: "${sentQuestion}"`);
      setState('error');
    }, POLL_TIMEOUT_MS);
  }, [stopPolling]);

  const handleSubmit = useCallback(async () => {
    const msg = question.trim();
    if (!msg || state === 'waiting') return;

    await clearResponse();
    setResponse(null);
    setErrorMsg('');

    const ok = await postAsk(msg);
    if (!ok) {
      setErrorMsg('Could not reach the dashboard server. Is SPRANG_ROOT set and the server running?');
      setState('error');
      return;
    }
    startPolling(msg);
  }, [question, state, startPolling]);

  const handleReset = useCallback(async () => {
    stopPolling();
    await clearResponse();
    setResponse(null);
    setErrorMsg('');
    setState('idle');
    setQuestion('');
  }, [stopPolling]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void handleSubmit();
    }
  }, [handleSubmit]);

  useEffect(() => {
    if (open && state === 'idle') {
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open, state]);

  return (
    <>
      {/* Trigger button in nav — rendered by parent, but we expose a toggle */}
      <button
        onClick={() => setOpen((v) => !v)}
        title="Ask Cascade"
        className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors ${
          open
            ? 'bg-sprang-500/20 text-sprang-300'
            : 'text-surface-500 hover:text-surface-300 hover:bg-surface-800/50'
        }`}
      >
        <Sparkles className="w-3.5 h-3.5" />
        <span className="hidden sm:inline">Ask Cascade</span>
      </button>

      {/* Slide-down panel */}
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
            className="absolute top-full left-0 right-0 z-50 bg-surface-900 border-b border-surface-800 shadow-xl"
          >
            <div className="max-w-2xl mx-auto px-4 py-3 space-y-3">
              {/* Header */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Sparkles className="w-3.5 h-3.5 text-sprang-400" />
                  <span className="text-xs font-semibold text-surface-300">Ask Cascade</span>
                  <span className="text-[10px] text-surface-600">
                    — sends to Windsurf via cascade-bridge
                  </span>
                </div>
                <button
                  onClick={() => { setOpen(false); stopPolling(); }}
                  className="text-surface-600 hover:text-surface-300 transition-colors"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>

              {/* Input */}
              {(state === 'idle' || state === 'error') && (
                <div className="flex gap-2">
                  <textarea
                    ref={inputRef}
                    value={question}
                    onChange={(e) => setQuestion(e.target.value)}
                    onKeyDown={handleKeyDown}
                    rows={2}
                    placeholder="Ask about the codebase… (Enter to send, Shift+Enter for newline)"
                    className="flex-1 resize-none rounded-lg bg-surface-800 border border-surface-700 text-xs text-surface-200 placeholder-surface-600 px-3 py-2 focus:outline-none focus:ring-1 focus:ring-sprang-500"
                  />
                  <button
                    onClick={() => void handleSubmit()}
                    disabled={!question.trim()}
                    className="self-end px-3 py-2 rounded-lg bg-sprang-500 hover:bg-sprang-400 disabled:opacity-40 disabled:cursor-not-allowed text-white transition-colors"
                  >
                    <Send className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}

              {/* Error */}
              {state === 'error' && errorMsg && (
                <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-red-950/50 border border-red-800/50">
                  <AlertCircle className="w-3.5 h-3.5 text-red-400 flex-shrink-0 mt-0.5" />
                  <p className="text-xs text-red-300">{errorMsg}</p>
                </div>
              )}

              {/* Unavailable */}
              {state === 'unavailable' && (
                <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-amber-950/50 border border-amber-800/50">
                  <AlertCircle className="w-3.5 h-3.5 text-amber-400 flex-shrink-0 mt-0.5" />
                  <p className="text-xs text-amber-300">
                    cascade-bridge extension not detected. Install it in Windsurf and ensure it&apos;s
                    watching this workspace.
                  </p>
                </div>
              )}

              {/* Waiting */}
              {state === 'waiting' && (
                <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-surface-800 border border-surface-700">
                  <Loader2 className="w-3.5 h-3.5 text-sprang-400 animate-spin flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-surface-400 truncate">
                      Waiting for Cascade… <span className="text-surface-600 italic">{question}</span>
                    </p>
                  </div>
                  <button
                    onClick={handleReset}
                    className="text-surface-600 hover:text-surface-300 text-[10px] transition-colors flex-shrink-0"
                  >
                    cancel
                  </button>
                </div>
              )}

              {/* Response */}
              {state === 'done' && response && (
                <div className="space-y-2">
                  {response.question && (
                    <p className="text-[10px] text-surface-600 italic truncate">Q: {response.question}</p>
                  )}
                  <div className="px-3 py-2 rounded-lg bg-surface-800 border border-sprang-500/30 text-xs text-surface-200 leading-relaxed whitespace-pre-wrap max-h-48 overflow-y-auto">
                    {response.response}
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] text-surface-600">
                      {new Date(response.written_at).toLocaleTimeString()}
                    </span>
                    <button
                      onClick={handleReset}
                      className="text-[10px] text-sprang-400 hover:text-sprang-300 transition-colors"
                    >
                      Ask another question
                    </button>
                  </div>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
