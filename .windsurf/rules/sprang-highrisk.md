---
trigger: glob
globs: ["src/**/*.ts", "src/**/*.tsx", "src/**/*.js", "lib/**/*", "packages/*/src/**"]
---

# Sprang — High-Centrality Zone

You are editing a source file. Before proceeding:
- Run `sprang_diff_impact` with this file to see what depends on it
- If blast radius is high (>10 affected nodes), explain your change in a comment before submitting
- Check `structural_warnings` on this node — any `circular_dependency` or `god_node` warnings need care
