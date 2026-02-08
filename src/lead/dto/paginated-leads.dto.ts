export class PaginatedLeadsQueryDto {
  page?: number = 1;
  limit?: number = 10;
}

export class PaginatedLeadsResponseDto {
  data: Array<{
    _id: string;
    name: string;
    email: string;
    additionalInfo: Record<string, string>;
    createdAt?: Date;
    updatedAt?: Date;
  }>;
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}
