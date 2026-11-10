-- Demo data of the Preview (ADR-032). Loaded by the platform right after the migrations, with the owner account,
-- in one transaction, on a schema that was just emptied; never on Prod. INSERT and UPDATE only (the platform
-- refuses anything else): the schema belongs to db/migrations, deletions to db/purge.sql. The rules are the same
-- as for a handler: an actor and a request id for the audit trail, status changes walked through the transition
-- trigger, every status of every flow shown, dates relative to now(). The people are obviously fictional:
-- names from the list below, mails @example.com, no real company or address. Personas get their own actor at
-- their first sign-in: these rows show on the lists, dashboards and charts, never under "My requests".

-- ── Actor of this seed (audit_row() and requests_transition() need one) ───────────────────────────────────────
INSERT INTO actors (id, type, display_name) VALUES ('d0000000-0000-4000-8000-0000000000a0', 'machine', 'demo-seed');
SELECT set_config('app.actor_id', 'd0000000-0000-4000-8000-0000000000a0', true),
       set_config('app.request_id', 'demo-seed', true);

-- ── Fictional people: four requesters, two technicians ─────────────────────────────────────────────────────────
INSERT INTO actors (id, type, mail, display_name) VALUES
  ('d0000000-0000-4000-8000-0000000000a1', 'human', 'taylor.demo@example.com', 'Taylor Demo'),
  ('d0000000-0000-4000-8000-0000000000a2', 'human', 'jordan.sample@example.com', 'Jordan Sample'),
  ('d0000000-0000-4000-8000-0000000000a3', 'human', 'morgan.example@example.com', 'Morgan Example'),
  ('d0000000-0000-4000-8000-0000000000a4', 'human', 'riley.placeholder@example.com', 'Riley Placeholder'),
  ('d0000000-0000-4000-8000-0000000000b1', 'human', 'sam.fixture@example.com', 'Sam Fixture'),
  ('d0000000-0000-4000-8000-0000000000b2', 'human', 'avery.mockdata@example.com', 'Avery Mockdata');

-- ── Reference list: every row used by a request below, one deactivated ─────────────────────────────────────────
INSERT INTO categories (code, label, active) VALUES
  ('plumbing', 'Plumbing', true),
  ('electrical', 'Electrical', true),
  ('doors_locks', 'Locks and doors', true),
  ('hvac', 'Heating and cooling', true),
  ('cleaning', 'Cleaning', true),
  ('it_equipment', 'IT equipment', true),
  ('painting', 'Painting (no longer offered)', false);

-- ── Requests: born drafts (trigger), dated over the last six weeks; a1..a4 are the requesters ──────────────────
INSERT INTO requests (id, category_code, urgency, requester_id, created_at) VALUES
  ('d0000000-0000-4000-8000-000000000001', 'plumbing', 'high', 'd0000000-0000-4000-8000-0000000000a1', now() - interval '1 hour'),
  ('d0000000-0000-4000-8000-000000000002', 'cleaning', 'low', 'd0000000-0000-4000-8000-0000000000a2', now() - interval '1 day'),
  ('d0000000-0000-4000-8000-000000000003', 'it_equipment', 'normal', 'd0000000-0000-4000-8000-0000000000a3', now() - interval '2 days'),
  ('d0000000-0000-4000-8000-000000000004', 'electrical', 'high', 'd0000000-0000-4000-8000-0000000000a4', now() - interval '3 days'),
  ('d0000000-0000-4000-8000-000000000005', 'doors_locks', 'normal', 'd0000000-0000-4000-8000-0000000000a1', now() - interval '4 days'),
  ('d0000000-0000-4000-8000-000000000006', 'hvac', 'low', 'd0000000-0000-4000-8000-0000000000a2', now() - interval '5 days'),
  ('d0000000-0000-4000-8000-000000000007', 'plumbing', 'normal', 'd0000000-0000-4000-8000-0000000000a3', now() - interval '7 days'),
  ('d0000000-0000-4000-8000-000000000008', 'electrical', 'high', 'd0000000-0000-4000-8000-0000000000a4', now() - interval '9 days'),
  ('d0000000-0000-4000-8000-000000000009', 'it_equipment', 'normal', 'd0000000-0000-4000-8000-0000000000a1', now() - interval '12 days'),
  ('d0000000-0000-4000-8000-000000000010', 'cleaning', 'low', 'd0000000-0000-4000-8000-0000000000a2', now() - interval '15 days'),
  ('d0000000-0000-4000-8000-000000000011', 'hvac', 'high', 'd0000000-0000-4000-8000-0000000000a3', now() - interval '19 days'),
  ('d0000000-0000-4000-8000-000000000012', 'doors_locks', 'normal', 'd0000000-0000-4000-8000-0000000000a4', now() - interval '24 days'),
  ('d0000000-0000-4000-8000-000000000013', 'painting', 'low', 'd0000000-0000-4000-8000-0000000000a1', now() - interval '30 days'),
  ('d0000000-0000-4000-8000-000000000014', 'plumbing', 'normal', 'd0000000-0000-4000-8000-0000000000a2', now() - interval '36 days'),
  ('d0000000-0000-4000-8000-000000000015', 'electrical', 'low', 'd0000000-0000-4000-8000-0000000000a3', now() - interval '42 days');

