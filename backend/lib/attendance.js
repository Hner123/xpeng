'use strict';
const crypto=require('node:crypto');
function make(db,vault){
  const signature=r=>vault.lookup('attendance-v1:'+r.invitation_id+':'+r.code);
  function link(r,siteUrl,test=false){
    const site=require('./public-site').publicSite(siteUrl);
    return site+'/confirm.html#'+(test || !r.invitation_id ? 'preview' : r.invitation_id+'.'+signature(r));
  }
  async function confirm(token){
    const invalid={ok:false,error:'This confirmation link is unavailable. Please contact the XPENG Events Team.'};
    if(typeof token!=='string' || !/^\d{1,20}\.[a-f0-9]{64}$/.test(token))return invalid;
    const [id,sig]=token.split('.');
    const r=await db.get(`SELECT v.id AS invitation_id,v.code,v.status FROM invitations v
      JOIN invitation_batch_items i ON i.invitation_id=v.id
      JOIN batch_emails e ON e.invitation_id=v.id
      WHERE v.id=? AND e.status='SENT'`,[id]);
    if(!r || !['SENT','CLAIMED'].includes(r.status) || !crypto.timingSafeEqual(Buffer.from(sig,'hex'),Buffer.from(signature(r),'hex')))return invalid;
    const now=new Date().toISOString().slice(0,19).replace('T',' ');
    try{
      await db.run(`INSERT INTO attendance_confirmations(invitation_id,confirmed_at)
        SELECT id,? FROM invitations WHERE id=? AND status IN ('SENT','CLAIMED')
        AND NOT EXISTS (SELECT 1 FROM attendance_confirmations WHERE invitation_id=?)`,[now,id,id]);
    }catch(e){
      // Concurrent confirmation taps may reach the unique primary key together.
      if(!await db.get('SELECT confirmed_at FROM attendance_confirmations WHERE invitation_id=?',[id]))throw e;
    }
    const saved=await db.get('SELECT confirmed_at FROM attendance_confirmations WHERE invitation_id=?',[id]);
    return saved?{ok:true,confirmed_at:saved.confirmed_at}:invalid;
  }
  return {link,confirm};
}
module.exports={make};
