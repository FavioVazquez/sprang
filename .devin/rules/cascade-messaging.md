---
trigger: always_on
---

# Cascade Dashboard Messaging

Messages sent from the Sprang dashboard arrive via the trigger file `.cascade-trigger-session`. Each message is prefixed with `[SPRANG DASHBOARD MESSAGE]`.

## Conversation History

The file `.cascade-conversation.md` in the workspace root is an **append-only log** of every prior exchange. The hook that writes it fires *after* each response, so new entries accumulate while the session is running.

**You MUST read `.cascade-conversation.md` immediately before answering EACH dashboard message** — not just at session start — because earlier messages in the same session will have been appended since you last read it.

## When you receive a dashboard message:
1. **Immediately read `.cascade-conversation.md`** (use the read_file tool) — this gives you the full conversation history including any exchanges that happened earlier in this same session
2. Answer the message fully, taking ALL prior exchanges into account
3. Always call the `sprang_respond` MCP tool with your answer so it appears in the dashboard UI
4. This is a continuous conversation — every question builds on the full history in that file
