import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from './../src/app.module.js';
import { MAX_UPLOAD_BYTES } from './../src/upload.controller.js';

// 1x1 transparent PNG
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

// These need a real PostgreSQL (CI provides one as a service container); set DB_HOST to run them locally
const hasDatabase = !!process.env.DB_HOST;

describe('Uploads (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  describe.skipIf(!hasDatabase)('with a database', () => {
    it('/health/ready (GET) reports the database as up', () => {
      return request(app.getHttpServer()).get('/health/ready').expect(200).expect({ status: 'ok', database: 'up' });
    });

    it('stores a photo, lists it, and serves it back with its real content type', async () => {
      const description = `e2e photo ${Date.now()}`;

      const upload = await request(app.getHttpServer())
        .post('/upload')
        .field('description', `  ${description}  `)
        .attach('photo', PNG, { filename: 'pixel.png', contentType: 'image/png' })
        .expect(201);
      expect(upload.body).toMatchObject({ success: true, id: expect.any(Number) });
      const id = upload.body.id;

      const list = await request(app.getHttpServer()).get('/upload/all').expect(200);
      expect(list.body).toContainEqual(expect.objectContaining({ id, description, image_name: 'pixel.png' }));

      const image = await request(app.getHttpServer()).get(`/upload/image/${id}`).expect(200);
      expect(image.headers['content-type']).toBe('image/png');
      expect(Buffer.compare(image.body, PNG)).toBe(0);
    });

    it('uses the detected type, not the type the client claims', async () => {
      const upload = await request(app.getHttpServer())
        .post('/upload')
        .field('description', 'mislabelled png')
        .attach('photo', PNG, { filename: 'photo.jpg', contentType: 'image/jpeg' })
        .expect(201);

      const image = await request(app.getHttpServer()).get(`/upload/image/${upload.body.id}`).expect(200);
      expect(image.headers['content-type']).toBe('image/png');
    });

    it('returns 404 for a photo that does not exist', () => {
      return request(app.getHttpServer()).get('/upload/image/2147483647').expect(404);
    });
  });

  describe('validation', () => {
    it('rejects a non-image file even when it claims to be an image', () => {
      return request(app.getHttpServer())
        .post('/upload')
        .field('description', 'not really a picture')
        .attach('photo', Buffer.from('<html><script>alert(1)</script></html>'), {
          filename: 'evil.png',
          contentType: 'image/png',
        })
        .expect(400);
    });

    it('rejects an upload with no photo', () => {
      return request(app.getHttpServer()).post('/upload').field('description', 'no file').expect(400);
    });

    it('rejects an upload with a blank description', () => {
      return request(app.getHttpServer())
        .post('/upload')
        .field('description', '   ')
        .attach('photo', PNG, { filename: 'pixel.png', contentType: 'image/png' })
        .expect(400);
    });

    it('rejects a description over 500 characters', () => {
      return request(app.getHttpServer())
        .post('/upload')
        .field('description', 'x'.repeat(501))
        .attach('photo', PNG, { filename: 'pixel.png', contentType: 'image/png' })
        .expect(400);
    });

    it('rejects files over 10 MB with 413', () => {
      const tooBig = Buffer.concat([PNG, Buffer.alloc(MAX_UPLOAD_BYTES)]);
      return request(app.getHttpServer())
        .post('/upload')
        .field('description', 'huge')
        .attach('photo', tooBig, { filename: 'huge.png', contentType: 'image/png' })
        .expect(413);
    });
  });

  describe.skipIf(hasDatabase)('without a database', () => {
    it('/health/ready (GET) returns 503 while /health stays up', async () => {
      await request(app.getHttpServer()).get('/health').expect(200);
      await request(app.getHttpServer())
        .get('/health/ready')
        .expect(503)
        .expect({ status: 'error', database: 'down' });
    });
  });
});
