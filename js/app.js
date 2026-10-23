// Éditeur en ligne du portfolio : projets, planches, vidéos, pages ; aperçu en direct, annuler, versions,
// corbeille, édition par lot, puis publication en un commit sur le dépôt du portfolio.
import { OWNER, REPO, SITE, THEMES, RAW_BASE, MOCK } from "./config.js";
import * as gh from "./github.js";
import { load, changedFiles, usedMedia, validate, repoPath, slugify, emptyText } from "./model.js";
import { S, change, undo, redo, backTo, reset, refresh, subscribe, loadDraft, clearDraft, setDirtyCheck } from "./store.js";
import { plate, thumb, poster, sizeOf, mb } from "./media.js";
import { $, $$, h, toast, modal, confirmBox, sortable, debounce } from "./dom.js";
import { SCHEMAS, form } from "./forms.js";
import { projectPreview, pagePreview } from "./preview.js";

// ---------- état de l'interface ----------
const ui = {
  route: { kind: "home" }, // home | project(slug) | page(name) | versions | corbeille
  filter: "toutes", // planches affichées : toutes | produit | processus
  sel: new Set(), // planches sélectionnées (src)
  anchor: null,
  previewOn: localStorage.getItem("ed:preview") !== "0",
  previewDevice: localStorage.getItem("ed:device") ?? "ordinateur",
  previewView: "produit",
  search: "",
  deploy: null, // { sha, status, conclusion, url }
};

const titleOf = (p) => S.docs.site.titles?.[p.slug] ?? p.title;
const project = (slug = ui.route.slug) => S.docs.projects.find((p) => p.slug === slug);
const rawUrl = (path, ref = S.base.sha) => `${RAW_BASE}/${ref}/${path.split("/").map(encodeURIComponent).join("/")}`;
const blobUrls = new WeakMap();
function urlOf(src) {
  const path = src.startsWith("public/") ? src : repoPath(src);
  const b = S.uploads.get(path);
  if (!b) return rawUrl(path);
  if (!blobUrls.has(b)) blobUrls.set(b, URL.createObjectURL(b));
  return blobUrls.get(b);
}

function pending() {
  const files = changedFiles(S.docs, S.base);
  const used = usedMedia(S.docs);
  const media = [...S.uploads].filter(([p]) => used.has(p)).map(([path, blob]) => ({ path, blob }));
  return { files, media };
}
setDirtyCheck(() => { const p = pending(); return p.files.length + p.media.length > 0; });

// ---------- connexion ----------
const TOKEN_KEY = "ed:token";
function savedToken() { return localStorage.getItem(TOKEN_KEY) ?? sessionStorage.getItem(TOKEN_KEY); }

function loginScreen(error) {
  const tokenUrl =
    "https://github.com/settings/personal-access-tokens/new?name=" + encodeURIComponent("Éditeur du portfolio") +
    "&description=" + encodeURIComponent("Modifier le portfolio depuis portfolio-editeur") +
    `&target_name=${OWNER}&expires_in=366&contents=write`;
  const input = h("input", { type: "password", placeholder: "github_pat_…", autocomplete: "off", spellcheck: "false" });
  const remember = h("input", { type: "checkbox", checked: true });
  const go = async () => {
    const t = input.value.trim();
    if (!t) return;
    (remember.checked ? localStorage : sessionStorage).setItem(TOKEN_KEY, t);
    start();
  };
  input.addEventListener("keydown", (e) => e.key === "Enter" && go());
  document.body.replaceChildren(
    h("div", { class: "login" },
      h("h1", {}, "Éditeur du portfolio"),
      h("p", { class: "muted" }, `Modifie ${OWNER}/${REPO} directement sur GitHub ; chaque publication met le site à jour en 1 à 2 minutes.`),
      error && h("p", { class: "error" }, error),
      h("ol", {},
        h("li", {}, h("a", { href: tokenUrl, target: "_blank", rel: "noreferrer" }, "Créer un jeton GitHub ↗"), " (jeton « fine-grained »)."),
        h("li", {}, "Repository access : « Only select repositories » → ", h("b", {}, REPO), "."),
        h("li", {}, "Permissions : ", h("b", {}, "Contents : Read and write"), " ; en option ", h("b", {}, "Actions : Read-only"), " pour voir dans l'éditeur quand le site est à jour."),
        h("li", {}, "Copier le jeton et le coller ici.")),
      h("label", { class: "field" }, h("span", {}, "jeton"), input),
      h("label", { class: "check" }, remember, "se souvenir sur cet appareil"),
      h("p", { class: "hint" }, "Le jeton reste dans ce navigateur et ne part que vers api.github.com."),
      h("button", { class: "primary", onclick: go }, "Ouvrir l'éditeur"))
  );
  input.focus();
}

// ---------- démarrage ----------
async function start() {
  const token = savedToken();
  if (!token) return loginScreen();
  gh.setToken(token);
  document.body.replaceChildren(h("div", { class: "loading" }, h("p", {}, "Connexion à GitHub…"), h("progress", {})));
  try {
    const info = await gh.repoInfo();
    if (!info.permissions?.push) throw new Error(`Ce jeton ne peut pas écrire dans ${OWNER}/${REPO} (il faut « Contents : Read and write »).`);
  } catch (e) {
    localStorage.removeItem(TOKEN_KEY);
    sessionStorage.removeItem(TOKEN_KEY);
    return loginScreen(e.status === 401 ? "Jeton refusé par GitHub (expiré ou mal copié)." : e.message);
  }
  const draft = await loadDraft();
  let resume = false;
  if (draft) {
    resume = await modal((close) =>
      h("div", {},
        h("h2", {}, "Reprendre le brouillon ?"),
        h("p", { class: "muted" }, `Des modifications non publiées ont été gardées le ${new Date(draft.savedAt).toLocaleString("fr-FR")}.`),
        h("div", { class: "row end" },
          h("button", { onclick: async () => { if (await confirmBox("Jeter le brouillon ?", "Ces modifications seront perdues.", "Jeter", true)) { await clearDraft(); close(false); } } }, "Jeter le brouillon"),
          h("button", { class: "primary", onclick: () => close(true) }, "Reprendre")))
    );
  }
  const progress = h("progress", { max: 1, value: 0 });
  document.body.replaceChildren(h("div", { class: "loading" }, h("p", {}, "Chargement du portfolio…"), progress));
  try {
    const sha = resume ? draft.baseSha : await gh.headSha();
    const base = await load(sha, (n, total) => { progress.max = total; progress.value = n; });
    if (resume) {
      for (const [p, b] of draft.uploads) S.uploads.set(p, b);
      reset(base, draft.docs);
      S.undo = draft.undo ?? [];
    } else reset(base);
  } catch (e) {
    document.body.replaceChildren(h("div", { class: "loading" }, h("p", { class: "error" }, `Chargement impossible : ${e.message}`), h("button", { onclick: start }, "Réessayer")));
    return;
  }
  shell();
  route();
  window.addEventListener("hashchange", route);
  subscribe((soft) => (soft ? chrome() : render()));
  render();
}

