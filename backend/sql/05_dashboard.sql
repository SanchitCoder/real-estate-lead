-- Real Estate Lead Command Center: dashboard migration (additive, safe to re-run)
-- Run AFTER 01-04. Adds what the dashboard needs and nothing else:
--   1. is_test on leads, listings, source_costs, workflow_errors  (test harness rows; lead_events and
--      listing_matches inherit through their lead / listing)
--   2. config.consider_cut_multiplier  (was hard-coded as 2 in monthly_roi_report)
--   3. every metric view and report function ignores test rows, so a test run can never change a number
--   4. upsert_lead() accepts "is_test" in its input
-- Matcher note: in the workflow node "Matcher | Match Buyers To Listing" add
--   AND l.is_test = li.is_test      to the JOIN leads l ON ... condition, so test listings only match test buyers.

ALTER TABLE leads           ADD COLUMN IF NOT EXISTS is_test boolean NOT NULL DEFAULT false;
ALTER TABLE listings        ADD COLUMN IF NOT EXISTS is_test boolean NOT NULL DEFAULT false;
ALTER TABLE source_costs    ADD COLUMN IF NOT EXISTS is_test boolean NOT NULL DEFAULT false;
ALTER TABLE workflow_errors ADD COLUMN IF NOT EXISTS is_test boolean NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS ix_leads_is_test        ON leads (is_test) WHERE is_test;
CREATE INDEX IF NOT EXISTS ix_listings_is_test     ON listings (is_test) WHERE is_test;
CREATE INDEX IF NOT EXISTS ix_source_costs_is_test ON source_costs (is_test) WHERE is_test;
-- NOTE: the unique (source, month) constraint is kept, because "Cost | Upsert Source Cost" uses ON CONFLICT (source, month).
-- The test harness therefore writes its cost rows under source 'other', which real usage does not touch.

INSERT INTO config (key, value, description) VALUES
  ('consider_cut_multiplier', '2', 'A paid source is flagged "consider cutting" when its cost per site visit is more than this many times the best paid source')
ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION upsert_lead(p jsonb)
RETURNS TABLE (out_lead_id bigint, out_is_new boolean, out_repeat_logged boolean,
               out_stage lead_stage, out_assigned_agent_id bigint, out_priority int)
LANGUAGE plpgsql AS $$
DECLARE
  v_phone   text := normalize_phone(p->>'phone');
  v_email   text := NULLIF(lower(btrim(p->>'email')), '');
  v_source  text := COALESCE(NULLIF(p->>'source', ''), 'other');
  v_ref     text := COALESCE(NULLIF(p->>'source_ref', ''), md5(p::text));
  v_key     text;
  v_bmin    numeric := to_num_safe(p->>'budget_min');
  v_bmax    numeric := to_num_safe(p->>'budget_max');
  v_timeline text := COALESCE(NULLIF(p->>'timeline', ''), 'unknown');
  v_ptype   text := NULLIF(lower(btrim(COALESCE(p->>'property_type', ''))), '');
  v_stage   lead_stage;
  v_existing leads%ROWTYPE;
  v_new_id  bigint;
  v_ev      bigint;
