# Goal

Create a new test file at `utils/cache/harness_repro_test.go` that demonstrates the bug where `Keys()` returns expired items from the SimpleCache.

# Background

The file `utils/cache/simple_cache.go` defines a `SimpleCache` interface with a `Keys()` method. The implementation wraps `ttlcache.Cache` and `Keys()` just calls `c.data.Keys()`. The problem is that expired items are NOT filtered out — `Keys()` returns keys of expired items.

The existing tests in `utils/cache/simple_cache_test.go` use Ginkgo/Gomega. BUT we need a standard Go test (using `testing` package) so we can run it with `go test -run TestHarnessRepro`.

# What to create

Create the file `utils/cache/harness_repro_test.go` with this content:

```go
package cache

import (
	"testing"
	"time"
)

func TestHarnessReproExpiredKeysNotEvicted(t *testing.T) {
	c := NewSimpleCache[string, string](Options{
		DefaultTTL: 1 * time.Millisecond,
	})

	err := c.Add("key1", "value1")
	if err != nil {
		t.Fatalf("failed to add key1: %v", err)
	}
	err = c.Add("key2", "value2")
	if err != nil {
		t.Fatalf("failed to add key2: %v", err)
	}

	// Wait for items to expire
	time.Sleep(50 * time.Millisecond)

	// Verify that Get correctly returns an error for expired items
	_, err = c.Get("key1")
	if err == nil {
		t.Fatal("expected error for expired key1, but got nil")
	}

	// The bug: Keys() still returns expired keys
	keys := c.Keys()
	if len(keys) != 0 {
		t.Errorf("expected Keys() to return 0 keys after expiration, got %d: %v", len(keys), keys)
	}
}
```

# Contract

- Create ONLY this one file: `utils/cache/harness_repro_test.go`
- Do NOT modify any existing files
- The file must be in the `cache` package
- The test function must be named `TestHarnessReproExpiredKeysNotEvicted`
