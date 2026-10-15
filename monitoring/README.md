# Production monitoring

Prometheus scrapes the backend and host every 15 seconds, Grafana shows the results, and Alertmanager sends alerts.

## Running it

```sh
cp .env.example .env          # set GRAFANA_ADMIN_PASSWORD
docker compose -f compose.yaml -f compose.monitoring.yaml up -d --build
```

| Service      | URL                    | Notes                                         |
| ------------ | ---------------------- | --------------------------------------------- |
| Grafana      | http://localhost:3002  | Opens on the "Photo Repo – Production" dashboard |
| Prometheus   | http://localhost:9090  | Localhost only; on EC2 use `ssh -L 9090:localhost:9090` |
| Alertmanager | http://localhost:9093  | Localhost only; firing alerts are listed here |
| Backend      | http://localhost:3001/metrics | Raw metrics in Prometheus format       |

Prometheus and Alertmanager only read their config at startup. After editing rules or `alertmanager.yml` on a running stack, reload them with `curl -X POST http://localhost:9090/-/reload` and `curl -X POST http://localhost:9093/-/reload`.

`node-exporter` needs a Linux host, such as the production EC2 instance. It won't start under Docker Desktop on Windows or macOS, but the rest of the stack still runs.

## What is collected

| Source | Metrics |
| ------ | ------- |
| Backend (`prom-client`) | `http_requests_total` and `http_request_duration_seconds`, labelled by method, route template and status code; Node.js process CPU, memory, heap and event loop lag |
| `node-exporter` | Host CPU, memory, disk space, disk I/O and network traffic |

## How the success metrics are met

| Success metric | Implementation |
| -------------- | -------------- |
| Metrics refresh every 15 seconds | `scrape_interval: 15s` in `prometheus/prometheus.yml`; the dashboard refreshes every `15s` |
| CPU, RAM, disk, network, HTTP performance | Panels on the Grafana dashboard (`grafana/dashboards/production-overview.json`) |
| Alert sent within 30 seconds | `ServiceDown` has no pending period. Its rule group is evaluated every 5s and `group_wait` is 5s, so the worst case is 15s scrape + 5s timeout + 5s evaluation + 5s grouping = 30s |
| HTTP 500s above 1% of traffic over a rolling 5 minutes | `HighHttpErrorRate` rule |
| Storage depleting in 5% steps | `DiskSpaceLow` fires a new alert at 20%, 15%, 10% and 5% free; it becomes critical at 10% or less |
| Database outage | `DatabaseDown` fires when the backend can't reach PostgreSQL (`database_up` metric), even while the backend itself is up |
| More than 99% of alerts actionable | Seven rules in total. Resource alerts need 5 minutes of sustained breach. Error/latency alerts are suppressed while the backend is down, and the error-rate alert is suppressed while the database is down |

The alert rules are unit tested in `prometheus/alerts.test.yml`. The `Monitoring CI` workflow runs those tests and validates every config file.

## Sending alerts to the team

No notification channel is set up yet. To send alerts to a Discord channel:

1. Put the webhook URL in `secrets/discord_webhook_url` at the repo root. The `/secrets` folder is gitignored.
2. Uncomment `discord_configs` in `alertmanager/alertmanager.yml`.
3. Uncomment the `./secrets` volume under `alertmanager` in `compose.monitoring.yaml`.
