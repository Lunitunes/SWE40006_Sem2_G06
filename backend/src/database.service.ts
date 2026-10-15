import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Pool, type QueryResult, type QueryResultRow } from 'pg';
import { Gauge } from 'prom-client';
import { MetricsService } from './metrics/metrics.service';

// Idempotent, so it's safe to run on every startup (compose, CI and EC2 all get the same schema)
const SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS user_photos (
    id SERIAL PRIMARY KEY,
    description TEXT NOT NULL,
    image_name TEXT NOT NULL,
    mime_type TEXT NOT NULL DEFAULT 'image/jpeg',
    image_data BYTEA NOT NULL,
    uploaded_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  ALTER TABLE user_photos ADD COLUMN IF NOT EXISTS mime_type TEXT NOT NULL DEFAULT 'image/jpeg';
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
