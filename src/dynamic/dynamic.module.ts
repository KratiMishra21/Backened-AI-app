import { Module } from '@nestjs/common';
import { DynamicService } from './dynamic.service';
import { DynamicController } from './dynamic.controller';
import { AppsModule } from '../apps/apps.module';

@Module({
  imports: [AppsModule],
  providers: [DynamicService],
  controllers: [DynamicController],
})
export class DynamicModule {}
