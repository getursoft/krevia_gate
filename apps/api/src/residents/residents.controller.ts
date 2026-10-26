import { Body, Controller, Delete, Get, Header, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBody, ApiOperation, ApiProduces, ApiQuery, ApiTags } from '@nestjs/swagger';
import {
  addResidentUnitSchema,
  createResidentSchema,
  residentImportListSchema,
  residentImportQuerySchema,
  residentListSchema,
  updateResidentSchema,
  updateResidentUnitSchema,
  type MyHouseholdDto,
} from '@krevia/shared';
import { AuditService } from '../audit/audit.service';
import { CurrentSession } from '../auth/auth.guard';
import type { SessionWithUser } from '../auth/session.service';
import { CurrentSociety, RequireSocietyPermission } from '../authz/permission.guard';
import type { SocietyContext } from '../authz/society-access.service';
import { Errors } from '../common/errors';
import { jsonSchema } from '../common/openapi';
import { validate, validateId } from '../common/validate';
import { page } from '../members/member.mapper';
import { PrismaService } from '../prisma/prisma.service';
import { toResidentDto } from './resident.mapper';
import { IMPORT_TEMPLATE_CSV, ResidentImportService, toErrorReportCsv, toImportJobDto } from './resident-import.service';
import { ResidentsService } from './residents.service';

