import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { ApiResponse } from '../interfaces/api-response.interface';
import { ResponseHelper } from '../helpers/response.helper';

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = 'Internal server error';
    let meta: Record<string, any> = {};

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const exceptionResponse = exception.getResponse();

      if (typeof exceptionResponse === 'string') {
        message = exceptionResponse;
      } else if (typeof exceptionResponse === 'object') {
        const responseObj = exceptionResponse as any;
        // class-validator returns an array in responseObj.message
        if (Array.isArray(responseObj.message)) {
          message = 'Validation failed';
          meta = { details: responseObj.message };
        } else {
          message = responseObj.message || message;
          if (responseObj.errors) meta = { errors: responseObj.errors };
        }
      }
    } else if (this.isPrismaError(exception, 'P2002')) {
      status = HttpStatus.CONFLICT;
      const field = (exception as any).meta?.target?.[0] || 'field';
      message = `A record with this ${field} already exists`;
      meta = { code: 'P2002', field };
    } else if (this.isPrismaError(exception, 'P2025')) {
      status = HttpStatus.NOT_FOUND;
      message = 'The requested resource was not found';
      meta = { code: 'P2025' };
    } else if (this.isPrismaError(exception, 'P2003')) {
      status = HttpStatus.CONFLICT;
      message = 'Related resource not found';
      meta = { code: 'P2003' };
    } else {
      // Log 500s with timestamp and route — never expose stack trace
      this.logger.error(
        `[${new Date().toISOString()}] ${request.method} ${request.url} — ${
          exception instanceof Error ? exception.message : String(exception)
        }`,
      );
      status = HttpStatus.INTERNAL_SERVER_ERROR;
      message = 'Internal server error';
    }

    const apiResponse: ApiResponse<null> = ResponseHelper.error(message, meta);
    response.status(status).json(apiResponse);
  }

  private isPrismaError(exception: unknown, code: string): boolean {
    return (
      exception !== null &&
      typeof exception === 'object' &&
      'code' in exception &&
      (exception as any).code === code
    );
  }
}
