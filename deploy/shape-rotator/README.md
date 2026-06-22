# Shape Rotator local instance

Run a second Router instance side-by-side with the existing Lark
deployment, isolated by port and database. Used to validate the
"one codebase, many deployments" pattern before standing the
accelerator up on a real server.

## Ports

| | Web | Server |
|---|---|---|
| Lark dev (existing) | 3000 | 3001 |
| Shape dev | 4000 | 4001 |

## Steps

```bash
# 1. Create database (one-time)
createdb router_shape

# 2. Run migrations against the new database (one-time)
cd server
DATABASE_URL=postgresql://localhost:5432/router_shape npm run migrate

# 3. Copy env template (one-time)
cp ../deploy/shape-rotator/.env.example .env.shape
# edit .env.shape — fill in OPENROUTER_API_KEY

# 4. Run server (Terminal A — keep your existing Lark dev running on :3001)
npm run dev:shape

# 5. Run web (Terminal B — single web instance, points at shape server)
cd ../web
NEXT_PUBLIC_API_URL=http://localhost:4001 PORT=4000 npm run dev

# 6. Open http://localhost:4000 — Shape instance UI (no Lark, English-only)
# 7. Open http://localhost:3000 — existing Lark instance UI (if running)
```

## Verifying isolation

```bash
# Server-info endpoints
curl -s http://localhost:3001/api/server-info | jq
# {"site_name":"Teleport Router","features":{"lark":true,"languages":["en","zh"]}}

curl -s http://localhost:4001/api/server-info | jq
# {"site_name":"Teleport Router","features":{"lark":false,"languages":["en"]}}

# CLI works against either
router --server http://localhost:3001 list
router --server http://localhost:4001 list
```

## Production deployment

Out of scope for this MVP. The artifacts here are local-dev-only.
