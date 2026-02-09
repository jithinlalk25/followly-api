import { Controller, Get, Request, UseGuards } from '@nestjs/common';
import { LoginGuard } from '../auth/guard/login/login.guard';
import { User } from './schema/user.schema';

import { UserService } from './user.service';

@Controller('user')
@UseGuards(LoginGuard)
export class UserController {
  constructor(private readonly userService: UserService) {}

  @Get()
  getMe(@Request() req: { user: User }) {
    return req.user;
  }

  @Get('summary')
  getSummary(@Request() req: { user: User }) {
    return this.userService.getSummary(req.user._id);
  }
}
