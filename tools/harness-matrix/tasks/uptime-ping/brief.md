# Uptime Ping

Build the smallest useful HTTP service: a single endpoint, `GET /health`,
returning JSON `{ "status": "ok", "uptime_s": <whole seconds since the
process started> }` with a 200 status.

## Scope
- One endpoint only. No auth, no database, no config files, no logging
  framework.
- One unit test proving the handler returns `status: "ok"` and a
  non-negative integer `uptime_s`.

## Out of scope
Everything else. If a decision feels needed, pick the simplest option and
move on.

Deliverable: a working software system the client operates themselves.
Cost basis: per project.
