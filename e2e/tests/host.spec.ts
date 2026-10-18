import { expect, test, type APIRequestContext } from '@playwright/test';
import { createEvent, deleteEvent, hostApi, logInAsHost, uniqueName, uploadViaApi } from './helpers';

test.describe('Host dashboard', () => {
  let api: APIRequestContext;
  const created: number[] = [];

  test.beforeEach(async ({ baseURL }) => {
    api = await hostApi(baseURL!);
  });

  test.afterEach(async () => {
    for (const id of created.splice(0)) await deleteEvent(api, id);
    await api.dispose();
  });

  test('rejects a wrong password', async ({ page }) => {
    await page.goto('/host');
    await page.getByLabel('Password').fill('definitely-not-the-password');
    await page.getByRole('button', { name: 'Log in' }).click();
    await expect(page.getByRole('alert').filter({ hasText: 'Incorrect password' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Your events' })).toHaveCount(0);
  });

  test('creates an event with a QR code, renames it, and deletes it', async ({ page }) => {
    await logInAsHost(page);

    const name = uniqueName('host flow');
    await page.getByLabel('Event name').fill(name);
    await page.getByRole('button', { name: 'Create event' }).click();

    // Register the new event for cleanup straight away, before any assertion can fail, so a
    // failing run never leaves test events behind on the server
    type Listed = { id: number; name: string; token: string };
    let event: Listed | undefined;
    await expect
      .poll(async () => {
        event = ((await (await api.get('/api/backend/events')).json()) as Listed[]).find((e) => e.name === name);
        return !!event;
      })
      .toBe(true);
    created.push(event!.id);

    const card = page.getByRole('listitem').filter({ hasText: name });
    await expect(card).toBeVisible();
    // A new event opens with its QR code and guest link showing
    await expect(card.getByRole('img', { name: /^QR code linking to .*\/e\/[A-Za-z0-9_-]{22}$/ })).toBeVisible();
    const link = (await card.getByText(/\/e\/[A-Za-z0-9_-]{22}$/).innerText()).trim();
    expect(link.endsWith(`/e/${event!.token}`)).toBe(true);

    // The link works for guests: a separate browser context, so no host cookie
    const guest = await page.context().browser()!.newPage();
    await guest.goto(link);
    await expect(guest.getByRole('heading', { level: 1, name })).toBeVisible();

    // Rename
    const renamed = `${name} (renamed)`;
    await card.getByRole('button', { name: 'Rename' }).click();
    await page.getByLabel('Event name', { exact: true }).last().fill(renamed);
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('heading', { level: 3, name: renamed })).toBeVisible();
    await guest.reload();
    await expect(guest.getByRole('heading', { level: 1, name: renamed })).toBeVisible();

    // Delete: the guest link stops working
    page.once('dialog', (dialog) => dialog.accept());
    await page.getByRole('listitem').filter({ hasText: renamed }).getByRole('button', { name: 'Delete event' }).click();
    await expect(page.getByRole('heading', { level: 3, name: renamed })).toHaveCount(0);
    await guest.reload();
    await expect(guest.getByRole('heading', { name: 'Event not found' })).toBeVisible();
    await guest.close();
  });

  test('can delete a guest’s photo from the event page', async ({ page }) => {
    const event = await createEvent(api, 'moderation');
    created.push(event.id);
    await uploadViaApi(api, event.token, 'Unwanted photo');

    await logInAsHost(page);
    await page.goto(`/e/${event.token}`);
    const gallery = page.getByRole('region', { name: 'Gallery' });
    await expect(gallery.getByText('Unwanted photo')).toBeVisible();

    page.once('dialog', (dialog) => dialog.accept());
    await gallery.getByRole('button', { name: 'Delete photo' }).click();
    await expect(gallery.getByText('No photos yet')).toBeVisible();
  });

  test('logs out', async ({ page }) => {
    await logInAsHost(page);
    await page.getByRole('button', { name: 'Log out' }).click();
    await expect(page.getByRole('heading', { name: 'Host login' })).toBeVisible();
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Host login' })).toBeVisible();
  });
});

test('the navbar shows Grafana to logged-in hosts only', async ({ page, baseURL, isMobile }) => {
  const nav = page.getByRole('navigation', { name: 'Main' });
  const grafana = nav.getByRole('link', { name: /Grafana/ });
  // On phones the links sit behind the Menu button
  const openMenu = async () => {
    if (isMobile) await nav.getByRole('button', { name: 'Menu' }).click();
  };

  await page.goto('/host');
  await openMenu();
  await expect(nav.getByRole('link', { name: 'Events' })).toBeVisible();
  await expect(grafana).toHaveCount(0);

  // Appears straight after logging in, without a page reload
  await page.getByLabel('Password').fill(process.env.E2E_ADMIN_PASSWORD ?? '');
  await page.getByRole('button', { name: 'Log in' }).click();
  await expect(page.getByRole('heading', { name: 'Your events' })).toBeVisible();
  await expect(grafana).toBeVisible();
  // HTTPS sites (EC2) use Grafana's HTTPS subdomain; HSTS rules out plain http://<host>:3002 there
  const site = new URL(baseURL!);
  const expectedGrafana = site.protocol === 'https:' ? `https://grafana.${site.hostname}` : `http://${site.hostname}:3002`;
  await expect(grafana).toHaveAttribute('href', expectedGrafana);
  await expect(grafana).toHaveAttribute('target', '_blank');

  await page.getByRole('button', { name: 'Log out' }).click();
  await expect(grafana).toHaveCount(0);
});

test.describe('Metrics page', () => {
  test('is only available to hosts', async ({ page }) => {
    await page.goto('/admin/metrics');
    await expect(page.getByText('Metrics are only available to hosts')).toBeVisible();

    await logInAsHost(page);
    await page.goto('/admin/metrics');
    await expect(page.getByRole('heading', { name: 'Services' })).toBeVisible();
    await expect(page.getByText('Backend API: Up')).toBeVisible();
    await expect(page.getByText('Database: Up')).toBeVisible();
  });
});
