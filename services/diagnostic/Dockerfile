FROM golang:1.27.0-alpine AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -o /api ./cmd/api && CGO_ENABLED=0 go build -o /worker ./cmd/worker && CGO_ENABLED=0 go build -o /migrate ./cmd/migrate && CGO_ENABLED=0 go build -o /import-projections ./cmd/import-projections
FROM alpine:3.23
RUN adduser -D -u 10001 app
COPY --from=build /api /worker /migrate /import-projections /
USER app
ENTRYPOINT ["/api"]
