import {
  Controller,
  Get,
  Post,
  Body,
  Param,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiOkResponse,
  ApiBadRequestResponse,
  ApiNotFoundResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { ClaimsService } from './claims.service';
import {
  ClaimReceiptDto,
  ClaimShareResponseDto,
  SendReceiptShareDto,
} from './dto/claim-receipt.dto';

@ApiTags('Onchain Proxy')
@ApiBearerAuth('JWT-auth')
@Controller('claims')
export class ClaimReceiptController {
  constructor(private readonly claimsService: ClaimsService) {}

  @Get(':id/receipt')
  @ApiOperation({
    operationId: 'ClaimsController_getReceipt_v1',
    summary: 'Get claim receipt',
    description: 'Generates a shareable receipt for the specified claim.',
  })
  @ApiOkResponse({
    description: 'Claim receipt generated successfully.',
    type: ClaimReceiptDto,
  })
  @ApiNotFoundResponse({
    description: 'The specified claim was not found.',
  })
  getReceipt(@Param('id') id: string): Promise<ClaimReceiptDto> {
    return this.claimsService.getReceipt(id);
  }

  @Post(':id/receipt/share')
  @ApiOperation({
    operationId: 'ClaimsController_shareReceipt_v1',
    summary: 'Share claim receipt',
    description:
      'Generates and optionally sends the claim receipt via email or SMS.',
  })
  @ApiOkResponse({
    description: 'Receipt generated and sharing initiated successfully.',
    type: ClaimShareResponseDto,
  })
  @ApiBadRequestResponse({
    description: 'Invalid share parameters.',
  })
  @ApiNotFoundResponse({
    description: 'The specified claim was not found.',
  })
  shareReceipt(
    @Param('id') id: string,
    @Body() shareDto: SendReceiptShareDto,
  ): Promise<ClaimShareResponseDto> {
    return this.claimsService.shareReceipt(id, shareDto);
  }
}
