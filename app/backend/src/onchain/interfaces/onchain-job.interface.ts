import {
  InitEscrowParams,
  CreateClaimParams,
  DisburseParams,
} from '../onchain.adapter';

export enum OnchainOperationType {
  INIT_ESCROW = 'init-escrow',
  CREATE_CLAIM = 'create-claim',
  DISBURSE = 'disburse',
}

export type OnchainJobInput =
  | { type: OnchainOperationType.INIT_ESCROW; params: InitEscrowParams }
  | { type: OnchainOperationType.CREATE_CLAIM; params: CreateClaimParams }
  | { type: OnchainOperationType.DISBURSE; params: DisburseParams };

export type OnchainJobData = OnchainJobInput & {
  timestamp: number;
  correlationId?: string;
};

export interface OnchainJobResult {
  success: boolean;
  transactionHash?: string;
  error?: string;
  metadata?: Record<string, unknown>;
}
