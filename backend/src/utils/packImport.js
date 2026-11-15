// Saves a pack's lessons and quizzes in the database.
//
// Call this inside a transaction, with the client that saved the pack row, so
// the pack and its lessons are saved together or not at all.

/**
 * client   a database client inside a transaction
 * packId   the pack the lessons belong to
 * modules  the cleaned lessons from validateManifest
 *
 * Lessons are matched by their key, so publishing a pack again updates the
 * lessons that are already there and keeps their IDs. That matters because
 * learners' progress points at those IDs.
 *
 * A lesson that is in the database but no longer in the manifest is NOT
 * deleted: deleting it would also delete every learner's progress on it. It
 * is listed in the result so an admin can decide.
 */
async function saveModules(client, packId, modules) {
  let quizzes = 0;

  for (const m of modules) {
    const saved = await client.query(
      `INSERT INTO modules (pack_id, module_key, title, duration_min, audio_path, sort_order)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (pack_id, module_key) DO UPDATE SET
         title = EXCLUDED.title,
         duration_min = EXCLUDED.duration_min,
         audio_path = EXCLUDED.audio_path,
         sort_order = EXCLUDED.sort_order
       RETURNING module_id`,
      [packId, m.key, m.title, m.duration_min, m.audio, m.order]
    );

    if (m.pass_mark !== null) {
      await client.query(
        `INSERT INTO quizzes (module_id, pass_mark) VALUES ($1, $2)
         ON CONFLICT (module_id) DO UPDATE SET pass_mark = EXCLUDED.pass_mark`,
        [saved.rows[0].module_id, m.pass_mark]
      );
      quizzes += 1;
    }
  }

  const extra = await client.query(
    `SELECT module_key FROM modules
     WHERE pack_id = $1 AND NOT (module_key = ANY($2::text[]))
     ORDER BY sort_order`,
    [packId, modules.map((m) => m.key)]
  );

  return {
    modules: modules.length,
    quizzes,
    not_in_manifest: extra.rows.map((r) => r.module_key)
  };
}

module.exports = { saveModules };
