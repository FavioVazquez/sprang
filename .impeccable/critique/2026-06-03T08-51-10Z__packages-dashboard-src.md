---
target: packages/dashboard/src
total_score: 24
p0_count: 0
p1_count: 2
timestamp: 2026-06-03T08-51-10Z
slug: packages-dashboard-src
---
## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 3 | Phase skeleton banner + loading states excellent; Phase 2 background progress not surfaced in UI |
| 2 | Match System / Real World | 3 | Technical terms right for audience; glossary would help |
| 3 | User Control and Freedom | 2 | No Esc close; no graph history; no zoom reset |
| 4 | Consistency and Standards | 3 | Surface tokens consistent; section header style violates own DESIGN.md |
| 5 | Error Prevention | 2 | No destructive actions; no safeguards against accidental layout changes |
| 6 | Recognition Rather Than Recall | 2 | Tours/Layers hidden in menus — only discoverable if you know they exist |
| 7 | Flexibility and Efficiency | 2 | Only Cmd+K; no Esc, no view-switch shortcuts, no zoom-reset |
| 8 | Aesthetic and Minimalist Design | 4 | Exemplary. Graph-first, chrome recedes, intentional density, zero decorative noise |
| 9 | Error Recovery | 2 | ErrorScreen excellent; Phase 2 failures entirely silent |
| 10 | Help and Documentation | 1 | Tours once found are good; no tooltips, no glossary elsewhere |
| **Total** | | **24/40** | **Acceptable — significant targeted improvements needed** |

## Anti-Patterns Verdict

LLM assessment: Does NOT look AI-generated. Dark tinted-zinc, graph-first, restrained single accent pass the AI slop test at both orders. Two absolute-ban violations in source: side-stripe border and repeated uppercase eyebrows.

Deterministic scan: detect.mjs returned [] — zero automated findings.

## Priority Issues

[P1] Side-stripe border ban violated: NodePanel.tsx:306 — border-l-2 border-sprang-700 on decision context blockquotes. Fix: bg-surface-800/50 rounded-md px-3 py-2.

[P1] Uppercase eyebrow on every NodePanel section: NodePanel.tsx:106-108 Section component uses uppercase tracking-widest for all 7 sections. Also SearchBar.tsx:179 and HealthView.tsx:251. Fix: remove uppercase/tracking-widest from Section component.

[P2] Inter font in Sigma: GraphCanvas.tsx:190 labelFont still references Inter. Fix: change to Outfit.

[P2] Keyboard efficiency gap: No Esc close, no view-switch shortcuts, no zoom reset. Fix: keydown handler in App.tsx.

[P2] Help nearly absent: Score 1/4. No tooltips, no glossary, no first-run guidance. Tours hidden. Fix: add tooltips to toolbar buttons, first-run callout.

## Persona Red Flags

Alex (Power User): Keyboard hostile beyond Cmd+K. Escape doesn't close node panel. No view-switch keys.

Sam (Accessibility): Graph canvas is pixel-rendered, zero ARIA content. Health/Domain views are accessible; main graph view is not.

Jordan (First-Timer): No indication tours exist. Risk score, blast radius, smells undefined in UI. Abandons without finding key features.

## Minor Observations

NodePanel author avatars reference bg-sprang-800 not in Tailwind config. ForceAtlas2 threshold at 2000 nodes skips the Sprang-on-itself scan. HealthView StatCard labels use uppercase eyebrow pattern.
