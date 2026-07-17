import * as fs from 'node:fs';
import { sep } from 'node:path';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { loadEnv, getEnvCandidates } from '../env-loader';

// Mock fs module to control file existence and contents
jest.mock('node:fs', () => {
  const original = jest.requireActual('node:fs');
  return {
    ...original,
    existsSync: jest.fn(),
    readFileSync: jest.fn(),
  };
});

describe('Unified Env Loader', () => {
  const originalEnv = { ...process.env };
  const mockExistsSync = fs.existsSync as jest.Mock;
  const mockReadFileSync = fs.readFileSync as jest.Mock;

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('should respect the canonical order of precedence when resolving env files', () => {
    const candidates = getEnvCandidates();
    expect(candidates).toHaveLength(3);
    // 1st candidate: process.cwd()/.env
    expect(candidates[0]).toContain('.env');
    // 2nd candidate: process.cwd()/app/backend/.env
    expect(candidates[1]).toContain(joinParts('app', 'backend', '.env'));
  });

  it('should override OS environment variables with dotenv variables (honest precedence)', () => {
    const candidates = getEnvCandidates();
    const targetFile = candidates[0];

    // Pre-set OS env var
    process.env.TEST_VAR = 'os_value';

    // Mock targetFile existence and content
    mockExistsSync.mockImplementation((path: string) => path === targetFile);
    mockReadFileSync.mockImplementation((path: string) => {
      if (path === targetFile) {
        return 'TEST_VAR=dotenv_value';
      }
      return '';
    });

    loadEnv();

    // Verify dotenv value override OS env value
    expect(process.env.TEST_VAR).toBe('dotenv_value');
  });

  it('should ensure both direct loadEnv and ConfigModule call paths agree on final env state', async () => {
    const candidates = getEnvCandidates();
    const rootEnvPath = candidates[0];
    const backendEnvPath = candidates[1];

    // Set mock existence
    mockExistsSync.mockImplementation((path: string) => {
      return path === rootEnvPath || path === backendEnvPath;
    });

    // Mock contents: Root env should take precedence over backend env
    mockReadFileSync.mockImplementation((path: string) => {
      if (path === rootEnvPath) {
        return 'COMMON_VAR=root_val\nROOT_ONLY=root_only';
      }
      if (path === backendEnvPath) {
        return 'COMMON_VAR=backend_val\nBACKEND_ONLY=backend_only';
      }
      return '';
    });

    // 1. Direct path (like main.ts)
    const envFilePaths = loadEnv();
    expect(envFilePaths).toContain(rootEnvPath);
    expect(envFilePaths).toContain(backendEnvPath);

    const directCommon = process.env.COMMON_VAR;
    const directRootOnly = process.env.ROOT_ONLY;
    const directBackendOnly = process.env.BACKEND_ONLY;

    // Clear process.env to test NestJS ConfigModule path cleanly
    process.env = { ...originalEnv };

    // 2. Nest ConfigModule path (like app.module.ts)
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          envFilePath: envFilePaths,
        }),
      ],
    }).compile();

    const configService = moduleRef.get(ConfigService);

    // Assert agreement
    expect(configService.get('COMMON_VAR')).toBe(directCommon);
    expect(configService.get('ROOT_ONLY')).toBe(directRootOnly);
    expect(configService.get('BACKEND_ONLY')).toBe(directBackendOnly);
    
    // Verify that the first candidate (rootEnvPath) successfully won over backendEnvPath
    expect(configService.get('COMMON_VAR')).toBe('root_val');
  });
});

function joinParts(...parts: string[]): string {
  return parts.join(sep);
}
