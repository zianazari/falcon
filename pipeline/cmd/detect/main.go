// Command detect is the detection-as-code CLI.
//
//	detect test [-rules DIR] [-tests DIR]   run every rule against its fixtures (CI gate)
//	detect run  [-rules DIR] FILE.json      show the normalized event and the rules it triggers
package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"time"

	"falcon/pipeline/internal/alert"
	"falcon/pipeline/internal/detect"
	"falcon/pipeline/internal/normalize"
	"falcon/pipeline/internal/ruletest"
)

func main() {
	if len(os.Args) < 2 {
		usage()
	}
	var err error
	switch os.Args[1] {
	case "test":
		err = cmdTest(os.Args[2:])
	case "run":
		err = cmdRun(os.Args[2:])
	default:
		usage()
	}
	if err != nil {
		fmt.Fprintln(os.Stderr, "error:", err)
		os.Exit(1)
	}
}

func usage() {
	fmt.Fprintln(os.Stderr, "usage: detect test [-rules DIR] [-tests DIR] | detect run [-rules DIR] FILE.json")
	os.Exit(2)
}

func cmdTest(args []string) error {
	fs := flag.NewFlagSet("test", flag.ExitOnError)
	rulesDir := fs.String("rules", "../detections/rules", "rules directory")
	testsDir := fs.String("tests", "../detections/tests", "fixtures directory")
	fs.Parse(args)

	rep, err := ruletest.Run(*rulesDir, *testsDir)
	if err != nil {
		return err
	}
	pass, fail := 0, 0
	for _, c := range rep.Cases {
		want := "fire"
		if !c.Expect {
			want = "no-fire"
		}
		status := "PASS"
		detail := ""
		if !c.Passed() {
			status, fail = "FAIL", fail+1
			if c.Err != nil {
				detail = " error: " + c.Err.Error()
			} else {
				detail = fmt.Sprintf(" (fired=%v)", c.Got)
			}
		} else {
			pass++
		}
		fmt.Printf("%s  %-36s %-8s %s%s\n", status, c.RuleID, want, filepath.Base(c.Fixture), detail)
	}
	for _, p := range rep.Problems {
		fmt.Println("FAIL  " + p)
		fail++
	}
	fmt.Printf("\n%d passed, %d failed\n", pass, fail)
	if rep.Failed() {
		return fmt.Errorf("detection tests failed")
	}
	return nil
}

func cmdRun(args []string) error {
	fs := flag.NewFlagSet("run", flag.ExitOnError)
	rulesDir := fs.String("rules", "../detections/rules", "rules directory")
	fs.Parse(args)
	if fs.NArg() != 1 {
		usage()
	}
	data, err := os.ReadFile(fs.Arg(0))
	if err != nil {
		return err
	}
	ev, err := normalize.Normalize(data, time.Now())
	if err != nil {
		return err
	}
	rules, err := detect.LoadDir(*rulesDir)
	if err != nil {
		return err
	}
	alerts, err := detect.NewEngine(rules).Evaluate(ev, time.Now())
	if err != nil {
		return err
	}

	ev.Raw = nil // the input file already shows it
	out, _ := json.MarshalIndent(ev, "", "  ")
	fmt.Printf("normalized event:\n%s\n\n", out)
	if len(alerts) == 0 {
		fmt.Println("no rules matched")
	}
	for _, a := range alerts {
		fmt.Println("ALERT " + alert.Format(a))
	}
	return nil
}
