# Real Estate Lead Command Center: dashboard

Next.js 15 (App Router) + TypeScript, Tailwind v4, TanStack Query/Table, Recharts, Framer Motion, React Hook Form + Zod, date-fns-tz.

```
npm install
cp .env.example .env.local     # already present for local dev; edit values
npm run dev                    # http://localhost:3000   (mock data by default)
npm test && npm run lint && npm run build
```

Sign in: owner = `OWNER_PASSWORD`; agent = their mobile + `AGENT_LOGIN_SEED` followed by the last 4 digits of that mobile (e.g. `9811100001` / `agent1230001` with the dev `.env.local`).

## How it fits together
- `contracts/realestate-api.ts`: single source of truth. Zod request/response for every endpoint, the allow-list, and the list of differences from the brief.
- Browser → `/api/n8n/[...path]` → (mock handlers | n8n webhook). The proxy checks the allow-list and role, validates request and response with Zod, adds Header Auth server-side. A live reply that breaks the contract shows an error naming the endpoint and field.
- `NEXT_PUBLIC_DATA_MODE=mock|live` (default mock). Switching is only this variable, plus `N8N_*`. A "Sample data" badge shows in mock mode.
- `lib/metrics/`: every derived number, with the backend's formulas (unit-tested). The mock backend (`lib/mock/`) mutates a seeded in-memory store using the same rules as the SQL.
- `backend/sql/05_dashboard.sql`: `is_test`, `consider_cut_multiplier`, test-aware views, test-send suppression. Verified on top of the existing 01–04 with PGlite (`node scripts/sqlcheck.mjs`).
- `docs/n8n-single-workflow-plan.md`: node chains for every lane and the cutover plan (awaiting approval).
- `scripts/e2e.mjs`: Playwright walkthrough of every page (needs `npm run build && npx next start -p 3100`).

## Status
Mock mode: complete and verified. Live mode: not exercised, because the n8n dashboard lanes are not built yet and the instance has no Postgres/WhatsApp credentials. See the plan document.
