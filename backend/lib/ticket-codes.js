'use strict';
const { parseCsv } = require('./batch-preview');
function make(db, store) {
  async function importCsv(csv, actor) {
    const rows = parseCsv(csv, ['ticket_code','ticket_type']);
    const seen = new Set(), statements = []; let existing = 0;
    for (const [index,row] of rows.entries()) {
      const code = row.ticket_code.toUpperCase(), type = row.ticket_type;
      if (!/^[A-Z0-9-]{4,32}$/.test(code) || !['VIP','General Public'].includes(type)) throw new Error('Invalid code or ticket type at row ' + (index+2));
      if (seen.has(code)) throw new Error('Duplicate code at row ' + (index+2));
      seen.add(code);
      const known = await db.get('SELECT ticket_type FROM ticket_codes WHERE ticket_code=?', [code]);
      if (known && known.ticket_type !== type) throw new Error('Ticket type conflicts with inventory at row ' + (index+2));
      const assigned = await db.get(`SELECT i.ticket_type FROM invitations v JOIN invitation_batch_items i ON i.invitation_id=v.id WHERE v.code=?`, [code]);
      if (assigned && assigned.ticket_type !== type) throw new Error('Ticket type conflicts with saved assignment at row ' + (index+2));
      if (known) { existing++; continue; }
      statements.push({sql:'INSERT INTO ticket_codes(ticket_code,ticket_type,imported_at,imported_by) VALUES (?,?,?,?)',args:[code,type,store.nowUTC(),actor],expect:1});
    }
    if (statements.length) await db.atomic(statements);
    return { imported: statements.length, existing, total: rows.length };
  }
  async function list(q = {}) {
    // Never assume a saved/reported invitation proves email delivery.
    const records = await db.all(`SELECT c.ticket_code,c.ticket_type,c.imported_at,v.registration_id,v.status AS invitation_status,
      v.sent_at,v.claimed_at,r.name_enc,b.name AS batch
      FROM ticket_codes c LEFT JOIN invitations v ON v.code=c.ticket_code
      LEFT JOIN registrations r ON r.id=v.registration_id
      LEFT JOIN invitation_batch_items i ON i.invitation_id=v.id
      LEFT JOIN invitation_batches b ON b.id=i.batch_id
      ORDER BY c.ticket_type,c.ticket_code`);
    const totals = {total:records.length,VIP:0,'General Public':0,AVAILABLE:0,RESERVED:0,SENT:0,CLAIMED:0,EXPIRED:0};
    const rows = records.map(r => {
      const status = !r.registration_id ? 'AVAILABLE' : r.claimed_at || r.invitation_status==='CLAIMED' ? 'CLAIMED' : r.invitation_status==='SENT' ? 'SENT' : r.invitation_status==='EXPIRED' ? 'EXPIRED' : 'RESERVED';
      totals[r.ticket_type]++; totals[status]++;
      return {ticket_code:r.ticket_code,ticket_type:r.ticket_type,status,registration_id:r.registration_id,
        name:r.name_enc ? store.decorate(r).name : '',batch:r.batch || '',sent_at:r.sent_at,claimed_at:r.claimed_at};
    });
    const search=String(q.search || '').trim().toLowerCase();
    const matching=rows.filter(r=>(!q.type || r.ticket_type===q.type)&&(!q.status || r.status===q.status)&&(!search || [r.ticket_code,r.name,r.batch,String(r.registration_id || '')].some(v=>v.toLowerCase().includes(search))));
    const limit=100,offset=Math.max(0,Number.parseInt(q.offset,10)||0);
    return {totals,total:matching.length,limit,offset,rows:matching.slice(offset,offset+limit)};
  }
  return { importCsv, list };
}
module.exports = {make};
