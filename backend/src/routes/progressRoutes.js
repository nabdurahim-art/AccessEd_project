const express = require('express');
const router = express.Router();
const progressController = require('../controllers/progressController');
const { authenticateToken } = require('../middleware/authMiddleware');

router.get('/summary', authenticateToken, progressController.getSummary);

module.exports = router;
