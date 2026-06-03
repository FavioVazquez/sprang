import { test, expect, type Page } from '@playwright/test';
import type { KnowledgeGraph } from '../src/types';

// ---------------------------------------------------------------------------
// Mock graph – minimal but valid KnowledgeGraph for the loaded-state tests
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
      id: 'file-1',
      label: 'app.ts',
      type: 'file',
      tags: [],
    },
  ],
  edges: [],
  layers: [],
  tours: [],
  domains: [],
  stats: {
    node_count: 1,
    edge_count: 0,
    generated_at: new Date().toISOString(),
    risk_summary: { high: 0, medium: 0, low: 0 },
    smell_summary: {},
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
// Helper: wait for the app to finish loading (nav visible = fully loaded)
// ---------------------------------------------------------------------------
async function waitForAppLoaded(page: Page) {
  // The nav bar with the "sprang" logo is only visible after graph loads
  await expect(page.getByText('sprang')).toBeVisible({ timeout: 15000 });
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
  await page.goto('/');
  await waitForAppLoaded(page);

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
  await page.goto('/');
  await waitForAppLoaded(page);

  // Switch to Health
  await page.getByRole('button', { name: /^Health$/i }).click();
  await expect(
    page.getByRole('heading', { name: 'Structural Health Report' }),
  ).toBeVisible({ timeout: 10000 });

  // Switch to Domains
  await page.getByRole('button', { name: /^Domains$/i }).click();
  await expect(
    page.getByText(/No domain analysis yet|Business Domain Explorer|Domain/i),
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
  await page.goto('/');
  await waitForAppLoaded(page);

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
  await page.goto('/');
  await waitForAppLoaded(page);

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
  await page.goto('/');
  await waitForAppLoaded(page);

  // Click canvas to ensure body-level focus, not an input
  await page.locator('body').click({ position: { x: 200, y: 200 } });

  // Press 'h' to switch to health view
  await page.keyboard.press('h');
  await expect(
    page.getByRole('heading', { name: 'Structural Health Report' }),
  ).toBeVisible({ timeout: 10000 });

  // Press 'g' to switch back to graph view
  await page.keyboard.press('g');
  await expect(page.getByText('Test Project')).toBeVisible({ timeout: 10000 });
});
