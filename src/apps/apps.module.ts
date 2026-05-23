import { Module } from '@nestjs/common';
import { AppsController } from './apps.controller';
import { AppsService } from './apps.service';
import { ConfigProcessorService } from './services/config-processor.service';
import { TableManagerService } from './services/table-manager.service';
import { pgPoolProvider, PG_POOL } from './providers/pg-pool.provider';

@Module({
  controllers: [AppsController],
  providers: [
    AppsService,
    ConfigProcessorService,
    TableManagerService,
    pgPoolProvider,
  ],
  exports: [AppsService, ConfigProcessorService, TableManagerService, pgPoolProvider, PG_POOL],
})
export class AppsModule {}