@ApiTags('residents')
@Controller('societies/:societyId')
export class ResidentsController {
  constructor(
    private readonly residents: ResidentsService,
    private readonly imports: ResidentImportService,
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Declared before `residents/:residentId` so the literal path wins. */
  @Get('my-household')
  @RequireSocietyPermission('household.read')
  @ApiOperation({ summary: 'My own profile and the people I share a unit with (residents)' })
  async myHousehold(@CurrentSession() session: SessionWithUser, @CurrentSociety() ctx: SocietyContext): Promise<MyHouseholdDto> {
    return this.residents.myHousehold(ctx.societyId, session.userId);
  }

  @Get('residents/import/template')
  @RequireSocietyPermission('resident.import')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="krevia-resident-import-template.csv"')
  @Header('Cache-Control', 'no-store')
  @ApiProduces('text/csv')
  @ApiOperation({ summary: 'Download the resident import CSV template (administrators)' })
  template() {
    return IMPORT_TEMPLATE_CSV;
  }

  @Get('residents/imports')
  @RequireSocietyPermission('resident.import')
  @ApiOperation({ summary: 'Recent resident CSV imports for this society (administrators)' })
  async listImports(@CurrentSociety() ctx: SocietyContext, @Query() query: unknown) {
    const { page: pageNo, pageSize } = validate(residentImportListSchema, query);
    const [total, rows] = await Promise.all([
      this.prisma.residentImportJob.count({ where: { societyId: ctx.societyId } }),
      this.prisma.residentImportJob.findMany({
        where: { societyId: ctx.societyId },
        orderBy: { createdAt: 'desc' },
        skip: (pageNo - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    return page(rows.map((row) => toImportJobDto(row)), pageNo, pageSize, total);
  }

  @Post('residents/imports/preview')
  @HttpCode(200)
  @RequireSocietyPermission('resident.import')
  @ApiQuery({ name: 'fileName', required: false })
  @ApiOperation({
    summary: 'Upload and validate a resident CSV. Nothing is written to the directory until confirm.',
    description: 'Send the CSV as `text/csv` (max 2 MB). The same file uploaded twice returns the original preview.',
  })
  async preview(@CurrentSession() session: SessionWithUser, @CurrentSociety() ctx: SocietyContext, @Query() query: unknown, @Body() body: unknown) {
    const { fileName } = validate(residentImportQuerySchema, query);
    if (typeof body !== 'string' || body.trim() === '') {
      throw Errors.validation({ csv: 'Send the CSV file as text/csv.' }, 'No CSV file was received.');
    }
    const job = await this.imports.preview(ctx.societyId, session.userId, fileName ?? 'resident-import.csv', body);
    return { job };
  }

  @Get('residents/imports/:jobId')
  @RequireSocietyPermission('resident.import')
  @ApiOperation({ summary: 'One resident import and its row preview (administrators)' })
  async getImport(@CurrentSociety() ctx: SocietyContext, @Param('jobId') id: string) {
    const job = await this.prisma.residentImportJob.findFirst({ where: { id: validateId(id, 'jobId'), societyId: ctx.societyId } });
    if (!job) throw Errors.notFound('Import not found.');
    return { job: toImportJobDto(job) };
  }

  @Post('residents/imports/:jobId/confirm')
  @HttpCode(200)
  @RequireSocietyPermission('resident.import')
  @ApiOperation({ summary: 'Import the valid rows of a previewed CSV in one transaction' })
  async confirmImport(@CurrentSession() session: SessionWithUser, @CurrentSociety() ctx: SocietyContext, @Param('jobId') id: string) {
    const job = await this.imports.confirm(ctx.societyId, session.userId, validateId(id, 'jobId'));
    return { job };
  }

  @Get('residents/imports/:jobId/errors.csv')
  @RequireSocietyPermission('resident.import')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="krevia-resident-import-errors.csv"')
  @Header('Cache-Control', 'no-store')
  @ApiProduces('text/csv')
  @ApiOperation({ summary: 'Download the rejected rows of an import as a formula-safe CSV' })
  async importErrors(@CurrentSociety() ctx: SocietyContext, @Param('jobId') id: string) {
    const job = await this.prisma.residentImportJob.findFirst({ where: { id: validateId(id, 'jobId'), societyId: ctx.societyId } });
    if (!job) throw Errors.notFound('Import not found.');
    await this.audit.record({
      action: 'data.exported',
      outcome: 'SUCCESS',
      societyId: ctx.societyId,
      targetType: 'resident_import_errors',
      targetId: job.id,
      metadata: { rows: job.invalidRows + job.rejectedRows },
    });
    return toErrorReportCsv(job);
  }

  @Get('residents')
  @RequireSocietyPermission('resident.read')
  @ApiOperation({ summary: 'Resident directory of the society (administrators)' })
  async list(@CurrentSociety() ctx: SocietyContext, @Query() query: unknown) {
    const filters = validate(residentListSchema, query);
    const { rows, total } = await this.residents.list(ctx.societyId, filters);
    return page(rows.map(toResidentDto), filters.page, filters.pageSize, total);
  }

  @Post('residents')
  @RequireSocietyPermission('resident.manage')
  @ApiOperation({ summary: 'Add a person to the resident directory and link them to a unit' })
  @ApiBody({ schema: jsonSchema(createResidentSchema) })
  async create(@CurrentSession() session: SessionWithUser, @CurrentSociety() ctx: SocietyContext, @Body() body: unknown) {
    const input = validate(createResidentSchema, body);
    return { resident: await this.residents.create(ctx.societyId, session.userId, input) };
  }

  @Get('residents/:residentId')
  @RequireSocietyPermission('resident.read')
  @ApiOperation({ summary: 'One resident, their units and (admin-only) emergency contacts' })
  async detail(@CurrentSociety() ctx: SocietyContext, @Param('residentId') id: string) {
    const resident = await this.residents.detail(ctx.societyId, validateId(id, 'residentId'));
    return { resident: toResidentDto(resident) };
  }

  @Patch('residents/:residentId')
  @RequireSocietyPermission('resident.manage')
  @ApiOperation({ summary: 'Edit a resident. Mobile numbers stay unique within the society.' })
  @ApiBody({ schema: jsonSchema(updateResidentSchema) })
  async update(
    @CurrentSession() session: SessionWithUser,
    @CurrentSociety() ctx: SocietyContext,
    @Param('residentId') id: string,
    @Body() body: unknown,
  ) {
    const input = validate(updateResidentSchema, body);
    return { resident: await this.residents.update(ctx.societyId, session.userId, validateId(id, 'residentId'), input) };
  }

  @Post('residents/:residentId/archive')
  @HttpCode(200)
  @RequireSocietyPermission('resident.manage')
  @ApiOperation({ summary: 'Archive a resident and end their active unit links and assignments' })
  async archive(@CurrentSession() session: SessionWithUser, @CurrentSociety() ctx: SocietyContext, @Param('residentId') id: string) {
    return { resident: await this.residents.archive(ctx.societyId, session.userId, validateId(id, 'residentId')) };
  }

  @Post('residents/:residentId/units')
  @RequireSocietyPermission('resident.manage')
  @ApiOperation({ summary: 'Link an existing resident to another unit' })
  @ApiBody({ schema: jsonSchema(addResidentUnitSchema) })
  async addUnit(
    @CurrentSession() session: SessionWithUser,
    @CurrentSociety() ctx: SocietyContext,
    @Param('residentId') id: string,
    @Body() body: unknown,
  ) {
    const input = validate(addResidentUnitSchema, body);
    return { resident: await this.residents.addUnit(ctx.societyId, session.userId, validateId(id, 'residentId'), input) };
  }

  @Patch('residents/:residentId/units/:residentUnitId')
  @RequireSocietyPermission('resident.manage')
  @ApiOperation({ summary: 'Change a resident-unit relationship or primary flag' })
  @ApiBody({ schema: jsonSchema(updateResidentUnitSchema) })
  async updateUnit(
    @CurrentSession() session: SessionWithUser,
    @CurrentSociety() ctx: SocietyContext,
    @Param('residentId') residentIdRaw: string,
    @Param('residentUnitId') residentUnitIdRaw: string,
    @Body() body: unknown,
  ) {
    const input = validate(updateResidentUnitSchema, body);
    return {
      resident: await this.residents.updateUnit(
        ctx.societyId,
        session.userId,
        validateId(residentIdRaw, 'residentId'),
        validateId(residentUnitIdRaw, 'residentUnitId'),
        input,
      ),
    };
  }

  @Delete('residents/:residentId/units/:residentUnitId')
  @RequireSocietyPermission('resident.manage')
  @ApiOperation({ summary: 'End a resident-unit link and its authenticated assignment' })
  async endUnit(
    @CurrentSession() session: SessionWithUser,
    @CurrentSociety() ctx: SocietyContext,
    @Param('residentId') residentIdRaw: string,
    @Param('residentUnitId') residentUnitIdRaw: string,
  ) {
    return {
      resident: await this.residents.endUnit(
        ctx.societyId,
        session.userId,
        validateId(residentIdRaw, 'residentId'),
        validateId(residentUnitIdRaw, 'residentUnitId'),
      ),
    };
  }
}
