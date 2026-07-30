# Fix test/modules/kudos.spec.ts — database table missing

The tests fail because the separate `test.db` PrismaClient doesn't have the `Kudos` table created. The error is: "The table `main.Kudos` does not exist in the current database."

## Root cause

The test creates a standalone `PrismaClient` pointing to `file:./test.db`, but no schema migration has been run against that database. The Kudos table doesn't exist there.

## The fix

Rewrite test/modules/kudos.spec.ts to NOT use a separate PrismaClient. Instead:

1. Import `KudosModule`, `KudosController`, and `PrismaService` from the source.
2. In `beforeAll`, create the NestJS test module importing `KudosModule` (no overrideProvider).
3. Get `controller` and `prisma` (PrismaService) from the module.
4. Call `app.init()` which triggers `PrismaService.onModuleInit()` → `$connect()`.
5. CRITICALLY: Create the Kudos table via raw SQL before any test runs:
   ```typescript
   await prisma.$executeRawUnsafe(`
     CREATE TABLE IF NOT EXISTS "Kudos" (
       "id" INTEGER PRIMARY KEY AUTOINCREMENT,
       "sender" TEXT NOT NULL,
       "recipient" TEXT NOT NULL,
       "message" TEXT NOT NULL,
       "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
     )
   `);
   ```
6. In `beforeEach`, clean with `await prisma.kudos.deleteMany()`.
7. In `afterAll`, close the app with `await app.close()`.

The test file MUST NOT create its own separate PrismaClient. It should use the module's PrismaService (which connects to the default `file:./dev.db`).

DO NOT touch any files besides `test/modules/kudos.spec.ts`.

Keep ALL 9 test cases as they are (they are correct), just fix the setup/teardown.

After making changes, run `pnpm build` then `pnpm test`. Both must pass. If they fail, read the errors and fix.