BEGIN
  IF v_source NOT IN ('meta','99acres','magicbricks','website','referral','walk_in','crm','other') THEN
    v_source := 'other';
  END IF;
  IF v_timeline NOT IN ('immediate','within_1_month','1_3_months','3_6_months','6_plus_months','just_exploring','unknown') THEN
    v_timeline := 'unknown';
  END IF;
  IF v_bmin IS NOT NULL AND v_bmax IS NOT NULL AND v_bmin > v_bmax THEN
    SELECT v_bmax, v_bmin INTO v_bmin, v_bmax;
  END IF;
  IF v_ptype IS NOT NULL AND v_ptype NOT IN ('apartment','villa','plot','commercial','other') THEN v_ptype := 'other'; END IF;
  v_key := 'intake:' || v_source || ':' || v_ref;

  -- Serialise concurrent deliveries for the same person.
  PERFORM pg_advisory_xact_lock(hashtext(COALESCE(v_phone, v_email, v_ref)));

  SELECT * INTO v_existing FROM leads l
   WHERE (v_phone IS NOT NULL AND l.phone = v_phone)
      OR (v_email IS NOT NULL AND lower(l.email) = v_email)
   ORDER BY l.id LIMIT 1;

  IF FOUND THEN
    INSERT INTO lead_events (lead_id, agent_id, event_type, note, payload, idempotency_key)
    VALUES (v_existing.id, v_existing.assigned_agent_id, 'repeat_enquiry',
            'Repeat enquiry via ' || v_source, p, v_key)
    ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING
    RETURNING id INTO v_ev;

    IF v_ev IS NOT NULL THEN
      UPDATE leads
         SET priority = priority + 1, repeat_count = repeat_count + 1, last_activity_at = now(),
             -- fill gaps only: never overwrite what an agent may have corrected
             email         = COALESCE(email, v_email),
             phone         = COALESCE(phone, v_phone),
             budget_min    = COALESCE(budget_min, v_bmin),
             budget_max    = COALESCE(budget_max, v_bmax),
             location_pref = COALESCE(location_pref, NULLIF(p->>'location_pref', '')),
             property_type = COALESCE(property_type, v_ptype),
             bhk           = COALESCE(bhk, to_num_safe(p->>'bhk')::int)
       WHERE id = v_existing.id
       RETURNING priority INTO out_priority;
    ELSE
      out_priority := v_existing.priority;
    END IF;
    out_lead_id := v_existing.id; out_is_new := false; out_repeat_logged := v_ev IS NOT NULL;
    out_stage := v_existing.stage; out_assigned_agent_id := v_existing.assigned_agent_id;
    RETURN NEXT; RETURN;
  END IF;

  v_stage := CASE WHEN v_phone IS NULL AND v_email IS NULL THEN 'junk'::lead_stage ELSE 'new'::lead_stage END;

  INSERT INTO leads (name, phone, email, source, source_detail, campaign, budget_min, budget_max,
                     location_pref, property_type, bhk, timeline, raw_payload, stage, is_test)
  VALUES (NULLIF(btrim(p->>'name'), ''), v_phone, v_email, v_source,
          NULLIF(p->>'source_detail', ''), NULLIF(p->>'campaign', ''), v_bmin, v_bmax,
          NULLIF(btrim(p->>'location_pref'), ''), v_ptype,
          to_num_safe(p->>'bhk')::int, v_timeline, COALESCE(p->'raw', p), v_stage,
          COALESCE((p->>'is_test')::boolean, false))
  RETURNING id INTO v_new_id;

  INSERT INTO lead_events (lead_id, event_type, to_stage, note, idempotency_key)
  VALUES (v_new_id, 'created', v_stage, 'Captured from ' || v_source, v_key)
  ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING;

  out_lead_id := v_new_id; out_is_new := true; out_repeat_logged := false;
  out_stage := v_stage; out_assigned_agent_id := NULL; out_priority := 0;
  RETURN NEXT;
END $$;

CREATE OR REPLACE FUNCTION monthly_roi_report(p_month date)
RETURNS TABLE (out_rank bigint, out_source text, out_leads bigint, out_qualified bigint,
               out_site_visits bigint, out_closures bigint, out_cost_inr numeric,
               out_cost_per_lead numeric, out_cost_per_site_visit numeric,
               out_consider_cutting boolean, out_advice text)
