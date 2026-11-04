FROM golang:1.27.0 AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -trimpath -o /out/api ./cmd/api && \
    CGO_ENABLED=0 go build -trimpath -o /out/worker ./cmd/worker && \
    CGO_ENABLED=0 go build -trimpath -o /out/migrate ./cmd/migrate && \
    CGO_ENABLED=0 go build -trimpath -o /out/import-tickets ./cmd/import-tickets && \
    CGO_ENABLED=0 go build -trimpath -o /out/import-catalog ./cmd/import-catalog
FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=build /out/api /api
COPY --from=build /out/worker /worker
COPY --from=build /out/migrate /migrate
COPY --from=build /out/import-tickets /import-tickets
COPY --from=build /out/import-catalog /import-catalog
ENV LISTEN_ADDR=:8082
EXPOSE 8082
ENTRYPOINT ["/api"]
