import { Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from './database.service';

export type PhotoSummary = {
  id: number;
  description: string;
  image_name: string;
  uploaded_at: Date;
};

@Injectable()
export class UploadService {
  constructor(private readonly db: DatabaseService) {}

  async savePhoto(description: string, originalName: string, mimeType: string, buffer: Buffer) {
    const query = `
      INSERT INTO user_photos (description, image_name, mime_type, image_data)
      VALUES ($1, $2, $3, $4) RETURNING id;
    `;
    const result = await this.db.query<{ id: number }>(query, [description, originalName, mimeType, buffer]);
    return result.rows[0].id;
  }

  // Fetch text details of all photos (excludes heavy binary data for performance)
  async getAllPhotos(): Promise<PhotoSummary[]> {
    const query = 'SELECT id, description, image_name, uploaded_at FROM user_photos ORDER BY uploaded_at DESC;';
    const result = await this.db.query<PhotoSummary>(query);
    return result.rows;
  }

  // Fetch a single photo's raw binary block by its ID
  async getPhotoById(id: number) {
    const query = 'SELECT image_data, image_name, mime_type FROM user_photos WHERE id = $1;';
    const result = await this.db.query<{ image_data: Buffer; image_name: string; mime_type: string }>(query, [id]);

    if (result.rows.length === 0) {
      throw new NotFoundException('Photo not found');
    }
    return result.rows[0];
  }
}
