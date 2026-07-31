# Kudos Wall — Requirements

A small kudos service built on the platform-owned `service-web` scaffold
(NestJS + Prisma/SQLite + TypeScript + Vitest). A user posts a kudos — who
it is from, who it is for, and a short message — and can list all kudos,
most recent first.

The service is delivered as a single NestJS module (`kudos`) mounted through
`src/modules/index.ts`, persisting to the platform Prisma/SQLite database and
exposed over the HTTP API the chassis already serves on port 4000.

## Functional requirements

**FR-1 — Post a kudos.**
The service exposes `POST /kudos` accepting a JSON body with exactly three
caller-supplied string fields: `from` (who it is from), `to` (who it is for),
and `message` (the short message). On success it persists one kudos record and
responds `201 Created` with the created kudos as JSON (see FR-6 for the shape).

**FR-2 — Required fields.**
All three fields (`from`, `to`, `message`) are required. A request in which any
of the three is missing, is not a string, or — after trimming leading/trailing
whitespace — is empty, is rejected with HTTP `400 Bad Request` and no record is
created.

**FR-3 — Field length bounds (decisions on brief-silent details).**
Field values are validated after trimming surrounding whitespace. Because the
brief specifies short free text without limits, the implementation fixes these
bounds:
- `from`: 1–80 characters.
- `to`: 1–80 characters.
- `message`: 1–280 characters ("a short message").
A value that exceeds its maximum length is rejected with HTTP `400 Bad Request`
and no record is created. Stored values are the trimmed values.

**FR-4 — Reject unknown / malformed input.**
A request body that is not a JSON object, or that contains fields other than
`from`, `to`, and `message`, is rejected with HTTP `400 Bad Request` and no
record is created. (Server-assigned fields — see FR-6 — are never accepted from
the caller.)

**FR-5 — List all kudos, most recent first.**
The service exposes `GET /kudos` returning a JSON array of all persisted kudos
ordered most-recent-first. Ordering is by creation time descending; ties
(records with identical creation timestamps) are broken by descending record
identifier so the order is total and deterministic. When no kudos exist it
returns an empty array `[]`. The endpoint returns HTTP `200 OK`.

**FR-6 — Kudos record shape.**
Each persisted and returned kudos is a JSON object with:
- `id` — server-assigned unique identifier, stable across requests.
- `from` — string, the trimmed value supplied at creation.
- `to` — string, the trimmed value supplied at creation.
- `message` — string, the trimmed value supplied at creation.
- `createdAt` — server-assigned creation timestamp (ISO-8601 string) used for
  ordering in FR-5.
`id` and `createdAt` are assigned by the server at creation time and are never
taken from the request body.

**FR-7 — Persistence.**
Kudos are stored in the platform Prisma/SQLite database via a domain model
appended below the `MODEL SLOT` marker in `prisma/schema.prisma`. Records
survive across requests and process restarts; a kudos created via `POST /kudos`
subsequently appears in `GET /kudos`.

**FR-8 — Module registration / no chassis regression.**
The kudos functionality is delivered as a NestJS module registered in the
`MODULES` array of `src/modules/index.ts`, so the chassis mounts it. The
platform `GET /health` endpoint continues to respond and reports
`modules_registered` as at least 1 with the kudos module mounted. The app
builds (`pnpm build`) and its test suite (`pnpm test`) pass green.

## Acceptance criteria

**AC-1 (FR-1, FR-6, FR-7).**
`POST /kudos` with body `{"from":"Ada","to":"Bo","message":"Great work"}`
returns `201` and a JSON object whose `from`, `to`, `message` equal the sent
values and which additionally contains a non-empty `id` and a `createdAt`
timestamp. A subsequent `GET /kudos` includes a record with that `id`.

**AC-2 (FR-2).**
For each of these bodies the service returns `400` and creates no record:
`{"to":"Bo","message":"Hi"}` (missing `from`),
`{"from":"Ada","message":"Hi"}` (missing `to`),
`{"from":"Ada","to":"Bo"}` (missing `message`),
`{"from":"  ","to":"Bo","message":"Hi"}` (blank after trim),
`{"from":123,"to":"Bo","message":"Hi"}` (non-string).

**AC-3 (FR-3).**
`POST /kudos` with `from` of 80 characters, `to` of 80 characters, and
`message` of 280 characters returns `201`. Increasing any one of those by a
single character (81 / 81 / 281) returns `400` with no record created.

**AC-4 (FR-3).**
`POST /kudos` with `{"from":" Ada ","to":"Bo","message":"Hi"}` returns `201`
and the returned/listed record has `from` equal to `"Ada"` (surrounding
whitespace trimmed).

**AC-5 (FR-4).**
`POST /kudos` with a non-object body (e.g. `"hello"` or `[]`) returns `400`,
and a body carrying an extra field
`{"from":"Ada","to":"Bo","message":"Hi","id":"x"}` returns `400`; neither
creates a record.

**AC-6 (FR-5, FR-6).**
Against an empty wall, `GET /kudos` returns `200` with `[]`. After posting
three kudos A then B then C, `GET /kudos` returns `200` with an array of length
3 whose order is C, B, A (most recent first).

**AC-7 (FR-5).**
Given two kudos created in immediate succession, `GET /kudos` returns them in a
stable, deterministic order on repeated calls (later-created record first), with
no duplicated or dropped records.

**AC-8 (FR-7).**
A kudos created via `POST /kudos` is still returned by `GET /kudos` after the
service process is restarted.

**AC-9 (FR-8).**
`GET /health` returns `200` with `ok: true` and `modules_registered` ≥ 1.
`pnpm build` and `pnpm test` both complete successfully (green) with the kudos
module registered.
