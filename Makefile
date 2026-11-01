# Falcon: one entry point for building, testing and demoing everything.
# Run `make help` for the list.

SHELL := /bin/bash
TRIAGE_FIXTURES := --fixtures test/fixtures/demo --repo acme/payments-api --repo acme/data-platform
TF_DIR := infra/terraform
DOCKER_TF := docker run --rm -v "$(CURDIR)/$(TF_DIR)":/tf -w /tf

.PHONY: help
help: ## Show this help
	@grep -hE '^[a-z0-9-]+:.*## ' $(MAKEFILE_LIST) | awk 'BEGIN{FS=":.*## "}{printf "  \033[36m%-14s\033[0m %s\n", $$1, $$2}'

## ---- Tests (no Docker, no cloud) ----
.PHONY: test test-go detect-test test-triager
test: test-go detect-test test-triager ## Run every unit test and the detection fixtures

test-go: ## Go unit tests (normalize, engine, server, fixtures)
	cd pipeline && go vet ./... && go test ./...

detect-test: ## Check every detection rule fires on its bad samples and stays quiet on good ones
	cd pipeline && go run ./cmd/detect test

test-triager: triager/node_modules ## TypeScript typecheck and unit tests
	cd triager && npm run -s typecheck && npm test --silent

triager/node_modules: triager/package-lock.json
	cd triager && npm ci --silent
	@touch $@

## ---- Live pipeline demo (Docker) ----
.PHONY: up attack e2e logs alerts down
up: ## Start the Pub/Sub emulator and the pipeline, and wire the push subscription
	@mkdir -p .data
	docker compose up -d --build --wait
	go run ./simulator setup

attack: ## Replay an attack plus benign noise through the pipeline and verify the alerts
	go run ./simulator attack

e2e: up attack ## Full end-to-end check (up + attack), exits non-zero on any miss or false positive

logs: ## Follow the pipeline logs (alerts are printed as ALERT lines)
	docker compose logs -f pipeline

alerts: ## Pretty-print the alerts the pipeline has written
	@test -s .data/alerts.jsonl || { echo "no alerts yet: run make up && make attack"; exit 0; }
	@jq -r '"[\(.severity|ascii_upcase)] \(.rule_id)  actor=\(.actor)  resource=\(.resource)"' .data/alerts.jsonl 2>/dev/null \
		|| cat .data/alerts.jsonl

down: ## Stop the stack and delete local data
	docker compose down -v
	rm -rf .data

## ---- Vulnerability triager ----
.PHONY: triage-demo triage-check triage
triage-demo: triager/node_modules ## Triage recorded GitHub alerts and show the plan (no token needed)
	cd triager && npm run -s build && node dist/cli.js run $(TRIAGE_FIXTURES)

triage-check: triager/node_modules ## The CI gate on the demo data; fails because two P1s are overdue
	cd triager && npm run -s build && node dist/cli.js check $(TRIAGE_FIXTURES)

triage: triager/node_modules ## Live run: make triage REPO=owner/name [DRY_RUN=1]  (needs GITHUB_TOKEN)
	@test -n "$(REPO)" || { echo "usage: make triage REPO=owner/name [DRY_RUN=1]"; exit 2; }
	cd triager && npm run -s build && node dist/cli.js run --repo $(REPO) $(if $(DRY_RUN),--dry-run)

## ---- Infrastructure ----
.PHONY: tf-check
tf-check: ## terraform fmt + validate, tflint, Checkov (linters run in Docker)
	terraform -chdir=$(TF_DIR) fmt -recursive -check
	terraform -chdir=$(TF_DIR)/envs/dev init -backend=false -input=false >/dev/null
	terraform -chdir=$(TF_DIR)/envs/dev validate
	$(DOCKER_TF) ghcr.io/terraform-linters/tflint:latest --recursive
	$(DOCKER_TF) bridgecrew/checkov:3 -d . --framework terraform --quiet --compact

## ---- Console (web UI) ----
.PHONY: console console-gcp
console: console/node_modules triager/node_modules ## Web UI on http://localhost:5173 for the local stack (.data/)
	cd console && npm run dev

console-gcp: console/node_modules triager/node_modules ## Web UI on live GCP data (uses your gcloud login and terraform outputs)
	cd console && FALCON_SOURCE=gcp npm run dev

console/node_modules: console/package-lock.json
	cd console && npm ci --silent
	@touch $@

## ---- Docs ----
.PHONY: diagrams
diagrams: ## Regenerate the animated README diagrams in docs/assets
	python3 docs/assets/make_diagrams.py docs/assets

## ---- Everything ----
.PHONY: all
all: test tf-check e2e ## What CI runs
