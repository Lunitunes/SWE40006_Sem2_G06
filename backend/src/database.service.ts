import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Pool, type QueryResult, type QueryResultRow } from 'pg';
import { Gauge } from 'prom-client';
import { MetricsService } from './metrics/metrics.service';

// Idempotent, so it's safe to run on every startup (compose, CI and EC2 all get the same schema)
const SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS events (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    -- Random share token: knowing it is what grants guests access to the event
    token TEXT NOT NULL UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );

  CREATE TABLE IF NOT EXISTS user_photos (
    id SERIAL PRIMARY KEY,
    event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    description TEXT NOT NULL,
    image_name TEXT NOT NULL,
    mime_type TEXT NOT NULL DEFAULT 'image/jpeg',
    image_data BYTEA NOT NULL,
    uploaded_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );

  -- Upgrades for databases created before these columns existed
  ALTER TABLE user_photos ADD COLUMN IF NOT EXISTS mime_type TEXT NOT NULL DEFAULT 'image/jpeg';
  ALTER TABLE user_photos ADD COLUMN IF NOT EXISTS event_id INTEGER REFERENCES events(id) ON DELETE CASCADE;
  -- Small preview made by the browser at upload time, so galleries don't download full photos.
  -- NULL for older photos and API uploads without one; those fall back to the full image.
  ALTER TABLE user_photos ADD COLUMN IF NOT EXISTS thumb_data BYTEA;
  ALTER TABLE user_photos ADD COLUMN IF NOT EXISTS thumb_mime_type TEXT;

  -- Photos uploaded before events existed go into one "Earlier photos" event, so nothing is lost
  DO $$
  DECLARE legacy_event INTEGER;
  BEGIN
    IF EXISTS (SELECT 1 FROM user_photos WHERE event_id IS NULL) THEN
      INSERT INTO events (name, token)
        VALUES ('Earlier photos', replace(gen_random_uuid()::text, '-', ''))
        RETURNING id INTO legacy_event;
      UPDATE user_photos SET event_id = legacy_event WHERE event_id IS NULL;
    END IF;
  END $$;

  ALTER TABLE user_photos ALTER COLUMN event_id SET NOT NULL;
  CREATE INDEX IF NOT EXISTS user_photos_event_uploaded_idx ON user_photos (event_id, uploaded_at DESC);
`;

const HEALTH_TIMEOUT_MS = 2000;

@Injectable()
export class DatabaseService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DatabaseService.name);
  private pool: Pool;
  private schemaReady: Promise<void> | null = null;

  constructor(metricsService: MetricsService) {
    const db = this;
    // Checked on every Prometheus scrape; feeds the DatabaseDown alert
    new Gauge({
      name: 'database_up',
      help: 'Whether the backend can reach PostgreSQL (1 = up, 0 = down)',
      registers: [metricsService.registry],
      async collect() {
        this.set((await db.isHealthy()) ? 1 : 0);
      },
    });
  }

  onModuleInit() {
    this.pool = new Pool({
      user: process.env.DB_USER,
      host: process.env.DB_HOST,
      database: process.env.DB_NAME,
      password: process.env.DB_PASSWORD,
      port: parseInt(process.env.DB_PORT || '5432', 10),
      connectionTimeoutMillis: 5000,
    });
    // Without a listener, an idle client losing its connection would crash the process
    this.pool.on('error', (err) => this.logger.error(`Idle database client error: ${err.message}`));

    // Create the schema at startup so problems show up early, but don't crash if the
    // database isn't reachable yet; it's retried on the next query
    this.ensureSchema().catch((err) => this.logger.error(`Database not ready: ${err.message}`));
  }

  async query<T extends QueryResultRow>(text: string, values?: unknown[]): Promise<QueryResult<T>> {
    await this.ensureSchema();
    return this.pool.query<T>(text, values);
  }

  async isHealthy(): Promise<boolean> {
    let timer: NodeJS.Timeout;
    const timeout = new Promise<boolean>((resolve) => {
      timer = setTimeout(() => resolve(false), HEALTH_TIMEOUT_MS);
    });
    const check = this.pool.query('SELECT 1').then(
      () => true,
      () => false,
    );
    return Promise.race([check, timeout]).finally(() => clearTimeout(timer));
  }

  private ensureSchema(): Promise<void> {
    this.schemaReady ??= this.pool.query(SCHEMA_SQL).then(
      () => undefined,
      (err) => {
        this.schemaReady = null;
        throw err;
      },
    );
    return this.schemaReady;
  }

  async onModuleDestroy() {
    await this.pool.end();
  }
}
