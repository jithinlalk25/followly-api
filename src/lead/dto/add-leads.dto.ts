export class AddLeadItemDto {
  name: string;
  email: string;
  additionalInfo: Record<string, string>;
}

export class AddLeadsDto {
  leads: AddLeadItemDto[];
}
