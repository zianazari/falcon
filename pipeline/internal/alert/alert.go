// Package alert delivers alerts to humans: the console locally, Slack in the cloud.
package alert

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"sync"
	"time"

	"falcon/pipeline/internal/event"
)

// Notifier sends one alert somewhere a human will see it.
type Notifier interface {
	Notify(ctx context.Context, a event.Alert) error
}

// Format renders an alert as a single line.
func Format(a event.Alert) string {
	return fmt.Sprintf("[%s] %s  actor=%s  resource=%s  project=%s  mitre=%s",
		strings.ToUpper(a.Severity), a.RuleID, a.Actor, a.Resource, a.Project, strings.Join(a.Mitre, ","))
}

// Console writes a line per alert.
type Console struct {
	mu sync.Mutex
	W  io.Writer
}

// Notify implements Notifier.
func (c *Console) Notify(_ context.Context, a event.Alert) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	_, err := fmt.Fprintln(c.W, "ALERT "+Format(a))
	return err
}

// Slack posts to an incoming webhook.
type Slack struct {
	WebhookURL string
	Client     *http.Client
}

var severityEmoji = map[string]string{
	"critical": ":rotating_light:", "high": ":red_circle:", "medium": ":large_orange_circle:", "low": ":white_circle:",
}

// Notify implements Notifier.
func (s *Slack) Notify(ctx context.Context, a event.Alert) error {
	text := fmt.Sprintf("%s *%s* (%s)\n*Actor:* `%s`  *Project:* `%s`\n*Resource:* `%s`\n*MITRE:* %s",
		severityEmoji[a.Severity], a.Title, a.RuleID, a.Actor, a.Project, a.Resource, strings.Join(a.Mitre, ", "))
	if a.Runbook != "" {
		text += "\n*Runbook:* " + a.Runbook
	}
	body, _ := json.Marshal(map[string]string{"text": text})

	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, s.WebhookURL, bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	client := s.Client
	if client == nil {
		client = http.DefaultClient
	}
	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 300 {
		return fmt.Errorf("slack webhook: status %d", resp.StatusCode)
	}
	return nil
}

// Multi fans an alert out to every notifier and joins their errors.
type Multi []Notifier

// Notify implements Notifier.
func (m Multi) Notify(ctx context.Context, a event.Alert) error {
	var errs []error
	for _, n := range m {
		errs = append(errs, n.Notify(ctx, a))
	}
	return errors.Join(errs...)
}
