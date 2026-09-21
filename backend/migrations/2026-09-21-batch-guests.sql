CREATE TABLE IF NOT EXISTS invitation_batch_guests (
 registration_id BIGINT UNSIGNED PRIMARY KEY,
 batch_id VARCHAR(36) NOT NULL,
 FOREIGN KEY (registration_id) REFERENCES registrations(id) ON DELETE CASCADE,
 FOREIGN KEY (batch_id) REFERENCES invitation_batches(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
INSERT IGNORE INTO invitation_batch_guests(registration_id,batch_id)
 SELECT v.registration_id,i.batch_id FROM invitation_batch_items i JOIN invitations v ON v.id=i.invitation_id;
