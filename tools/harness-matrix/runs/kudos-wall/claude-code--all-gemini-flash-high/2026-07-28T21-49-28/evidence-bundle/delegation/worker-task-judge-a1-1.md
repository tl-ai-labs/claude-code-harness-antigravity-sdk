You are judging a delivered Kudos Wall service. This is a READ-ONLY task — do NOT modify any files.

## Step 1: Read all changed files

Read these files (paths relative to the repository root):
- prisma/schema.prisma
- src/modules/index.ts
- src/modules/kudos/kudos.controller.ts
- src/modules/kudos/kudos.module.ts
- src/modules/kudos/kudos.service.ts
- src/modules/kudos/prisma.service.ts
- test/modules/kudos.spec.ts

## Step 2: Run the test suite

Execute this command and capture the full output:
```
pnpm test
```

## Step 3: Evaluate each acceptance criterion

Check the code against each AC:

- **AC-1 (Create Kudos - Success)**: POST /kudos with valid payload → 201 Created, response contains trimmed sender/receiver/message, integer id, createdAt as UTC ISO 8601 string.
- **AC-2 (Create Kudos - Validation failures)**: Missing fields, empty/whitespace-only strings, sender/receiver > 100 chars, message > 500 chars, wrong types (integer/boolean for string fields) → all must return 400 with error message, no DB record created.
- **AC-3 (List Kudos - Ordered)**: GET /kudos → 200, JSON array, sorted by createdAt DESC with id DESC as tiebreaker.
- **AC-4 (List Kudos - Empty DB)**: GET /kudos with no records → 200, empty array [].
- **AC-5 (Health + Module Mount)**: GET /health → 200, modules_registered >= 1.
- **AC-6 (Tests Pass)**: pnpm test → all green, zero failures.

## Step 4: Score each dimension

For each, check these specifics:

**Requirements fidelity (0-10)**:
- Does POST /kudos trim sender, receiver, and message before persisting?
- Are length limits enforced: sender ≤ 100, receiver ≤ 100, message ≤ 500 (after trimming)?
- Are non-string types rejected (e.g., integer or boolean for sender)?
- Does GET /kudos order by createdAt DESC with id DESC tiebreaker?
- Does the Prisma schema match: id (Int, @id, autoincrement), sender (String), receiver (String), message (String), createdAt (DateTime, @default(now()))?
- Is validation manual (not using class-validator)?
- Does the kudos module export correctly in src/modules/index.ts?

**Code quality (0-10)**:
- Proper NestJS module structure under src/modules/kudos/
- Clean naming conventions
- Error handling (proper HTTP exceptions)
- Manual validation implementation quality

**Test quality (0-10)**:
- Do tests cover AC-1 through AC-5?
- Edge cases: whitespace-only input, too-long fields, wrong types, ordering tiebreaker, empty DB
- Are tests integration tests using the actual NestJS testing module?
- Do tests genuinely verify behavior or just check surface-level things?

## Step 5: Output

Print your complete analysis, then end with a JSON block in exactly this shape:

```json
{
  "scores": {
    "requirements_fidelity": <0-10>,
    "code_quality": <0-10>,
    "test_quality": <0-10>,
    "overall": <0-10>
  },
  "summary": "<one paragraph: strongest aspect, weakest aspect, what justifies overall score>"
}
```

Score honestly: 10 = nothing to improve, 5 = works but real gaps, 0 = absent/broken. Do not grade on a curve.
