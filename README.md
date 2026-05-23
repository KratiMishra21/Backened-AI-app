# Config-Driven App Runtime

A backend runtime that converts JSON configuration into working applications with dynamic database tables, auto-generated CRUD APIs, and robust validation. Built as a mini low-code engine — submit a config, get a fully operational data backend.

---

## Architecture Overview

The system has two layers: a **static layer** (managed by Prisma) that tracks users, apps, and entity metadata, and a **dynamic layer** (raw SQL via pg) where actual user-data tables are created at runtime.

### The 5-Stage Config Processing Pipeline

When you POST a config to `/api/apps`, it passes through five sequential stages before anything is written to the database:

**Stage 1 — Parse & Sanitize**: Validates the root shape (must be an object, not an array), extracts `appName` (defaults to "Untitled App" if missing), enforces entity array existence. Config is capped at 20 entities maximum.

**Stage 2 — Field Normalization**: Per entity, per field — strips reserved names (`id`, `created_at`, `updated_at`), validates field name format, deduplicates fields, coerces unknown types to `string`, validates enum values exist. Caps each entity at 50 fields.

**Stage 3 — Entity Validation**: Validates entity name format (alphanumeric only), deduplicates entity names, drops entities with zero valid fields after normalization.

**Stage 4 — Final Check**: If no valid entities remain after all normalization, the config is marked FAILED and no tables are created.

**Stage 5 — Status Determination**: `ACTIVE` if no warnings were generated. `DEGRADED` if any warnings were generated but the config is still usable. `FAILED` apps are still saved to the database so users can inspect what went wrong.

### App Statuses

- `ACTIVE` — Config processed cleanly, all tables created
- `DEGRADED` — Config had issues that were auto-corrected (see `warnings` array in response)
- `FAILED` — Config was too broken to process, no tables created

---

## Environment Variables

Create a `.env` file in the project root:

```
DATABASE_URL=postgresql://user:password@host:5432/dbname
JWT_SECRET=your-long-random-secret-here
PORT=3000
```

---

## Local Setup

```bash
# 1. Install dependencies
npm install

# 2. Set up .env (copy from example)
cp .env.example .env
# Fill in DATABASE_URL and JWT_SECRET

# 3. Run database migrations
npx prisma migrate dev

# 4. Seed test users
npm run seed

# 5. Start development server
npm run dev
```

The API will be available at `http://localhost:3000/api`

Test users created by seed:
- `user1@test.com` / `testpassword123`
- `user2@test.com` / `testpassword123`

---

## Deployment (Railway)

1. Push code to GitHub
2. Create a new Railway project, connect your repo
3. Add a PostgreSQL plugin to the project
4. Set environment variables: `JWT_SECRET`, `PORT=3000` (DATABASE_URL is auto-injected by Railway)
5. Railway will build via Dockerfile and run `npx prisma migrate deploy && node dist/main.js`

---

## API Reference

All endpoints return this envelope:

```json
{
  "success": true,
  "data": {},
  "error": null,
  "warnings": [],
  "meta": {}
}
```

---

### Auth

#### POST /api/auth/register

```json
// Request
{ "email": "user@example.com", "password": "password123" }

// Response 201
{
  "success": true,
  "data": {
    "user": { "id": "uuid", "email": "user@example.com" },
    "token": "eyJ..."
  },
  "error": null, "warnings": [], "meta": {}
}

// Response 409 — email already registered
{ "success": false, "data": null, "error": "Email already registered", ... }
```

#### POST /api/auth/login

```json
// Request
{ "email": "user@example.com", "password": "password123" }

// Response 200
{
  "success": true,
  "data": {
    "user": { "id": "uuid", "email": "user@example.com" },
    "token": "eyJ..."
  },
  ...
}

// Response 401 — wrong credentials
{ "success": false, "data": null, "error": "Invalid credentials", ... }
```

#### GET /api/auth/me
*Requires Authorization: Bearer {token}*

```json
// Response 200
{
  "success": true,
  "data": { "user": { "id": "uuid", "email": "user@example.com" } },
  ...
}
```

---

### Apps

All app endpoints require `Authorization: Bearer {token}`.

#### POST /api/apps — Submit a config

