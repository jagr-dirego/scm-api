import { NestFactory } from '@nestjs/core';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { appConfig } from './config/app.config';

async function bootstrap() {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({ logger: false }),
  );

  app.setGlobalPrefix('api/v1');
  app.enableCors({
    origin: appConfig.corsOrigins,
    credentials: true,
  });

  if (appConfig.openApiEnabled) {
    const openApiConfig = new DocumentBuilder()
      .setTitle('DIREGO SCM API')
      .setDescription('Backend API de DIREGO SCM')
      .setVersion('1.0')
      .addBearerAuth()
      .build();
    const document = SwaggerModule.createDocument(app, openApiConfig);
    SwaggerModule.setup('api/v1/docs', app, document);
  }

  await app.listen(appConfig.port, '0.0.0.0');
}

void bootstrap();
