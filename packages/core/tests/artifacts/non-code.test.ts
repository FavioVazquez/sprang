import { describe, it, expect } from 'vitest';
import {
  extractArtifacts,
  detectArtifactKind,
  sniffArtifactKind,
  fileNodeId,
} from '../../src/artifacts/non-code.js';
import type { ArtifactExtraction, ArtifactNode, ArtifactEdge } from '../../src/artifacts/non-code.js';

// ─── helpers ──────────────────────────────────────────────────────────────────

const ids = (r: ArtifactExtraction): string[] => r.nodes.map((n) => n.id);

const byId = (r: ArtifactExtraction, id: string): ArtifactNode => {
  const node = r.nodes.find((n) => n.id === id);
  if (!node) throw new Error(`no node ${id}; have: ${ids(r).join(', ')}`);
  return node;
};

const meta = (r: ArtifactExtraction, id: string): Record<string, unknown> =>
  byId(r, id).metadata ?? {};

const edgesOfType = (r: ArtifactExtraction, type: ArtifactEdge['type']): string[] =>
  r.edges.filter((e) => e.type === type).map((e) => `${e.source} -> ${e.target}`);

// ─── fixtures ─────────────────────────────────────────────────────────────────

const WORKFLOW = `name: CI

on:
  push:
    branches: ['**']
  pull_request:

jobs:
  build:
    name: Build and test
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v4
      - name: Setup Node
        uses: actions/setup-node@v4
        with:
          node-version: '22'
      - name: Test
        run: |
          pnpm install
          pnpm test

  lint:
    runs-on: ubuntu-22.04
    steps:
      - uses: actions/checkout@v4
      - run: pnpm lint

  publish:
    runs-on: ubuntu-latest
    needs: [build, lint]
    if: github.ref == 'refs/heads/main'
    steps:
      - name: Publish
        run: npm publish
`;

const DOCKERFILE = `# syntax=docker/dockerfile:1
FROM node:22-alpine AS builder
WORKDIR /app
COPY package.json ./
RUN pnpm install \\
    --frozen-lockfile
RUN pnpm build

FROM node:22-alpine AS runtime
WORKDIR /app
COPY --from=builder /app/dist ./dist
USER node
EXPOSE 8080 9229/tcp
ENTRYPOINT ["node"]
CMD ["dist/server.js", "--port", "8080"]
`;

const COMPOSE = `version: '3.9'

services:
  api:
    image: ghcr.io/acme/api:1.4.2
    ports:
      - "8080:8080"
    environment:
      - DATABASE_URL=postgres://db/app
    depends_on:
      - db
      - cache

  db:
    image: postgres:16
    ports:
      - "5432:5432"

  cache:
    image: redis:7

  worker:
    build:
      context: .
      dockerfile: Dockerfile.worker
    command: node worker.js
    depends_on:
      - api
`;

const K8S = `apiVersion: apps/v1
kind: Deployment
metadata:
  name: api
  namespace: prod
spec:
  replicas: 3
  template:
    spec:
      containers:
        - name: api
          image: ghcr.io/acme/api:1.4.2
          ports:
            - containerPort: 8080
---
apiVersion: v1
kind: Service
metadata:
  name: api
spec:
  selector:
    app: api
  ports:
    - port: 80
      targetPort: 8080
---
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: api-ingress
spec:
  rules:
    - host: api.example.com
      http:
        paths:
          - path: /
            backend:
              service:
                name: api
                port:
                  number: 80
`;

const TERRAFORM = `terraform {
  required_version = ">= 1.5"
}

# The application bucket
resource "aws_s3_bucket" "logs" {
  bucket = "acme-logs"
}

resource "aws_s3_bucket_policy" "logs" {
  bucket = aws_s3_bucket.logs.id
}

data "aws_ami" "ubuntu" {
  most_recent = true
}

module "vpc" {
  source  = "terraform-aws-modules/vpc/aws"
  version = "5.0.0"
}
`;

const OPENAPI_YAML = `openapi: 3.0.3
info:
  title: Users API
  version: 1.0.0
paths:
  /users:
    get:
      operationId: listUsers
      summary: List all users
      tags: [users]
      responses:
        '200':
          description: ok
    post:
      operationId: createUser
      responses:
        '201':
          description: created
  /users/{id}:
    get:
      operationId: getUser
      responses:
        '200':
          description: ok
    delete:
      operationId: deleteUser
      responses:
        '204':
          description: gone
components:
  schemas:
    User:
      type: object
    Error:
      type: object
`;

