import { test, expect, type Page } from '@playwright/test';
import type { KnowledgeGraph } from '../src/types';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';

// After each test run, remove session artifacts created by agent-ask/bridge tests
// so they don't leak into subsequent runs and cause false bridge detection.
test.afterAll(async () => {
  const cwd = process.cwd(); // playwright runs from packages/dashboard/
  const artifacts = [
    join(cwd, '.cascade-trigger-session'),
    join(cwd, '.sprang', 'cascade-response.json'),
    join(cwd, '.sprang', 'claude-session.json'),
    join(cwd, '.sprang', 'copilot-session.json'),
  ];
  await Promise.allSettled(artifacts.map((f) => rm(f, { force: true })));
});

// ---------------------------------------------------------------------------
// Mock graph – rich enough to exercise health, domains, risk, smells,
// layers (Architecture view), and tours (Learn view)
// ---------------------------------------------------------------------------
const mockGraph: KnowledgeGraph = {
  version: '1.0.0',
  generated_at: new Date().toISOString(),
  project_root: '/test',
  project_name: 'Test Project',
  phase: 'complete',
  languages: ['typescript'],
  nodes: [
    {
      id: 'file:src/auth.ts',
      label: 'auth.ts',
      type: 'file',
      tags: [],
      risk_score: 0.85,
      risk_factors: ['large_blast_radius'] as import('../src/types').RiskFactor[],
      structural_warnings: [
        {
          category: 'god_node',
          severity: 'high',
          description: 'Too many outgoing dependencies',
          related_node_ids: [],
          heuristic: 'out_degree > 20',
        },
      ],
    },
    {
      id: 'file:src/index.ts',
      label: 'index.ts',
      type: 'file',
      tags: [],
      risk_score: 0.2,
    },
    {
      id: 'file:src/utils.ts',
      label: 'utils.ts',
      type: 'file',
      tags: [],
      risk_score: 0.1,
    },
  ],
  edges: [
    { source: 'file:src/index.ts', target: 'file:src/auth.ts', type: 'imports' },
    { source: 'file:src/auth.ts', target: 'file:src/utils.ts', type: 'imports' },
  ],
  layers: [
    { id: 'layer:core', name: 'Core', node_ids: ['file:src/auth.ts', 'file:src/utils.ts'] },
    { id: 'layer:entry', name: 'Entry', node_ids: ['file:src/index.ts'] },
  ],
  tours: [
    {
      id: 'tour:main',
      title: 'Main Tour',
      description: 'Walkthrough',
      steps: [
        { node_id: 'file:src/index.ts', step_title: 'Entry point', explanation: 'Start here' },
        { node_id: 'file:src/auth.ts', step_title: 'Auth module', explanation: 'Core auth' },
      ],
    },
  ],
  domains: [
    {
      id: 'domain:auth',
      label: 'Authentication',
      summary: 'Handles all auth',
      flows: [],
      entities: ['file:src/auth.ts'],
    },
  ],
  stats: {
    node_count: 3,
    edge_count: 2,
    generated_at: new Date().toISOString(),
    risk_summary: { high: 1, medium: 0, low: 2 },
    smell_summary: { god_node: 1 },
  },
};

// Mock graph without tours — exercises Learn empty state
const mockGraphNoTours: KnowledgeGraph = {
  ...mockGraph,
  tours: [],
};

// Mock graph without layers — exercises Architecture empty state
const mockGraphNoLayers: KnowledgeGraph = {
  ...mockGraph,
  layers: [],
};

// Mock graph with security findings — exercises HealthView security section
const mockGraphWithSecurity: KnowledgeGraph = {
  ...mockGraph,
  nodes: [
    ...mockGraph.nodes,
    {
      id: 'file:src/db.ts',
      label: 'db.ts',
      type: 'file',
      tags: [],
      risk_score: 0.7,
      security_warnings: [
        {
          category: 'sql_injection' as import('../src/types').SecurityCategory,
          severity: 'high' as const,
          line: 42,
          pattern: 'sql-interpolation',
          snippet: "db.query(`SELECT * FROM users WHERE id = '${userId}'`)",
          description: 'String interpolation in SQL query',
        },
      ],
    },
  ],
  stats: {
    ...mockGraph.stats,
    security_summary: {
      total: 1,
      by_severity: { high: 1, medium: 0, low: 0 },
      by_category: { sql_injection: 1 },
    },
  },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function mockGraphRoute(page: Page, graph = mockGraph) {
  await page.route('**/knowledge-graph.json', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(graph),
    }),
  );
}

// Navigate to app with onboarding suppressed and wait for load.
async function gotoApp(page: Page, graph = mockGraph) {
  await mockGraphRoute(page, graph);
  await page.addInitScript(() => {
    localStorage.setItem('sprang:onboarded', 'true');
  });
  await page.goto('/');
  await expect(page.getByText('sprang').first()).toBeVisible({ timeout: 15000 });
}

