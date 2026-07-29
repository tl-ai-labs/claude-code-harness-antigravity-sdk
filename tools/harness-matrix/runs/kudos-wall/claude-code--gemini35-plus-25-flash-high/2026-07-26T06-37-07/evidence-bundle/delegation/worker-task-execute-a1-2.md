# Fix three issues in the Kudos Wall implementation

The implementation from the previous step has three problems that need fixing. Do NOT touch package.json, tsconfig.json, src/main.ts, src/platform/**, test/platform/**, vitest.config.ts, prisma/seed.mjs, or lockfiles.

## Issue 1: Restore pnpm-lock.yaml

The lockfile was accidentally modified. Run this command to restore it:
```
git checkout -- pnpm-lock.yaml
```

## Issue 2: Fix controller validation order in src/modules/kudos/kudos.controller.ts

The current presence check uses `!body.sender` which is too broad — it catches `0`, `false`, and `""` in addition to `undefined`/`null`. The design specifies a strict 5-step validation sequence:

1. **Presence** — check ONLY for `undefined` or `null` (using `=== undefined || === null`)
2. **Type** — check `typeof !== 'string'`
3. **Trim** — trim values
4. **Non-empty** — check trimmed length > 0
5. **Max length** — check sender ≤ 50, recipient ≤ 50, message ≤ 500

Fix the controller to use explicit checks for undefined/null in step 1, not the falsy `!` operator.

## Issue 3: Rewrite test/modules/kudos.spec.ts completely

The current tests are broken — the mock PrismaService doesn't work with NestJS DI. The `KudosService` tests fail with "Cannot read properties of undefined (reading 'kudos')".

Rewrite the tests as integration tests using a REAL PrismaService and real SQLite database. Since `supertest` is NOT installed (don't try to import it), test the controller methods directly.

Here is the approach:
- Import `Test` from `@nestjs/testing` and `INestApplication` from `@nestjs/common`
- Import `KudosModule`, `KudosController`, `KudosService`, and `PrismaService` from the source
- In `beforeAll`: create a test module importing `KudosModule`, get the controller, service, and prisma instances via DI
- In `beforeEach`: clean the kudos table with `await prisma.kudos.deleteMany()`
- In `afterAll`: disconnect prisma

Test cases to cover (9 total):

1. **POST valid data returns correct shape** — Call `controller.createKudos({ sender: '  Alice  ', recipient: '  Bob  ', message: '  Great work!  ' })`. Assert the result has an integer `id`, trimmed string values (`'Alice'`, `'Bob'`, `'Great work!'`), and a `createdAt` Date object.

2. **POST missing field returns 400** — Call `controller.createKudos({ sender: 'Alice', recipient: 'Bob' } as any)` and expect it to throw a `BadRequestException`.

3. **POST whitespace-only field returns 400** — Call with `{ sender: '   ', recipient: 'Bob', message: 'Hello' }` and expect `BadRequestException`.

4. **POST non-string field returns 400** — Call with `{ sender: 123 as any, recipient: 'Bob', message: 'Hello' }` and expect `BadRequestException`.

5. **POST over-length sender returns 400** — `sender: 'A'.repeat(51)`, expect `BadRequestException`.

6. **POST over-length recipient returns 400** — `recipient: 'B'.repeat(51)`, expect `BadRequestException`.

7. **POST over-length message returns 400** — `message: 'M'.repeat(501)`, expect `BadRequestException`.

8. **GET returns records ordered by createdAt desc** — Create two records via the controller with a small delay between them. Call `controller.findAllKudos()`. The second record should appear first.

9. **GET tie-break by id desc** — Create two records directly via `prisma.kudos.create()` with the SAME explicit `createdAt` timestamp. Call `controller.findAllKudos()`. The record with the higher `id` should appear first.

Remember:
- vitest globals are enabled (`describe`, `it`, `expect` work without imports, but `vi` for mocks also works without import)
- Import `BadRequestException` from `@nestjs/common` for type checking in catch blocks
- Test the controller's `createKudos` and `findAllKudos` methods directly (these are the actual method names in the existing controller)
- Don't use supertest — it's not installed

After making changes, verify with:
1. `pnpm build`
2. `pnpm test`

Both must pass. If they fail, read the errors and fix. Iterate until green.
