import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from './../src/app.module.js';
import { MAX_THUMBNAIL_BYTES, MAX_UPLOAD_BYTES } from './../src/events/share.controller.js';

// 1x1 transparent PNG
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);
const PASSWORD = 'e2e-host-password';

// Tests that store data need a real PostgreSQL (CI provides one); set DB_HOST to run them locally
const hasDatabase = !!process.env.DB_HOST;

async function createApp(): Promise<INestApplication<App>> {
  const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleFixture.createNestApplication<INestApplication<App>>();
  await app.init();
  return app;
}

describe('Events, host login and guest uploads (e2e)', () => {
  let app: INestApplication<App>;
  const originalPassword = process.env.ADMIN_PASSWORD;

  beforeAll(async () => {
    process.env.ADMIN_PASSWORD = PASSWORD;
    app = await createApp();
  });

  afterAll(async () => {
    await app.close();
    process.env.ADMIN_PASSWORD = originalPassword;
  });

  // A logged-in host: supertest's agent keeps the session cookie between requests
  const loginAsHost = async () => {
    const host = request.agent(app.getHttpServer());
    await host.post('/auth/login').send({ password: PASSWORD }).expect(200);
    return host;
  };

  describe('host login', () => {
    it('rejects a wrong password', () => {
      return request(app.getHttpServer()).post('/auth/login').send({ password: 'nope' }).expect(401);
    });

    it('sets an httpOnly session cookie and reports the host as logged in', async () => {
      const host = request.agent(app.getHttpServer());
      const res = await host.post('/auth/login').send({ password: PASSWORD }).expect(200);
      expect(res.headers['set-cookie'][0]).toMatch(/^photorepo_session=.+; Path=\/; HttpOnly; SameSite=Lax/);
      await host.get('/auth/me').expect(200).expect({ authenticated: true });
    });

    it('marks the cookie Secure when the site was reached over HTTPS', async () => {
      const res = await request(app.getHttpServer())
        .post('/auth/login')
        .set('X-Forwarded-Proto', 'https')
        .send({ password: PASSWORD })
        .expect(200);
      expect(res.headers['set-cookie'][0]).toContain('Secure');
    });

    it('logs out', async () => {
      const host = await loginAsHost();
      await host.post('/auth/logout').expect(200);
      await host.get('/auth/me').expect({ authenticated: false });
    });

    it('treats guests as logged out', () => {
      return request(app.getHttpServer()).get('/auth/me').expect({ authenticated: false });
    });
  });

  describe('host-only routes', () => {
    it.each([
      ['get', '/events'],
      ['post', '/events'],
      ['patch', '/events/1'],
      ['delete', '/events/1'],
      ['delete', '/photos/1'],
    ] as const)('%s %s needs a host login', (method, path) => {
      return request(app.getHttpServer())[method](path).expect(401);
    });

    it('rejects a forged session cookie', () => {
      return request(app.getHttpServer())
        .get('/events')
        .set('Cookie', 'photorepo_session=9999999999.forged-signature')
        .expect(401);
    });
  });

  it('returns 404 for a malformed share token without touching the database', () => {
    return request(app.getHttpServer()).get('/events/share/not a token').expect(404);
  });

  describe.skipIf(!hasDatabase)('with a database', () => {
    it('/health/ready (GET) reports the database as up', () => {
      return request(app.getHttpServer()).get('/health/ready').expect(200).expect({ status: 'ok', database: 'up' });
    });

    it('runs the full journey: host creates an event, a guest uploads with the link, the host manages it', async () => {
      const host = await loginAsHost();
      const guest = () => request(app.getHttpServer());

      // Host creates an event and gets a share token
      const created = await host.post('/events').send({ name: '  Graduation party  ' }).expect(201);
      expect(created.body).toMatchObject({ name: 'Graduation party', photoCount: 0 });
      expect(created.body.token).toMatch(/^[A-Za-z0-9_-]{22}$/);
      const { id, token } = created.body;

      // Guest opens the link and uploads
      await guest().get(`/events/share/${token}`).expect(200).expect({ name: 'Graduation party' });
      const upload = await guest()
        .post(`/events/share/${token}/photos`)
        .field('description', '  Cake time  ')
        .attach('photo', PNG, { filename: 'pixel.png', contentType: 'image/png' })
        .expect(201);
      const photoId = upload.body.id;

      const photos = await guest().get(`/events/share/${token}/photos`).expect(200);
      expect(photos.body).toEqual([expect.objectContaining({ id: photoId, description: 'Cake time', image_name: 'pixel.png' })]);

      const image = await guest().get(`/events/share/${token}/photos/${photoId}/image`).expect(200);
      expect(image.headers['content-type']).toBe('image/png');
      expect(Buffer.compare(image.body, PNG)).toBe(0);

      // Host sees the count, renames, deletes the photo, then the event
      const list = await host.get('/events').expect(200);
      expect(list.body.find((e: { id: number }) => e.id === id)).toMatchObject({ photoCount: 1 });

      await host.patch(`/events/${id}`).send({ name: 'Grad party 2026' }).expect(200);
      await guest().get(`/events/share/${token}`).expect({ name: 'Grad party 2026' });

      await host.delete(`/photos/${photoId}`).expect(204);
      await guest().get(`/events/share/${token}/photos`).expect(200).expect([]);

      await host.delete(`/events/${id}`).expect(204);
      await guest().get(`/events/share/${token}`).expect(404);
    });

    it('keeps events apart: one event’s link cannot reach another event’s photos', async () => {
      const host = await loginAsHost();
      const a = (await host.post('/events').send({ name: 'Event A' }).expect(201)).body;
      const b = (await host.post('/events').send({ name: 'Event B' }).expect(201)).body;

      const photoInA = (
        await request(app.getHttpServer())
          .post(`/events/share/${a.token}/photos`)
          .field('description', 'only for A')
          .attach('photo', PNG, { filename: 'a.png', contentType: 'image/png' })
          .expect(201)
      ).body.id;

      // Event B's gallery doesn't list it, and guessing its id through B's link is a 404
      const bPhotos = await request(app.getHttpServer()).get(`/events/share/${b.token}/photos`).expect(200);
      expect(bPhotos.body).toEqual([]);
      await request(app.getHttpServer()).get(`/events/share/${b.token}/photos/${photoInA}/image`).expect(404);

      // Deleting an event deletes its photos
      await host.delete(`/events/${a.id}`).expect(204);
      await request(app.getHttpServer()).get(`/events/share/${a.token}/photos/${photoInA}/image`).expect(404);
      await host.delete(`/events/${b.id}`).expect(204);
    });

    it('returns 404 for a well-formed token that does not exist', () => {
      return request(app.getHttpServer()).get('/events/share/AAAAAAAAAAAAAAAAAAAAAA').expect(404);
    });

    it('validates event names', async () => {
      const host = await loginAsHost();
      await host.post('/events').send({ name: '   ' }).expect(400);
      await host.post('/events').send({ name: 'x'.repeat(101) }).expect(400);
      await host.post('/events').send({}).expect(400);
    });

    describe('upload validation', () => {
      let token: string;
      let eventId: number;

      beforeAll(async () => {
        const host = await loginAsHost();
        ({ token, id: eventId } = (await host.post('/events').send({ name: 'Validation' }).expect(201)).body);
      });

      afterAll(async () => {
        const host = await loginAsHost();
        await host.delete(`/events/${eventId}`).expect(204);
      });

      const upload = () => request(app.getHttpServer()).post(`/events/share/${token}/photos`);

      it('stores the detected type, not the type the client claims', async () => {
        const res = await upload()
          .field('description', 'mislabelled png')
          .attach('photo', PNG, { filename: 'photo.jpg', contentType: 'image/jpeg' })
          .expect(201);
        const image = await request(app.getHttpServer()).get(`/events/share/${token}/photos/${res.body.id}/image`).expect(200);
        expect(image.headers['content-type']).toBe('image/png');
      });

      it('rejects a non-image file even when it claims to be an image', () => {
        return upload()
          .field('description', 'not really a picture')
          .attach('photo', Buffer.from('<html><script>alert(1)</script></html>'), { filename: 'evil.png', contentType: 'image/png' })
          .expect(400);
      });

      it('rejects an upload with no photo', () => {
        return upload().field('description', 'no file').expect(400);
      });

      it('rejects a blank description', () => {
        return upload().field('description', '   ').attach('photo', PNG, { filename: 'p.png', contentType: 'image/png' }).expect(400);
      });

      it('rejects a description over 500 characters', () => {
        return upload()
          .field('description', 'x'.repeat(501))
          .attach('photo', PNG, { filename: 'p.png', contentType: 'image/png' })
          .expect(400);
      });

      it('rejects files over 10 MB with 413', () => {
        return upload()
          .field('description', 'huge')
          .attach('photo', Buffer.concat([PNG, Buffer.alloc(MAX_UPLOAD_BYTES)]), { filename: 'huge.png', contentType: 'image/png' })
          .expect(413);
      });

      describe('thumbnails', () => {
        // Distinct bytes (data after a PNG's end marker is ignored by decoders), so we can tell which came back
        const THUMB = Buffer.concat([PNG, Buffer.from('thumbnail')]);
        const image = (id: number, query = '') =>
          request(app.getHttpServer()).get(`/events/share/${token}/photos/${id}/image${query}`).expect(200);

        it('stores a thumbnail and serves it with ?size=thumb, keeping the full image separate', async () => {
          const res = await upload()
            .field('description', 'with thumbnail')
            .attach('photo', PNG, { filename: 'p.png', contentType: 'image/png' })
            .attach('thumbnail', THUMB, { filename: 'thumb.png', contentType: 'image/png' })
            .expect(201);

          expect(Buffer.compare((await image(res.body.id, '?size=thumb')).body, THUMB)).toBe(0);
          expect(Buffer.compare((await image(res.body.id)).body, PNG)).toBe(0);
        });

        it('falls back to the full image when a photo has no thumbnail', async () => {
          const res = await upload().field('description', 'no thumbnail').attach('photo', PNG, { filename: 'p.png', contentType: 'image/png' }).expect(201);
          expect(Buffer.compare((await image(res.body.id, '?size=thumb')).body, PNG)).toBe(0);
        });

        it('rejects a thumbnail that is not an image', () => {
          return upload()
            .field('description', 'bad thumbnail')
            .attach('photo', PNG, { filename: 'p.png', contentType: 'image/png' })
            .attach('thumbnail', Buffer.from('<svg onload=alert(1)>'), { filename: 't.png', contentType: 'image/png' })
            .expect(400);
        });

        it('rejects a thumbnail over 512 KB', () => {
          return upload()
            .field('description', 'huge thumbnail')
            .attach('photo', PNG, { filename: 'p.png', contentType: 'image/png' })
            .attach('thumbnail', Buffer.concat([PNG, Buffer.alloc(MAX_THUMBNAIL_BYTES)]), { filename: 't.png', contentType: 'image/png' })
            .expect(400);
        });
      });

      it('rejects uploads to an event that does not exist', () => {
        return request(app.getHttpServer())
          .post('/events/share/AAAAAAAAAAAAAAAAAAAAAA/photos')
          .field('description', 'lost')
          .attach('photo', PNG, { filename: 'p.png', contentType: 'image/png' })
          .expect(404);
      });
    });
  });

  describe.skipIf(hasDatabase)('without a database', () => {
    it('/health/ready (GET) returns 503 while /health stays up', async () => {
      await request(app.getHttpServer()).get('/health').expect(200);
      await request(app.getHttpServer()).get('/health/ready').expect(503).expect({ status: 'error', database: 'down' });
    });
  });
});