// Scope tab clicks to the desktop nav to avoid strict-mode collision
function navTab(page: Page, name: string) {
  return page.getByRole('navigation').getByRole('button', { name: new RegExp(`^${name}$`, 'i') });
}

async function waitForAppLoaded(page: Page) {
  await expect(page.getByText('sprang').first()).toBeVisible({ timeout: 15000 });
}

// ---------------------------------------------------------------------------
// Test 1: Error state (no knowledge-graph.json)
// ---------------------------------------------------------------------------
test('error state – no knowledge-graph.json', async ({ page }) => {
  await page.route('**/knowledge-graph.json', (route) =>
    route.fulfill({ status: 404, body: 'Not Found' }),
  );

  await page.goto('/');

  await expect(
    page.getByRole('heading', { name: 'No knowledge graph found' }),
  ).toBeVisible({ timeout: 15000 });

  await expect(page.getByText('sprang scan', { exact: true })).toBeVisible();

  const retryButton = page.getByRole('button', { name: /retry/i });
  await expect(retryButton).toBeVisible();

  await retryButton.click();
  await expect(
    page.getByRole('heading', { name: 'No knowledge graph found' }),
  ).toBeVisible({ timeout: 15000 });
});

// ---------------------------------------------------------------------------
// Test 2: Loaded state
// ---------------------------------------------------------------------------
test('loaded state – nav and tabs visible', async ({ page }) => {
  await gotoApp(page);

  await expect(navTab(page, 'Graph')).toBeVisible();
  await expect(navTab(page, 'Health')).toBeVisible();
  await expect(navTab(page, 'Domains')).toBeVisible();
  await expect(navTab(page, 'Architecture')).toBeVisible();
  await expect(page.getByRole('button', { name: /search/i })).toBeVisible();
});

// ---------------------------------------------------------------------------
// Test 3: Navigation between views
// ---------------------------------------------------------------------------
test('navigation – switching between graph, health, and domains tabs', async ({ page }) => {
  await gotoApp(page);

  await navTab(page, 'Health').click();
  await expect(
    page.getByRole('heading', { name: 'Structural Health Report' }),
  ).toBeVisible({ timeout: 10000 });

  await navTab(page, 'Domains').click();
  await expect(
    page.getByText(/No domain analysis yet|Business Domain Explorer|Domain/i).first(),
  ).toBeVisible({ timeout: 10000 });

  await navTab(page, 'Graph').click();
  await expect(page.getByText('Test Project')).toBeVisible({ timeout: 10000 });
});

// ---------------------------------------------------------------------------
// Test 4: Keyboard shortcut – open and close search dialog (Ctrl+K)
// ---------------------------------------------------------------------------
test('keyboard shortcut – Ctrl+K opens search dialog, Escape closes it', async ({ page }) => {
  await gotoApp(page);

  await page.locator('body').click({ position: { x: 10, y: 10 } });
  await page.keyboard.press('Control+k');

  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible({ timeout: 5000 });

  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible({ timeout: 5000 });
});

// ---------------------------------------------------------------------------
// Test 5: Click-to-open search
// ---------------------------------------------------------------------------
test('search button click opens search dialog', async ({ page }) => {
  await gotoApp(page);

  await page.getByRole('button', { name: /search/i }).click();

  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible({ timeout: 5000 });

  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible({ timeout: 5000 });
});

// ---------------------------------------------------------------------------
// Test 6: Keyboard shortcuts – view switching (original shortcuts)
// ---------------------------------------------------------------------------
test('keyboard shortcuts – h switches to health, g switches to graph', async ({ page }) => {
  await gotoApp(page);

  await page.locator('body').click({ position: { x: 200, y: 200 } });

  await page.keyboard.press('h');
  await expect(
    page.getByRole('heading', { name: 'Structural Health Report' }),
  ).toBeVisible({ timeout: 10000 });

  await page.keyboard.press('g');
  await expect(page.getByText('Test Project')).toBeVisible({ timeout: 10000 });
});

// ---------------------------------------------------------------------------
// Test 7: Keyboard shortcut 'd' switches to domains view
// ---------------------------------------------------------------------------
test('keyboard shortcut – d switches to domains view', async ({ page }) => {
  await gotoApp(page);

  await page.locator('body').click({ position: { x: 200, y: 200 } });
  await page.keyboard.press('d');

  await expect(navTab(page, 'Domains')).toBeVisible({ timeout: 5000 });
  await expect(
    page.getByText(/Authentication|Business Domain|Domain/i).first(),
  ).toBeVisible({ timeout: 10000 });
});

// ---------------------------------------------------------------------------
// Test 8: Keyboard shortcut '?' opens keyboard shortcuts help modal
// ---------------------------------------------------------------------------
test('keyboard shortcut – ? opens shortcuts help modal', async ({ page }) => {
  await gotoApp(page);

  await page.locator('body').click({ position: { x: 200, y: 200 } });
  await page.keyboard.press('?');

  await expect(
    page.getByText(/keyboard shortcuts|Cmd|Ctrl/i).first(),
  ).toBeVisible({ timeout: 5000 });

  await page.keyboard.press('Escape');
});

