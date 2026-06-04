---
description: Sprang dashboard messaging protocol — read before answering every dashboard question.
alwaysApply: true
---

# Sprang Dashboard Messaging

Messages sent from the Sprang dashboard arrive via the trigger file `.cascade-trigger-session`. Each message is prefixed with `[SPRANG DASHBOARD MESSAGE]`.

## Conversation History

The file `.sprang/agent-conversation.md` is an **append-only log** of every prior exchange between the user and the agent. It is written after each response, so it accumulates during a session.

**Read `.sprang/agent-conversation.md` immediately before answering each dashboard message** to restore full conversation context.

> **Important:** this file is gitignored, so the Read tool will be blocked. Always use a Bash command instead:
> `cat .sprang/agent-conversation.md 2>/dev/null || echo "(no history yet)"`

## When you receive a dashboard message:
1. **Run `cat .sprang/agent-conversation.md 2>/dev/null || echo "(no history yet)"`** — restores all prior context (the file is gitignored so the Read tool won't work)
2. Answer the question fully, using MCP tools (sprang_query, sprang_node, etc.) to ground your answer
3. Call the `sprang_respond` MCP tool with your answer so it appears in the dashboard UI
4. This is a continuous conversation — every question builds on the full history in that file
