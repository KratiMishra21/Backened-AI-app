import {
  Controller,
  Post,
  Get,
  Delete,
  Body,
  Param,
  UseGuards,
  Req,
} from '@nestjs/common';
import { AppsService } from './apps.service';
import { CreateAppDto } from './dto/create-app.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ResponseHelper } from '../common/helpers/response.helper';
import { ApiResponse } from '../common/interfaces/api-response.interface';

@Controller('apps')
@UseGuards(JwtAuthGuard)
export class AppsController {
  constructor(private appsService: AppsService) {}

  @Post()
  async createApp(
    @Body() createAppDto: CreateAppDto,
    @Req() req: any,
  ): Promise<ApiResponse<any>> {
    return this.appsService.createApp(req.user.id, createAppDto.config);
  }

  @Get()
  async getApps(@Req() req: any): Promise<ApiResponse<any>> {
    return this.appsService.getApps(req.user.id);
  }

  @Get(':slug')
  async getApp(
    @Param('slug') slug: string,
    @Req() req: any,
  ): Promise<ApiResponse<any>> {
    return this.appsService.getApp(req.user.id, slug);
  }

  @Delete(':slug')
  async deleteApp(
    @Param('slug') slug: string,
    @Req() req: any,
  ): Promise<ApiResponse<any>> {
    return this.appsService.deleteApp(req.user.id, slug);
  }
}
