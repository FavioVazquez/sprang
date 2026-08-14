/**
 * Manual relay — the fallback when no agent CLI can be driven from the server.
 *
 * This replaces the Windsurf/Cascade bridge, which depended on a VS Code
 * extension (`cascade-messaging`) whose source was never committed. The relay
 * needs no extension: the dashboard writes the question to a file, the user
 * pastes it (or their IDE agent reads it), and the agent finishes by calling the
 * `sprang_respond` MCP tool — which writes the same response file every other
 * bridge writes, so the dashboard's polling path is unchanged.
 *
 * It is the only bridge that works inside an IDE-hosted agent such as Devin
 * Desktop, where there is no authenticated CLI for the server to spawn.
 */

import fs from 'node:fs';
import path from 'node:path';

/** Where the agent's answer lands, whichever bridge produced it. */
export function getResponsePath(sprangRoot: string): string {
  return path.join(sprangRoot, '.sprang', 'cascade-response.json');
}

/** The pending question, written for a human or an IDE agent to pick up. */
export function getRelayQuestionPath(sprangRoot: string): string {
  return path.join(sprangRoot, '.sprang', 'agent-question.md');
}

/** Build the prompt the user relays to their agent. */
export function buildRelayPrompt(question: string): string {
  return `[SPRANG DASHBOARD MESSAGE]

${question}

---
Answer using the Sprang MCP tools (sprang_query, sprang_node, sprang_health, sprang_why),
then call sprang_respond so the answer appears in the dashboard:

sprang_respond({ response: "<your answer>", question: ${JSON.stringify(question)} })
`;
}

/**
 * Stage a question for manual relay. Returns the prompt so the HTTP layer can
 * hand it straight to the UI for a copy button.
 */
export function writeRelayQuestion(question: string, sprangRoot: string): string {
  const prompt = buildRelayPrompt(question);
  const questionPath = getRelayQuestionPath(sprangRoot);
  fs.mkdirSync(path.dirname(questionPath), { recursive: true });
  const tmp = questionPath + '.tmp';
  fs.writeFileSync(tmp, prompt, 'utf-8');
  fs.renameSync(tmp, questionPath);
  return prompt;
}
