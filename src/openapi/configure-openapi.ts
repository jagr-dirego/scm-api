import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

export function configureOpenApi(
  app: NestFastifyApplication,
  enabled: boolean,
): void {
  if (!enabled) return;

  const config = new DocumentBuilder()
    .setTitle('DIREGO SCM API')
    .setDescription('Backend API de DIREGO SCM')
    .setVersion('1.0')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/v1/docs', app, document);
}
