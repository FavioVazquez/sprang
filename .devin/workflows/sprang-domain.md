---
description: Map code to business processes — explore domain flows and understand what each module does in real-world terms
---

1. Call `sprang_domain` without arguments to list all domains with their summaries and flow counts.
2. Present the domain list to the user and ask (or infer from context) which domain they are interested in.
3. Call `sprang_domain` with the chosen `domain_name` to retrieve full flow details including steps and business rules.
4. For each flow step, call `sprang_node` on the key node IDs to get summaries, risk scores, and structural warnings.
5. Identify any flow steps that touch high-risk nodes (risk_score >= 0.7) and highlight them as areas requiring careful changes.
6. Call `sprang_query` with domain-relevant keywords to find additional related nodes not captured in the formal domain mapping.
7. Summarize the domain: how many flows, what the business rules are, which code modules own which steps, and which areas carry the most risk.
