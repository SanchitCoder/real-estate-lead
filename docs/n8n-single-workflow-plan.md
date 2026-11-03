# Step 2: single-workflow plan (for review, NOT yet saved to n8n)

Nothing in n8n has been changed. This is what I found and what I propose to save, so you can approve it first.

## 1. What is on the instance today

| Item | State |
|---|---|
| `Real Estate Lead Command Center` (id `grnMWb9jCffGgRW6`) | Exists, **inactive**, 253 nodes: lanes Global, Intake, Score, Agent, Watchdog, Matcher, Reports, Cost. **No Dashboard API lanes, no Test Harness.** |
| WF0–WF7 | Already **archived and inactive**, no tag. |
| Credentials on the instance | Only one Google Sheets credential. **No Postgres, WhatsApp, Gmail, Facebook, Calendar, OpenAI or Header Auth credential.** The saved workflow has no credential mapped on any node. |
| Result | **Nothing is live right now**: no trigger of the lead automation is active anywhere. |

So Step 2 is a delta on the existing consolidated workflow, not a new build. I will back it up with a workflow version before editing.

## 2. Differences between the brief and the real backend

See the header of `contracts/realestate-api.ts` (13 items). The ones that change behaviour:
1. "Site visit" = lead reached `visited`. `cost_per_site_visit` = cost / visits done. Cost per visit booked is exposed as an extra field.
2. Consider-cut = paid source AND (no visits OR > 2x best PAID source). Free sources are never flagged or used as the benchmark.
3. 8 sources, backend event names, no `is_test`, config in a table, bigint as strings.
4. Existing public webhooks answer immediately and return no lead id.

## 3. Existing lanes: full node chains (as deployed)

**Global (error)**: Error Trigger → Load Config → Log Error → Prepare Alert → [Alert Admin WhatsApp, Alert Admin Email]

**Intake**: Meta Lead Ads | 99acres Gmail | MagicBricks Gmail | Referral Form | Website Webhook
- portal emails: Prepare Portal Email → Extract Lead From Email (OpenAI) → Extraction Usable? → (no) Regex Fallback → Map Portal Lead
- Meta / Form / Webhook: Map Meta Lead / Map Form Lead / Map Webhook Lead
- all → **Parse Budget → Normalise Fields → Upsert Lead → New Lead?**
  - new → Has Contact Details? → (yes) `Score | Lead To Process`, (no) Junk Captured
  - repeat → Repeat Logged and Agent Assigned? → Load Config → Get Repeat Context → Repeat Alert: Claim → Not Sent Yet? → Send → Mark Sent / Mark Failed

**Score & Assignment**: Lead To Process → Load Config → Get Lead → Needs Scoring? → Score Lead (AI Agent + OpenAI + Structured Parser; AI Unavailable Fallback) → Compute Score → Save Score → **Assign Agent → Agent Assigned?**
- yes → Fetch Lead For Messages → Build Message Fields → [Lead Has Phone? → Lead Welcome: Claim → Not Sent Yet? → Send → Mark Sent/Failed → Log Auto Response Sent] and [Agent Alert: Claim → Not Sent Yet? → Send → Mark Sent/Failed → Log Agent Alerted]
- no → No Agent Available? → Unassigned Alert: Claim → Not Sent Yet? → Send → Mark Sent/Failed

**Agent Actions**: WhatsApp Trigger | Agent Action Webhook → Normalise Inbound → Is Message? → Load Config → Find Sender → Sender Type
- agent → Parse Command → Route Command → Set Touch / Stage / Visit Fields | Reply Help | Reply Unknown → **Valid Format?** → Apply Command → Command Accepted? → Already Processed? → Visit Booking? → (booking) Rescheduled Visit? → Delete Old Calendar Event → Get Visit Details → Create Calendar Event → Save Calendar Event Id → Visit Messages → [buyer confirmation | Calculate Reminder Time → Reminder Still In Future? → Wait → Recheck Visit → agent + buyer reminders → Log Reminder Sent] ; all replies → **Prepare Agent Reply** → Agent Reply: Claim → Send
- lead → Attach Lead Reply → Classify Reply → Record Listing Response → Agent Lookup → Reply Context → [Notify Agent Of Reply | Acknowledge Lead]
- unknown → Ignore

**Speed-to-Lead Watchdog**: Every 15 Minutes → Load Config → [Find Overdue First Responses → Flag Overdue Lead → Route By Tier → nudge | owner escalation | Reassign Lead → Reassigned? → Get Lead Details → Build Reassign Fields → New Agent Alert + Old Agent Notice (blocked: Reassign Blocked Alert)] [Find Unassigned Leads → `Score | Lead To Process`] [Find Inactive Leads → Flag Inactive Lead → Follow-up Nudge]

**Inventory Matcher**: Every 10 Minutes | Listing Changed Webhook → Load Config → Get Pending Listings → Any Pending? → Loop Over Listings → Match Buyers To Listing → (done) Get Unsent Matches → Build Match Fields → Buyer Listing Message: Claim → Send → Mark Match Messaged → Hot Match With Agent? → Agent Hot Match Alert