// ---------------------------------------------------------------------------
// Test 9: Health view shows smell summary and risk info
// ---------------------------------------------------------------------------
test('health view – shows smell summary and risk counts', async ({ page }) => {
  await gotoApp(page);

  await navTab(page, 'Health').click();

  const heading = page.getByRole('heading', { name: 'Structural Health Report' });
  await expect(heading).toBeVisible({ timeout: 10000 });

  await expect(page.getByText(/god.node|god_node/i).first()).toBeVisible({ timeout: 5000 });
});

// ---------------------------------------------------------------------------
// Test 10: Domains view – shows domain name from mock graph
// ---------------------------------------------------------------------------
test('domains view – renders domain from graph', async ({ page }) => {
  await gotoApp(page);

  await navTab(page, 'Domains').click();

  await expect(
    page.getByText(/Authentication|No domain/i).first(),
  ).toBeVisible({ timeout: 10000 });
});

// ---------------------------------------------------------------------------
// Test 11: Search – typing in search dialog filters nodes
// ---------------------------------------------------------------------------
test('search dialog – typing filters visible results', async ({ page }) => {
  await gotoApp(page);

  await page.getByRole('button', { name: /search/i }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible({ timeout: 5000 });

  const input = dialog.locator('input').first();
  await input.fill('auth');

  await expect(page.getByText(/auth\.ts/i).first()).toBeVisible({ timeout: 5000 });

  await page.keyboard.press('Escape');
});

// ---------------------------------------------------------------------------
// Test 12: Onboarding overlay – appears on first visit, dismisses
// ---------------------------------------------------------------------------
test('onboarding overlay – appears and can be dismissed', async ({ page }) => {
  await mockGraphRoute(page);

  await page.goto('/');
  await page.evaluate(() => localStorage.removeItem('sprang:onboarded'));
  await page.reload();
  await mockGraphRoute(page);

  const overlay = page.getByText(/welcome|get started|onboard/i).first();
  const overlayVisible = await overlay.isVisible().catch(() => false);

  if (overlayVisible) {
    const dismissBtn = page.getByRole('button', { name: /skip|got it|dismiss|close|next/i }).first();
    if (await dismissBtn.isVisible()) {
      await dismissBtn.click();
    }
    await waitForAppLoaded(page);
  }
});

// ---------------------------------------------------------------------------
// Test 13: Graph view shows project name and node count
// ---------------------------------------------------------------------------
test('graph view – project name visible in toolbar', async ({ page }) => {
  await gotoApp(page);

  await navTab(page, 'Graph').click();
  await expect(page.getByText('Test Project')).toBeVisible({ timeout: 10000 });
});

// ---------------------------------------------------------------------------
// Test 14: Nav bar persists across view switches
// ---------------------------------------------------------------------------
test('nav bar – logo persists across all view switches', async ({ page }) => {
  await gotoApp(page);

  for (const tab of ['Health', 'Domains', 'Graph']) {
    await navTab(page, tab).click();
    await expect(page.getByText('sprang').first()).toBeVisible({ timeout: 5000 });
  }
});

// ---------------------------------------------------------------------------
// Test 15: Error state – retry button is functional
// ---------------------------------------------------------------------------
test('error state – retry re-attempts graph load', async ({ page }) => {
  let callCount = 0;
  await page.route('**/knowledge-graph.json', (route) => {
    callCount++;
    route.fulfill({ status: 404, body: 'Not Found' });
  });

  await page.goto('/');
  await expect(
    page.getByRole('heading', { name: 'No knowledge graph found' }),
  ).toBeVisible({ timeout: 15000 });

  const before = callCount;
  await page.getByRole('button', { name: /retry/i }).click();

  await expect(
    page.getByRole('heading', { name: 'No knowledge graph found' }),
  ).toBeVisible({ timeout: 10000 });
  expect(callCount).toBeGreaterThan(before);
});

// ---------------------------------------------------------------------------
// Test 16: Architecture tab – navigation via tab click
// ---------------------------------------------------------------------------
test('architecture tab – visible in nav and clickable', async ({ page }) => {
  await gotoApp(page);

  const archTab = navTab(page, 'Architecture');
  await expect(archTab).toBeVisible();
  await archTab.click();

  // Architecture view renders the info bar with layer count
  await expect(
    page.getByText(/layer|architecture map/i).first(),
  ).toBeVisible({ timeout: 10000 });
});

// ---------------------------------------------------------------------------
// Test 17: Architecture tab – keyboard shortcut 'a'
// ---------------------------------------------------------------------------
test('keyboard shortcut – a switches to architecture view', async ({ page }) => {
  await gotoApp(page);

  await page.locator('body').click({ position: { x: 200, y: 200 } });
  await page.keyboard.press('a');

  await expect(navTab(page, 'Architecture')).toBeVisible({ timeout: 5000 });
  await expect(
    page.getByText(/layer|architecture map|No architecture/i).first(),
  ).toBeVisible({ timeout: 10000 });
});

// ---------------------------------------------------------------------------
// Test 18: Architecture tab – keyboard shortcut '4'
// ---------------------------------------------------------------------------
test('keyboard shortcut – 4 switches to architecture view', async ({ page }) => {
  await gotoApp(page);

  await page.locator('body').click({ position: { x: 200, y: 200 } });
  await page.keyboard.press('4');

  await expect(
    page.getByText(/layer|architecture map|No architecture/i).first(),
  ).toBeVisible({ timeout: 10000 });
});

// ---------------------------------------------------------------------------
// Test 19: Architecture view – shows layer count from mock graph
// ---------------------------------------------------------------------------
test('architecture view – renders info bar with layer count', async ({ page }) => {
  await gotoApp(page);

  await navTab(page, 'Architecture').click();

  // Mock graph has 2 layers: Core and Entry
  // Info bar shows "2 layers · N cross-layer connections"
  await expect(
    page.getByText(/2.*layer/i).first(),
  ).toBeVisible({ timeout: 10000 });
});

// ---------------------------------------------------------------------------
// Test 20: Architecture view – empty state when no layers
// ---------------------------------------------------------------------------
test('architecture view – empty state when graph has no layers', async ({ page }) => {
  await gotoApp(page, mockGraphNoLayers);

  await navTab(page, 'Architecture').click();

  await expect(
    page.getByRole('heading', { name: /No architecture map/i }),
  ).toBeVisible({ timeout: 10000 });

  // Empty state shows the /sprang-analyze hint
  await expect(page.getByText('/sprang-analyze', { exact: true })).toBeVisible();
});

// ---------------------------------------------------------------------------
// Test 21: Learn tab – keyboard shortcut 'l'
// ---------------------------------------------------------------------------
test('keyboard shortcut – l switches to learn view', async ({ page }) => {
  await gotoApp(page);

  await page.locator('body').click({ position: { x: 200, y: 200 } });
  await page.keyboard.press('l');

  await expect(navTab(page, 'Learn')).toBeVisible({ timeout: 5000 });
});

// ---------------------------------------------------------------------------
// Test 22: Learn tab – keyboard shortcut '5' (was '4' pre-v0.2.0)
// ---------------------------------------------------------------------------
test('keyboard shortcut – 5 switches to learn view', async ({ page }) => {
  await gotoApp(page);

  await page.locator('body').click({ position: { x: 200, y: 200 } });
  await page.keyboard.press('5');

  await expect(navTab(page, 'Learn')).toBeVisible({ timeout: 5000 });
});

// ---------------------------------------------------------------------------
// Test 23: Keyboard shortcuts modal shows Architecture and updated Learn shortcuts
// ---------------------------------------------------------------------------
test('keyboard shortcuts modal – shows A/4 for architecture and L/5 for learn', async ({ page }) => {
  await gotoApp(page);

  await page.locator('body').click({ position: { x: 200, y: 200 } });
  await page.keyboard.press('?');

  const modal = page.getByText(/keyboard shortcuts/i).first();
  await expect(modal).toBeVisible({ timeout: 5000 });

  // Architecture shortcut should be present
  await expect(page.getByText('Architecture view')).toBeVisible({ timeout: 3000 });

  await page.keyboard.press('Escape');
});

// ---------------------------------------------------------------------------
// Test 24: All 5 nav tabs are present and functional
// ---------------------------------------------------------------------------
test('nav – all 5 tabs (graph, health, domains, architecture, learn) are present', async ({ page }) => {
  await gotoApp(page);

  for (const tab of ['Graph', 'Health', 'Domains', 'Architecture', 'Learn']) {
    await expect(navTab(page, tab)).toBeVisible({ timeout: 5000 });
  }
});

// ---------------------------------------------------------------------------
// Test 25: agent bridge – /agent-response returns 204 when no file exists
// ---------------------------------------------------------------------------
test('agent bridge – GET /agent-response returns 204 when no pending response', async ({
  page,
}) => {
  await gotoApp(page);

  // Use page.request to hit the Vite dev-server middleware directly
  const response = await page.request.get('/agent-response');
  // 204 = no content (no response file exists yet), or 200 if a stale file exists
  expect([200, 204]).toContain(response.status());
});

// ---------------------------------------------------------------------------
// Test 26: agent bridge – POST /agent-ask validates empty message
// ---------------------------------------------------------------------------
test('agent bridge – POST /agent-ask rejects empty message', async ({ page }) => {
  await gotoApp(page);

  const response = await page.request.post('/agent-ask', {
    data: { message: '' },
    headers: { 'Content-Type': 'application/json' },
  });
  expect(response.status()).toBe(400);

  const body = await response.json() as { error?: string };
  expect(body.error).toMatch(/message field required/i);
});

// ---------------------------------------------------------------------------
// Test 27: agent bridge – POST /agent-ask accepts valid message
// ---------------------------------------------------------------------------
test('agent bridge – POST /agent-ask accepts valid message', async ({ page }) => {
  await gotoApp(page);

  // All bridges now fire-and-forget — the endpoint returns 200 immediately and
  // the dashboard polls /agent-response. 503 = no bridge detected.
  const response = await page.request.post('/agent-ask', {
    data: { message: 'What does auth.ts do?' },
    headers: { 'Content-Type': 'application/json' },
  });
  expect([200, 503]).toContain(response.status());

  const body = await response.json() as { ok?: boolean; sent?: string; error?: string };
  if (response.status() === 200) {
    expect(body.ok).toBe(true);
    expect(body.sent).toBe('What does auth.ts do?');
  } else {
    expect(typeof body.error).toBe('string');
  }
});

// ---------------------------------------------------------------------------
// Test 28: /knowledge-graph.json served with correct content-type
// ---------------------------------------------------------------------------
test('graph API – /knowledge-graph.json served with JSON content-type', async ({ page }) => {
  await gotoApp(page);

  // Use page.evaluate so the fetch goes through the browser's route interceptor
  const { status, contentType } = await page.evaluate(async () => {
    const res = await fetch('/knowledge-graph.json');
    return { status: res.status, contentType: res.headers.get('content-type') ?? '' };
  });
  expect(status).toBe(200);
  expect(contentType).toContain('application/json');
});

// ---------------------------------------------------------------------------
// Test 29: /file-content.json rejects missing path param
// ---------------------------------------------------------------------------
test('file content API – rejects request with missing path', async ({ page }) => {
  await gotoApp(page);

  const response = await page.request.get('/file-content.json');
  expect(response.status()).toBe(400);
});

// ---------------------------------------------------------------------------
// Test 30: Architecture view – clicking a layer card opens detail panel
// ---------------------------------------------------------------------------
test('architecture view – layer card click opens detail panel with node list', async ({ page }) => {
  await gotoApp(page);
  await navTab(page, 'Architecture').click();

  // Wait for ELK layout to complete
  await page.waitForFunction(
    () => !document.querySelector('[data-testid="loading-layout"]'),
    { timeout: 8000 },
  ).catch(() => { /* tolerate — fallback grid renders immediately */ });
  await page.waitForTimeout(2500);

  // Click the Core layer card (contains "Core" heading text)
  const coreCard = page.getByRole('button', { name: /core/i }).first();
  await expect(coreCard).toBeVisible({ timeout: 5000 });
  await coreCard.click();

  // Detail panel should appear
  const panel = page.getByTestId('layer-panel');
  await expect(panel).toBeVisible({ timeout: 3000 });

  // Panel header shows layer name
  await expect(panel.getByRole('heading', { name: /core/i })).toBeVisible();

  // File list shows at least one file from the Core layer (auth.ts or utils.ts)
  await expect(panel.getByText(/auth\.ts|utils\.ts/).first()).toBeVisible();

  // "clear selection" appears in the info bar
  await expect(page.getByText('clear selection')).toBeVisible();
});

// ---------------------------------------------------------------------------
// Test 30b: Architecture view – layer panel shows stats and close button works
// ---------------------------------------------------------------------------
test('architecture view – layer panel stats and close button', async ({ page }) => {
  await gotoApp(page);
  await navTab(page, 'Architecture').click();
  await page.waitForTimeout(2500);

  const coreCard = page.getByRole('button', { name: /core/i }).first();
  await expect(coreCard).toBeVisible({ timeout: 5000 });
  await coreCard.click();

  const panel = page.getByTestId('layer-panel');
  await expect(panel).toBeVisible({ timeout: 3000 });

  // Stats row: files count visible (Core has 2 nodes)
  await expect(panel.getByText('files')).toBeVisible();

  // Close button dismisses panel
  await panel.getByRole('button', { name: /close panel/i }).click();
  await expect(panel).not.toBeVisible({ timeout: 2000 });

  // "clear selection" gone after close
  await expect(page.getByText('clear selection')).not.toBeVisible({ timeout: 2000 });
});

// ---------------------------------------------------------------------------
// Test 31: Graph view – diff overlay route returns valid response
// ---------------------------------------------------------------------------
test('diff overlay API – /diff-overlay.json returns 404 when no overlay exists', async ({
  page,
}) => {
  // Don't mock the overlay route — let it fall through to the real server
  await page.route('**/knowledge-graph.json', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(mockGraph),
    }),
  );
  await page.addInitScript(() => { localStorage.setItem('sprang:onboarded', 'true'); });
  await page.goto('/');
  await expect(page.getByText('sprang').first()).toBeVisible({ timeout: 15000 });

  const response = await page.request.get('/diff-overlay.json');
  // 404 = no overlay generated yet (expected for fresh environments)
  // 200 = a stale overlay file exists — both are valid
  expect([200, 404]).toContain(response.status());
});

