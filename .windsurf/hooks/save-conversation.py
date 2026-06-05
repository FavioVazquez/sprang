#!/usr/bin/env python3
"""
Hook: post_cascade_response_with_transcript
Reads the JSONL transcript and appends the latest exchange
(user message + Cascade response) to .sprang/agent-conversation.md
in the workspace root.

This script is workspace-agnostic — it uses WINDSURF_WORKSPACE_ROOT
set by Cascade at hook invocation time.
"""
import json
import sys
import os
from datetime import datetime, timezone

def main():
    raw = sys.stdin.read()
    try:
        data = json.loads(raw)
    except Exception:
        return

    transcript_path = data.get("tool_info", {}).get("transcript_path", "")
    if not transcript_path or not os.path.exists(transcript_path):
        return

    # WINDSURF_WORKSPACE_ROOT is set by Cascade for every hook invocation
    workspace = os.environ.get("WINDSURF_WORKSPACE_ROOT", "")
    if not workspace:
        return

    sprang_dir = os.path.join(workspace, ".sprang")
    os.makedirs(sprang_dir, exist_ok=True)
    conv_file = os.path.join(sprang_dir, "agent-conversation.md")

    # Read transcript lines
    try:
        with open(transcript_path, "r", encoding="utf-8") as f:
            lines = [json.loads(l) for l in f if l.strip()]
    except Exception:
        return

    # Extract last user_input and all planner_responses after it
    user_msg = ""
    responses = []
    in_response_block = False

    for entry in lines:
        t = entry.get("type", "")
        if t == "user_input":
            # Start a new exchange
            user_msg = entry.get("user_input", {}).get("user_response", "").strip()
            responses = []
            in_response_block = True
        elif t == "planner_response" and in_response_block:
            r = entry.get("planner_response", {}).get("response", "").strip()
            if r:
                responses.append(r)

    if not user_msg or not responses:
        return

    # Skip messages that came from the dashboard trigger (they already have [SPRANG DASHBOARD MESSAGE] prefix)
    # — we still want to log them, just identify them clearly
    cascade_response = "\n\n".join(responses)
    timestamp = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")

    entry_md = f"\n---\n**[{timestamp}]**\n\n**User:** {user_msg}\n\n**Cascade:** {cascade_response}\n"

    try:
        with open(conv_file, "a", encoding="utf-8") as f:
            f.write(entry_md)
    except Exception:
        pass

if __name__ == "__main__":
    main()
