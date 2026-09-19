'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { open } = require('../lib/db');
const { make: makeVault } = require('../lib/crypto');
const { make: makeStore } = require('../lib/store');
const { make: makeBatches } = require('../lib/batches');

test('saved batches persist, reserve codes, retry safely and never send', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xpeng-batches-test-'));
  const env = { DB_DRIVER: 'sqlite', DB_FILE: path.join(dir, 'test.db') };
  let db = open(env);
  try {
    await db.migrate();
    const vault = makeVault('synthetic-batch-test-key-000000000000');
    let store = makeStore(db, vault), batches = makeBatches(db, store);
    for (let id = 1; id <= 4; id++) {
      await db.run(`INSERT INTO registrations(id,created_at,updated_at,name_enc,first_name_enc,
        mobile_enc,email_enc,mobile_hash,email_hash,province,city,partial)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,0)`, [id,'2026-09-19','2026-09-19',vault.encrypt('Test Guest '+id),vault.encrypt('Test'),
        vault.encrypt('09000000000'),vault.encrypt('test'+id+'@example.com'),'m'+id,'e'+id,'Metro','Manila']);
    }
    const head = 'batch,registration_id,email,ticket_type,ticket_code\r\n';
    const csv = head + 'Batch 1,1,test1@example.com,VIP,VIP001\r\nBatch 1,2,test2@example.com,VIP,VIP002';
    const saved = await batches.save(csv, 'test-admin');
    assert.ok(saved.id); assert.equal(saved.existing, false);
    assert.equal((await batches.save(csv, 'test-admin')).id, saved.id);
    assert.equal((await batches.list()).length, 1);
    assert.equal((await batches.detail(saved.id)).rows.length, 2);
    assert.equal((await batches.detail(saved.id)).rows[0].invitation_status, 'ISSUED');
    assert.equal((await batches.save(head+'Other,3,test3@example.com,VIP,VIP001', 'test-admin')).valid, false);
    assert.equal((await batches.save(head+'Other,1,test1@example.com,VIP,NEW001', 'test-admin')).valid, false);
    const legacy = await store.invite([1,2]); assert.equal(legacy.skipped, 2);
    assert.equal((await db.get('SELECT COUNT(*) AS n FROM comms_queue')).n, 0);
    assert.equal((await db.get("SELECT COUNT(*) AS n FROM registrations WHERE status='REGISTERED'")).n, 4);
    await db.close(); db = open(env); store = makeStore(db,vault); batches=makeBatches(db,store);
    assert.equal((await batches.detail(saved.id)).rows[1].ticket_code, 'VIP002');
    assert.match((await batches.detail(saved.id)).rows[0].message, /3:30 PM/);
    // Simulate a uniqueness conflict after the save's preflight checks.
    const original = db.atomic.bind(db);
    db.atomic = async statements => {
      await db.run("INSERT INTO invitations(registration_id,code,status) VALUES (4,'RACE004','ISSUED')");
      return original(statements);
    };
    await assert.rejects(batches.save(head+'Racing,3,test3@example.com,VIP,RACE003\nRacing,4,test4@example.com,VIP,RACE004', 'test-admin'));
    assert.equal((await batches.list()).length, 1);
    assert.equal(await db.get('SELECT id FROM invitations WHERE registration_id=3'), null);
    assert.equal((await db.get('SELECT COUNT(*) AS n FROM invitation_batch_items')).n, 2);
    db.atomic = original;
    // An anonymised/deleted registration must not leave a plaintext snapshot.
    await store.deleteRegistrations([1], 'test-admin');
    assert.equal((await batches.detail(saved.id)).rows.length, 1);
  } finally { await db.close(); fs.rmSync(dir, {recursive:true,force:true}); }
});