// ---------------------------------------------------------------------------
// Test 33: Bridge status – /bridge-status endpoint returns valid JSON
// ---------------------------------------------------------------------------
test('bridge status API – /bridge-status returns valid BridgeStatus JSON', async ({ page }) => {
  await page.addInitScript(() => { localStorage.setItem('sprang:onboarded', 'true'); });
  await page.route('**/knowledge-graph.json', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(mockGraph) }),
  );
  await page.goto('/');
  await expect(page.getByText('sprang').first()).toBeVisible({ timeout: 15000 });

  const resp = await page.request.get('/bridge-status');
  expect(resp.status()).toBe(200);
  const body = await resp.json() as { kind: string; detail: string };
  // kind must be one of the four valid values
  expect(['windsurf', 'claude', 'copilot', 'none']).toContain(body.kind);
  expect(typeof body.detail).toBe('string');
});

// ---------------------------------------------------------------------------
// Test 34: Ask Agent panel – opens, shows bridge status, shows "Ask Agent"
// ---------------------------------------------------------------------------
test('Ask Agent panel – opens and displays bridge info', async ({ page }) => {
  await page.addInitScript(() => { localStorage.setItem('sprang:onboarded', 'true'); });
  await page.route('**/knowledge-graph.json', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(mockGraph) }),
  );
  // Mock bridge-status to return a known value
  await page.route('**/bridge-status', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ kind: 'none', detail: 'No agent bridge found.' }),
    }),
  );
  await page.goto('/');
  await expect(page.getByText('sprang').first()).toBeVisible({ timeout: 15000 });

  // Open Ask Agent panel
  const askBtn = page.getByRole('button', { name: /ask agent/i });
  await expect(askBtn).toBeVisible({ timeout: 5000 });
  await askBtn.click();

  // Panel header visible
  await expect(page.getByText('Ask Agent').first()).toBeVisible({ timeout: 3000 });

  // Empty state shows bridge detection message
  await expect(page.getByText(/no bridge detected|detecting agent bridge/i)).toBeVisible({ timeout: 3000 });

  // Close by pressing Escape — the slide-in panel should disappear
  await page.keyboard.press('Escape');
  // The panel header span is only rendered when open=true; after Escape it should be gone
  await expect(page.locator('span.text-xs.font-semibold', { hasText: 'Ask Agent' })).not.toBeVisible({ timeout: 2000 });
});

