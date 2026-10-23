// Données du site ↔ modèle de l'éditeur. Dans le modèle, chaque planche porte sa légende et son onglet
// (produit / processus) ; à l'écriture on retrouve exactement les fichiers du portfolio.
import { PATHS } from "./config.js";
import { readText, treeOf } from "./github.js";

export const emptyText = () => ({ year: null, context: null, themes: [], intro: "", captions: [], processus: [] });
export const repoPath = (src) => `public${src}`; // "/projects/x/01.webp" → "public/projects/x/01.webp"

export const slugify = (s) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

// Charge toutes les données du site à un commit donné.
export async function load(sha, onProgress) {
  const tree = await treeOf(sha);
  const has = (p) => p in tree.files;
  const textSlugs = Object.keys(tree.files)
    .filter((p) => p.startsWith(PATHS.textsDir) && p.endsWith(".json"))
    .map((p) => p.slice(PATHS.textsDir.length, -5))
    .filter((s) => !s.includes("/"));
  const wanted = [PATHS.projects, PATHS.site, PATHS.embeds, PATHS.corbeille, ...Object.values(PATHS.pages), ...textSlugs.map((s) => `${PATHS.textsDir}${s}.json`)];
  const raw = {};
  let n = 0;
  await Promise.all(
    wanted.map(async (p) => {
      if (has(p)) raw[p] = await readText(p, sha);
      onProgress?.(++n, wanted.length);
    })
  );
  const json = (p, fallback) => (raw[p] ? JSON.parse(raw[p]) : fallback);
  const texts = Object.fromEntries(textSlugs.map((s) => [s, json(`${PATHS.textsDir}${s}.json`, emptyText())]));
  const projects = json(PATHS.projects, []).map((p) => fromFiles(p, texts[p.slug] ?? emptyText()));
  const docs = {
    projects,
    site: json(PATHS.site, { order: [], titles: {}, covers: {}, videos: [] }),
    embeds: json(PATHS.embeds, {}),
    corbeille: json(PATHS.corbeille, { projets: [] }),
    pages: Object.fromEntries(Object.entries(PATHS.pages).map(([k, p]) => [k, json(p, {})])),
  };
  return { sha, tree, textSlugs, docs };
}

export function fromFiles(p, text) {
  const proc = new Set(text.processus ?? []);
  return {
    slug: p.slug,
    title: p.title,
    cover: p.cover ?? null,
    hover: p.hover ?? null,
    images: p.images.map((img, i) => ({ ...img, caption: text.captions?.[i] ?? "", proc: proc.has(i) })),
    text: { ...text },
  };
}

const json = (x) => JSON.stringify(x, null, 2) + "\n";

// Modèle → contenu de chaque fichier (null = fichier à supprimer).
export function serialize(docs, base) {
  const out = {};
  out[PATHS.projects] = JSON.stringify(
    docs.projects.map((p) => ({
      slug: p.slug,
      title: p.title,
      cover: p.cover,
      ...(p.hover && { hover: p.hover }),
      images: p.images.map(({ caption, proc, ...img }) => img),
    })),
    null,
    2
  );
  out[PATHS.site] = json({ ...docs.site, order: docs.projects.map((p) => p.slug) });

  const slugs = new Set(docs.projects.map((p) => p.slug));
  for (const p of docs.projects) {
    const t = { ...p.text };
    t.captions = p.images.map((i) => i.caption);
    t.processus = p.images.flatMap((i, n) => (i.proc ? [n] : []));
    out[`${PATHS.textsDir}${p.slug}.json`] = json(t);
  }
  // textes des projets retirés depuis le chargement
  const baseProjects = new Set(base.docs.projects.map((p) => p.slug));
  const textSlugs = new Set(base.textSlugs);
  for (const s of baseProjects) if (!slugs.has(s)) { out[`${PATHS.textsDir}${s}.json`] = null; textSlugs.delete(s); }
  for (const s of slugs) textSlugs.add(s);
  out[PATHS.textsIndex] = textsIndex([...textSlugs].sort());

  out[PATHS.embeds] = json(Object.fromEntries(Object.entries(docs.embeds).filter(([s, l]) => l.length && slugs.has(s))));
  if (docs.corbeille.projets.length || PATHS.corbeille in base.tree.files) out[PATHS.corbeille] = json(docs.corbeille);
  for (const [k, p] of Object.entries(PATHS.pages)) if (docs.pages[k] && Object.keys(docs.pages[k]).length) out[p] = json(docs.pages[k]);
  return out;
}

const ident = (s) => s.replace(/[^a-zA-Z0-9]/g, "_");
function textsIndex(slugs) {
  return [
    "// Généré par scripts/optimize-images.mjs : un fichier JSON par projet, même slug que les images.",
    'import type { ProjectText } from "@/lib/projects";',
    ...slugs.map((s) => `import ${ident(s)} from "./${s}.json";`),
    "",
    "export const texts: Record<string, ProjectText> = {",
    ...slugs.map((s) => `  "${s}": ${ident(s)},`),
    "};",
    "",
  ].join("\n");
}

// Fichiers dont le contenu diffère de la version chargée.
export function changedFiles(docs, base) {
  const now = serialize(docs, base);
  const before = base.serialized ??= serialize(base.docs, base);
  return Object.keys({ ...now, ...before })
    .filter((p) => now[p] !== before[p])
    .filter((p) => !(now[p] === null && !(p in base.tree.files)))
    .map((p) => ({ path: p, text: now[p] }));
}

// Médias encore utilisés par le site (les ajouts non utilisés ne sont pas envoyés).
export function usedMedia(docs) {
  const used = new Set();
  for (const p of docs.projects) {
    for (const i of p.images) { used.add(repoPath(i.src)); if (i.sm) used.add(repoPath(i.sm)); }
    if (p.cover) used.add(repoPath(p.cover.src));
    if (p.hover) used.add(repoPath(p.hover.src));
  }
  for (const s of docs.site.videos ?? []) { used.add(`public/videos/${s}.mp4`); used.add(`public/videos/${s}.jpg`); }
  return used;
}

// Problèmes qui casseraient le site : la publication est bloquée tant qu'il en reste.
export function validate(docs) {
  const errors = [];
  const warnings = [];
  const seen = new Set();
  for (const p of docs.projects) {
    const name = docs.site.titles?.[p.slug] ?? p.title;
    if (!p.slug) errors.push(`Un projet n'a pas d'identifiant.`);
    if (seen.has(p.slug)) errors.push(`Deux projets ont le même identifiant « ${p.slug} ».`);
    seen.add(p.slug);
    if (!p.images.length) errors.push(`« ${name} » n'a aucune planche.`);
    if (!p.cover) errors.push(`« ${name} » n'a pas de vignette pour l'index (choisir une couverture).`);
    if (p.images.length && p.images.every((i) => i.proc)) warnings.push(`« ${name} » : toutes les planches sont en processus, l'onglet produit sera vide.`);
    if (!p.text.intro?.trim()) warnings.push(`« ${name} » n'a pas de texte de présentation.`);
    p.images.forEach((i, n) => { if (!i.caption?.trim()) warnings.push(`« ${name} », planche ${n + 1} : pas de légende.`); });
  }
  for (const [s, list] of Object.entries(docs.embeds)) for (const e of list) if (!/^[\w-]{11}$/.test(e.youtube)) errors.push(`Vidéo YouTube invalide sur « ${s} » : ${e.youtube || "(vide)"}.`);
  const c = docs.pages.contact;
  if (c && !/@/.test(c.email ?? "")) errors.push("Page contact : adresse e-mail invalide.");
  return { errors, warnings };
}
