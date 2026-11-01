# Build context is the repo root, so the detection rules are baked into the image.
FROM golang:1.25-alpine AS build
WORKDIR /src/pipeline
ENV CGO_ENABLED=0 GOWORK=off
COPY pipeline/go.mod pipeline/go.sum ./
RUN go mod download
COPY pipeline/ ./
# Run the detection tests during the build: an image with broken rules never ships.
COPY detections/ /src/detections/
RUN go test ./... && go build -trimpath -ldflags="-s -w" -o /out/pipeline ./cmd/pipeline

FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=build /out/pipeline /pipeline
COPY detections/rules /rules
ENV RULES_DIR=/rules PORT=8080
EXPOSE 8080
USER nonroot:nonroot
ENTRYPOINT ["/pipeline"]
