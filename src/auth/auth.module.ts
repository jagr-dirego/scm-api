import { Module } from '@nestjs/common';
import { appConfig } from '../config/app.config';
import { PASSWORD_HASH_OPTIONS } from './password.constants';
import { PasswordService } from './password.service';

@Module({
  providers: [
    { provide: PASSWORD_HASH_OPTIONS, useValue: appConfig.argon2 },
    PasswordService,
  ],
  exports: [PasswordService],
})
export class AuthModule {}
