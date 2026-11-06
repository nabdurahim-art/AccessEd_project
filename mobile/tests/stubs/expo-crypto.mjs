import { randomUUID as r, webcrypto } from 'node:crypto';
export const randomUUID = () => r();
export const CryptoDigestAlgorithm = { SHA256: 'SHA-256' };
export const digest = (alg, data) => webcrypto.subtle.digest(alg, data);
