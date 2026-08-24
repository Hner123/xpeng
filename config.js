/* =============================================================
   XPENG DRIVING INTO A NEW DAY — campaign config
   Edited without a redeploy (Section 5 of the brief).
   Swap ARTIST.revealed = true at T-1 week to flip the hero
   silhouette module to the real artist names/photos.
   ============================================================= */
window.XPENG_CONFIG = {

  event: {
    name:      "XPENG DRIVING INTO A NEW DAY",
    subtitle:  "The Physical AI Open House",
    venue:     "MOA Arena",
    dateISO:   "2026-09-25T18:00:00+08:00",   // countdown target
    dateLabel: "September 25, 2026",
    doorsLabel:"Foyer opens 6:00 PM · Show 7:00 PM",
    forumLabel:"Physical AI Forum · 3:30 PM · live on @XPENGPhilippines"
  },

  /* Ticket status is hard-coded for the whole campaign. */
  status: {
    soldOutLabel: "TICKETS SOLD OUT",
    waitlistLabel:"WAITLIST OPEN"
  },

  /* Waitlist counter — admin on/off switch.
     The number ALWAYS comes from the live API (/api/waitlist/count).
     There is deliberately no hard-coded total here: a made-up count
     is a false public claim about the campaign. If the API can't be
     reached, the counter simply stays hidden.
     minToShow implements the brief's "display it once the number is
     impressive" — below this, it's hidden even though it's real. */
  counter: {
    show: true,
    minToShow: 500,
    label: "already on the waitlist"
  },

  /* Artist reveal module. */
  artist: {
    revealed: false,
    revealDateLabel: "SEPTEMBER 15, 2026",
    teaser: "Two of the country's biggest OPM stars take the stage, turning up the energy for the X9 reveal and capping off Driving Into A New Day with a full concert set.",
    acts: [
      // when revealed: { name: "", role: "", photo: "" }
    ]
  },

  /* Confirmation copy. Switch mode to "closed" after invitations
     close to serve the X Space priority message instead. */
  confirmation: {
    mode: "open",
    open: "Invitations go out <b>one week before the event</b>. If you're selected, we'll be in touch via email and SMS with your personal claim code for SM Tickets. Keep an eye on your inbox!",
    closed: "Invitations for Driving Into A New Day have closed — but your registration isn't wasted. You now have <b>priority access to X Space</b> pop-up events, workshops and test drives. We'll be in touch."
  },

  share: {
    text: "I joined the waitlist for XPENG's Driving Into A New Day — the Physical AI Open House at MOA Arena.",
    url:  "https://futurenight.xpeng.ph"
  },

  /* Where the API lives.
     base = "" when the page is served by the backend (local dev, or
     one-server production). Set it to the API origin when the page
     is hosted separately, e.g. on Netlify:
       base: "https://api.futurenight.xpeng.ph"
     That origin must also be listed in ALLOWED_ORIGINS on the
     server, or the browser will block the request. */
  api: {
    base:   "",
    submit: "/api/waitlist",
    count:  "/api/waitlist/count"
  },

  contact: {
    email:  "futurenight@xpeng.ph",
    privacy:"/privacy",
    terms:  "/terms",
    /* REQUIRED BEFORE GO-LIVE: the official XPENG Philippines
       account URLs. Anything that is not a real https:// link is
       skipped, and if none are set the follow row hides itself
       rather than showing dead buttons. Do not guess these —
       linking a campaign to an unofficial fan page is worse than
       showing no link at all. */
    socials: [
      { label: "Facebook",  href: "" },
      { label: "Instagram", href: "" },
      { label: "TikTok",    href: "" },
      { label: "YouTube",   href: "" },
      { label: "X",         href: "" }
    ]
  }
};
