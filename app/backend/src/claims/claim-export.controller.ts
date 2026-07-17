import {
  Controller,
  Get,
  Query,
  Res,
  Version,
} from '@nestjs/common';
import type { Response } from 'express';
import {
  ApiTags,
  ApiOperation,
  ApiOkResponse,
  ApiUnauthorizedResponse,
  ApiForbiddenResponse,
  ApiQuery,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { ClaimsService } from './claims.service';
import { ExportClaimsQueryDto } from './dto/export-claims.dto';
import { Roles } from 'src/auth/roles.decorator';
import { AppRole } from 'src/auth/app-role.enum';

@ApiTags('Onchain Proxy')
@ApiBearerAuth('JWT-auth')
@Controller('claims')
export class ClaimExportController {
  constructor(private readonly claimsService: ClaimsService) {}

  @Get('export')
  @Version('1')
  @Roles(AppRole.operator, AppRole.admin)
  @ApiOperation({
    operationId: 'ClaimsController_exportClaims_v1',
    summary: 'Export claims as CSV',
    description:
      'Exports claim records as CSV with support for date range, status, organization, token, and pagination filters. ' +
      'Excludes sensitive recipient data (recipientRef is encrypted and not exported).',
  })
  @ApiOkResponse({
    description: 'Claims exported successfully.',
    content: {
      'text/csv': {
        schema: { type: 'string' },
      },
    },
  })
  @ApiUnauthorizedResponse({
    description: 'Missing or invalid authentication credentials.',
  })
  @ApiForbiddenResponse({
    description: 'Access denied - operator or admin role required.',
  })
  @ApiQuery({
    name: 'from',
    required: false,
    description: 'Start date (ISO string)',
  })
  @ApiQuery({
    name: 'to',
    required: false,
    description: 'End date (ISO string)',
  })
  @ApiQuery({
    name: 'status',
    required: false,
    description: 'Claim status filter',
  })
  @ApiQuery({
    name: 'campaignId',
    required: false,
    description: 'Campaign ID filter',
  })
  @ApiQuery({
    name: 'orgId',
    required: false,
    description: 'Organization ID filter',
  })
  @ApiQuery({
    name: 'tokenAddress',
    required: false,
    description: 'Token address filter',
  })
  @ApiQuery({
    name: 'page',
    required: false,
    description: 'Page number (default: 1)',
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    description: 'Items per page (default: 50, max: 200)',
  })
  async exportClaims(
    @Query() query: ExportClaimsQueryDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.claimsService.exportClaims(query);

    const csv = this.claimsService.buildCsv(result.data);
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="claims-export-${Date.now()}.csv"`,
    );
    res.setHeader('X-Total-Count', String(result.total));
    res.setHeader('X-Page', String(result.page));
    res.setHeader('X-Limit', String(result.limit));

    return csv;
  }
}
