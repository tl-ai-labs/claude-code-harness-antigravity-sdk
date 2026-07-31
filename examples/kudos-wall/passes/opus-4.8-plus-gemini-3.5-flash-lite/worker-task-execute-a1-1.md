# EXECUTE stage — implement the Kudos Wall feature on the service-web scaffold

You are implementing a finalized design on a NestJS + Prisma (SQLite) scaffold.
Your working directory is the repo root. A finalized design.md and packets.json
already exist in the out dir; the relevant facts are summarized below — but you
must read the actual repo files to confirm the chassis conventions before you
write code.

## The one hard rule about which files you may touch

You may create or modify files ONLY inside these slots:
- `src/modules/**` (your module files)
- `src/modules/index.ts` (register modules in the MODULES array)
- `test/modules/**` (your specs)
- `prisma/schema.prisma` — but ONLY by APPENDING models below the
  `// ═══ MODEL SLOT ═══` marker. Everything above the marker (datasource,
  generator, AppMeta) must remain byte-identical.

Do NOT touch any other file: package.json, tsconfig.json, src/main.ts,
src/platform/**, test/platform/**, vitest.config.ts, prisma/seed.mjs,
lockfiles. Changing any of them fails the run. Do NOT add dependencies.

First, READ these to learn the actual conventions before coding:
- prisma/schema.prisma (find the MODEL SLOT marker, datasource, AppMeta)
- src/modules/index.ts (the MODULES array shape)
- src/platform/** health controller (how modules_registered is computed)
- any existing example module under src/modules if present
- test/** for the vitest + @nestjs/testing conventions

## What to build

A "Kudos Wall": a NestJS module `KudosModule` under `src/modules/kudos/` with
two endpoints, backed by one Prisma model. Implement all of the following, in
this order.

### 1. Prisma model (prisma/schema.prisma)
Append exactly one model below the MODEL SLOT marker:

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

Leave the datasource/generator/AppMeta blocks untouched.

### 2. src/modules/kudos/kudos.types.ts
Export a `KudosRecord` response shape with fields `id` (number), `from`,
`to`, `message` (strings), `createdAt` (Date). Export bound constants
`FROM_MAX = 80`, `TO_MAX = 80`, `MESSAGE_MAX = 280`.

### 3. src/modules/kudos/kudos.prisma.ts
Export an injectable `PrismaService` that `extends PrismaClient` (from
`@prisma/client`) and implements NestJS `OnModuleInit` (calls `$connect()`)
and `OnModuleDestroy` (calls `$disconnect()`). The chassis ships no shared
Prisma provider, so this module supplies its own.

### 4. src/modules/kudos/kudos.service.ts
Injectable `KudosService`, constructor-injects `PrismaService`.

`create(body: unknown): Promise<KudosRecord>` runs this ordered validation
pipeline; the FIRST failure throws `BadRequestException` (from `@nestjs/common`,
HTTP 400) and NO row is created:
  1. `body` must be a plain object — reject if null, not typeof "object", or
     an array.
  2. The set of own-enumerable keys must be a subset of {from, to, message};
     any unknown/extra key (e.g. a caller-supplied `id` or `createdAt`) → 400.
  3. Each of `from`, `to`, `message` must be present and a string
     (missing key or non-string → 400).
  4. Each must be non-empty after `.trim()` (trimmed length >= 1).
  5. Trimmed length bounds: `from` and `to` <= FROM_MAX/TO_MAX (80),
     `message` <= MESSAGE_MAX (280). Over by one → 400.
On success, persist the TRIMMED values via `prisma.kudos.create` (never set
`id` or `createdAt` from the body — the DB assigns them) and return the row.

`list(): Promise<KudosRecord[]>` returns
`prisma.kudos.findMany({ orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] })`.

### 5. src/modules/kudos/kudos.controller.ts
`@Controller('kudos')`:
  - `@Post()` `@HttpCode(201)` `create(@Body() body: unknown)` → delegates to
    `KudosService.create` (returns created object with 201 status).
  - `@Get()` `list()` → delegates to `KudosService.list` (default 200).

### 6. src/modules/kudos/kudos.module.ts
`@Module({ controllers: [KudosController], providers: [KudosService,
PrismaService] })` exporting `KudosModule`.

### 7. src/modules/index.ts
Import `KudosModule` and include it in the exported `MODULES` array so the
chassis mounts it and `GET /health` reports `modules_registered >= 1`.

### 8. Tests under test/modules/kudos/ (vitest globals + @nestjs/testing)
Create `test/modules/kudos/kudos.service.spec.ts` wiring `KudosService` with a
STUB `PrismaService` (override the provider with an in-memory fake whose
`kudos.create` assigns an incrementing id + a createdAt and stores the row, and
whose `kudos.findMany` returns rows sorted per the orderBy). No real DB. Cover:
  - missing `from` / `to` / `message` each → BadRequestException, no create call
  - blank-after-trim (e.g. "  ") → 400
  - non-string field (e.g. from: 123) → 400
  - lengths 80/80/280 accepted; 81/81/281 each rejected
  - " Ada " is stored and returned trimmed as "Ada"
  - non-object body ("hello", []) and an extra `id` key → 400, no create
  - created record echoes trimmed fields plus a truthy `id` and a `createdAt`
  - `list()` returns most-recent-first order (create A, B, C → expect C, B, A),
    returns [] when empty, and applies the createdAt-desc then id-desc tie-break
    (two rows with the same createdAt come back highest-id-first)

Create `test/modules/kudos/kudos.registration.spec.ts` asserting `MODULES`
includes `KudosModule`, and that
`Test.createTestingModule({ imports: [KudosModule] })` with `PrismaService`
overridden by a stub compiles and resolves `KudosController`.

## Verification you must pass
Both of these must exit zero (run them via the env helper as needed):
  pnpm build   (runs prisma generate + tsc — the Kudos model must generate a
                `kudos` delegate on @prisma/client)
  pnpm test    (vitest — all specs green)

Note: the toolchain runs inside a container; if you cannot run pnpm directly,
still make the code correct and self-consistent. I will run the build/test.

Report back: the list of files you created/edited, and any decision you made
where the design was silent.
