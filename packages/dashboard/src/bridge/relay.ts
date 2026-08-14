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

/**
 * Build the prompt handed to the agent.
 *
 * The reply instruction has a shell fallback on purpose. The agent that picks
 * this up is not always the one the dashboard can see: Devin opens a relayed
 * question in a *new* conversation, and if the Sprang MCP server fails to start
 * there the agent has no `sprang_respond` tool and simply answers into the void,
 * leaving the dashboard polling forever. Writing the file directly needs nothing
 * but a shell, so the answer always finds its way back.
 */
export function buildRelayPrompt(question: string): string {
  const jsonQuestion = JSON.stringify(question);
  return `[SPRANG DASHBOARD MESSAGE]

${question}

---
Ground your answer in the knowledge graph using the Sprang MCP tools
(sprang_query, sprang_node, sprang_health, sprang_why) if they are available.

Then return the answer to the dashboard. Preferred:

sprang_respond({ response: "<your answer>", question: ${jsonQuestion} })

If the sprang_respond tool is NOT available in this session, write the file
yourself instead — the dashboard polls it either way:

  mkdir -p .sprang && cat > .sprang/cascade-response.json <<'SPRANG_EOF'
  {"response": "<your answer>", "question": ${jsonQuestion}, "written_at": "<ISO-8601 timestamp>"}
  SPRANG_EOF
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