INSERT INTO request_details (request_id, title, description, location) VALUES
  ('d0000000-0000-4000-8000-000000000001', 'Leak under the sink of the kitchenette', 'Water on the floor every morning; the cabinet is soaked.', 'Building A, floor 2, kitchenette'),
  ('d0000000-0000-4000-8000-000000000002', 'Carpet stain in meeting room 4', 'Coffee spilled during the Monday meeting.', 'Building A, meeting room 4'),
  ('d0000000-0000-4000-8000-000000000003', 'Monitor flickers at desk 12', 'The screen goes black for a second every few minutes.', 'Open space, desk 12'),
  ('d0000000-0000-4000-8000-000000000004', 'Socket sparks when plugging in', 'Visible spark and a burnt smell; the socket is taped off for now.', 'Building B, workshop'),
  ('d0000000-0000-4000-8000-000000000005', 'Badge reader of the archive room does not read', 'Badges are refused one time out of two.', 'Basement, archive room'),
  ('d0000000-0000-4000-8000-000000000006', 'Too cold in the open space', 'The thermostat reads 17 C since the weekend.', 'Open space, north side'),
  ('d0000000-0000-4000-8000-000000000007', 'Blocked drain in the men''s restroom', 'The sink drains very slowly and smells.', 'Building A, floor 1, restroom'),
  ('d0000000-0000-4000-8000-000000000008', 'Corridor lights stay off', 'Three ceiling lights out of five do not switch on.', 'Building B, corridor floor 3'),
  ('d0000000-0000-4000-8000-000000000009', 'Printer of the sales team jams', 'Paper jams on every duplex print.', 'Building A, floor 3, print corner'),
  ('d0000000-0000-4000-8000-000000000010', 'Windows of the lobby need cleaning', 'Fingerprints and dust on the whole glass front.', 'Lobby'),
  ('d0000000-0000-4000-8000-000000000011', 'Server room too warm', 'The alarm went off at 28 C last night.', 'Building B, server room'),
  ('d0000000-0000-4000-8000-000000000012', 'Lost key of the supplies cabinet', 'The only key cannot be found; the cabinet must be opened.', 'Building A, floor 2, supplies'),
  ('d0000000-0000-4000-8000-000000000013', 'Repaint the scratched wall of the entrance', 'Scratches left by the move of the copier.', 'Entrance hall'),
  ('d0000000-0000-4000-8000-000000000014', 'Water heater makes a loud noise', 'A banging noise every time hot water runs.', 'Building B, floor 1, cleaning room'),
  ('d0000000-0000-4000-8000-000000000015', 'Replace the emergency exit lamp', 'The green exit sign is dark.', 'Building A, floor 1, east exit');

