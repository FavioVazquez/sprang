import React, { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Sparkles, Send, Loader2, X, AlertCircle, MessageSquare, Trash2 } from 'lucide-react';

type BridgeKind = 'windsurf' | 'claude' | 'copilot' | 'none';

interface BridgeStatus {
  kind: BridgeKind;
  detail: string;
}

const BRIDGE_LABELS: Record<BridgeKind, string> = {
  windsurf: 'Windsurf',
  claude: 'Claude Code',
  copilot: 'Copilot CLI',
  none: 'No bridge',
};

interface CascadeResponse {
  response: string;
  question: string | null;
  written_at: string;
}

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'error';
  text: string;
  ts: string;
}

const POLL_INTERVAL_MS = 1500;
const POLL_TIMEOUT_MS = 120_000;

async function fetchBridgeStatus(): Promise<BridgeStatus> {
  try {
    const res = await fetch('/bridge-status');
    if (!res.ok) return { kind: 'none', detail: 'bridge-status endpoint unavailable' };
    return (await res.json()) as BridgeStatus;
  } catch {
    return { kind: 'none', detail: 'bridge-status fetch failed' };
  }
}

async function postAsk(message: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch('/cascade-ask', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({} as Record<string, unknown>)) as Record<string, unknown>;
      return { ok: false, error: typeof body['error'] === 'string' ? body['error'] : `HTTP ${res.status}` };
    }
    return { ok: true };
  } catch {
    return { ok: false, error: 'Network error' };
  }
}

