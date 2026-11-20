// Database schemas for SQLite (local development) and MySQL (production).

export const SQLITE_SCHEMA = `
CREATE TABLE IF NOT EXISTS reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  reference TEXT NOT NULL UNIQUE,
  citizen_description TEXT NOT NULL DEFAULT '',
  latitude REAL NOT NULL,
  longitude REAL NOT NULL,
  area TEXT,
  address TEXT,
  category TEXT,
  ai_description TEXT,
  severity TEXT,
  confidence REAL,
  image_assessment TEXT,
  priority TEXT,
  department TEXT,
  recommended_action TEXT,
  priority_explanation TEXT,
  duplicate_summary TEXT,
  needs_human_review INTEGER NOT NULL DEFAULT 0,
  review_reasons TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'submitted',
  analysis_status TEXT NOT NULL DEFAULT 'pending',
  ai_mode TEXT,
  is_demo INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_reports_geo ON reports(latitude, longitude);
CREATE INDEX IF NOT EXISTS idx_reports_category ON reports(category);
CREATE INDEX IF NOT EXISTS idx_reports_status ON reports(status);
CREATE INDEX IF NOT EXISTS idx_reports_priority ON reports(priority);
CREATE INDEX IF NOT EXISTS idx_reports_created ON reports(created_at);
CREATE INDEX IF NOT EXISTS idx_reports_demo ON reports(is_demo);

CREATE TABLE IF NOT EXISTS report_images (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  report_id INTEGER NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
  filename TEXT NOT NULL,
  original_name TEXT,
  mime_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  width INTEGER,
  height INTEGER,
  image_hash TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_images_report ON report_images(report_id);

CREATE TABLE IF NOT EXISTS duplicate_links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  report_id INTEGER NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
  candidate_report_id INTEGER NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
  distance_m REAL NOT NULL,
  image_similarity REAL,
  text_similarity REAL,
  likelihood TEXT NOT NULL,
  reason TEXT,
  status TEXT NOT NULL DEFAULT 'suggested',
  review_note TEXT,
  reviewed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE(report_id, candidate_report_id)
);
CREATE INDEX IF NOT EXISTS idx_dup_report ON duplicate_links(report_id);
CREATE INDEX IF NOT EXISTS idx_dup_candidate ON duplicate_links(candidate_report_id);
CREATE INDEX IF NOT EXISTS idx_dup_status ON duplicate_links(status);

CREATE TABLE IF NOT EXISTS agent_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  report_id INTEGER REFERENCES reports(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'running',
  ai_mode TEXT NOT NULL,
  model TEXT,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  duration_ms INTEGER,
  error TEXT,
  final_decision TEXT
);
CREATE INDEX IF NOT EXISTS idx_runs_report ON agent_runs(report_id);
CREATE INDEX IF NOT EXISTS idx_runs_started ON agent_runs(started_at);

CREATE TABLE IF NOT EXISTS agent_steps (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id INTEGER NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
  agent TEXT NOT NULL,
  step TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'info',
  message TEXT NOT NULL,
  data TEXT,
  duration_ms INTEGER,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_steps_run ON agent_steps(run_id);

CREATE TABLE IF NOT EXISTS agent_results (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id INTEGER NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
  report_id INTEGER REFERENCES reports(id) ON DELETE CASCADE,
  agent TEXT NOT NULL,
  output TEXT NOT NULL,
  valid INTEGER NOT NULL DEFAULT 1,
  validation_errors TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_results_report ON agent_results(report_id);

CREATE TABLE IF NOT EXISTS status_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  report_id INTEGER NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
  from_status TEXT,
  to_status TEXT NOT NULL,
  note TEXT,
  changed_by TEXT NOT NULL DEFAULT 'system',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_history_report ON status_history(report_id);

CREATE TABLE IF NOT EXISTS admin_notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  report_id INTEGER NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
  note TEXT NOT NULL,
  author TEXT NOT NULL DEFAULT 'admin',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_notes_report ON admin_notes(report_id);

CREATE TABLE IF NOT EXISTS contact_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  subject TEXT NOT NULL,
  message TEXT NOT NULL,
  delivery_status TEXT NOT NULL DEFAULT 'stored',
  read_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_contact_created ON contact_messages(created_at);
`;

