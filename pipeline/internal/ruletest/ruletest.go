// Package ruletest runs every detection rule against its fixtures:
//
//	detections/tests/<rule-id>/should_fire/*.json
//	detections/tests/<rule-id>/should_not_fire/*.json
//
// Fixtures are raw GCP LogEntry JSON, so they exercise normalization too.
// A rule with no fixtures in either directory is a failure.
package ruletest

import (
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"time"

	"falcon/pipeline/internal/detect"
	"falcon/pipeline/internal/normalize"
)

// Case is the result of one fixture against one rule.
type Case struct {
	RuleID  string
	Fixture string
	Expect  bool // true = should fire
	Got     bool
	Err     error
}

// Passed reports whether the fixture behaved as expected.
func (c Case) Passed() bool { return c.Err == nil && c.Expect == c.Got }

// Report is the full result of a run.
type Report struct {
	Cases    []Case
	Problems []string // structural problems, such as rules without fixtures
}

// Failed reports whether anything failed.
func (r Report) Failed() bool {
	if len(r.Problems) > 0 {
		return true
	}
	for _, c := range r.Cases {
		if !c.Passed() {
			return true
		}
	}
	return false
}

// Run loads rules from rulesDir and checks them against testsDir.
func Run(rulesDir, testsDir string) (Report, error) {
	rules, err := detect.LoadDir(rulesDir)
	if err != nil {
		return Report{}, err
	}
	var rep Report
	ruleIDs := map[string]bool{}
	for _, r := range rules {
		ruleIDs[r.ID] = true
		for _, expect := range []bool{true, false} {
			sub := "should_not_fire"
			if expect {
				sub = "should_fire"
			}
			files, _ := filepath.Glob(filepath.Join(testsDir, r.ID, sub, "*.json"))
			sort.Strings(files)
			if len(files) == 0 {
				rep.Problems = append(rep.Problems, fmt.Sprintf("%s: no fixtures in %s/", r.ID, filepath.Join(testsDir, r.ID, sub)))
			}
			for _, f := range files {
				rep.Cases = append(rep.Cases, runOne(r, f, expect))
			}
		}
	}

	// Fixtures for a rule that no longer exists usually mean a rename went wrong.
	dirs, _ := os.ReadDir(testsDir)
	for _, d := range dirs {
		if d.IsDir() && !ruleIDs[d.Name()] {
			rep.Problems = append(rep.Problems, fmt.Sprintf("%s/: fixtures for unknown rule", filepath.Join(testsDir, d.Name())))
		}
	}
	return rep, nil
}

func runOne(r *detect.Rule, file string, expect bool) Case {
	c := Case{RuleID: r.ID, Fixture: file, Expect: expect}
	data, err := os.ReadFile(file)
	if err != nil {
		c.Err = err
		return c
	}
	ev, err := normalize.Normalize(data, time.Now())
	if err != nil {
		c.Err = err
		return c
	}
	c.Got, c.Err = detect.Matches(r, ev)
	return c
}
