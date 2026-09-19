'use strict';
const crypto = require('node:crypto');
const { parseCsv, preview, messageRow } = require('./batch-preview');

function make(db, store) {
  async function list() {
    return db.all(`SELECT b.id,b.name,b.created_at,b.created_by,COUNT(i.invitation_id) AS total
      FROM invitation_batches b LEFT JOIN invitation_batch_items i ON i.batch_id=b.id
      GROUP BY b.id,b.name,b.created_at,b.created_by ORDER BY b.created_at DESC,b.id`);
  }
  async function detail(id) {
    const batch = await db.get('SELECT id,name,created_at,created_by FROM invitation_batches WHERE id=?', [id]);
    if (!batch) return null;
    const records = await db.all(`SELECT r.*,v.code AS ticket_code,v.status AS invitation_status,i.ticket_type
      FROM invitation_batch_items i JOIN invitations v ON v.id=i.invitation_id
      JOIN registrations r ON r.id=v.registration_id WHERE i.batch_id=? ORDER BY r.id`, [id]);
    return { ...batch, total: records.length, rows: records.map(r => ({ ...messageRow(store.decorate(r), r.ticket_type, r.ticket_code), invitation_status: r.invitation_status })) };
  }
  async function save(csv, actor) {
    const input = parseCsv(csv);
    const normalized = input.map(r => [r.batch, Number(r.registration_id), r.email.toLowerCase(), r.ticket_type, r.ticket_code.toUpperCase()]).sort((a,b) => a[1]-b[1]);
    const key = crypto.createHash('sha256').update(JSON.stringify(normalized)).digest('hex');
    const prior = await db.get('SELECT id FROM invitation_batches WHERE import_key=?', [key]);
    if (prior) return { id: prior.id, existing: true };
    const checked = await preview(csv, store, db);
    if (!checked.valid) return { valid: false, errors: checked.errors };
    const id = crypto.randomUUID();
    const statements = [{ sql: 'INSERT INTO invitation_batches(id,import_key,name,created_at,created_by) VALUES (?,?,?,?,?)', args: [id,key,checked.batch,store.nowUTC(),actor], expect: 1 }];
    for (const row of checked.rows) {
      const reg = await db.get('SELECT * FROM registrations WHERE id=?', [row.registration_id]);
      if (!reg || store.decorate(reg).email.toLowerCase().trim() !== row.email.toLowerCase().trim()) throw new Error('Registration changed. Revalidate the batch.');
      statements.push({ sql: `INSERT INTO invitations(registration_id,code,status)
        SELECT id,?,'ISSUED' FROM registrations WHERE id=? AND partial=0 AND status='REGISTERED' AND email_hash=?`,
        args: [row.ticket_code,row.registration_id,reg.email_hash], expect: 1 });
      statements.push({ sql: `INSERT INTO invitation_batch_items(invitation_id,batch_id,ticket_type)
        SELECT id,?,? FROM invitations WHERE registration_id=? AND code=?`,
        args: [id,row.ticket_type,row.registration_id,row.ticket_code], expect: 1 });
    }
    try { await db.atomic(statements); }
    catch (e) {
      // A simultaneous retry may already have saved this exact import.
      const saved = await db.get('SELECT id FROM invitation_batches WHERE import_key=?', [key]);
      if (saved) return { id: saved.id, existing: true };
      throw e;
    }
    return { id, existing: false };
  }
  return { list, detail, save };
}
module.exports = { make };
