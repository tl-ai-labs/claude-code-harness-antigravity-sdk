# Task: Requirements Analysis for Kudos Wall Service

You are the requirements analyst. Your job is to:

1. READ the scaffold's CONVENTIONS.md in the repository working directory to understand:
   - What the platform already provides (health endpoint, DB pipeline, test setup)
   - Field naming conventions
   - Validation patterns
   - Any constraints on data types, field lengths, or ordering

2. READ any other relevant scaffold files (e.g., Prisma schema, existing controllers, module structure) to understand what infrastructure is already in place.

3. Analyze the following client brief:

```
# Kudos Wall

Build a small kudos service: a user posts a kudos (who it's from, who it's for,
and a short message), and a can list all kudos, most recent first.

Deliverable: a working software service the client operates themselves.
Cost basis: per project.
```

4. Produce your analysis as a REPORT on stdout (do NOT write any files). Your report must include:

   a. A summary of what the scaffold already provides (so we know what NOT to re-specify).
   
   b. A section titled "## Functional requirements" with numbered requirements (FR-1, FR-2, …), each one testable and traceable to the brief. Where the brief is silent on a detail the implementation cannot avoid (field lengths, validation, ordering ties, etc.), DECIDE it and record the decision as part of the requirement — do not leave it open. Scope discipline: cover everything the brief asks for and NOTHING more — no invented features (auth, pagination, admin UIs…).

   c. A section titled "## Acceptance criteria" with numbered criteria (AC-1, AC-2, …), each concretely verifiable against a running service, each referencing the FR(s) it covers.

CRITICAL CONSTRAINTS:
- This is a READ-ONLY stage. Do NOT create, modify, or delete ANY file in the repository.
- Do NOT run any git commands that modify state.
- ONLY read files and report your analysis on stdout.
