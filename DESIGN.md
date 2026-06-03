---
name: Sprang
description: Knowledge graph dashboard for codebase comprehension
colors:
  surface-950: "#09090b"
  surface-900: "#18181b"
  surface-800: "#27272a"
  surface-700: "#3f3f46"
  surface-600: "#52525b"
  surface-500: "#71717a"
  surface-400: "#a1a1aa"
  surface-300: "#d4d4d8"
  surface-200: "#e4e4e7"
  surface-100: "#f4f4f5"
  surface-50: "#fafafa"
  sprang-500: "#d946ef"
  sprang-700: "#a21caf"
  sprang-400: "#e879f9"
  risk-low: "#22c55e"
  risk-medium: "#f59e0b"
  risk-high: "#ef4444"
typography:
  body:
    fontFamily: "Outfit, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "normal"
  label:
    fontFamily: "Outfit, system-ui, sans-serif"
    fontSize: "12px"
    fontWeight: 500
    lineHeight: 1.4
    letterSpacing: "normal"
  mono:
    fontFamily: "JetBrains Mono, Fira Code, monospace"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: 1.6
    letterSpacing: "normal"
rounded:
  sm: "4px"
  md: "6px"
  lg: "8px"
  xl: "12px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "24px"
  2xl: "32px"
components:
  button-default:
    backgroundColor: "{colors.surface-800}"
    textColor: "{colors.surface-200}"
    rounded: "{rounded.md}"
    padding: "6px 12px"
  button-primary:
    backgroundColor: "{colors.sprang-500}"
    textColor: "#ffffff"
    rounded: "{rounded.md}"
    padding: "6px 12px"
  button-outline:
    backgroundColor: "transparent"
    textColor: "{colors.surface-300}"
    rounded: "{rounded.md}"
    padding: "6px 12px"
---

## Overview

Sprang is a dark-mode-only product UI. The surface palette is tinted-zinc (near-neutral, cool-leaning), not pure black/gray. The accent is fuchsia-purple (`sprang-500: #d946ef`), used only for primary actions, selection indicators, and the brand mark. A semantic risk palette (green/amber/red) is the only other saturated color family.

The feel is focused and dense. Like a terminal that learned good taste. The graph canvas takes most of the viewport; chrome recedes.

**Scene sentence**: A software engineer at their desk, late afternoon, second monitor with a dark IDE on the left. Ambient light is cool and indirect. The task is "understand this codebase before I change something important." Focus is high; distraction tolerance is low.

This forces dark mode. No choice here. The graph needs dark to make edge glow and node color readable. The scene doesn't allow light.

**Color strategy**: Restrained. One accent (`sprang-500`) for primary actions only. Risk colors (`risk-low`, `risk-medium`, `risk-high`) are semantic, not decorative, and only appear in the risk heatmap and health view. No gradients. No glass.

## Colors

**Surface ramp**: tinted-zinc. Adds ~0.01 chroma toward the sprang hue so the near-black reads as intentional, not default. Nine stops from `surface-950` (near-black body) through `surface-50` (near-white ink).

- `surface-950`: body background
- `surface-900`: panel backgrounds, nav
- `surface-800`: cards, hover states, input backgrounds
- `surface-700`: borders, dividers
- `surface-600`, `surface-500`: muted text, secondary labels
- `surface-400`, `surface-300`: primary body text on dark
- `surface-200`, `surface-100`, `surface-50`: high-emphasis text, labels

