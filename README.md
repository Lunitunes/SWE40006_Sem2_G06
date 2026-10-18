# Photo Repo: SWE40006 Group 06

A web-based photo upload app, built to demonstrate a DevOps pipeline: GitHub, GitHub Actions CI, Docker, and Prometheus/Grafana monitoring.

Users open the site by link or QR code, choose or take a photo, add a description and upload it. The photos are stored in PostgreSQL and shown in a gallery.

![System diagram](docs/System-Diagram.drawio.png)

| Part | Technology |
| ---- | ---------- |
| Frontend | Next.js 16 (React 19) |
| Backend API | NestJS 12 |
| Database | PostgreSQL 17 |
| Monitoring | Prometheus, Alertmanager, Grafana, node-exporter |
| CI | GitHub Actions |
| Deployment | Docker Compose on AWS EC2 |

## Quick start

### 1. Prerequisites

- [Docker Desktop](https://www.docker.com/products/docker-desktop/), installed and running
- Node.js 24 and pnpm 11, only needed to run the tests outside Docker (`npm install -g pnpm@11.21.0`)

### 2. Configure

```sh
cp .env.example .env
```

Edit `.env` and set `GRAFANA_ADMIN_PASSWORD` and `DB_PASSWORD`. Any values work locally. `.env` is gitignored, so never commit it.

### 3. Run

**Windows / macOS:**

```sh
docker compose -f compose.yaml -f compose.monitoring.yaml up -d --build backend frontend postgres prometheus alertmanager grafana
```

**Linux (EC2):** the same command without the service list, which also starts `node-exporter` for host metrics:

```sh
docker compose -f compose.yaml -f compose.monitoring.yaml up -d --build
```

`node-exporter` only runs on Linux, so on Windows and macOS it's left out. The rest of the stack works without it.

To run only the app without monitoring, use `docker compose up -d --build`.

### 4. Open

| What | URL |
| ---- | --- |
| Upload page and gallery | <http://localhost:3000/upload> |
| Metrics dashboard | <http://localhost:3000/admin/metrics> |
| Grafana | <http://localhost:3002>, logging in with the Grafana user and password from `.env` |
| Prometheus | <http://localhost:9090>, no login |
| Alertmanager | <http://localhost:9093>, no login |
| Backend readiness | <http://localhost:3001/health/ready> |

Prometheus and Alertmanager have no authentication, so they only accept connections from the machine they run on. On EC2, reach them through an SSH tunnel: `ssh -L 9090:localhost:9090 -L 9093:localhost:9093 <server>`. Grafana is the only tool with a login. These ops tools are deliberately left out of the app's navbar, which guests see.

### Stopping

```sh
docker compose -f compose.yaml -f compose.monitoring.yaml down      # keeps photos and metrics
docker compose -f compose.yaml -f compose.monitoring.yaml down -v   # also deletes all data
```

After pulling changes, rerun the start command; `--build` rebuilds what changed.

## How it fits together

```text
Browser ──► frontend :3000 ──/api/backend/*──► backend :3001 ──► postgres :5432
                │                                  ▲
                └──/api/metrics──► prometheus ─────┘ scrapes /metrics every 15s
                                       │
                                       └──► alertmanager ──► (notification channel)
                                       └──► grafana :3002
```

- **The browser only talks to the frontend.** Upload requests go to `/api/backend/upload…` on the frontend, which forwards them to the backend. That's why the app works from a phone opening the QR link, and on EC2, without a hard-coded backend address. The backend address comes from the `BACKEND_URL` setting.
- **Photos are stored in PostgreSQL** in the `user_photos` table. The backend creates the table when it starts, and the data lives in the `postgres-data` volume, so it survives redeploys.
- **Uploads are validated.** Files must be JPEG, PNG, GIF, WebP or HEIC, checked from the file contents rather than the name, and 10 MB or smaller. A description is required, up to 500 characters.
- **The backend reports its own health.** `GET /health` says whether the backend is up. `GET /health/ready` also checks the database and returns 503 if it's unreachable.

### Backend API

| Method | Path | Purpose |
| ------ | ---- | ------- |
| `POST` | `/upload` | Upload a photo (multipart form: `photo` file and `description`) |
| `GET` | `/upload/all` | List photos: id, description, file name, upload time |
| `GET` | `/upload/image/:id` | The image itself, served with its real content type |
| `GET` | `/health` | Whether the backend is up |
| `GET` | `/health/ready` | Whether the backend can reach the database (503 if not) |
| `GET` | `/metrics` | Prometheus metrics |

## Project structure

```text
backend/                NestJS API
  src/                  controllers, services, metrics module
  test/                 end-to-end tests
frontend/               Next.js app
  app/upload/           upload form and gallery
  app/admin/metrics/    metrics dashboard
  app/api/backend/      proxy from the browser to the backend
  app/api/metrics/      dashboard data, read from Prometheus
monitoring/             Prometheus, Alertmanager and Grafana config (see monitoring/README.md)
compose.yaml            app stack: frontend, backend, postgres
compose.monitoring.yaml monitoring stack, layered on top of compose.yaml
.github/workflows/      CI pipelines
docs/                   diagrams
```

## Testing

```sh
cd backend
pnpm install
pnpm test            # unit tests
pnpm run test:e2e    # end-to-end tests
pnpm run build
```

The database tests in the E2E suite only run when the `DB_*` variables point at a PostgreSQL database; otherwise they are skipped. To run them locally against a temporary database:

```sh
docker run -d --rm --name photorepo-test-db -p 127.0.0.1:55432:5432 \
  -e POSTGRES_DB=photorepo_test -e POSTGRES_USER=photorepo -e POSTGRES_PASSWORD=photorepo \
  postgres:17.6-alpine

DB_HOST=127.0.0.1 DB_PORT=55432 DB_NAME=photorepo_test DB_USER=photorepo DB_PASSWORD=photorepo \
  pnpm run test:e2e

docker stop photorepo-test-db
```

## CI

| Workflow | Runs on | What it does |
| -------- | ------- | ------------ |
| [Backend CI](.github/workflows/backend-ci.yaml) | Every push and pull request | Unit tests, E2E tests against a real PostgreSQL, build |
| [Monitoring CI](.github/workflows/monitoring-ci.yaml) | Changes to monitoring files | Validates the Prometheus, Alertmanager, Grafana and Compose config, and runs the alert-rule unit tests |

## Monitoring

Prometheus collects backend request performance, Node.js process stats, database availability and host CPU, memory, disk and network every 15 seconds.

Seven alert rules cover:

- the backend or database going down
- server errors above 1% of traffic over five minutes
- high latency
- low disk space, alerting at each 5% step
- sustained high CPU and memory

The in-app dashboard at `/admin/metrics` and the Grafana dashboard both show this data.

See [monitoring/README.md](monitoring/README.md) for how each success metric in the project brief is met, and for how to connect alert notifications.

## Troubleshooting

| Problem | Fix |
| ------- | --- |
| `port 3000 is already allocated` | Another app, such as a local `next dev`, is using the port. Stop it and start again. |
| `Set DB_PASSWORD in .env` / `Set GRAFANA_ADMIN_PASSWORD in .env` | `.env` is missing or incomplete; see [Configure](#2-configure). |
| `docker` not recognised | Restart your terminal or VS Code after installing Docker. |
| Grafana login fails | Grafana only reads the password from `.env` the first time it starts; changing `.env` later has no effect. Reset it with `docker compose -f compose.yaml -f compose.monitoring.yaml exec grafana grafana cli admin reset-admin-password <new-password>`. |
| "node is down" alert on Windows or macOS | Expected: `node-exporter` only runs on Linux. |
| Upload fails with "Could not reach the backend" | Check `docker compose ps`. The backend waits for Postgres to be healthy before it starts. |
| Changed alert rules aren't taking effect | Reload Prometheus and Alertmanager; see [monitoring/README.md](monitoring/README.md). |

## Team

Tuesday 10:30am – 12:30pm, Group 06

- Matthew Bailey – 102146171
- Ari Fadida – 103433887
- Josh Bakanursky – 102551610