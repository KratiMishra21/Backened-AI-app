import { ApiResponse } from '../interfaces/api-response.interface';

export class ResponseHelper {
  static success<T>(
    data: T,
    warnings: string[] = [],
    meta: Record<string, any> = {},
  ): ApiResponse<T> {
    return {
      success: true,
      data,
      error: null,
      warnings,
      meta,
    };
  }

  static error<T = null>(
    message: string,
    meta: Record<string, any> = {},
  ): ApiResponse<T> {
    return {
      success: false,
      data: null,
      error: message,
      warnings: [],
      meta,
    };
  }
}
