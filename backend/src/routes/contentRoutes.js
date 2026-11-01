const express = require('express');
const router = express.Router();
const courseController = require('../controllers/courseController');
const packController = require('../controllers/packController');
const downloadController = require('../controllers/downloadController');
const { authenticateToken, requireAdmin } = require('../middleware/authMiddleware');

// Anyone logged in can read courses and packs, and download them.
router.get('/courses', authenticateToken, courseController.getCourses);
router.get('/courses/:courseId/packs', authenticateToken, packController.getPacksByCourse);
router.get('/packs/:packId/download', authenticateToken, downloadController.downloadContentPack);
router.post('/packs/check-updates', authenticateToken, downloadController.checkPackUpdates);

// Only an admin can create or change content.
router.post('/courses', authenticateToken, requireAdmin, courseController.createCourse);
router.post('/packs', authenticateToken, requireAdmin, packController.createContentPack);
router.put('/packs/:packId', authenticateToken, requireAdmin, packController.updateContentPack);

module.exports = router;
