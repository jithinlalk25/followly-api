import { Controller, Get, Request, UseGuards } from '@nestjs/common';
import { LoginGuard } from '../auth/guard/login/login.guard';
import { User } from './schema/user.schema';

@Controller('user')
@UseGuards(LoginGuard)
export class UserController {
  @Get()
  getMe(@Request() req: { user: User }) {
    return req.user;
  }
}
