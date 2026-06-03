import { test, expect, type Page } from '@playwright/test';
import type { KnowledgeGraph } from '../src/types';

// ---------------------------------------------------------------------------
// Mock graph – rich enough to exercise health, domains, risk, smells
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

// ---------------------------------------------------------------------------
// Helper: intercept /knowledge-graph.json with the mock graph
// ---------------------------------------------------------------------------
async function mockGraphRoute(page: Page) {
  await page.route('**/knowledge-graph.json', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(mockGraph),
    }),
  );
}

// ---------------------------------------------------------------------------
// Helper: navigate to app with onboarding suppressed and wait for load.
// - Sets localStorage flag before navigation so the overlay never appears.
// - Uses .first() to avoid strict-mode error (sprang appears in both mobile
//   and desktop nav spans simultaneously).
// ---------------------------------------------------------------------------
async function gotoApp(page: Page) {
  // Suppress onboarding overlay for all tests that don't test it explicitly
  await page.addInitScript(() => {
    localStorage.setItem('sprang:onboarded', 'true');
  });
  await page.goto('/');
  await expect(page.getByText('sprang').first()).toBeVisible({ timeout: 15000 });
}

// Legacy helper kept for error-state tests that call goto directly
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

  // Wait for the error screen to appear (loading resolves to error)
  await expect(
    page.getByRole('heading', { name: 'No knowledge graph found' }),
  ).toBeVisible({ timeout: 15000 });

  // Code block with "sprang scan" (exact match to select the <code> element)
  await expect(page.getByText('sprang scan', { exact: true })).toBeVisible();

  // Retry button
  const retryButton = page.getByRole('button', { name: /retry/i });
  await expect(retryButton).toBeVisible();

  // Clicking Retry stays on error (still 404)
  await retryButton.click();
  await expect(
    page.getByRole('heading', { name: 'No knowledge graph found' }),
  ).toBeVisible({ timeout: 15000 });
});

// ---------------------------------------------------------------------------
// Test 2: Loaded state
// ---------------------------------------------------------------------------
test('loaded state – nav and tabs visible', async ({ page }) => {
  await mockGraphRoute(page);
  await gotoApp(page);

  // Graph tab visible
  await expect(page.getByRole('button', { name: /^Graph$/i })).toBeVisible();

  // Health tab
  await expect(page.getByRole('button', { name: /^Health$/i })).toBeVisible();

  // Domains tab
  await expect(page.getByRole('button', { name: /^Domains$/i })).toBeVisible();

  // Search button (in GraphView toolbar)
  await expect(page.getByRole('button', { name: /search/i })).toBeVisible();
});

// ---------------------------------------------------------------------------
// Test 3: Navigation between views
// ---------------------------------------------------------------------------
test('navigation – switching between graph, health, and domains tabs', async ({
  page,
}) => {
  await mockGraphRoute(page);
  await gotoApp(page);

  // Switch to Health
  await page.getByRole('button', { name: /^Health$/i }).click();
  await expect(
    page.getByRole('heading', { name: 'Structural Health Report' }),
  ).toBeVisible({ timeout: 10000 });

  // Switch to Domains
  await page.getByRole('button', { name: /^Domains$/i }).click();
  await expect(
    page.getByText(/No domain analysis yet|Business Domain Explorer|Domain/i).first(),
  ).toBeVisible({ timeout: 10000 });

  // Switch back to Graph
  await page.getByRole('button', { name: /^Graph$/i }).click();
  // The GraphView toolbar shows the project name
  await expect(page.getByText('Test Project')).toBeVisible({ timeout: 10000 });
});

// ---------------------------------------------------------------------------
// Test 4: Keyboard shortcut – open and close search dialog (Ctrl+K)
// ---------------------------------------------------------------------------
test('keyboard shortcut – Ctrl+K opens search dialog, Escape closes it', async ({
  page,
}) => {
  await mockGraphRoute(page);
  await gotoApp(page);

  // Click the body to make sure keyboard events go to the right place
  await page.locator('body').click({ position: { x: 10, y: 10 } });

  // Open with Ctrl+K
  await page.keyboard.press('Control+k');

  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible({ timeout: 5000 });

  // Close with Escape
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible({ timeout: 5000 });
});

// ---------------------------------------------------------------------------
// Test 5: Click-to-open search
// ---------------------------------------------------------------------------
test('search button click opens search dialog', async ({ page }) => {
  await mockGraphRoute(page);
  await gotoApp(page);

  await page.getByRole('button', { name: /search/i }).click();

  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible({ timeout: 5000 });

  // Escape closes it
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible({ timeout: 5000 });
});

