import { describe, expect, it } from 'vitest';
import { AppController } from './app.controller';
import { AppService } from './app.service';

describe('AppController', () => {
  describe('status', () => {
    it('returns service status', () => {
      const appController = new AppController(new AppService());

      expect(appController.getStatus()).toEqual({
        service: 'scm-api',
        status: 'ok',
        version: '0.0.1',
      });
    });
  });
});
