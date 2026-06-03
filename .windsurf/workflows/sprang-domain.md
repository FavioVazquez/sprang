---
description: Map code to business processes — explore domain flows and understand what each module does in real-world terms
---

# /sprang-domain

Extract and visualize business domain knowledge from the codebase.

Pass a domain name as `$ARGUMENTS` to inspect a specific domain, or leave empty to map all domains.

## Instructions

1. Check `.sprang/knowledge-graph.json` exists. If not, run `/sprang-analyze` first.

2. **Check if domains already exist** — grep the graph for `"domains"`. If non-empty and not requesting a rebuild, use existing domains.

3. **If domains are empty or $ARGUMENTS contains `--rebuild`**, extract domains:

   ### Domain Extraction

   a. Read all file-level nodes with their summaries, tags, and layers.

   b. Read README_CONTENT (from `.sprang/knowledge-graph.json` project description and any docs nodes).

   c. **Identify business domains** by clustering files around:
      - Naming patterns (auth, payment, user, order, product, notification, search, etc.)
      - Directory structure (src/auth/, src/billing/, src/users/)
      - Tag patterns (nodes tagged "authentication", "authorization", "payment", etc.)
      - Shared dependencies (files that import the same core modules likely belong to the same domain)

   d. For each domain, trace the **business flow** — how data/requests flow through the domain:
      - Entry point (API endpoint, CLI command, event trigger)
      - Business logic steps
      - Data persistence
      - Output/side effects

   e. Write domain map to graph:
      ```bash
      # Update the domains[] section of knowledge-graph.json
      ```

      Domain structure:
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
                "node_ids": ["file:src/auth/login.ts", "function:src/auth/login.ts:validatePassword"],
                "weight": 1
              }
            ],
            "entry_points": ["endpoint:POST /auth/login"],
            "business_rules": ["Passwords must be bcrypt-hashed", "Max 5 failed attempts before lockout"]
          }
        ],
        "entities": ["file:src/models/User.ts", "table:users"]
      }
      ```

4. **If $ARGUMENTS specifies a domain name** — find and display that specific domain:
   - Show all flows in the domain
   - For each flow step, show the actual code file and its summary
   - Highlight any risk nodes in the domain
   - Show which tests cover this domain

5. **If no arguments** — show all domains:

   ### Domain Map: <project name>

   For each domain:
   > **<Domain Name>**
   > <summary>
   > Flows: <list flow names>
   > Key files: <top files>
   > Coverage: <% of domain nodes with tests>
   > Risk: <any high-risk nodes>

   Then show a **cross-domain dependency map** — which domains depend on which.

6. **Offer to save** the domain map to `docs/DOMAINS.md`.

7. Suggest: `/sprang-explain <key-domain-file>` for any flow step you want to understand deeply.