LANGUAGE sql STABLE AS $$
  WITH r AS (SELECT * FROM v_source_roi_monthly WHERE month = date_trunc('month', p_month)::date),
  best AS (
    SELECT source AS best_source, cost_per_site_visit AS best_cpsv
      FROM r WHERE cost_inr > 0 AND site_visits > 0
     ORDER BY cost_per_site_visit ASC LIMIT 1
  )
  SELECT row_number() OVER (ORDER BY r.cost_per_site_visit ASC NULLS LAST, r.leads DESC),
         r.source, r.leads, r.qualified, r.site_visits, r.closures, r.cost_inr,
         r.cost_per_lead, r.cost_per_site_visit,
         (r.cost_inr > 0 AND (r.site_visits = 0 OR r.cost_per_site_visit > config_num('consider_cut_multiplier', 2) * b.best_cpsv)) AS consider_cutting,
         CASE
           WHEN r.cost_inr = 0 THEN 'No cost entered for this source.'
           WHEN r.site_visits = 0 THEN
             'Consider cutting: Rs ' || round(r.cost_inr) || ' spent and no site visits from ' || r.leads || ' leads.'
           WHEN r.cost_per_site_visit > config_num('consider_cut_multiplier', 2) * b.best_cpsv THEN
             'Consider cutting: Rs ' || round(r.cost_per_site_visit) || ' per site visit is '
             || round(r.cost_per_site_visit / b.best_cpsv, 1) || 'x the best source ('
             || b.best_source || ', Rs ' || round(b.best_cpsv) || ').'
           ELSE 'Keep: Rs ' || round(r.cost_per_site_visit) || ' per site visit.'
         END
    FROM r LEFT JOIN best b ON true
   ORDER BY 1
$$;

-- Views (same columns as 02_views.sql, now ignoring test rows)
CREATE OR REPLACE VIEW v_lead_progress AS
SELECT l.id AS lead_id,
       l.source,
       l.stage,
       l.score,
       l.created_at,
       l.first_response_at,
       l.assigned_agent_id,
       GREATEST(
         1,
         COALESCE((SELECT max(stage_ord(e.to_stage)) FROM lead_events e
                    WHERE e.lead_id = l.id AND e.to_stage IS NOT NULL), 0),
         stage_ord(l.stage)
       ) AS max_ord
FROM leads l
WHERE NOT l.is_test;

-- Open workload per agent (used by assignment and ops checks).
CREATE OR REPLACE VIEW v_agent_open_load AS
SELECT a.id AS agent_id, a.name, a.active, a.max_open_leads,
       count(l.id) AS open_leads
FROM agents a
LEFT JOIN leads l ON l.assigned_agent_id = a.id
  AND l.stage IN ('new','qualified','site_visit_booked','visited','negotiation')
GROUP BY a.id, a.name, a.active, a.max_open_leads;

-- Conversion over the last 30 days, used to pick the agent for hot leads.
CREATE OR REPLACE VIEW v_agent_conversion_30d AS
SELECT a.id AS agent_id,
       COALESCE(x.assigned_30d, 0) AS assigned_30d,
       COALESCE(w.won_30d, 0)      AS won_30d,
       CASE WHEN COALESCE(x.assigned_30d, 0) = 0 THEN 0
            ELSE round(COALESCE(w.won_30d, 0)::numeric / x.assigned_30d, 4) END AS conversion_rate
FROM agents a
LEFT JOIN (
  SELECT agent_id, count(DISTINCT lead_id) AS assigned_30d
  FROM lead_events
  WHERE lead_id NOT IN (SELECT id FROM leads WHERE is_test) AND event_type IN ('assigned','reassigned_stale') AND created_at >= now() - interval '30 days'
  GROUP BY agent_id) x ON x.agent_id = a.id
LEFT JOIN (
  SELECT agent_id, count(DISTINCT lead_id) AS won_30d
  FROM lead_events
  WHERE lead_id NOT IN (SELECT id FROM leads WHERE is_test) AND event_type = 'stage_change' AND to_stage = 'closed_won' AND created_at >= now() - interval '30 days'
  GROUP BY agent_id) w ON w.agent_id = a.id;

