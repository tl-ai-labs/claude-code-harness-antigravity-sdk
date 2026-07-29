You are a requirements analyst. Your goal is to read the scaffold's conventions and produce a requirements document for a "Kudos Wall" service.

## Steps

1. Read the file `CONVENTIONS.md` in the repository root. Note the conventions for:
   - ID formats (e.g., auto-increment vs UUID vs cuid)
   - Field naming (camelCase vs snake_case)
   - Validation patterns and field length limits
   - Timestamp formats
   - Database setup (Prisma schema location, migration approach)
   - Test setup (Vitest, e2e patterns)
   - Any other relevant conventions

2. Also briefly scan `prisma/schema.prisma` to understand the existing DB setup and model patterns.

3. Based on what you learn, produce a requirements document and write it to this EXACT path in the output directory (NOT the working directory):
   `/harness/runs/kudos-wall/claude-code--all-gemini-flash-high/2026-07-28T21-49-28/out/requirements.md`

## Client Brief

# Kudos Wall

Build a small kudos service: a user posts a kudos (who it's from, who it's for, and a short message), and can list all kudos, most recent first.

Deliverable: a working software service the client operates themselves.
Cost basis: per project.

## Requirements Document Contract

The file MUST contain EXACTLY these two sections with these exact headings:

### `## Functional requirements`
- Numbered FR-1, FR-2, etc.
- Each must be testable and traceable to the brief.
- Where the brief is silent on a detail the implementation cannot avoid (field lengths, validation, ordering ties, ID format, timestamp format…), YOU decide it based on the scaffold conventions and record the decision as part of the requirement.
- Do NOT leave any implementation-critical detail open.

### `## Acceptance criteria`
- Numbered AC-1, AC-2, etc.
- Each must be concretely verifiable against a running service (e.g., "POST /kudos with valid body returns 201 and the created kudo").
- Each must reference the FR(s) it covers.

## Scope Rules — CRITICAL
- Cover ONLY what the brief asks for: posting a kudos and listing all kudos most-recent-first.
- Do NOT invent features beyond the brief: no authentication, no pagination, no admin UI, no delete/update endpoints, no user management, no rate limiting, no search/filter.
- The service needs a health endpoint only if the scaffold already provides one (it likely does — just note it exists, don't add requirements for it).

## File Rules
- Do NOT modify any file in the working directory.
- Do NOT run git commit.
- ONLY write the requirements.md file to the output directory path above.