const PACKAGE_JSON = JSON.stringify(
  {
    name: '@acme/api',
    version: '2.1.0',
    private: true,
    packageManager: 'pnpm@9.0.0',
    workspaces: ['packages/*'],
    scripts: {
      build: 'tsup src/index.ts',
      test: 'vitest run',
      lint: 'eslint .',
    },
    dependencies: { zod: '^3.23.8' },
    devDependencies: { vitest: '^4.1.8', typescript: '^5.7.0' },
  },
  null,
  2,
);

// ─── detectArtifactKind ───────────────────────────────────────────────────────

describe('detectArtifactKind', () => {
  it('classifies GitHub Actions workflows', () => {
    expect(detectArtifactKind('.github/workflows/ci.yml')).toBe('github-actions');
    expect(detectArtifactKind('.github/workflows/release.yaml')).toBe('github-actions');
    expect(detectArtifactKind('.github/ISSUE_TEMPLATE/bug.yml')).toBeNull();
  });

  it('classifies Dockerfiles including suffixed variants', () => {
    expect(detectArtifactKind('Dockerfile')).toBe('dockerfile');
    expect(detectArtifactKind('ops/Dockerfile.prod')).toBe('dockerfile');
    expect(detectArtifactKind('build/api.dockerfile')).toBe('dockerfile');
  });

  it('classifies compose files', () => {
    expect(detectArtifactKind('docker-compose.yml')).toBe('docker-compose');
    expect(detectArtifactKind('docker-compose.prod.yaml')).toBe('docker-compose');
    expect(detectArtifactKind('compose.yaml')).toBe('docker-compose');
  });

  it('classifies terraform, package.json, openapi and sql migrations', () => {
    expect(detectArtifactKind('infra/main.tf')).toBe('terraform');
    expect(detectArtifactKind('package.json')).toBe('package-json');
    expect(detectArtifactKind('packages/core/package.json')).toBe('package-json');
    expect(detectArtifactKind('api/openapi.yaml')).toBe('openapi');
    expect(detectArtifactKind('docs/swagger.json')).toBe('openapi');
    expect(detectArtifactKind('db/migrations/001_init.sql')).toBe('sql-migration');
    expect(detectArtifactKind('migration/0002-add-index.sql')).toBe('sql-migration');
  });

  it('returns null for plain source files and ambiguous yaml', () => {
    expect(detectArtifactKind('src/index.ts')).toBeNull();
    expect(detectArtifactKind('README.md')).toBeNull();
    expect(detectArtifactKind('db/seed.sql')).toBeNull();
    expect(detectArtifactKind('k8s/deploy.yaml')).toBeNull();
  });

  it('normalizes windows separators', () => {
    expect(detectArtifactKind('.github\\workflows\\ci.yml')).toBe('github-actions');
    expect(detectArtifactKind('infra\\main.tf')).toBe('terraform');
  });
});

describe('sniffArtifactKind', () => {
  it('recognizes kubernetes, openapi and compose content in ambiguous yaml', () => {
    expect(sniffArtifactKind('k8s/deploy.yaml', K8S)).toBe('kubernetes');
    expect(sniffArtifactKind('api/spec.yaml', OPENAPI_YAML)).toBe('openapi');
    expect(sniffArtifactKind('stack.yml', COMPOSE)).toBe('docker-compose');
  });

  it('returns null for unrelated yaml and non-yaml paths', () => {
    expect(sniffArtifactKind('config.yaml', 'foo: bar\nbaz: 1\n')).toBeNull();
    expect(sniffArtifactKind('src/index.ts', 'kind: x\napiVersion: y\n')).toBeNull();
  });
});

// ─── GitHub Actions ───────────────────────────────────────────────────────────

