---
trigger: always_on
---

# Cascade Dashboard Messaging

Messages sent from the Sprang dashboard arrive via the trigger file `.cascade-trigger-session`. Each message is prefixed with `[SPRANG DASHBOARD MESSAGE]`.

## Conversation History

The file `.cascade-conversation.md` in the workspace root contains the full history of prior exchanges between the user and Cascade. **Read it at the start of each session** to restore context before answering.

## When you receive a dashboard message:
1. Read `.cascade-conversation.md` to recall prior context
2. Answer the message fully, taking prior exchanges into account
3. Always call the `sprang_respond` MCP tool with your answer so it appears in the dashboard UI
4. This is a continuous conversation — treat each message as part of an ongoing session even if it arrives in a new Cascade tab
