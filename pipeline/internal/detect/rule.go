// Package detect loads detection-as-code rules (YAML) and evaluates them
// against normalized events.
package detect

import (
	"bytes"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"slices"
	"sort"
	"strings"

	"gopkg.in/yaml.v3"
)

var severities = []string{"low", "medium", "high", "critical"}

var ruleIDPattern = regexp.MustCompile(`^[a-z0-9]+(-[a-z0-9]+)*$`)

// Rule is one detection. See detections/README.md for the authoring guide.
type Rule struct {
	ID          string   `yaml:"id"`
	Title       string   `yaml:"title"`
	Description string   `yaml:"description"`
	Severity    string   `yaml:"severity"`
	Mitre       []string `yaml:"mitre"`
	Runbook     string   `yaml:"runbook"`
	Enabled     *bool    `yaml:"enabled"`
	Match       *Node    `yaml:"match"`

	File string `yaml:"-"`
}

// IsEnabled reports whether the rule runs; rules are enabled unless disabled explicitly.
func (r *Rule) IsEnabled() bool { return r.Enabled == nil || *r.Enabled }

// Node is a condition in a rule's match tree. Exactly one of the combinators
// (all, any, not, some) or a field condition is set.
type Node struct {
	All   []*Node `yaml:"all"`
	Any   []*Node `yaml:"any"`
	Not   *Node   `yaml:"not"`
	Some  string  `yaml:"some"`
	Where *Node   `yaml:"where"`

	Field      string  `yaml:"field"`
	Equals     any     `yaml:"equals"`
	In         []any   `yaml:"in"`
	Contains   *string `yaml:"contains"`
	StartsWith *string `yaml:"starts_with"`
	EndsWith   *string `yaml:"ends_with"`
	Regex      *string `yaml:"regex"`
	Exists     *bool   `yaml:"exists"`

	re *regexp.Regexp
}

// LoadDir loads and validates every *.yaml / *.yml rule in dir.
func LoadDir(dir string) ([]*Rule, error) {
	var files []string
	for _, pat := range []string{"*.yaml", "*.yml"} {
		m, err := filepath.Glob(filepath.Join(dir, pat))
		if err != nil {
			return nil, err
		}
		files = append(files, m...)
	}
	sort.Strings(files)
	if len(files) == 0 {
		return nil, fmt.Errorf("no rules found in %s", dir)
	}

	var rules []*Rule
	var errs []error
	seen := map[string]string{}
	for _, f := range files {
		r, err := LoadFile(f)
		if err != nil {
			errs = append(errs, err)
			continue
		}
		if prev, dup := seen[r.ID]; dup {
			errs = append(errs, fmt.Errorf("%s: duplicate rule id %q (also in %s)", f, r.ID, prev))
			continue
		}
		seen[r.ID] = f
		rules = append(rules, r)
	}
	return rules, errors.Join(errs...)
}

// LoadFile parses and validates a single rule file. Unknown keys are errors,
// so a typo like "equal:" fails CI instead of silently never matching.
func LoadFile(path string) (*Rule, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	dec := yaml.NewDecoder(bytes.NewReader(data))
	dec.KnownFields(true)
	var r Rule
	if err := dec.Decode(&r); err != nil {
		return nil, fmt.Errorf("%s: %w", path, err)
	}
	r.File = path
	if err := r.validate(); err != nil {
		return nil, fmt.Errorf("%s: %w", path, err)
	}
	return &r, nil
}

func (r *Rule) validate() error {
	var errs []error
	if !ruleIDPattern.MatchString(r.ID) {
		errs = append(errs, fmt.Errorf("id %q must be lowercase kebab-case", r.ID))
	}
	if strings.TrimSpace(r.Title) == "" {
		errs = append(errs, errors.New("title is required"))
	}
	if strings.TrimSpace(r.Description) == "" {
		errs = append(errs, errors.New("description is required"))
	}
	if !slices.Contains(severities, r.Severity) {
		errs = append(errs, fmt.Errorf("severity %q must be one of %v", r.Severity, severities))
	}
	if r.Match == nil {
		errs = append(errs, errors.New("match is required"))
	} else if err := r.Match.validate("match"); err != nil {
		errs = append(errs, err)
	}
	return errors.Join(errs...)
}

func (n *Node) validate(path string) error {
	kinds := 0
	if n.All != nil {
		kinds++
	}
	if n.Any != nil {
		kinds++
	}
	if n.Not != nil {
		kinds++
	}
	if n.Some != "" {
		kinds++
	}
	if n.Field != "" {
		kinds++
	}
	if kinds != 1 {
		return fmt.Errorf("%s: exactly one of all/any/not/some/field is required", path)
	}

	switch {
	case n.All != nil || n.Any != nil:
		children, name := n.All, "all"
		if n.Any != nil {
			children, name = n.Any, "any"
		}
		if len(children) == 0 {
			return fmt.Errorf("%s.%s: must not be empty", path, name)
		}
		var errs []error
		for i, c := range children {
			if c == nil {
				errs = append(errs, fmt.Errorf("%s.%s[%d]: empty condition", path, name, i))
				continue
			}
			errs = append(errs, c.validate(fmt.Sprintf("%s.%s[%d]", path, name, i)))
		}
		return errors.Join(errs...)
	case n.Not != nil:
		return n.Not.validate(path + ".not")
	case n.Some != "":
		if n.Where == nil {
			return fmt.Errorf("%s: some requires where", path)
		}
		return n.Where.validate(path + ".where")
	}

	ops := 0
	for _, set := range []bool{n.Equals != nil, n.In != nil, n.Contains != nil, n.StartsWith != nil,
		n.EndsWith != nil, n.Regex != nil, n.Exists != nil} {
		if set {
			ops++
		}
	}
	if ops != 1 {
		return fmt.Errorf("%s (field %s): exactly one operator (equals/in/contains/starts_with/ends_with/regex/exists) is required", path, n.Field)
	}
	if n.Regex != nil {
		re, err := regexp.Compile(*n.Regex)
		if err != nil {
			return fmt.Errorf("%s (field %s): bad regex: %w", path, n.Field, err)
		}
		n.re = re
	}
	return nil
}
