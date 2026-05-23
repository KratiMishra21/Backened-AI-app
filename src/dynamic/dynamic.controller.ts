import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Param,
  Body,
  Query,
  UseGuards,
  Req,
} from '@nestjs/common';
import { DynamicService, CrudQuery } from './dynamic.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@Controller('apps/:slug/:entity')
@UseGuards(JwtAuthGuard)
export class DynamicController {
  constructor(private readonly dynamicService: DynamicService) {}

  @Get()
  list(
    @Param('slug') slug: string,
    @Param('entity') entity: string,
    @Query() query: CrudQuery,
    @Req() req: any,
  ) {
    return this.dynamicService.list(slug, entity, query, req.user.id);
  }

  @Post()
  create(
    @Param('slug') slug: string,
    @Param('entity') entity: string,
    @Body() body: any,
    @Req() req: any,
  ) {
    return this.dynamicService.create(slug, entity, body, req.user.id);
  }

  @Get(':id')
  getOne(
    @Param('slug') slug: string,
    @Param('entity') entity: string,
    @Param('id') id: string,
    @Req() req: any,
  ) {
    return this.dynamicService.getOne(slug, entity, id, req.user.id);
  }

  @Put(':id')
  update(
    @Param('slug') slug: string,
    @Param('entity') entity: string,
    @Param('id') id: string,
    @Body() body: any,
    @Req() req: any,
  ) {
    return this.dynamicService.update(slug, entity, id, body, req.user.id);
  }

  @Delete(':id')
  remove(
    @Param('slug') slug: string,
    @Param('entity') entity: string,
    @Param('id') id: string,
    @Req() req: any,
  ) {
    return this.dynamicService.remove(slug, entity, id, req.user.id);
  }
}
