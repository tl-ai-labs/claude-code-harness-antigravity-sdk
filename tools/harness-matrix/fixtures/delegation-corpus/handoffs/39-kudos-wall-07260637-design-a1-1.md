# Task: Analyze the scaffold chassis and produce a design document for "Kudos Wall"

## Goal
Read the scaffold chassis files to understand the existing structure (how modules register, how Prisma is set up, how tests work, what dependencies are available), then produce the complete content for a design.md document for a Kudos Wall feature.

## Files to read (READ-ONLY — do NOT modify any repository files)

Read these chassis files to understand the scaffold:
- `src/platform/` — all files in this directory
- `src/app.module.ts`
- `src/modules/index.ts`
- `prisma/schema.prisma` — note the MODEL SLOT marker location
- `test/platform/` — all files in this directory
- `package.json` — to see available dependencies

## Requirements to design for

**FR-1: Kudos data model.**
- `id` (Int) — auto-incremented primary key.
- `sender` (String) — 1–50 characters after trimming; must not be blank/whitespace-only.
- `recipient` (String) — 1–50 characters after trimming; must not be blank/whitespace-only.
- `message` (String) — 1–500 characters after trimming; must not be blank/whitespace-only.
- `createdAt` (DateTime) — defaults to current server time.

**FR-2: POST /kudos** — accepts JSON body with sender, recipient, message. Trims whitespace. Returns 400 if any field missing, non-string, empty after trimming, or exceeds length. Returns 201 with the persisted record (id, trimmed sender, trimmed recipient, trimmed message, createdAt as ISO-8601).

**FR-3: GET /kudos** — returns 200 with JSON array of all kudos. Sort by createdAt DESC, tie-break by id DESC.

**FR-4: No unrequested features** — no auth, no update/delete, no pagination/filtering.

## Scaffold rules (design must respect these)
- Only create/modify files in: `src/modules/**`, `src/modules/index.ts`, `test/modules/**`, `prisma/schema.prisma` (below MODEL SLOT marker only)
- Never touch chassis files
- Modules are standard NestJS `@Module()` classes
- Tests use vitest with globals enabled + `@nestjs/testing`
- The `MODULES` array in `src/modules/index.ts` is auto-mounted by the chassis

## Acceptance criteria the design must cover
- AC-1: POST creates with id, trimmed strings, ISO-8601 createdAt
- AC-2: Missing fields → 400
- AC-3: Whitespace-only fields → 400
- AC-4: Trimmed values returned
- AC-5: Over-length fields → 400
- AC-6: GET returns most-recent first
- AC-7: Same createdAt tie-broken by id DESC
- AC-8: No DELETE/PUT/PATCH routes, no auth middleware
- AC-9: GET /health reports modules_registered: 1

## Output format

Print the COMPLETE design.md content with EXACTLY these three sections (headings verbatim):

```
## Data model
```
The Prisma models to append below the MODEL SLOT marker: model names, fields with types, and why each exists (trace to an FR).

```
## API
```
Every HTTP endpoint: method, path, request/response shape, validation rules, error cases. Trace each endpoint to the FR(s) it satisfies.

```
## Module plan
```
The NestJS module(s) to create under src/modules/ — directory name, controller/service/file layout, how each registers in the MODULES array of src/modules/index.ts, and the test files under test/modules/ that will cover them.

## CRITICAL CONSTRAINTS
- This is a READ-ONLY task. Do NOT create, modify, or delete ANY file in the repository.
- Design ONLY what the requirements need — no extras.
- Every design element must be implementable inside the scaffold's slots.
- Pay attention to how PrismaService is provided (check the platform files) so the design uses the correct injection pattern.
