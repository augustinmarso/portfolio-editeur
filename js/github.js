// Accès au dépôt du portfolio par l'API GitHub, avec le jeton saisi par l'utilisateur (gardé dans son navigateur).
import { OWNER, REPO, BRANCH, API_BASE } from "./config.js";

const API = API_BASE;
const R = `/repos/${OWNER}/${REPO}`;
let token = null;
export const setToken = (t) => (token = t);

async function gh(path, { raw, method = "GET", body, accept } = {}) {
  const r = await fetch(API + path, {
    method,
    cache: "no-store",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: accept ?? "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(body && { "Content-Type": "application/json" }),
    },
    body: body && JSON.stringify(body),
  });
  if (!r.ok) {
    const j = await r.json().catch(() => ({}));
    const e = new Error(j.message ? `GitHub : ${j.message}` : `GitHub ${r.status}`);
    e.status = r.status;
    throw e;
  }
  if (raw) return r;
  return r.status === 204 ? null : r.json();
}

export const repoInfo = () => gh(R);
export const headSha = async () => (await gh(`${R}/git/ref/heads/${BRANCH}`)).object.sha;

// Arborescence complète d'un commit : chemin → sha du fichier.
export async function treeOf(commitSha) {
  const c = await gh(`${R}/git/commits/${commitSha}`);
  const t = await gh(`${R}/git/trees/${c.tree.sha}?recursive=1`);
  return {
    treeSha: c.tree.sha,
    date: c.committer.date,
    files: Object.fromEntries(t.tree.filter((x) => x.type === "blob").map((x) => [x.path, x.sha])),
  };
}

const enc = (p) => p.split("/").map(encodeURIComponent).join("/");
export async function readText(path, ref) {
  const r = await gh(`${R}/contents/${enc(path)}?ref=${ref}`, { raw: true, accept: "application/vnd.github.raw+json" });
  return (await r.text()).replace(/\r\n/g, "\n");
}

async function blobToBase64(blob) {
  const buf = new Uint8Array(await blob.arrayBuffer());
  let s = "";
  for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return btoa(s);
}

async function pool(items, n, fn) {
  const queue = [...items];
  await Promise.all(Array.from({ length: Math.min(n, queue.length) }, async () => {
    while (queue.length) await fn(queue.shift());
  }));
}

// Un seul commit pour toute la publication. files : [{ path, text } | { path, blob } | { path, remove: true }].
export async function commitFiles({ parent, files, message, onProgress }) {
  const parentCommit = await gh(`${R}/git/commits/${parent}`);
  const entries = [];
  let done = 0;
  await pool(files, 4, async (f) => {
    if (f.remove) entries.push({ path: f.path, mode: "100644", type: "blob", sha: null });
    else {
      const b = await gh(`${R}/git/blobs`, {
        method: "POST",
        body: f.blob ? { content: await blobToBase64(f.blob), encoding: "base64" } : { content: f.text, encoding: "utf-8" },
      });
      entries.push({ path: f.path, mode: "100644", type: "blob", sha: b.sha });
    }
    onProgress?.(++done, files.length, f.path);
  });
  const tree = await gh(`${R}/git/trees`, { method: "POST", body: { base_tree: parentCommit.tree.sha, tree: entries } });
  const commit = await gh(`${R}/git/commits`, { method: "POST", body: { message, tree: tree.sha, parents: [parent] } });
  await gh(`${R}/git/refs/heads/${BRANCH}`, { method: "PATCH", body: { sha: commit.sha, force: false } });
  return commit.sha;
}

export const commits = (n = 40) => gh(`${R}/commits?sha=${BRANCH}&per_page=${n}`);
export const commitDetail = (sha) => gh(`${R}/commits/${sha}`);
export const runsFor = (sha) => gh(`${R}/actions/runs?head_sha=${sha}&per_page=5`);
