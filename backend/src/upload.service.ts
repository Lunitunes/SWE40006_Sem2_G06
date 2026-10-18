import { Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from './database.service';

export type PhotoSummary = {
  id: number;
  description: string;
  image_name: string;
  uploaded_at: Date;
};

export type ImageData = { data: Buffer; mimeType: string };

type NewPhoto = {
  description: string;
  originalName: string;
  image: ImageData;
  thumbnail?: ImageData;
};

// Every query is scoped to an event, so a guest holding one event's link can't read another's photos
@Injectable()
export class UploadService {
  constructor(private readonly db: DatabaseService) {}

  async savePhoto(eventId: number, photo: NewPhoto) {
    const query = `
      INSERT INTO user_photos (event_id, description, image_name, mime_type, image_data, thumb_mime_type, thumb_data)
      VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id;
    `;
    const result = await this.db.query<{ id: number }>(query, [
      eventId,
      photo.description,
      photo.originalName,
      photo.image.mimeType,
      photo.image.data,
      photo.thumbnail?.mimeType ?? null,
      photo.thumbnail?.data ?? null,
    ]);
    return result.rows[0].id;
  }

  // Fetch text details of an event's photos (excludes heavy binary data for performance)
  async getEventPhotos(eventId: number): Promise<PhotoSummary[]> {
    const query = `SELECT id, description, image_name, uploaded_at FROM user_photos
                    WHERE event_id = $1 ORDER BY uploaded_at DESC, id DESC;`;
    const result = await this.db.query<PhotoSummary>(query, [eventId]);
    return result.rows;
  }

  // A photo's image (or its thumbnail, falling back to the full image when it has none), only
  // if it belongs to the given event. Only the requested column is read, so thumbnails stay cheap.
  async getImage(eventId: number, photoId: number, variant: 'full' | 'thumb'): Promise<ImageData> {
    const query =
      variant === 'thumb'
        ? `SELECT COALESCE(thumb_data, image_data) AS data, COALESCE(thumb_mime_type, mime_type) AS mime_type
             FROM user_photos WHERE id = $1 AND event_id = $2;`
        : 'SELECT image_data AS data, mime_type FROM user_photos WHERE id = $1 AND event_id = $2;';
    const result = await this.db.query<{ data: Buffer; mime_type: string }>(query, [photoId, eventId]);

    if (result.rows.length === 0) {
      throw new NotFoundException('Photo not found');
    }
    return { data: result.rows[0].data, mimeType: result.rows[0].mime_type };
  }

  async deletePhoto(photoId: number): Promise<void> {
    const result = await this.db.query('DELETE FROM user_photos WHERE id = $1', [photoId]);
    if (!result.rowCount) throw new NotFoundException('Photo not found');
  }
}
