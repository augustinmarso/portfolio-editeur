// Faux GitHub local pour essayer l'éditeur sans jeton ni risque : répond aux mêmes appels d'API que
// GitHub, mais sur une COPIE locale du dépôt du portfolio (git clone), jamais sur le vrai dépôt.
// Usage : node outils/mock-github.mjs <copie-du-depot> [port]
//   puis ouvrir http://localhost:<port-editeur>/?mock=http://localhost:5331 (n'importe quel jeton)
import http from "node:http";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const DIR = path.resolve(process.argv[2] ?? ".");
const PORT = Number(process.argv[3] ?? 5331);
const git = (args, opts = {}) => execFileSync("git", ["-C", DIR, ...args], { maxBuffer: 1 << 30, ...opts });
const gitText = (args, opts) => git(args, opts).toString().trim();
if (!fs.existsSync(path.join(DIR, ".git"))) throw new Error(`${DIR} n'est pas un dépôt git`);

const json = (res, code, body) => {
  res.writeHead(code, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
  res.end(JSON.stringify(body));
};
const readBody = (req) => new Promise((ok) => { const c = []; req.on("data", (d) => c.push(d)); req.on("end", () => ok(Buffer.concat(c).toString())); });

http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") {
    res.writeHead(204, { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*", "Access-Control-Allow-Methods": "GET,POST,PATCH" });
    return res.end();
  }
  const url = new URL(req.url, "http://x");
  const p = decodeURIComponent(url.pathname);
  try {
    let m;
    if ((m = p.match(/^\/raw\/([0-9a-f]{40})\/(.+)$/))) {
      const buf = git(["show", `${m[1]}:${m[2]}`]);
      const type = { webp: "image/webp", jpg: "image/jpeg", gif: "image/gif", png: "image/png", mp4: "video/mp4", woff2: "font/woff2" }[m[2].split(".").pop()] ?? "application/octet-stream";
      res.writeHead(200, { "Content-Type": type, "Access-Control-Allow-Origin": "*", "Cache-Control": "max-age=3600" });
      return res.end(buf);
    }
    if (!(m = p.match(/^\/repos\/[^/]+\/[^/]+(\/.*)?$/))) return json(res, 404, { message: "Not Found" });
    const r = m[1] ?? "";
    if (r === "") return json(res, 200, { permissions: { push: true } });
    if ((m = r.match(/^\/git\/refs?\/heads\/(.+)$/))) {
      if (req.method === "PATCH") {
        const { sha } = JSON.parse(await readBody(req));
        git(["update-ref", `refs/heads/${m[1]}`, sha]);
        return json(res, 200, { object: { sha } });
      }
      return json(res, 200, { object: { sha: gitText(["rev-parse", `refs/heads/${m[1]}`]) } });
    }
    if ((m = r.match(/^\/git\/commits\/([0-9a-f]{40})$/)))
      return json(res, 200, { sha: m[1], tree: { sha: gitText(["rev-parse", `${m[1]}^{tree}`]) }, committer: { date: gitText(["show", "-s", "--format=%cI", m[1]]) } });
    if ((m = r.match(/^\/git\/trees\/([0-9a-f]{40})$/)) && req.method === "GET") {
      const tree = gitText(["ls-tree", "-r", m[1]]).split("\n").filter(Boolean).map((l) => {
        const [meta, file] = l.split("\t");
        const [mode, type, sha] = meta.split(" ");
        return { path: file.replace(/^"|"$/g, ""), mode, type, sha };
      });
      return json(res, 200, { sha: m[1], tree, truncated: false });
    }
    if ((m = r.match(/^\/contents\/(.+)$/))) {
      const ref = url.searchParams.get("ref") ?? "HEAD";
      res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8", "Access-Control-Allow-Origin": "*" });
      return res.end(git(["show", `${ref}:${m[1]}`]));
    }
    if (r === "/git/blobs" && req.method === "POST") {
      const b = JSON.parse(await readBody(req));
      const input = b.encoding === "base64" ? Buffer.from(b.content, "base64") : Buffer.from(b.content, "utf8");
      return json(res, 201, { sha: gitText(["hash-object", "-w", "--stdin"], { input }) });
    }
    if (r === "/git/trees" && req.method === "POST") {
      const b = JSON.parse(await readBody(req));
      const index = path.join(os.tmpdir(), `mock-index-${Date.now()}`);
      const env = { ...process.env, GIT_INDEX_FILE: index };
      git(["read-tree", b.base_tree], { env });
      for (const e of b.tree) {
        if (e.sha === null) git(["update-index", "--force-remove", e.path], { env });
        else git(["update-index", "--add", "--cacheinfo", `${e.mode},${e.sha},${e.path}`], { env });
      }
      const sha = gitText(["write-tree"], { env });
      fs.rmSync(index, { force: true });
      return json(res, 201, { sha });
    }
    if (r === "/git/commits" && req.method === "POST") {
      const b = JSON.parse(await readBody(req));
      const who = { GIT_AUTHOR_NAME: "Éditeur (essai)", GIT_AUTHOR_EMAIL: "essai@local", GIT_COMMITTER_NAME: "Éditeur (essai)", GIT_COMMITTER_EMAIL: "essai@local" };
      const sha = gitText(["commit-tree", b.tree, ...b.parents.flatMap((x) => ["-p", x]), "-m", b.message], { env: { ...process.env, ...who } });
      return json(res, 201, { sha });
    }
    if (r === "/commits") {
      const n = url.searchParams.get("per_page") ?? 30;
      const list = gitText(["log", `-${n}`, "--format=%H%x1f%an%x1f%aI%x1f%B%x1e", url.searchParams.get("sha") ?? "HEAD"])
        .split("\x1e").map((s) => s.trim()).filter(Boolean).map((s) => {
          const [sha, name, date, message] = s.split("\x1f");
          return { sha, html_url: `https://github.com/commit/${sha}`, commit: { message, author: { name, date } } };
        });
      return json(res, 200, list);
    }
    if (r.startsWith("/actions/runs"))
      return json(res, 200, { workflow_runs: [{ status: "completed", conclusion: "success", html_url: "https://github.com" }] });
    return json(res, 404, { message: `mock : ${req.method} ${r} non géré` });
  } catch (e) {
    return json(res, 500, { message: String(e.message).slice(0, 300) });
  }
}).listen(PORT, "127.0.0.1", () => console.log(`Faux GitHub sur http://localhost:${PORT} (copie : ${DIR})`));
