---
target: packages/dashboard/src
total_score: 32
p0_count: 0
p1_count: 0
timestamp: 2026-06-03T13-16-00Z
slug: packages-dashboard-src
---
## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 3 | Phase skeleton spinner in nav; Phase 2 background progress not shown in-canvas |
| 2 | Match System / Real World | 3 | Technical terms right for audience; tooltips now explain risk score, blast radius, smells |
| 3 | User Control and Freedom | 3 | Esc close ✓; zoom +/−/reset controls ✓; graph history not yet present |
| 4 | Consistency and Standards | 4 | Surface tokens consistent; all uppercase tracking violations removed |
| 5 | Error Prevention | 2 | No destructive actions; no safeguards against accidental layout changes |
| 6 | Recognition Rather Than Recall | 3 | First-run discovery callout ✓; Tours indicator dot ✓; layers still require prior knowledge |
| 7 | Flexibility and Efficiency | 4 | Full keyboard shortcut set (g/h/d/r/Esc/⌘K); shortcuts surfaced in search tooltip |
| 8 | Aesthetic and Minimalist Design | 4 | Exemplary. Graph-first, chrome recedes, intentional density, zero decorative noise |
| 9 | Error Recovery | 2 | ErrorScreen excellent; Phase 2 failures still silent |
| 10 | Help and Documentation | 4 | Tooltips on all toolbar buttons ✓; help tooltips in NodePanel (risk, smells, git) ✓; first-run callout ✓ |
| **Total** | | **32/40** | **Good — exceeds minimum bar, two remaining structural gaps** |

## Anti-Patterns Verdict

Does NOT look AI-generated. Dark tinted-zinc, graph-first, restrained single accent pass the AI slop test at both orders. Zero absolute-ban violations in source. detect.mjs returned [] — zero automated findings.

## Remaining Issues (P2–P3)

[P2] Phase 2 progress in-canvas not surfaced: When phase='skeleton', only a spinner in the global nav shows enrichment status. A dismissable in-canvas banner with specifics ("Adding git history, smell detection, risk scores...") would improve H1 to 4.

[P2] Graph history / undo: No way to return to a previous camera position or undo a mistaken navigation. Standard in professional graph tools; H3 stays at 3 without it.

[P3] Phase 2 silent failures: If git-layer or smell-detector fail, the user never sees an error. Requires backend plumbing (phase2-progress.json surfacing) that's outside the dashboard's scope.

[P3] Accessibility — graph canvas: The Sigma canvas has role="img" with descriptive aria-label, but the content is not accessible to screen readers (fundamental Sigma limitation). The Health and Domain views remain fully accessible. An aria-live region announcing selected node details would partially address this.

## Changes Since Previous Snapshot (2026-06-03T08-51-10Z)

Fixed P1: Side-stripe border on decision context blockquotes → bg-surface-800/60 rounded
Fixed P1: Uppercase tracking-widest on all 7 NodePanel section headers → divider-style labels
Fixed P2: Inter font reference in Sigma → Outfit (matches design system)
Fixed P2: Keyboard efficiency gap → full shortcut set added (g/h/d/r/Esc)
Fixed P2: Help nearly absent → tooltips on all toolbar buttons, NodePanel section tooltips, first-run callout
Fixed minor: uppercase tracking-wide on NodePanel mini stat grid labels → removed
Added: Zoom +/−/reset controls in graph canvas (bottom-right)
Added: Tours indicator dot when tours available
Added: ARIA role="img" + descriptive aria-label on graph canvas container
Score improvement: 24 → 32 (+8 points)
