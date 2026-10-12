import { Injectable, OnModuleInit, OnModuleDestroy, NotFoundException } from '@nestjs/common';
import { Pool } from 'pg';

@Injectable()
export class UploadService implements OnModuleInit, OnModuleDestroy {
  private pool: Pool;

  onModuleInit() {
    this.pool = new Pool({
      user: process.env.DB_USER,
      host: process.env.DB_HOST,
      database: process.env.DB_NAME,
      password: process.env.DB_PASSWORD,
      port: parseInt(process.env.DB_PORT || '5432', 10),
    });
  }

  async savePhoto(description: string, originalName: string, buffer: Buffer) {
    const query = `
      INSERT INTO user_photos (description, image_name, image_data)
      VALUES ($1, $2, $3) RETURNING id;
    `;
    const values = [description, originalName, buffer];
    const result = await this.pool.query(query, values);
    return result.rows[0].id;
  }

  // Fetch text details of all photos (excludes heavy binary data for performance)
  async getAllPhotos() {
    const query = 'SELECT id, description, image_name, uploaded_at FROM user_photos ORDER BY uploaded_at DESC;';
    const result = await this.pool.query(query);
    return result.rows;
  }

  // Fetch a single photo's raw binary block by its ID
  async getPhotoById(id: number) {
    const query = 'SELECT image_data, image_name FROM user_photos WHERE id = \$1;';
    const result = await this.pool.query(query, [id]);
    
    if (result.rows.length === 0) {
      throw new NotFoundException('Photo not found');
    }
    return result.rows[0];
  }

  async onModuleDestroy() {
    await this.pool.end();
  }
}
