/**
 * Windsurf bridge — writes a message to .cascade-trigger-session so the
 * cascade-messaging VS Code extension picks it up and forwards it to the Windsurf AI.
 * The AI then calls sprang_respond MCP tool → writes cascade-response.json.
 * The dashboard polls /agent-response to display the reply.
 */

import fs from 'node:fs';
import path from 'node:path';

export function getWindsurfTriggerPath(sprangRoot: string): string {
  return path.join(sprangRoot, '.cascade-trigger-session');
}

export function getWindsurfResponsePath(sprangRoot: string): string {
  return path.join(sprangRoot, '.sprang', 'cascade-response.json');
}

export function writeWindsurfTrigger(message: string, sprangRoot: string): void {
  const triggerPath = getWindsurfTriggerPath(sprangRoot);
  const tmp = triggerPath + '.tmp';
  const wrapped = `[SPRANG DASHBOARD MESSAGE — you MUST call the sprang_respond MCP tool with your answer when done, so it appears in the dashboard]

Question: ${message}

After answering, call sprang_respond with: { "response": "<your answer>", "question": "${message.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}" }`;
  fs.writeFileSync(tmp, wrapped, 'utf-8');
  fs.renameSync(tmp, triggerPath);
}