describe('GitHub Actions workflows', () => {
  const file = '.github/workflows/ci.yml';
  const result = extractArtifacts(file, WORKFLOW);

  it('emits one pipeline node per job', () => {
    expect(ids(result)).toEqual([
      `pipeline:${file}:build`,
      `pipeline:${file}:lint`,
      `pipeline:${file}:publish`,
    ]);
    expect(result.nodes.every((n) => n.type === 'pipeline')).toBe(true);
  });

  it('emits contains edges from the owning file node', () => {
    expect(edgesOfType(result, 'contains')).toEqual([
      `${fileNodeId(file)} -> pipeline:${file}:build`,
      `${fileNodeId(file)} -> pipeline:${file}:lint`,
      `${fileNodeId(file)} -> pipeline:${file}:publish`,
    ]);
  });

  it('captures runs-on, job name and line number', () => {
    const build = byId(result, `pipeline:${file}:build`);
    expect(build.label).toBe('Build and test');
    expect(build.metadata?.['runsOn']).toBe('ubuntu-latest');
    expect(build.line).toBe(9);
    expect(meta(result, `pipeline:${file}:lint`)['runsOn']).toBe('ubuntu-22.04');
  });

  it('captures each step uses/name/run in metadata', () => {
    const steps = meta(result, `pipeline:${file}:build`)['steps'];
    expect(steps).toEqual([
      { name: 'Checkout', uses: 'actions/checkout@v4' },
      { name: 'Setup Node', uses: 'actions/setup-node@v4' },
      { name: 'Test', run: 'pnpm install' },
    ]);
    expect(meta(result, `pipeline:${file}:build`)['uses']).toEqual([
      'actions/checkout@v4',
      'actions/setup-node@v4',
    ]);
  });

  it('captures the on: triggers', () => {
    expect(meta(result, `pipeline:${file}:build`)['triggers']).toEqual(['push', 'pull_request']);
    expect(meta(result, `pipeline:${file}:publish`)['workflow']).toBe('CI');
  });

  it('turns needs: into triggers edges between jobs', () => {
    expect(meta(result, `pipeline:${file}:publish`)['needs']).toEqual(['build', 'lint']);
    expect(edgesOfType(result, 'triggers')).toEqual([
      `pipeline:${file}:build -> pipeline:${file}:publish`,
      `pipeline:${file}:lint -> pipeline:${file}:publish`,
    ]);
  });

  it('ignores a needs: entry that names a job that does not exist', () => {
    const r = extractArtifacts(
      file,
      'jobs:\n  a:\n    needs: [ghost]\n    steps:\n      - run: echo hi\n',
    );
    expect(ids(r)).toEqual([`pipeline:${file}:a`]);
    expect(edgesOfType(r, 'triggers')).toEqual([]);
  });

  it('returns empty for a workflow with no jobs block', () => {
    expect(extractArtifacts(file, 'name: CI\non: push\n')).toEqual({ nodes: [], edges: [] });
  });

  it('returns empty for malformed yaml rather than throwing', () => {
    const broken = 'jobs:\n\t- [[[ }}} :::\n   ???\n';
    expect(() => extractArtifacts(file, broken)).not.toThrow();
    expect(extractArtifacts(file, broken)).toEqual({ nodes: [], edges: [] });
  });
});

// ─── Dockerfile ───────────────────────────────────────────────────────────────

describe('Dockerfile', () => {
  const file = 'Dockerfile';
  const result = extractArtifacts(file, DOCKERFILE);

  it('emits one service node per build stage', () => {
    expect(ids(result)).toEqual([`service:${file}:builder`, `service:${file}:runtime`]);
    expect(result.nodes.every((n) => n.type === 'service')).toBe(true);
    expect(edgesOfType(result, 'contains')).toHaveLength(2);
  });

  it('captures the base image and stage order', () => {
    expect(meta(result, `service:${file}:builder`)['baseImage']).toBe('node:22-alpine');
    expect(meta(result, `service:${file}:builder`)['stageIndex']).toBe(0);
    expect(meta(result, `service:${file}:runtime`)['final']).toBe(true);
    expect(meta(result, `service:${file}:builder`)['final']).toBe(false);
  });

  it('captures EXPOSE ports on the owning stage only', () => {
    expect(meta(result, `service:${file}:runtime`)['ports']).toEqual(['8080', '9229/tcp']);
    expect(meta(result, `service:${file}:builder`)['ports']).toEqual([]);
  });

  it('captures CMD and ENTRYPOINT in both exec and shell form', () => {
    expect(meta(result, `service:${file}:runtime`)['cmd']).toBe('dist/server.js --port 8080');
    expect(meta(result, `service:${file}:runtime`)['entrypoint']).toBe('node');
    const shellForm = extractArtifacts(file, 'FROM alpine\nCMD npm start\n');
    expect(meta(shellForm, `service:${file}:stage0`)['cmd']).toBe('npm start');
  });

  it('names an unnamed stage by index and joins continued lines', () => {
    const r = extractArtifacts(file, 'FROM python:3.12\nEXPOSE 5000\n');
    expect(ids(r)).toEqual([`service:${file}:stage0`]);
    expect(meta(r, `service:${file}:stage0`)['ports']).toEqual(['5000']);
  });

  it('links stages joined by COPY --from', () => {
    expect(edgesOfType(result, 'triggers')).toEqual([
      `service:${file}:builder -> service:${file}:runtime`,
    ]);
  });

  it('returns empty for a Dockerfile with no FROM', () => {
    expect(extractArtifacts(file, '# just a comment\nRUN true\n')).toEqual({ nodes: [], edges: [] });
  });
});

