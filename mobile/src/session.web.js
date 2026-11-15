// Browser version of session.js (Expo picks this file on the web).
// The phone keeps the login token in SecureStore, which a browser does not
// have. Here it goes in localStorage. Be aware of the trade-off: any script
// running on the page can read localStorage, so the site must never load
// third-party scripts. If localStorage is blocked (private windows, some
// settings), the values are kept in memory for the life of the page.
import * as Crypto from 'expo-crypto';

const TOKEN_KEY = 'accessed_auth_token';
const DEVICE_ID_KEY = 'accessed_device_id';

const memory = {};

function read(key) {
  try {
    const value = window.localStorage.getItem(key);
    return value === null ? (memory[key] ?? null) : value;
  } catch (err) {
    return memory[key] ?? null;
  }
}

function write(key, value) {
  memory[key] = value;
  try {
    window.localStorage.setItem(key, value);
  } catch (err) {
    // blocked: the in-memory copy is all we have
  }
}

function erase(key) {
  delete memory[key];
  try {
    window.localStorage.removeItem(key);
  } catch (err) {
    // nothing to do
  }
}

let cachedToken = null;
let tokenLoaded = false;
let cachedDeviceId = null;

export async function saveToken(token) {
  cachedToken = token;
  tokenLoaded = true;
  write(TOKEN_KEY, token);
}

export async function getToken() {
  if (!tokenLoaded) {
    cachedToken = read(TOKEN_KEY);
    tokenLoaded = true;
  }
  return cachedToken;
}

export async function clearToken() {
  cachedToken = null;
  tokenLoaded = true;
  erase(TOKEN_KEY);
}

export async function getDeviceId() {
  if (cachedDeviceId) return cachedDeviceId;
  let deviceId = read(DEVICE_ID_KEY);
  if (!deviceId) {
    deviceId = Crypto.randomUUID();
    write(DEVICE_ID_KEY, deviceId);
  }
  cachedDeviceId = deviceId;
  return cachedDeviceId;
}
