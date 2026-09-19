'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {open}=require('../lib/db');
test('inventory import, matching, filters and duplicate protection',async()=>{
  const db=open({DB_DRIVER:'sqlite',DB_FILE:':memory:'});
  try{
    await db.migrate();
    const vault=require('../lib/crypto').make('synthetic-inventory-test-key-000000000000');
    const store=require('../lib/store').make(db,vault);
    const service=require('../lib/ticket-codes').make(db,store);
    const csv='ticket_code,ticket_type\nVIP001,VIP\nGEN001,General Public';
    assert.equal((await service.importCsv(csv,'test')).imported,2);
    assert.equal((await service.importCsv(csv,'test')).existing,2);
    await assert.rejects(service.importCsv('ticket_code,ticket_type\nNEW001,VIP\nVIP001,General Public','test'));
    assert.equal((await service.list()).totals.total,2);
    await assert.rejects(service.importCsv('ticket_code,ticket_type\nDUP001,VIP\ndup001,VIP','test'));
    await db.run(`INSERT INTO registrations(id,created_at,updated_at,name_enc,mobile_enc,email_enc,mobile_hash,email_hash,province,city,partial) VALUES (1,?,?,?,?,?,?,?,?,?,0)`,['2026-09-19','2026-09-19',vault.encrypt('Synthetic Guest'),vault.encrypt('09000000000'),vault.encrypt('test@example.com'),'m','e','Metro','Manila']);
    const batchCsv='batch,registration_id,email,ticket_type,ticket_code\nTest,1,test@example.com,VIP,VIP001';
    const {preview}=require('../lib/batch-preview');
    assert.equal((await preview(batchCsv.replace('VIP001','UNLISTED'),store,db)).valid,false);
    assert.equal((await preview(batchCsv.replace(',VIP,',',General Public,'),store,db)).valid,false);
    await require('../lib/batches').make(db,store).save(batchCsv,'test');
    let res=await service.list({status:'RESERVED',search:'synthetic'});
    assert.equal(res.total,1);assert.equal(res.rows[0].batch,'Test');assert.equal(res.totals.AVAILABLE,1);
    assert.equal((await service.list({type:'General Public'})).total,1);
    await db.run("UPDATE invitations SET status='CLAIMED',claimed_at='2026-09-19' WHERE registration_id=1");
    assert.equal((await service.list()).totals.CLAIMED,1);
    const more='ticket_code,ticket_type\n'+Array.from({length:105},(_,i)=>'CODE'+String(i).padStart(4,'0')+',VIP').join('\n');
    await service.importCsv(more,'test');
    assert.equal((await service.list({search:'CODE',offset:'100'})).rows.length,5);
    assert.equal((await db.get('SELECT COUNT(*) AS n FROM comms_queue')).n,0);
  }finally{await db.close();}
});
