# Task: Edit utils/cache/simple_cache.go

You MUST edit the file `utils/cache/simple_cache.go`. Use your file editing tools to make the change described below.

## The Change

In the file `utils/cache/simple_cache.go`, the `Keys()` method currently looks like this (lines 86-88):

```go
func (c *simpleCache[K, V]) Keys() []K {
	return c.data.Keys()
}
```

Change it to add a call to `c.data.DeleteExpired()` before returning keys:

```go
func (c *simpleCache[K, V]) Keys() []K {
	c.data.DeleteExpired()
	return c.data.Keys()
}
```

This ensures expired items are evicted before returning the list of keys.

## After editing

Run this command to verify your change works:

```
/harness/runs/instance_navidrome__navidrome-3bc9e75b2843f91f6a1e9b604e321c2bd4fd442a/claude-code--all-gemini-flash-high/2026-07-24T11-17-08/out/run-in-env.sh "go test ./utils/cache/ -run TestHarnessRepro -v"
```

Then run the existing tests:

```
/harness/runs/instance_navidrome__navidrome-3bc9e75b2843f91f6a1e9b604e321c2bd4fd442a/claude-code--all-gemini-flash-high/2026-07-24T11-17-08/out/run-in-env.sh "go test ./utils/cache/ -run 'Test[^H]' -v"
```

## Rules
- Do NOT edit test files
- Do NOT run git commit
