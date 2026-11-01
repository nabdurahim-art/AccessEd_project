// Checks every item a phone sends when it syncs.
//
// Each function returns { valid: false, reason } to reject an item, or
// { valid: true, ... } with the cleaned values the controller should save.
// A rejected item never stops the others: the controller reports it back so
// the phone knows what to resend and what it can safely delete.

const MAX_ID = 2147483647;

// The phone makes these ids itself, so they must be real UUIDs. A bad one
// would make PostgreSQL throw and cancel the whole batch.
const UUID_RULE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Same rule as the keys in manifest.json.
const KEY_RULE = /^[A-Za-z0-9_-]{1,50}$/;

// Dates must look like 2026-10-31T09:30:00.000Z, which is what a JavaScript
// app sends with toISOString().
const ISO_RULE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

function isPositiveId(value) {
  return Number.isInteger(value) && value >= 1 && value <= MAX_ID;
}

// Returns the time as an ISO string, never later than now. A phone whose
// clock is set to the future would otherwise win "newest wins" for ever and
// block every later real update. Returns null if the text is not a valid date.
function cleanTime(value) {
  if (typeof value !== 'string' || !ISO_RULE.test(value)) return null;
  const ms = Date.parse(value);
  if (Number.isNaN(ms)) return null;
  return new Date(Math.min(ms, Date.now())).toISOString();
}

// Checks that the item has a valid id, pack and module key.
// Returns a reason text if something is wrong, or null if all is well.
function checkWhere(item, idName) {
  if (typeof item[idName] !== 'string' || !UUID_RULE.test(item[idName])) {
    return `Invalid or missing ${idName}. It must be a UUID.`;
  }
  if (!isPositiveId(item.pack_id)) {
    return 'Invalid or missing pack_id.';
  }
  if (typeof item.module_key !== 'string' || !KEY_RULE.test(item.module_key)) {
    return 'Invalid or missing module_key.';
  }
  return null;
}

// userId is not needed here, but the controller already passes it, so the
// call stays the same.
const validateProgressItem = async (client, userId, item) => {
  if (!item || typeof item !== 'object') {
    return { valid: false, reason: 'Item must be an object.' };
  }

  const problem = checkWhere(item, 'progress_id');
  if (problem) return { valid: false, reason: problem };

  const { pack_id, module_key, status } = item;
  let { percent_complete } = item;

  if (!Number.isInteger(percent_complete) || percent_complete < 0 || percent_complete > 100) {
    return { valid: false, reason: 'percent_complete must be a whole number from 0 to 100.' };
  }
  // A module the learner has not started has nothing to sync.
  if (!['in_progress', 'completed'].includes(status)) {
    return { valid: false, reason: 'status must be in_progress or completed.' };
  }
  // A finished module is always 100 percent.
  if (status === 'completed') percent_complete = 100;

  const updated_at = cleanTime(item.updated_at);
  if (!updated_at) {
    return { valid: false, reason: 'updated_at must be an ISO date such as 2026-10-31T09:30:00Z.' };
  }

  // Modules belong to a pack. The key is only unique inside its own pack,
  // so we must look it up with the pack_id the phone sent.
  const modRes = await client.query(
    `SELECT module_id FROM modules WHERE pack_id = $1 AND module_key = $2`,
    [pack_id, module_key]
  );
  if (modRes.rows.length === 0) {
    return { valid: false, reason: 'Module key not found for the given pack.' };
  }

  return {
    valid: true,
    module_id: modRes.rows[0].module_id,
    status,
    percent_complete,
    updated_at
  };
};

const validateQuizAttemptItem = async (client, userId, item) => {
  if (!item || typeof item !== 'object') {
    return { valid: false, reason: 'Item must be an object.' };
  }

  const problem = checkWhere(item, 'attempt_id');
  if (problem) return { valid: false, reason: problem };

  const { pack_id, module_key, score } = item;

  if (!Number.isInteger(score) || score < 0 || score > 100) {
    return { valid: false, reason: 'score must be a whole number from 0 to 100.' };
  }

  // The phone may send "passed", but we ignore it. The server works it out
  // from the score and the quiz's pass mark, so it cannot be faked.

  const attempted_at = cleanTime(item.attempted_at);
  if (!attempted_at) {
    return { valid: false, reason: 'attempted_at must be an ISO date such as 2026-10-31T09:30:00Z.' };
  }

  const quizRes = await client.query(
    `SELECT q.quiz_id, q.pass_mark
     FROM quizzes q
     JOIN modules m ON m.module_id = q.module_id
     WHERE m.pack_id = $1 AND m.module_key = $2`,
    [pack_id, module_key]
  );
  if (quizRes.rows.length === 0) {
    return { valid: false, reason: 'Quiz not found for the given module and pack.' };
  }

  return {
    valid: true,
    quiz_id: quizRes.rows[0].quiz_id,
    pass_mark: quizRes.rows[0].pass_mark,
    score,
    attempted_at
  };
};

module.exports = { validateProgressItem, validateQuizAttemptItem };
