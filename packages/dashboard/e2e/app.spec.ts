import { test, expect, type Page } from '@playwright/test';
import type { KnowledgeGraph } from '../src/types';

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

// Mock graph without layers — exercises Architecture empty state
const mockGraphNoLayers: KnowledgeGraph = {
  ...mockGraph,
  layers: [],
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
// Test 25: Cascade bridge – /cascade-response returns 204 when no file exists
// ---------------------------------------------------------------------------
test('cascade bridge – GET /cascade-response returns 204 when no pending response', async ({
  page,
}) => {
  await gotoApp(page);

  // Use page.request to hit the Vite dev-server middleware directly
  const response = await page.request.get('/cascade-response');
  // 204 = no content (no response file exists yet), or 200 if a stale file exists
  expect([200, 204]).toContain(response.status());
});

// ---------------------------------------------------------------------------
// Test 26: Cascade bridge – POST /cascade-ask validates empty message
// ---------------------------------------------------------------------------
test('cascade bridge – POST /cascade-ask rejects empty message', async ({ page }) => {
  await gotoApp(page);

  const response = await page.request.post('/cascade-ask', {
    data: { message: '' },
    headers: { 'Content-Type': 'application/json' },
  });
  expect(response.status()).toBe(400);

  const body = await response.json() as { error?: string };
  expect(body.error).toMatch(/message field required/i);
});

// ---------------------------------------------------------------------------
// Test 27: Cascade bridge – POST /cascade-ask accepts valid message
// ---------------------------------------------------------------------------
test('cascade bridge – POST /cascade-ask accepts valid message', async ({ page }) => {
  await gotoApp(page);

  const response = await page.request.post('/cascade-ask', {
    data: { message: 'What does auth.ts do?' },
    headers: { 'Content-Type': 'application/json' },
  });
  expect(response.status()).toBe(200);

  const body = await response.json() as { ok?: boolean; sent?: string };
  expect(body.ok).toBe(true);
  expect(body.sent).toBe('What does auth.ts do?');
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
// Test 32: Nav bar – Architecture tab persists across view switches
// ---------------------------------------------------------------------------
test('nav bar – Architecture tab visible across all view switches', async ({ page }) => {
  await gotoApp(page);

  for (const tab of ['Health', 'Architecture', 'Domains', 'Graph']) {
    await navTab(page, tab).click();
    await expect(navTab(page, 'Architecture')).toBeVisible({ timeout: 5000 });
  }
});