```json
// Request
{
  "config": {
    "appName": "Task Manager",
    "entities": [
      {
        "name": "Task",
        "fields": [
          { "name": "title", "type": "string", "required": true },
          { "name": "priority", "type": "enum", "values": ["low", "medium", "high"] }
        ]
      }
    ]
  }
}

// Response 201 — ACTIVE
{
  "success": true,
  "data": {
    "app": { "id": "uuid", "name": "Task Manager", "slug": "task-manager-a3f2b1", "status": "ACTIVE", "warnings": [] },
    "entities": [{ "name": "Task", "tableName": "dyn_abc12345_task", "fields": [...] }]
  },
  "warnings": [],
  "meta": { "appId": "uuid", "entityCount": 1 }
}

// Response 201 — DEGRADED (config had auto-corrected issues)
{
  "success": true,
  "data": { "app": { ..., "status": "DEGRADED" }, ... },
  "warnings": ["Field 'id' in entity 'Task' is reserved and was removed"],
  ...
}

// Response 422 — FAILED (config too broken)
{
  "success": false,
  "data": null,
  "error": "Config validation failed",
  "meta": { "errors": ["Config must contain an entities array"], "warnings": [] }
}
```

#### GET /api/apps — List your apps

```json
// Response 200
{
  "success": true,
  "data": {
    "apps": [
      { "id": "uuid", "name": "Task Manager", "slug": "task-manager-a3f2b1", "status": "ACTIVE", "entityCount": 2, "createdAt": "..." }
    ]
  }
}
```

#### GET /api/apps/:slug — Get app detail

```json
// Response 200
{
  "success": true,
  "data": {
    "app": { "id": "uuid", "name": "Task Manager", "slug": "...", "status": "ACTIVE", "warnings": [], "createdAt": "..." },
    "entities": [{ "id": "uuid", "name": "Task", "tableName": "dyn_..._task", "fields": [...] }]
  }
}

// Response 404
{ "success": false, "data": null, "error": "App with slug \"...\" not found", ... }
```

#### DELETE /api/apps/:slug — Delete app and all its tables

```json
// Response 200
{ "success": true, "data": { "message": "App \"Task Manager\" deleted successfully" }, ... }
```

---

### Dynamic CRUD

All CRUD endpoints require `Authorization: Bearer {token}`. The `:slug` and `:entity` params come from your app config.

#### GET /api/apps/:slug/:entity — List records

Query params: `page` (default 1), `limit` (default 20, max 100), `sortBy` (default `created_at`), `sortOrder` (`asc`/`desc`, default `desc`)

```json
// Response 200
{
  "success": true,
  "data": [{ "id": "uuid", "title": "Buy milk", "created_at": "...", "updated_at": "..." }],
  "meta": { "total": 42, "page": 1, "limit": 20, "totalPages": 3 }
}
```

#### POST /api/apps/:slug/:entity — Create a record

```json
// Request
{ "title": "Buy milk", "priority": "high" }

// Response 201
{ "success": true, "data": { "id": "uuid", "title": "Buy milk", "priority": "high", "created_at": "...", "updated_at": "..." }, ... }

// Response 400 — validation failure
{
  "success": false,
  "data": null,
  "error": "Validation failed",
  "meta": { "errors": [{ "field": "title", "message": "Required" }] }
}
```

#### GET /api/apps/:slug/:entity/:id — Get one record

```json
// Response 200
{ "success": true, "data": { "id": "uuid", ... }, ... }

// Response 400 — invalid UUID format
{ "success": false, "data": null, "error": "Invalid ID format", ... }

// Response 404
{ "success": false, "data": null, "error": "Record not found", ... }
```

#### PUT /api/apps/:slug/:entity/:id — Update a record (partial)

```json
// Request — only send fields you want to change
{ "priority": "low" }

// Response 200
{ "success": true, "data": { "id": "uuid", ..., "priority": "low", "updated_at": "..." }, ... }
```

#### DELETE /api/apps/:slug/:entity/:id — Delete a record

```json
// Response 200
{ "success": true, "data": null, ... }
```

---

### Health

#### GET /api/health — No auth required

```json
// Response 200
{
  "success": true,
  "data": { "status": "ok", "timestamp": "2024-01-01T00:00:00.000Z", "database": "connected" },
  ...
}
```

---

## Test Config Scenarios

The `test-configs/` folder contains 5 configs to demonstrate the pipeline:

| File | Expected Status | What it tests |
|------|----------------|---------------|
| `valid-taskmanager.json` | ACTIVE | Clean config, 2 entities, enum field |
| `degraded-missing-fields.json` | DEGRADED | Missing appName, unknown type, duplicate field, reserved field — all auto-corrected |
| `broken-no-entities.json` | FAILED | Empty entities array |
| `broken-wrong-shape.json` | FAILED | Array at root instead of object |
| `partial-recovery.json` | DEGRADED | Mix of valid and invalid entities — valid ones survive |

To test: login, copy the token, then POST to `/api/apps` with `{ "config": <paste file contents> }`.
