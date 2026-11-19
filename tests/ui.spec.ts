import { expect, test } from '@playwright/test';

const errors: string[] = [];
test.beforeEach(async ({ page }) => {
  errors.length = 0;
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Explore the demo', exact: true })).toBeVisible();
});
test.afterEach(async () => { expect(errors).toEqual([]); });

async function enterDemo(page: import('@playwright/test').Page) {
  await page.getByRole('button', { name: 'Explore the demo', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'A clear view of your day.' })).toBeVisible();
}

test('university sign-in explains missing configuration without pretending to authenticate', async ({ page }) => {
  await page.getByRole('button', { name: 'Continue with Microsoft' }).click();
  await expect(page.getByRole('heading', { name: 'University sign-in is not configured yet' })).toBeVisible();
  await expect(page.getByText(/Never put a Microsoft client secret/)).toBeVisible();
});

test('home and planner use chronological pending deadlines and survive reload', async ({ page }) => {
  await enterDemo(page);
  await expect(page.getByText('Past due', { exact: true }).first()).toBeVisible();
  await page.getByRole('tab', { name: 'Planner', exact: true }).click();
  await page.getByRole('button', { name: 'Assignments', exact: true }).click();
  const buttons = page.getByRole('button').filter({ hasText: /linked lists assignment|SQL joins assignment|packet analysis report/ });
  const names = await buttons.allTextContents();
  expect(names[0]).toContain('linked lists');
  expect(names[1]).toContain('SQL joins');
  expect(names[2]).toContain('packet analysis');
  await page.getByRole('checkbox', { name: /Mark complete:.*linked lists assignment/ }).click();
  await expect(page.getByRole('checkbox', { name: /Mark complete:.*linked lists assignment/ })).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'A clear view of your day.' })).toBeVisible();
  await expect(page.getByRole('checkbox', { name: /Mark complete:.*linked lists assignment/ })).toHaveCount(0);
});

test('custom event validates dates, saves, edits and deletes', async ({ page }) => {
  await enterDemo(page);
  await page.getByRole('button', { name: 'Add event', exact: true }).click();
  await page.getByRole('textbox', { name: 'Title', exact: true }).fill('UI test assignment');
  await page.getByRole('textbox', { name: 'Date', exact: true }).fill('2026-02-30');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Enter a valid date and 24-hour time.', { exact: true })).toBeVisible();
  await page.getByRole('textbox', { name: 'Date', exact: true }).fill('2030-01-02');
  await page.getByRole('textbox', { name: 'Time', exact: true }).fill('10:30');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.getByRole('tab', { name: 'Planner', exact: true }).click();
  await page.getByRole('textbox', { name: 'Search your planner' }).fill('UI test');
  await page.getByRole('button', { name: /UI test assignment,/ }).click();
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await page.getByRole('textbox', { name: 'Title', exact: true }).fill('UI test edited');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.getByRole('button', { name: /UI test edited,/ }).click();
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Delete this event?' })).toBeVisible();
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(page.getByRole('button', { name: /UI test edited,/ })).toHaveCount(0);
  await expect(page.getByText('No matches found', { exact: true })).toBeVisible();
});

test('course page exposes sample materials and manual course entry', async ({ page }) => {
  await enterDemo(page);
  await page.getByRole('tab', { name: 'Courses', exact: true }).click();
  await page.getByRole('button', { name: 'Database Systems', exact: true }).click();
  await page.getByRole('button', { name: 'Materials', exact: true }).click();
  await expect(page.getByText('Sample learning material', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Preview', exact: true }).first().click();
  await expect(page.getByText(/Review the concepts from this week/)).toBeVisible();
  await page.getByRole('button', { name: 'Close', exact: true }).last().click();
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByRole('button', { name: 'Add course', exact: true }).click();
  await page.getByRole('textbox', { name: 'Course code', exact: true }).fill('QA101');
  await page.getByRole('textbox', { name: 'Course name', exact: true }).fill('Quality Assurance');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Quality Assurance', exact: true })).toBeVisible();
});

test('study plan credits react to a completed course', async ({ page }) => {
  await enterDemo(page);
  await page.getByRole('tab', { name: 'Study plan', exact: true }).click();
  await expect(page.getByText('48', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Edit: Database Systems', exact: true }).click();
  await page.getByRole('button', { name: 'Completed', exact: true }).last().click();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('51', { exact: true })).toBeVisible();
});

test('demo alert can be acknowledged and ambiguous announcements cannot autoapply', async ({ page }) => {
  await enterDemo(page);
  await page.getByRole('tab', { name: 'Updates', exact: true }).click();
  await page.getByRole('button', { name: 'Send demo reminder', exact: true }).click();
  await expect(page.getByText('Your next exam', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Mark all seen', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Mark as seen', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Schedule changes', exact: true }).click();
  await page.getByRole('button', { name: 'Event details', exact: true }).first().click();
  await expect(page.getByText(/This message needs a manual check/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Apply change', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Dismiss', exact: true }).click();
  await expect(page.getByText('Dismissed', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Event details', exact: true }).last().click();
  await page.getByRole('button', { name: 'Undo change', exact: true }).click();
  await expect(page.getByText('Reverted', { exact: true })).toBeVisible();
});

test('Arabic RTL, dark theme and narrow layout remain usable', async ({ page }, testInfo) => {
  await enterDemo(page);
  await page.getByRole('button', { name: 'Dark', exact: true }).click();
  await page.getByRole('button', { name: 'العربية', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'يومك، بصورة أوضح.' })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await page.getByRole('tab', { name: 'المخطط', exact: true }).click();
  await expect(page.getByRole('button', { name: 'الواجبات', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('arabic-dark.png') });
  await page.getByRole('button', { name: 'English', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
});
