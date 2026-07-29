# Fix test file — supertest is NOT available

The file `test/modules/kudos.spec.ts` currently imports `supertest`, but that package is NOT installed in this project and you CANNOT modify package.json to add it.

You must rewrite `test/modules/kudos.spec.ts` to work WITHOUT supertest. Use NestJS's built-in HTTP testing approach instead.

The recommended approach:
- Import `KudosModule` (not `AppModule`) from `../../src/modules/kudos/kudos.module`
- Import `PrismaService` from `../../src/modules/kudos/prisma.service`  
- Import `HealthController` from `../../src/platform/health.controller` (view it first to check its constructor signature and imports)
- Import `Test` from `@nestjs/testing`
- Import `INestApplication` from `@nestjs/common`
- Create the NestJS app using `Test.createTestingModule`, init it, and use the app's HTTP server with the native `http` module or just call controller/service methods directly

**BEST APPROACH**: Since supertest is unavailable, use a hybrid approach:
1. For controller/service level tests: get the controller/service from the module and call methods directly
2. For HTTP-level integration tests: use Node's native `http` module or `fetch` to make requests against the running NestJS app

OR even simpler: Just use the app instance and the NestJS `HttpAdapterHost` or make direct fetch/http calls. Here's the key pattern:

```typescript
const app = moduleFixture.createNestApplication();
await app.init();
await app.listen(0); // random port
const url = await app.getUrl();
// then use fetch(url + '/kudos', ...) for requests
```

**View these files first** to understand the existing test patterns and health controller:
- `test/platform/chassis.test.ts` — see how the existing tests work
- `src/platform/health.controller.ts` — see the health endpoint structure
- `src/app.module.ts` — see how AppModule imports MODULES

The test must cover ALL 12 test cases as originally specified:
1. POST valid payload → 201 with id, trimmed fields, createdAt
2. POST trims whitespace
3. POST missing field → 400
4. POST empty string → 400
5. POST whitespace-only → 400
6. POST sender > 100 chars → 400
7. POST receiver > 100 chars → 400
8. POST message > 500 chars → 400
9. POST non-string field → 400
10. GET empty → 200 with []
11. GET sorted by createdAt desc, id desc
12. GET /health reports modules_registered: 1

After rewriting, verify by running:
```
/harness/runs/kudos-wall/claude-code--all-gemini-flash-high/2026-07-28T21-49-28/out/run-in-env.sh "pnpm test"
```

Fix any issues until the tests pass. The build already passes — do NOT modify any source files, only `test/modules/kudos.spec.ts`.

IMPORTANT: vitest globals are enabled, so `describe`, `it`, `expect`, `beforeAll`, `afterAll`, `beforeEach` are available without imports (though importing from 'vitest' also works).
