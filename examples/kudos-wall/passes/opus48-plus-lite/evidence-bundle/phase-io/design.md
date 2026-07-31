# Kudos Wall — Design

This design implements the finalized requirements on the platform-owned
`service-web` scaffold. It fits entirely inside the model-owned slots:

- one Prisma model appended below the `MODEL SLOT` marker in
  `prisma/schema.prisma`,
- one NestJS module under `src/modules/kudos/**` registered via the
  `MODULES` array in `src/modules/index.ts`,
- tests under `test/modules/kudos/**`.

No chassis file (`src/platform/**`, `src/main.ts`, `src/app.module.ts`,
`package.json`, `tsconfig.json`, `prisma/seed.mjs`, the datasource/generator
blocks, or `AppMeta`) is created, modified, or moved.

Notable chassis facts this design builds on (confirmed by reading the
checkout):

- The chassis provides **no** shared `PrismaService`; the module supplies its
  own injectable `PrismaClient` wrapper.
- `class-validator` / `class-transformer` are **not** dependencies; all
  validation is hand-written and raises `BadRequestException` (HTTP 400).
- `HealthController` reports `modules_registered = MODULES.length`, so
  registering the module makes `GET /health` report ≥ 1 (FR-8 / AC-9).
- NestJS (`@nestjs/platform-express`) JSON-serializes a JS `Date` returned in
  a response object to an ISO-8601 string automatically, satisfying the
  `createdAt` shape (FR-6) with no manual formatting.

## Data model

Append exactly one model below the `// ═══ MODEL SLOT ═══` marker in
`prisma/schema.prisma`. The datasource (`sqlite`), generator, and `AppMeta`
blocks are left untouched.

```prisma
model Kudos {
  id        Int      @id @default(autoincrement())
  from      String
  to        String
  message   String
  createdAt DateTime @default(now())

  @@index([createdAt, id])
}
```

Field-by-field rationale (each traced to a requirement):

- **`id Int @id @default(autoincrement())`** — server-assigned unique,
  stable identifier (FR-6). Autoincrement is chosen deliberately over a
  random string id because FR-5 requires the tie-break on identical
  `createdAt` timestamps to be **descending record identifier that matches
  creation order**: an autoincrement integer is strictly monotonic with
  insertion, so "highest id wins the tie" == "most-recently created wins",
  giving the total, deterministic order FR-5/AC-7 demand. It starts at 1, so
  the serialized value is always a positive integer — non-empty / truthy as
  AC-1 checks. It is never read from the request body (FR-6): the create
  input never sets `id`.
- **`from String`** — trimmed originator, 1–80 chars (FR-1, FR-3, FR-6).
- **`to String`** — trimmed recipient, 1–80 chars (FR-1, FR-3, FR-6).
- **`message String`** — trimmed short message, 1–280 chars (FR-1, FR-3,
  FR-6). Length bounds are enforced in application code (see API); SQLite has
  no native length constraint, and the requirements fix the bounds at the
  validation layer, so no DB-level column length is used.
- **`createdAt DateTime @default(now())`** — server-assigned creation
  timestamp used to order the list (FR-5, FR-6). Defaulted by the DB/Prisma,
  never taken from the request body (FR-6). Serializes to an ISO-8601 string
  in responses.

- **`@@index([createdAt, id])`** — supports the FR-5 list query
  `ORDER BY createdAt DESC, id DESC`. Not a correctness requirement, but it
  matches the sole read path and keeps the ordering intent explicit.

Persistence (FR-7 / AC-8) is inherent: rows live in the platform
Prisma/SQLite `dev.db`, so a record created by `POST /kudos` is returned by a
later `GET /kudos`, including across process restarts.

## API

Two endpoints, both mounted under the `kudos` controller. Every response body
is JSON. The returned/serialized kudos object (FR-6) is exactly:

```json
{ "id": 1, "from": "Ada", "to": "Bo", "message": "Great work",
  "createdAt": "2026-07-31T09:54:42.000Z" }
```

