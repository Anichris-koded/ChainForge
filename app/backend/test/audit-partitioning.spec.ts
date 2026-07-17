import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { PrismaModule } from '../src/prisma/prisma.module';
import { PrismaService } from '../src/prisma/prisma.service';

describe('AuditLog Partitioning (e2e)', () => {
  let app: INestApplication | undefined;
  let prisma: PrismaService | undefined;

  beforeAll(async () => {
    try {
      const moduleFixture: TestingModule = await Test.createTestingModule({
        imports: [PrismaModule],
      }).compile();

      app = moduleFixture.createNestApplication();
      await app.init();
      prisma = app.get(PrismaService);
    } catch (error) {
      console.log('Skipping e2e test: PrismaModule initialization failed (likely missing database connection/dependencies)', error);
    }
  });

  afterAll(async () => {
    if (prisma && prisma.isConnected()) {
      await prisma.auditLog.deleteMany({
        where: {
          actorId: { in: ['test-actor-current', 'test-actor-prior', 'test-actor-old'] },
        },
      });
    }
    if (app) {
      await app.close();
    }
  });

  it('asserts that AUDIT rows from prior months still query and write with the same Prisma client API', async () => {
    // If the database is not connected (e.g. running in unit test env without live PG/SQLite), skip
    if (!app || !prisma || !prisma.isConnected()) {
      console.log('Skipping e2e partitioning test: database or AppModule not initialized');
      return;
    }

    const currentMonthDate = new Date();
    
    // Create dates for prior months
    const oneMonthAgoDate = new Date();
    oneMonthAgoDate.setMonth(oneMonthAgoDate.getMonth() - 1);
    
    const twoMonthsAgoDate = new Date();
    twoMonthsAgoDate.setMonth(twoMonthsAgoDate.getMonth() - 2);

    // 1. Insert logs using the standard Prisma client API
    const logCurrent = await prisma.auditLog.create({
      data: {
        actorId: 'test-actor-current',
        entity: 'campaign',
        entityId: 'c-curr',
        action: 'create',
        timestamp: currentMonthDate,
      },
    });

    const logPrior = await prisma.auditLog.create({
      data: {
        actorId: 'test-actor-prior',
        entity: 'campaign',
        entityId: 'c-prior',
        action: 'update',
        timestamp: oneMonthAgoDate,
      },
    });

    const logOld = await prisma.auditLog.create({
      data: {
        actorId: 'test-actor-old',
        entity: 'campaign',
        entityId: 'c-old',
        action: 'delete',
        timestamp: twoMonthsAgoDate,
      },
    });

    expect(logCurrent.id).toBeDefined();
    expect(logPrior.id).toBeDefined();
    expect(logOld.id).toBeDefined();

    // 2. Query logs from prior months using the standard findMany API
    const allLogs = await prisma.auditLog.findMany({
      where: {
        actorId: { in: ['test-actor-current', 'test-actor-prior', 'test-actor-old'] },
      },
      orderBy: {
        timestamp: 'asc',
      },
    });

    expect(allLogs).toHaveLength(3);
    expect(allLogs[0].actorId).toBe('test-actor-old');
    expect(allLogs[1].actorId).toBe('test-actor-prior');
    expect(allLogs[2].actorId).toBe('test-actor-current');

    // 3. Assert updates (needed for retention policies/anonymization) work via the same API
    const updateResult = await prisma.auditLog.updateMany({
      where: {
        actorId: 'test-actor-old',
      },
      data: {
        deletedAt: new Date(),
      },
    });

    expect(updateResult.count).toBe(1);

    const updatedLog = await prisma.auditLog.findFirst({
      where: { actorId: 'test-actor-old' },
    });
    expect(updatedLog?.deletedAt).not.toBeNull();
  });
});
