# Sprang Session-Start Hook

When starting a session in this repo, run the following command to ensure the knowledge graph is fresh before querying it:

```sh
sprang scan --phase1-only --if-stale
```

This command checks whether the graph's recorded git commit hash matches the current `HEAD`. If they match, the scan is skipped instantly. If the graph is missing or stale, a Phase 1 scan runs to rebuild it.

This keeps the graph accurate with minimal overhead at session start.
