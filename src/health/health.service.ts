import {
  Inject,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { DatabaseService } from '../database/database.service';

@Injectable()
export class HealthService {
  constructor(
    @Inject(DatabaseService) private readonly databaseService: DatabaseService,
  ) {}

  live() {
    return {
      status: 'ok',
      service: 'scm-api',
    };
  }

  async ready() {
    try {
      await this.databaseService.checkConnection();

      return {
        status: 'ok',
        service: 'scm-api',
        checks: { database: 'available' },
      };
    } catch {
      throw new ServiceUnavailableException({
        status: 'unavailable',
        service: 'scm-api',
        checks: { database: 'unavailable' },
      });
    }
  }
}
