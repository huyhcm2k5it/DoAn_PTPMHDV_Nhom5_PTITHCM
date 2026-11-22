FROM golang:1.27.0-alpine AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN --mount=type=cache,target=/root/.cache/go-build CGO_ENABLED=0 GOMAXPROCS=2 go build -p=2 -trimpath -o /out/ ./cmd/api ./cmd/worker ./cmd/migrate ./cmd/import-projections ./cmd/import-catalog
FROM alpine:3.23
RUN adduser -D -u 10001 app
COPY --from=build /out/ /
USER app
EXPOSE 8009
ENTRYPOINT ["/api"]
