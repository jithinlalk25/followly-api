import { Module, forwardRef } from '@nestjs/common';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { LoginGuard } from './guard/login/login.guard';
import { UserModule } from '../user/user.module';

@Module({
  imports: [forwardRef(() => UserModule)],
  providers: [AuthService, LoginGuard],
  controllers: [AuthController],
  exports: [LoginGuard],
})
export class AuthModule {}