// ---------- squelette ----------
function shell() {
  document.body.replaceChildren(
    h("header", { id: "top" }),
    h("div", { id: "layout" },
      h("aside", { id: "side" }),
      h("section", { id: "main", tabindex: "-1" }),
      h("section", { id: "preview" },
        h("div", { class: "preview-bar" },
          h("span", { id: "preview-label" }, "aperçu"),
          h("span", { class: "seg" },
            ...["ordinateur", "téléphone"].map((d) => h("button", { dataset: { device: d }, onclick: () => { ui.previewDevice = d; localStorage.setItem("ed:device", d); schedulePreview(true); } }, d)))),
        h("div", { id: "frame-wrap" }, h("iframe", { id: "frame", title: "Aperçu de la page" })))),
    h("div", { id: "toast" })
  );
  window.addEventListener("message", (e) => {
    if (e.data?.previewView) { ui.previewView = e.data.previewView; schedulePreview(); }
  });
  new ResizeObserver(() => scaleFrame()).observe($("#frame-wrap"));
}

function route() {
  const [kind, arg] = decodeURIComponent(location.hash.slice(1)).split("/");
  if (kind === "projet" && project(arg)) ui.route = { kind: "project", slug: arg };
  else if (kind === "page" && SCHEMAS[arg]) ui.route = { kind: "page", name: arg };
  else if (kind === "versions" || kind === "corbeille") ui.route = { kind };
  else ui.route = { kind: "home" };
  ui.sel.clear();
  render();
  $("#main")?.scrollTo(0, 0);
}
const go = (hash) => (location.hash = hash);

function render() {
  if (!$("#main")) return;
  if (ui.route.kind === "project" && !project()) ui.route = { kind: "home" };
  chrome();
  const main = $("#main");
  const y = main.scrollTop;
  main.replaceChildren(
    ui.route.kind === "project" ? projectView() :
    ui.route.kind === "page" ? pageView() :
    ui.route.kind === "versions" ? versionsView() :
    ui.route.kind === "corbeille" ? corbeilleView() : homeView()
  );
  main.scrollTop = y;
}

// en-tête + barre latérale + aperçu (assez léger pour chaque frappe)
function chrome() {
  renderTop();
  renderSide();
  schedulePreview();
}

function renderTop() {
  const { files, media } = pending();
  const n = files.length + media.length;
  const u = S.undo.at(-1), r = S.redo.at(-1);
  const dep = ui.deploy;
  $("#top").replaceChildren(...[
    h("a", { class: "brand", href: "#" }, "Éditeur du portfolio"),
    MOCK && h("span", { class: "chip err" }, "mode essai (faux GitHub local)"),
    h("span", { class: `chip ${n ? "warn" : "ok"}` }, n ? `${n} modification${n > 1 ? "s" : ""} non publiée${n > 1 ? "s" : ""} · brouillon gardé` : "à jour avec le site"),
    dep && h("a", { class: `chip ${dep.untracked ? "" : dep.conclusion === "success" ? "ok" : dep.conclusion ? "err" : "busy"}`, href: dep.url, target: "_blank", rel: "noreferrer",
        title: dep.untracked ? "Ajouter la permission « Actions : Read-only » au jeton pour suivre le déploiement ici" : undefined },
      dep.untracked ? "publié · déploiement à suivre sur GitHub ↗" : dep.conclusion === "success" ? "en ligne ✓" : dep.conclusion ? "échec du déploiement ↗" : "déploiement en cours…"),
    h("span", { class: "sp" }),
    h("button", { class: "ghost", disabled: !u, title: u ? `Annuler : ${u.label} (Ctrl+Z)` : "Rien à annuler", onclick: doUndo }, "↶ annuler"),
    h("button", { class: "ghost", disabled: !r, title: r ? `Rétablir : ${r.label} (Ctrl+Maj+Z)` : "Rien à rétablir", onclick: doRedo }, "↷ rétablir"),
    h("button", { class: `ghost ${ui.previewOn ? "on" : ""}`, title: "Afficher ou masquer l'aperçu (Ctrl+P)", onclick: togglePreview }, "aperçu"),
    h("button", { class: "ghost", title: "Raccourcis clavier (?)", onclick: shortcuts }, "?"),
    h("button", { class: "primary", disabled: !n, title: "Publier en ligne (Ctrl+S)", onclick: publish }, "Publier"),
    h("button", { class: "ghost small", title: "Oublier le jeton sur cet appareil", onclick: logout }, "déconnexion"),
  ].filter(Boolean));
  document.body.classList.toggle("no-preview", !ui.previewOn);
  document.title = `${n ? "● " : ""}Éditeur du portfolio`;
}

function projectDirty(p) {
  const b = S.base.docs.projects.find((x) => x.slug === p.slug);
  return !b || JSON.stringify(b) !== JSON.stringify(p) || (S.base.docs.site.titles?.[p.slug] !== S.docs.site.titles?.[p.slug]);
}

function renderSide() {
  const side = $("#side");
  const y = side.scrollTop;
  const q = ui.search.toLowerCase();
  const list = h("ol", { class: "projects" },
    S.docs.projects.map((p) =>
      h("li", { dataset: { key: p.slug }, hidden: !!q && !titleOf(p).toLowerCase().includes(q), class: ui.route.slug === p.slug ? "sel" : "", onclick: () => go(`projet/${p.slug}`) },
        p.cover ? h("img", { src: urlOf(p.cover.src), alt: "", loading: "lazy" }) : h("span", { class: "noimg" }),
        h("span", { class: "t" }, titleOf(p)),
        projectDirty(p) && h("span", { class: "dot", title: "modifié" }),
        h("span", { class: "n" }, p.images.length))));
  const pages = S.base ? Object.keys(SCHEMAS) : [];
  const pageDirty = (k) => JSON.stringify(S.docs.pages[k]) !== JSON.stringify(S.base.docs.pages[k]);
  // filtrer sans redessiner : le champ garde le curseur
  const search = h("input", {
    type: "search", placeholder: "chercher un projet", value: ui.search,
    oninput: (e) => {
      ui.search = e.target.value;
      const s = ui.search.toLowerCase();
      $$("#side .projects li").forEach((li) => (li.hidden = !!s && !li.textContent.toLowerCase().includes(s)));
    },
  });
  side.replaceChildren(
    h("div", { class: "side-head" }, h("span", {}, `Projets (${S.docs.projects.length})`), h("button", { class: "small", onclick: newProject }, "+ nouveau")),
    search,
    h("p", { class: "hint" }, "Glisser pour changer l'ordre sur le site."),
    list,
    h("div", { class: "side-head" }, h("span", {}, "Pages")),
    h("ol", { class: "links" }, pages.map((k) =>
      h("li", { class: ui.route.name === k ? "sel" : "", onclick: () => go(`page/${k}`) }, k, pageDirty(k) && h("span", { class: "dot" })))),
    h("div", { class: "side-head" }, h("span", {}, "Outils")),
    h("ol", { class: "links" },
      h("li", { class: ui.route.kind === "versions" ? "sel" : "", onclick: () => go("versions") }, "versions et historique"),
      h("li", { class: ui.route.kind === "corbeille" ? "sel" : "", onclick: () => go("corbeille") }, "corbeille", S.docs.corbeille.projets.length ? h("span", { class: "n" }, S.docs.corbeille.projets.length) : null),
      h("li", { onclick: () => window.open(SITE, "_blank") }, "site en ligne ↗"))
  );
  sortable(list, "li", (order) =>
      change("Ordre des projets", (d) => d.projects.sort((a, b) => order.indexOf(a.slug) - order.indexOf(b.slug))));
  side.scrollTop = y;
}

