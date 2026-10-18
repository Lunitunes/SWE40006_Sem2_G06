// Shrinks a photo in the browser before upload, and makes the small thumbnail the gallery shows.
//
// Why: phone photos are often 3-12 MB at 12-48 megapixels. Resizing to 2560px (still sharp on any
// screen) usually brings them under 1 MB, so uploads are much faster on event Wi-Fi, and a 480px
// thumbnail (~40 KB) keeps the gallery light. Re-encoding also strips EXIF metadata, including the
// GPS location many phones embed, and converts HEIC (iPhone) to JPEG, which every browser can show.

export const MAX_DIMENSION = 2560;
export const THUMB_DIMENSION = 480;
const PHOTO_QUALITY = 0.85;
const THUMB_QUALITY = 0.75;
// A smaller re-encode that saves less than this isn't worth the quality loss
const MIN_SAVING = 0.9;

export type PreparedPhoto = {
  photo: File;
  thumbnail: Blob | null;
  originalBytes: number;
  // True when `photo` is a re-encoded copy rather than the guest's original file
  resized: boolean;
};

const isHeic = (file: File) => /image\/hei[cf]/i.test(file.type) || /\.(heic|heif)$/i.test(file.name);

function encode(bitmap: ImageBitmap, maxDimension: number, quality: number): Promise<Blob> {
  const scale = Math.min(1, maxDimension / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  // JPEG has no transparency: put transparent PNGs on white rather than black
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, 0, 0, width, height);
  return new Promise((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('encoding failed'))), 'image/jpeg', quality),
  );
}

const jpegName = (name: string) => `${name.replace(/\.[^./\\]+$/, '') || 'photo'}.jpg`;

export async function preparePhoto(file: File): Promise<PreparedPhoto> {
  const unchanged: PreparedPhoto = { photo: file, thumbnail: null, originalBytes: file.size, resized: false };

  let bitmap: ImageBitmap;
  try {
    // 'from-image' applies the EXIF rotation, so portrait phone photos stay upright once EXIF is gone
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    // The browser can't decode it (e.g. HEIC outside Safari): upload the original as-is
    return unchanged;
  }

  try {
    const thumbnail = await encode(bitmap, THUMB_DIMENSION, THUMB_QUALITY).catch(() => null);

    // Animated GIFs would be flattened to one frame, so keep the original (it still gets a thumbnail)
    if (file.type === 'image/gif') return { ...unchanged, thumbnail };

    const tooLarge = Math.max(bitmap.width, bitmap.height) > MAX_DIMENSION;
    const resized = await encode(bitmap, MAX_DIMENSION, PHOTO_QUALITY);
    const worthIt = isHeic(file) || tooLarge || resized.size < file.size * MIN_SAVING;
    if (!worthIt) return { ...unchanged, thumbnail };

    return {
      photo: new File([resized], jpegName(file.name), { type: 'image/jpeg', lastModified: file.lastModified }),
      thumbnail,
      originalBytes: file.size,
      resized: true,
    };
  } finally {
    bitmap.close();
  }
}
