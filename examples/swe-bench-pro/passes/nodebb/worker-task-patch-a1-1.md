# PATCH phase: fix missing "old" sort support in getSortedTopics

## Background / bug
The file `src/topics/sorted.js` implements `Topics.getSortedTopics` (and its
helpers). It supports several descending sort modes (e.g. "recent", "posts",
"votes") by using reverse range queries over sorted sets. However there is NO
handling for the `"old"` sort mode, which is supposed to return topics ordered
by `lastposttime` from OLDEST to NEWEST (ascending order).

Currently, when a caller passes `sort: "old"`, the code falls through to some
default / reverse-sorted behavior instead of returning topics in ascending
chronological order by `lastposttime`. This must be fixed consistently across
queries by tags, by categories, and for the global topic list.

## Your job
1. Read `src/topics/sorted.js` and understand how the existing sort modes are
   dispatched — in particular how the code chooses which sorted set(s) to read
   and whether it reads them in forward (ascending) or reverse (descending)
   order, and how the `data.sort` value maps to that behavior.
2. Implement support for `sort === "old"` so that the returned topics are
   ordered by `lastposttime` ascending (oldest first). Make sure the behavior
   is correct for the three code paths the function handles: tags, categories,
   and the global/plain topic list (no tags, no specific category filter).
3. Fix the ACTUAL ROOT CAUSE — do not special-case any test. The mapping for
   "old" should be handled by the same general dispatch logic the other sort
   modes use.

## Files
- Edit only source files. The primary file is `src/topics/sorted.js`. Only
  touch other source files if the fix genuinely requires it.
- Do NOT edit any test file, any file under a test directory, or any
  `harness_repro*` file.

## Contract to satisfy
- After your change, calling `Topics.getSortedTopics` with `sort: "old"` must
  return topics sorted by `lastposttime` ascending (oldest → newest), for tag
  queries, category queries, and the global topic list.
- Existing descending sort modes ("recent", "posts", "votes", default) must
  continue to work unchanged.

## Report back
When done, print:
- Which file(s) you changed and a short explanation of the root cause and how
  your change addresses it.
- The exact git diff of your changes.
