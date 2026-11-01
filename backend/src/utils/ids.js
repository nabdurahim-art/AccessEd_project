// Helpers for checking that an ID is a safe whole number.

const MAX_ID = 2147483647; // largest value a PostgreSQL integer column holds

// Turns "12" into 12. Returns null for anything that is not a whole number
// in range, such as "abc", "12abc", "-1" or "99999999999".
function toId(value) {
  if (!/^\d+$/.test(String(value))) return null;
  const n = Number(value);
  return n >= 1 && n <= MAX_ID ? n : null;
}

// Same check for a value that should already be a number (from a JSON body).
function isId(value) {
  return Number.isInteger(value) && value >= 1 && value <= MAX_ID;
}

module.exports = { MAX_ID, toId, isId };
