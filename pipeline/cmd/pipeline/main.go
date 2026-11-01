// Command pipeline is the security log pipeline service (Cloud Run or local).
//
// Configuration (environment):
//
//	PORT               listen port (default 8080)
//	RULES_DIR          detection rules directory (default /rules)
//	SINK               "file" (default) or "bigquery"
//	SINK_DIR           output directory for SINK=file (default ./data)
//	BQ_PROJECT         BigQuery project for SINK=bigquery
//	BQ_DATASET         BigQuery dataset for SINK=bigquery
//	SLACK_WEBHOOK_URL  optional; alerts are also posted to Slack
//	CANARY_MAX_AGE     optional; how old the last canary may be (default 15m)
package main

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"falcon/pipeline/internal/alert"
	"falcon/pipeline/internal/detect"
	"falcon/pipeline/internal/server"
	"falcon/pipeline/internal/sink"
)

func main() {
	// The distroless image has no shell or curl, so the container healthcheck
	// calls the binary itself.
	if len(os.Args) > 1 && os.Args[1] == "-healthcheck" {
		resp, err := http.Get("http://localhost:" + env("PORT", "8080") + "/healthz")
		if err != nil || resp.StatusCode != http.StatusOK {
			os.Exit(1)
		}
		os.Exit(0)
	}

	log := slog.New(slog.NewJSONHandler(os.Stderr, nil))
	if err := run(log); err != nil {
		log.Error("fatal", "err", err)
		os.Exit(1)
	}
}

func env(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

func run(log *slog.Logger) error {
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	rules, err := detect.LoadDir(env("RULES_DIR", "/rules"))
	if err != nil {
		return fmt.Errorf("loading rules: %w", err)
	}
	eng := detect.NewEngine(rules)

	var s sink.Sink
	switch kind := env("SINK", "file"); kind {
	case "file":
		s, err = sink.NewFile(env("SINK_DIR", "./data"))
	case "bigquery":
		s, err = sink.NewBigQuery(ctx, os.Getenv("BQ_PROJECT"), os.Getenv("BQ_DATASET"))
	default:
		err = fmt.Errorf("unknown SINK %q", kind)
	}
	if err != nil {
		return fmt.Errorf("sink: %w", err)
	}
	defer s.Close()

	notifiers := alert.Multi{&alert.Console{W: os.Stdout}}
	if url := os.Getenv("SLACK_WEBHOOK_URL"); url != "" {
		notifiers = append(notifiers, &alert.Slack{WebhookURL: url})
	}

	srv := server.New(eng, s, notifiers, log, 10_000)
	if v := os.Getenv("CANARY_MAX_AGE"); v != "" {
		if srv.CanaryMaxAge, err = time.ParseDuration(v); err != nil {
			return fmt.Errorf("CANARY_MAX_AGE: %w", err)
		}
	}
	httpSrv := &http.Server{
		Addr:              ":" + env("PORT", "8080"),
		Handler:           srv.Handler(),
		ReadHeaderTimeout: 10 * time.Second,
	}

	go func() {
		<-ctx.Done()
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		httpSrv.Shutdown(shutdownCtx)
	}()

	log.Info("pipeline started", "addr", httpSrv.Addr, "rules", len(eng.Rules()), "sink", env("SINK", "file"))
	if err := httpSrv.ListenAndServe(); !errors.Is(err, http.ErrServerClosed) {
		return err
	}
	return nil
}
