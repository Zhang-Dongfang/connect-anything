// NetEase Cloud Music "weapi" request codec.
//
// Observed in captures/netease.har: every /weapi/* call is a POST with
//   content-type: application/x-www-form-urlencoded
//   body: params=<base64 AES blob>&encSecKey=<256-char hex RSA blob>
// The plaintext never appears in traffic, the response comes back as plain JSON.
//
// Reconstructed scheme: JSON -> AES-128-CBC(fixed nonce) -> AES-128-CBC(random
// 16-char secret) -> params; the secret itself is RSA-encrypted (reversed) into
// encSecKey with the public modulus shipped in the web player bundle.
import crypto from 'node:crypto';

const IV = Buffer.from('0102030405060708');
const NONCE = Buffer.from('0CoJUm6Qyw8W8jud');
const PUBLIC_MODULUS = '00e0b509f6259df8642dbc35662901477df22677ec152b5ff68ace615bb7b725152b3ab17a876aea8a5aa76d2e417629ec4ee341f56135fccf695280104e0312ecbda92557c93870114af6c9d05c4f7f0c3685b7a46bee255932575cce10b424d813cfe4875d3e82047b97ddef52741d546b8e289dc6935b3ece0462db0a22b8e7';
const PUBLIC_EXPONENT = '010001';

export function aesEncryptBase64(text, key) {
  const cipher = crypto.createCipheriv('aes-128-cbc', key, IV);
  return Buffer.concat([cipher.update(Buffer.from(text, 'utf8')), cipher.final()]).toString('base64');
}

export function aesDecryptBase64(b64, key) {
  const decipher = crypto.createDecipheriv('aes-128-cbc', key, IV);
  return Buffer.concat([decipher.update(Buffer.from(b64, 'base64')), decipher.final()]).toString('utf8');
}

// modPow keeps this zero-dependency; encSecKey is 256 hex chars (1024-bit block).
export function rsaEncryptHex(text, modulus = PUBLIC_MODULUS, exponent = PUBLIC_EXPONENT) {
  const message = Buffer.from(String(text), 'utf8').reverse().toString('hex');
  const m = BigInt('0x' + modulus);
  let base = BigInt('0x' + message) % m;
  let e = BigInt('0x' + exponent);
  let out = 1n;
  while (e > 0n) {
    if (e & 1n) out = (out * base) % m;
    base = (base * base) % m;
    e >>= 1n;
  }
  return out.toString(16).padStart(256, '0');
}

export function randomSecret() {
  return crypto.randomBytes(8).toString('hex');
}

export function weapiEncrypt(payload, secret = randomSecret()) {
  const text = JSON.stringify(payload ?? {});
  const params = aesEncryptBase64(aesEncryptBase64(text, NONCE), Buffer.from(secret, 'utf8'));
  return { params, encSecKey: rsaEncryptHex(secret) };
}

export function weapiForm(payload, secret) {
  const { params, encSecKey } = weapiEncrypt(payload, secret);
  return new URLSearchParams({ params, encSecKey }).toString();
}

// Used by tests and by "explain this capture" tooling: recover the plaintext of a
// captured envelope when the secret is known.
export function weapiDecrypt(params, secret) {
  const once = aesDecryptBase64(params, Buffer.from(secret, 'utf8'));
  return JSON.parse(aesDecryptBase64(once, NONCE));
}
