import { expect, test, type APIRequestContext } from '@playwright/test';
import { choosePhoto, createEvent, deleteEvent, hostApi, type TestEvent } from './helpers';

// The brief's guest journey: open the event link, take or choose a photo, see it, approve it,
// and it appears in the event gallery
test.describe('Guest journey', () => {
  let api: APIRequestContext;
  let event: TestEvent;

  test.beforeEach(async ({ baseURL }) => {
    api = await hostApi(baseURL!);
    event = await createEvent(api, 'guest journey');
  });

  test.afterEach(async () => {
    await deleteEvent(api, event.id);
    await api.dispose();
  });

  test('chooses a photo, previews and approves it, and sees it in the gallery', async ({ page }) => {
    await page.goto(`/e/${event.token}`);
    await expect(page.getByRole('heading', { level: 1, name: event.name })).toBeVisible();
    await expect(page.getByText('No photos yet')).toBeVisible();

    await choosePhoto(page);

    // Shown the image and asked to approve it before anything is uploaded
    await expect(page.getByRole('heading', { name: 'Check your photo' })).toBeVisible();
    const preview = page.getByRole('img', { name: /Preview of the photo/ });
    await expect(preview).toBeVisible();
    expect(await preview.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);

    await page.getByLabel('Description').fill('Cutting the cake');
    await page.getByRole('button', { name: 'Looks good, upload' }).click();

    await expect(page.getByRole('heading', { name: 'Photo uploaded' })).toBeVisible();
    const gallery = page.getByRole('region', { name: 'Gallery' });
    await expect(gallery.getByText('1 photo')).toBeVisible();
    const photo = gallery.getByRole('img', { name: 'Cutting the cake' });
    await expect(photo).toBeVisible();
    // The image really loads from the server, not just the caption
    await expect.poll(() => photo.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);

    // Guests can't delete anything
    await expect(page.getByRole('button', { name: 'Delete photo' })).toHaveCount(0);
  });

  test('takes a photo with the in-page camera', async ({ page, baseURL }) => {
    // Browsers only allow getUserMedia on HTTPS or localhost; elsewhere the page opens the phone's
    // camera app instead (covered by the fallback test below)
    const url = new URL(baseURL!);
    test.skip(url.protocol !== 'https:' && url.hostname !== 'localhost', 'in-page camera needs HTTPS or localhost');

    await page.goto(`/e/${event.token}`);
    await page.getByRole('button', { name: /Take a photo/ }).click();

    // Chromium's fake camera stands in for a real one
    await expect(page.getByLabel('Camera preview')).toBeVisible();
    const shutter = page.getByRole('button', { name: 'Take photo' });
    await expect(shutter).toBeEnabled();
    await shutter.click();

    await expect(page.getByRole('heading', { name: 'Check your photo' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Retake' })).toBeVisible();
    await page.getByLabel('Description').fill('Taken with the camera');
    await page.getByRole('button', { name: 'Looks good, upload' }).click();

    await expect(page.getByRole('region', { name: 'Gallery' }).getByRole('img', { name: 'Taken with the camera' })).toBeVisible();
  });

  test('falls back to the phone’s camera app where the in-page camera isn’t allowed', async ({ page }) => {
    await page.goto(`/e/${event.token}`);
    // Simulate plain HTTP (e.g. http://<server-ip>), where browsers block the in-page camera
    await page.evaluate(() => Object.defineProperty(window, 'isSecureContext', { value: false }));

    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: /Take a photo/ }).click();
    const fileChooser = await chooser;

    // It's the input with capture="environment", which phones open in the camera app
    expect(await fileChooser.element().getAttribute('capture')).toBe('environment');
    await expect(page.getByLabel('Camera preview')).toHaveCount(0);
  });

  test('cancelling at the preview step uploads nothing', async ({ page }) => {
    await page.goto(`/e/${event.token}`);
    await choosePhoto(page);
    await expect(page.getByRole('heading', { name: 'Check your photo' })).toBeVisible();

    await page.getByRole('button', { name: 'Cancel' }).click();

    await expect(page.getByRole('heading', { name: 'Add a photo' })).toBeVisible();
    await page.reload();
    await expect(page.getByText('No photos yet')).toBeVisible();
  });

  test('asks for a description before uploading', async ({ page }) => {
    await page.goto(`/e/${event.token}`);
    await choosePhoto(page);
    await page.getByRole('button', { name: 'Looks good, upload' }).click();

    await expect(page.getByRole('alert').filter({ hasText: 'Add a short description' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Check your photo' })).toBeVisible();
  });

  test('rejects a file that isn’t really an image, even if it claims to be', async ({ page }) => {
    await page.goto(`/e/${event.token}`);
    await choosePhoto(page, { name: 'holiday.jpg', mimeType: 'image/jpeg', buffer: Buffer.from('<html>not a photo</html>') });
    await page.getByLabel('Description').fill('Sneaky');
    await page.getByRole('button', { name: 'Looks good, upload' }).click();

    // The server checks the file's contents, not its name or claimed type
    await expect(page.getByRole('alert').filter({ hasText: 'Only JPEG, PNG, GIF, WebP or HEIC' })).toBeVisible();
    await page.reload();
    await expect(page.getByText('No photos yet')).toBeVisible();
  });

  test('shrinks a big phone photo before upload, strips its GPS data, and the gallery shows a thumbnail', async ({ page }) => {
    await page.goto(`/e/${event.token}`);

    // A 20-megapixel photo (5000x4000) over 10 MB, like a modern phone's, made in the browser.
    // Random noise doesn't compress, so the file is really that big.
    const generated = await page.evaluate(async () => {
      const canvas = document.createElement('canvas');
      canvas.width = 5000;
      canvas.height = 4000;
      const ctx = canvas.getContext('2d')!;
      const pixels = ctx.createImageData(canvas.width, canvas.height);
      const noise = new Uint32Array(pixels.data.buffer);
      for (let i = 0; i < noise.length; i++) noise[i] = (Math.random() * 0xffffffff) | 0xff000000;
      ctx.putImageData(pixels, 0, 0);
      const blob: Blob = await new Promise((resolve) => canvas.toBlob((b) => resolve(b!), 'image/jpeg', 0.95));
      const bytes = new Uint8Array(await blob.arrayBuffer());
      let binary = '';
      for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      return btoa(binary);
    });
    const encoded = Buffer.from(generated, 'base64');
    // Insert an EXIF block with a GPS position right after the JPEG start marker, as phones do
    const exifBody = Buffer.from('Exif\0\0GPSLatitude -37.8221 GPSLongitude 145.0389');
    const exif = Buffer.concat([Buffer.from([0xff, 0xe1, (exifBody.length + 2) >> 8, (exifBody.length + 2) & 0xff]), exifBody]);
    const original = Buffer.concat([encoded.subarray(0, 2), exif, encoded.subarray(2)]);
    expect(original.length, 'test photo should be over the 10 MB upload limit').toBeGreaterThan(10 * 1024 * 1024);

    await choosePhoto(page, { name: 'IMG_0001.jpg', mimeType: 'image/jpeg', buffer: original });

    // Previously rejected for being over 10 MB; now resized in the browser first
    await expect(page.getByText(/^Resized for a faster upload: \d+\.\d MB → \d+\.\d MB$/)).toBeVisible({ timeout: 20_000 });
    await page.getByLabel('Description').fill('Big phone photo');
    await page.getByRole('button', { name: 'Looks good, upload' }).click();
    await expect(page.getByRole('heading', { name: 'Photo uploaded' })).toBeVisible({ timeout: 30_000 });

    // What the server stored: at most 2560px, same 5:4 shape, well under the limit, no GPS data
    const [photo] = await (await page.request.get(`/api/backend/events/share/${event.token}/photos`)).json();
    const full = await page.request.get(`/api/backend/events/share/${event.token}/photos/${photo.id}/image`);
    const fullBytes = await full.body();
    expect(full.headers()['content-type']).toBe('image/jpeg');
    expect(fullBytes.length).toBeLessThan(original.length / 2);
    expect(fullBytes.includes(Buffer.from('GPSLatitude'))).toBe(false);

    const size = (url: string) =>
      page.evaluate(async (u) => {
        const bitmap = await createImageBitmap(await (await fetch(u)).blob());
        return { width: bitmap.width, height: bitmap.height };
      }, url);
    expect(await size(`/api/backend/events/share/${event.token}/photos/${photo.id}/image`)).toEqual({ width: 2560, height: 2048 });

    // The gallery downloads only the small thumbnail
    const thumbUrl = `/api/backend/events/share/${event.token}/photos/${photo.id}/image?size=thumb`;
    await expect(page.getByRole('region', { name: 'Gallery' }).getByRole('img', { name: 'Big phone photo' })).toHaveAttribute('src', thumbUrl);
    expect(await size(thumbUrl)).toEqual({ width: 480, height: 384 });
    const thumbBytes = (await (await page.request.get(thumbUrl)).body()).length;
    expect(thumbBytes).toBeLessThan(512 * 1024);

    const mb = (n: number) => `${(n / 1024 / 1024).toFixed(1)} MB`;
    console.log(`photo: ${mb(original.length)} 5000x4000 → stored ${mb(fullBytes.length)} 2560x2048, thumbnail ${(thumbBytes / 1024).toFixed(0)} KB`);
  });

  test('rejects photos over 10 MB that can’t be shrunk', async ({ page }) => {
    await page.goto(`/e/${event.token}`);
    await choosePhoto(page, { name: 'huge.jpg', mimeType: 'image/jpeg', buffer: Buffer.alloc(10.5 * 1024 * 1024) });
    await expect(page.getByRole('alert').filter({ hasText: 'The limit is 10 MB' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Add a photo' })).toBeVisible();
  });
});