// ─── docker-compose ───────────────────────────────────────────────────────────

describe('docker-compose', () => {
  const file = 'docker-compose.yml';
  const result = extractArtifacts(file, COMPOSE);

  it('emits one service node per compose service', () => {
    const services = result.nodes.filter((n) => n.type === 'service').map((n) => n.label);
    expect(services).toEqual(['api', 'cache', 'db', 'worker']);
  });

  it('emits deploys edges from each service to its image resource node', () => {
    expect(edgesOfType(result, 'deploys')).toEqual([
      `service:${file}:api -> resource:${file}:image/ghcr.io/acme/api:1.4.2`,
      `service:${file}:cache -> resource:${file}:image/redis:7`,
      `service:${file}:db -> resource:${file}:image/postgres:16`,
    ]);
    expect(byId(result, `resource:${file}:image/postgres:16`).type).toBe('resource');
  });

  it('turns depends_on into triggers edges between services', () => {
    expect(edgesOfType(result, 'triggers')).toEqual([
      `service:${file}:api -> service:${file}:worker`,
      `service:${file}:cache -> service:${file}:api`,
      `service:${file}:db -> service:${file}:api`,
    ]);
  });

  it('captures ports, environment keys and build context', () => {
    expect(meta(result, `service:${file}:api`)['ports']).toEqual(['8080:8080']);
    expect(meta(result, `service:${file}:api`)['environment']).toEqual(['DATABASE_URL']);
    expect(meta(result, `service:${file}:worker`)['build']).toBe('.');
    expect(meta(result, `service:${file}:worker`)['dockerfile']).toBe('Dockerfile.worker');
    expect(meta(result, `service:${file}:worker`)['command']).toBe('node worker.js');
  });

  it('returns empty when there is no services block', () => {
    expect(extractArtifacts(file, "version: '3.9'\nvolumes:\n  data:\n")).toEqual({
      nodes: [],
      edges: [],
    });
  });
});

// ─── Kubernetes ───────────────────────────────────────────────────────────────

describe('Kubernetes manifests', () => {
  const file = 'k8s/api.yaml';
  const result = extractArtifacts(file, K8S);

  it('emits one resource node per document in a multi-document file', () => {
    expect(ids(result)).toEqual([
      `resource:${file}:Deployment/api`,
      `resource:${file}:Ingress/api-ingress`,
      `resource:${file}:Service/api`,
      `resource:${file}:image/ghcr.io/acme/api:1.4.2`,
    ]);
  });

  it('captures kind, apiVersion, namespace and replicas', () => {
    const dep = meta(result, `resource:${file}:Deployment/api`);
    expect(dep['kind']).toBe('Deployment');
    expect(dep['apiVersion']).toBe('apps/v1');
    expect(dep['namespace']).toBe('prod');
    expect(dep['replicas']).toBe('3');
    expect(dep['images']).toEqual(['ghcr.io/acme/api:1.4.2']);
  });

  it('reports line numbers offset by the preceding documents', () => {
    expect(byId(result, `resource:${file}:Deployment/api`).line).toBe(2);
    expect(byId(result, `resource:${file}:Service/api`).line ?? 0).toBeGreaterThan(15);
  });

  it('emits deploys edges from workloads to their container images', () => {
    expect(edgesOfType(result, 'deploys')).toEqual([
      `resource:${file}:Deployment/api -> resource:${file}:image/ghcr.io/acme/api:1.4.2`,
    ]);
  });

  it('emits routes edges from an Ingress to Services declared in the same file', () => {
    expect(edgesOfType(result, 'routes')).toEqual([
      `resource:${file}:Ingress/api-ingress -> resource:${file}:Service/api`,
    ]);
  });

  it('emits a contains edge from the file node for every document', () => {
    // Three documents; the synthetic image node hangs off the workload via
    // `deploys`, not off the file.
    expect(edgesOfType(result, 'contains')).toEqual([
      `${fileNodeId(file)} -> resource:${file}:Deployment/api`,
      `${fileNodeId(file)} -> resource:${file}:Ingress/api-ingress`,
      `${fileNodeId(file)} -> resource:${file}:Service/api`,
    ]);
  });

  it('skips documents that lack kind or apiVersion', () => {
    const r = extractArtifacts(file, 'apiVersion: v1\nkind: ConfigMap\nmetadata:\n  name: cm\n---\nfoo: bar\n');
    expect(ids(r)).toEqual([`resource:${file}:ConfigMap/cm`]);
  });

  it('returns empty when nothing in the file is a manifest', () => {
    expect(extractArtifacts(file, 'foo: bar\nbaz: qux\n')).toEqual({ nodes: [], edges: [] });
  });
});