// ---------- aperçu ----------
let lastDoc = "";
const schedulePreview = debounce((force) => drawPreview(force), 200);
function drawPreview(force) {
  if (!ui.previewOn) return;
  let html, label;
  if (ui.route.kind === "project") {
    const p = project();
    const video = (S.docs.site.videos ?? []).includes(p.slug) ? { src: urlOf(`public/videos/${p.slug}.mp4`), poster: urlOf(`public/videos/${p.slug}.jpg`) } : null;
    html = projectPreview({ project: p, title: titleOf(p), view: ui.previewView, urlOf, video, embeds: S.docs.embeds[p.slug] });
    label = `aperçu · ${titleOf(p)} · ${ui.previewView}`;
  } else if (ui.route.kind === "page") {
    html = pagePreview(ui.route.name, S.docs.pages[ui.route.name]);
    label = `aperçu · page ${ui.route.name}`;
  } else {
    html = "";
    label = "aperçu : choisir un projet ou une page";
  }
  $("#preview-label").textContent = label;
  $$("#preview .seg button").forEach((b) => b.classList.toggle("on", b.dataset.device === ui.previewDevice));
  const frame = $("#frame");
  if (html === lastDoc && !force) return scaleFrame();
  lastDoc = html;
  const y = frame.contentWindow?.scrollY ?? 0;
  frame.onload = () => frame.contentWindow.scrollTo(0, y);
  frame.srcdoc = html;
  scaleFrame();
}
function scaleFrame() {
  const wrap = $("#frame-wrap"), frame = $("#frame");
  if (!wrap || !frame) return;
  const w = ui.previewDevice === "téléphone" ? 390 : 1280;
  const k = Math.min(1, wrap.clientWidth / w);
  frame.style.width = `${w}px`;
  frame.style.height = `${wrap.clientHeight / k}px`;
  frame.style.transform = `scale(${k})`;
  frame.style.marginLeft = `${Math.max(0, (wrap.clientWidth - w * k) / 2)}px`;
}
function togglePreview() {
  ui.previewOn = !ui.previewOn;
  localStorage.setItem("ed:preview", ui.previewOn ? "1" : "0");
  renderTop();
  if (ui.previewOn) drawPreview(true);
}

// ---------- accueil ----------
function homeView() {
  const { files, media } = pending();
  const { errors, warnings } = validate(S.docs);
  return h("div", { class: "page" },
    h("h1", {}, "Bonjour"),
    h("p", { class: "muted" }, `Version chargée : ${S.base.sha.slice(0, 7)} du ${new Date(S.base.tree.date).toLocaleString("fr-FR")}. Choisir un projet ou une page à gauche.`),
    h("div", { class: "stats" },
      stat(S.docs.projects.length, "projets"),
      stat(S.docs.projects.reduce((n, p) => n + p.images.length, 0), "planches"),
      stat(S.docs.projects.reduce((n, p) => n + p.images.filter((i) => i.proc).length, 0), "en processus"),
      stat(files.length + media.length, "modifications à publier")),
    errors.length ? h("div", { class: "box err" }, h("b", {}, "À corriger avant de publier"), h("ul", {}, errors.map((e) => h("li", {}, e)))) : null,
    warnings.length ? h("details", { class: "box" }, h("summary", {}, `${warnings.length} remarque${warnings.length > 1 ? "s" : ""} (légendes ou textes manquants)`), h("ul", {}, warnings.map((e) => h("li", {}, e)))) : null,
    files.length + media.length
      ? h("div", { class: "box" }, h("b", {}, "En attente de publication"),
          h("ul", {}, files.map((f) => h("li", {}, f.text === null ? `suppression de ${f.path}` : f.path)), media.map((m) => h("li", {}, `${m.path} (${mb(m.blob.size)})`))))
      : null,
    h("div", { class: "box" }, h("b", {}, "Journal de la session"),
      S.undo.length ? h("ol", { class: "journal" }, S.undo.map((u, n) => h("li", {}, h("span", {}, u.label), h("span", { class: "muted" }, new Date(u.t).toLocaleTimeString("fr-FR")), h("button", { class: "ghost small", onclick: () => { backTo(n); toast("Retour à cette étape"); } }, "revenir avant"))).reverse())
        : h("p", { class: "muted" }, "Aucune modification pour l'instant.")));
}
const stat = (n, label) => h("div", { class: "stat" }, h("b", {}, n), h("span", {}, label));

// ---------- projet ----------
function projectView() {
  const p = project();
  const slug = p.slug;
  const txt = (key, label, opts = {}) =>
    h("label", { class: "field" }, h("span", {}, label),
      h(opts.area ? "textarea" : "input", {
        rows: opts.area ? 7 : undefined,
        value: opts.area ? undefined : p.text[key] ?? "",
        placeholder: opts.placeholder,
        oninput: (e) => change(`${titleOf(p)} : ${label}`, (d) => {
          const t = d.projects.find((x) => x.slug === slug).text;
          const v = e.target.value;
          if (opts.optional && !v.trim()) delete t[key];
          else t[key] = opts.nullable && !v.trim() ? null : v;
        }, { coalesce: `${slug}.${key}`, soft: true }),
      }, opts.area ? p.text[key] ?? "" : null));

  const themes = new Set([...THEMES, ...(p.text.themes ?? [])]);
  const isVideo = (S.docs.site.videos ?? []).includes(slug);
  const embeds = S.docs.embeds[slug] ?? [];

  return h("div", { class: "page" },
    h("div", { class: "row" },
      h("input", {
        class: "title-input", value: titleOf(p), "aria-label": "titre",
        oninput: (e) => change(`Titre de ${p.slug}`, (d) => { d.site.titles = { ...d.site.titles, [slug]: e.target.value }; }, { coalesce: `${slug}.title`, soft: true }),
      }),
      h("span", { class: "sp" }),
      h("a", { class: "button ghost", href: `${SITE}/projets/${slug}/`, target: "_blank", rel: "noreferrer" }, "voir en ligne ↗"),
      h("button", { class: "danger", onclick: () => removeProject(p) }, "retirer le projet")),
    h("p", { class: "hint" }, `adresse : /projets/${slug}/`),

    h("div", { class: "grid2" },
      txt("year", "année", { nullable: true }),
      txt("context", "contexte", { nullable: true, placeholder: "projet personnel, ENSAAMA…" }),
      txt("team", "équipe", { optional: true }),
      txt("ensaama", "lien ENSAAMA (sur le mot « ENSAAMA » du contexte)", { optional: true, placeholder: "https://ensaama.net/…" })),
    h("div", { class: "field" }, h("span", {}, "thèmes"),
      h("div", { class: "chips" }, [...themes].map((t) =>
        h("button", {
          class: `chip-btn ${(p.text.themes ?? []).includes(t) ? "on" : ""}`,
          onclick: () => change(`${titleOf(p)} : thèmes`, (d) => {
            const x = d.projects.find((x) => x.slug === slug).text;
            x.themes = x.themes?.includes(t) ? x.themes.filter((y) => y !== t) : [...(x.themes ?? []), t];
          }),
        }, t)),
        h("button", { class: "chip-btn add", onclick: async () => {
          const t = prompt("Nouveau thème :")?.trim().toLowerCase();
          if (t) change(`${titleOf(p)} : thèmes`, (d) => { const x = d.projects.find((x) => x.slug === slug).text; x.themes = [...new Set([...(x.themes ?? []), t])]; });
        } }, "+"))),
    txt("intro", "texte de présentation", { area: true }),

    h("h2", {}, "Index"),
    h("div", { class: "media-row" },
      mediaBox("vignette de l'index", p.cover, "Changer depuis un fichier", (f) => setCover(slug, f, "_covers")),
      mediaBox("image au survol (l'objet en usage)", p.hover, p.hover ? "Changer" : "Ajouter", (f) => setHover(slug, f),
        p.hover && (() => change(`${titleOf(p)} : image de survol retirée`, (d) => { d.projects.find((x) => x.slug === slug).hover = null; })))),

    h("h2", {}, "Vidéos"),
    h("div", { class: "media-row" },
      h("div", { class: "media-box" },
        h("span", { class: "muted" }, "vidéo de présentation (téléphone, onglet produit)"),
        isVideo ? h("video", { src: urlOf(`public/videos/${slug}.mp4`), poster: urlOf(`public/videos/${slug}.jpg`), muted: true, controls: true, preload: "none" }) : h("div", { class: "empty-media" }, "aucune"),
        h("div", { class: "row" },
          filePick("video/mp4,video/webm", isVideo ? "Remplacer" : "Ajouter une vidéo", (f) => setVideo(slug, f[0])),
          isVideo && h("button", { class: "ghost small", onclick: () => change(`${titleOf(p)} : vidéo retirée`, (d) => { d.site.videos = d.site.videos.filter((s) => s !== slug); }) }, "retirer")))),
    embedsEditor(p, embeds),

    platesEditor(p)
  );
}

