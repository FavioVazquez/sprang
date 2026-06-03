#!/usr/bin/env bash
# Initializes a scripted git history in this directory for git-layer agent tests.
# Run once before tests: bash packages/core/tests/fixtures/git-repo/create-history.sh
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$DIR"

if [ -d ".git" ]; then
  echo "Git history already initialized."
  exit 0
fi

git init
git config user.email "alice@sprang.dev"
git config user.name "Alice"

# Initial scaffold
git add .
git commit -m "feat: initial project scaffold"

# 19 more commits with 3 authors and PR references
git config user.email "bob@sprang.dev"
git config user.name "Bob"
echo "// v1.1 — basic auth" >> src/auth.ts
git add src/auth.ts
git commit -m "feat: add basic auth login — Fixes #42"

git config user.email "carol@sprang.dev"
git config user.name "Carol"
echo "// v1.1 — db connect" >> src/database.ts
git add src/database.ts
git commit -m "feat: implement database connect — Closes #45"

git config user.email "alice@sprang.dev"
git config user.name "Alice"
echo "// api v1.1" >> src/api.ts
git add src/api.ts
git commit -m "feat: wire api layer — Re: #67"

git config user.email "bob@sprang.dev"
git config user.name "Bob"
echo "export const VERSION = '1.1.0';" >> src/index.ts
git add src/index.ts
git commit -m "chore: bump to 1.1.0 — Fixes #50"

git config user.email "carol@sprang.dev"
git config user.name "Carol"
echo "// security: validate token" >> src/auth.ts
git add src/auth.ts
git commit -m "fix: validate auth token on every request — Closes #55"

git config user.email "alice@sprang.dev"
git config user.name "Alice"
echo "// retry on disconnect" >> src/database.ts
git add src/database.ts
git commit -m "fix: retry db connect on transient failures — Fixes #60"

git config user.email "bob@sprang.dev"
git config user.name "Bob"
echo "// rate limiting" >> src/api.ts
git add src/api.ts
git commit -m "feat: add rate limiting to api layer — Re: #72"

git config user.email "carol@sprang.dev"
git config user.name "Carol"
echo "// session expiry check" >> src/auth.ts
git add src/auth.ts
git commit -m "feat: enforce session expiry — Closes #78"

git config user.email "alice@sprang.dev"
git config user.name "Alice"
echo "// connection pooling" >> src/database.ts
git add src/database.ts
git commit -m "perf: connection pooling for database — Fixes #83"

git config user.email "bob@sprang.dev"
git config user.name "Bob"
echo "// health check endpoint" >> src/api.ts
git add src/api.ts
git commit -m "feat: add /health endpoint — Re: #89"

git config user.email "carol@sprang.dev"
git config user.name "Carol"
echo "export const VERSION = '1.2.0';" >> src/index.ts
git add src/index.ts
git commit -m "chore: release 1.2.0 — Closes #95"

git config user.email "alice@sprang.dev"
git config user.name "Alice"
echo "// role-based access" >> src/auth.ts
git add src/auth.ts
git commit -m "feat: RBAC for auth — Fixes #101"

git config user.email "bob@sprang.dev"
git config user.name "Bob"
echo "// query cache" >> src/database.ts
git add src/database.ts
git commit -m "perf: add query result cache — Re: #107"

git config user.email "carol@sprang.dev"
git config user.name "Carol"
echo "// audit log" >> src/api.ts
git add src/api.ts
git commit -m "feat: audit log all api calls — Closes #112"

git config user.email "alice@sprang.dev"
git config user.name "Alice"
echo "// logout cleanup" >> src/auth.ts
git add src/auth.ts
git commit -m "fix: cleanup session on logout — Fixes #118"

git config user.email "bob@sprang.dev"
git config user.name "Bob"
echo "// reconnect on error" >> src/database.ts
git add src/database.ts
git commit -m "fix: auto-reconnect on db error — Re: #123"

git config user.email "carol@sprang.dev"
git config user.name "Carol"
echo "// pagination" >> src/api.ts
git add src/api.ts
git commit -m "feat: paginated query results — Closes #128"

git config user.email "alice@sprang.dev"
git config user.name "Alice"
echo "export const VERSION = '1.3.0';" >> src/index.ts
git add src/index.ts
git commit -m "chore: release 1.3.0 — Fixes #135"

echo "Git history initialized with 20 commits, 3 authors, PR references."
