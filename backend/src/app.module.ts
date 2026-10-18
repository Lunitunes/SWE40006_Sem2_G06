import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { UploadService } from './upload.service';
import { MetricsModule } from './metrics/metrics.module';
import { DatabaseService } from './database.service';
import { AuthController } from './auth/auth.controller';
import { AuthService } from './auth/auth.service';
import { HostGuard } from './auth/host.guard';
import { EventsController } from './events/events.controller';
import { EventsService } from './events/events.service';
import { ShareController } from './events/share.controller';

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true }), MetricsModule],
  controllers: [AppController, AuthController, EventsController, ShareController],
  providers: [AppService, DatabaseService, UploadService, AuthService, HostGuard, EventsService],
})
export class AppModule {}
