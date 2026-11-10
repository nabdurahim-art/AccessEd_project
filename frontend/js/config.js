// Where your Node backend runs. The routes live under /api/v1.
// Served by Nginx on the same address, so the path is relative.
export const API_URL = '/api/v1';

// Keep in sync with authController.js on the backend
export const MIN_PASSWORD = 8;
export const MAX_PASSWORD = 100;
