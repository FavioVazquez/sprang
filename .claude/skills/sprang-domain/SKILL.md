---
name: sprang-domain
description: Map code to business processes and domain hierarchy. Use when the user says "/sprang-domain", "business domains", "domain map", "what business process does X implement", or "show me the domain structure".
argument-hint: "[domain-name]"
---

Map code to business processes — explore domain flows and understand what each
module does in real-world terms.

Arguments: `[domain name]` (optional — lists all domains if omitted; pass
`--rebuild` to re-extract the domain map)

## Instructions

1. Check `.sprang/knowledge-graph.json` exists. If not, run the `sprang-analyze`
   skill first.

2. Check whether domains already exist — call `sprang_domain` with no arguments.
   If it returns domains and `--rebuild` was not requested, use them.

3. **If domains are empty or `--rebuild` was passed, extract them:**
   a. Read all file-level nodes with their summaries, tags, and layers.
   b. Read the project description and any docs nodes for business context.
   c. Cluster files into business domains using naming patterns (auth, payment,
      user, order, product, notification, search), directory structure
      (`src/auth/`, `src/billing/`), tag patterns, and shared dependencies.
   d. For each domain, trace the business flow: entry point (endpoint, CLI
      command, event trigger) → business logic steps → persistence → side effects.
   e. Write the domain map using this structure:
      ```json
      {
        "id": "domain:auth",
        "label": "Authentication",
        "summary": "<what this domain does in business terms>",
        "flows": [
          {
            "id": "flow:login",
            "label": "User Login",
            "summary": "<what happens when a user logs in>",
            "steps": [
              {
                "id": "step:login-1",
                "label": "Validate credentials",
                "summary": "<what this step does>",
                "node_ids": ["file:src/auth/login.ts"],
                "weight": 0.8
              }
            ],
            "entry_points": ["endpoint:POST /auth/login"],
            "business_rules": ["Passwords must be bcrypt-hashed", "Max 5 failed attempts before lockout"]
          }
        ],
        "entities": ["file:src/models/User.ts", "table:users"]
      }
      ```
      Constraints: `weight` between 0.0 and 1.0; `id` values unique across all
      domains, flows, and steps; prefer file-level node IDs.

4. **If a domain name was given** — call `sprang_domain` with
   `domain_name: "$ARGUMENTS"` and present: every flow and its steps, the actual
   code file plus summary behind each step, any high-risk nodes, and which tests
   cover the domain (follow `tested_by` edges from the domain's source nodes).

5. **If no arguments** — list all domains. For each: name, summary, flow names,
   key files, test coverage, and any high-risk nodes. Then show a cross-domain
   dependency map (which domains depend on which).

6. Call `sprang_node` on key node IDs within the domain's steps to retrieve risk
   scores and structural context. Flag steps touching nodes with
   `risk_score >= 0.7`.

7. Call `sprang_query` with domain-related keywords to surface related nodes
   outside the formal domain mapping.

8. Summarize the domain's business purpose, its main flows, the riskiest code
   sections, and who or what owns each area. Offer to save the domain map to
   `docs/DOMAINS.md`, and suggest `sprang-explain <key-domain-file>` for any flow
   step worth understanding deeply.

$ARGUMENTS
