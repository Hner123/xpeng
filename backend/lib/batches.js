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
  async function create(name,actor){
    name=String(name || '').trim();
    if(!name || name.length>120)throw new Error('Enter a batch name (up to 120 characters).');
    const key=crypto.createHash('sha256').update('manual-batch:'+name.toLowerCase()).digest('hex');
    const prior=await db.get('SELECT id FROM invitation_batches WHERE import_key=?',[key]);
    if(prior)return {id:prior.id,existing:true};
    const id=crypto.randomUUID();
    await db.run('INSERT INTO invitation_batches(id,import_key,name,created_at,created_by) VALUES (?,?,?,?,?)',[id,key,name,store.nowUTC(),actor]);
    return {id};
  }
  async function candidates(search){
    const query=String(search || '').trim().toLowerCase();
    const rows=await db.all(`SELECT r.* FROM registrations r WHERE r.partial=0 AND r.status='REGISTERED'
      AND NOT EXISTS (SELECT 1 FROM invitations v WHERE v.registration_id=r.id) ORDER BY r.id DESC`);
    const matches=rows.map(r=>store.decorate(r)).filter(r=>r.email && (!query || [r.id,r.name,r.email].some(v=>String(v).toLowerCase().includes(query))));
    return {total:matches.length,rows:matches.slice(0,100).map(r=>({id:r.id,name:r.name,email:r.email}))};
  }
  async function add(id,ids,type){
    if(!await detail(id))throw new Error('Batch not found.');
    if(!Array.isArray(ids) || !ids.length || ids.length>100 || ids.some(n=>!Number.isSafeInteger(n) || n<1) || new Set(ids).size!==ids.length)throw new Error('Select 1 to 100 guests.');
    if(!['VIP','General Public'].includes(type))throw new Error('Select a ticket type.');
    const codes=await db.all(`SELECT c.ticket_code FROM ticket_codes c WHERE c.ticket_type=?
      AND NOT EXISTS (SELECT 1 FROM invitations v WHERE v.code=c.ticket_code) ORDER BY c.ticket_code LIMIT 100`,[type]);
    if(codes.length<ids.length)throw new Error('Not enough available codes for this ticket type.');
    const statements=[];
    for(const [index,regId] of ids.entries()){
      const reg=await db.get('SELECT * FROM registrations WHERE id=?',[regId]);
      if(!reg || !store.decorate(reg).email)throw new Error('A guest has no email. Refresh the list.');
      statements.push({sql:`INSERT INTO invitations(registration_id,code,status)
        SELECT id,?,'ISSUED' FROM registrations WHERE id=? AND partial=0 AND status='REGISTERED' AND email_hash=?`,args:[codes[index].ticket_code,regId,reg.email_hash],expect:1});
      statements.push({sql:`INSERT INTO invitation_batch_items(invitation_id,batch_id,ticket_type)
        SELECT id,?,? FROM invitations WHERE registration_id=? AND code=?`,args:[id,type,regId,codes[index].ticket_code],expect:1});
    }
    await db.atomic(statements);
    return {id,added:ids.length};
  }
  return { list, detail, save, create, candidates, add };
}
module.exports = { make };