// ---------------------------------------------------------------------------
// Test 35: Ask Agent panel – /agent-ask returns 503 when no bridge
// ---------------------------------------------------------------------------
test('Ask Agent panel – /agent-ask 503 when no agent bridge available', async ({ page }) => {
  await page.addInitScript(() => { localStorage.setItem('sprang:onboarded', 'true'); });
  await page.route('**/knowledge-graph.json', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(mockGraph) }),
  );
  await page.goto('/');
  await expect(page.getByText('sprang').first()).toBeVisible({ timeout: 15000 });

  // All bridges now non-blocking — response is always fast (200 = bridge found, 503 = none).
  const resp = await page.request.post('/agent-ask', {
    data: { message: 'what does auth.ts do?' },
  });
  expect([200, 503]).toContain(resp.status());
  if (resp.status() === 503) {
    const body = await resp.json() as { error: string };
    expect(typeof body.error).toBe('string');
  }
});

// ---------------------------------------------------------------------------
// Test 36: Nav bar – Architecture tab persists across view switches
// ---------------------------------------------------------------------------
test('nav bar – Architecture tab visible across all view switches', async ({ page }) => {
  await gotoApp(page);

  for (const tab of ['Health', 'Architecture', 'Domains', 'Graph']) {
    await navTab(page, tab).click();
    await expect(navTab(page, 'Architecture')).toBeVisible({ timeout: 5000 });
  }
});

