import { Controller, Post, Get, Param, Res, UseInterceptors, UploadedFile, Body, BadRequestException, ParseIntPipe } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Response } from 'express';
import { UploadService } from './upload.service';

@Controller('upload')
export class UploadController {
  constructor(private readonly uploadService: UploadService) {}

  @Post()
  @UseInterceptors(FileInterceptor('photo'))
  async uploadPhoto(
    @UploadedFile() file: any,
    @Body('description') description: string,
  ) {
    if (!file) throw new BadRequestException('No photo file uploaded.');
    if (!description) throw new BadRequestException('Description is required.');

    const photoId = await this.uploadService.savePhoto(description, file.originalname, file.buffer);
    return { success: true, message: '🎉 Photo successfully saved directly to PostgreSQL!', id: photoId };
  }

  // Get a list of all photo details
  @Get('all')
  async getAllPhotos() {
    return await this.uploadService.getAllPhotos();
  }

  // Stream the raw image file buffer directly into an <img> tag
  @Get('image/:id')
  async getRawImage(@Param('id', ParseIntPipe) id: number, @Res() res: Response) {
    const photo = await this.uploadService.getPhotoById(id);
    
    // Set response content headers so the browser treats it like a real image file
    res.setHeader('Content-Type', 'image/jpeg'); 
    res.send(photo.image_data);
  }
}
