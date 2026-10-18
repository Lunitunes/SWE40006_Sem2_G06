import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from './../src/app.module.js';

describe('AppController (e2e)', () => {
  let app: INestApplication<App>;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  it('/ (GET)', () => {
    return request(app.getHttpServer())
      .get('/')
      .expect(200)
      .expect('Hello World!');
  });

  it('/health (GET)', () => {
    return request(app.getHttpServer())
      .get('/health')
      .expect(200)
      .expect({ status: 'ok' });
  });

  it('/metrics (GET) records request performance', async () => {
    await request(app.getHttpServer()).get('/health').expect(200);

    const res = await request(app.getHttpServer())
      .get('/metrics')
      .expect(200)
      .expect('Content-Type', /text\/plain/);

    expect(res.text).toContain('http_requests_total{method="GET",route="/health",status_code="200"} 1');
    expect(res.text).toContain('http_request_duration_seconds_bucket');
    // The scrape endpoint itself is excluded so Prometheus traffic doesn't skew request stats
    expect(res.text).not.toContain('route="/metrics"');
  });

  it('records 4xx responses with the route template, not the raw URL', async () => {
    await request(app.getHttpServer()).get('/events/share/SOMETOKENSOMETOKEN/photos/not-a-number/image').expect(400);

    const res = await request(app.getHttpServer()).get('/metrics').expect(200);
    expect(res.text).toContain('route="/events/share/:token/photos/:id/image",status_code="400"');
  });

  afterEach(async () => {
    await app.close();
  });
});
