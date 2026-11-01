// Package sink persists events, alerts and dead letters.
package sink

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"sync"

	"falcon/pipeline/internal/event"
)

// Sink is where processed data lands: BigQuery in the cloud, files locally.
type Sink interface {
	WriteEvent(ctx context.Context, ev event.Event) error
	WriteAlerts(ctx context.Context, alerts []event.Alert) error
	WriteDeadLetter(ctx context.Context, dl event.DeadLetter) error
	Close() error
}

// File writes JSON Lines to events.jsonl, alerts.jsonl and deadletter.jsonl in dir.
type File struct {
	mu                         sync.Mutex
	events, alerts, deadletter *os.File
}

// NewFile opens (appending) the three files in dir.
func NewFile(dir string) (*File, error) {
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return nil, err
	}
	open := func(name string) (*os.File, error) {
		return os.OpenFile(filepath.Join(dir, name), os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o644)
	}
	f := &File{}
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
