import React, { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Sparkles, Send, Loader2, X, AlertCircle, MessageSquare, Trash2 } from 'lucide-react';

type BridgeKind = 'devin-local' | 'devin' | 'claude' | 'copilot' | 'relay';

interface BridgeOption {
  kind: BridgeKind;
  available: boolean;
  detail: string;
  label: string;
}

interface BridgeStatus {
  kind: BridgeKind;
  detail: string;
  options?: BridgeOption[];
}

/** Remembered across reloads so a deliberate choice is not silently undone. */
const BRIDGE_PREF_KEY = 'sprang:bridge';

const BRIDGE_LABELS: Record<BridgeKind, string> = {
  'devin-local': 'Devin',
  devin: 'Devin CLI',
  claude: 'Claude Code',
  copilot: 'Copilot CLI',
  relay: 'Manual relay',
};

interface AgentResponse {
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

/** Must stay well under the hook's freshness window so the signal never lapses
 *  while the panel is genuinely open. */
const HEARTBEAT_INTERVAL_MS = 8000;

/** A spawned CLI answers in one shot, so a short ceiling is right. */
const POLL_TIMEOUT_CLI_MS = 120_000;

/** devin-local and relay wait on a whole agent turn — sometimes a human one —
 *  so two minutes is far too aggressive and produced a false "no response". */
const POLL_TIMEOUT_ASYNC_MS = 600_000;

/** Bridges where the answer comes back out-of-band via sprang_respond. */
const ASYNC_BRIDGES = new Set<BridgeKind>(['devin-local', 'relay']);

/** Actionable guidance when nothing came back — "no response" alone is useless. */
function timeoutHelp(bridge: BridgeKind | undefined): string {
  if (bridge === 'devin-local') {
    return (
      'Devin did not answer. The question was pushed into your Devin chat — check whether it ' +
      'arrived (a relayed question opens in a new conversation). If Devin replied but nothing ' +
      'appeared here, it is missing the sprang_respond MCP tool: check the sprang server is ' +
      'running in that conversation, or have Devin write .sprang/cascade-response.json directly ' +
      '(the staged prompt in .sprang/agent-question.md explains how).'
    );
  }
  if (bridge === 'relay') {
    return (
      'Nothing came back yet. Paste the prompt from .sprang/agent-question.md into your agent ' +
      'and make sure it finishes by calling sprang_respond.'
    );
  }
  return 'The agent CLI did not answer in time. Check that it is authenticated and try again.';
}

async function fetchBridgeStatus(): Promise<BridgeStatus> {
  try {
    const res = await fetch('/bridge-status');
    if (!res.ok) return { kind: 'relay', detail: 'bridge-status endpoint unavailable' };
    return (await res.json()) as BridgeStatus;
  } catch {
    return { kind: 'relay', detail: 'bridge-status fetch failed' };
  }
}

async function postAsk(message: string, bridge?: BridgeKind): Promise<{ ok: boolean; error?: string; prompt?: string; bridge?: BridgeKind }> {
  try {
    const res = await fetch('/agent-ask', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, bridge }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({} as Record<string, unknown>)) as Record<string, unknown>;
      return { ok: false, error: typeof body['error'] === 'string' ? body['error'] : `HTTP ${res.status}` };
    }
    const body = await res.json().catch(() => ({} as Record<string, unknown>)) as Record<string, unknown>;
    return {
      ok: true,
      prompt: typeof body['prompt'] === 'string' ? body['prompt'] : undefined,
      bridge: body['bridge'] as BridgeKind | undefined,
    };
  } catch {
    return { ok: false, error: 'Network error' };
  }
}

async function pollResponse(): Promise<AgentResponse | null | 'unavailable'> {
  try {
    const res = await fetch('/agent-response');
    if (res.status === 204) return null;
    if (res.status === 404) return 'unavailable';
    if (!res.ok) return null;
    return (await res.json()) as AgentResponse;
  } catch {
    return null;
  }
}

async function clearResponse(): Promise<void> {
  try { await fetch('/agent-response', { method: 'DELETE' }); } catch { /* ignore */ }
}