function mediaBox(label, img, pickLabel, onFile, onRemove) {
  return h("div", { class: "media-box" },
    h("span", { class: "muted" }, label),
    img ? h("img", { src: urlOf(img.src), alt: "" }) : h("div", { class: "empty-media" }, "aucune"),
    h("div", { class: "row" }, filePick("image/*", pickLabel, (f) => onFile(f[0])), onRemove && h("button", { class: "ghost small", onclick: onRemove }, "retirer")));
}

function filePick(accept, label, onFiles, multiple = false) {
  const input = h("input", { type: "file", accept, multiple, hidden: true, onchange: (e) => { if (e.target.files.length) onFiles([...e.target.files]); e.target.value = ""; } });
  return h("span", {}, input, h("button", { class: "small", onclick: () => input.click() }, label));
}

const parseYouTube = (s) => s.match(/(?:v=|youtu\.be\/|shorts\/|embed\/)([\w-]{11})/)?.[1] ?? s.trim();

function embedsEditor(p, embeds) {
  const slug = p.slug;
  const edit = (label, fn, opts) => change(`${titleOf(p)} : ${label}`, (d) => { d.embeds[slug] ??= []; fn(d.embeds[slug]); if (!d.embeds[slug].length) delete d.embeds[slug]; }, opts);
  return h("div", { class: "list" },
    h("div", { class: "list-head" }, h("span", {}, `vidéos YouTube (${embeds.length}) — jamais copiées, lues depuis YouTube`),
      h("button", { class: "small", onclick: () => {
        const url = prompt("Lien de la vidéo YouTube :");
        if (url) edit("vidéo YouTube ajoutée", (l) => l.push({ youtube: parseYouTube(url), title: "", credit: "vidéo : … (youtube)", vertical: /shorts\//.test(url) }));
      } }, "+ ajouter")),
    embeds.map((e, n) =>
      h("div", { class: "embed" },
        h("img", { src: `https://i.ytimg.com/vi/${e.youtube}/mqdefault.jpg`, alt: "" }),
        h("div", { class: "fields-stack" },
          h("label", { class: "field" }, h("span", {}, "lien ou identifiant"), h("input", { value: e.youtube, oninput: (ev) => edit("vidéo YouTube", (l) => (l[n].youtube = parseYouTube(ev.target.value)), { coalesce: `${slug}.yt${n}`, soft: true }) })),
          h("label", { class: "field" }, h("span", {}, "titre"), h("input", { value: e.title, oninput: (ev) => edit("vidéo YouTube", (l) => (l[n].title = ev.target.value), { coalesce: `${slug}.ytt${n}`, soft: true }) })),
          h("label", { class: "field" }, h("span", {}, "crédit affiché"), h("input", { value: e.credit, oninput: (ev) => edit("vidéo YouTube", (l) => (l[n].credit = ev.target.value), { coalesce: `${slug}.ytc${n}`, soft: true }) })),
          h("label", { class: "check" }, h("input", { type: "checkbox", checked: e.vertical, onchange: (ev) => edit("vidéo YouTube", (l) => (l[n].vertical = ev.target.checked)) }), "vidéo verticale")),
        h("div", { class: "col" },
          h("button", { class: "ghost small", disabled: n === 0, onclick: () => edit("ordre des vidéos", (l) => l.splice(n - 1, 0, ...l.splice(n, 1))) }, "↑"),
          h("button", { class: "ghost small", disabled: n === embeds.length - 1, onclick: () => edit("ordre des vidéos", (l) => l.splice(n + 1, 0, ...l.splice(n, 1))) }, "↓"),
          h("button", { class: "ghost small danger-text", onclick: () => edit("vidéo YouTube retirée", (l) => l.splice(n, 1)) }, "✕")))));
}

// ---------- planches ----------
function platesEditor(p) {
  const slug = p.slug;
  const all = p.images;
  const visible = all.filter((i) => ui.filter === "toutes" || i.proc === (ui.filter === "processus"));
  for (const s of [...ui.sel]) if (!all.some((i) => i.src === s)) ui.sel.delete(s);
  const nProc = all.filter((i) => i.proc).length;
  const coverName = S.docs.site.covers?.[slug];

  const grid = h("div", { class: "grid", id: "plates" },
    visible.map((img) => {
      const n = all.indexOf(img);
      const name = img.src.split("/").pop().replace(/\.[^.]+$/, "");
      const selected = ui.sel.has(img.src);
      const card = h("div", { class: `card ${img.proc ? "proc" : ""} ${selected ? "selected" : ""}`, dataset: { key: img.src } },
        h("span", { class: "num" }, n + 1),
        coverName === name && h("span", { class: "cov" }, "vignette"),
        h("button", { class: "pick", title: "Sélectionner (Ctrl/Maj + clic pour plusieurs)", onclick: (e) => pickCard(e, img.src, visible) },
          h("img", { src: urlOf(img.sm ?? img.src), alt: "", loading: "lazy" })),
        h("div", { class: "seg" },
          h("button", { class: img.proc ? "" : "on", onclick: () => setProc(slug, [img.src], false) }, "produit"),
          h("button", { class: img.proc ? "on" : "", onclick: () => setProc(slug, [img.src], true) }, "processus")),
        h("textarea", {
          class: "cap", rows: 2, placeholder: "légende",
          oninput: (e) => change(`${titleOf(p)} : légende ${n + 1}`, (d) => { d.projects.find((x) => x.slug === slug).images.find((i) => i.src === img.src).caption = e.target.value; }, { coalesce: `${slug}.cap.${img.src}`, soft: true }),
        }, img.caption),
        h("div", { class: "acts" },
          h("button", { class: "ghost small", onclick: () => coverFromPlate(slug, img) }, "vignette"),
          h("a", { class: "ghost small", href: urlOf(img.src), target: "_blank", rel: "noreferrer" }, "ouvrir"),
          h("button", { class: "ghost small danger-text", onclick: () => removePlates(slug, [img.src]) }, "retirer")));
      return card;
    }),
    dropZone(slug));

  sortable(grid, ".card", (keys) => change(`${titleOf(p)} : ordre des planches`, (d) => {
    const pr = d.projects.find((x) => x.slug === slug);
    // les planches masquées par le filtre gardent leur place ; les visibles prennent le nouvel ordre
    const vis = new Set(keys);
    const byKey = Object.fromEntries(pr.images.map((i) => [i.src, i]));
    const queue = keys.map((k) => byKey[k]);
    pr.images = pr.images.map((i) => (vis.has(i.src) ? queue.shift() : i));
  }));

  const selCount = ui.sel.size;
  const others = S.docs.projects.filter((x) => x.slug !== slug);
  return h("div", {},
    h("div", { class: "row plates-head" },
      h("h2", {}, `Planches (${all.length})`),
      h("span", { class: "seg big" },
        ...[["toutes", all.length], ["produit", all.length - nProc], ["processus", nProc]].map(([f, c]) =>
          h("button", { class: ui.filter === f ? "on" : "", onclick: () => { ui.filter = f; ui.sel.clear(); if (f !== "toutes") ui.previewView = f; render(); } }, `${f} ${c}`))),
      h("span", { class: "sp" }),
      h("span", { class: "hint" }, "clic : sélectionner · glisser : réordonner · touches 1 / 2 : produit / processus")),
    selCount
      ? h("div", { class: "batch" },
          h("b", {}, `${selCount} sélectionnée${selCount > 1 ? "s" : ""}`),
          h("button", { class: "small", onclick: () => setProc(slug, [...ui.sel], false) }, "→ produit"),
          h("button", { class: "small", onclick: () => setProc(slug, [...ui.sel], true) }, "→ processus"),
          h("button", { class: "small", onclick: () => moveSel(slug, "start") }, "⇤ au début"),
          h("button", { class: "small", onclick: () => moveSel(slug, "end") }, "à la fin ⇥"),
          h("select", { onchange: (e) => { if (e.target.value) moveToProject(slug, e.target.value); } },
            h("option", { value: "" }, "déplacer vers le projet…"), others.map((o) => h("option", { value: o.slug }, titleOf(o)))),
          h("button", { class: "small", onclick: () => { const t = prompt("Légende pour toutes les planches sélectionnées :"); if (t != null) change(`${titleOf(p)} : légendes`, (d) => d.projects.find((x) => x.slug === slug).images.forEach((i) => ui.sel.has(i.src) && (i.caption = t))); } }, "légende commune"),
          h("button", { class: "small danger", onclick: () => removePlates(slug, [...ui.sel]) }, "retirer"),
          h("span", { class: "sp" }),
          h("button", { class: "ghost small", onclick: () => { ui.sel.clear(); render(); } }, "tout désélectionner (Échap)"))
      : null,
    grid);
}

function pickCard(e, src, visible) {
  const keys = visible.map((i) => i.src);
  if (e.shiftKey && ui.anchor && keys.includes(ui.anchor)) {
    const [a, b] = [keys.indexOf(ui.anchor), keys.indexOf(src)].sort((x, y) => x - y);
    keys.slice(a, b + 1).forEach((k) => ui.sel.add(k));
  } else if (e.ctrlKey || e.metaKey) {
    ui.sel.has(src) ? ui.sel.delete(src) : ui.sel.add(src);
    ui.anchor = src;
  } else {
    const only = ui.sel.size === 1 && ui.sel.has(src);
    ui.sel.clear();
    if (!only) ui.sel.add(src);
    ui.anchor = src;
  }
  render();
}

function setProc(slug, srcs, proc) {
  const p = project(slug);
  change(`${titleOf(p)} : ${srcs.length > 1 ? `${srcs.length} planches` : "planche"} → ${proc ? "processus" : "produit"}`, (d) =>
    d.projects.find((x) => x.slug === slug).images.forEach((i) => srcs.includes(i.src) && (i.proc = proc)));
  if (srcs.length === 1) ui.previewView = proc ? "processus" : "produit";
}

function moveSel(slug, where) {
  change(`${titleOf(project(slug))} : déplacement de planches`, (d) => {
    const pr = d.projects.find((x) => x.slug === slug);
    const picked = pr.images.filter((i) => ui.sel.has(i.src));
    const rest = pr.images.filter((i) => !ui.sel.has(i.src));
    pr.images = where === "start" ? [...picked, ...rest] : [...rest, ...picked];
  });
}
function nudgeSel(slug, delta) {
  change(`${titleOf(project(slug))} : déplacement de planches`, (d) => {
    const imgs = d.projects.find((x) => x.slug === slug).images;
    const idx = imgs.map((i, n) => (ui.sel.has(i.src) ? n : -1)).filter((n) => n >= 0);
    if (!idx.length || (delta < 0 && idx[0] === 0) || (delta > 0 && idx.at(-1) === imgs.length - 1)) return;
    for (const n of delta < 0 ? idx : idx.reverse()) [imgs[n], imgs[n + delta]] = [imgs[n + delta], imgs[n]];
  }, { coalesce: `${slug}.nudge` });
}

function moveToProject(slug, target) {
  const n = ui.sel.size;
  change(`${n} planche${n > 1 ? "s" : ""} déplacée${n > 1 ? "s" : ""} vers ${titleOf(project(target))}`, (d) => {
    const from = d.projects.find((x) => x.slug === slug);
    const to = d.projects.find((x) => x.slug === target);
    to.images.push(...from.images.filter((i) => ui.sel.has(i.src)));
    from.images = from.images.filter((i) => !ui.sel.has(i.src));
  });
  ui.sel.clear();
  toast(`Déplacé vers ${titleOf(project(target))}`);
  render();
}

async function removePlates(slug, srcs) {
  const p = project(slug);
  if (srcs.length >= p.images.length) return toast("Un projet garde au moins une planche (sinon, retirer le projet).", "error");
  if (srcs.length > 1 && !(await confirmBox(`Retirer ${srcs.length} planches ?`, "Elles restent dans la corbeille (rien n'est effacé du dépôt).", "Retirer", true))) return;
  change(`${titleOf(p)} : ${srcs.length > 1 ? `${srcs.length} planches retirées` : "planche retirée"}`, (d) => {
    const pr = d.projects.find((x) => x.slug === slug);
    pr.images = pr.images.filter((i) => !srcs.includes(i.src));
  });
  srcs.forEach((s) => ui.sel.delete(s));
  toast("Retiré — Ctrl+Z pour annuler");
}

function dropZone(slug) {
  const input = h("input", { type: "file", accept: "image/*", multiple: true, hidden: true, onchange: (e) => { addPlates(slug, [...e.target.files]); e.target.value = ""; } });
  const z = h("div", { class: "drop", onclick: () => input.click() }, input, "Déposer des images ici", h("br"), h("small", {}, "ou cliquer pour choisir — converties en WebP 2000 px dans le navigateur"));
  z.addEventListener("dragover", (e) => { if (e.dataTransfer.types.includes("Files")) { e.preventDefault(); z.classList.add("over"); } });
  z.addEventListener("dragleave", () => z.classList.remove("over"));
  z.addEventListener("drop", (e) => { if (!e.dataTransfer.files.length) return; e.preventDefault(); z.classList.remove("over"); addPlates(slug, [...e.dataTransfer.files].filter((f) => f.type.startsWith("image/"))); });
  return z;
}

// prochain numéro libre dans public/projects/<slug>/
function nextNumber(slug) {
  const dir = `public/projects/${slug}/`;
  const names = [...Object.keys(S.base.tree.files), ...S.uploads.keys(), ...S.docs.projects.flatMap((p) => p.images.map((i) => repoPath(i.src)))]
    .filter((p) => p.startsWith(dir))
    .map((p) => Number(p.slice(dir.length).match(/^(\d+)/)?.[1] ?? 0));
  return Math.max(0, ...names) + 1;
}
const stamp = () => Date.now().toString(36);

async function addPlates(slug, files) {
  if (!files.length) return;
  const p = project(slug);
  const added = [];
  for (const [k, f] of files.entries()) {
    toast(`Préparation ${k + 1}/${files.length} : ${f.name}…`);
    try {
      const { full, sm } = await plate(f);
      const name = String(nextNumber(slug)).padStart(2, "0");
      const fullPath = `public/projects/${slug}/${name}.${full.ext}`;
      S.uploads.set(fullPath, full.blob);
      let smSrc;
      if (sm) { const smPath = `public/projects/${slug}/${name}-sm.${sm.ext}`; S.uploads.set(smPath, sm.blob); smSrc = smPath.slice(6); }
      if (full.blob.size > 20 * 1048576) toast(`${f.name} pèse ${mb(full.blob.size)} : lourd pour le site.`, "error");
      added.push({ src: fullPath.slice(6), ...(smSrc && { sm: smSrc }), width: full.width, height: full.height, caption: "", proc: ui.filter === "processus" });
    } catch (e) {
      toast(`${f.name} : ${e.message}`, "error");
    }
  }
  if (!added.length) return;
  change(`${titleOf(p)} : ${added.length} planche${added.length > 1 ? "s" : ""} ajoutée${added.length > 1 ? "s" : ""}`, (d) => d.projects.find((x) => x.slug === slug).images.push(...added));
  if (!p.cover) await coverFromPlate(slug, added[0]);
  toast(`${added.length} planche${added.length > 1 ? "s" : ""} ajoutée${added.length > 1 ? "s" : ""}`);
}

async function blobOf(src) {
  const path = repoPath(src);
  return S.uploads.get(path) ?? (await (await fetch(rawUrl(path))).blob());
}

async function coverFromPlate(slug, img) {
  toast("Création de la vignette…");
  const t = await thumb(await blobOf(img.src));
  const path = `public/projects/${slug}/thumb-${stamp()}.${t.ext}`;
  S.uploads.set(path, t.blob);
  const name = img.src.split("/").pop().replace(/\.[^.]+$/, "");
  change(`${titleOf(project(slug))} : vignette de l'index`, (d) => {
    d.projects.find((x) => x.slug === slug).cover = { src: path.slice(6), width: t.width, height: t.height };
    d.site.covers = { ...d.site.covers, [slug]: name };
  });
  toast("Vignette choisie");
}
async function setCover(slug, file) {
  const t = await thumb(file);
  const path = `public/projects/${slug}/thumb-${stamp()}.${t.ext}`;
  S.uploads.set(path, t.blob);
  change(`${titleOf(project(slug))} : vignette de l'index`, (d) => {
    d.projects.find((x) => x.slug === slug).cover = { src: path.slice(6), width: t.width, height: t.height };
    d.site.covers = { ...d.site.covers, [slug]: "_covers" };
  });
}
async function setHover(slug, file) {
  const t = await thumb(file);
  const path = `public/projects/${slug}/hover-${stamp()}.${t.ext}`;
  S.uploads.set(path, t.blob);
  change(`${titleOf(project(slug))} : image de survol`, (d) => { d.projects.find((x) => x.slug === slug).hover = { src: path.slice(6), width: t.width, height: t.height }; });
}
async function setVideo(slug, file) {
  if (!file) return;
  if (file.size > 95 * 1048576) return toast(`Vidéo trop lourde (${mb(file.size)}) : GitHub refuse au-delà de 100 Mo. La compresser d'abord.`, "error");
  toast("Préparation de la vidéo…");
  try {
    const jpg = await poster(file);
    S.uploads.set(`public/videos/${slug}.mp4`, file);
    S.uploads.set(`public/videos/${slug}.jpg`, jpg);
    blobUrls.delete(file);
    change(`${titleOf(project(slug))} : vidéo`, (d) => { d.site.videos = [...new Set([...(d.site.videos ?? []), slug])]; });
    toast(`Vidéo prête (${mb(file.size)})`);
  } catch (e) {
    toast(e.message, "error");
  }
}

// ---------- projets : création, retrait ----------
async function newProject() {
  const title = await modal((close) => {
    const i = h("input", { placeholder: "Titre du projet", onkeydown: (e) => e.key === "Enter" && close(i.value.trim()) });
    setTimeout(() => i.focus());
    return h("div", {}, h("h2", {}, "Nouveau projet"), h("label", { class: "field" }, h("span", {}, "titre"), i),
      h("p", { class: "hint" }, "Il arrive en tête de l'index ; ajouter ensuite au moins une planche."),
      h("div", { class: "row end" }, h("button", { onclick: () => close(null) }, "Annuler"), h("button", { class: "primary", onclick: () => close(i.value.trim()) }, "Créer")));
  });
  if (!title) return;
  let slug = slugify(title) || "projet";
  const taken = (s) => S.docs.projects.some((p) => p.slug === s) || Object.keys(S.base.tree.files).some((p) => p.startsWith(`public/projects/${s}/`)) || S.docs.corbeille.projets.some((x) => x.project.slug === s);
  for (let k = 2; taken(slug); k++) slug = `${slugify(title)}-${k}`;
  change(`Nouveau projet : ${title}`, (d) => {
    d.projects.unshift({ slug, title, cover: null, hover: null, images: [], text: { slug, ...emptyText() } });
    d.site.titles = { ...d.site.titles, [slug]: title };
  });
  go(`projet/${slug}`);
}

async function removeProject(p) {
  if (!(await confirmBox(`Retirer « ${titleOf(p)} » du site ?`, "Il part dans la corbeille de l'éditeur, d'où on peut le remettre. Ses images restent dans le dépôt.", "Retirer", true))) return;
  const slug = p.slug;
  change(`Projet retiré : ${titleOf(p)}`, (d) => {
    const pr = d.projects.find((x) => x.slug === slug);
    d.corbeille.projets.unshift({
      retireLe: new Date().toISOString(),
      project: pr,
      titre: d.site.titles?.[slug],
      couverture: d.site.covers?.[slug],
      embeds: d.embeds[slug],
      video: (d.site.videos ?? []).includes(slug),
    });
    d.projects = d.projects.filter((x) => x.slug !== slug);
    delete d.embeds[slug];
    if (d.site.titles) delete d.site.titles[slug];
    if (d.site.covers) delete d.site.covers[slug];
    d.site.videos = (d.site.videos ?? []).filter((s) => s !== slug);
  });
  go("");
  toast("Projet retiré — Ctrl+Z pour annuler");
}

// ---------- pages ----------
function pageView() {
  const name = ui.route.name;
  const titles = { processus: "Page processus", cv: "CV", contact: "Contact et réseaux", pourquoi: "Pourquoi — manifeste" };
  const urls = { processus: "/processus/", cv: "/cv/", contact: "/contact/", pourquoi: "/pourquoi/" };
  if (!S.docs.pages[name] || !Object.keys(S.docs.pages[name]).length)
    return h("div", { class: "page" }, h("h1", {}, titles[name]), h("p", { class: "error" }, `Le fichier src/data/pages/${name}.json manque dans le dépôt.`));
  return h("div", { class: "page" },
    h("div", { class: "row" }, h("h1", {}, titles[name]), h("span", { class: "sp" }), h("a", { class: "button ghost", href: SITE + urls[name], target: "_blank", rel: "noreferrer" }, "voir en ligne ↗")),
    form(SCHEMAS[name], ["pages", name], render));
}

// ---------- versions ----------
let commitsCache = null;
function versionsView() {
  const box = h("div", { class: "box" }, h("p", { class: "muted" }, "Chargement des versions…"));
  const view = h("div", { class: "page" },
    h("h1", {}, "Versions et historique"),
    h("p", { class: "muted" }, "Chaque publication est une version du dépôt. Restaurer charge le contenu de cette version dans l'éditeur (textes, ordre, planches, pages) ; on vérifie dans l'aperçu, puis on publie. Ctrl+Z annule la restauration."),
    box,
    h("h2", {}, "Journal de cette session"),
    S.undo.length
      ? h("ol", { class: "journal" }, S.undo.map((u, n) => h("li", {}, h("span", {}, u.label), h("span", { class: "muted" }, new Date(u.t).toLocaleTimeString("fr-FR")), h("button", { class: "ghost small", onclick: () => { backTo(n); toast("Retour à cette étape"); } }, "revenir avant"))).reverse())
      : h("p", { class: "muted" }, "Aucune modification pour l'instant."));
  (commitsCache ?? gh.commits(40)).then((list) => {
    commitsCache = Promise.resolve(list);
    box.replaceChildren(h("ol", { class: "versions" }, list.map((c) =>
      h("li", { class: c.sha === S.base.sha ? "current" : "" },
        h("div", {},
          h("b", {}, c.commit.message.split("\n")[0]),
          h("span", { class: "muted" }, ` — ${new Date(c.commit.author.date).toLocaleString("fr-FR")} · ${c.commit.author.name}`),
          c.sha === S.base.sha && h("span", { class: "chip ok" }, "version chargée")),
        h("div", { class: "row" },
          h("a", { class: "ghost small", href: c.html_url, target: "_blank", rel: "noreferrer" }, "détail ↗"),
          h("button", { class: "small", onclick: () => restoreVersion(c) }, "restaurer ce contenu"))))));
  }).catch((e) => box.replaceChildren(h("p", { class: "error" }, e.message)));
  return view;
}

async function restoreVersion(c) {
  if (!(await confirmBox("Restaurer cette version ?", `« ${c.commit.message.split("\n")[0]} » — le contenu actuel de l'éditeur est remplacé (Ctrl+Z pour revenir).`, "Restaurer"))) return;
  toast("Chargement de la version…");
  try {
    const old = await load(c.sha);
    change(`Restauration de la version ${c.sha.slice(0, 7)}`, (d) => Object.assign(d, structuredClone(old.docs)));
    toast("Version restaurée — vérifier puis publier");
  } catch (e) {
    toast(e.message, "error");
  }
}

// ---------- corbeille ----------
function corbeilleView() {
  const used = new Set(S.docs.projects.flatMap((p) => p.images.map((i) => repoPath(i.src))));
  for (const x of S.docs.corbeille.projets) for (const i of x.project.images) used.add(repoPath(i.src));
  const orphans = {};
  for (const path of [...Object.keys(S.base.tree.files), ...S.uploads.keys()]) {
    const m = path.match(/^public\/projects\/([^/]+)\/(\d+)\.(webp|gif|jpg|png)$/);
    if (m && !used.has(path)) (orphans[m[1]] ??= []).push(path);
  }
  const has = (p) => p in S.base.tree.files || S.uploads.has(p);
  return h("div", { class: "page" },
    h("h1", {}, "Corbeille"),
    h("p", { class: "muted" }, "Rien n'est effacé du dépôt : les projets et planches retirés se remettent d'un clic."),
    h("h2", {}, `Projets retirés (${S.docs.corbeille.projets.length})`),
    S.docs.corbeille.projets.length
      ? h("ol", { class: "versions" }, S.docs.corbeille.projets.map((x, n) =>
          h("li", {},
            h("div", { class: "row" }, x.project.cover && h("img", { class: "mini", src: urlOf(x.project.cover.src), alt: "" }),
              h("b", {}, x.titre ?? x.project.title), h("span", { class: "muted" }, ` — retiré le ${new Date(x.retireLe).toLocaleString("fr-FR")} · ${x.project.images.length} planches`)),
            h("div", { class: "row" },
              h("button", { class: "small", onclick: () => restoreProject(n) }, "remettre sur le site"),
              h("button", { class: "ghost small danger-text", onclick: async () => { if (await confirmBox("Oublier ce projet ?", "Il disparaît de la corbeille de l'éditeur (ses images restent dans l'historique du dépôt).", "Oublier", true)) change("Corbeille vidée d'un projet", (d) => d.corbeille.projets.splice(n, 1)); } }, "oublier")))))
      : h("p", { class: "muted" }, "Aucun."),
    h("h2", {}, "Planches retirées"),
    Object.keys(orphans).length
      ? Object.entries(orphans).map(([folder, paths]) =>
          h("div", { class: "box" },
            h("b", {}, `${titleOf(project(folder) ?? { slug: folder, title: folder })} (${paths.length})`),
            h("div", { class: "grid small" }, paths.sort().map((path) => {
              const sm = path.replace(/\.(\w+)$/, "-sm.$1");
              return h("div", { class: "card" },
                h("img", { src: urlOf(has(sm) ? sm : path), alt: "", loading: "lazy" }),
                h("select", { onchange: (e) => e.target.value && restorePlate(path, has(sm) ? sm : null, e.target.value) },
                  h("option", { value: "" }, "remettre dans…"),
                  S.docs.projects.map((p) => h("option", { value: p.slug }, titleOf(p)))));
            }))))
      : h("p", { class: "muted" }, "Aucune."));
}

function restoreProject(n) {
  const x = S.docs.corbeille.projets[n];
  if (S.docs.projects.some((p) => p.slug === x.project.slug)) return toast("Un projet porte déjà cet identifiant.", "error");
  change(`Projet remis : ${x.titre ?? x.project.title}`, (d) => {
    const [it] = d.corbeille.projets.splice(n, 1);
    d.projects.unshift(it.project);
    if (it.titre) d.site.titles = { ...d.site.titles, [it.project.slug]: it.titre };
    if (it.couverture) d.site.covers = { ...d.site.covers, [it.project.slug]: it.couverture };
    if (it.embeds) d.embeds[it.project.slug] = it.embeds;
    if (it.video) d.site.videos = [...(d.site.videos ?? []), it.project.slug];
  });
  toast("Projet remis en tête de l'index");
}

async function restorePlate(path, smPath, slug) {
  const { width, height } = await sizeOf(urlOf(path));
  change(`Planche remise dans ${titleOf(project(slug))}`, (d) =>
    d.projects.find((p) => p.slug === slug).images.push({ src: path.slice(6), ...(smPath && { sm: smPath.slice(6) }), width, height, caption: "", proc: false }));
  toast("Planche remise à la fin du projet");
}

// ---------- publication ----------
async function publish() {
  const { files, media } = pending();
  if (!files.length && !media.length) return toast("Rien à publier.");
  const { errors, warnings } = validate(S.docs);
  const auto = autoMessage();
  const ok = await modal((close) => {
    const msg = h("textarea", { rows: 2 }, auto);
    const total = media.reduce((n, m) => n + m.blob.size, 0);
    return h("div", {},
      h("h2", {}, "Publier en ligne"),
      errors.length
        ? h("div", { class: "box err" }, h("b", {}, "À corriger d'abord"), h("ul", {}, errors.map((e) => h("li", {}, e))))
        : h("p", { class: "muted" }, "Un seul envoi sur GitHub ; le site se met à jour en 1 à 2 minutes."),
      h("details", { class: "box", open: files.length + media.length <= 8 },
        h("summary", {}, `${files.length} fichier${files.length > 1 ? "s" : ""} de données · ${media.length} média${media.length > 1 ? "s" : ""} (${mb(total)})`),
        h("ul", {}, files.map((f) => h("li", {}, f.text === null ? `supprimé : ${f.path}` : f.path)), media.map((m) => h("li", {}, `${m.path} — ${mb(m.blob.size)}`)))),
      warnings.length ? h("details", { class: "box" }, h("summary", {}, `${warnings.length} remarque${warnings.length > 1 ? "s" : ""} (n'empêche pas de publier)`), h("ul", {}, warnings.map((w) => h("li", {}, w)))) : null,
      h("label", { class: "field" }, h("span", {}, "description de la version"), msg),
      h("div", { class: "row end" },
        h("button", { onclick: () => close(null) }, "Annuler"),
        h("button", { class: "primary", disabled: errors.length > 0, onclick: () => close(msg.value.trim() || auto) }, "Publier")));
  });
  if (!ok) return;

  const bar = h("progress", { max: 1, value: 0 });
  const line = h("p", { class: "muted" }, "Vérification de la version en ligne…");
  const dlg = h("dialog", {}, h("h2", {}, "Publication…"), line, bar);
  document.body.append(dlg);
  dlg.showModal();
  try {
    const head = await gh.headSha();
    const all = [...files.map((f) => (f.text === null ? { path: f.path, remove: true } : f)), ...media];
    if (head !== S.base.sha) {
      const now = await gh.treeOf(head);
      const clash = all.filter((f) => now.files[f.path] !== S.base.tree.files[f.path]).map((f) => f.path);
      if (clash.length) {
        dlg.close();
        const force = await confirmBox("Modifié ailleurs entre-temps", `Ces fichiers ont changé sur GitHub depuis l'ouverture de l'éditeur : ${clash.join(", ")}. Publier remplacera ces versions par celles de l'éditeur.`, "Publier quand même", true);
        if (!force) return dlg.remove();
        dlg.showModal();
      }
    }
    const sha = await gh.commitFiles({
      parent: head,
      files: all,
      message: `${ok}\n\nDepuis l'éditeur en ligne (portfolio-editeur).`,
      onProgress: (n, t, p) => { bar.max = t; bar.value = n; line.textContent = `Envoi ${n}/${t} : ${p}`; },
    });
    line.textContent = "Rechargement…";
    const base = await load(sha);
    S.uploads.clear();
    commitsCache = null;
    reset(base);
    await clearDraft();
    dlg.close();
    dlg.remove();
    toast("Publié ✓ — le site se met à jour");
    watchDeploy(sha);
  } catch (e) {
    dlg.close();
    dlg.remove();
    toast(`Publication impossible : ${e.message}`, "error");
  }
}

function autoMessage() {
  const labels = [...new Set(S.undo.map((u) => u.label))];
  if (!labels.length) return "Modifications depuis l'éditeur";
  return labels.length <= 3 ? labels.join(" ; ") : `${labels.slice(-3).join(" ; ")} (+${labels.length - 3})`;
}

async function watchDeploy(sha) {
  ui.deploy = { sha, url: `https://github.com/${OWNER}/${REPO}/actions` };
  renderTop();
  const t0 = Date.now();
  while (Date.now() - t0 < 15 * 60000 && ui.deploy?.sha === sha) {
    await new Promise((r) => setTimeout(r, 8000));
    try {
      const run = (await gh.runsFor(sha)).workflow_runs?.[0];
      if (run) {
        ui.deploy = { sha, url: run.html_url, conclusion: run.status === "completed" ? run.conclusion : null };
        renderTop();
        if (run.status === "completed") {
          toast(run.conclusion === "success" ? "Le site est à jour ✓" : "Le déploiement a échoué — voir le détail", run.conclusion === "success" ? "" : "error");
          return;
        }
      }
    } catch (e) {
      // jeton sans la permission « Actions : Read-only » : on ne peut pas suivre, on renvoie vers la page Actions
      if (e.status === 403 || e.status === 404) {
        ui.deploy = { sha, url: ui.deploy.url, untracked: true };
        renderTop();
        return;
      }
    }
  }
}

// ---------- clavier ----------
function doUndo() { const l = undo(); toast(l ? `Annulé : ${l}` : "Rien à annuler"); }
function doRedo() { const l = redo(); toast(l ? `Rétabli : ${l}` : "Rien à rétablir"); }

document.addEventListener("keydown", (e) => {
  if (!S.base || $("dialog[open]")) return;
  const mod = e.ctrlKey || e.metaKey;
  const typing = e.target.closest?.("input, textarea, select, [contenteditable]");
  if (mod && e.key.toLowerCase() === "s") { e.preventDefault(); return publish(); }
  if (mod && e.key.toLowerCase() === "p") { e.preventDefault(); return togglePreview(); }
  if (mod && !typing && e.key.toLowerCase() === "z") { e.preventDefault(); return e.shiftKey ? doRedo() : doUndo(); }
  if (mod && !typing && e.key.toLowerCase() === "y") { e.preventDefault(); return doRedo(); }
  if (typing) return;
  if (e.key === "?") return shortcuts();
  if (ui.route.kind !== "project") return;
  const slug = ui.route.slug;
  const p = project();
  if (mod && e.key.toLowerCase() === "a") {
    e.preventDefault();
    p.images.filter((i) => ui.filter === "toutes" || i.proc === (ui.filter === "processus")).forEach((i) => ui.sel.add(i.src));
    return render();
  }
  if (e.key === "Escape" && ui.sel.size) { ui.sel.clear(); return render(); }
  if (!ui.sel.size) return;
  const sel = [...ui.sel];
  if (e.key === "1") setProc(slug, sel, false);
  else if (e.key === "2") setProc(slug, sel, true);
  else if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); removePlates(slug, sel); }
  else if (e.key === "ArrowLeft" || e.key === "ArrowUp") { e.preventDefault(); nudgeSel(slug, -1); }
  else if (e.key === "ArrowRight" || e.key === "ArrowDown") { e.preventDefault(); nudgeSel(slug, 1); }
  else if (e.key === "Home") moveSel(slug, "start");
  else if (e.key === "End") moveSel(slug, "end");
});

window.addEventListener("beforeunload", (e) => {
  // le brouillon est gardé, mais on prévient quand même s'il reste des envois en attente
  if (S.base && S.uploads.size && pending().media.length) e.preventDefault();
});

function shortcuts() {
  const rows = [
    ["Ctrl + Z", "annuler"], ["Ctrl + Maj + Z / Ctrl + Y", "rétablir"], ["Ctrl + S", "publier"], ["Ctrl + P", "afficher / masquer l'aperçu"],
    ["clic, Ctrl + clic, Maj + clic", "sélectionner une, plusieurs, une suite de planches"], ["Ctrl + A", "sélectionner toutes les planches affichées"],
    ["1 / 2", "sélection → produit / processus"], ["← →", "déplacer la sélection"], ["Début / Fin", "sélection au début / à la fin"],
    ["Suppr", "retirer la sélection (corbeille)"], ["Échap", "désélectionner"],
  ];
  modal((close) => h("div", {}, h("h2", {}, "Raccourcis"), h("table", { class: "keys" }, rows.map(([k, v]) => h("tr", {}, h("td", {}, h("kbd", {}, k)), h("td", {}, v)))), h("div", { class: "row end" }, h("button", { class: "primary", onclick: () => close() }, "Fermer"))));
}

async function logout() {
  if (pending().files.length && !(await confirmBox("Se déconnecter ?", "Le brouillon reste gardé dans ce navigateur.", "Se déconnecter"))) return;
  localStorage.removeItem(TOKEN_KEY);
  sessionStorage.removeItem(TOKEN_KEY);
  location.reload();
}

start();