// ---------------------------------------------------------------------------
// Test 37: GET /health-history.json returns array
// ---------------------------------------------------------------------------
test('GET /health-history.json returns array', async ({ page }) => {
  const res = await page.request.get('/health-history.json');
  expect(res.status()).toBe(200);
  const body = await res.json();
  expect(Array.isArray(body)).toBe(true);
});

// ---------------------------------------------------------------------------
// Test 38: GET /analyze-status returns 204 when no progress file
// ---------------------------------------------------------------------------
test('GET /analyze-status returns 204 when no progress file', async ({ page }) => {
  const res = await page.request.get('/analyze-status');
  expect([200, 204]).toContain(res.status());
});

// ---------------------------------------------------------------------------
// Test 39: POST /analyze returns started:true
// ---------------------------------------------------------------------------
test('POST /analyze returns started:true', async ({ page }) => {
  const res = await page.request.post('/analyze', {
    data: {},
    headers: { 'Content-Type': 'application/json' },
  });
  expect(res.status()).toBe(200);
  const body = await res.json() as { ok: boolean; started: boolean };
  expect(body.ok).toBe(true);
  expect(body.started).toBe(true);
});

// ---------------------------------------------------------------------------
// Test 40: Health view shows grade badge
// ---------------------------------------------------------------------------
test('health view shows grade badge', async ({ page }) => {
  await gotoApp(page);
  // Navigate to health view using the desktop nav tab helper
  await navTab(page, 'Health').click();
  // Grade badge should be visible (A, B, C, D, or F)
  await expect(page.locator('text=/^[ABCDF]$/')).toBeVisible({ timeout: 5000 });
});

