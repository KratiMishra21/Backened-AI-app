export interface ApiResponse<T> {
  success: boolean;
  data: T | null;
  error: string | null;
  warnings: string[];
  meta: Record<string, any>;
}
