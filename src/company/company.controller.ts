import { Body, Controller, Get, Put, Req, UseGuards } from '@nestjs/common';
import { CompanyService } from './company.service';
import { UpdateCompanyDto } from './dto/update-company.dto';
import { LoginGuard } from '../auth/guard/login/login.guard';
import { User } from '../user/schema/user.schema';

@Controller('company')
@UseGuards(LoginGuard)
export class CompanyController {
  constructor(private readonly companyService: CompanyService) {}

  @Get()
  async getCompany(@Req() req: { user: User }) {
    return this.companyService.getCompanyByUserId(req.user._id);
  }

  @Put()
  async updateCompany(
    @Body() body: UpdateCompanyDto,
    @Req() req: { user: User },
  ) {
    return this.companyService.upsertCompany(req.user._id, body);
  }
}
