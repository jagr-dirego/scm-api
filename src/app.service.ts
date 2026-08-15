import { Injectable } from '@nestjs/common';

@Injectable()
export class AppService {
  getStatus() {
    return {
      service: 'scm-api',
      status: 'ok',
      version: '0.0.1',
    };
  }
}
