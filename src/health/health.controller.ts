import { Controller, Get, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { HealthService } from './health.service';

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Get('live')
  @ApiOperation({ summary: 'Confirma que el proceso responde' })
  live() {
    return this.healthService.live();
  }

  @Get('ready')
  @HttpCode(HttpStatus.SERVICE_UNAVAILABLE)
  @ApiOperation({
    summary: 'Confirma que la API esta lista para recibir trafico',
  })
  ready() {
    return this.healthService.ready();
  }
}
