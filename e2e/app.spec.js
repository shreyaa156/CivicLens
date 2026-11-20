import { test, expect } from '@playwright/test';
import path from 'node:path';

const SHOTS = process.env.E2E_SCREENSHOT_DIR; // optional: save page screenshots for visual review
// Admin pages require the test server's ADMIN_TOKEN (set in playwright.config.js).
const signInAsAdmin = (page) => page.addInitScript(() => sessionStorage.setItem('civiclens_admin_token', 'e2e-admin-token'));
const shot = async (page, name) => SHOTS && page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: true });

test('landing page renders hero, CTA and live stats @mobile', async ({ page }, info) => {
  await page.goto('/');
  await expect(page.getByText('Live from CivicLens')).toBeVisible();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Smarter Cities');
  await expect(page.getByRole('link', { name: 'Report an Issue', exact: true })).toBeVisible();
  await shot(page, `landing-${info.project.name}`);
});

test('citizen submits a report and sees both agents complete', async ({ page }) => {
  await page.goto('/report');
  await page.locator('#photo').setInputFiles(path.join(import.meta.dirname, 'fixtures', 'road-test.jpg'));
  await page.getByLabel(/Description/).fill('Deep pothole near the school gate, dangerous for two-wheelers');
  await page.getByRole('button', { name: /Use my location/ }).click();
  await expect(page.getByText('19.997500, 73.789800')).toBeVisible();
  await shot(page, 'report-form');
  await page.getByRole('button', { name: /Submit report/ }).click();
  await expect(page.getByRole('heading', { name: /submitted/ })).toBeVisible({ timeout: 45000 });
  await expect(page.getByText('Detected issue')).toBeVisible();
  await expect(page.getByText('Recommended department')).toBeVisible();
  await expect(page.getByText('Final decision').first()).toBeVisible();
  await shot(page, 'report-result');
});

async function createReport(page, description, latitude, longitude) {
  const fs = await import('node:fs');
  const res = await page.request.post('/api/reports?wait=true', {
    multipart: {
      description,
      latitude: String(latitude),
      longitude: String(longitude),
      image: { name: 'road.jpg', mimeType: 'image/jpeg', buffer: fs.readFileSync(path.join(import.meta.dirname, 'fixtures', 'road-test.jpg')) },
    },
  });
  expect(res.status()).toBe(201);
  return res.json();
}

test('map shows real report markers and filters', async ({ page }) => {
  await createReport(page, 'Pothole near the market', 19.9981, 73.7801);
  await page.goto('/map');
  await expect(page.locator('.leaflet-container')).toBeVisible();
  await expect(page.locator('.marker-cluster, .cl-marker').first()).toBeVisible({ timeout: 15000 });
  await page.getByLabel('Category').selectOption('pothole');
  await expect(page.getByText(/reports shown/)).toBeVisible();
  await shot(page, 'map');
});

test('dashboard shows KPIs and charts', async ({ page }) => {
  await signInAsAdmin(page);
  await page.goto('/dashboard');
  await expect(page.getByText('Total reports')).toBeVisible();
  await expect(page.locator('.recharts-surface').first()).toBeVisible();
  await shot(page, 'dashboard');
});

test('agent activity shows genuine run log', async ({ page }) => {
  await signInAsAdmin(page);
  // Create a run of our own so this test doesn't depend on test order.
  const { runId } = await createReport(page, 'Garbage pile near the bus stop', 20.0101, 73.7905);
  await page.goto(`/agents/${runId}`);
  await expect(page.getByText('Admin portal')).toBeVisible();
  await expect(page.getByText(/^Execution log/)).toBeVisible({ timeout: 15000 });
  await expect(page.getByText('Workflow started').first()).toBeVisible();
  await shot(page, 'agents');
});

test('contact form validates input and message reaches the admin inbox', async ({ page }) => {
  await page.goto('/contact');
  await page.getByRole('button', { name: /Send message/ }).click();
  await expect(page.getByText('Please enter a valid email address.')).toBeVisible();
  await page.getByLabel('Name').fill('Test Citizen');
  await page.getByLabel('Email').fill('citizen@example.com');
  await page.getByLabel('Subject').fill('Feedback');
  await page.getByLabel('Message').fill('The map is very helpful for our ward.');
  await page.getByRole('button', { name: /Send message/ }).click();
  await expect(page.getByText('Message received')).toBeVisible();
  await shot(page, 'contact');
  // The message is visible to admins in the Messages inbox.
  await signInAsAdmin(page);
  await page.goto('/messages');
  await expect(page.getByText('Admin portal')).toBeVisible();
  await page.getByRole('button', { name: /Test Citizen/ }).first().click();
  await expect(page.getByRole('article').getByText('The map is very helpful for our ward.')).toBeVisible();
  await shot(page, 'messages');
});
