import {
  Body,
  Controller,
  DefaultValuePipe,
  Get,
  ParseIntPipe,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { LeadService } from './lead.service';
import { AddLeadsDto } from './dto/add-leads.dto';
import { LoginGuard } from '../auth/guard/login/login.guard';
import { User } from '../user/schema/user.schema';

@Controller('lead')
@UseGuards(LoginGuard)
export class LeadController {
  constructor(private readonly leadService: LeadService) {}

  @Post()
  async addLeads(@Body() body: AddLeadsDto, @Req() req: { user: User }) {
    return this.leadService.addLeads(req.user._id, body.leads);
  }

  @Get()
  async getLeads(
    @Req() req: { user: User },
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(10), ParseIntPipe) limit: number,
  ) {
    return this.leadService.getLeads(req.user._id, page, limit);
  }

  @Get('summary')
  async getSummary(@Req() req: { user: User }) {
    return this.leadService.getSummary(req.user._id);
  }
}
