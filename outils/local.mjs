// Éditeur sur cet ordinateur, sans code ni connexion : sert l'éditeur sur http://localhost:5330 et lui donne
// le jeton de la connexion GitHub déjà faite avec `gh` (gh auth login). Le jeton ne quitte pas ce PC.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { join, extname, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const PORT = Number(process.argv[2] ?? 5330);
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".json": "application/json" };

createServer(async (req, res) => {
  // Contre le « DNS rebinding » : seules les pages ouvertes sur localhost peuvent lire le jeton.
  if (!/^(localhost|127\.0\.0\.1):\d+$/.test(req.headers.host ?? "")) return res.writeHead(403).end();
  const path = decodeURIComponent(new URL(req.url, "http://x").pathname);
  if (path === "/jeton") {
    try {
      const t = execFileSync("gh", ["auth", "token"], { encoding: "utf8" }).trim();
      return res.writeHead(200, { "Content-Type": "text/plain", "Cache-Control": "no-store" }).end(t);
    } catch {
      return res.writeHead(500).end("gh n'est pas connecté : lancer « gh auth login ».");
    }
  }
  const file = normalize(join(ROOT, path === "/" ? "index.html" : path));
  if (!file.startsWith(normalize(ROOT)) || file.includes(".git")) return res.writeHead(404).end();
  try {
    res.writeHead(200, { "Content-Type": TYPES[extname(file)] ?? "application/octet-stream", "Cache-Control": "no-store" }).end(await readFile(file));
  } catch {
    res.writeHead(404).end();
  }
}).listen(PORT, "127.0.0.1", () => console.log(`Éditeur : http://localhost:${PORT}  (fermer cette fenêtre pour l'arrêter)`));
