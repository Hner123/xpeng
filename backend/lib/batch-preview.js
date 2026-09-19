'use strict';

// RFC-style quoted CSV fields, including embedded commas and newlines.
function parseCsv(text) {
  if (typeof text !== 'string' || text.length > 2 * 1024 * 1024) throw new Error('Choose a CSV file smaller than 2 MB.');
  text = text.replace(/^\uFEFF/, '');
  const rows = []; let row = [], field = '', quoted = false, closed = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else { quoted = false; closed = true; } }
      else field += c;
    } else if (c === ',' || c === '\n' || c === '\r') {
      row.push(field); field = ''; closed = false;
      if (c !== ',') { if (row.some(x => x.trim())) rows.push(row); row = []; if (c === '\r' && text[i + 1] === '\n') i++; }
    } else if (c === '"' && !field && !closed) quoted = true;
    else { if (closed || c === '"') throw new Error('Invalid CSV quoting.'); field += c; }
  }
  if (quoted) throw new Error('Unclosed quote in CSV.');
  row.push(field); if (row.some(x => x.trim())) rows.push(row);
  const headers = (rows.shift() || []).map(x => x.trim());
  for (const h of ['batch', 'registration_id', 'email', 'ticket_type', 'ticket_code']) if (!headers.includes(h)) throw new Error('Missing column: ' + h);
  if (new Set(headers).size !== headers.length) throw new Error('Duplicate column names.');
  if (!rows.length || rows.length > 2500) throw new Error('Import between 1 and 2,500 recipients.');
  return rows.map((r, i) => { if (r.length !== headers.length) throw new Error('Column count mismatch at row ' + (i + 2)); return Object.fromEntries(headers.map((h, n) => [h, r[n].trim()])); });
}

async function preview(csv, store, db) {
  const input = parseCsv(csv), ids = new Set(), codes = new Set(), errors = [], rows = [];
  const batches = new Set(input.map(r => r.batch));
  if (batches.size !== 1 || !input[0].batch || input[0].batch.length > 120) throw new Error('Use one batch name of up to 120 characters.');
  for (const [i, r] of input.entries()) {
    const issues = [], id = Number(r.registration_id), code = r.ticket_code.toUpperCase();
    if (!/^\d+$/.test(r.registration_id) || !Number.isSafeInteger(id) || id < 1) issues.push('Invalid registration ID');
    if (ids.has(id)) issues.push('Duplicate recipient'); ids.add(id);
    if (!/^[A-Z0-9-]{4,32}$/.test(code)) issues.push('Invalid ticket code');
    if (codes.has(code)) issues.push('Duplicate ticket code'); codes.add(code);
    if (!['VIP', 'General Public'].includes(r.ticket_type)) issues.push('Invalid ticket type');
    const reg = Number.isSafeInteger(id) ? await db.get('SELECT * FROM registrations WHERE id=?', [id]) : null;
    let guest;
    if (!reg) issues.push('Registration not found');
    else {
      guest = store.decorate(reg);
      if (!guest.complete) issues.push('Registration is incomplete');
      if (!guest.email || guest.email.trim().toLowerCase() !== r.email.toLowerCase()) issues.push('Email does not match registration');
      if (reg.status !== 'REGISTERED') issues.push('Guest is already invited or has another status');
    }
    const used = await db.get('SELECT id FROM invitations WHERE registration_id=? OR code=?', [Number.isSafeInteger(id) ? id : 0, code]);
    if (used) issues.push('Recipient or code already has an invitation');
    if (issues.length) errors.push({ row: i + 2, registration_id: r.registration_id, issues });
    else rows.push({ registration_id: id, name: guest.name, email: guest.email, ticket_type: r.ticket_type, ticket_code: code,
      subject: "You're invited! Your XPENG " + r.ticket_type + ' invitation',
      message: `Hi ${guest.first_name || guest.name},\n\nYou're invited as a ${r.ticket_type} guest to XPENG Driving Into A New Day at MOA Arena on September 25, 2026!\n\nYour unique ticket claim code: ${code}\n\nPlease visit an SM Tickets outlet at an SM mall and present your code to claim your complimentary ticket.\n\n${r.ticket_type === 'VIP' ? 'VIP gates open: 3:30 PM' : 'General guest gates open: 5:00 PM'}\nShow starts: 6:00 PM\nAttire: Smart casual - futuristic looks welcome.\n\nPlease reply to this email with CONFIRM to confirm your attendance. You will still need to claim your ticket before the event and bring it together with a valid government-issued ID.\n\nYour invitation and ticket code are personal and non-transferable.\n\nWe look forward to seeing you!\nThe XPENG Events Team` });
  }
  return { batch: input[0].batch, total: input.length, valid: !errors.length, errors, rows: errors.length ? [] : rows };
}
module.exports = { parseCsv, preview };
