// Package server is the HTTP front of the pipeline. It receives Pub/Sub push
// deliveries and runs each message through normalize -> detect -> sink -> notify.
//
// Delivery semantics (Pub/Sub retries any non-2xx response):
//   - unparseable message: written to the dead-letter sink and acked (204).
//     Retrying would never succeed.
//   - sink failure: 500, so Pub/Sub retries. After max attempts the
//     subscription's dead-letter topic takes the message.
//   - notifier failure: logged only. The alert is already persisted.
package server

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"sync"
	"sync/atomic"
	"time"

	"falcon/pipeline/internal/alert"
	"falcon/pipeline/internal/detect"
	"falcon/pipeline/internal/event"
	"falcon/pipeline/internal/normalize"
	"falcon/pipeline/internal/sink"
)

// Server processes Pub/Sub push requests.
type Server struct {
	Engine   *detect.Engine
	Sink     sink.Sink
	Notifier alert.Notifier
	Log      *slog.Logger
	Now      func() time.Time

	dedup *dedup
	stats stats
}

type stats struct {
	Processed    atomic.Int64
	Duplicates   atomic.Int64
	Alerts       atomic.Int64
	DeadLettered atomic.Int64
	Errors       atomic.Int64
}

// New wires a server. dedupSize bounds how many recent event IDs are remembered.
func New(eng *detect.Engine, s sink.Sink, n alert.Notifier, log *slog.Logger, dedupSize int) *Server {
	return &Server{Engine: eng, Sink: s, Notifier: n, Log: log, Now: time.Now, dedup: newDedup(dedupSize)}
}

// Handler returns the HTTP routes.
func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("POST /pubsub/push", s.handlePush)
	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, _ *http.Request) { w.Write([]byte("ok")) })
	mux.HandleFunc("GET /stats", s.handleStats)
	return mux
}

// pushEnvelope is the body Pub/Sub sends to push endpoints.
type pushEnvelope struct {
	Message struct {
		Data       []byte            `json:"data"` // base64 in JSON; decoded by encoding/json
		MessageID  string            `json:"messageId"`
		Attributes map[string]string `json:"attributes"`
	} `json:"message"`
	Subscription string `json:"subscription"`
}

func (s *Server) handlePush(w http.ResponseWriter, r *http.Request) {
	var env pushEnvelope
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 10<<20)).Decode(&env); err != nil {
		s.stats.Errors.Add(1)
		http.Error(w, "bad push envelope", http.StatusBadRequest)
		return
	}
	if err := s.Process(r.Context(), env.Message.MessageID, env.Message.Data); err != nil {
		s.stats.Errors.Add(1)
		s.Log.Error("processing failed, will be retried", "message_id", env.Message.MessageID, "err", err)
		http.Error(w, "processing failed", http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// Process handles one message. A returned error means "retry".
func (s *Server) Process(ctx context.Context, messageID string, data []byte) error {
	now := s.Now()
	ev, err := normalize.Normalize(data, now)
	if errors.Is(err, normalize.ErrInvalid) {
		s.stats.DeadLettered.Add(1)
		s.Log.Warn("dead-lettering unparseable message", "message_id", messageID, "err", err)
		return s.Sink.WriteDeadLetter(ctx, event.DeadLetter{
			ReceivedAt: now.UTC(), MessageID: messageID, Error: err.Error(), Payload: string(data),
		})
	}
	if err != nil {
		return err
	}

	if s.dedup.seen(ev.ID) {
		s.stats.Duplicates.Add(1)
		return nil
	}

	alerts, err := s.Engine.Evaluate(ev, now)
	if err != nil {
		return err
	}
	if err := s.Sink.WriteEvent(ctx, ev); err != nil {
		return err
	}
	if err := s.Sink.WriteAlerts(ctx, alerts); err != nil {
		return err
	}
	s.dedup.add(ev.ID)
	s.stats.Processed.Add(1)
	s.stats.Alerts.Add(int64(len(alerts)))

	for _, a := range alerts {
		s.Log.Info("alert", "rule_id", a.RuleID, "severity", a.Severity, "actor", a.Actor, "event_id", a.EventID)
		if err := s.Notifier.Notify(ctx, a); err != nil {
			s.Log.Error("notify failed", "rule_id", a.RuleID, "err", err)
		}
	}
	return nil
}

func (s *Server) handleStats(w http.ResponseWriter, _ *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{
		"processed":     s.stats.Processed.Load(),
		"duplicates":    s.stats.Duplicates.Load(),
		"alerts":        s.stats.Alerts.Load(),
		"dead_lettered": s.stats.DeadLettered.Load(),
		"errors":        s.stats.Errors.Load(),
		"rules":         len(s.Engine.Rules()),
	})
}

// dedup remembers the last N event IDs. Pub/Sub delivers at least once, and
// this stops a redelivery from paging someone twice.
type dedup struct {
	mu   sync.Mutex
	ids  map[string]struct{}
	ring []string
	next int
}

func newDedup(size int) *dedup {
	return &dedup{ids: make(map[string]struct{}, size), ring: make([]string, size)}
}

func (d *dedup) seen(id string) bool {
	d.mu.Lock()
	defer d.mu.Unlock()
	_, ok := d.ids[id]
	return ok
}

func (d *dedup) add(id string) {
	d.mu.Lock()
	defer d.mu.Unlock()
	if _, ok := d.ids[id]; ok {
		return
	}
	if old := d.ring[d.next]; old != "" {
		delete(d.ids, old)
	}
	d.ring[d.next] = id
	d.ids[id] = struct{}{}
	d.next = (d.next + 1) % len(d.ring)
}