// MySQL schema (GoDaddy Hosted MySQL). Timestamps are ISO-8601 strings (same as SQLite) so API
// responses are identical across databases. Indexes are declared inline because MySQL has no
// CREATE INDEX IF NOT EXISTS.
const T = 'ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci';
export const MYSQL_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS reports (
    id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    reference VARCHAR(32) NOT NULL,
    citizen_description TEXT NOT NULL,
    latitude DOUBLE NOT NULL,
    longitude DOUBLE NOT NULL,
    area VARCHAR(255) NULL,
    address TEXT NULL,
    category VARCHAR(40) NULL,
    ai_description TEXT NULL,
    severity VARCHAR(20) NULL,
    confidence DOUBLE NULL,
    image_assessment VARCHAR(20) NULL,
    priority VARCHAR(20) NULL,
    department VARCHAR(64) NULL,
    recommended_action TEXT NULL,
    priority_explanation TEXT NULL,
    duplicate_summary TEXT NULL,
    needs_human_review TINYINT(1) NOT NULL DEFAULT 0,
    review_reasons TEXT NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'submitted',
    analysis_status VARCHAR(20) NOT NULL DEFAULT 'pending',
    ai_mode VARCHAR(20) NULL,
    is_demo TINYINT(1) NOT NULL DEFAULT 0,
    created_at VARCHAR(32) NOT NULL,
    updated_at VARCHAR(32) NOT NULL,
    UNIQUE KEY uq_reports_reference (reference),
    KEY idx_reports_geo (latitude, longitude),
    KEY idx_reports_category (category),
    KEY idx_reports_status (status),
    KEY idx_reports_priority (priority),
    KEY idx_reports_created (created_at),
    KEY idx_reports_demo (is_demo)
  ) ${T}`,
  `CREATE TABLE IF NOT EXISTS report_images (
    id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    report_id INT UNSIGNED NOT NULL,
    filename VARCHAR(255) NOT NULL,
    original_name VARCHAR(255) NULL,
    mime_type VARCHAR(64) NOT NULL,
    size_bytes INT UNSIGNED NOT NULL,
    width INT NULL,
    height INT NULL,
    image_hash VARCHAR(32) NULL,
    created_at VARCHAR(32) NOT NULL,
    KEY idx_images_report (report_id),
    CONSTRAINT fk_images_report FOREIGN KEY (report_id) REFERENCES reports(id) ON DELETE CASCADE
  ) ${T}`,
  `CREATE TABLE IF NOT EXISTS duplicate_links (
    id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    report_id INT UNSIGNED NOT NULL,
    candidate_report_id INT UNSIGNED NOT NULL,
    distance_m DOUBLE NOT NULL,
    image_similarity DOUBLE NULL,
    text_similarity DOUBLE NULL,
    likelihood VARCHAR(20) NOT NULL,
    reason TEXT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'suggested',
    review_note TEXT NULL,
    reviewed_at VARCHAR(32) NULL,
    created_at VARCHAR(32) NOT NULL,
    UNIQUE KEY uq_dup_pair (report_id, candidate_report_id),
    KEY idx_dup_candidate (candidate_report_id),
    KEY idx_dup_status (status),
    CONSTRAINT fk_dup_report FOREIGN KEY (report_id) REFERENCES reports(id) ON DELETE CASCADE,
    CONSTRAINT fk_dup_candidate FOREIGN KEY (candidate_report_id) REFERENCES reports(id) ON DELETE CASCADE
  ) ${T}`,
  `CREATE TABLE IF NOT EXISTS agent_runs (
    id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    report_id INT UNSIGNED NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'running',
    ai_mode VARCHAR(20) NOT NULL,
    model VARCHAR(100) NULL,
    started_at VARCHAR(32) NOT NULL,
    completed_at VARCHAR(32) NULL,
    duration_ms INT NULL,
    error TEXT NULL,
    final_decision LONGTEXT NULL,
    KEY idx_runs_report (report_id),
    KEY idx_runs_started (started_at),
    CONSTRAINT fk_runs_report FOREIGN KEY (report_id) REFERENCES reports(id) ON DELETE CASCADE
  ) ${T}`,
  `CREATE TABLE IF NOT EXISTS agent_steps (
    id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    run_id INT UNSIGNED NOT NULL,
    agent VARCHAR(20) NOT NULL,
    step VARCHAR(100) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'info',
    message TEXT NOT NULL,
    data LONGTEXT NULL,
    duration_ms INT NULL,
    created_at VARCHAR(32) NOT NULL,
    KEY idx_steps_run (run_id),
    CONSTRAINT fk_steps_run FOREIGN KEY (run_id) REFERENCES agent_runs(id) ON DELETE CASCADE
  ) ${T}`,
  `CREATE TABLE IF NOT EXISTS agent_results (
    id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    run_id INT UNSIGNED NOT NULL,
    report_id INT UNSIGNED NULL,
    agent VARCHAR(20) NOT NULL,
    output LONGTEXT NOT NULL,
    valid TINYINT(1) NOT NULL DEFAULT 1,
    validation_errors TEXT NULL,
    created_at VARCHAR(32) NOT NULL,
    KEY idx_results_report (report_id),
    KEY idx_results_run (run_id),
    CONSTRAINT fk_results_run FOREIGN KEY (run_id) REFERENCES agent_runs(id) ON DELETE CASCADE,
    CONSTRAINT fk_results_report FOREIGN KEY (report_id) REFERENCES reports(id) ON DELETE CASCADE
  ) ${T}`,
  `CREATE TABLE IF NOT EXISTS status_history (
    id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    report_id INT UNSIGNED NOT NULL,
    from_status VARCHAR(20) NULL,
    to_status VARCHAR(20) NOT NULL,
    note TEXT NULL,
    changed_by VARCHAR(40) NOT NULL DEFAULT 'system',
    created_at VARCHAR(32) NOT NULL,
    KEY idx_history_report (report_id),
    CONSTRAINT fk_history_report FOREIGN KEY (report_id) REFERENCES reports(id) ON DELETE CASCADE
  ) ${T}`,
  `CREATE TABLE IF NOT EXISTS admin_notes (
    id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    report_id INT UNSIGNED NOT NULL,
    note TEXT NOT NULL,
    author VARCHAR(40) NOT NULL DEFAULT 'admin',
    created_at VARCHAR(32) NOT NULL,
    KEY idx_notes_report (report_id),
    CONSTRAINT fk_notes_report FOREIGN KEY (report_id) REFERENCES reports(id) ON DELETE CASCADE
  ) ${T}`,
  `CREATE TABLE IF NOT EXISTS contact_messages (
    id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    email VARCHAR(200) NOT NULL,
    subject VARCHAR(150) NOT NULL,
    message TEXT NOT NULL,
    delivery_status VARCHAR(20) NOT NULL DEFAULT 'stored',
    read_at VARCHAR(32) NULL,
    created_at VARCHAR(32) NOT NULL,
    KEY idx_contact_created (created_at)
  ) ${T}`,
];

/** Tables in foreign-key order (used by the SQLite → MySQL migration script). */
export const TABLES = ['reports', 'report_images', 'duplicate_links', 'agent_runs', 'agent_steps', 'agent_results', 'status_history', 'admin_notes', 'contact_messages'];
