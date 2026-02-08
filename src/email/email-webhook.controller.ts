import {
  BadRequestException,
  Controller,
  Logger,
  Post,
  Req,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common/interfaces';
import type { Request } from 'express';
import { Types } from 'mongoose';
import { getReceivedEmail, verifyWebhook } from 'utils/resend.service';
import { CampaignService } from '../campaign/campaign.service';
import { EmailService } from './email.service';

const CL_PREFIX = 'cl-';

/**
 * Extracts campaignLeadId from the address that received the inbound email.
 * Outbound reply-to is cl-{campaignLeadId}@domain; we parse the local part and strip the prefix.
 */
function parseCampaignLeadIdFromToAddress(toAddresses: string[]): Types.ObjectId | null {
  if (!toAddresses?.length) return null;
  for (const raw of toAddresses) {
    const addr = raw.trim();
    const angle = /<([^>]+)>/.exec(addr);
    const email = angle ? angle[1] : addr;
    const at = email.indexOf('@');
    if (at <= 0) continue;
    const local = email.slice(0, at).trim().toLowerCase();
    if (!local.startsWith(CL_PREFIX)) continue;
    const id = local.slice(CL_PREFIX.length);
    if (Types.ObjectId.isValid(id)) return new Types.ObjectId(id);
  }
  return null;
}

@Controller('email/webhooks')
export class EmailWebhookController {
  private readonly logger = new Logger(EmailWebhookController.name);

  constructor(
    private readonly emailService: EmailService,
    private readonly campaignService: CampaignService,
  ) {}

  @Post('resend')
  async handleResendEvent(@Req() req: RawBodyRequest<Request>) {
    const payload = req.rawBody;
    if (!payload || !Buffer.isBuffer(payload)) {
      throw new UnprocessableEntityException('Missing raw body');
    }
    const payloadStr = payload.toString('utf8');

    const webhookSecret = process.env.RESEND_WEBHOOK_SECRET;
    if (!webhookSecret) {
      this.logger.warn(
        'RESEND_WEBHOOK_SECRET not set; webhook verification disabled',
      );
      throw new UnprocessableEntityException('Webhook secret not configured');
    }

    const id = req.headers['svix-id'];
    const timestamp = req.headers['svix-timestamp'];
    const signature = req.headers['svix-signature'];
    if (
      typeof id !== 'string' ||
      typeof timestamp !== 'string' ||
      typeof signature !== 'string'
    ) {
      throw new BadRequestException('Invalid webhook: missing Svix headers');
    }

    try {
      const result = verifyWebhook({
        payload: payloadStr,
        headers: { id, timestamp, signature },
        webhookSecret,
      });
      this.logger.log(
        `Resend webhook verified: type=${result?.type ?? 'unknown'}`,
      );

      if (result.type === 'email.received') {
        const received = await getReceivedEmail(result.data.email_id);
        const subject = received.subject || '(no subject)';
        const body = received.html ?? received.text ?? '';

        const campaignLeadId = parseCampaignLeadIdFromToAddress(received.to);
        if (campaignLeadId) {
          const campaignLead =
            await this.campaignService.getCampaignLeadById(campaignLeadId);
          if (campaignLead?.campaignId && campaignLead?.leadId) {
            await this.emailService.createInboundEmail({
              leadId: campaignLead.leadId as Types.ObjectId,
              campaignId: campaignLead.campaignId as Types.ObjectId,
              subject,
              body,
            });
            await this.campaignService.markReplyReceived(
              campaignLead.campaignId as Types.ObjectId,
              campaignLead.leadId as Types.ObjectId,
            );
            this.logger.log(
              `Created inbound email for lead ${campaignLead.leadId} campaign ${campaignLead.campaignId}`,
            );
          } else {
            this.logger.warn(
              `Webhook: no campaign lead found for id ${campaignLeadId}`,
            );
          }
        } else {
          this.logger.warn(
            'Webhook: could not parse campaign lead from To address',
          );
        }
      }

      return { received: true };
    } catch (error) {
      this.logger.error(
        `Error verifying Resend webhook: ${error instanceof Error ? error.message : String(error)}`,
      );
      throw new BadRequestException('Invalid webhook');
    }
  }
}