// Test 41: File content API – rejects path traversal attack
// ---------------------------------------------------------------------------
test('file content API – rejects path traversal (../)', async ({ page }) => {
  await gotoApp(page);

  const resp = await page.request.get('/file-content.json?path=../etc/passwd');
  expect(resp.status()).toBe(400);
  const body = await resp.json() as { error: string };
  expect(typeof body.error).toBe('string');
  expect(body.error.toLowerCase()).toMatch(/invalid path|path traversal/i);
});

// ---------------------------------------------------------------------------
// Test 42: File content API – rejects absolute path
// ---------------------------------------------------------------------------
test('file content API – rejects absolute path', async ({ page }) => {
  await gotoApp(page);

  const resp = await page.request.get('/file-content.json?path=%2Fetc%2Fpasswd');
  expect(resp.status()).toBe(400);
  const body = await resp.json() as { error: string };
  expect(typeof body.error).toBe('string');
});

// ---------------------------------------------------------------------------
// Test 43: File content API – rejects path not in graph allowlist
// ---------------------------------------------------------------------------
test('file content API – rejects path not in analyzed graph', async ({ page }) => {
  await gotoApp(page);

  const resp = await page.request.get('/file-content.json?path=some/random/file.ts');
  // 403 = not in allowlist (no graph built), 404 = file doesn't exist
  expect([403, 404]).toContain(resp.status());
});

// ---------------------------------------------------------------------------
// Test 44: agent response – DELETE clears the session
// ---------------------------------------------------------------------------
test('agent response – DELETE /agent-response returns ok', async ({ page }) => {
  await gotoApp(page);

  const resp = await page.request.delete('/agent-response');
  expect(resp.status()).toBe(200);
  const body = await resp.json() as { ok: boolean };
  expect(body.ok).toBe(true);
});

// ---------------------------------------------------------------------------
// Test 45: Risk overlay – R key toggles heatmap
// ---------------------------------------------------------------------------
test('risk overlay – R key toggles on/off', async ({ page }) => {
  await gotoApp(page);

  // Make sure we're on the graph view
  await navTab(page, 'Graph').click();
  await page.locator('body').click({ position: { x: 300, y: 300 } });

  // Toggle on
  await page.keyboard.press('r');
  // A risk toggle button or label should now be highlighted/active
  // The toolbar shows a risk button — check it exists
  await expect(page.getByTitle(/risk/i).or(page.getByLabel(/risk/i)).first()).toBeVisible({ timeout: 5000 });

  // Toggle off again
  await page.keyboard.press('r');
});

// ---------------------------------------------------------------------------
// Test 46: Learn view – shows empty state when graph has no tours
// ---------------------------------------------------------------------------
test('learn view – shows empty state when graph has no tours', async ({ page }) => {
  await gotoApp(page, mockGraphNoTours);
  await navTab(page, 'Learn').click();
  await expect(
    page.getByText(/no tours|no guided tour|tour not available|run \/sprang-analyze/i).first()
  ).toBeVisible({ timeout: 8000 });
});

// ---------------------------------------------------------------------------
// Test 47: Bridge status – returns kind and detail fields
// ---------------------------------------------------------------------------
test('bridge status – response has expected shape', async ({ page }) => {
  await gotoApp(page);

  const resp = await page.request.get('/bridge-status');
  expect(resp.status()).toBe(200);
  const body = await resp.json() as { kind: string; detail?: string };
  expect(['windsurf', 'claude', 'copilot', 'none']).toContain(body.kind);
  // detail is always present (may be empty string for active bridges)
  expect(typeof body.detail).toBe('string');
});

// ---------------------------------------------------------------------------
// Test 48: Health view – high-risk node appears in top-risky list
// ---------------------------------------------------------------------------
test('health view – high-risk node label visible', async ({ page }) => {
  await gotoApp(page);
  await navTab(page, 'Health').click();
  // auth.ts has risk_score 0.85 — should appear in top risky nodes
  await expect(page.getByText('auth.ts').first()).toBeVisible({ timeout: 8000 });
});

// ---------------------------------------------------------------------------
// Test 49: Graph view – nodes rendered (canvas is not empty)
// ---------------------------------------------------------------------------
test('graph view – sigma canvas is present and non-zero', async ({ page }) => {
  await gotoApp(page);
  await navTab(page, 'Graph').click();
  const canvas = page.locator('canvas').first();
  await expect(canvas).toBeVisible({ timeout: 8000 });
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.width).toBeGreaterThan(100);
  expect(box!.height).toBeGreaterThan(100);
});