**Brand accent**: `sprang-500` (#d946ef). Used for: primary button fill, selected node highlight border, the brand mark, progress indicators, the Cmd+K shortcut highlight, Phase 2 in-progress indicator. Nowhere else. Not as a text color on body copy. Not on inactive states.

**Risk semantic palette**:
- `risk-low` (#22c55e): nodes with score < 0.4
- `risk-medium` (#f59e0b): nodes with score 0.4–0.7
- `risk-high` (#ef4444): nodes with score ≥ 0.7

Risk colors appear in the risk heatmap overlay, the health view risk bars, and smell badges. They never appear as decorative accents.

**Node type colors** (graph canvas only): Each node type has a distinct color from a full-spectrum set. These are informational, not brand. They should not bleed into the chrome.

## Typography

**One family: Outfit**. Geometric sans with personality. Readable at 12px label size. Distinct enough from Inter/Geist to avoid the "AI tool" reflex. Three weights used: 400 (body), 500 (labels, nav items), 600 (headings, stat values, node labels on hover).

**Mono: JetBrains Mono**. Used for: node IDs, file paths, code references, keyboard shortcut hints, stats in the nav bar.

**Type scale** (fixed rem, not fluid; this is a product UI):
- 10px: tiny metadata (line numbers, graph edge labels)
- 11px: graph node labels, density-constrained labels
- 12px: body copy, labels, nav items (`text-xs` in Tailwind)
- 13px: panel headings, list titles (`text-[13px]`)
- 14px: primary body, node panel content (`text-sm`)
- 16px: section headings (`text-base`)
- 18–20px: stat values, page headings (`text-lg` / `text-xl`)

Hierarchy via weight contrast (400 → 500 → 600), not size alone. The scale ratio is 1.125 (tight, appropriate for dense product UI).

## Elevation

Dark surfaces use border + background-shift, not shadows.

- **Level 0**: `surface-950` — body, graph canvas
- **Level 1**: `surface-900` + `border border-surface-800` — nav bar, side panels, drawers
- **Level 2**: `surface-800` + `border border-surface-700` — cards, hover rows, dropdowns
- **Level 3**: `surface-700` — tooltip backgrounds, popover chrome

Shadows (`shadow-xl shadow-black/50`) are reserved for floating elements (dropdowns, tooltips, command palette) where visual separation from the surface is needed. Never decorative.

## Components

**Buttons** (three variants):
- `default`: `bg-surface-800 text-surface-200 border border-surface-700 hover:bg-surface-700`
- `outline`: `bg-transparent text-surface-300 border border-surface-700 hover:text-surface-100 hover:border-surface-600`
- `primary` / brand action: `bg-sprang-500 text-white hover:bg-sprang-600`

All buttons: `rounded-md` (6px), `px-3 py-1.5`, `text-xs font-medium`, gap-1.5 for icon+label.

**Node panel**: Slide-in drawer from the right. `w-96`, `border-l border-surface-800`, `bg-surface-950`. Spring animation (`stiffness: 300, damping: 30`). Content: risk bar, node type + layer badge, summary text, structural warnings (SmellBadge), risk factors, decision context timeline (git commits), annotation area.

**Risk bar**: Thin (h-1.5) colored fill animated with `framer-motion`. Color from risk palette. Text label right-aligned, monospace, same color as bar. Full width of panel.

**SmellBadge**: Colored dot (risk-high/medium/low based on severity) + category label. `text-[10px]`, `px-1.5 py-0.5`, `rounded`, `bg-surface-800`. Never a border.

**SearchBar (Cmd+K)**: Fullscreen overlay, `bg-surface-950/80 backdrop-blur-sm`. Centered dialog, `max-w-xl`, `bg-surface-900 border border-surface-700 rounded-xl`. Fuse.js fuzzy search, keyboard-navigable list. No modal backdrop blur as glassmorphism.

**Tour player**: Fixed bottom bar, `bg-surface-900/90 backdrop-blur-sm border-t border-surface-800`. Step counter, prev/next buttons, node name highlight.

## Do's and Don'ts

**Do**:
- Use `surface-*` tokens for all backgrounds, borders, and text. Never raw hex for gray.
- Use `sprang-500` only for primary actions and selection. One use per screen maximum.
- Use risk colors only in semantic contexts (heatmap, health view, smell badges).
- Animate with `framer-motion` springs (`stiffness: 300–400, damping: 25–35`). No CSS `transition: all`.
- Use `font-mono` for paths, IDs, hashes, and keyboard shortcuts.
- Show `font-medium` (500) for labels; `font-semibold` (600) for values and headings.
- Ensure every interactive element has `hover:`, `focus-visible:`, and `disabled:` states.
- Add `@media (prefers-reduced-motion: reduce)` alternatives: crossfades instead of slides.

**Don't**:
- Use gradient text (`bg-clip-text`). Never.
- Use glassmorphism decoratively. The search overlay uses `backdrop-blur` functionally (modal separation), not as decoration.
- Nest panels inside panels (VSCode trap). The graph canvas and the side panel are the only two zones.
- Use `transition: all`. Only transition the specific property (`transform`, `opacity`, `color`).
- Use `z-index: 9999` or arbitrary z-values. Build a scale: `z-10` nav, `z-20` panels, `z-30` dropdowns, `z-40` modals, `z-50` toasts.
- Put risk colors on inactive or decorative UI elements.
- Use display/hero font sizes (`clamp`, `6rem`) anywhere. This is a product UI with fixed scale.
- Bold or uppercase body copy. Reserve uppercase for short labels (≤4 words), badges, section eyebrows used once per view.
