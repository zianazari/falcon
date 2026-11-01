package sink

import (
	"context"
	"time"

	"cloud.google.com/go/bigquery"

	"falcon/pipeline/internal/event"
)

// BigQuery streams rows into the events, alerts and deadletter tables.
// Table schemas live in infra/terraform/modules/bigquery/schemas.
type BigQuery struct {
	client                     *bigquery.Client
	events, alerts, deadletter *bigquery.Inserter
}

// NewBigQuery uses Application Default Credentials (the Cloud Run service account).
func NewBigQuery(ctx context.Context, project, dataset string) (*BigQuery, error) {
	client, err := bigquery.NewClient(ctx, project)
	if err != nil {
		return nil, err
	}
	ds := client.Dataset(dataset)
	return &BigQuery{
		client:     client,
		events:     ds.Table("events").Inserter(),
		alerts:     ds.Table("alerts").Inserter(),
		deadletter: ds.Table("deadletter").Inserter(),
	}, nil
}

type eventRow struct {
	ID            string        `bigquery:"id"`
	Timestamp     time.Time     `bigquery:"ts"`
	ReceivedAt    time.Time     `bigquery:"received_at"`
	Source        string        `bigquery:"source"`
	LogType       string        `bigquery:"log_type"`
	Service       string        `bigquery:"service"`
	Action        string        `bigquery:"action"`
	Resource      string        `bigquery:"resource"`
	Project       string        `bigquery:"project"`
	Actor         string        `bigquery:"actor"`
	ActorType     string        `bigquery:"actor_type"`
	SrcIP         string        `bigquery:"src_ip"`
	IPClass       string        `bigquery:"ip_class"`
	UserAgent     string        `bigquery:"user_agent"`
	Outcome       string        `bigquery:"outcome"`
	StatusCode    int           `bigquery:"status_code"`
	StatusMessage string        `bigquery:"status_message"`
	Severity      string        `bigquery:"severity"`
	IAMDeltas     []iamDeltaRow `bigquery:"iam_deltas"`
	Raw           string        `bigquery:"raw"`
}

type iamDeltaRow struct {
	Action string `bigquery:"action"`
	Role   string `bigquery:"role"`
	Member string `bigquery:"member"`
}

// WriteEvent implements Sink. The event ID is the insert ID, so Pub/Sub
// redeliveries are deduplicated by BigQuery on a best-effort basis.
func (b *BigQuery) WriteEvent(ctx context.Context, ev event.Event) error {
	row := eventRow{
		ID: ev.ID, Timestamp: ev.Timestamp, ReceivedAt: ev.ReceivedAt, Source: ev.Source,
		LogType: ev.LogType, Service: ev.Service, Action: ev.Action, Resource: ev.Resource,
		Project: ev.Project, Actor: ev.Actor, ActorType: ev.ActorType, SrcIP: ev.SrcIP,
		IPClass: ev.IPClass, UserAgent: ev.UserAgent, Outcome: ev.Outcome,
		StatusCode: ev.StatusCode, StatusMessage: ev.StatusMessage, Severity: ev.Severity,
		Raw: string(ev.Raw),
	}
	for _, d := range ev.IAMDeltas {
		row.IAMDeltas = append(row.IAMDeltas, iamDeltaRow(d))
	}
	return b.events.Put(ctx, &bigquery.StructSaver{Struct: row, InsertID: ev.ID})
}

type alertRow struct {
	ID          string    `bigquery:"id"`
	RuleID      string    `bigquery:"rule_id"`
	Title       string    `bigquery:"title"`
	Severity    string    `bigquery:"severity"`
	Mitre       []string  `bigquery:"mitre"`
	Runbook     string    `bigquery:"runbook"`
	EventID     string    `bigquery:"event_id"`
	EventTime   time.Time `bigquery:"event_ts"`
	DetectedAt  time.Time `bigquery:"detected_at"`
	Actor       string    `bigquery:"actor"`
	Action      string    `bigquery:"action"`
	Resource    string    `bigquery:"resource"`
	Project     string    `bigquery:"project"`
	SrcIP       string    `bigquery:"src_ip"`
	Description string    `bigquery:"description"`
}

// WriteAlerts implements Sink.
func (b *BigQuery) WriteAlerts(ctx context.Context, alerts []event.Alert) error {
	if len(alerts) == 0 {
		return nil
	}
	rows := make([]*bigquery.StructSaver, 0, len(alerts))
	for _, a := range alerts {
		rows = append(rows, &bigquery.StructSaver{Struct: alertRow(a), InsertID: a.ID})
	}
	return b.alerts.Put(ctx, rows)
}

type deadLetterRow struct {
	ReceivedAt time.Time `bigquery:"received_at"`
	MessageID  string    `bigquery:"message_id"`
	Error      string    `bigquery:"error"`
	Payload    string    `bigquery:"payload"`
}

// WriteDeadLetter implements Sink.
func (b *BigQuery) WriteDeadLetter(ctx context.Context, dl event.DeadLetter) error {
	return b.deadletter.Put(ctx, &bigquery.StructSaver{Struct: deadLetterRow(dl), InsertID: dl.MessageID})
}

// Close implements Sink.
func (b *BigQuery) Close() error { return b.client.Close() }
