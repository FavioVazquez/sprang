---
description: Sprang dashboard messaging protocol — read before answering every dashboard question.
alwaysApply: true
---

# Sprang Dashboard Messaging

Messages sent from the Sprang dashboard arrive via the trigger file `.cascade-trigger-session`. Each message is prefixed with `[SPRANG DASHBOARD MESSAGE]`.

## Conversation History

The file `.sprang/agent-conversation.md` is an **append-only log** of every prior exchange between the user and the agent. It is written after each response, so it accumulates during a session.

**Read `.sprang/agent-conversation.md` immediately before answering each dashboard message** to restore full conversation context. This is especially important because Claude Code sessions may be stateless across invocations.

## When you receive a dashboard message:
1. **Read `.sprang/agent-conversation.md`** (use the Read tool) — restores all prior context
2. Answer the question fully, using MCP tools (sprang_query, sprang_node, etc.) to ground your answer
3. Call the `sprang_respond` MCP tool with your answer so it appears in the dashboard UI
4. This is a continuous conversation — every question builds on the full history in that file
