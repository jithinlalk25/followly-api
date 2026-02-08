import {
  BadRequestException,
  Controller,
  DefaultValuePipe,
  Get,
  Param,
  ParseIntPipe,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { EmailService } from './email.service';
import { LoginGuard } from '../auth/guard/login/login.guard';
import { User } from '../user/schema/user.schema';
import { Types } from 'mongoose';

@Controller('email')
@UseGuards(LoginGuard)
export class EmailController {
  constructor(private readonly emailService: EmailService) {}

  @Get('lead/:leadId')
  async getEmailsByLead(
    @Req() req: { user: User },
    @Param('leadId') leadId: string,
  ) {
    if (!Types.ObjectId.isValid(leadId)) {
      throw new BadRequestException('Invalid lead ID');
    }
    return this.emailService.getEmailsByLead(
      new Types.ObjectId(leadId),
      req.user._id,
    );
  }

  @Get('leads')
  async getLeadsWithEmails(
    @Req() req: { user: User },
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(10), ParseIntPipe) limit: number,
  ) {
    return this.emailService.getLeadsWithEmails(req.user._id, page, limit);
  }
}