// ─── Terraform ────────────────────────────────────────────────────────────────

describe('Terraform', () => {
  const file = 'infra/main.tf';
  const result = extractArtifacts(file, TERRAFORM);

  it('names resource, data and module blocks by their terraform address', () => {
    expect(ids(result)).toEqual([
      `resource:${file}:aws_s3_bucket.logs`,
      `resource:${file}:aws_s3_bucket_policy.logs`,
      `resource:${file}:data.aws_ami.ubuntu`,
      `resource:${file}:module.vpc`,
    ]);
    expect(result.nodes.every((n) => n.type === 'resource')).toBe(true);
  });

  it('captures block type, resource type and module source', () => {
    expect(meta(result, `resource:${file}:aws_s3_bucket.logs`)['blockType']).toBe('resource');
    expect(meta(result, `resource:${file}:aws_s3_bucket.logs`)['resourceType']).toBe('aws_s3_bucket');
    expect(meta(result, `resource:${file}:data.aws_ami.ubuntu`)['blockType']).toBe('data');
    expect(meta(result, `resource:${file}:module.vpc`)['source']).toBe(
      'terraform-aws-modules/vpc/aws',
    );
  });

  it('reports the declaration line and skips comments and other blocks', () => {
    expect(byId(result, `resource:${file}:aws_s3_bucket.logs`).line).toBe(6);
    expect(ids(result)).not.toContain(`resource:${file}:terraform`);
  });

  it('emits contains edges only', () => {
    expect(result.edges.every((e) => e.type === 'contains')).toBe(true);
    expect(result.edges).toHaveLength(4);
  });

  it('returns empty for a .tf file with no blocks', () => {
    expect(extractArtifacts(file, '# nothing here\nvariable_placeholder = 1\n')).toEqual({
      nodes: [],
      edges: [],
    });
  });
});

// ─── SQL migrations ───────────────────────────────────────────────────────────

