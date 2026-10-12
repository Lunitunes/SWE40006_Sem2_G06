import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { UploadController } from './upload.controller';
import { UploadService } from './upload.service';

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true })],
  controllers: [AppController, UploadController],
  providers: [AppService, UploadService],
})
export class AppModule {}
