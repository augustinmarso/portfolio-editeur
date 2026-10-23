// État de l'éditeur : données en cours, médias ajoutés en attente, annuler / rétablir, brouillon gardé
// dans le navigateur (IndexedDB) pour ne rien perdre si l'onglet se ferme avant la publication.
export const S = {
  base: null, // version chargée depuis GitHub (sha, arborescence, données d'origine)
  docs: null, // données modifiées
  uploads: new Map(), // chemin dans le dépôt → Blob, en attente de publication
  undo: [],
  redo: [],
};

const listeners = new Set();
export const subscribe = (fn) => listeners.add(fn);
const emit = (soft) => {
  for (const fn of listeners) fn(soft);
  saveDraftSoon();
};

let last = null;
// Toute modification passe par ici. coalesce : les frappes successives dans un même champ
// ne font qu'une seule étape d'annulation. soft : pas besoin de redessiner le panneau principal.
export function change(label, fn, { coalesce, soft } = {}) {
  const now = Date.now();
  if (!(coalesce && last?.key === coalesce && now - last.t < 2000)) {
    S.undo.push({ label, snap: JSON.stringify(S.docs), t: now });
    if (S.undo.length > 300) S.undo.shift();
  }
  last = { key: coalesce, t: now };
  fn(S.docs);
  S.redo = [];
  emit(soft);
}

export function undo() {
  const u = S.undo.pop();
  if (!u) return null;
  S.redo.push({ label: u.label, snap: JSON.stringify(S.docs), t: Date.now() });
  S.docs = JSON.parse(u.snap);
  last = null;
  emit();
  return u.label;
}
export function redo() {
  const r = S.redo.pop();
  if (!r) return null;
  S.undo.push({ label: r.label, snap: JSON.stringify(S.docs), t: Date.now() });
  S.docs = JSON.parse(r.snap);
  last = null;
  emit();
  return r.label;
}
// Revenir juste avant l'étape n du journal.
export function backTo(n) {
  while (S.undo.length > n) undo();
}

export function reset(base, docs) {
  S.base = base;
  S.docs = docs ?? structuredClone(base.docs);
  S.undo = [];
  S.redo = [];
  last = null;
  emit();
}
export const refresh = () => emit();

// ---- brouillon (IndexedDB) ----
const DB = "portfolio-editeur";
function db() {
  return new Promise((ok, ko) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore("kv");
    r.onsuccess = () => ok(r.result);
    r.onerror = () => ko(r.error);
  });
}
async function kv(mode, fn) {
  const d = await db();
  return new Promise((ok, ko) => {
    const tx = d.transaction("kv", mode);
    const req = fn(tx.objectStore("kv"));
    tx.oncomplete = () => ok(req?.result);
    tx.onerror = () => ko(tx.error);
  });
}
export const loadDraft = () => kv("readonly", (s) => s.get("draft")).catch(() => null);
export const clearDraft = () => kv("readwrite", (s) => s.delete("draft")).catch(() => {});

let timer;
export let isDirty = () => false; // fourni par l'application
export const setDirtyCheck = (fn) => (isDirty = fn);
function saveDraftSoon() {
  clearTimeout(timer);
  timer = setTimeout(() => {
    if (!S.base) return;
    if (!isDirty()) return clearDraft();
    kv("readwrite", (s) =>
      s.put({ baseSha: S.base.sha, docs: S.docs, uploads: [...S.uploads], undo: S.undo.slice(-60), savedAt: Date.now() }, "draft")
    ).catch(() => {});
  }, 400);
}