describe('SQL migrations', () => {
  const file = 'db/migrations/001_init.sql';

  it('emits a table node per CREATE TABLE with migrates and contains edges', () => {
    const sql = `-- create the core tables
CREATE TABLE users (
  id serial PRIMARY KEY,
  email text NOT NULL
);

CREATE TABLE IF NOT EXISTS orders (
  id serial PRIMARY KEY,
  user_id integer REFERENCES users(id)
);
CREATE INDEX idx_orders_user ON orders (user_id);
`;
    const r = extractArtifacts(file, sql);
    expect(ids(r)).toEqual([`table:${file}:orders`, `table:${file}:users`]);
    expect(r.nodes.every((n) => n.type === 'table')).toBe(true);
    expect(edgesOfType(r, 'migrates')).toEqual([
      `${fileNodeId(file)} -> table:${file}:orders`,
      `${fileNodeId(file)} -> table:${file}:users`,
    ]);
    expect(edgesOfType(r, 'contains')).toHaveLength(2);
    expect(meta(r, `table:${file}:orders`)['operations']).toEqual(['create_table', 'create_index']);
  });

  it('does NOT flag a purely additive migration as destructive', () => {
    const sql = `CREATE TABLE users (id serial);
ALTER TABLE users ADD COLUMN nickname text;
CREATE INDEX idx_users_nickname ON users (nickname);
`;
    const r = extractArtifacts(file, sql);
    expect(meta(r, `table:${file}:users`)['destructive']).toBeUndefined();
    expect(meta(r, `table:${file}:users`)['operations']).toEqual([
      'create_table',
      'add_column',
      'create_index',
    ]);
  });

  it('flags DROP TABLE as destructive and carries the statement', () => {
    const r = extractArtifacts(file, 'DROP TABLE legacy_sessions;\n');
    const m = meta(r, `table:${file}:legacy_sessions`);
    expect(m['destructive']).toBe(true);
    expect(m['operations']).toEqual(['drop_table']);
    expect(m['destructiveStatements']).toEqual(['DROP TABLE legacy_sessions']);
    expect(m['created']).toBe(false);
    // A table this file only destroys is not "contained" by it.
    expect(edgesOfType(r, 'contains')).toEqual([]);
    expect(edgesOfType(r, 'migrates')).toEqual([
      `${fileNodeId(file)} -> table:${file}:legacy_sessions`,
    ]);
  });

  it('flags DROP COLUMN as destructive', () => {
    const r = extractArtifacts(file, 'ALTER TABLE users DROP COLUMN legacy_email;\n');
    const m = meta(r, `table:${file}:users`);
    expect(m['destructive']).toBe(true);
    expect(m['operations']).toEqual(['drop_column']);
    expect(m['destructiveStatements']).toEqual(['ALTER TABLE users DROP COLUMN legacy_email']);
  });

  it('flags a bare ALTER ... DROP as destructive', () => {
    const r = extractArtifacts(file, 'ALTER TABLE orders DROP CONSTRAINT orders_user_fk;\n');
    const m = meta(r, `table:${file}:orders`);
    expect(m['destructive']).toBe(true);
    expect(m['operations']).toEqual(['alter_drop']);
  });

  it('flags TRUNCATE as destructive', () => {
    const r = extractArtifacts(file, 'TRUNCATE TABLE audit_log;\nTRUNCATE events;\n');
    expect(meta(r, `table:${file}:audit_log`)['destructive']).toBe(true);
    expect(meta(r, `table:${file}:events`)['destructive']).toBe(true);
    expect(meta(r, `table:${file}:events`)['operations']).toEqual(['truncate']);
  });

  it('separates destructive from non-destructive tables in one migration', () => {
    const sql = `CREATE TABLE profiles (id serial);
ALTER TABLE users DROP COLUMN bio;
`;
    const r = extractArtifacts(file, sql);
    expect(meta(r, `table:${file}:profiles`)['destructive']).toBeUndefined();
    expect(meta(r, `table:${file}:users`)['destructive']).toBe(true);
  });

  it('ignores DROP statements that only appear inside comments or strings', () => {
    const sql = `-- DROP TABLE users;
/* DROP TABLE orders; */
CREATE TABLE notes (body text DEFAULT 'DROP TABLE nope');
`;
    const r = extractArtifacts(file, sql);
    expect(ids(r)).toEqual([`table:${file}:notes`]);
    expect(meta(r, `table:${file}:notes`)['destructive']).toBeUndefined();
  });

  it('normalizes quoted and schema-qualified identifiers', () => {
    const r = extractArtifacts(file, 'CREATE TABLE "Public_Users" (id int);\nDROP TABLE public.old;\n');
    expect(ids(r)).toEqual([`table:${file}:public.old`, `table:${file}:public_users`]);
  });

  it('returns empty for a .sql file outside a migrations directory', () => {
    expect(extractArtifacts('db/seed.sql', 'CREATE TABLE users (id int);')).toEqual({
      nodes: [],
      edges: [],
    });
  });

  it('returns empty for a migration with no DDL', () => {
    expect(extractArtifacts(file, "INSERT INTO users VALUES (1, 'a');\n")).toEqual({
      nodes: [],
      edges: [],
    });
  });
});

// ─── OpenAPI ──────────────────────────────────────────────────────────────────