`id` is a positive integer; `createdAt` is an ISO-8601 string. No other
fields are ever returned.

### POST /kudos — create a kudos (FR-1, FR-2, FR-3, FR-4, FR-6, FR-7)

- **Request body:** a JSON object with exactly the three caller-supplied
  string fields `from`, `to`, `message`.
- **Success:** persists one `Kudos` row (with server-assigned `id` and
  `createdAt`) and responds **`201 Created`** with the created kudos in the
  FR-6 shape. The controller method uses `@HttpCode(201)` so the created
  object is returned as the body with a 201 status.
- **Stored/returned values** are the **trimmed** field values (FR-3, AC-4):
  e.g. `" Ada "` is stored and returned as `"Ada"`.

Validation pipeline (executed in order; the first failure raises
`BadRequestException` → **`400 Bad Request`** and **no** row is created).
Because the scaffold has no `class-validator`, this is a hand-written
validator in the service, invoked by the controller with the raw
`@Body() body: unknown`:

1. **Body is a plain object (FR-4 / AC-5).** Reject if `body` is `null`, not
   `typeof "object"`, or `Array.isArray(body)`. Covers `"hello"` and `[]`.
2. **No unknown fields (FR-4 / AC-5).** The set of own-enumerable keys must be
   a subset of `{from, to, message}`. Any extra key (e.g. a caller-supplied
   `id` or `createdAt`) → 400. This is what guarantees server-assigned fields
   are never accepted from the caller (FR-6).
3. **Each of `from`, `to`, `message` is present and a string (FR-2 / AC-2).**
   Missing key or non-string value (e.g. `from: 123`) → 400.
4. **Non-empty after trim (FR-2 / AC-2).** `value.trim().length >= 1`, else
   400 (covers `"  "`).
5. **Max length after trim (FR-3 / AC-3).** `from` and `to` trimmed length
   ≤ 80; `message` trimmed length ≤ 280. Over by one character → 400.

On success the service writes `{ from: from.trim(), to: to.trim(),
message: message.trim() }` via `prisma.kudos.create`, letting the DB assign
`id` and `createdAt`, and returns the created row.

- **Error body:** the standard Nest `BadRequestException` JSON
  (`{ "statusCode": 400, "message": ..., "error": "Bad Request" }`). The
  requirements only constrain the **status** (400) and the no-record-created
  invariant; the body shape is Nest's default.

### GET /kudos — list all kudos, most recent first (FR-5, FR-6)

- **Request:** no body, no query params.
- **Success:** **`200 OK`** with a JSON array of all kudos in the FR-6 shape,
  ordered `ORDER BY createdAt DESC, id DESC` (`prisma.kudos.findMany({
  orderBy: [{ createdAt: "desc" }, { id: "desc" }] })`). Most-recent-first,
  with ties broken by descending `id` — a total, deterministic, stable order
  (FR-5 / AC-6 / AC-7).
- **Empty wall:** returns `[]` (AC-6).
- No error cases beyond framework-level failures.

### Endpoint → requirement trace

| Endpoint      | Requirements                               |
|---------------|--------------------------------------------|
| `POST /kudos` | FR-1, FR-2, FR-3, FR-4, FR-6, FR-7         |
| `GET /kudos`  | FR-5, FR-6, FR-7                           |
| `GET /health` | FR-8 — chassis-owned, satisfied by registration only |

## Module plan

One NestJS module, `KudosModule`, under `src/modules/kudos/`. Directory
layout (all inside the model-owned slot):

```
src/modules/kudos/
  kudos.module.ts       // @Module wiring controller + services
  kudos.controller.ts   // @Controller("kudos"): POST + GET handlers
  kudos.service.ts      // validation + Prisma access (business logic)
  kudos.prisma.ts       // injectable PrismaClient wrapper (see below)
  kudos.types.ts        // KudosRecord response type + bounds constants
```

