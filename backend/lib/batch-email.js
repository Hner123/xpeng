'use strict';
const crypto = require('node:crypto');
const templates = require('./templates');
const emailOK = value => typeof value === 'string' && /^[^\s<>@,;]+@[^\s<>@,;]+\.[^\s<>@,;]+$/.test(value) && !/[\r\n]/.test(value);
function make(db,store,vault,mailer,{dryRun=true,siteUrl}={}) {
  const ready=()=>mailer.enabled && !dryRun;
  function requireLive(){if(!ready())throw new Error('Live email is not enabled. Configure SMTP and disable COMMS_DRY_RUN first.');}
  async function records(id){
    return db.all(`SELECT r.*,v.id AS invitation_id,v.code,v.status AS invitation_status,i.ticket_type,e.status AS email_status
      FROM invitation_batch_items i JOIN invitations v ON v.id=i.invitation_id
      JOIN registrations r ON r.id=v.registration_id LEFT JOIN batch_emails e ON e.invitation_id=v.id
      WHERE i.batch_id=? ORDER BY r.id`,[id]);
  }
  function render(r, test=false){
    const guest=store.decorate(r);
    return templates.build('batch_invitation',{firstName:guest.first_name || guest.name,name:guest.name,
      code:test?'TEST-NOT-VALID':r.code,ticketType:r.ticket_type,siteUrl});
  }
  function fingerprint(rows){return crypto.createHash('sha256').update(JSON.stringify({from:mailer.from,replyTo:mailer.replyTo,
    rows:rows.map(r=>[r.id,store.decorate(r).email,render(r)])})).digest('hex');}
  async function state(id,actor){
    const rows=await records(id),counts={UNSENT:0,PENDING:0,SENDING:0,SENT:0,FAILED:0,REVIEW:0};
    rows.forEach(r=>counts[r.email_status || 'UNSENT']++);
    const approved=await db.get("SELECT id FROM batch_email_tests WHERE batch_id=? AND fingerprint=? AND actor=? AND status='SENT'",[id,fingerprint(rows),actor]);
    const errors=await db.all(`SELECT v.registration_id,e.status,e.error FROM batch_emails e JOIN invitations v ON v.id=e.invitation_id
      WHERE e.batch_id=? AND e.status IN ('FAILED','REVIEW','SENDING') ORDER BY v.registration_id`,[id]);
    return {ready:ready(),from:mailer.from,replyTo:mailer.replyTo,counts,tested:!!approved,errors,
      rows:rows.map(r=>({registration_id:r.id,name:store.decorate(r).name,status:r.email_status || 'UNSENT'}))};
  }
  async function test(id,to,actor){
    requireLive();if(!emailOK(to))throw new Error('Enter one valid test email address.');
    const rows=await records(id);if(!rows.length)throw new Error('Batch has no recipients.');
    const verified=await mailer.verify();if(!verified.ok)throw new Error('Email connection check failed. Check SMTP settings.');
    const key=crypto.randomUUID(),stamp=store.nowUTC();
    await db.run('INSERT INTO batch_email_tests(id,batch_id,fingerprint,actor,recipient_enc,status,created_at) VALUES (?,?,?,?,?,?,?)',
      [key,id,fingerprint(rows),actor,vault.encrypt(to),'SENDING',stamp]);
    try {
      const mail=render(rows[0],true);mail.subject='[TEST - NOT A TICKET] '+mail.subject;
      const result=await mailer.send({to,...mail});
      if(!result.accepted || !result.accepted.length)throw new Error('Test was not accepted by the email provider.');
      await db.run("UPDATE batch_email_tests SET status='SENT' WHERE id=?",[key]);
      return {message:'Test accepted by email provider. Check the inbox and review it before sending the batch.'};
    } catch(e){await db.run("UPDATE batch_email_tests SET status='FAILED' WHERE id=?",[key]);throw new Error('Test email could not be confirmed. Check the inbox and SMTP configuration before trying again.');}
  }
  async function queue(id,actor,reviewed){
    requireLive();if(reviewed!==true)throw new Error('Review the test email before sending.');
    const rows=await records(id);if(!rows.length)throw new Error('Batch has no recipients.');
    const verified=await db.get("SELECT id FROM batch_email_tests WHERE batch_id=? AND fingerprint=? AND actor=? AND status='SENT'",[id,fingerprint(rows),actor]);
    if(!verified)throw new Error('Send and review a test for the current batch and sender settings first.');
    const statements=[],now=store.nowUTC();
    for(const r of rows){
      if(r.email_status)continue;
      const guest=store.decorate(r);
      if(r.invitation_status!=='ISSUED' || r.status!=='REGISTERED' || r.partial || !emailOK(guest.email))throw new Error('A recipient is no longer eligible. Review the batch before sending.');
      statements.push({sql:`INSERT INTO batch_emails(id,batch_id,invitation_id,recipient_enc,content_enc,status,created_at,updated_at,actor)
        SELECT ?,?,?,?,?, 'PENDING',?,?,? FROM invitations v JOIN registrations r ON r.id=v.registration_id
        WHERE v.id=? AND v.status='ISSUED' AND r.status='REGISTERED' AND r.partial=0 AND r.email_enc=?`,
        args:[crypto.randomUUID(),id,r.invitation_id,vault.encrypt(guest.email),vault.encrypt(JSON.stringify(render(r))),now,now,actor,r.invitation_id,r.email_enc],expect:1});
    }
    if(statements.length)await db.atomic(statements);
    return {queued:statements.length};
  }
  async function retry(id,actor){
    requireLive();
    // Unknown delivery outcomes are deliberately never retried automatically.
    const result=await db.run("UPDATE batch_emails SET status='PENDING',error=NULL,updated_at=?,actor=? WHERE batch_id=? AND status='FAILED'",[store.nowUTC(),actor,id]);
    return {queued:result.changes};
  }
  async function processOne(){
    if(!ready())return false;
    const r=await db.get("SELECT * FROM batch_emails WHERE status='PENDING' ORDER BY created_at,id LIMIT 1");
    if(!r)return false;
    const claimed=await db.run("UPDATE batch_emails SET status='SENDING',attempts=attempts+1,updated_at=? WHERE id=? AND status='PENDING'",[store.nowUTC(),r.id]);
    if(!claimed.changes)return false;
    const inv=await db.get('SELECT v.*,r.email_enc,r.status AS registration_status FROM invitations v JOIN registrations r ON r.id=v.registration_id WHERE v.id=?',[r.invitation_id]);
    const to=vault.decrypt(r.recipient_enc);
    if(!inv || inv.status!=='ISSUED' || inv.registration_status!=='REGISTERED' || vault.decrypt(inv.email_enc)!==to){
      await db.run("UPDATE batch_emails SET status='REVIEW',error=? WHERE id=?",['Recipient or invitation changed; nothing sent.',r.id]);return true;
    }
    let result;
    try {
      const mail=JSON.parse(vault.decrypt(r.content_enc));
      result=await mailer.send({to,...mail});
      if(!result.accepted || !result.accepted.length){const e=new Error('Recipient rejected');e.responseCode=550;throw e;}
    }catch(e){
      const rejected=Number(e.responseCode)>=400 && Number(e.responseCode)<600;
      await db.run('UPDATE batch_emails SET status=?,error=?,updated_at=? WHERE id=?',[rejected?'FAILED':'REVIEW',
        rejected?'SMTP rejected the message. Check the recipient or provider before retrying.':'Delivery outcome is uncertain. Check the provider before resending.',store.nowUTC(),r.id]);
      return true;
    }
    // If recording provider acceptance fails, leave SENDING for manual review.
    // Replaying it could deliver the same ticket twice.
    const now=store.nowUTC();
    await db.atomic([
      {sql:"UPDATE batch_emails SET status='SENT',sent_at=?,updated_at=?,message_id=?,error=NULL WHERE id=? AND status='SENDING'",args:[now,now,result.messageId || '',r.id],expect:1},
      {sql:"UPDATE invitations SET status='SENT',sent_at=? WHERE id=? AND status='ISSUED'",args:[now,r.invitation_id],expect:1},
      {sql:"UPDATE registrations SET status='INVITED',updated_at=? WHERE id=? AND status='REGISTERED'",args:[now,inv.registration_id],expect:1}
    ]);
    return true;
  }
  let busy=false;
  function start(){
    const timer=setInterval(async()=>{if(busy)return;busy=true;try{for(let i=0;i<10;i++){if(!await processOne())break;}}catch(e){console.error('[batch-email] Worker needs review:',e.code || 'delivery_state_error');}finally{busy=false;}},10000);
    timer.unref();return timer;
  }
  return {state,test,queue,retry,processOne,start};
}
module.exports={make};
