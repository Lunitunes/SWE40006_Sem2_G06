/// <reference types="multer" />
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Query,
  Res,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { detectImageType } from '../image-type';
import { UploadService, type ImageData, type PhotoSummary } from '../upload.service';
import { EventsService, type PublicEvent } from './events.service';

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
// The browser makes thumbnails at ~480px (tens of KB); anything near this is not a thumbnail
export const MAX_THUMBNAIL_BYTES = 512 * 1024;
export const MAX_DESCRIPTION_LENGTH = 500;

type UploadedPhotoFiles = { photo?: Express.Multer.File[]; thumbnail?: Express.Multer.File[] };

// Checked by content, not by the name or type the client sends
function asImage(file: Express.Multer.File, what: string): ImageData {
  const mimeType = detectImageType(file.buffer);
  if (!mimeType) throw new BadRequestException(`Only JPEG, PNG, GIF, WebP or HEIC images can be uploaded (${what}).`);
  return { data: file.buffer, mimeType };
}

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
  @UseInterceptors(
    FileFieldsInterceptor(
      [
        { name: 'photo', maxCount: 1 },
        { name: 'thumbnail', maxCount: 1 },
      ],
      { limits: { fileSize: MAX_UPLOAD_BYTES, files: 2 } },
    ),
  )
  async uploadPhoto(
    @Param('token') token: string,
    @UploadedFiles() files: UploadedPhotoFiles | undefined,
    @Body('description') description: string | undefined,
  ) {
    const event = await this.events.findByToken(token);
    const file = files?.photo?.[0];
    if (!file) throw new BadRequestException('No photo file uploaded.');
    const image = asImage(file, 'photo');

    // Optional: older clients and API uploads may not send one (the gallery then uses the full image)
    const thumbFile = files?.thumbnail?.[0];
    let thumbnail: ImageData | undefined;
    if (thumbFile) {
      if (thumbFile.size > MAX_THUMBNAIL_BYTES) {
        throw new BadRequestException(`Thumbnail must be ${MAX_THUMBNAIL_BYTES / 1024} KB or smaller.`);
      }
      thumbnail = asImage(thumbFile, 'thumbnail');
    }

    const text = description?.trim();
    if (!text) throw new BadRequestException('Description is required.');
    if (text.length > MAX_DESCRIPTION_LENGTH) {
      throw new BadRequestException(`Description must be ${MAX_DESCRIPTION_LENGTH} characters or fewer.`);
    }

    const photoId = await this.uploads.savePhoto(event.id, {
      description: text,
      originalName: file.originalname,
      image,
      thumbnail,
    });
    return { success: true, message: 'Photo uploaded.', id: photoId };
  }

  // Raw image for an <img> tag; only served if the photo belongs to this event.
  // ?size=thumb returns the small preview the gallery uses (or the full image if there isn't one).
  @Get('photos/:id/image')
  async getImage(
    @Param('token') token: string,
    @Param('id', ParseIntPipe) id: number,
    @Query('size') size: string | undefined,
    @Res() res: Response,
  ) {
    const event = await this.events.findByToken(token);
    const image = await this.uploads.getImage(event.id, id, size === 'thumb' ? 'thumb' : 'full');

    // Serve with the type detected at upload, so PNG/HEIC photos aren't mislabelled as JPEG
    res.setHeader('Content-Type', image.mimeType);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    // Private: the image is only meant for people holding the event link
    res.setHeader('Cache-Control', 'private, max-age=86400');
    res.send(image.data);
  }
}
