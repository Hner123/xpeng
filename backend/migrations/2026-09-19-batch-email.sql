CREATE TABLE IF NOT EXISTS batch_email_tests (
 id VARCHAR(36) PRIMARY KEY, batch_id VARCHAR(36) NOT NULL,
 fingerprint CHAR(64) NOT NULL, actor VARCHAR(255) NOT NULL, recipient_enc TEXT NOT NULL,
 status VARCHAR(16) NOT NULL, created_at DATETIME NOT NULL,
 FOREIGN KEY (batch_id) REFERENCES invitation_batches(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS batch_emails (
 id VARCHAR(36) PRIMARY KEY, batch_id VARCHAR(36) NOT NULL,
 invitation_id BIGINT UNSIGNED NOT NULL UNIQUE,
 recipient_enc TEXT NOT NULL, content_enc MEDIUMTEXT NOT NULL,
 status VARCHAR(16) NOT NULL DEFAULT 'PENDING', attempts INT NOT NULL DEFAULT 0,
 created_at DATETIME NOT NULL, updated_at DATETIME NOT NULL, sent_at DATETIME DEFAULT NULL,
 actor VARCHAR(255) NOT NULL, message_id TEXT, error TEXT,
 KEY ix_batch_email_status (status),
 FOREIGN KEY (batch_id) REFERENCES invitation_batches(id),
 FOREIGN KEY (invitation_id) REFERENCES invitations(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
