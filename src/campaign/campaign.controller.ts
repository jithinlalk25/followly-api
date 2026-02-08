import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Types } from 'mongoose';
import { CampaignService } from './campaign.service';
import { CreateCampaignDto } from './dto/create-campaign.dto';
import { UpdateCampaignSettingsDto } from './dto/update-campaign-settings.dto';
import { LoginGuard } from '../auth/guard/login/login.guard';
import { User } from '../user/schema/user.schema';

@Controller('campaign')
@UseGuards(LoginGuard)
export class CampaignController {
  constructor(private readonly campaignService: CampaignService) {}

  @Post()
  async createCampaign(
    @Body() body: CreateCampaignDto,
    @Req() req: { user: User },
  ) {
    return this.campaignService.create(req.user._id, body);
  }

  @Get()
  async getCampaigns(@Req() req: { user: User }) {
    return this.campaignService.findAllByUser(req.user._id);
  }

  @Get(':id/leads')
  async getCampaignLeads(
    @Param('id') id: string,
    @Req() req: { user: User },
  ) {
    return this.campaignService.findCampaignLeadsWithLeads(
      new Types.ObjectId(id),
      req.user._id,
    );
  }

  @Get(':id/poll')
  async pollCampaign(
    @Param('id') id: string,
    @Req() req: { user: User },
  ) {
    return this.campaignService.findPollData(
      new Types.ObjectId(id),
      req.user._id,
    );
  }

  @Get(':id')
  async getCampaign(@Param('id') id: string, @Req() req: { user: User }) {
    return this.campaignService.findOne(new Types.ObjectId(id), req.user._id);
  }

  @Patch(':id/settings')
  async updateCampaignSettings(
    @Param('id') id: string,
    @Body() body: UpdateCampaignSettingsDto,
    @Req() req: { user: User },
  ) {
    return this.campaignService.updateSettings(
      new Types.ObjectId(id),
      req.user._id,
      body,
    );
  }

  @Post(':id/generate-email-drafts')
  @HttpCode(HttpStatus.ACCEPTED)
  async generateEmailDrafts(
    @Param('id') id: string,
    @Req() req: { user: User },
  ) {
    const result = await this.campaignService.enqueueGenerateEmailDrafts(
      new Types.ObjectId(id),
      req.user._id,
    );
    return { jobId: result.jobId };
  }

  @Post(':id/launch')
  @HttpCode(HttpStatus.ACCEPTED)
  async launchCampaign(
    @Param('id') id: string,
    @Req() req: { user: User },
  ) {
    const result = await this.campaignService.launchCampaign(
      new Types.ObjectId(id),
      req.user._id,
    );
    return { jobId: result.jobId };
  }
}
