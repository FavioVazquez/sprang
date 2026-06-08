---
node_id: "file:packages/core/src/schema/types.ts"
node_label: "types.ts"
annotated_at: "2026-06-08T04:24:56.585Z"
tags: ["foundation", "high-risk", "review-before-change"]
---

Core type contract for the entire platform. All agents depend on SprangNode. Any changes here require updating Zod validators in validators.ts and re-running pnpm build.