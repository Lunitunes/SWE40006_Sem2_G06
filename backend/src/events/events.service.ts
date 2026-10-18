import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { DatabaseService } from '../database.service';

export const MAX_EVENT_NAME_LENGTH = 100;

// 16 random bytes = 128 bits, encoded as 22 URL-safe characters: not guessable
const newToken = () => randomBytes(16).toString('base64url');
// Anything that couldn't be a token is rejected before touching the database
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{16,64}$/;

export type EventSummary = {
  id: number;
  name: string;
  token: string;
  createdAt: Date;
  photoCount: number;
  lastUploadAt: Date | null;
};

export type PublicEvent = { id: number; name: string };

type EventRow = {
  id: number;
  name: string;
  token: string;
  created_at: Date;
  photo_count: string;
  last_upload_at: Date | null;
};

const toSummary = (row: EventRow): EventSummary => ({
  id: row.id,
  name: row.name,
  token: row.token,
  createdAt: row.created_at,
  photoCount: Number(row.photo_count),
  lastUploadAt: row.last_upload_at,
});

export function validateEventName(name: unknown): string {
  const text = typeof name === 'string' ? name.trim() : '';
  if (!text) throw new BadRequestException('Event name is required.');
  if (text.length > MAX_EVENT_NAME_LENGTH) {
    throw new BadRequestException(`Event name must be ${MAX_EVENT_NAME_LENGTH} characters or fewer.`);
  }
  return text;
}

@Injectable()
export class EventsService {
  constructor(private readonly db: DatabaseService) {}

  async create(name: string): Promise<EventSummary> {
    const result = await this.db.query<EventRow>(
      `INSERT INTO events (name, token) VALUES ($1, $2)
       RETURNING id, name, token, created_at, 0 AS photo_count, NULL::timestamptz AS last_upload_at`,
      [name, newToken()],
    );
    return toSummary(result.rows[0]);
  }

  async list(): Promise<EventSummary[]> {
    const result = await this.db.query<EventRow>(
      `SELECT e.id, e.name, e.token, e.created_at,
              count(p.id) AS photo_count, max(p.uploaded_at) AS last_upload_at
         FROM events e
         LEFT JOIN user_photos p ON p.event_id = e.id
        GROUP BY e.id
        ORDER BY e.created_at DESC`,
    );
    return result.rows.map(toSummary);
  }

  async rename(id: number, name: string): Promise<EventSummary> {
    const result = await this.db.query<{ id: number }>('UPDATE events SET name = $2 WHERE id = $1 RETURNING id', [id, name]);
    if (!result.rows.length) throw new NotFoundException('Event not found.');
    return (await this.list()).find((e) => e.id === id)!;
  }

  // Deleting an event deletes its photos too (ON DELETE CASCADE)
  async remove(id: number): Promise<void> {
    const result = await this.db.query('DELETE FROM events WHERE id = $1', [id]);
    if (!result.rowCount) throw new NotFoundException('Event not found.');
  }

  // Guests only ever see an event through its token; unknown and malformed tokens look the same
  async findByToken(token: string): Promise<PublicEvent> {
    if (!TOKEN_PATTERN.test(token)) throw new NotFoundException('Event not found.');
    const result = await this.db.query<PublicEvent>('SELECT id, name FROM events WHERE token = $1', [token]);
    if (!result.rows.length) throw new NotFoundException('Event not found.');
    return result.rows[0];
  }
}
