CREATE TABLE IF NOT EXISTS invitation_batches (
  id VARCHAR(36) NOT NULL PRIMARY KEY,
  import_key CHAR(64) NOT NULL UNIQUE,
  name VARCHAR(120) NOT NULL,
  created_at DATETIME NOT NULL,
  created_by VARCHAR(255) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS invitation_batch_items (
  invitation_id BIGINT UNSIGNED NOT NULL PRIMARY KEY,
  batch_id VARCHAR(36) NOT NULL,
  ticket_type VARCHAR(20) NOT NULL,
  KEY ix_batch_items (batch_id),
  FOREIGN KEY (invitation_id) REFERENCES invitations(id) ON DELETE CASCADE,
  FOREIGN KEY (batch_id) REFERENCES invitation_batches(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
