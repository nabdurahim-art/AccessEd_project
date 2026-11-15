import * as SecureStore from 'expo-secure-store';
import * as Crypto from 'expo-crypto';

const TOKEN_KEY = 'accessed_auth_token';
const DEVICE_ID_KEY = 'accessed_device_id';

// In-memory cache to prevent repeated SecureStore reads and race conditions
let cachedToken = null;
let tokenLoaded = false;

let deviceIdPromise = null;
let cachedDeviceId = null;

/**
 * Saves the authentication JWT securely and updates memory cache.
 */
export async function saveToken(token) {
  cachedToken = token;
  tokenLoaded = true;
  try {
    await SecureStore.setItemAsync(TOKEN_KEY, token);
  } catch (error) {
    console.error('Error saving auth token:', error);
    throw error;
  }
}

/**
 * Retrieves the stored authentication JWT (cached in memory after first load).
 */
export async function getToken() {
  if (!tokenLoaded) {
    try {
      cachedToken = await SecureStore.getItemAsync(TOKEN_KEY);
    } catch (error) {
      console.error('Error retrieving auth token:', error);
      cachedToken = null;
    }
    tokenLoaded = true;
  }
  return cachedToken;
}

/**
 * Clears the stored authentication JWT and resets memory cache (used on 401).
 */
export async function clearToken() {
  cachedToken = null;
  tokenLoaded = true;
  try {
    await SecureStore.deleteItemAsync(TOKEN_KEY);
  } catch (error) {
    console.error('Error clearing auth token:', error);
  }
}

/**
 * Retrieves the persistent device ID with promise-locking and module caching 
 * to prevent race conditions during concurrent startup calls.
 */
export async function getDeviceId() {
  if (cachedDeviceId) return cachedDeviceId;

  if (!deviceIdPromise) {
    deviceIdPromise = (async () => {
      try {
        let deviceId = await SecureStore.getItemAsync(DEVICE_ID_KEY);
        if (!deviceId) {
          deviceId = Crypto.randomUUID();
          await SecureStore.setItemAsync(DEVICE_ID_KEY, deviceId);
        }
        cachedDeviceId = deviceId;
        return cachedDeviceId;
      } catch (error) {
        console.error('Error managing device ID via SecureStore:', error);
        // Fallback: Generate a valid runtime UUID so it never crashes the server,
        // and keep it in memory for the duration of the app session.
        if (!cachedDeviceId) {
          cachedDeviceId = Crypto.randomUUID();
        }
        return cachedDeviceId;
      }
    })();
  }

  return deviceIdPromise;
}