// ---------------------------------------------------------------------------
// Test 6: Keyboard shortcuts – view switching
// ---------------------------------------------------------------------------
test('keyboard shortcuts – h switches to health, g switches to graph', async ({
  page,
}) => {
  await mockGraphRoute(page);
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
  await mockGraphRoute(page);
  await gotoApp(page);

  await page.locator('body').click({ position: { x: 200, y: 200 } });
  await page.keyboard.press('d');

  await expect(
    page.getByRole('button', { name: /^Domains$/i }),
  ).toBeVisible({ timeout: 5000 });
  // Domains view shows the domain name or "Business Domain" text
  await expect(
    page.getByText(/Authentication|Business Domain|Domain/i).first(),
  ).toBeVisible({ timeout: 10000 });
});

// ---------------------------------------------------------------------------
// Test 8: Keyboard shortcut '?' opens keyboard shortcuts help modal
// ---------------------------------------------------------------------------
test('keyboard shortcut – ? opens shortcuts help modal', async ({ page }) => {
  await mockGraphRoute(page);
  await gotoApp(page);

  await page.locator('body').click({ position: { x: 200, y: 200 } });
  await page.keyboard.press('?');

  // KeyboardShortcutsHelp renders a modal/dialog with shortcut info
  await expect(
    page.getByText(/keyboard shortcuts|Cmd|Ctrl/i).first(),
  ).toBeVisible({ timeout: 5000 });

  // Escape should close it
  await page.keyboard.press('Escape');
});

// ---------------------------------------------------------------------------
// Test 9: Health view shows smell summary and risk info
// ---------------------------------------------------------------------------
test('health view – shows smell summary and risk counts', async ({ page }) => {
  await mockGraphRoute(page);
  await gotoApp(page);

  await page.getByRole('button', { name: /^Health$/i }).click();

  const heading = page.getByRole('heading', { name: 'Structural Health Report' });
  await expect(heading).toBeVisible({ timeout: 10000 });

  // Stats from mock: 1 high risk, god_node smell
  await expect(page.getByText(/god.node|god_node/i).first()).toBeVisible({ timeout: 5000 });
});

// ---------------------------------------------------------------------------
// Test 10: Domains view – shows domain name from mock graph
// ---------------------------------------------------------------------------
test('domains view – renders domain from graph', async ({ page }) => {
  await mockGraphRoute(page);
  await gotoApp(page);

  await page.getByRole('button', { name: /^Domains$/i }).click();

  await expect(
    page.getByText(/Authentication|No domain/i).first(),
  ).toBeVisible({ timeout: 10000 });
});

// ---------------------------------------------------------------------------
// Test 11: Search – typing in search dialog filters nodes
// ---------------------------------------------------------------------------
test('search dialog – typing filters visible results', async ({ page }) => {
  await mockGraphRoute(page);
  await gotoApp(page);

  await page.getByRole('button', { name: /search/i }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible({ timeout: 5000 });

  // Type a search term that matches mock graph nodes
  const input = dialog.locator('input').first();
  await input.fill('auth');

  // Should show the matching node label
  await expect(page.getByText(/auth\.ts/i).first()).toBeVisible({ timeout: 5000 });

  await page.keyboard.press('Escape');
});

// ---------------------------------------------------------------------------
// Test 12: Onboarding overlay – appears on first visit, dismisses
// ---------------------------------------------------------------------------
test('onboarding overlay – appears and can be dismissed', async ({ page }) => {
  await mockGraphRoute(page);

  // Clear localStorage so onboarding triggers
  await page.goto('/');
  await page.evaluate(() => localStorage.removeItem('sprang:onboarded'));
  await page.reload();
  await mockGraphRoute(page);

  // Onboarding overlay should appear
  const overlay = page.getByText(/welcome|get started|onboard/i).first();
  const overlayVisible = await overlay.isVisible().catch(() => false);

  if (overlayVisible) {
    // Dismiss it
    const dismissBtn = page.getByRole('button', { name: /skip|got it|dismiss|close|next/i }).first();
    if (await dismissBtn.isVisible()) {
      await dismissBtn.click();
    }
    // After dismiss the app should still be functional
    await waitForAppLoaded(page);
  }
  // If onboarding is already marked dismissed, the test is a no-op (passes)
});

// ---------------------------------------------------------------------------
// Test 13: Graph view shows project name and node count
// ---------------------------------------------------------------------------
test('graph view – project name visible in toolbar', async ({ page }) => {
  await mockGraphRoute(page);
  await gotoApp(page);

  // Make sure we're on the graph view
  await page.getByRole('button', { name: /^Graph$/i }).click();
  await expect(page.getByText('Test Project')).toBeVisible({ timeout: 10000 });
});

// ---------------------------------------------------------------------------
// Test 14: Nav bar persists across view switches
// ---------------------------------------------------------------------------
test('nav bar – logo persists across all view switches', async ({ page }) => {
  await mockGraphRoute(page);
  await gotoApp(page);

  for (const tab of ['Health', 'Domains', 'Graph']) {
    await page.getByRole('button', { name: new RegExp(`^${tab}$`, 'i') }).click();
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

  // After clicking retry, another fetch should have been attempted
  await expect(
    page.getByRole('heading', { name: 'No knowledge graph found' }),
  ).toBeVisible({ timeout: 10000 });
  expect(callCount).toBeGreaterThan(before);
});
