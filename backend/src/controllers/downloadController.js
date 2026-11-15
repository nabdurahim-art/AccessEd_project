// What a learner's phone does with packs: download them and check for updates.

const db = require('../config/database');
const { MAX_ID, toId, isId } = require('../utils/ids');
const { resolvePackFile } = require('../utils/packFiles');

const UUID_RULE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PLATFORMS = ['android', 'ios', 'web'];
const MAX_UPDATE_ITEMS = 200; // most packs a phone may send in one update check

/**
 * Sends the pack file with its SHA-256 checksum in the headers.
 * res.download supports Range requests, so a phone whose connection drops can
 * carry on from where it stopped, and it sets Content-Length so the app can
 * show progress.
 */
const downloadContentPack = async (req, res) => {
  try {
    const packId = toId(req.params.packId);
    if (packId === null) {
      return res.status(400).json({ error: 'Invalid pack ID format. Must be a positive whole number.' });
    }

    const result = await db.query(
      'SELECT pack_id, version, file_path, checksum FROM content_packs WHERE pack_id = $1',
      [packId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Content pack not found.' });
    }

    const pack = result.rows[0];
    const fullPath = resolvePackFile(pack.file_path);

    if (!fullPath) {
      return res.status(404).json({ error: 'Pack file missing or inaccessible on server storage.' });
    }

    return res.download(
      fullPath,
      `pack-${pack.pack_id}-v${pack.version}.zip`,
      {
        // The path was already checked above, so allow folders that start with a dot.
        dotfiles: 'allow',
        headers: {
          // The phone compares this with the checksum of what it received.
          'X-Checksum-SHA256': pack.checksum,
          'X-Pack-Version': String(pack.version)
        }
      },
      (err) => {
        if (err && !res.headersSent) {
          console.error('Download error:', err);
          res.status(500).json({ error: 'Error sending content pack file.' });
        }
      }
    );
  } catch (err) {
    console.error('Download pack error:', err);
    return res.status(500).json({ error: 'Internal server error during file download.' });
  }
};

/**
 * The phone sends the packs it holds and their versions:
 *   { "client_packs": [{ "course_id": 1, "week_number": 1, "downloaded_version": 1 }] }
 * We answer with the packs that have a newer version on the server.
 * Packs the phone has never downloaded are not included here; the app finds
 * new packs from the list of packs for each course.
 */
const checkPackUpdates = async (req, res) => {
  try {
    const { client_packs } = req.body;

    if (!Array.isArray(client_packs)) {
      return res.status(400).json({ error: 'client_packs must be an array of objects.' });
    }
    if (client_packs.length > MAX_UPDATE_ITEMS) {
      return res.status(400).json({ error: `Send at most ${MAX_UPDATE_ITEMS} packs at a time.` });
    }

    // Keep only well-formed entries, and skip the rest.
    const valid = client_packs.filter(
      (p) => p &&
        isId(p.course_id) &&
        isId(p.week_number) &&
        Number.isInteger(p.downloaded_version) &&
        p.downloaded_version >= 0 &&
        p.downloaded_version <= MAX_ID
    );

    if (valid.length === 0) {
      return res.status(200).json({ outdated_count: 0, updates: [] });
    }

    // One query for the whole list, instead of one query per pack.
    const query = `
      SELECT p.pack_id, p.course_id, p.title, p.week_number, p.version,
             p.file_size_kb, p.checksum, c.version AS client_version
      FROM content_packs p
      JOIN unnest($1::int[], $2::int[], $3::int[]) AS c(course_id, week_number, version)
        ON p.course_id = c.course_id AND p.week_number = c.week_number
      WHERE p.version > c.version
      ORDER BY p.course_id, p.week_number;
    `;

    const result = await db.query(query, [
      valid.map((p) => p.course_id),
      valid.map((p) => p.week_number),
      valid.map((p) => p.downloaded_version)
    ]);

    return res.status(200).json({
      outdated_count: result.rows.length,
      updates: result.rows
    });
  } catch (err) {
    console.error('Check pack updates error:', err);
    return res.status(500).json({ error: 'Internal server error while checking updates.' });
  }
};

/**
 * The phone tells us it finished downloading a pack:
 *   { "device_id": "<uuid made on the phone>", "platform": "android", "version": 2 }
 * We remember which learner has which version on which device. A device is
 * not tied to one learner, because phones are shared, so the same device can
 * appear under several learners.
 * Call this after the checksum has matched, never before.
 */
const confirmDownload = async (req, res) => {
  try {
    const userId = req.user.user_id;
    const packId = toId(req.params.packId);
    if (packId === null) {
      return res.status(400).json({ error: 'Invalid pack ID format. Must be a positive whole number.' });
    }

    const body = req.body || {};
    const { device_id, platform, version } = body;

    if (typeof device_id !== 'string' || !UUID_RULE.test(device_id)) {
      return res.status(400).json({ error: 'device_id must be a UUID made on the phone.' });
    }
    if (!PLATFORMS.includes(platform)) {
      return res.status(400).json({ error: `platform must be one of: ${PLATFORMS.join(', ')}.` });
    }
    if (!isId(version)) {
      return res.status(400).json({ error: 'version must be a positive whole number.' });
    }

    const packRes = await db.query('SELECT version FROM content_packs WHERE pack_id = $1', [packId]);
    if (packRes.rows.length === 0) {
      return res.status(404).json({ error: 'Content pack not found.' });
    }
    const latest = packRes.rows[0].version;

    // A phone cannot hold a version that does not exist yet.
    if (version > latest) {
      return res.status(400).json({ error: 'version is newer than the version on the server.' });
    }

    // Older than the server's version means the phone should update again.
    const syncStatus = version < latest ? 'pending_update' : 'synced';

    // One statement: the device and the download are saved together or not at all.
    const result = await db.query(
      `WITH device AS (
         INSERT INTO devices (device_id, platform) VALUES ($1, $2)
         ON CONFLICT (device_id) DO UPDATE SET last_seen_at = NOW(), platform = EXCLUDED.platform
         RETURNING device_id
       )
       INSERT INTO offline_downloads (user_id, device_id, pack_id, downloaded_version, sync_status)
       SELECT $3, device_id, $4, $5, $6 FROM device
       ON CONFLICT ON CONSTRAINT uq_download DO UPDATE SET
         downloaded_version = EXCLUDED.downloaded_version,
         downloaded_at = NOW(),
         sync_status = EXCLUDED.sync_status
       RETURNING pack_id, downloaded_version, sync_status`,
      [device_id, platform, userId, packId, version, syncStatus]
    );

    return res.status(200).json({
      message: 'Download recorded.',
      download: result.rows[0],
      latest_version: latest
    });
  } catch (err) {
    console.error('Confirm download error:', err);
    return res.status(500).json({ error: 'Internal server error while recording the download.' });
  }
};

module.exports = { downloadContentPack, checkPackUpdates, confirmDownload };
