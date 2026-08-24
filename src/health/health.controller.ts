import { Controller, Get, Inject } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { HealthService } from './health.service';

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(
    @Inject(HealthService) private readonly healthService: HealthService,
  ) {}

  @Get('live')
  @ApiOperation({ summary: 'Confirma que el proceso responde' })
  live() {
    return this.healthService.live();
  }

  @Get('ready')
  @ApiOperation({
    summary: 'Confirma que la API esta lista para recibir trafico',
  })
  async ready() {
    return this.healthService.ready();
  }
}