describe('OpenAPI', () => {
  const file = 'api/openapi.yaml';
  const result = extractArtifacts(file, OPENAPI_YAML);

  it('emits one endpoint node per path and method', () => {
    const endpoints = result.nodes.filter((n) => n.type === 'endpoint').map((n) => n.id);
    expect(endpoints).toEqual([
      `endpoint:${file}:DELETE /users/{id}`,
      `endpoint:${file}:GET /users`,
      `endpoint:${file}:GET /users/{id}`,
      `endpoint:${file}:POST /users`,
    ]);
  });

  it('captures operationId, summary, tags and api title', () => {
    const m = meta(result, `endpoint:${file}:GET /users`);
    expect(m['operationId']).toBe('listUsers');
    expect(m['summary']).toBe('List all users');
    expect(m['tags']).toEqual(['users']);
    expect(m['method']).toBe('GET');
    expect(m['path']).toBe('/users');
    expect(m['api']).toBe('Users API');
    expect(m['specVersion']).toBe('3.0.3');
  });

  it('emits contains and routes edges for endpoints', () => {
    expect(edgesOfType(result, 'routes')).toHaveLength(4);
    expect(edgesOfType(result, 'routes')[0]).toBe(
      `${fileNodeId(file)} -> endpoint:${file}:DELETE /users/{id}`,
    );
  });

  it('emits schema nodes with defines_schema edges', () => {
    expect(edgesOfType(result, 'defines_schema')).toEqual([
      `${fileNodeId(file)} -> schema:${file}:Error`,
      `${fileNodeId(file)} -> schema:${file}:User`,
    ]);
    expect(byId(result, `schema:${file}:User`).type).toBe('schema');
  });

  it('parses a JSON spec with the same node ids', () => {
    const json = JSON.stringify({
      openapi: '3.0.0',
      info: { title: 'Users API', version: '1' },
      paths: {
        '/users/{id}': { get: { operationId: 'getUser' } },
      },
      components: { schemas: { User: { type: 'object' } } },
    });
    const r = extractArtifacts('api/openapi.json', json);
    expect(ids(r)).toEqual([
      'endpoint:api/openapi.json:GET /users/{id}',
      'schema:api/openapi.json:User',
    ]);
    expect(meta(r, 'endpoint:api/openapi.json:GET /users/{id}')['operationId']).toBe('getUser');
  });

  it('recognizes a swagger 2.0 spec found by content sniffing', () => {
    const spec = `swagger: '2.0'
info:
  title: Legacy
paths:
  /ping:
    get:
      operationId: ping
definitions:
  Pong:
    type: object
`;
    const r = extractArtifacts('docs/spec.yaml', spec);
    expect(ids(r)).toEqual(['endpoint:docs/spec.yaml:GET /ping', 'schema:docs/spec.yaml:Pong']);
  });

  it('ignores non-method keys under a path', () => {
    const spec = `openapi: 3.0.0
paths:
  /users:
    parameters:
      - name: limit
    get:
      operationId: listUsers
`;
    const r = extractArtifacts('api/openapi.yaml', spec);
    expect(ids(r)).toEqual(['endpoint:api/openapi.yaml:GET /users']);
  });

  it('returns empty for malformed JSON rather than throwing', () => {
    expect(() => extractArtifacts('api/openapi.json', '{ nope')).not.toThrow();
    expect(extractArtifacts('api/openapi.json', '{ nope')).toEqual({ nodes: [], edges: [] });
  });
});

// ─── package.json ─────────────────────────────────────────────────────────────

describe('package.json', () => {
  const file = 'packages/api/package.json';
  const result = extractArtifacts(file, PACKAGE_JSON);

  it('emits a single config node labelled with the package name', () => {
    expect(ids(result)).toEqual([`config:${file}`]);
    expect(byId(result, `config:${file}`).type).toBe('config');
    expect(byId(result, `config:${file}`).label).toBe('@acme/api');
  });

  it('captures script keys and their commands', () => {
    const m = meta(result, `config:${file}`);
    expect(m['scripts']).toEqual(['build', 'lint', 'test']);
    expect(m['scriptCommands']).toEqual({
      build: 'tsup src/index.ts',
      lint: 'eslint .',
      test: 'vitest run',
    });
  });

  it('captures version, workspaces, packageManager and dependency names', () => {
    const m = meta(result, `config:${file}`);
    expect(m['version']).toBe('2.1.0');
    expect(m['workspaces']).toEqual(['packages/*']);
    expect(m['packageManager']).toBe('pnpm@9.0.0');
    expect(m['private']).toBe(true);
    expect(m['dependencies']).toEqual(['zod']);
    expect(m['devDependencies']).toEqual(['typescript', 'vitest']);
  });

  it('emits contains and configures edges', () => {
    expect(edgesOfType(result, 'contains')).toEqual([`${fileNodeId(file)} -> config:${file}`]);
    expect(edgesOfType(result, 'configures')).toEqual([`config:${file} -> ${fileNodeId(file)}`]);
  });

  it('handles a package.json with no scripts', () => {
    const r = extractArtifacts(file, '{"name":"x"}');
    expect(meta(r, `config:${file}`)['scripts']).toEqual([]);
  });

  it('returns empty for malformed JSON', () => {
    expect(extractArtifacts(file, '{"name": ')).toEqual({ nodes: [], edges: [] });
  });
});

