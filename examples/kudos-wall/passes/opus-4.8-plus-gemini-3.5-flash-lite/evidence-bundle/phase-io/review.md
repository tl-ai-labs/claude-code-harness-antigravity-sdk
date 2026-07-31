# Kudos Wall — Senior Code Review

## Findings

**R-1 (NIT) — `src/modules/kudos/kudos.module.ts`: module exports beyond the design.**
The design specified `@Module({ controllers: [KudosController], providers:
[KudosService, PrismaService] })` with no `exports`. The implementation adds
`exports: [KudosService, PrismaService]`. This is harmless — nothing imports
`KudosModule` to consume its providers, and `AppModule` only spreads `MODULES`
into `imports` — but it is a small deviation from the design and widens the
module's public surface for no current consumer. A fix would drop the `exports`
array to match the design exactly.

**R-2 (MINOR) — `test/modules/kudos/kudos.service.spec.ts`: the "no record created
on rejection" invariant is never asserted.**
The design calls out that on any validation failure "**no** row is created"
(FR-4, and the POST error contract). The `InMemoryPrismaService` stub tracks
`records`, so it is trivial to assert this, but no test checks that
`prismaStub.records` (or a `create` spy) stays untouched after a rejected
`create(...)`. The current code satisfies the invariant structurally (all
validation runs before the single `prisma.kudos.create` call), so this is a
coverage gap rather than a live bug. A fix would add, to at least one rejection
case, `expect(prismaStub.records).toHaveLength(0)` after the `rejects.toThrow`.

**R-3 (NIT) — `test/modules/kudos/kudos.service.spec.ts`: the `createdAt` tie-break
test exercises the stub's sort, not real ordering.**
The tie-break assertion (two rows with identical `createdAt` returning
highest-id-first) is validated against the hand-written comparator inside
`InMemoryPrismaService.findMany`, which itself implements `createdAt desc, id
desc`. The test therefore proves the service passes the correct `orderBy` and
that the stub honors it, but not that Prisma/SQLite produces this order. The
design explicitly and reasonably chose to mock Prisma for determinism (AC-8 is
delegated to the real DB pipeline), so this is acceptable — noted only so the
guarantee's source is clear. No change required.

**R-4 (NIT) — controller-level status codes (`201`/`200`) are not directly tested.**
`@HttpCode(201)` on POST and the default `200` on GET are only implicitly
covered; the registration spec resolves `KudosController` but does not assert
response status. This matches the design's decision to avoid booting HTTP/DB in
specs, and the decorators are declarative, so the risk is low. If desired, a
lightweight e2e/supertest spec could pin the status codes, but it is not needed
to meet the acceptance criteria.

**R-5 (Positive) — implementation is a faithful, idiomatic realization of the design.**
Endpoints (`POST /kudos` → 201, `GET /kudos` → 200), the `Kudos` Prisma model
(appended below the MODEL SLOT marker with the `@@index([createdAt, id])`), the
module layout (`kudos.module/controller/service/prisma/types.ts`), the
`MODULES` registration, and the hand-written validation pipeline all match the
design step-for-step. The validation runs in the specified order (plain-object
→ no-unknown-keys → present-and-string → non-empty-after-trim → max-length),
trims before storing (FR-3/AC-4), never accepts `id`/`createdAt` from the body
(the unknown-keys check), and orders the list `createdAt desc, id desc`
(FR-5/AC-7). `PrismaService` correctly wires `OnModuleInit`/`OnModuleDestroy`.
No chassis file is touched. `pnpm test` is green (14 tests). Clean, no dead
code, no duplication of concern.

## Verdict

APPROVE. The implementation is a precise, idiomatic translation of the design
that stays entirely within the model-owned slots, keeps build and tests green,
and correctly implements every functional requirement including the trimming,
unknown-field rejection, and deterministic `createdAt desc, id desc` ordering.
The only findings are one cosmetic deviation (an unused `exports` array) and
two test-coverage niceties (asserting no-record-on-rejection, and the
acknowledged Prisma-mocking trade-off) — none rises to MAJOR or BLOCKER, so no
changes are required to ship.
