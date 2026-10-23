// Traitement des médias dans le navigateur : mêmes réglages que scripts/optimize-images.mjs (WebP 2000 px,
// variante 1000 px, vignette 560 px), et image d'affiche tirée de la vidéo.
import { IMG } from "./config.js";

let webpOk;
async function canWebp() {
  if (webpOk !== undefined) return webpOk;
  const c = document.createElement("canvas");
  c.width = c.height = 1;
  webpOk = await new Promise((ok) => c.toBlob((b) => ok(b?.type === "image/webp"), "image/webp"));
  return webpOk;
}

function fit(w, h, maxW, maxH) {
  const k = Math.min(1, maxW / w, maxH / h);
  return [Math.round(w * k), Math.round(h * k)];
}

async function encode(source, w, h, q) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d");
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(source, 0, 0, w, h);
  const webp = await canWebp();
  const blob = await new Promise((ok) => c.toBlob(ok, webp ? "image/webp" : "image/jpeg", q));
  return { blob, ext: webp ? "webp" : "jpg", width: w, height: h };
}

export const bitmapOf = (blob) => createImageBitmap(blob, { imageOrientation: "from-image" });

// Planche : version pleine + variante légère si l'image est large. Les GIF restent tels quels (animation).
export async function plate(file) {
  const bmp = await bitmapOf(file);
  if (/gif$/i.test(file.type)) return { full: { blob: file, ext: "gif", width: bmp.width, height: bmp.height } };
  const [w, h] = fit(bmp.width, bmp.height, IMG.full, IMG.full);
  const full = await encode(bmp, w, h, IMG.qFull);
  let sm;
  if (w > IMG.small * 1.2) {
    const [sw, sh] = fit(bmp.width, bmp.height, IMG.small, IMG.small * 2);
    sm = await encode(bmp, sw, sh, IMG.qSmall);
  }
  bmp.close();
  return { full, sm };
}

// Vignette de l'index (ou image de survol) depuis un fichier ou une image déjà en ligne.
export async function thumb(blob) {
  const bmp = await bitmapOf(blob);
  const [w, h] = fit(bmp.width, bmp.height, IMG.thumb, IMG.thumb);
  const t = await encode(bmp, w, h, IMG.qThumb);
  bmp.close();
  return t;
}

export async function sizeOf(url) {
  const bmp = await bitmapOf(await (await fetch(url)).blob());
  const s = { width: bmp.width, height: bmp.height };
  bmp.close();
  return s;
}

// Image d'affiche de la vidéo : une image prise au tiers (au plus à 1 s), en JPEG.
export function poster(file) {
  return new Promise((ok, ko) => {
    const v = document.createElement("video");
    v.muted = true;
    v.preload = "auto";
    v.src = URL.createObjectURL(file);
    v.onerror = () => ko(new Error("Vidéo illisible par le navigateur."));
    v.onloadedmetadata = () => (v.currentTime = Math.min(1, v.duration / 3 || 0));
    v.onseeked = async () => {
      const [w, h] = fit(v.videoWidth, v.videoHeight, 1280, 1280);
      const c = document.createElement("canvas");
      c.width = w;
      c.height = h;
      c.getContext("2d").drawImage(v, 0, 0, w, h);
      c.toBlob((b) => { URL.revokeObjectURL(v.src); ok(b); }, "image/jpeg", 0.8);
    };
  });
}

export const mb = (n) => (n < 1048576 ? `${Math.max(1, Math.round(n / 1024))} Ko` : `${(n / 1048576).toFixed(n > 1048576 * 10 ? 0 : 1)} Mo`);
