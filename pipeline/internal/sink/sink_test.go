package sink

import (
	"context"
	"testing"
	"time"

	"falcon/pipeline/internal/event"
)

func TestFileLastEvent(t *testing.T) {
	f, err := NewFile(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	ctx := context.Background()

	got, err := f.LastEvent(ctx, "update", "/topics/canary")
	if err != nil || !got.IsZero() {
		t.Fatalf("empty file: got %v, %v", got, err)
	}

	base := time.Date(2026, 11, 1, 12, 0, 0, 0, time.UTC)
	for _, ev := range []event.Event{
		{ID: "1", Timestamp: base, Action: "update", Resource: "projects/p/topics/canary"},
		{ID: "2", Timestamp: base.Add(time.Hour), Action: "update", Resource: "projects/p/topics/canary"},
		{ID: "3", Timestamp: base.Add(2 * time.Hour), Action: "update", Resource: "projects/p/topics/other"},
		{ID: "4", Timestamp: base.Add(3 * time.Hour), Action: "delete", Resource: "projects/p/topics/canary"},
	} {
		if err := f.WriteEvent(ctx, ev); err != nil {
			t.Fatal(err)
		}
	}
	got, err = f.LastEvent(ctx, "update", "/topics/canary")
	if err != nil || !got.Equal(base.Add(time.Hour)) {
		t.Fatalf("got %v, %v", got, err)
	}
}
