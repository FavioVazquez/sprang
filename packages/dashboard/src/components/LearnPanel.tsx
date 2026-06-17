import { BookOpen, Play, ChevronLeft, ChevronRight, X, GraduationCap } from 'lucide-react';
import { useDashboardStore } from '../store';
import { PersonaSelector } from './PersonaSelector';

// ─── Lightweight markdown renderer (no react-markdown dep) ───────────────────

function SimpleMarkdown({ text }: { text: string }) {
  const lines = text.split('\n');
  return (
    <div className="space-y-1.5 text-sm text-surface-300 leading-relaxed">
      {lines.map((line, i) => {
        if (!line.trim()) return <br key={i} />;
        // bold **text**
        const parts = line.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
        return (
          <p key={i}>
            {parts.map((part, j) => {
              if (part.startsWith('**') && part.endsWith('**')) {
                return <strong key={j} className="font-semibold text-surface-100">{part.slice(2, -2)}</strong>;
              }
              if (part.startsWith('`') && part.endsWith('`')) {
                return <code key={j} className="bg-surface-800 rounded px-1 py-0.5 text-[11px] text-sprang-300 font-mono">{part.slice(1, -1)}</code>;
              }
              return <span key={j}>{part}</span>;
            })}
          </p>
        );
      })}
    </div>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

export function LearnPanel() {
  const {
    graph,
    tourActive,
    currentTourStep,
    tourHighlightedNodeIds,
    startTour,
    stopTour,
    setTourStep,
    nextTourStep,
    prevTourStep,
    navigateToNode,
    nodesById,
    persona,
  } = useDashboardStore();

  const tour = graph?.tours?.[0] ?? null;
  const steps = tour?.steps ?? [];
  const hasTour = steps.length > 0;

  // ── No tour ──
  if (!hasTour) {
    return (
      <div className="h-full w-full flex flex-col">
        {/* Persona picker always visible */}
        <div className="px-4 py-3 border-b border-surface-800 shrink-0">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-surface-500 mb-2">View as</p>
          <PersonaSelector />
        </div>
        <div className="flex-1 flex items-center justify-center p-5">
          <div className="text-center space-y-2">
            <BookOpen className="w-8 h-8 mx-auto text-surface-700" />
            <p className="text-sm font-medium text-surface-400">No tour available</p>
            <p className="text-xs text-surface-600 leading-relaxed">
              Run <code className="text-sprang-400 bg-surface-800 px-1 rounded">/sprang-analyze</code> in your AI agent to build the guided tour.
              If a graph already exists, use <code className="text-sprang-400 bg-surface-800 px-1 rounded">/sprang-analyze --full</code> to force a full rebuild including tour generation.
            </p>
          </div>
        </div>
      </div>
    );
  }

  // ── Tour available, not started ──
  if (!tourActive) {
    return (
      <div className="h-full w-full flex flex-col overflow-hidden">
        <div className="px-4 py-3 border-b border-surface-800 shrink-0">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-surface-500 mb-2">View as</p>
          <PersonaSelector />
        </div>
        <div className="flex-1 overflow-auto p-4 space-y-4">
          <div>
            <h2 className="text-sm font-semibold text-surface-100 mb-1">{tour!.title}</h2>
            <p className="text-xs text-surface-400 leading-relaxed">{tour!.description}</p>
            <p className="text-[10px] text-surface-600 mt-1">
              {steps.length} step{steps.length !== 1 ? 's' : ''} · guided walkthrough
            </p>
          </div>

          <button
            type="button"
            onClick={startTour}
            className="w-full flex items-center justify-center gap-2 bg-sprang-500/15 border border-sprang-500/40 text-sprang-300 text-sm font-medium py-2.5 px-4 rounded-lg hover:bg-sprang-500/25 transition-colors"
          >
            <Play className="w-3.5 h-3.5" />
            Start tour
          </button>

          <div className="space-y-2">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-surface-500">Steps</p>
            {steps.map((step, i) => (
              <button
                key={i}
                type="button"
                onClick={() => { startTour(); setTourStep(i); }}
                className="w-full flex items-start gap-2.5 text-xs bg-surface-900 rounded-lg px-3 py-2.5 border border-surface-800 hover:border-surface-700 hover:bg-surface-800/60 text-left transition-colors"
              >
                <span className="text-sprang-400 font-mono shrink-0 mt-0.5 w-4">{i + 1}.</span>
                <span className="text-surface-300">{step.step_title}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  }

  // ── Tour active ──
  const step = steps[currentTourStep];
  if (!step) return null;

  const totalSteps = steps.length;
  const progressPct = ((currentTourStep + 1) / totalSteps) * 100;
  const isFirst = currentTourStep === 0;
  const isLast = currentTourStep === totalSteps - 1;

  // Collect node IDs for this step (support both node_id and node_ids)
  const stepNodeIds = step.node_ids ?? (step.node_id ? [step.node_id] : []);

  // Persona-adaptive content
  const personaHint =
    persona === 'non-technical'
      ? '💡 Business view: focus on the purpose of this component in the overall system — ignore implementation details.'
      : persona === 'pm'
      ? '🗂 Product view: these are the domain and service nodes that map to business capabilities and feature areas.'
      : persona === 'junior'
      ? '📖 Learning tip: pay attention to the language lesson below — it explains the pattern used here.'
      : persona === 'senior' || persona === 'experienced'
      ? '⚡ Senior view: introductory steps are skipped — focus on trade-offs, risk scores, and coupling.'
      : null;

  return (
    <div className="h-full w-full flex flex-col overflow-hidden">
      {/* Tour header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-surface-800 shrink-0">
        <div className="flex items-center gap-2">
          <BookOpen className="w-3.5 h-3.5 text-sprang-400" />
          <span className="text-[11px] font-semibold text-sprang-400 uppercase tracking-wider">Tour</span>
          <span className="text-xs text-surface-500">{currentTourStep + 1} / {totalSteps}</span>
        </div>
        <button
          type="button"
          onClick={stopTour}
          className="p-1 rounded text-surface-600 hover:text-surface-400 hover:bg-surface-800 transition-colors"
          title="Exit tour"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Progress bar */}
      <div className="h-0.5 bg-surface-800 shrink-0">
        <div
          className="h-full bg-sprang-500 transition-all duration-300"
          style={{ width: `${progressPct}%` }}
        />
      </div>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4 min-h-0">
        {/* Persona hint */}
        {personaHint && (
          <p className="text-[11px] text-surface-500 italic">{personaHint}</p>
        )}

        {/* Step title */}
        <h2 className="text-sm font-semibold text-surface-100">{step.step_title}</h2>

        {/* Explanation */}
        <SimpleMarkdown text={step.explanation} />

        {/* Language lesson */}
        {step.language_lesson && (
          <div className="bg-sprang-500/5 border border-sprang-500/20 rounded-lg p-3 space-y-1.5">
            <div className="flex items-center gap-1.5">
              <GraduationCap className="w-3.5 h-3.5 text-sprang-400" />
              <h4 className="text-[11px] font-semibold text-sprang-400 uppercase tracking-wider">
                Language Lesson
              </h4>
            </div>
            <p className="text-xs text-surface-300 leading-relaxed">
              {step.language_lesson}
            </p>
          </div>
        )}

        {/* Referenced nodes */}
        {stepNodeIds.length > 0 && (
          <div className="space-y-2">
            <h4 className="text-[10px] font-semibold uppercase tracking-wider text-surface-500">
              Referenced nodes
            </h4>
            <div className="flex flex-wrap gap-1.5">
              {stepNodeIds.map((nodeId) => {
                const node = nodesById.get(nodeId);
                const isHighlighted = tourHighlightedNodeIds.includes(nodeId);
                return (
                  <button
                    key={nodeId}
                    type="button"
                    onClick={() => navigateToNode(nodeId)}
                    className={`text-[11px] px-2.5 py-1 rounded-full border transition-colors ${
                      isHighlighted
                        ? 'bg-sprang-500/20 border-sprang-500/40 text-sprang-300'
                        : 'bg-surface-800 border-surface-700 text-surface-400 hover:text-surface-200 hover:border-surface-600'
                    }`}
                  >
                    {node?.label ?? nodeId}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Navigation */}
      <div className="px-3 py-2.5 border-t border-surface-800 shrink-0 space-y-2">
        {/* Step dots */}
        <div className="flex justify-center gap-1.5">
          {steps.map((_, i) => (
            <button
              key={i}
              type="button"
              onClick={() => setTourStep(i)}
              className={`rounded-full transition-all ${
                i === currentTourStep
                  ? 'w-4 h-2 bg-sprang-400'
                  : 'w-2 h-2 bg-surface-700 hover:bg-surface-500'
              }`}
              aria-label={`Go to step ${i + 1}`}
            />
          ))}
        </div>

        {/* Prev / Next */}
        <div className="flex gap-2">
          <button
            type="button"
            onClick={prevTourStep}
            disabled={isFirst}
            className="flex-1 flex items-center justify-center gap-1 text-xs bg-surface-800 border border-surface-700 text-surface-400 py-2 rounded-lg hover:bg-surface-700 hover:text-surface-200 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            <ChevronLeft className="w-3.5 h-3.5" />
            Prev
          </button>
          <button
            type="button"
            onClick={isLast ? stopTour : nextTourStep}
            className="flex-1 flex items-center justify-center gap-1 text-xs bg-sprang-500/15 border border-sprang-500/40 text-sprang-300 py-2 rounded-lg hover:bg-sprang-500/25 transition-colors"
          >
            {isLast ? 'Finish' : 'Next'}
            {!isLast && <ChevronRight className="w-3.5 h-3.5" />}
          </button>
        </div>
      </div>
    </div>
  );
}
