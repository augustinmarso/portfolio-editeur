// Code d'accès : le jeton GitHub est chiffré (AES-GCM, clé tirée du code par PBKDF2) et rangé dans le
// dépôt du portfolio. Le fichier est public mais illisible sans le code ; la lenteur voulue de PBKDF2
// rend très coûteux d'essayer des codes au hasard, d'où un code d'au moins 10 caractères.
const ITERATIONS = 1_200_000;
const te = new TextEncoder();
const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function keyFrom(code, salt, iterations) {
  const base = await crypto.subtle.importKey("raw", te.encode(code.normalize("NFC")), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}

export async function lock(token, code) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await keyFrom(code, salt, ITERATIONS);
  const data = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, te.encode(token));
  return { v: 1, kdf: "PBKDF2-SHA256", iterations: ITERATIONS, salt: b64(salt), iv: b64(iv), data: b64(data), cree: new Date().toISOString() };
}

// Renvoie le jeton, ou lève une erreur si le code est faux.
export async function unlock(box, code) {
  const key = await keyFrom(code, unb64(box.salt), box.iterations);
  try {
    return new TextDecoder().decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(box.iv) }, key, unb64(box.data)));
  } catch {
    throw new Error("Code incorrect.");
  }
}

export const MIN_CODE = 10;
