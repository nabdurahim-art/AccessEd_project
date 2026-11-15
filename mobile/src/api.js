import { getToken, clearToken } from './session';

export const API_URL = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:5000/api/v1';
const TIMEOUT_MS = 15000; // 15 seconds timeout

/**
 * Centralized API client for communicating with the backend server.
 */
export async function request(method, path, body = null) {
  const upperMethod = method.toUpperCase();
  const token = await getToken();
  
  const headers = {
    'Content-Type': 'application/json',
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const config = {
    method: upperMethod,
    headers,
  };

  if (body && upperMethod !== 'GET' && upperMethod !== 'DELETE') {
    config.body = JSON.stringify(body);
  }

  const controller = new AbortController();
  config.signal = controller.signal;
  const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

  let response;
  try {
    response = await fetch(`${API_URL}${path}`, config);
  } catch (err) {
    const isOffline = err.name === 'AbortError' || err.message.includes('Network request failed');
    const networkError = new Error(isOffline ? 'Network connection lost or request timed out.' : err.message);
    networkError.offline = true;
    networkError.originalError = err;
    throw networkError;
  } finally {
    clearTimeout(timeoutId);
  }

  // Read response body safely after headers arrive
  let responseData = null;
  const contentType = response.headers.get('content-type');
  try {
    if (contentType && contentType.includes('application/json')) {
      responseData = await response.json();
    } else {
      const textData = await response.text();
      responseData = { error: textData || response.statusText };
    }
  } catch (e) {
    responseData = { error: response.statusText };
  }

  // Handle 401 Unauthorized after reading server message
  if (response.status === 401) {
    if (token) {
      await clearToken();
    }
    const error = new Error(responseData?.error || 'Session expired or unauthorized.');
    error.status = 401;
    error.offline = false;
    error.details = responseData?.details;
    throw error;
  }

  if (!response.ok) {
    const error = new Error(responseData?.error || `Server responded with status ${response.status}`);
    error.status = response.status;
    error.serverMessage = responseData?.error || response.statusText;
    error.details = responseData?.details;
    error.offline = false;
    throw error;
  }

  return responseData;
}
