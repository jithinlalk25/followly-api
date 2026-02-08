import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { verifyToken } from '@clerk/backend';
import { CLERK_JWKS_PUBLIC_KEY } from 'utils/constant';
import { UserService } from 'src/user/user.service';

@Injectable()
export class LoginGuard implements CanActivate {
  constructor(private readonly userService: UserService) {}

  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest();
    const token = request.headers.authorization?.replace('Bearer ', '');

    if (!token) {
      throw new UnauthorizedException();
    }

    try {
      const verifiedToken = await verifyToken(token, {
        jwtKey: CLERK_JWKS_PUBLIC_KEY,
        clockSkewInMs: 60000,
      });

      const user = await this.userService.getOrCreateByClerkUserId(
        verifiedToken.sub,
      );
      request.user = user;
      return true;
    } catch (error) {
      console.log('error', error);
      throw new UnauthorizedException();
    }
  }
}
