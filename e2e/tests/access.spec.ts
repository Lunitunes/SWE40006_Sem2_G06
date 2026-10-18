import { expect, test } from '@playwright/test';
import { createEvent, deleteEvent, hostApi, uploadViaApi } from './helpers';

test('the landing page points guests to their link and hosts to the dashboard', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Here to add photos?' })).toBeVisible();
  await page.getByRole('link', { name: 'Go to host dashboard' }).click();
  await expect(page).toHaveURL(/\/host$/);
});

test('an unknown event link shows "Event not found"', async ({ page }) => {
  await page.goto('/e/AAAAAAAAAAAAAAAAAAAAAA');
  await expect(page.getByRole('heading', { name: 'Event not found' })).toBeVisible();
  await expect(page.getByRole('button', { name: /Take a photo/ })).toHaveCount(0);
});

test('old /upload links redirect to the landing page', async ({ page }) => {
  await page.goto('/upload');
  await expect(page).toHaveURL(/\/$/);
});

// "Access is granted through the link itself": one event's link must not reveal another's photos
test('guests only see photos from their own event', async ({ page, baseURL }) => {
  const api = await hostApi(baseURL!);
  const a = await createEvent(api, 'isolation A');
  const b = await createEvent(api, 'isolation B');
  try {
    const photoInA = await uploadViaApi(api, a.token, 'Only for event A');

    await page.goto(`/e/${b.token}`);
    await expect(page.getByText('No photos yet')).toBeVisible();
    await expect(page.getByText('Only for event A')).toHaveCount(0);

    // Guessing A's photo id through B's link doesn't work either
    const res = await page.request.get(`/api/backend/events/share/${b.token}/photos/${photoInA}/image`);
    expect(res.status()).toBe(404);

    await page.goto(`/e/${a.token}`);
    await expect(page.getByText('Only for event A')).toBeVisible();
  } finally {
    await deleteEvent(api, a.id);
    await deleteEvent(api, b.id);
    await api.dispose();
  }
});
