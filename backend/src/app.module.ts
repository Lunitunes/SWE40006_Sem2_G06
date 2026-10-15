import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { UploadController } from './upload.controller';
import { UploadService } from './upload.service';
import { MetricsModule } from './metrics/metrics.module';
import { DatabaseService } from './database.service';

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true }), MetricsModule],
  controllers: [AppController, UploadController],
  providers: [AppService, DatabaseService, UploadService],
})
export class AppModule {}
