-- =====================================================================
--  MBS enquiries database (SQLite)
--  File: data/mbs.db  (created automatically by the local server)
--
--  One row per customer enquiry from the website (Mr. Fixit chat or the
--  contact form). Each enquiry gets a reference (pre-job) number when it
--  arrives:  <TRADE>-<YYMMDD>-<running number>, e.g. R-261017-000001.
--  When it becomes real work it gets a job number with a J in front
--  (JR-261017-000001):  node tools/jobs.mjs convert R-261017-000001
--
--  Trade codes: B Building, C Concrete & cracks, W Waterproofing & leaks,
--  R Roofing & gutters, T Tiling, D Doors & windows, G Gyprock & plaster,
--  O Outdoor (decks, pergolas, fencing), F Painting & finishes,
--  E Electrical, P Plumbing, S Storm damage, Q Repair question,
--  M General maintenance
--
--  Later this table can feed the full business database (customers, quotes,
--  jobs, invoices) without losing any history.
-- =====================================================================

CREATE TABLE IF NOT EXISTS inquiries (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  prejob_no      TEXT NOT NULL UNIQUE,          -- R-261017-000001 (given on arrival)
  job_no         TEXT UNIQUE,                   -- JR-261017-000001 (given when converted)
  trade_code     TEXT,                          -- B C W R T D G O F E P S Q M
  status         TEXT NOT NULL DEFAULT 'new'
                 CHECK (status IN ('new', 'contacted', 'quoted', 'converted', 'lost')),
  source         TEXT NOT NULL,                 -- Website chat / Website contact form

  -- customer
  customer_name  TEXT,
  phone          TEXT,
  email          TEXT,
  suburb         TEXT,

  -- the enquiry
  service        TEXT,                          -- e.g. Leak repair, Decking, Repair question
  details        TEXT,                          -- what the customer described
  urgency        TEXT,                          -- Emergency / This week / This month / Flexible
  best_time      TEXT,                          -- best time to call
  summary        TEXT,                          -- one-paragraph summary sent to staff
  transcript     TEXT,                          -- the chat, as JSON
  photos         TEXT,                          -- JSON list of saved photo files

  -- delivery
  email_sent     INTEGER NOT NULL DEFAULT 0,    -- 1 = staff email sent
  telegram_sent  INTEGER NOT NULL DEFAULT 0,    -- 1 = staff Telegram sent

  created_at     TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
  converted_at   TEXT,
  notes          TEXT
);

CREATE INDEX IF NOT EXISTS inquiries_status_idx ON inquiries (status, created_at);
CREATE INDEX IF NOT EXISTS inquiries_phone_idx  ON inquiries (phone);
