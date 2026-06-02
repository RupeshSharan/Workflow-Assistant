# AI Workflow Assistant Platform

A configurable, multi-tenant workflow platform for teams that need work
tracking, knowledge search, collaboration, and controlled AI automation.

The project is starting as a TypeScript modular monolith with a React client,
Express API, PostgreSQL with pgvector, Redis, object storage, and self-hosted
Ollama. See [reference.md](./reference.md) for the full product brief,
architecture contract, roadmap, and agent handoff log.

## Local Services

Copy `.env.example` to `.env` for non-container local development. The target
runtime is Node.js 24 LTS.

```bash
docker compose up --build
```

Expected endpoints after the initial application code is running:

- Web application: `http://localhost:5173`
- API health endpoint: `http://localhost:4000/api/health`
- PostgreSQL with pgvector: `localhost:55432` by default
- MinIO console: `http://localhost:9001`
- Ollama API: `http://localhost:11434` (backend access only in the product)

Development credentials in `compose.yaml` are local-only placeholders and
must be replaced for any deployed environment.

## Validation

The API integration suite requires the PostgreSQL service:

```bash
docker compose up -d postgres
npm run typecheck
npm run test --workspace @workflow/api
npm run build
```

For an existing database volume after new migrations are added, start the API
container and apply pending SQL migrations:

```bash
docker compose up -d api
docker compose exec -T api npm run db:migrate --workspace @workflow/api
```

## Ollama Models

The text knowledge and assistant endpoints expect local Ollama models matching
`.env.example`. Pull them before live AI testing:

```bash
docker compose up -d ollama
docker compose exec ollama ollama pull nomic-embed-text
docker compose exec ollama ollama pull llama3.1:8b
```

`nomic-embed-text` must return 768-dimensional embeddings for the current
database migration.