Responsibilities:

- **`kudos.prisma.ts` — `PrismaService`.** The chassis ships no shared Prisma
  provider, so the module supplies one: an injectable that
  `extends PrismaClient` and implements `OnModuleInit` (calling `$connect()`)
  and `OnModuleDestroy` (calling `$disconnect()`). It uses the generated
  `@prisma/client` (which `pnpm build` regenerates via `prisma generate`).
  Scoped to this module; no chassis file is touched.
- **`kudos.service.ts` — `KudosService`.** Depends on `PrismaService` via
  constructor DI. Exposes:
  - `create(body: unknown): Promise<KudosRecord>` — runs the FR-2/FR-3/FR-4
    validation pipeline (throwing `BadRequestException` on any failure), then
    persists the trimmed values and returns the created row.
  - `list(): Promise<KudosRecord[]>` — returns all rows ordered
    `createdAt desc, id desc`.
  Validation lives here (not just the controller) so it is unit-testable
  without HTTP.
- **`kudos.controller.ts` — `KudosController`** (`@Controller("kudos")`):
  - `@Post()` `@HttpCode(201)` `create(@Body() body: unknown)` → delegates to
    `KudosService.create`.
  - `@Get()` `list()` → delegates to `KudosService.list` (defaults to 200).
- **`kudos.module.ts` — `KudosModule`**: `@Module({ controllers:
  [KudosController], providers: [KudosService, PrismaService] })`.
- **`kudos.types.ts`**: the `KudosRecord` shape (`id`, `from`, `to`,
  `message`, `createdAt`) and the length-bound constants
  (`FROM_MAX = 80`, `TO_MAX = 80`, `MESSAGE_MAX = 280`) shared by validator
  and tests.

### Registration in `src/modules/index.ts` (FR-8 / AC-9)

The model-owned slot file is edited to register the module:

```ts
import { KudosModule } from "./kudos/kudos.module";

export const MODULES: any[] = [KudosModule];
```

`AppModule` already spreads `MODULES` into its `imports`, and
`HealthController` returns `modules_registered = MODULES.length`, so
`GET /health` now reports `1` with `ok: true` (AC-9) — no chassis change
needed.

### Tests under `test/modules/`

Spec files use vitest globals and `@nestjs/testing`
(`Test.createTestingModule`), per scaffold conventions:

- **`test/modules/kudos/kudos.service.spec.ts` — validation + logic (unit).**
  Wires `KudosService` with a **stub `PrismaService`** (overridden provider
  whose `kudos.create` / `kudos.findMany` are in-memory fakes), so no real DB
  is needed. Covers:
  - AC-2: missing `from` / `to` / `message`, blank-after-trim, non-string →
    each throws (400) and no create call is made.
  - AC-3: 80/80/280 accepted; 81/81/281 each rejected.
  - AC-4: `" Ada "` stored/returned trimmed as `"Ada"`.
  - AC-5: non-object body (`"hello"`, `[]`), and an extra `id` field → 400,
    no create.
  - AC-1/AC-6: created record echoes trimmed fields plus a truthy `id` and a
    `createdAt`; `list()` returns most-recent-first order (C, B, A) and `[]`
    when empty, and applies the `createdAt desc, id desc` tie-break (AC-7).
- **`test/modules/kudos/kudos.registration.spec.ts` — wiring (unit).**
  Asserts `MODULES` includes `KudosModule` and that
  `Test.createTestingModule({ imports: [KudosModule] })` (with
  `PrismaService` overridden by a stub) compiles and resolves
  `KudosController`, guarding FR-8/AC-9 without booting a real DB.

`pnpm build` (prisma generate + tsc) and `pnpm test` (vitest) both stay green
(AC-9). The DB-backed persistence/restart behavior (AC-8) is guaranteed by
the Prisma/SQLite model and the standard `pnpm seed`/runtime pipeline; the
specs deliberately mock Prisma to remain deterministic and DB-independent in
CI.