// Separate app instance: the lockout is held in memory and would block the tests above
describe('Login throttling (e2e)', () => {
  let app: INestApplication<App>;
  const originalPassword = process.env.ADMIN_PASSWORD;

  beforeAll(async () => {
    process.env.ADMIN_PASSWORD = PASSWORD;
    app = await createApp();
  });

  afterAll(async () => {
    await app.close();
    process.env.ADMIN_PASSWORD = originalPassword;
  });

  it('blocks logins, even with the right password, after 5 wrong attempts', async () => {
    for (let i = 0; i < 5; i++) {
      await request(app.getHttpServer()).post('/auth/login').send({ password: `guess-${i}` }).expect(401);
    }
    await request(app.getHttpServer()).post('/auth/login').send({ password: PASSWORD }).expect(429);
  });
});

describe('Host login not configured (e2e)', () => {
  let app: INestApplication<App>;
  const originalPassword = process.env.ADMIN_PASSWORD;

  beforeAll(async () => {
    delete process.env.ADMIN_PASSWORD;
    app = await createApp();
  });

  afterAll(async () => {
    await app.close();
    process.env.ADMIN_PASSWORD = originalPassword;
  });

  it('refuses logins with 503 and keeps host routes closed', async () => {
    await request(app.getHttpServer()).post('/auth/login').send({ password: '' }).expect(503);
    await request(app.getHttpServer()).get('/events').expect(401);
  });
});
