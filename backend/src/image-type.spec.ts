import { detectImageType } from './image-type.js';

const pad = (bytes: number[] | string) =>
  Buffer.concat([typeof bytes === 'string' ? Buffer.from(bytes, 'ascii') : Buffer.from(bytes), Buffer.alloc(16)]);

describe('detectImageType', () => {
  it.each([
    ['image/jpeg', pad([0xff, 0xd8, 0xff, 0xe0])],
    ['image/png', pad([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])],
    ['image/gif', pad('GIF89a')],
    ['image/webp', pad('RIFF\0\0\0\0WEBP')],
    ['image/heic', pad('\0\0\0\x18ftypheic')],
    ['image/heif', pad('\0\0\0\x18ftypmif1')],
  ])('detects %s from its file signature', (type, buffer) => {
    expect(detectImageType(buffer)).toBe(type);
  });

  it('rejects non-image content regardless of file name or claimed type', () => {
    expect(detectImageType(pad('<script>alert(1)</script>'))).toBeNull();
    expect(detectImageType(pad('%PDF-1.7'))).toBeNull();
    expect(detectImageType(pad('\0\0\0\x18ftypmp42'))).toBeNull(); // MP4 video
  });

  it('rejects files too short to identify', () => {
    expect(detectImageType(Buffer.from([0xff, 0xd8, 0xff]))).toBeNull();
  });
});