export function AskAgentPanel() {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState('');
  const [waiting, setWaiting] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [bridgeOk, setBridgeOk] = useState(true);
  const [bridgeStatus, setBridgeStatus] = useState<BridgeStatus | null>(null);
  const [chosenBridge, setChosenBridge] = useState<BridgeKind | ''>(
    () => (localStorage.getItem(BRIDGE_PREF_KEY) as BridgeKind | null) ?? '',
  );
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

  // Focus input + fetch bridge status when panel opens; close on Escape
  useEffect(() => {
    if (!open) return;
    setTimeout(() => inputRef.current?.focus(), 80);
    fetchBridgeStatus().then(setBridgeStatus).catch(() => null);
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  // Tell the editor-side hook that someone is waiting here, so it holds a
  // finished turn open briefly and picks up the next question with no typing.
  // Only while the panel is open — otherwise normal work is never delayed.
  useEffect(() => {
    if (!open) return;
    const ping = () => { void fetch('/agent-heartbeat', { method: 'POST' }).catch(() => null); };
    const clear = () => {
      // sendBeacon survives tab close; fetch does not.
      if (!navigator.sendBeacon?.('/agent-heartbeat?close=1')) {
        void fetch('/agent-heartbeat', { method: 'DELETE', keepalive: true }).catch(() => null);
      }
    };
    ping();
    // The interval is best-effort only — a hidden tab is throttled, and the tab
    // is hidden exactly when the editor-side hook needs this signal. Closing the
    // panel is what actually retracts it.
    const id = setInterval(ping, HEARTBEAT_INTERVAL_MS);
    window.addEventListener('pagehide', clear);
    return () => {
      clearInterval(id);
      window.removeEventListener('pagehide', clear);
      clear();
    };
  }, [open]);

  const startPolling = useCallback((sentQuestion: string, bridge?: BridgeKind) => {
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
          text: 'Agent bridge not detected. Make sure the bridge is installed and this workspace is open.',
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

    const limitMs = bridge && ASYNC_BRIDGES.has(bridge) ? POLL_TIMEOUT_ASYNC_MS : POLL_TIMEOUT_CLI_MS;
    timeoutTimerRef.current = setTimeout(() => {
      stopPolling();
      setWaiting(false);
      setMessages((prev) => [...prev, {
        id: crypto.randomUUID(),
        role: 'error',
        text: `No response after ${Math.round(limitMs / 60_000)} min for: "${sentQuestion}"\n\n${timeoutHelp(bridge)}`,
        ts: new Date().toISOString(),
      }]);
    }, limitMs);
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

    const askResult = await postAsk(msg, chosenBridge || undefined);
    if (!askResult.ok) {
      fetchBridgeStatus().then(setBridgeStatus).catch(() => null);
      setMessages((prev) => [...prev, {
        id: crypto.randomUUID(),
        role: 'error',
        text: askResult.error ?? 'Could not reach the dashboard server. Is it running with SPRANG_ROOT set?',
        ts: new Date().toISOString(),
      }]);
      return;
    }
    startPolling(msg, askResult.bridge);
  }, [input, waiting, startPolling, chosenBridge]);

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
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-surface-200">Ask Agent</span>
                    {/* Explicit agent choice. A fixed priority order silently
                        routes questions to whichever agent happens to rank
                        highest — including one whose credentials have expired. */}
                    {bridgeStatus?.options && (
                      <select
                        value={chosenBridge}
                        onChange={(e) => {
                          const v = e.target.value as BridgeKind | '';
                          setChosenBridge(v);
                          if (v) localStorage.setItem(BRIDGE_PREF_KEY, v);
                          else localStorage.removeItem(BRIDGE_PREF_KEY);
                        }}
                        title="Which agent answers dashboard questions"
                        className="text-[10px] bg-surface-900 border border-surface-700 rounded px-1.5 py-0.5 text-surface-300 outline-none focus:border-sprang-500/60"
                      >
                        <option value="">
                          Auto ({BRIDGE_LABELS[bridgeStatus.kind]})
                        </option>
                        {bridgeStatus.options.map((o) => (
                          <option key={o.kind} value={o.kind} disabled={!o.available}>
                            {o.label}{o.available ? '' : ' — unavailable'}
                          </option>
                        ))}
                      </select>
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
                    {bridgeStatus?.kind === 'relay'
                      ? 'No agent CLI detected. Paste the staged question into your agent (Devin Desktop, Cursor, …) — it answers via the sprang_respond MCP tool and the reply appears here. To answer automatically instead, install and log in to the devin, claude, or copilot CLI.'
                      : `Bridge error (${BRIDGE_LABELS[bridgeStatus?.kind ?? 'relay']}). Check that the agent is running and try again.`
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
                          ? bridgeStatus.kind === 'relay'
                            ? 'Manual relay: copy the question into your agent, which replies via sprang_respond. Install the devin, claude, or copilot CLI for automatic answers.'
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
                  Shift+Enter for newline · agent responds; result appears here
                </p>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  );
}
