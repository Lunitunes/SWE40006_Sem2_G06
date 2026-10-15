/// <reference types="multer" />
import { Controller, Post, Get, Param, Res, UseInterceptors, UploadedFile, Body, BadRequestException, ParseIntPipe } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { detectImageType } from './image-type';
import { UploadService, type PhotoSummary } from './upload.service';

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
export const MAX_DESCRIPTION_LENGTH = 500;

@Controller('upload')
export class UploadController {
  constructor(private readonly uploadService: UploadService) {}

  @Post()
  // Files over the limit are rejected by multer with 413 Payload Too Large
  @UseInterceptors(FileInterceptor('photo', { limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 } }))
  async uploadPhoto(
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body('description') description: string | undefined,
  ) {
    if (!file) throw new BadRequestException('No photo file uploaded.');

    const mimeType = detectImageType(file.buffer);
    if (!mimeType) throw new BadRequestException('Only JPEG, PNG, GIF, WebP or HEIC images can be uploaded.');

    const text = description?.trim();
    if (!text) throw new BadRequestException('Description is required.');
    if (text.length > MAX_DESCRIPTION_LENGTH) {
      throw new BadRequestException(`Description must be ${MAX_DESCRIPTION_LENGTH} characters or fewer.`);
    }

    const photoId = await this.uploadService.savePhoto(text, file.originalname, mimeType, file.buffer);
    return { success: true, message: 'Photo uploaded.', id: photoId };
  }

  // Get a list of all photo details
  @Get('all')
  async getAllPhotos(): Promise<PhotoSummary[]> {
    return await this.uploadService.getAllPhotos();
  }

  // Stream the raw image file buffer directly into an <img> tag
  @Get('image/:id')
  async getRawImage(@Param('id', ParseIntPipe) id: number, @Res() res: Response) {
    const photo = await this.uploadService.getPhotoById(id);

    // Serve with the type detected at upload, so PNG/HEIC photos aren't mislabelled as JPEG
    res.setHeader('Content-Type', photo.mime_type);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    // A photo never changes once uploaded, so browsers can cache it indefinitely
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.send(photo.image_data);
  }
}
