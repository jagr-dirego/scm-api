import { NestFactory } from '@nestjs/core';
import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { AppModule } from './app.module';
import { appConfig } from './config/app.config';
import {
  applicationLogger,
  applicationNestLogger,
} from './observability/application-logger';
import { createFastifyAdapter } from './observability/fastify-adapter';
import { configureOpenApi } from './openapi/configure-openapi';

async function bootstrap() {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    createFastifyAdapter(applicationLogger),
    { logger: applicationNestLogger },
  );

  app.setGlobalPrefix('api/v1');
  app.enableCors({
    origin: appConfig.corsOrigins,
    credentials: true,
  });

  configureOpenApi(app, appConfig.openApiEnabled);

  await app.listen(appConfig.port, '0.0.0.0');
}

void bootstrap();