async function pollResponse(): Promise<CascadeResponse | null | 'unavailable'> {
  try {
    const res = await fetch('/cascade-response');
    if (res.status === 204) return null;
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

export function AskAgentPanel() {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState('');
  const [waiting, setWaiting] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [bridgeOk, setBridgeOk] = useState(true);
  const [bridgeStatus, setBridgeStatus] = useState<BridgeStatus | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const timeoutTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Track last response timestamp to avoid re-adding same response
  const lastResponseTs = useRef<string>('');

  const stopPolling = useCallback(() => {
    if (pollTimerRef.current) { clearInterval(pollTimerRef.current); pollTimerRef.current = null; }
    if (timeoutTimerRef.current) { clearTimeout(timeoutTimerRef.current); timeoutTimerRef.current = null; }
  }, []);

  useEffect(() => () => stopPolling(), [stopPolling]);

  // Scroll to bottom whenever messages change
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, waiting]);

  // Focus input + fetch bridge status when panel opens
  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 80);
      fetchBridgeStatus().then(setBridgeStatus).catch(() => null);
    }
  }, [open]);

  const startPolling = useCallback((sentQuestion: string) => {
    stopPolling();
    setWaiting(true);

    pollTimerRef.current = setInterval(async () => {
      const result = await pollResponse();
      if (result === 'unavailable') {
        stopPolling();
        setWaiting(false);
        setBridgeOk(false);
        setMessages((prev) => [...prev, {
          id: crypto.randomUUID(),
          role: 'error',
          text: 'cascade-bridge not detected. Make sure it is installed and watching this workspace.',
          ts: new Date().toISOString(),
        }]);
        return;
      }
      if (result && result.written_at && result.written_at !== lastResponseTs.current) {
        lastResponseTs.current = result.written_at;
        stopPolling();
        setWaiting(false);
        await clearResponse();
        setMessages((prev) => [...prev, {
          id: crypto.randomUUID(),
          role: 'assistant',
          text: result.response,
          ts: result.written_at,
        }]);
      }
    }, POLL_INTERVAL_MS);

    timeoutTimerRef.current = setTimeout(() => {
      stopPolling();
      setWaiting(false);
      setMessages((prev) => [...prev, {
        id: crypto.randomUUID(),
        role: 'error',
        text: `No response received within 2 minutes for: "${sentQuestion}"`,
        ts: new Date().toISOString(),
      }]);
    }, POLL_TIMEOUT_MS);
  }, [stopPolling]);

  const handleSubmit = useCallback(async () => {
    const msg = input.trim();
    if (!msg || waiting) return;

    setInput('');
    setBridgeOk(true);
    await clearResponse();

    // Add user message immediately
    setMessages((prev) => [...prev, {
      id: crypto.randomUUID(),
      role: 'user',
      text: msg,
      ts: new Date().toISOString(),
    }]);

    const askResult = await postAsk(msg);
    if (!askResult.ok) {
      fetchBridgeStatus().then(setBridgeStatus).catch(() => null);
      setMessages((prev) => [...prev, {
        id: crypto.randomUUID(),
        role: 'error',
        text: 'Could not reach the dashboard server. Is it running with SPRANG_ROOT set?',
        ts: new Date().toISOString(),
      }]);
      return;
    }
    startPolling(msg);
  }, [input, waiting, startPolling]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void handleSubmit();
    }
  }, [handleSubmit]);

  const handleClear = useCallback(async () => {
    stopPolling();
    setWaiting(false);
    setMessages([]);
    setInput('');
    setBridgeOk(true);
    await clearResponse();
  }, [stopPolling]);

  return (
    <>
      {/* Nav button */}
      <button
        onClick={() => setOpen((v) => !v)}
        title="Ask Agent"
        className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors ${
          open
            ? 'bg-sprang-500/20 text-sprang-300'
            : 'text-surface-500 hover:text-surface-300 hover:bg-surface-800/50'
        }`}
      >
        <Sparkles className="w-3.5 h-3.5" />
        <span className="hidden sm:inline">Ask Agent</span>
        {messages.length > 0 && (
          <span className="ml-0.5 px-1 rounded-full bg-sprang-500/30 text-sprang-300 text-[9px] font-bold">
            {messages.filter(m => m.role !== 'error').length}
          </span>
        )}
      </button>

      {/* Right sidebar */}
      <AnimatePresence>
        {open && (
          <>
            {/* Backdrop */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
              className="fixed inset-0 z-40"
              onClick={() => { setOpen(false); }}
            />

            {/* Panel */}
            <motion.div
              initial={{ opacity: 0, x: 320 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 320 }}
              transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
              className="fixed top-0 right-0 bottom-0 z-50 w-80 flex flex-col bg-surface-900 border-l border-surface-800 shadow-2xl"
            >
              {/* Header */}
              <div className="flex items-center justify-between px-4 py-3 border-b border-surface-800 flex-shrink-0">
                <div className="flex items-center gap-2">
                  <div className="w-5 h-5 rounded bg-sprang-500/20 flex items-center justify-center">
                    <Sparkles className="w-3 h-3 text-sprang-400" />
                  </div>
                  <div>
                    <span className="text-xs font-semibold text-surface-200">Ask Agent</span>
                    {bridgeStatus && bridgeStatus.kind !== 'none' && (
                      <span className="ml-1.5 text-[9px] text-surface-500 font-normal">
                        via {BRIDGE_LABELS[bridgeStatus.kind]}
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  {messages.length > 0 && (
                    <button
                      onClick={handleClear}
                      title="Clear conversation"
                      className="p-1.5 rounded text-surface-600 hover:text-surface-300 hover:bg-surface-800 transition-colors"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  )}
                  <button
                    onClick={() => setOpen(false)}
                    className="p-1.5 rounded text-surface-600 hover:text-surface-300 hover:bg-surface-800 transition-colors"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              {/* Bridge warning */}
              {!bridgeOk && (
                <div className="flex items-start gap-2 mx-3 mt-3 px-3 py-2 rounded-lg bg-amber-950/50 border border-amber-800/50 flex-shrink-0">
                  <AlertCircle className="w-3 h-3 text-amber-400 flex-shrink-0 mt-0.5" />
                  <p className="text-[10px] text-amber-300 leading-relaxed">
                    {bridgeStatus?.kind === 'none'
                      ? 'No agent bridge detected. Install the cascade-messaging Windsurf extension, or install the claude / copilot CLI.'
                      : `Bridge error (${BRIDGE_LABELS[bridgeStatus?.kind ?? 'none']}). Check that the agent is running and try again.`
                    }
                  </p>
                </div>
              )}

              {/* Messages */}
              <div
                ref={scrollRef}
                className="flex-1 overflow-y-auto px-3 py-3 space-y-3 min-h-0"
              >
                {messages.length === 0 && !waiting && (
                  <div className="flex flex-col items-center justify-center h-full gap-3 text-center py-8">
                    <MessageSquare className="w-8 h-8 text-surface-700" />
                    <div>
                      <p className="text-xs font-medium text-surface-500">Ask about the codebase</p>
                      <p className="text-[10px] text-surface-700 mt-1">
                        {bridgeStatus
                          ? bridgeStatus.kind === 'none'
                            ? 'No bridge detected. Install claude CLI, copilot CLI, or the cascade-messaging Windsurf extension.'
                            : `Connected via ${BRIDGE_LABELS[bridgeStatus.kind]}.`
                          : 'Detecting agent bridge…'
                        }
                      </p>
                    </div>
                  </div>
                )}

                {messages.map((msg) => (
                  <div
                    key={msg.id}
                    className={`flex flex-col gap-1 ${msg.role === 'user' ? 'items-end' : 'items-start'}`}
                  >
                    <div
                      className={`max-w-[90%] px-3 py-2 rounded-xl text-xs leading-relaxed whitespace-pre-wrap break-words ${
                        msg.role === 'user'
                          ? 'bg-sprang-500/20 text-sprang-100 rounded-br-sm'
                          : msg.role === 'error'
                          ? 'bg-red-950/60 border border-red-800/50 text-red-300'
                          : 'bg-surface-800 text-surface-200 rounded-bl-sm border border-surface-700'
                      }`}
                    >
                      {msg.text}
                    </div>
                    <span className="text-[9px] text-surface-700 px-1">
                      {new Date(msg.ts).toLocaleTimeString()}
                    </span>
                  </div>
                ))}

                {/* Typing indicator */}
                {waiting && (
                  <div className="flex items-start gap-2">
                    <div className="bg-surface-800 border border-surface-700 px-3 py-2 rounded-xl rounded-bl-sm flex items-center gap-1.5">
                      {[0, 1, 2].map((i) => (
                        <motion.div
                          key={i}
                          className="w-1.5 h-1.5 rounded-full bg-sprang-500"
                          animate={{ opacity: [0.3, 1, 0.3] }}
                          transition={{ duration: 1, repeat: Infinity, delay: i * 0.2 }}
                        />
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Input */}
              <div className="flex-shrink-0 border-t border-surface-800 px-3 py-3">
                <div className="flex gap-2 items-end">
                  <textarea
                    ref={inputRef}
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={handleKeyDown}
                    rows={2}
                    disabled={waiting}
                    placeholder={waiting ? 'Waiting for agent…' : 'Ask about the codebase… (Enter to send)'}
                    className="flex-1 resize-none rounded-xl bg-surface-800 border border-surface-700 text-xs text-surface-200 placeholder-surface-600 px-3 py-2 focus:outline-none focus:ring-1 focus:ring-sprang-500 disabled:opacity-50"
                  />
                  <button
                    onClick={() => void handleSubmit()}
                    disabled={!input.trim() || waiting}
                    className="flex-shrink-0 p-2 rounded-xl bg-sprang-500 hover:bg-sprang-400 disabled:opacity-40 disabled:cursor-not-allowed text-white transition-colors"
                  >
                    {waiting ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Send className="w-3.5 h-3.5" />
                    )}
                  </button>
                </div>
                <p className="text-[9px] text-surface-700 mt-1.5 text-center">
                  Shift+Enter for newline · responses via sprang_respond MCP
                </p>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  );
}
