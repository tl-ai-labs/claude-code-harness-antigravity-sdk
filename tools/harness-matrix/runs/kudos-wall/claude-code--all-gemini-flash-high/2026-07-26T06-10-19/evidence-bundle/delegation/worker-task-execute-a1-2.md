# Fix integration tests — supertest is NOT available

The test file at `test/modules/kudos/kudos.spec.ts` currently uses `supertest`, but that package is NOT installed and we CANNOT modify `package.json` to add it.

Rewrite `test/modules/kudos/kudos.spec.ts` to use NestJS's built-in HTTP testing approach WITHOUT supertest. Here's the approach:

1. Use `@nestjs/testing`'s `Test.createTestingModule` to create the module
2. Create and init the NestJS application
3. Instead of supertest, use Node's built-in `http` module or the app's `getHttpServer()` to make HTTP requests. A simple approach is to use `fetch` or NestJS's own internal approach.

Actually, the simplest approach that works without supertest: use `app.getHttpServer()` to get the underlying HTTP server, then `await app.listen(0)` to bind to a random port, get the URL, and use `fetch()` (available in Node 18+) to make requests. Or even simpler, use `app.inject()` — but NestJS doesn't have inject.

**The best approach**: Use the `http` module from Node.js. Create a helper function that:
- Gets the server via `app.getHttpServer()`
- Makes requests using Node's `http.request`

OR even better: since we can `await app.listen(0)`, get the URL, and use global `fetch` (Node 18+).

Here's the pattern to use:

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { KudosModule } from '../../../src/modules/kudos/kudos.module';
import { PrismaService } from '../../../src/modules/kudos/prisma.service';
import { AppModule } from '../../../src/app.module';

describe('Kudos Wall Integration', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let baseUrl: string;

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
    await app.listen(0);
    const server = app.getHttpServer();
    const address = server.address();
    baseUrl = `http://127.0.0.1:${address.port}`;
    prisma = app.get<PrismaService>(PrismaService);
  });

  // Then use fetch() for all requests:
  // const res = await fetch(`${baseUrl}/kudos`, { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({...}) });
  // const body = await res.json();
  // expect(res.status).toBe(201);
```

Rewrite the ENTIRE test file using this pattern. Keep all the same test cases:
1. AC-1: POST /kudos valid with whitespace trimming → 201
2. AC-2: POST /kudos all-whitespace senderName → 400
3. AC-3: POST /kudos senderName 101 chars → 400, message 501 chars → 400
4. FR-3: POST /kudos missing field → 400
5. AC-4: GET /kudos empty → 200, []
6. AC-5: GET /kudos after two creates → most recent first
7. AC-7: GET /health → modules_registered: 1

Remember to:
- Clean kudos table in beforeEach
- Close app in afterAll
- Use `await app.listen(0)` to get a random port
- Use `fetch()` for all HTTP requests
- Do NOT import or use supertest
