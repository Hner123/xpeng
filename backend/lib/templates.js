/* =============================================================
   Email and SMS copy for the five campaign messages.

   One module so wording lives in one place — marketing edits here,
   not in the worker. Every template returns { subject, text, html }
   for email, or { text } for SMS.

   Plain text is not optional: some Filipino carriers and older mail
   clients render it instead of the HTML, and a text part markedly
   improves deliverability.
   ============================================================= */
'use strict';

const EVENT = {
  name:  'XPENG Driving Into A New Day',
  sub:   'The Physical AI Open House',
  venue: 'MOA Arena',
  date:  'September 25, 2026',
  doors: '6:00 PM',
  forum: '3:30 PM'
};

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

/* One shell for every message: dark header, readable body, the legal
   footer. Inline styles only — Gmail strips <style> blocks. */
function shell({ preheader, heading, body, cta, siteUrl }) {
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>${esc(heading)}</title></head>
<body style="margin:0;padding:0;background:#140A05;">
<div style="display:none;font-size:1px;color:#140A05;max-height:0;overflow:hidden">${esc(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#140A05;padding:28px 12px">
 <tr><td align="center">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#1C0E06;border:1px solid rgba(255,196,150,.18);border-radius:14px">
   <tr><td style="padding:26px 26px 6px">
     <div style="font:700 13px/1 Arial,Helvetica,sans-serif;letter-spacing:.32em;color:#ffffff">XPENG</div>
     <div style="font:400 11px/1.4 Arial,Helvetica,sans-serif;letter-spacing:.18em;color:#FF9A3D;padding-top:8px">${esc(EVENT.sub.toUpperCase())}</div>
   </td></tr>
   <tr><td style="padding:14px 26px 0">
     <h1 style="margin:0;font:700 23px/1.25 Arial,Helvetica,sans-serif;color:#ffffff">${esc(heading)}</h1>
   </td></tr>
   <tr><td style="padding:12px 26px 4px;font:400 15px/1.65 Arial,Helvetica,sans-serif;color:rgba(255,255,255,.82)">
     ${body}
   </td></tr>
   ${cta ? `<tr><td style="padding:18px 26px 6px">
     <a href="${esc(cta.href)}" style="display:inline-block;background:#F47920;color:#180B00;text-decoration:none;font:700 14px/1 Arial,Helvetica,sans-serif;letter-spacing:.08em;padding:15px 24px;border-radius:9px">${esc(cta.label)}</a>
   </td></tr>` : ''}
   <tr><td style="padding:22px 26px 26px">
     <div style="border-top:1px solid rgba(255,196,150,.18);padding-top:16px;font:400 11.5px/1.6 Arial,Helvetica,sans-serif;color:rgba(255,255,255,.5)">
       ${esc(EVENT.venue)} &middot; ${esc(EVENT.date)} &middot; free, by invitation<br>
       Doors ${esc(EVENT.doors)} &middot; Physical AI Forum ${esc(EVENT.forum)}, livestreamed<br><br>
       You are receiving this because you joined the waitlist at
       <a href="${esc(siteUrl)}" style="color:#FF9A3D">${esc(siteUrl.replace(/^https?:\/\//, ''))}</a>.
       Nothing in this campaign is ever for sale — if anyone asks you to pay for entry, it is not us.<br>
       <a href="${esc(siteUrl)}/privacy" style="color:rgba(255,255,255,.5)">Data Privacy Notice</a> &nbsp;·&nbsp;
       <a href="${esc(siteUrl)}/terms" style="color:rgba(255,255,255,.5)">Terms</a>
     </div>
   </td></tr>
  </table>
 </td></tr>
</table>
</body></html>`;
}

function build(template, data = {}) {
  const site = (data.siteUrl || 'https://x-peng.netlify.app').replace(/\/$/, '');
  const name = (data.firstName || '').trim();
  const hi = name ? `Hi ${esc(name)},` : 'Hi,';
  const seq = data.sequence ? '#' + Number(data.sequence).toLocaleString('en-US') : null;

  switch (template) {

    case 'waitlist_confirmation':
      return {
        subject: `You're on the waitlist${seq ? ' — ' + seq : ''} · ${EVENT.name}`,
        text: `${name ? 'Hi ' + name + ',' : 'Hi,'}

You're on the waitlist for ${EVENT.name} — ${EVENT.sub} at ${EVENT.venue} on ${EVENT.date}.${seq ? `

Your waitlist number: ${seq}` : ''}

Invitations go out one week before the event. If you're selected, we'll be in touch by email and SMS with your personal claim code for SM Tickets. Keep an eye on your inbox.

Registration and attendance are free. Nothing in this campaign is for sale — if anyone asks you to pay for entry, it is not us.

${site}`,
        html: shell({
          preheader: `You're on the waitlist${seq ? ' — ' + seq : ''}. Invitations go out one week before the event.`,
          heading: "You're on the waitlist",
          siteUrl: site,
          body: `<p style="margin:0 0 12px">${hi}</p>
            <p style="margin:0 0 12px">You're on the waitlist for <b style="color:#fff">${esc(EVENT.name)}</b> at ${esc(EVENT.venue)} on ${esc(EVENT.date)}.</p>
            ${seq ? `<p style="margin:0 0 12px;font:700 30px/1 Arial,Helvetica,sans-serif;color:#FF9A3D">${esc(seq)}</p>` : ''}
            <p style="margin:0 0 12px">Invitations go out <b style="color:#fff">one week before the event</b>. If you're selected, we'll be in touch by email and SMS with your personal claim code for SM Tickets.</p>
            <p style="margin:0">Registration and attendance are free.</p>`
        })
      };

    case 'invitation':
      return {
        subject: `You're invited · ${EVENT.name} · claim within 72 hours`,
        text: `${name ? 'Hi ' + name + ',' : 'Hi,'}

You've been selected for ${EVENT.name} at ${EVENT.venue} on ${EVENT.date}.

Your claim code: ${data.code || ''}

Claim your free ticket on SM Tickets: ${data.claimUrl || site}
${data.expiresAt ? `
This code expires ${data.expiresAt} — 72 hours from now. After that the seat passes to the next guest on the waitlist.` : ''}

Your invitation is personal and cannot be transferred. Bring your claimed SM Ticket and one valid government-issued ID matching your registered name. Keep this message — the code is also your games pass in the foyer play zone.

${site}`,
        html: shell({
          preheader: `Your claim code is ${data.code || ''}. Claim within 72 hours.`,
          heading: "You're invited",
          siteUrl: site,
          cta: { label: 'CLAIM YOUR FREE TICKET', href: data.claimUrl || site },
          body: `<p style="margin:0 0 12px">${hi}</p>
            <p style="margin:0 0 14px">You've been selected for <b style="color:#fff">${esc(EVENT.name)}</b> at ${esc(EVENT.venue)} on ${esc(EVENT.date)}.</p>
            <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 14px"><tr><td style="background:rgba(255,196,150,.10);border:1px solid rgba(255,196,150,.3);border-radius:10px;padding:14px 18px">
              <div style="font:400 10.5px/1 Arial,Helvetica,sans-serif;letter-spacing:.2em;color:rgba(255,255,255,.6);padding-bottom:8px">YOUR CLAIM CODE</div>
              <div style="font:700 22px/1 'Courier New',monospace;letter-spacing:.08em;color:#fff">${esc(data.code || '')}</div>
            </td></tr></table>
            ${data.expiresAt ? `<p style="margin:0 0 12px">This code expires <b style="color:#fff">${esc(data.expiresAt)}</b> — 72 hours from now. After that the seat passes to the next guest.</p>` : ''}
            <p style="margin:0">Your invitation is personal and cannot be transferred. Bring your claimed SM Ticket and one valid government-issued ID matching your registered name. Keep this message: the code is also your games pass in the foyer play zone.</p>`
        })
      };

    case 'claim_reminder':
      return {
        subject: `24 hours left to claim your ticket · ${EVENT.name}`,
        text: `${name ? 'Hi ' + name + ',' : 'Hi,'}

Your invitation to ${EVENT.name} has not been claimed yet, and the code expires in about 24 hours.

Your claim code: ${data.code || ''}
Claim it here: ${data.claimUrl || site}

After it expires the seat passes to the next guest on the waitlist.`,
        html: shell({
          preheader: 'Your claim code expires in about 24 hours.',
          heading: '24 hours left to claim',
          siteUrl: site,
          cta: { label: 'CLAIM YOUR FREE TICKET', href: data.claimUrl || site },
          body: `<p style="margin:0 0 12px">${hi}</p>
            <p style="margin:0 0 14px">Your invitation to <b style="color:#fff">${esc(EVENT.name)}</b> has not been claimed yet, and the code expires in about <b style="color:#fff">24 hours</b>.</p>
            <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 14px"><tr><td style="background:rgba(255,196,150,.10);border:1px solid rgba(255,196,150,.3);border-radius:10px;padding:14px 18px">
              <div style="font:700 22px/1 'Courier New',monospace;letter-spacing:.08em;color:#fff">${esc(data.code || '')}</div>
            </td></tr></table>
            <p style="margin:0">After it expires the seat passes to the next guest on the waitlist.</p>`
        })
      };

    case 'event_reminder':
      return {
        subject: `Tomorrow night · ${EVENT.name} at ${EVENT.venue}`,
        text: `${name ? 'Hi ' + name + ',' : 'Hi,'}

${EVENT.name} is tomorrow at ${EVENT.venue}.

Doors ${EVENT.doors}. The Physical AI Forum is livestreamed at ${EVENT.forum}.

Bring: your claimed SM Ticket, and one valid government-issued ID matching your registered name. Keep your registration QR on your phone — it is your games pass in the foyer play zone.

Arrive early; traffic and entry queues around the SM Mall of Asia complex build up before a full house.`,
        html: shell({
          preheader: `Doors ${EVENT.doors}. Bring your SM Ticket and a valid ID.`,
          heading: 'Tomorrow night',
          siteUrl: site,
          body: `<p style="margin:0 0 12px">${hi}</p>
            <p style="margin:0 0 12px"><b style="color:#fff">${esc(EVENT.name)}</b> is tomorrow at ${esc(EVENT.venue)}. Doors ${esc(EVENT.doors)}, and the Physical AI Forum is livestreamed at ${esc(EVENT.forum)}.</p>
            <p style="margin:0 0 12px"><b style="color:#fff">Bring:</b> your claimed SM Ticket, and one valid government-issued ID matching your registered name. Keep your registration QR on your phone — it is your games pass in the foyer play zone.</p>
            <p style="margin:0">Arrive early; traffic and entry queues around the complex build up before a full house.</p>`
        })
      };

    case 'not_selected':
      return {
        subject: `Thank you for registering · ${EVENT.name}`,
        text: `${name ? 'Hi ' + name + ',' : 'Hi,'}

Invitations for ${EVENT.name} have now closed, and we were not able to invite everyone — demand was far beyond the seats available.

Your registration is not wasted. You now have priority access to upcoming XPENG experiences: X Space pop-up events, workshops and test drives. We'll be in touch.

${site}`,
        html: shell({
          preheader: 'Invitations have closed — your registration gives you priority access to what comes next.',
          heading: 'Thank you for registering',
          siteUrl: site,
          body: `<p style="margin:0 0 12px">${hi}</p>
            <p style="margin:0 0 12px">Invitations for <b style="color:#fff">${esc(EVENT.name)}</b> have now closed, and we were not able to invite everyone — demand was far beyond the seats available.</p>
            <p style="margin:0">Your registration is not wasted. You now have <b style="color:#fff">priority access</b> to upcoming XPENG experiences: X Space pop-up events, workshops and test drives. We'll be in touch.</p>`
        })
      };

    default:
      return null;
  }
}

/* SMS is metered per segment, so these stay inside 160 GSM-7
   characters wherever possible. */
function sms(template, data = {}) {
  const site = (data.siteUrl || 'x-peng.netlify.app').replace(/^https?:\/\//, '');
  switch (template) {
    case 'waitlist_confirmation':
      return { text: `XPENG: You're on the waitlist for Driving Into A New Day${data.sequence ? ' (#' + data.sequence + ')' : ''}. Invitations go out 1 week before Sept 25. Watch your inbox. Free, never for sale.` };
    case 'invitation':
      return { text: `XPENG: You're invited to Driving Into A New Day, Sept 25 at MOA Arena. Claim code ${data.code || ''} - claim free on SM Tickets within 72hrs: ${data.claimUrl || site}` };
    case 'claim_reminder':
      return { text: `XPENG: 24hrs left to claim your free ticket. Code ${data.code || ''}. ${data.claimUrl || site}` };
    case 'event_reminder':
      return { text: `XPENG: Tomorrow at MOA Arena. Doors 6PM. Bring your SM Ticket + valid ID matching your name. Keep your registration QR for the play zone.` };
    case 'not_selected':
      return { text: `XPENG: Invitations for Sept 25 have closed. Your registration gives you priority access to X Space events and test drives. Thank you.` };
    default:
      return null;
  }
}

module.exports = { build, sms, EVENT };
