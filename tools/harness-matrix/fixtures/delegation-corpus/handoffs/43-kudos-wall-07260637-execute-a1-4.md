# Fix test/modules/kudos.spec.ts — bypass NestJS DI (esbuild compatibility)

## The problem

vitest uses esbuild for transformation, which does NOT support `emitDecoratorMetadata`. NestJS DI requires reflect-metadata to resolve constructor parameters. Because `vitest.config.ts` is a chassis file (cannot be modified), we cannot switch to SWC. So `Test.createTestingModule()` will NOT work — the DI container can't resolve dependencies.

## The solution

Bypass NestJS DI entirely. Manually instantiate the classes:

```typescript
const prisma = new PrismaService();
const service = new KudosService(prisma);
const controller = new KudosController(service);
```

This works because:
- `PrismaService` extends `PrismaClient` — it connects to the default `file:./dev.db`
- `KudosService` takes `PrismaService` as a constructor parameter
- `KudosController` takes `KudosService` as a constructor parameter
- esbuild can handle the class definitions fine — it just strips the decorators

## Rewrite test/modules/kudos.spec.ts

Only modify this one file: `test/modules/kudos.spec.ts`

```typescript
import { BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../src/modules/kudos/prisma.service';
import { KudosService } from '../../src/modules/kudos/kudos.service';
import { KudosController } from '../../src/modules/kudos/kudos.controller';

describe('KudosController (Integration)', () => {
  let prisma: PrismaService;
  let service: KudosService;
  let controller: KudosController;

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();

    // Create the Kudos table if it doesn't exist
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "Kudos" (
        "id" INTEGER PRIMARY KEY AUTOINCREMENT,
        "sender" TEXT NOT NULL,
        "recipient" TEXT NOT NULL,
        "message" TEXT NOT NULL,
        "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);

    service = new KudosService(prisma);
    controller = new KudosController(service);
  });

  beforeEach(async () => {
    await prisma.kudos.deleteMany();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  // 1. POST valid data returns correct shape
  it('should create kudos with valid data and return correct shape', async () => {
    const result = await controller.createKudos({
      sender: '  Alice  ',
      recipient: '  Bob  ',
      message: '  Great work!  ',
    });

    expect(result).toBeDefined();
    expect(typeof result.id).toBe('number');
    expect(Number.isInteger(result.id)).toBe(true);
    expect(result.sender).toBe('Alice');
    expect(result.recipient).toBe('Bob');
    expect(result.message).toBe('Great work!');
    expect(result.createdAt).toBeInstanceOf(Date);
  });

  // 2. POST missing field returns 400
  it('should throw BadRequestException if a field is missing', async () => {
    await expect(
      controller.createKudos({ sender: 'Alice', recipient: 'Bob' } as any)
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  // 3. POST whitespace-only field returns 400
  it('should throw BadRequestException if a field is whitespace only', async () => {
    await expect(
      controller.createKudos({ sender: '   ', recipient: 'Bob', message: 'Hello' })
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  // 4. POST non-string field returns 400
  it('should throw BadRequestException if a field is not a string', async () => {
    await expect(
      controller.createKudos({ sender: 123 as any, recipient: 'Bob', message: 'Hello' })
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  // 5. POST over-length sender returns 400
  it('should throw BadRequestException if sender is over length', async () => {
    await expect(
      controller.createKudos({ sender: 'A'.repeat(51), recipient: 'Bob', message: 'Hello' })
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  // 6. POST over-length recipient returns 400
  it('should throw BadRequestException if recipient is over length', async () => {
    await expect(
      controller.createKudos({ sender: 'Alice', recipient: 'B'.repeat(51), message: 'Hello' })
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  // 7. POST over-length message returns 400
  it('should throw BadRequestException if message is over length', async () => {
    await expect(
      controller.createKudos({ sender: 'Alice', recipient: 'Bob', message: 'M'.repeat(501) })
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  // 8. GET returns records ordered by createdAt desc
  it('should return records ordered by createdAt descending', async () => {
    await controller.createKudos({ sender: 'Alice', recipient: 'Bob', message: 'First' });
    await new Promise(resolve => setTimeout(resolve, 50));
    await controller.createKudos({ sender: 'Charlie', recipient: 'Dave', message: 'Second' });

    const allKudos = await controller.findAllKudos();

    expect(allKudos.length).toBe(2);
    expect(allKudos[0].message).toBe('Second');
    expect(allKudos[1].message).toBe('First');
  });

  // 9. GET tie-break by id desc when same createdAt
  it('should return records tie-breaking by id descending for same createdAt', async () => {
    const fixedCreatedAt = new Date('2026-01-01T00:00:00.000Z');
    await prisma.kudos.create({
      data: { sender: 'Eve', recipient: 'Frank', message: 'Awesome!', createdAt: fixedCreatedAt },
    });
    await prisma.kudos.create({
      data: { sender: 'Grace', recipient: 'Heidi', message: 'Fantastic!', createdAt: fixedCreatedAt },
    });

    const allKudos = await controller.findAllKudos();

    expect(allKudos.length).toBe(2);
    expect(allKudos[0].id).toBeGreaterThan(allKudos[1].id);
  });
});
```

After writing this file, run `pnpm build` and then `pnpm test`. Both must pass. If they fail, read the error output and fix.
