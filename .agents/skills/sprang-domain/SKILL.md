---
name: sprang-domain
description: Map code to business processes. Pass a domain name as $ARGUMENTS to inspect a specific domain, or leave empty to list all domains.
---

1. If $ARGUMENTS is provided, call `sprang_domain` with `domain_name: "$ARGUMENTS"` to get the full domain detail including flows and steps.
2. If no arguments, call `sprang_domain` without arguments to list all domains with their summaries and flow counts.
3. For the selected domain (or the most prominent one if listing), present each flow and its steps clearly.
4. Call `sprang_node` on the key node IDs within the domain's steps to retrieve risk scores and structural context.
5. Identify which steps touch high-risk nodes (risk_score >= 0.7) and flag them as areas needing care.
6. Call `sprang_query` with domain-related keywords to surface additional related nodes outside the formal domain mapping.
7. Summarize the domain's business purpose, its main flows, the riskiest code sections, and which teams or files own each area.
