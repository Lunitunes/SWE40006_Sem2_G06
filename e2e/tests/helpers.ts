import { expect, request, type APIRequestContext, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? '';

// A real photo (640x480 JPEG): passes the backend's file-content check and renders in the preview
export const JPEG = readFileSync(join(__dirname, '..', 'fixtures', 'party.jpg'));

export type TestEvent = { id: number; name: string; token: string };

// Logged-in host API session (same cookie the dashboard uses), for setting up and cleaning up test
// data quickly; the UI itself is exercised by the tests
export async function hostApi(baseURL: string): Promise<APIRequestContext> {
  if (!ADMIN_PASSWORD) throw new Error('Set E2E_ADMIN_PASSWORD to the server’s ADMIN_PASSWORD');
  const api = await request.newContext({ baseURL });
  const res = await api.post('/api/backend/auth/login', { data: { password: ADMIN_PASSWORD } });
  expect(res.status(), 'host login for test setup').toBe(200);
  return api;
}

// Unique names so parallel runs (and real events on a live server) never collide
export const uniqueName = (label: string) => `E2E ${label} ${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

export async function createEvent(api: APIRequestContext, label: string): Promise<TestEvent> {
  const res = await api.post('/api/backend/events', { data: { name: uniqueName(label) } });
  expect(res.status()).toBe(201);
  return res.json();
}

// Deleting an event also deletes its photos, so tests leave nothing behind
export async function deleteEvent(api: APIRequestContext, id: number) {
  const res = await api.delete(`/api/backend/events/${id}`);
  expect([204, 404]).toContain(res.status());
}

export async function uploadViaApi(api: APIRequestContext, token: string, description: string) {
  const res = await api.post(`/api/backend/events/share/${token}/photos`, {
    multipart: { description, photo: { name: 'api.jpg', mimeType: 'image/jpeg', buffer: JPEG } },
  });
  expect(res.status()).toBe(201);
  return (await res.json()).id as number;
}

export async function logInAsHost(page: Page) {
  await page.goto('/host');
  await page.getByLabel('Password').fill(ADMIN_PASSWORD);
  await page.getByRole('button', { name: 'Log in' }).click();
  await expect(page.getByRole('heading', { name: 'Your events' })).toBeVisible();
}

// "Choose a photo" opens the OS file picker; Playwright answers it with our file
export async function choosePhoto(page: Page, file = { name: 'party.jpg', mimeType: 'image/jpeg', buffer: JPEG }) {
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: /Choose a photo/ }).click();
  await (await chooser).setFiles(file);
}
