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
    'Business owner':          15,
    'Professional / employee': 11,
    'Government':              9,
    'OFW / OFW family':        11,
    'Student':                 3,
    'Other':                   5
  },
  model_interest: {
    'X9 luxury MPV':           10,
    'L03 SUV':                 8,
    'The full line-up':        8,
    'Just curious about the AI': 3
  },
  ev_experience: {
    'Own an EV':        6,
    'Have test-driven': 8,       // warmest: tried one, hasn't bought yet
    'Never tried':      4
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
    const value = row[field];
    if (value && table[value] !== undefined) total += table[value];
  }
  if (row.drives && row.drives !== NO_CAR) total += 4;
  return Math.max(0, Math.min(100, total));
}

module.exports = { scoreOf, WEIGHTS };