-- Speed to lead: average and median first response (minutes) per agent plus an overall row.
-- A lead is attributed to the agent who made the first human touch, else to the assigned agent.
CREATE OR REPLACE VIEW v_speed_to_lead AS
WITH w AS (
  SELECT l.id,
         COALESCE(l.first_response_agent_id, l.assigned_agent_id) AS agent_id,
         EXTRACT(EPOCH FROM (l.first_response_at - l.created_at)) / 60.0 AS resp_min,
         CASE WHEN l.first_response_at IS NOT NULL
              THEN (l.first_response_at - l.created_at) > make_interval(mins => config_num('sla_first_response_min', 120)::int)
              ELSE (now() - l.created_at)               > make_interval(mins => config_num('sla_first_response_min', 120)::int)
         END AS breached
  FROM leads l
  WHERE l.stage <> 'junk' AND NOT l.is_test
    AND l.created_at >= now() - make_interval(days => config_num('metrics_window_days', 30)::int)
)
SELECT COALESCE(w.agent_id::text, 'unassigned') AS agent_key,
       COALESCE(a.name, 'Unassigned')           AS agent_name,
       count(*)                                 AS leads,
       count(w.resp_min)                        AS responded,
       round(avg(w.resp_min)::numeric, 1)       AS avg_response_min,
       round((percentile_cont(0.5) WITHIN GROUP (ORDER BY w.resp_min))::numeric, 1) AS median_response_min,
       count(*) FILTER (WHERE w.breached)       AS sla_breaches
FROM w LEFT JOIN agents a ON a.id = w.agent_id
GROUP BY w.agent_id, a.name
UNION ALL
SELECT 'overall', 'All agents',
       count(*), count(w.resp_min),
       round(avg(w.resp_min)::numeric, 1),
       round((percentile_cont(0.5) WITHIN GROUP (ORDER BY w.resp_min))::numeric, 1),
       count(*) FILTER (WHERE w.breached)
FROM w;

-- Funnel: leads that reached each stage, with stage-to-stage and top-of-funnel conversion.
CREATE OR REPLACE VIEW v_funnel AS
WITH s(ord, stage) AS (
  VALUES (1,'new'),(2,'qualified'),(3,'site_visit_booked'),(4,'visited'),(5,'negotiation'),(6,'closed_won')
), w AS (
  SELECT * FROM v_lead_progress
  WHERE stage <> 'junk'
    AND created_at >= now() - make_interval(days => config_num('metrics_window_days', 30)::int)
), c AS (
  SELECT s.ord, s.stage,
         count(w.lead_id) FILTER (WHERE w.max_ord >= s.ord)  AS reached,
         count(w.lead_id) FILTER (WHERE w.stage::text = s.stage) AS currently_in
  FROM s LEFT JOIN w ON true
  GROUP BY s.ord, s.stage
)
SELECT stage, ord, reached, currently_in,
       round(100.0 * reached / NULLIF(lag(reached) OVER (ORDER BY ord), 0), 1)         AS conv_from_prev_pct,
       round(100.0 * reached / NULLIF(first_value(reached) OVER (ORDER BY ord), 0), 1) AS conv_from_top_pct
FROM c;

-- Source ROI per calendar month (IST) of lead creation.
CREATE OR REPLACE VIEW v_source_roi_monthly AS
WITH cohort AS (
  SELECT date_trunc('month', created_at AT TIME ZONE 'Asia/Kolkata')::date AS month,
         source,
         count(*)                                   AS leads,
         count(*) FILTER (WHERE stage = 'junk')     AS junk,
         count(*) FILTER (WHERE max_ord >= 2)       AS qualified,
         count(*) FILTER (WHERE max_ord >= 3)       AS visits_booked,
         count(*) FILTER (WHERE max_ord >= 4)       AS site_visits,
         count(*) FILTER (WHERE stage = 'closed_won') AS closures
  FROM v_lead_progress
  GROUP BY 1, 2
)
SELECT c.month, c.source, c.leads, c.junk, c.qualified, c.visits_booked, c.site_visits, c.closures,
       COALESCE(sc.amount_inr, 0) AS cost_inr,
       round(sc.amount_inr / NULLIF(c.leads, 0), 2)       AS cost_per_lead,
       round(sc.amount_inr / NULLIF(c.site_visits, 0), 2) AS cost_per_site_visit,
       round(sc.amount_inr / NULLIF(c.closures, 0), 2)    AS cost_per_closure
FROM cohort c
LEFT JOIN source_costs sc ON sc.source = c.source AND sc.month = c.month AND NOT sc.is_test;

