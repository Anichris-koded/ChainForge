import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { config as dotenvConfig } from 'dotenv';

/**
 * Resolves the candidate .env paths in a unified order.
 * Order of precedence (first one wins / first candidate takes priority):
 * 1. process.cwd()/.env (Root .env)
 * 2. process.cwd()/app/backend/.env (Backend .env)
 * 3. __dirname-relative .env (equivalent to join(__dirname, '..', '.env') in main.ts / app.module.ts)
 */
export function getEnvCandidates(): string[] {
  // If __dirname is inside src/common/utils (which it is for this file),
  // we go up 3 levels to reach the parent of src/dist.
  // Otherwise, we default to 1 level up.
  const isNested = __dirname.includes(join('common', 'utils')) || __dirname.replace(/\\/g, '/').includes('common/utils');
  const relativeParent = isNested ? join(__dirname, '..', '..', '..') : join(__dirname, '..');

  return [
    join(process.cwd(), '.env'),
    join(process.cwd(), 'app', 'backend', '.env'),
    join(relativeParent, '.env'),
  ];
}

/**
 * Loads environment variables from the candidate .env files.
 * Precedence Rule:
 * - dotenv variables ALWAYS win over existing OS environment variables (override: true).
 * - The first existing candidate file in the list takes highest precedence.
 * 
 * Both main.ts and app.module.ts call this helper.
 * Returns the candidate files list to be used by NestJS ConfigModule.
 */
export function loadEnv(): string[] {
  const candidates = getEnvCandidates();
  const existing = candidates.filter(p => existsSync(p));

  const pathsToLoad = existing.length > 0 ? existing : candidates;

  // Precedence helper:
  // To ensure that the first candidate in the list takes precedence,
  // we load them in reverse order using dotenv with `override: true`.
  // This way, the first candidate is loaded last and overrides any keys loaded by others.
  // Also, since we use `override: true`, dotenv variables will override existing OS environment variables.
  for (let i = pathsToLoad.length - 1; i >= 0; i--) {
    const p = pathsToLoad[i];
    if (existsSync(p)) {
      dotenvConfig({ path: p, override: true });
    }
  }

  return pathsToLoad;
}
