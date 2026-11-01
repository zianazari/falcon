// Package sink persists events, alerts and dead letters.
package sink

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"io"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"falcon/pipeline/internal/event"
)

// Sink is where processed data lands: BigQuery in the cloud, files locally.
type Sink interface {
	WriteEvent(ctx context.Context, ev event.Event) error
	WriteAlerts(ctx context.Context, alerts []event.Alert) error
	WriteDeadLetter(ctx context.Context, dl event.DeadLetter) error
	// LastEvent returns when the newest event with this action and resource
	// suffix happened, or the zero time if there is none.
	LastEvent(ctx context.Context, action, resourceSuffix string) (time.Time, error)
	Close() error
}

// File writes JSON Lines to events.jsonl, alerts.jsonl and deadletter.jsonl in dir.
type File struct {
	mu                         sync.Mutex
	events, alerts, deadletter *os.File
	eventsPath                 string
}

// NewFile opens (appending) the three files in dir.
func NewFile(dir string) (*File, error) {
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return nil, err
	}
	open := func(name string) (*os.File, error) {
		return os.OpenFile(filepath.Join(dir, name), os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o644)
	}
	f := &File{eventsPath: filepath.Join(dir, "events.jsonl")}
	var err error
	if f.events, err = open("events.jsonl"); err != nil {
		return nil, err
	}
	if f.alerts, err = open("alerts.jsonl"); err != nil {
		return nil, err
	}
	if f.deadletter, err = open("deadletter.jsonl"); err != nil {
		return nil, err
	}
	return f, nil
}

func (f *File) write(file *os.File, v any) error {
	b, err := json.Marshal(v)
	if err != nil {
		return err
	}
	f.mu.Lock()
	defer f.mu.Unlock()
	_, err = file.Write(append(b, '\n'))
	return err
}

// WriteEvent implements Sink.
func (f *File) WriteEvent(_ context.Context, ev event.Event) error { return f.write(f.events, ev) }

// WriteAlerts implements Sink.
func (f *File) WriteAlerts(_ context.Context, alerts []event.Alert) error {
	for _, a := range alerts {
		if err := f.write(f.alerts, a); err != nil {
			return err
		}
	}
	return nil
}

// WriteDeadLetter implements Sink.
func (f *File) WriteDeadLetter(_ context.Context, dl event.DeadLetter) error {
	return f.write(f.deadletter, dl)
}

// LastEvent implements Sink by scanning events.jsonl.
func (f *File) LastEvent(_ context.Context, action, resourceSuffix string) (time.Time, error) {
	file, err := os.Open(f.eventsPath)
	if err != nil {
		return time.Time{}, err
	}
	defer file.Close()
	var last time.Time
	r := bufio.NewReader(file)
	for {
		line, err := r.ReadBytes('\n')
		var ev struct {
			Timestamp time.Time `json:"ts"`
			Action    string    `json:"action"`
			Resource  string    `json:"resource"`
		}
		if json.Unmarshal(line, &ev) == nil && ev.Action == action &&
			strings.HasSuffix(ev.Resource, resourceSuffix) && ev.Timestamp.After(last) {
			last = ev.Timestamp
		}
		if errors.Is(err, io.EOF) {
			return last, nil
		}
		if err != nil {
			return time.Time{}, err
		}
	}
}

// Close implements Sink.
func (f *File) Close() error {
	f.mu.Lock()
	defer f.mu.Unlock()
	var first error
	for _, file := range []*os.File{f.events, f.alerts, f.deadletter} {
		if err := file.Close(); err != nil && first == nil {
			first = err
		}
	}
	return first
}
