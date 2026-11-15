const express = require('express');
const router = express.Router();
const courseController = require('../controllers/courseController');
const packController = require('../controllers/packController');
const downloadController = require('../controllers/downloadController');
const uploadController = require('../controllers/uploadController');
const editorController = require('../controllers/editorController');
const { authenticateToken, requireAdmin } = require('../middleware/authMiddleware');

// Anyone logged in can read courses and packs, and download them.
router.get('/courses', authenticateToken, courseController.getCourses);
router.get('/courses/:courseId/packs', authenticateToken, packController.getPacksByCourse);
router.get('/packs/:packId/download', authenticateToken, downloadController.downloadContentPack);
router.post('/packs/check-updates', authenticateToken, downloadController.checkPackUpdates);
router.post('/packs/:packId/confirm', authenticateToken, downloadController.confirmDownload);

// Only an admin can create or change content.
router.post('/courses', authenticateToken, requireAdmin, courseController.createCourse);
router.post('/packs', authenticateToken, requireAdmin, packController.createContentPack);
router.put('/packs/:packId', authenticateToken, requireAdmin, packController.updateContentPack);

// Admin screen: upload a pack zip (the body is the zip itself) and see what is
// published. The size limit can be changed with UPLOAD_MAX_MB in the .env file.
const uploadLimit = `${Number(process.env.UPLOAD_MAX_MB) || 15}mb`;
router.post('/admin/upload', authenticateToken, requireAdmin,
  express.raw({ type: ['application/zip', 'application/octet-stream'], limit: uploadLimit }),
  uploadController.uploadPack);
router.get('/admin/published', authenticateToken, requireAdmin, uploadController.listPublished);

// Lesson editor: write lessons in the browser (see editorController.js).
router.post('/admin/audio', authenticateToken, requireAdmin,
  express.raw({ type: ['audio/mpeg', 'audio/mp3', 'application/octet-stream'], limit: '2mb' }),
  editorController.uploadAudio);
router.post('/admin/lessons', authenticateToken, requireAdmin, editorController.saveLessons);
router.get('/admin/packs/:packId/source', authenticateToken, requireAdmin, editorController.getPackSource);

module.exports = router;