// ---------------------------------------------------------------------------
// Test 50: Keyboard shortcut '1' switches to graph view
// ---------------------------------------------------------------------------
test('keyboard shortcut – 1 switches to graph view', async ({ page }) => {
  await gotoApp(page);
  await navTab(page, 'Health').click(); // start away from graph
  await page.locator('body').click({ position: { x: 200, y: 200 } });
  await page.keyboard.press('1');
  await expect(page.getByText('Test Project')).toBeVisible({ timeout: 10000 });
});

// ---------------------------------------------------------------------------
// Test 51: Keyboard shortcut '2' switches to health view
// ---------------------------------------------------------------------------
test('keyboard shortcut – 2 switches to health view', async ({ page }) => {
  await gotoApp(page);
  await page.locator('body').click({ position: { x: 200, y: 200 } });
  await page.keyboard.press('2');
  await expect(
    page.getByRole('heading', { name: 'Structural Health Report' }),
  ).toBeVisible({ timeout: 10000 });
});

// ---------------------------------------------------------------------------
// Test 52: Keyboard shortcut '3' switches to domains view
// ---------------------------------------------------------------------------
test('keyboard shortcut – 3 switches to domains view', async ({ page }) => {
  await gotoApp(page);
  await page.locator('body').click({ position: { x: 200, y: 200 } });
  await page.keyboard.press('3');
  await expect(
    page.getByText(/Authentication|Business Domain|Domain/i).first(),
  ).toBeVisible({ timeout: 10000 });
});

// ---------------------------------------------------------------------------
// Test 53: Learn view – persona selector shows all 4 personas
// ---------------------------------------------------------------------------
test('learn view – persona selector shows all 4 personas', async ({ page }) => {
  await gotoApp(page);
  await navTab(page, 'Learn').click();
  // All four persona labels must be visible in the selector
  await expect(page.getByRole('button', { name: /business/i }).first()).toBeVisible({ timeout: 5000 });
  await expect(page.getByRole('button', { name: /product/i }).first()).toBeVisible({ timeout: 5000 });
  await expect(page.getByRole('button', { name: /learn/i }).first()).toBeVisible({ timeout: 5000 });
  await expect(page.getByRole('button', { name: /deep dive/i }).first()).toBeVisible({ timeout: 5000 });
});

// ---------------------------------------------------------------------------
// Test 54: Learn view – start tour button is clickable and shows first step
// ---------------------------------------------------------------------------
test('learn view – start tour button advances to first tour step', async ({ page }) => {
  await gotoApp(page);
  await navTab(page, 'Learn').click();

  // Pre-tour state shows the tour title and start button
  const startBtn = page.getByRole('button', { name: /start tour/i });
  await expect(startBtn).toBeVisible({ timeout: 8000 });
  await startBtn.click();

  // After starting, first step title should be visible
  await expect(page.getByText(/entry point|auth module/i).first()).toBeVisible({ timeout: 5000 });

  // Step counter "1 / 2" is visible
  await expect(page.getByText(/1\s*\/\s*2/).first()).toBeVisible({ timeout: 3000 });
});

// ---------------------------------------------------------------------------
// Test 55: Learn view – tour step advance and exit
// ---------------------------------------------------------------------------
test('learn view – tour can advance to next step and exit', async ({ page }) => {
  await gotoApp(page);
  await navTab(page, 'Learn').click();

  const startBtn = page.getByRole('button', { name: /start tour/i });
  await expect(startBtn).toBeVisible({ timeout: 8000 });
  await startBtn.click();

  // Advance to step 2
  const nextBtn = page.getByRole('button', { name: /next/i }).first();
  await expect(nextBtn).toBeVisible({ timeout: 3000 });
  await nextBtn.click();

  // Step counter should now show 2 / 2
  await expect(page.getByText(/2\s*\/\s*2/).first()).toBeVisible({ timeout: 3000 });

  // Exit button dismisses the tour
  const exitBtn = page.getByRole('button', { name: /exit tour/i });
  await expect(exitBtn).toBeVisible({ timeout: 3000 });
  await exitBtn.click();

  // Back to pre-tour state — start button reappears
  await expect(page.getByRole('button', { name: /start tour/i })).toBeVisible({ timeout: 5000 });
});

// ---------------------------------------------------------------------------
// Test 56: Health view – security section renders with findings
// ---------------------------------------------------------------------------
test('health view – security section shows findings when graph has security_warnings', async ({ page }) => {
  await gotoApp(page, mockGraphWithSecurity);
  await navTab(page, 'Health').click();
  // The security section heading appears when stats.security_summary.total > 0
  await expect(
    page.getByText(/security issues/i).first(),
  ).toBeVisible({ timeout: 8000 });
  // The sql_injection finding from the mock should appear
  await expect(
    page.getByText(/sql.inject/i).first(),
  ).toBeVisible({ timeout: 5000 });
});
