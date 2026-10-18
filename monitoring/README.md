# Production monitoring

Prometheus scrapes the backend and host every 15 seconds, Grafana shows the results, and Alertmanager sends alerts.

## Running it

```sh
cp .env.example .env          # set the passwords, and COMPOSE_FILE for your machine
docker compose up -d --build
```

`COMPOSE_FILE` in `.env` decides which compose files are combined; see the main [README](../README.md#2-configure).

| Service      | URL                    | Notes                                         |
| ------------ | ---------------------- | --------------------------------------------- |
| Grafana      | http://localhost:3002  | Opens on the "Photo Repo – Production" dashboard |
| Prometheus   | http://localhost:9090  | Localhost only; on EC2 use `ssh -L 9090:localhost:9090` |
| Alertmanager | http://localhost:9093  | Localhost only; firing alerts are listed here |
| Backend      | http://localhost:3001/metrics | Raw metrics in Prometheus format       |

Prometheus and Alertmanager only read their config at startup. After editing rules or `alertmanager.yml` on a running stack, reload them with `curl -X POST http://localhost:9090/-/reload` and `curl -X POST http://localhost:9093/-/reload`.

On Docker Desktop (Windows/macOS), `node-exporter` needs the `compose.desktop.yaml` override, because Docker Desktop rejects the `rslave` mount option used on Linux. With it, node-exporter reports Docker Desktop's Linux VM rather than the Windows/macOS host. On EC2 it reports the server itself.

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
| Alert sent within 30 seconds | `ServiceDown` has no pending period. Its rule group is evaluated every 5s and `group_wait` is 5s, so the worst case is 15s scrape + 5s timeout + 5s evaluation + 5s grouping = 30s. Measured delivery to the webhook was 17.9s; see [Sending alerts](#sending-alerts-to-the-team) |
| HTTP 500s above 1% of traffic over a rolling 5 minutes | `HighHttpErrorRate` rule |
| Storage depleting in 5% steps | `DiskSpaceLow` fires a new alert at 20%, 15%, 10% and 5% free; it becomes critical at 10% or less |
| Database outage | `DatabaseDown` fires when the backend can't reach PostgreSQL (`database_up` metric), even while the backend itself is up |
| More than 99% of alerts actionable | Seven rules in total. Resource alerts need 5 minutes of sustained breach. Error/latency alerts are suppressed while the backend is down, and the error-rate alert is suppressed while the database is down |

The alert rules are unit tested in `prometheus/alerts.test.yml`. The `Monitoring CI` workflow runs those tests and validates every config file.

## Sending alerts to the team

Alerts go to a Discord channel, firing and resolved, as messages like "🔴 ServiceDown" and "✅ Resolved: ServiceDown". Each machine running the stack needs the webhook URL once:

1. **Create the webhook** in Discord: open the channel's settings, choose **Integrations → Webhooks → New Webhook**, then **Copy Webhook URL**. You need the Manage Webhooks permission on the server.
2. **Save the URL** as the only content of `secrets/discord_webhook_url` at the repo root:
   ```powershell
   Set-Content -NoNewline secrets\discord_webhook_url 'https://discord.com/api/webhooks/…'   # Windows
   ```
   ```sh
   printf '%s' 'https://discord.com/api/webhooks/…' > secrets/discord_webhook_url             # Linux / EC2
   ```
   The `/secrets` folder is gitignored, so the URL is never committed. Anyone who has the URL can post to the channel.
3. **Send a test alert** to check it works. Alertmanager reads the file each time it sends, so no restart is needed:
   ```sh
   docker compose exec alertmanager sh -c "amtool alert add PhotoRepoTestAlert severity=info --annotation='summary=\"Test alert from Photo Repo\"' --annotation='description=\"If you can read this, Discord alerts are working.\"' --alertmanager.url=http://localhost:9093"
   ```
   The message should arrive within about 10 seconds.

Until the file exists, alerts still fire and show in Alertmanager and on the dashboards; Alertmanager just logs that it couldn't send them.

**Measured:** with the backend stopped, the `ServiceDown` message reached a webhook 17.9 s later, within the 30 s target. The "Resolved" message followed once the backend restarted. The test used a stand-in webhook server on the Docker network in place of Discord.
