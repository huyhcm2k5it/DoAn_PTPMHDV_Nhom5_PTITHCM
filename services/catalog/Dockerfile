FROM golang:1.27.0 AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN --mount=type=cache,target=/root/.cache/go-build CGO_ENABLED=0 GOMAXPROCS=2 go build -p=2 -trimpath -o /out/ ./cmd/api ./cmd/migrate ./cmd/worker ./cmd/snapshot
FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=build /out/ /
ENV LISTEN_ADDR=:8007
EXPOSE 8007
ENTRYPOINT ["/api"]
