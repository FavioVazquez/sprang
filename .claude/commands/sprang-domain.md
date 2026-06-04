Map code to business processes.

Arguments: `[domain name]` (optional — lists all domains if omitted)

1. If argument provided, call `sprang_domain` with `domain_name: "$ARGUMENTS"` to get full domain detail including flows and steps.
2. If no arguments, call `sprang_domain` without arguments to list all domains with summaries and flow counts.
3. For the selected domain (or most prominent one if listing), present each flow and its steps clearly.
4. Call `sprang_node` on key node IDs within the domain's steps to retrieve risk scores and structural context.
5. Identify steps that touch high-risk nodes (risk_score >= 0.7) and flag them as areas needing care.
6. Call `sprang_query` with domain-related keywords to surface additional related nodes outside the formal domain mapping.
7. Summarize the domain's business purpose, its main flows, the riskiest code sections, and which teams or files own each area.

$ARGUMENTS
