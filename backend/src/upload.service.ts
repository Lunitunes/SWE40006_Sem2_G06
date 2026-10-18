import { Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from './database.service';

export type PhotoSummary = {
  id: number;
  description: string;
  image_name: string;
  uploaded_at: Date;
};

// Every query is scoped to an event, so a guest holding one event's link can't read another's photos
@Injectable()
export class UploadService {
  constructor(private readonly db: DatabaseService) {}

  async savePhoto(eventId: number, description: string, originalName: string, mimeType: string, buffer: Buffer) {
    const query = `
      INSERT INTO user_photos (event_id, description, image_name, mime_type, image_data)
      VALUES ($1, $2, $3, $4, $5) RETURNING id;
    `;
    const result = await this.db.query<{ id: number }>(query, [eventId, description, originalName, mimeType, buffer]);
    return result.rows[0].id;
  }

  // Fetch text details of an event's photos (excludes heavy binary data for performance)
  async getEventPhotos(eventId: number): Promise<PhotoSummary[]> {
    const query = `SELECT id, description, image_name, uploaded_at FROM user_photos
                    WHERE event_id = $1 ORDER BY uploaded_at DESC, id DESC;`;
    const result = await this.db.query<PhotoSummary>(query, [eventId]);
    return result.rows;
  }

  // Fetch a single photo's raw binary block, only if it belongs to the given event
  async getPhoto(eventId: number, photoId: number) {
    const query = 'SELECT image_data, image_name, mime_type FROM user_photos WHERE id = $1 AND event_id = $2;';
    const result = await this.db.query<{ image_data: Buffer; image_name: string; mime_type: string }>(query, [photoId, eventId]);

    if (result.rows.length === 0) {
      throw new NotFoundException('Photo not found');
    }
    return result.rows[0];
  }

  async deletePhoto(photoId: number): Promise<void> {
    const result = await this.db.query('DELETE FROM user_photos WHERE id = $1', [photoId]);
    if (!result.rowCount) throw new NotFoundException('Photo not found');
  }
}
