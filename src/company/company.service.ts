import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Types } from 'mongoose';
import { Company } from './schema/company.schema';
import { UpdateCompanyDto } from './dto/update-company.dto';

@Injectable()
export class CompanyService {
  constructor(
    @InjectModel(Company.name) private readonly companyModel: Model<Company>,
  ) {}

  async getCompanyByUserId(userId: Types.ObjectId): Promise<Company | null> {
    return this.companyModel.findOne({ userId }).exec();
  }

  async upsertCompany(
    userId: Types.ObjectId,
    dto: UpdateCompanyDto,
  ): Promise<Company> {
    const company = await this.companyModel
      .findOneAndUpdate(
        { userId },
        {
          $set: {
            name: dto.name,
            website: dto.website,
            description: dto.description,
          },
        },
        { new: true, upsert: true },
      )
      .exec();
    return company;
  }
}
