export class UpdateCompanyDto {
  name: string;

  website: string;

  description: string;

  /** Testing: list of emails that are allowed to receive actual outbound sends. */
  allowedEmailRecipients?: string[];
}
