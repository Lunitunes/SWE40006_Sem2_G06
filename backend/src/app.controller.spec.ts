import { Test, TestingModule } from '@nestjs/testing';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { DatabaseService } from './database.service.js';

describe('AppController', () => {
  let appController: AppController;
  let databaseHealthy: boolean;

  beforeEach(async () => {
    databaseHealthy = true;
    const app: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [AppService, { provide: DatabaseService, useValue: { isHealthy: async () => databaseHealthy } }],
    }).compile();

    appController = app.get<AppController>(AppController);
  });

  describe('root', () => {
    it('should return "Hello World!"', () => {
      expect(appController.getHello()).toBe('Hello World!');
    });
  });

  describe('health', () => {
    it('should return a healthy status', () => {
      expect(appController.getHealth()).toEqual({
        status: 'ok',
      })
    })
  })

  describe('readiness', () => {
    it('should report ready when the database is reachable', async () => {
      await expect(appController.getReadiness()).resolves.toEqual({ status: 'ok', database: 'up' });
    });

    it('should return 503 when the database is down', async () => {
      databaseHealthy = false;
      await expect(appController.getReadiness()).rejects.toMatchObject({ status: 503 });
    });
  });
});
