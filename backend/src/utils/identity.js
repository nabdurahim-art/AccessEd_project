// Cleans the contact details a learner types at sign-up and login.

const USERNAME_RULE = /^[A-Za-z0-9_]{3,30}$/;
const EMAIL_RULE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// "Not given": missing, null, or only spaces.
const isBlank = (v) => v === undefined || v === null || (typeof v === 'string' && v.trim() === '');

// Turns what a person types into one standard form (+2507XXXXXXXX for
// Rwanda), so 0788123456 and +250 788 123 456 are the same person.
// Returns null when it cannot be a phone number.
function normalizePhone(raw) {
  if (typeof raw !== 'string') return null;
  let p = raw.replace(/[\s\-().]/g, '');
  if (/^07\d{8}$/.test(p)) p = '+250' + p.slice(1);
  else if (/^2507\d{8}$/.test(p)) p = '+' + p;
  else if (/^00/.test(p)) p = '+' + p.slice(2);
  return /^\+[1-9]\d{7,14}$/.test(p) ? p : null;
}

// Says which value is already taken, using the database constraint name.
function conflictMessage(constraint) {
  if (constraint === 'users_username_key') return 'That username is already taken.';
  if (constraint === 'users_email_key') return 'This email is already registered.';
  if (constraint === 'users_phone_number_key') return 'This phone number is already registered.';
  return 'Username, email, or phone number already exists.';
}

module.exports = { USERNAME_RULE, EMAIL_RULE, isBlank, normalizePhone, conflictMessage };
