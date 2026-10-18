import { Body, Controller, Delete, Get, HttpCode, Param, ParseIntPipe, Patch, Post, UseGuards } from '@nestjs/common';
import { HostGuard } from '../auth/host.guard';
import { UploadService } from '../upload.service';
import { EventsService, validateEventName, type EventSummary } from './events.service';

// Host-only: create, list, rename and delete events, and delete individual photos
@Controller()
@UseGuards(HostGuard)
export class EventsController {
  constructor(
    private readonly events: EventsService,
    private readonly uploads: UploadService,
  ) {}

  @Post('events')
  create(@Body('name') name: unknown): Promise<EventSummary> {
    return this.events.create(validateEventName(name));
  }

  @Get('events')
  list(): Promise<EventSummary[]> {
    return this.events.list();
  }

  @Patch('events/:id')
  rename(@Param('id', ParseIntPipe) id: number, @Body('name') name: unknown): Promise<EventSummary> {
    return this.events.rename(id, validateEventName(name));
  }

  @Delete('events/:id')
  @HttpCode(204)
  async remove(@Param('id', ParseIntPipe) id: number): Promise<void> {
    await this.events.remove(id);
  }

  @Delete('photos/:id')
  @HttpCode(204)
  async removePhoto(@Param('id', ParseIntPipe) id: number): Promise<void> {
    await this.uploads.deletePhoto(id);
  }
}
