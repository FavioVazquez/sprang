# Product

## Register

product

## Users

Software engineers working inside Devin Desktop (Cascade + Devin Local agents). Primary context: mid-session, in the middle of a task, needing fast answers about an unfamiliar or large codebase. Secondary context: onboarding to a new project, wanting to understand architecture before making changes. Tertiary: code review, understanding blast radius before a refactor.

Users are technical, time-pressed, and intolerant of visual noise. They are used to tools like Linear, Raycast, Warp, and Zed. They expect the interface to stay out of the way and answer quickly.

## Product Purpose

Sprang builds a live knowledge graph of any codebase: who wrote each file and why, how files depend on each other, which nodes are risky to change, where smells cluster, and how the architecture layers. The graph is surfaced through a force-directed visualization, an MCP server that Cascade queries directly, and seven slash commands.

Success looks like: an engineer who has never seen a codebase can understand its architecture, risk profile, and key decision history in under five minutes. Cascade can answer "what will break if I change this file?" in one MCP tool call.

## Brand Personality

Calm. Deep. Trustworthy.

The product earns trust by showing real data without overselling it. It does not celebrate itself. It does not use dramatic animations to announce findings. It presents complex information with quiet authority, like a senior engineer who has seen a lot of codebases and can explain any of them clearly.

Reference feel: Bear for iOS (depth without decoration), Linear (data-dense but never cluttered), Zed editor (dark, focused, no wasted space).

## Anti-references

- **GitHub Copilot Chat**: Boxy sidebar aesthetic, feels bolted onto an existing product, no visual hierarchy, small fonts crammed into a panel.
- **SonarQube / SonarCloud**: Enterprise dashboard feel, too many status badges, tables-first navigation, no sense of space or depth.
- **Generic AI dashboards**: Gradient text, glassmorphism cards, hero metrics with giant numbers, identical card grids, AI-slop color palettes (purple-to-teal gradients, cream/sand body backgrounds).
- **VS Code extensions**: Panel-within-panel nesting, no breathing room, font sizes too small, dark-gray uniformity with no hierarchy.

## Design Principles

1. **The graph IS the product.** Every design decision serves the graph's readability. The chrome (nav, panels, controls) should recede so the graph advances.
2. **Quiet confidence.** Surface findings without drama. High-risk nodes don't need red flashing borders; a risk heatmap toggle is enough. Trust the user to interpret data.
3. **Information density is a feature.** Developers expect compact, information-rich layouts. Whitespace is used for rhythm, not padding. Dense is not dirty.
4. **Every state has a design.** Empty state (no graph yet), loading state (graph generating), skeleton state (Phase 2 in progress), error state (scan failed), and the nominal state all need distinct, designed treatments.
5. **Tools disappear, insights remain.** The best interaction is no interaction. The graph should answer questions before the user asks them.

## Accessibility & Inclusion

WCAG AA minimum. Color is never the sole carrier of information (risk levels shown with both color and label). Keyboard navigation for all interactive elements. Focus indicators visible on the dark background. Reduced motion alternative for all animations.
