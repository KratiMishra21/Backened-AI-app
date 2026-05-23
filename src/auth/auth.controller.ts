import { Controller, Post, Body, Get, UseGuards, Req } from '@nestjs/common';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';

interface AuthResponse<T> {
  success: boolean;
  data: T;
  error: null;
}

interface AuthResponseError {
  success: boolean;
  data: null;
  error: string;
}

@Controller('auth')
export class AuthController {
  constructor(private authService: AuthService) {}

  @Post('register')
  async register(
    @Body() registerDto: RegisterDto,
  ): Promise<AuthResponse<{ user: any; token: string }>> {
    const result = await this.authService.register(registerDto);
    return {
      success: true,
      data: result,
      error: null,
    };
  }

  @Post('login')
  async login(
    @Body() loginDto: LoginDto,
  ): Promise<AuthResponse<{ user: any; token: string }>> {
    const result = await this.authService.login(loginDto);
    return {
      success: true,
      data: result,
      error: null,
    };
  }

  @UseGuards(JwtAuthGuard)
  @Get('me')
  async getMe(
    @Req() req: any,
  ): Promise<AuthResponse<{ user: any }>> {
    const user = await this.authService.getMe(req.user.id);
    return {
      success: true,
      data: { user },
      error: null,
    };
  }
}