-- Agent leaderboard over the metrics window. Rank: conversions, then visits booked, then follow-ups.
CREATE OR REPLACE VIEW v_agent_leaderboard AS
WITH win AS (
  SELECT now() - make_interval(days => config_num('metrics_window_days', 30)::int) AS since
), ev AS (
  SELECT e.agent_id,
         count(*) FILTER (WHERE e.event_type = 'stage_change' AND e.to_stage = 'site_visit_booked'
                            AND e.from_stage IS DISTINCT FROM 'site_visit_booked') AS visits_booked,
         count(*) FILTER (WHERE e.event_type IN ('called','followup_done'))        AS follow_ups_done,
         count(*) FILTER (WHERE e.event_type = 'stage_change' AND e.to_stage = 'closed_won') AS conversions
  FROM lead_events e JOIN leads tl ON tl.id = e.lead_id AND NOT tl.is_test, win
  WHERE e.agent_id IS NOT NULL AND e.created_at >= win.since
  GROUP BY e.agent_id
), resp AS (
  SELECT l.first_response_agent_id AS agent_id,
         round(avg(EXTRACT(EPOCH FROM (l.first_response_at - l.created_at)) / 60.0)::numeric, 1) AS avg_response_min
  FROM leads l, win
  WHERE NOT l.is_test AND l.first_response_agent_id IS NOT NULL AND l.created_at >= win.since
  GROUP BY l.first_response_agent_id
)
SELECT a.id AS agent_id, a.name, a.active,
       COALESCE(ev.visits_booked, 0)   AS visits_booked,
       COALESCE(ev.follow_ups_done, 0) AS follow_ups_done,
       COALESCE(ev.conversions, 0)     AS conversions,
       resp.avg_response_min,
       rank() OVER (ORDER BY COALESCE(ev.conversions, 0) DESC,
                             COALESCE(ev.visits_booked, 0) DESC,
                             COALESCE(ev.follow_ups_done, 0) DESC) AS rank
FROM agents a
LEFT JOIN ev   ON ev.agent_id = a.id
LEFT JOIN resp ON resp.agent_id = a.id
WHERE a.active;

-- Inventory: per listing, buyers matched, messaged and interested.
CREATE OR REPLACE VIEW v_inventory_matches AS
SELECT li.id AS listing_id, li.title, li.project, li.location, li.status,
       count(m.id)                                   AS buyers_matched,
       count(m.messaged_at)                          AS buyers_messaged,
       count(m.responded_at)                         AS buyers_responded,
       count(*) FILTER (WHERE m.interested IS TRUE)  AS buyers_interested,
       count(*) FILTER (WHERE m.interested IS FALSE) AS buyers_not_interested
FROM listings li
LEFT JOIN listing_matches m ON m.listing_id = li.id
WHERE NOT li.is_test
GROUP BY li.id, li.title, li.project, li.location, li.status;

-- ---------------------------------------------------------------------------
-- claim_outbound: messages about TEST leads are never sent. The claim is recorded as already "sent"
-- (provider_id 'test-suppressed') and returns false, so every "Not Sent Yet?" check in the workflow
-- skips the WhatsApp node. One change here covers all send chains.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION claim_outbound(p_key text, p_recipient text, p_template text, p_lead_id bigint DEFAULT NULL)
RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE v_id bigint;
BEGIN
  IF p_lead_id IS NOT NULL AND EXISTS (SELECT 1 FROM leads WHERE id = p_lead_id AND is_test) THEN
    INSERT INTO outbound_messages (idempotency_key, recipient, template, lead_id, status, provider_id)
    VALUES (p_key, p_recipient, p_template, p_lead_id, 'sent', 'test-suppressed')
    ON CONFLICT (idempotency_key) DO NOTHING;
    RETURN false;
  END IF;
  INSERT INTO outbound_messages (idempotency_key, recipient, template, lead_id)
  VALUES (p_key, p_recipient, p_template, p_lead_id)
  ON CONFLICT (idempotency_key) DO UPDATE
    SET status = 'pending', error = NULL, attempts = outbound_messages.attempts + 1
    WHERE outbound_messages.status = 'failed'
  RETURNING id INTO v_id;
  RETURN v_id IS NOT NULL;
END $$;
