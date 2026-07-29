You are a senior code reviewer. Your task is to review a "Kudos Wall" implementation against its design specification. The implementation is in a NestJS + Prisma + SQLite scaffold. This is a READ-ONLY review — do NOT modify any files.

## What to do

1. Read ALL of these changed files in the repository:
   - prisma/schema.prisma
   - src/modules/index.ts
   - src/modules/kudos/kudos.controller.ts
   - src/modules/kudos/kudos.module.ts
   - src/modules/kudos/kudos.service.ts
   - src/modules/kudos/prisma.service.ts
   - test/modules/kudos.spec.ts

2. Also read these chassis files for context:
   - src/main.ts
   - src/platform/app.module.ts (or wherever AppModule is defined — check src/platform/ directory)
   - package.json (to check dependencies)

3. Compare the implementation against the design specification below and produce a detailed review.

## Design specification to review against

### Data model (prisma/schema.prisma)
- A single `Kudos` model appended below the `MODEL SLOT` marker
- Fields: id (Int, @id @default(autoincrement())), sender (String), recipient (String), message (String), createdAt (DateTime, @default(now()))
- Nothing above the marker is touched

### API endpoints
- `POST /kudos` — creates a kudos record, returns 201
  - Validation executed IN ORDER: presence check (not undefined/null) → type check (typeof === 'string') → trim all three → non-empty after trim (length > 0) → max-length (sender ≤ 50, recipient ≤ 50, message ≤ 500)
  - Returns the trimmed values in the response
  - Throws BadRequestException on any validation failure (400)
- `GET /kudos` — returns all kudos ordered by createdAt desc, then id desc as tie-break
- NO PUT, PATCH, DELETE handlers on /kudos or /kudos/:id

### Module layout
- src/modules/kudos/prisma.service.ts — @Injectable() class extending PrismaClient, implements OnModuleInit with $connect()
- src/modules/kudos/kudos.service.ts — injects PrismaService, has create(data) and findAll() methods
  - create() calls prisma.kudos.create() with pre-trimmed, pre-validated data
  - findAll() calls prisma.kudos.findMany({ orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] })
- src/modules/kudos/kudos.controller.ts — @Controller('kudos'), two handlers:
  - @Post() @HttpCode(201) create(@Body() body) — runs five-step validation, delegates to service with trimmed values
  - @Get() findAll() — delegates to service
- src/modules/kudos/kudos.module.ts — controllers: [KudosController], providers: [KudosService, PrismaService]
- src/modules/index.ts — exports MODULES array containing KudosModule (length === 1)

### Tests (test/modules/kudos.spec.ts)
Must cover ALL of these cases:
1. POST valid data → 201, integer id, trimmed strings, createdAt (AC-1, AC-4)
2. POST missing field → 400 (AC-2)
3. POST whitespace-only field → 400 (AC-3)
4. POST non-string field → 400 (FR-2)
5. POST over-length sender (>50) → 400 (AC-5)
6. POST over-length recipient (>50) → 400 (AC-5)
7. POST over-length message (>500) → 400 (AC-5)
8. GET after two sequential POSTs returns later record first (AC-6)
9. GET with same createdAt returns higher id first (AC-7)

## Review dimensions

For each file, evaluate:
1. **Design fidelity**: Does the implementation match the design EXACTLY? Note any deviations — missing fields, wrong validation order, wrong ordering, wrong HTTP codes, extra endpoints, etc.
2. **Correctness**: Edge cases, validation gaps, error handling issues beyond what the tests already prove. For example: does the validation actually run in the specified order? Does it handle all three fields consistently? Are there any code paths that could bypass validation?
3. **Test quality**: Do the tests assert actual behavior (status codes, response body shapes, specific field values) or just existence? Are ALL 9 test cases from the design present? Do the tests properly clean state between runs?
4. **Code quality**: Naming conventions, code duplication, dead code, NestJS/Prisma idiom adherence, TypeScript usage

## Critical things to check

- Does the controller validation run in the EXACT order specified (presence → type → trim → non-empty → max-length)?
- Does POST return exactly 201 (not 200)?
- Does GET ordering use BOTH createdAt desc AND id desc as tie-break?
- Are trimmed values returned in the response (not the original input)?
- Is the Prisma model placed BELOW the MODEL SLOT marker?
- Does prisma.service.ts extend PrismaClient AND implement OnModuleInit?
- Is the MODULES array exported with exactly KudosModule?
- Are there any extra routes (PUT/PATCH/DELETE) that shouldn't exist?

## Output format

Produce your review as a structured list of findings. For each finding, provide:
- An ID (R-1, R-2, etc.)
- Severity: BLOCKER / MAJOR / MINOR / NIT
- File path(s) concerned
- What is wrong or worth noting
- What a fix would look like

If the implementation is genuinely clean, say so rather than inventing problems. Do NOT invent findings just to have something to report.

End with a verdict line: either "APPROVE" or "REQUEST CHANGES" (only REQUEST CHANGES if there's at least one BLOCKER or MAJOR finding), with a short justification paragraph.

IMPORTANT: Do NOT modify any files. This is a read-only review. Just read the code and produce your analysis as text output.
