FROM envoyproxy/envoy:v1.31-latest

RUN apt-get update && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*

COPY envoy.yaml /etc/envoy/envoy.yaml

EXPOSE 8080 9901

HEALTHCHECK --interval=5s --timeout=3s --start-period=10s --retries=12 CMD curl -fsS --max-time 2 http://127.0.0.1:9901/ready || exit 1

CMD ["/usr/local/bin/envoy", "-c", "/etc/envoy/envoy.yaml", "--service-cluster", "umc-gateway"]
