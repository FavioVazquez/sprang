---
trigger: model_decision
description: How to answer a question relayed from the Sprang dashboard's Ask Agent panel. Applies when a message is prefixed with [SPRANG DASHBOARD MESSAGE].
---

# Sprang Dashboard Messaging

The Sprang dashboard's **Ask Agent** panel can relay a question to you. Relayed
messages are prefixed with `[SPRANG DASHBOARD MESSAGE]`.

When you receive one:

1. Read the running conversation so your answer is in context. The file is
   gitignored, so read it with a shell command rather than a file-read tool:
   `cat .sprang/agent-conversation.md 2>/dev/null || echo "(no history yet)"`
2. Answer fully, grounding the answer in the knowledge graph via the MCP tools
   (`sprang_query`, `sprang_node`, `sprang_health`, `sprang_why`, …).
3. Finish by calling `sprang_respond` with **both** fields, so the dashboard can
   display the question alongside the answer:
   `sprang_respond({ response: "<your full answer>", question: "<the original question>" })`

`sprang_respond` also appends the exchange to `.sprang/agent-conversation.md`,
which is what keeps step 1 useful on the next question.
