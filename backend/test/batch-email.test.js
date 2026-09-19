'use strict';
const {test}=require('node:test'),a=require('node:assert/strict');
const {open}=require('../lib/db');
test('batch email approval, queue uniqueness, delivery states and retry safety',async()=>{
 const db=open({DB_DRIVER:'sqlite',DB_FILE:':memory:'});
 try{
  await db.migrate();
  const vault=require('../lib/crypto').make('batch-email-test-key-0000000000000000');
  const store=require('../lib/store').make(db,vault),batches=require('../lib/batches').make(db,store);
  for(let id=1;id<=3;id++)await db.run(`INSERT INTO registrations(id,created_at,updated_at,name_enc,first_name_enc,mobile_enc,email_enc,mobile_hash,email_hash,province,city,partial)
   VALUES (?,?,?,?,?,?,?,?,?,?,?,0)`,[id,'2026-09-19','2026-09-19',vault.encrypt('Test Guest '+id),vault.encrypt('Test'),vault.encrypt('09000000000'),vault.encrypt('test'+id+'@example.com'),'m'+id,'e'+id,'Metro','Manila']);
  const csv='batch,registration_id,email,ticket_type,ticket_code\n'+[1,2,3].map(i=>`Email batch,${i},test${i}@example.com,VIP,VIP000${i}`).join('\n');
  const {id}=await batches.save(csv,'admin');
  let calls=[],failure=null;
  const mailer={enabled:true,from:{name:'Events',address:'events@example.com'},replyTo:'reply@example.com',verify:async()=>({ok:true}),send:async(mail)=>{calls.push(mail);if(failure)throw failure;return {accepted:[mail.to],messageId:'test-id'};}};
  const service=require('../lib/batch-email').make(db,store,vault,mailer,{dryRun:false,siteUrl:'https://x-peng.netlify.app'});
  const dry=require('../lib/batch-email').make(db,store,vault,mailer,{dryRun:true});
  await a.rejects(dry.test(id,'team@example.com','admin'));await a.rejects(dry.queue(id,'admin',true));a.equal(await dry.processOne(),false);a.equal(calls.length,0);
  await a.rejects(service.queue(id,'admin',true));
  await a.rejects(service.test(id,'bad@example.com,other@example.com','admin'));
  await service.test(id,'team@example.com','admin');a.match(calls[0].text,/TEST-NOT-VALID/);a.ok(!calls[0].text.includes('VIP0001'));a.match(calls[0].html,/SM Tickets outlet/);
  await a.rejects(service.queue(id,'admin',false));await a.rejects(service.queue(id,'other-admin',true));
  mailer.replyTo='changed@example.com';await a.rejects(service.queue(id,'admin',true));mailer.replyTo='reply@example.com';
  a.equal((await service.queue(id,'admin',true)).queued,3);a.equal((await service.queue(id,'admin',true)).queued,0);
  a.equal((await db.get('SELECT COUNT(*) AS n FROM comms_queue')).n,0);
  a.equal((await service.state(id,'admin')).counts.PENDING,3);
  await service.processOne();a.equal((await service.state(id,'admin')).counts.SENT,1);
  a.match(calls[1].text,/VIP000[123]/);a.ok(!calls[1].text.includes('72 hours'));
  failure=Object.assign(new Error('Rejected'),{responseCode:550});await service.processOne();a.equal((await service.state(id,'admin')).counts.FAILED,1);
  failure=new Error('socket timeout');await service.processOne();a.equal((await service.state(id,'admin')).counts.REVIEW,1);
  a.equal((await service.retry(id,'admin')).queued,1);failure=null;await service.processOne();a.equal((await service.state(id,'admin')).counts.SENT,2);
  a.equal((await service.state(id,'admin')).counts.REVIEW,1);a.equal(await service.processOne(),false);
  a.equal((await store.invite([1,2,3],72,true)).skipped,3);
  a.equal((await db.get('SELECT COUNT(*) AS n FROM comms_queue')).n,0);
  a.equal((await db.get("SELECT COUNT(*) AS n FROM registrations WHERE status='INVITED'")).n,2);
  a.equal((await db.get('SELECT COUNT(*) AS n FROM invitations WHERE expires_at IS NOT NULL')).n,0);
 }finally{await db.close();}
});
