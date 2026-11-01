package ruletest

import (
	"fmt"
	"testing"
)

// TestRepoDetections runs the real rules in detections/ so `go test ./...`
// fails whenever a rule or fixture is broken.
func TestRepoDetections(t *testing.T) {
	rep, err := Run("../../../detections/rules", "../../../detections/tests")
	if err != nil {
		t.Fatal(err)
	}
	for _, p := range rep.Problems {
		t.Error(p)
	}
	for _, c := range rep.Cases {
		t.Run(fmt.Sprintf("%s/%v", c.RuleID, c.Fixture), func(t *testing.T) {
			if c.Err != nil {
				t.Fatal(c.Err)
			}
			if c.Got != c.Expect {
				t.Fatalf("fired = %v, want %v", c.Got, c.Expect)
			}
		})
	}
	if len(rep.Cases) == 0 {
		t.Fatal("no fixture cases ran")
	}
}
