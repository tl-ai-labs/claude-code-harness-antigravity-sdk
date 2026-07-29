# Task: Requirements Analysis for "Kudos Wall" Service

You are a requirements analyst. Your job is to read the scaffold repository and produce a requirements document for a "Kudos Wall" service.

## Client Brief

Build a small kudos service: a user posts a kudos (who it's from, who it's for, and a short message), and can list all kudos, most recent first.

Deliverable: a working software service the client operates themselves.
Cost basis: per project.

## What You Must Do

1. Read the scaffold's CONVENTIONS.md file to understand what the platform already provides (health endpoint, DB pipeline, test setup, field conventions, etc.).

2. Read the Prisma schema (prisma/schema.prisma) and any existing source files to understand the scaffold's naming conventions, validation patterns, and what's already built.

3. Based on the brief AND the scaffold conventions, produce the FULL text content of a requirements.md file with EXACTLY these two sections (both headings verbatim):

   ## Functional requirements
   Numbered requirements (FR-1, FR-2, …), each one testable and traceable to the brief. Where the brief is silent on a detail the implementation cannot avoid (field lengths, validation, ordering ties, error responses…), decide it and record the decision as part of the requirement — do not leave it open.

   ## Acceptance criteria
   Numbered criteria (AC-1, AC-2, …), each concretely verifiable against a running service, each referencing the FR(s) it covers.

4. Scope discipline: cover everything the brief asks for and NOTHING more — no invented features (auth, pagination, admin UIs, rate limiting, etc.) unless the brief explicitly requires them.

## CRITICAL CONSTRAINTS

- This is a READ-ONLY task. Do NOT create, modify, or delete ANY file in the repository.
- Output ONLY the full markdown content for the requirements.md file.
- Every requirement must be concrete and testable. Decide ambiguous details (field lengths, validation rules, ordering tie-breaking, error response codes/shapes) rather than leaving them open.
- Align decisions with whatever conventions CONVENTIONS.md specifies (e.g., if it specifies field length limits, ID formats, error shapes, use those).