// ─── cross-cutting guarantees ─────────────────────────────────────────────────

describe('extractArtifacts contract', () => {
  it('returns empty for files that are not artifacts', () => {
    expect(extractArtifacts('src/index.ts', 'export const a = 1;\n')).toEqual({
      nodes: [],
      edges: [],
    });
    expect(extractArtifacts('README.md', '# Hello\n')).toEqual({ nodes: [], edges: [] });
    expect(extractArtifacts('config.yaml', 'a: 1\nb: 2\n')).toEqual({ nodes: [], edges: [] });
  });

  it('returns empty for empty content', () => {
    expect(extractArtifacts('.github/workflows/ci.yml', '')).toEqual({ nodes: [], edges: [] });
  });

  it('never throws on random binary-ish garbage in any supported path', () => {
    const garbage = '\u0000\uFFFD{[}]:\n\t\t- - -\n%%%\n';
    for (const path of [
      '.github/workflows/ci.yml',
      'Dockerfile',
      'docker-compose.yml',
      'k8s/x.yaml',
      'infra/main.tf',
      'db/migrations/1.sql',
      'api/openapi.yaml',
      'package.json',
    ]) {
      expect(() => extractArtifacts(path, garbage)).not.toThrow();
    }
  });

  it('produces node ids sorted ascending and edges sorted by source/type/target', () => {
    const r = extractArtifacts('docker-compose.yml', COMPOSE);
    expect(ids(r)).toEqual([...ids(r)].sort());
    const keys = r.edges.map((e) => `${e.source}\u0000${e.type}\u0000${e.target}`);
    expect(keys).toEqual([...keys].sort());
  });

  it('is deterministic across repeated runs', () => {
    for (const [path, content] of [
      ['.github/workflows/ci.yml', WORKFLOW],
      ['Dockerfile', DOCKERFILE],
      ['docker-compose.yml', COMPOSE],
      ['k8s/api.yaml', K8S],
      ['infra/main.tf', TERRAFORM],
      ['api/openapi.yaml', OPENAPI_YAML],
      ['packages/api/package.json', PACKAGE_JSON],
    ] as const) {
      const a = extractArtifacts(path, content);
      const b = extractArtifacts(path, content);
      expect(JSON.stringify(a)).toBe(JSON.stringify(b));
      expect(a.nodes.length).toBeGreaterThan(0);
    }
  });

  it('emits no duplicate edges', () => {
    const r = extractArtifacts('k8s/api.yaml', K8S);
    const keys = r.edges.map((e) => `${e.source}|${e.type}|${e.target}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('every edge endpoint is either the owning file node or an emitted node', () => {
    for (const [path, content] of [
      ['.github/workflows/ci.yml', WORKFLOW],
      ['docker-compose.yml', COMPOSE],
      ['k8s/api.yaml', K8S],
      ['db/migrations/1.sql', 'CREATE TABLE a (id int);\nDROP TABLE b;'],
      ['api/openapi.yaml', OPENAPI_YAML],
    ] as const) {
      const r = extractArtifacts(path, content);
      const known = new Set([fileNodeId(path), ...ids(r)]);
      for (const e of r.edges) {
        expect(known.has(e.source)).toBe(true);
        expect(known.has(e.target)).toBe(true);
      }
    }
  });

  it('normalizes windows paths into node ids', () => {
    const r = extractArtifacts('.github\\workflows\\ci.yml', WORKFLOW);
    expect(ids(r)[0]).toBe('pipeline:.github/workflows/ci.yml:build');
    expect(r.nodes[0]?.file).toBe('.github/workflows/ci.yml');
  });

  it('records the owning file on every node', () => {
    const r = extractArtifacts('k8s/api.yaml', K8S);
    expect(r.nodes.every((n) => n.file === 'k8s/api.yaml')).toBe(true);
  });
});
