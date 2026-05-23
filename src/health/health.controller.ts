import { Controller, Get } from '@nestjs/common';
import { PrismaService } from '../prisma.service';

@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async check() {
    let dbStatus: 'connected' | 'error' = 'error';

    try {
      await this.prisma.$queryRaw`SELECT 1`;
      dbStatus = 'connected';
    } catch {
      dbStatus = 'error';
    }

    return {
      success: true,
      data: {
        status: 'ok',
        timestamp: new Date().toISOString(),
        database: dbStatus,
      },
      error: null,
      warnings: [],
      meta: {},
    };
  }
}
