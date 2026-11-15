   const express = require('express');
   const router = express.Router();
   const syncController = require('../controllers/syncController');
   const { authenticateToken } = require('../middleware/authMiddleware');

   router.post('/', authenticateToken, syncController.syncProgress);

   module.exports = router;
