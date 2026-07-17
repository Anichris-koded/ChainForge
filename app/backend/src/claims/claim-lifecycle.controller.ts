import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Patch,
  Request,
} from '@nestjs/common';
import { Request as ExpressRequest } from 'express';
import {
  ApiTags,
  ApiOperation,
  ApiOkResponse,
  ApiCreatedResponse,
  ApiBadRequestResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { ClaimsService } from './claims.service';
import { CancelAndReissueService } from './cancel-and-reissue.service';
import { CreateClaimDto } from './dto/create-claim.dto';
import { CancelClaimDto } from './dto/cancel-claim.dto';
import { ReissueClaimDto } from './dto/reissue-claim.dto';
import { Roles } from 'src/auth/roles.decorator';
import { AppRole } from 'src/auth/app-role.enum';
import { InternalNotesService } from 'src/common/services/internal-notes.service';
import { CreateInternalNoteDto } from 'src/common/dto/create-internal-note.dto';
import { InternalNoteResponseDto } from 'src/common/dto/internal-note-response.dto';

@ApiTags('Onchain Proxy')
@ApiBearerAuth('JWT-auth')
@Controller('claims')
export class ClaimLifecycleController {
  constructor(
    private readonly claimsService: ClaimsService,
    private readonly cancelAndReissueService: CancelAndReissueService,
    private readonly internalNotesService: InternalNotesService,
  ) {}

  @Post()
  @ApiOperation({
    operationId: 'ClaimsController_create_v1',
    summary: 'Create a claim',
    description: 'Initializes a new claim for a specific campaign.',
  })
  @ApiCreatedResponse({
    description: 'Claim created successfully.',
    type: CreateClaimDto,
  })
  @ApiBadRequestResponse({
    description: 'Invalid input parameters.',
  })
  @ApiNotFoundResponse({
    description: 'The specified campaign was not found.',
  })
  create(@Body() createClaimDto: CreateClaimDto) {
    return this.claimsService.create(createClaimDto);
  }

  @Get()
  @ApiOperation({
    operationId: 'ClaimsController_findAll_v1',
    summary: 'List all claims',
    description: 'Retrieves a list of all claims across all campaigns.',
  })
  @ApiOkResponse({
    description: 'List of all claims retrieved successfully.',
  })
  findAll() {
    return this.claimsService.findAll();
  }

  @Get(':id')
  @ApiOperation({
    operationId: 'ClaimsController_findOne_v1',
    summary: 'Get claim details',
    description:
      'Retrieves the current details and status of a specific claim.',
  })
  @ApiOkResponse({
    description: 'Claim details retrieved successfully.',
  })
  @ApiNotFoundResponse({
    description: 'The specified claim was not found.',
  })
  findOne(@Param('id') id: string) {
    return this.claimsService.findOne(id);
  }

  @Post(':id/verify')
  @Roles(AppRole.operator, AppRole.admin)
  @ApiOperation({
    operationId: 'ClaimsController_verify_v1',
    summary: 'Verify a claim',
    description: 'Marks a claim as verified. Requires operator or admin role.',
  })
  @ApiOkResponse({
    description: 'Claim status transitioned to verified successfully.',
  })
  @ApiBadRequestResponse({
    description: 'Invalid status transition.',
  })
  @ApiForbiddenResponse({
    description: 'Access denied - insufficient permissions.',
  })
  @ApiNotFoundResponse({
    description: 'The specified claim was not found.',
  })
  verify(@Param('id') id: string) {
    return this.claimsService.verify(id);
  }

  @Post(':id/approve')
  @Roles(AppRole.admin)
  @ApiOperation({
    operationId: 'ClaimsController_approve_v1',
    summary: 'Approve a claim',
    description: 'Approves a verified claim. Requires admin role.',
  })
  @ApiOkResponse({
    description: 'Claim approved successfully (verified → approved).',
  })
  @ApiBadRequestResponse({
    description: 'Invalid status transition.',
  })
  @ApiForbiddenResponse({
    description: 'Access denied - admin role required.',
  })
  @ApiNotFoundResponse({
    description: 'The specified claim was not found.',
  })
  approve(@Param('id') id: string) {
    return this.claimsService.approve(id);
  }

  @Post(':id/disburse')
  @Roles(AppRole.admin)
  @ApiOperation({
    operationId: 'ClaimsController_disburse_v1',
    summary: 'Disburse funds for a claim',
    description:
      'Initiates on-chain disbursement for an approved claim. Requires admin role.',
  })
  @ApiOkResponse({
    description: 'On-chain disbursement initiated or completed successfully.',
    content: {
      'application/json': {
        examples: {
          success: {
            summary: 'Successful on-chain disbursement',
            value: {
              id: 'claim_123',
              status: 'disbursed',
              transactionHash: '0x123...abc',
              amount: '100.50',
            },
          },
          pending: {
            summary: 'Disbursement pending on-chain',
            value: {
              id: 'claim_123',
              status: 'disbursing',
              message: 'Check back for final transaction hash.',
            },
          },
        },
      },
    },
  })
  @ApiBadRequestResponse({
    description: 'Invalid status transition or account state.',
  })
  @ApiForbiddenResponse({
    description: 'Access denied - admin role required.',
  })
  @ApiNotFoundResponse({
    description: 'The specified claim was not found.',
  })
  disburse(@Param('id') id: string) {
    return this.claimsService.disburse(id);
  }

  @Patch(':id/archive')
  @ApiOperation({
    operationId: 'ClaimsController_archive_v1',
    summary: 'Archive a claim',
    description: 'Soft-archives a claim, hiding it from general listings.',
  })
  @ApiOkResponse({
    description: 'Claim archived successfully.',
  })
  @ApiBadRequestResponse({
    description: 'Invalid status transition.',
  })
  @ApiNotFoundResponse({
    description: 'The specified claim was not found.',
  })
  archive(@Param('id') id: string) {
    return this.claimsService.archive(id);
  }

  @Post(':id/notes')
  @Roles(AppRole.operator, AppRole.admin)
  @ApiOperation({
    operationId: 'ClaimsController_addNote_v1',
    summary: 'Add an internal note to a claim',
    description: 'Adds a secure internal note for staff review only.',
  })
  @ApiCreatedResponse({
    description: 'Internal note added successfully.',
    type: InternalNoteResponseDto,
  })
  @ApiForbiddenResponse({
    description: 'Access denied - staff role required.',
  })
  addNote(
    @Param('id') id: string,
    @Body() dto: CreateInternalNoteDto,
    @Request() req: ExpressRequest,
  ) {
    const authorId = req.user?.apiKeyId || req.user?.authType || 'system';
    return this.internalNotesService.createNote('claim', id, authorId, dto);
  }

  @Get(':id/notes')
  @Roles(AppRole.operator, AppRole.admin)
  @ApiOperation({
    operationId: 'ClaimsController_getNotes_v1',
    summary: 'List internal notes for a claim',
    description: 'Retrieves all internal notes for a specific claim.',
  })
  @ApiOkResponse({
    description: 'Internal notes retrieved successfully.',
    type: [InternalNoteResponseDto],
  })
  @ApiForbiddenResponse({
    description: 'Access denied - staff role required.',
  })
  getNotes(@Param('id') id: string) {
    return this.internalNotesService.findNotesByEntity('claim', id);
  }

  @Post(':id/cancel')
  @Roles(AppRole.operator, AppRole.admin)
  @ApiOperation({
    operationId: 'ClaimsController_cancel_v1',
    summary: 'Cancel a claim',
    description:
      'Cancels an active claim (requested / verified / approved). ' +
      'Releases the locked budget back to the campaign and records a full audit trail. ' +
      'Disbursed claims cannot be cancelled.',
  })
  @ApiOkResponse({ description: 'Claim cancelled successfully.' })
  @ApiBadRequestResponse({
    description: 'Claim is already cancelled or in a non-cancellable status.',
  })
  @ApiForbiddenResponse({
    description: 'Access denied - operator role required.',
  })
  @ApiNotFoundResponse({ description: 'Claim not found.' })
  cancel(@Param('id') id: string, @Body() dto: CancelClaimDto) {
    return this.cancelAndReissueService.cancel(id, dto);
  }

  @Post(':id/reissue')
  @Roles(AppRole.operator, AppRole.admin)
  @ApiOperation({
    operationId: 'ClaimsController_reissue_v1',
    summary: 'Cancel and reissue a claim',
    description:
      'Atomically cancels the original claim and creates a replacement. ' +
      'The replacement is linked to the original via `reissuedFromId`, ' +
      'preserving the full audit chain. Locked balances are transferred to ' +
      'the new claim — no double-counting occurs. ' +
      'Returns both the cancelled original and the new replacement.',
  })
  @ApiCreatedResponse({
    description: 'Original claim cancelled and replacement created.',
    schema: {
      properties: {
        original: {
          type: 'object',
          description: 'The cancelled original claim.',
        },
        replacement: {
          type: 'object',
          description: 'The newly created replacement claim.',
        },
      },
    },
  })
  @ApiBadRequestResponse({
    description: 'Original claim is not in a cancellable status.',
  })
  @ApiForbiddenResponse({
    description: 'Access denied - operator role required.',
  })
  @ApiNotFoundResponse({ description: 'Original claim not found.' })
  reissue(@Param('id') id: string, @Body() dto: ReissueClaimDto) {
    return this.cancelAndReissueService.reissue(id, dto);
  }

  @Get(':id/reissue-history')
  @Roles(AppRole.operator, AppRole.admin)
  @ApiOperation({
    operationId: 'ClaimsController_getReissueHistory_v1',
    summary: 'Get reissue chain for a claim',
    description:
      'Returns the full lineage of a claim — the original and every ' +
      'replacement — ordered from oldest to newest. Pass any claim ID in ' +
      'the chain to retrieve the complete history.',
  })
  @ApiOkResponse({
    description: 'Reissue chain retrieved successfully.',
    schema: { type: 'array', items: { type: 'object' } },
  })
  @ApiForbiddenResponse({
    description: 'Access denied - operator role required.',
  })
  @ApiNotFoundResponse({ description: 'Claim not found.' })
  getReissueHistory(@Param('id') id: string) {
    return this.cancelAndReissueService.getReissueHistory(id);
  }
}