**Metrics & Digests**: Nightly 23:30 → Refresh Metrics ; Hourly → Load Config → Digest Hour Reached? → Check Reports Sent → [Daily Digest Due? → 4 queries → Combine → Build Digest → WhatsApp + Email (claim/release)] [Monthly Report Due? → Monthly Source ROI → Build Monthly Report → WhatsApp + Email]

**Cost Entry**: Cost Entry Form → Normalise Entry → Valid Entry? → Upsert Source Cost → Load Config → Confirm To Owner (invalid → Reject Invalid Entry)

## 4. Proposed new lanes

All new webhooks: Header Auth credential, `responseMode: responseNode`, `allowedOrigins` = dashboard origin, paths `re/...`, Postgres nodes use parameter placeholders only, `onError: continueErrorOutput` with the error output wired to **Global | Shape Node Error** (one shared branch into the existing Log Error → alert). Every response uses `{status, data, meta}`; errors use `{status:"error", message, code?, field?}`.

### Dashboard API – Reads (14 chains, identical shape)
`Dash | GET /re/<name>` (Webhook) → `Dash | <name>: Query` (Postgres: `SELECT re_<name>($1::jsonb)`, `$1` = JSON of query string + `X-RE-Actor-*` headers) → `Dash | <name>: Respond` (Respond to Webhook, envelope). Error output → `Respond 500` + shared error branch.

Endpoints: overview, leads, lead, speed, stale, funnel, source-roi, agents/leaderboard, agents, listings, listing, costs, config, errors. SQL functions `re_*` live in `backend/sql/06_dashboard_reads.sql`, which I will write and run in PGlite against the same dataset as the mock before saving (not written yet).

### Dashboard API – Actions
- **POST /re/lead** → `Dash | Map Dashboard Lead` (Set, same fields as the other map nodes, `is_test` carried) → joins **Intake | Parse Budget** (shared chain) → … → respond after `Score | Assign Agent`.
- **POST /re/lead/stage** and **/re/lead/note** → `Dash | Resolve Lead + Actor` (Postgres, ownership check) → `Dash | Build Command` (Set: synthesises the exact text `NEGO 123`, `VISIT 123 2026-11-12 11:00 note`, `NOTE 123 text` and the acting agent's phone) → joins **Agent | Is Message?** (shared stage chain incl. calendar + reminder) → respond after **Agent | Prepare Agent Reply** with the backend's message.
- **POST /re/lead/reassign** → `Dash | Reassign (Postgres)` → joins **Watchdog | Build Reassign Fields** (shared New Agent Alert / Old Agent Notice) → respond.
- **POST /re/agent** → Postgres function (create/update/deactivate/activate) → respond.
- **POST /re/listing** → Postgres upsert (trigger sets `match_pending`) → joins **Matcher | Load Config** (shared matcher) → `Dash | Count Matches` → respond with `new_matches`.
- **POST /re/cost** → joins **Cost | Normalise Entry → Valid Entry? → Upsert Source Cost** → respond.

### Test Harness
`Test | POST /re/test` → `Test | Scenario` (Switch) → each scenario feeds the REAL chain with `is_test = true`:
portal_email_lead → Intake | Prepare Portal Email; meta_lead → Intake | Map Meta Lead; referral_form → Intake | Map Form Lead; duplicate_lead → Map Webhook Lead twice; stale_lead_escalation → insert aged test lead then Watchdog | Load Config; visit_booking → Agent | Is Message?; listing_match → Matcher | Load Config; cost_entry → Cost | Normalise Entry; cleanup → `DELETE … WHERE is_test`.
Safety: `claim_outbound()` (in `05_dashboard.sql`, verified) returns false for test leads, so no WhatsApp is ever sent for them.

### Edits to existing nodes (small, listed so nothing is a surprise)
1. `Intake | Upsert Lead`: add `is_test: $json.is_test` to the JSON.
2. `Matcher | Match Buyers To Listing`: add `AND l.is_test = li.is_test`.
3. Error handling: set `onError: continueErrorOutput` on every Postgres / Gmail / Calendar / OpenAI node and wire each error output to `Global | Shape Node Error` (scripted, deterministic).
4. Respond-to-Webhook branches after the shared sinks, gated by a `via_dashboard` flag so portal/Meta/WhatsApp runs are unaffected.
5. Existing webhook paths unchanged: `lead-intake`, `agent-action`, `listing-changed`, `referral-walkin-lead`, `source-cost-entry`.

## 5. Migration steps (each needs your go-ahead)
1. Run `backend/sql/05_dashboard.sql` (verified on 01–04 in PGlite, idempotent).
2. Create credentials: Postgres, WhatsApp (send + trigger), Facebook Lead Ads, Gmail, Google Calendar, OpenAI, Header Auth, Basic Auth. Map them on the nodes.
3. Save the extended workflow **inactive**, re-fetch and verify every node, connection and credential.
4. Run `/re/test` scenarios on the n8n test webhook URLs and compare with what WF0–WF7 would produce.
5. You confirm, then: tag WF0–WF7 "archived – replaced by single workflow" (already inactive), activate the new workflow, confirm every trigger is live, set the workflow as its own Error workflow.
