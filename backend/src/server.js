// 1. Load dotenv first, before anything that reads process.env
require('dotenv').config();

const express = require('express');
const cors = require('cors');

const db = require('./config/database');
const authRoutes = require('./routes/authRoutes');

// 2. Create the Express app
const app = express();

// 3. Add cors() and express.json() before your routes
app.use(cors());
app.use(express.json());

// 4. Mount the auth router at /api/auth
app.use('/api/auth', authRoutes);

// 5. Add a GET /health route
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

// Root route
app.get('/', (req, res) => {
  res.status(200).json({ message: 'AccessEd Backend API is running.' });
});

// Error handling middleware for malformed JSON and unhandled errors
app.use((err, req, res, next) => {
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'Invalid JSON body.' });
  }
  console.error('Unhandled error:', err.message);
  res.status(500).json({ error: 'Internal server error.' });
});

// Verify database connection immediately on startup
db.query('SELECT NOW()')
  .then((res) => console.log('Database time verified:', res.rows[0].now))
  .catch((err) => console.error('Database connection failed:', err.message));

// 6. Call app.listen with process.env.PORT
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
