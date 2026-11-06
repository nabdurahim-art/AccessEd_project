// Load settings from the .env file first, before anything reads process.env.
require('dotenv').config();

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const syncRoutes = require('./routes/syncRoutes');



// Stop immediately if the signing secret is missing or too short.
if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
  console.error('FATAL: JWT_SECRET must be set and at least 32 characters long.');
  process.exit(1);
}

const app = express();

// We run behind Nginx, so trust the first proxy. Without this, the rate
// limiters would see every learner as the same address.
app.set('trust proxy', 1);

// Safe default headers. The cross-origin setting lets the web app download packs.
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));

// The token travels in a header, not a cookie, so allowing any origin is fine
// for the pilot. Later, restrict this to the web app's address.
app.use(cors({
  origin: '*',
  exposedHeaders: ['X-Checksum-SHA256', 'X-Pack-Version', 'Content-Length'],
}));

// Compress JSON answers. Zip packs are already compressed and are skipped.
app.use(compression());

// Sync batches can be bigger than the 100 KB default.
app.use(express.json({ limit: '1mb' }));

app.get('/health', (req, res) => res.json({ status: 'ok' }));

app.use('/api/v1/auth', require('./routes/authRoutes'));
app.use('/api/v1/content', require('./routes/contentRoutes'));
app.use('/api/v1/sync', syncRoutes);
app.use('/api/v1/progress', require('./routes/progressRoutes'));

// Unknown address
app.use((req, res) => res.status(404).json({ error: 'Not found.' }));

// Any error, including a request body that is not valid JSON
app.use((err, req, res, next) => {
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'Request body is not valid JSON.' });
  }
  if (err.type === 'entity.too.large') {
    return res.status(413).json({ error: 'Request body is too large.' });
  }
  console.error('Unhandled error:', err);
  return res.status(500).json({ error: 'Internal server error.' });
});

const PORT = process.env.PORT || 5000;

// Only start listening when this file is run directly, so tests can import app.
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`AccessEd backend running on port ${PORT}`);
  });
}

module.exports = app;