-- Attachments (one per request at most): a 1x1 PNG, enough for a download and a preview.
INSERT INTO request_attachments (request_id, name, media_type, content) VALUES
  ('d0000000-0000-4000-8000-000000000001', 'leak.png', 'image/png', decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64')),
  ('d0000000-0000-4000-8000-000000000004', 'socket.png', 'image/png', decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64')),
  ('d0000000-0000-4000-8000-000000000011', 'alarm.png', 'image/png', decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64'));

-- ── Status flows, step by step through the transition trigger (history written by the database) ──────────────
-- Drafts stay as born: 1, 2, 13.
-- Submitted: 3, 4, 5.
UPDATE requests SET status = 'submitted' WHERE id IN ('d0000000-0000-4000-8000-000000000003', 'd0000000-0000-4000-8000-000000000004', 'd0000000-0000-4000-8000-000000000005');
-- In progress, with a technician: 6, 7, 8.
UPDATE requests SET status = 'submitted' WHERE id IN ('d0000000-0000-4000-8000-000000000006', 'd0000000-0000-4000-8000-000000000007', 'd0000000-0000-4000-8000-000000000008');
UPDATE requests SET status = 'in_progress', assignee_id = 'd0000000-0000-4000-8000-0000000000b1' WHERE id IN ('d0000000-0000-4000-8000-000000000006', 'd0000000-0000-4000-8000-000000000007');
UPDATE requests SET status = 'in_progress', assignee_id = 'd0000000-0000-4000-8000-0000000000b2' WHERE id = 'd0000000-0000-4000-8000-000000000008';
-- Resolved (closing note first): 9, 10, 11.
UPDATE requests SET status = 'submitted' WHERE id IN ('d0000000-0000-4000-8000-000000000009', 'd0000000-0000-4000-8000-000000000010', 'd0000000-0000-4000-8000-000000000011');
UPDATE requests SET status = 'in_progress', assignee_id = 'd0000000-0000-4000-8000-0000000000b2' WHERE id IN ('d0000000-0000-4000-8000-000000000009', 'd0000000-0000-4000-8000-000000000010', 'd0000000-0000-4000-8000-000000000011');
UPDATE request_details SET closing_note = 'Rollers replaced, 50 duplex pages printed without a jam.' WHERE request_id = 'd0000000-0000-4000-8000-000000000009';
UPDATE request_details SET closing_note = 'Glass front cleaned inside and out.' WHERE request_id = 'd0000000-0000-4000-8000-000000000010';
UPDATE request_details SET closing_note = 'Cooling unit filter changed; 21 C after two hours.' WHERE request_id = 'd0000000-0000-4000-8000-000000000011';
UPDATE requests SET status = 'resolved' WHERE id IN ('d0000000-0000-4000-8000-000000000009', 'd0000000-0000-4000-8000-000000000010', 'd0000000-0000-4000-8000-000000000011');
-- Rejected: 12 straight from submitted, 14 after work started.
UPDATE requests SET status = 'submitted' WHERE id IN ('d0000000-0000-4000-8000-000000000012', 'd0000000-0000-4000-8000-000000000014');
UPDATE request_details SET closing_note = 'Spare key found at the reception desk; nothing to open.' WHERE request_id = 'd0000000-0000-4000-8000-000000000012';
UPDATE requests SET status = 'rejected' WHERE id = 'd0000000-0000-4000-8000-000000000012';
UPDATE requests SET status = 'in_progress', assignee_id = 'd0000000-0000-4000-8000-0000000000b1' WHERE id = 'd0000000-0000-4000-8000-000000000014';
UPDATE request_details SET closing_note = 'The heater is under the supplier''s warranty: handled by the supplier, not by us.' WHERE request_id = 'd0000000-0000-4000-8000-000000000014';
UPDATE requests SET status = 'rejected' WHERE id = 'd0000000-0000-4000-8000-000000000014';
-- Cancelled by the requester: 15.
UPDATE requests SET status = 'submitted' WHERE id = 'd0000000-0000-4000-8000-000000000015';
UPDATE requests SET status = 'cancelled' WHERE id = 'd0000000-0000-4000-8000-000000000015';

-- ── Two logical deletions (restore path shown): a draft and a resolved request ─────────────────────────────────
UPDATE requests SET deleted_at = now() - interval '2 days', deleted_by = 'd0000000-0000-4000-8000-0000000000a0'
  WHERE id IN ('d0000000-0000-4000-8000-000000000013', 'd0000000-0000-4000-8000-000000000010');
