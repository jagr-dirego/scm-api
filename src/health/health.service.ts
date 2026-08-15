import { Injectable } from '@nestjs/common';

@Injectable()
export class HealthService {
  live() {
    return {
      status: 'ok',
      service: 'scm-api',
    };
  }

  ready() {
    return {
      status: 'ok',
      service: 'scm-api',
      checks: {
        database: 'not-configured-yet',
      },
    };
  }
}
