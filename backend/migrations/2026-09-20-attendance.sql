CREATE TABLE IF NOT EXISTS attendance_confirmations (
 invitation_id BIGINT UNSIGNED PRIMARY KEY,
 confirmed_at DATETIME NOT NULL,
 FOREIGN KEY (invitation_id) REFERENCES invitations(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
