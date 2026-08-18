import { Module } from '@nestjs/common';
import { appConfig } from '../config/app.config';
import { DatabaseModule } from '../database/database.module';
import { AuthController } from './auth.controller';
import { AUTH_SECURITY_OPTIONS } from './auth.constants';
import { AuthRepository } from './auth.repository';
import { AuthService } from './auth.service';
import { PASSWORD_HASH_OPTIONS } from './password.constants';
import { PasswordService } from './password.service';

@Module({
  imports: [DatabaseModule],
  controllers: [AuthController],
  providers: [
    { provide: PASSWORD_HASH_OPTIONS, useValue: appConfig.argon2 },
    { provide: AUTH_SECURITY_OPTIONS, useValue: appConfig.auth },
    AuthRepository,
    AuthService,
    PasswordService,
  ],
  exports: [AuthService, PasswordService],
})
export class AuthModule {}
