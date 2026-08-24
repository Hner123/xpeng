/* =============================================================
   Lead score (Section 7).

   Marketing owns these weights — they are plain data here so they
   can be tuned without touching logic. Intent weighs heaviest, as
   the brief specifies. Max is 100.

   The score is recomputed on every write, so editing the weights
   and re-running `node backend/rescore.js` updates the whole pool.
   ============================================================= */
'use strict';

const WEIGHTS = {
  intent: {                       // THE core question — heaviest
    'Within 3 months': 40,
    '3–6 months':      30,
    '6–12 months':     20,
    'Over a year':     8,
    'Just exploring':  4
  },
  budget: {
    '₱4M+':             25,
    '₱2.5–4M':          20,
    '₱1.5–2.5M':        14,
    'Under ₱1.5M':      6,
    'Prefer not to say': 8       // not a negative signal, just unknown
  },
  segment: {
    'Business Owner / Entrepreneur':           15,
    'Corporate Executive / Senior Management': 15,
    'Working Professional / Employee':         11,
    'Self-Employed / Freelancer':              12,
    'Government / Public Sector':              9,
    'OFW / OFW Dependent':                     11,
    'Student / Fresh Graduate':                3,
    'Other':                                   5
  },
  model_interest: {
    'XPENG X9 Flagship MPV':            10,
    'XPENG L03 Intelligent SUV':        9,
    'Upcoming / Future XPENG Models':   7,
    'The Full Vehicle Lineup':          8,
    'Curious About XPENG’s AI Technology': 3,
    'Just Exploring':                   2
  },
  ev_experience: {
    'Current EV Owner (Pure Electric)':   6,
    'Current Hybrid Owner (HEV / PHEV)':  7,
    'Have Driven or Test-Driven an EV':   8,   // warmest: tried one, hasn't bought
    'First Time Exploring EVs':           5,
    'Never Tried':                        4
  },
  age: {
    '18–24': 3, '25–34': 5, '35–44': 5, '45–54': 4, '55+': 3
  }
};


/* Conquest bonus: currently driving a rival brand is a stronger
   signal than no car at all. */
const NO_CAR = 'No car yet';

function scoreOf(row) {
  let total = 0;
  for (const field of Object.keys(WEIGHTS)) {
    const table = WEIGHTS[field];
    let value = row[field];
    /* "Other — plumbing contractor" scores as plain Other. */
    if (typeof value === 'string' && value.startsWith('Other — ')) value = 'Other';
    if (value && table[value] !== undefined) total += table[value];
  }
  if (row.drives && row.drives !== NO_CAR) total += 4;
  return Math.max(0, Math.min(100, total));
}

module.exports = { scoreOf, WEIGHTS };
