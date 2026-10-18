/// <reference types="multer" />
import { BadRequestException, Body, Controller, Get, Param, ParseIntPipe, Post, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { detectImageType } from '../image-type';
import { UploadService, type PhotoSummary } from '../upload.service';
import { EventsService, type PublicEvent } from './events.service';

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
export const MAX_DESCRIPTION_LENGTH = 500;

// Guest routes. Access is granted by the event's share token in the URL (from the host's QR code
// or link), with no account needed, as the brief describes
@Controller('events/share/:token')
export class ShareController {
  constructor(
    private readonly events: EventsService,
    private readonly uploads: UploadService,
  ) {}

  @Get()
  async getEvent(@Param('token') token: string): Promise<{ name: string }> {
    const event = await this.events.findByToken(token);
    return { name: event.name };
  }

  @Get('photos')
  async listPhotos(@Param('token') token: string): Promise<PhotoSummary[]> {
    const event: PublicEvent = await this.events.findByToken(token);
    return this.uploads.getEventPhotos(event.id);
  }

  @Post('photos')
  // Files over the limit are rejected by multer with 413 Payload Too Large
  @UseInterceptors(FileInterceptor('photo', { limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 } }))
  async uploadPhoto(
    @Param('token') token: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body('description') description: string | undefined,
  ) {
    const event = await this.events.findByToken(token);
    if (!file) throw new BadRequestException('No photo file uploaded.');

    const mimeType = detectImageType(file.buffer);
    if (!mimeType) throw new BadRequestException('Only JPEG, PNG, GIF, WebP or HEIC images can be uploaded.');

    const text = description?.trim();
    if (!text) throw new BadRequestException('Description is required.');
    if (text.length > MAX_DESCRIPTION_LENGTH) {
      throw new BadRequestException(`Description must be ${MAX_DESCRIPTION_LENGTH} characters or fewer.`);
    }

    const photoId = await this.uploads.savePhoto(event.id, text, file.originalname, mimeType, file.buffer);
    return { success: true, message: 'Photo uploaded.', id: photoId };
  }

  // Raw image for an <img> tag; only served if the photo belongs to this event
  @Get('photos/:id/image')
  async getImage(@Param('token') token: string, @Param('id', ParseIntPipe) id: number, @Res() res: Response) {
    const event = await this.events.findByToken(token);
    const photo = await this.uploads.getPhoto(event.id, id);

    // Serve with the type detected at upload, so PNG/HEIC photos aren't mislabelled as JPEG
    res.setHeader('Content-Type', photo.mime_type);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    // Private: the image is only meant for people holding the event link
    res.setHeader('Cache-Control', 'private, max-age=86400');
    res.send(photo.image_data);
  }
}
