// Aperçu en direct : la page telle qu'elle sera sur le site (mêmes colonnes, police, onglets),
// redessinée à chaque modification dans une iframe isolée.
import { FONT } from "./config.js";

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const rich = (s) => esc(s).replace(/\[(\d+)\]/g, "<sup>$1</sup>").replace(/\[\[([^|\]]+)\|[^\]]+\]\]/g, "<u>$1</u>");

const CSS = `
@font-face { font-family: Scoutie; src: url(${FONT}) format("woff2"); font-weight: 100 900; }
* { box-sizing: border-box; }
body { margin: 0; font: 400 18px/1.4 Scoutie, system-ui, sans-serif; color: #0a0a0a; background: #fff; letter-spacing: -0.01em; }
.muted { color: #737373; }
.bar { position: sticky; top: 0; z-index: 2; display: flex; justify-content: space-between; align-items: baseline; padding: 12px 24px; background: #fff; font-weight: 600; font-size: 18px; }
.bar nav { display: flex; gap: 20px; } .bar nav span { color: #737373; } .bar nav span.on { color: #0a0a0a; }
main { padding: 16px 24px 64px; }
.cols { display: grid; grid-template-columns: minmax(0,1fr) minmax(0,2fr); gap: 40px; }
.side { position: sticky; top: 64px; align-self: start; }
h1 { margin: 0; font-size: 48px; font-weight: 700; line-height: .95; letter-spacing: -0.03em; text-transform: lowercase; }
.tabs { margin-top: 24px; display: flex; gap: 20px; font-weight: 600; }
.tabs a { color: #737373; text-decoration: none; border-bottom: 2px solid transparent; padding-bottom: 2px; cursor: pointer; }
.tabs a.on { color: #0a0a0a; border-color: #0a0a0a; }
dl { margin: 32px 0 0; display: grid; gap: 4px; font-weight: 600; } dl div { display: flex; gap: 8px; } dt { color: #737373; } dd { margin: 0; }
.intro { margin-top: 32px; line-height: 1.6; max-width: 65ch; white-space: pre-line; }
.plates { display: grid; gap: 48px; }
figure { margin: 0; } figure img, figure video { display: block; width: 100%; height: auto; background: #f4f4f4; }
figcaption { margin-top: 12px; font-size: 14px; font-weight: 600; color: #737373; text-transform: lowercase; }
.yt { position: relative; aspect-ratio: 16/9; background: #111 center/cover; } .yt.v { aspect-ratio: 9/16; max-width: 240px; }
.yt::after { content: "▶"; position: absolute; inset: 0; display: grid; place-items: center; color: #fff; font-size: 40px; }
.empty { color: #737373; font-weight: 600; }
.hero { padding-top: 48px; } .hero p { font-weight: 600; color: #737373; margin: 0; }
.hero h1 { font-size: 88px; text-transform: none; letter-spacing: -0.05em; margin-top: 16px; max-width: 18ch; }
ol.steps { list-style: none; padding: 0; margin: 80px 0 0; display: grid; gap: 64px; font-weight: 600; font-size: 20px; }
ol.steps li { display: grid; grid-template-columns: minmax(0,1fr) minmax(0,2fr); gap: 40px; }
ol.steps h2 { margin: 0; font-size: 30px; display: flex; gap: 16px; } ol.steps h2 span { color: #737373; }
ol.steps p { margin: 0; font-weight: 400; line-height: 1.6; max-width: 62ch; } ol.steps p.muted { margin-top: 12px; font-size: 18px; }
.cv h2 { font-size: 30px; margin: 0 0 24px; } .cv section { margin-bottom: 56px; }
.cv .line { display: grid; grid-template-columns: 11rem 1fr; gap: 24px; margin-bottom: 16px; font-weight: 600; font-size: 20px; }
.cv .detail { display: block; margin-top: 4px; font-weight: 400; color: #737373; }
.cv a { color: inherit; text-decoration: underline; text-underline-offset: 4px; }
.manif section { margin-bottom: 72px; font-weight: 600; font-size: 20px; } .manif h2 { font-size: 30px; margin: 0 0 24px; }
.manif p { font-weight: 400; line-height: 1.6; max-width: 62ch; }
.quote { margin: 64px 0; font-size: 34px; font-weight: 600; line-height: 1.2; max-width: 30ch; } .quote small { display: block; margin-top: 12px; font-size: 16px; color: #737373; }
.shelf { display: flex; align-items: flex-end; gap: 3px; flex-wrap: wrap; } .shelf span { writing-mode: vertical-rl; transform: rotate(180deg); font-size: 11px; font-weight: 600; padding: 6px 2px; overflow: hidden; }
.contact { font-weight: 600; font-size: 20px; max-width: 40ch; } .contact p { margin: 0 0 16px; }
@media (max-width: 700px) {
  .bar { padding: 12px 16px; flex-wrap: wrap; font-size: 16px; } .bar nav { gap: 14px; }
  main { padding: 16px; } .cols, ol.steps li, .cv .line { grid-template-columns: 1fr; gap: 16px; }
  .side { position: static; } h1 { font-size: 36px; } .hero h1 { font-size: 44px; } .quote { font-size: 24px; }
}
`;

const header = (active) => `<div class="bar"><span>augustin marsollier</span><nav>${["index", "processus", "pourquoi", "cv", "contact"].map((l) => `<span class="${l === active ? "on" : ""}">${l}</span>`).join("")}</nav></div>`;
const doc = (body, active) => `<!doctype html><html lang="fr"><head><meta charset="utf-8"><style>${CSS}</style></head><body>${header(active)}<main>${body}</main>
<script>document.addEventListener("click", (e) => { const t = e.target.closest("[data-view]"); if (t) parent.postMessage({ previewView: t.dataset.view }, "*"); });</script></body></html>`;

export function projectPreview({ project, title, view, urlOf, video, embeds }) {
  const t = project.text;
  const produit = view === "produit";
  const shown = project.images.filter((i) => i.proc === !produit);
  const row = (k, v) => (v ? `<div><dt>${k}</dt><dd>${v}</dd></div>` : "");
  const media = produit
    ? (video ? `<figure style="margin-top:48px;max-width:260px"><video src="${esc(video.src)}" poster="${esc(video.poster)}" muted controls style="border-radius:24px"></video></figure>` : "") +
      (embeds ?? []).map((e) => `<figure style="margin-top:48px"><div class="yt ${e.vertical ? "v" : ""}" style="background-image:url(https://i.ytimg.com/vi/${esc(e.youtube)}/hqdefault.jpg)"></div><figcaption>${esc(e.credit)}</figcaption></figure>`).join("")
    : "";
  const body = `<div class="cols"><div class="side">
    <h1>${esc(title)}</h1>
    <div class="tabs"><a data-view="produit" class="${produit ? "on" : ""}">produit</a><a data-view="processus" class="${produit ? "" : "on"}">processus</a></div>
    <dl>${row("année", esc(t.year))}${row("contexte", esc(t.context?.toLowerCase()))}${row("équipe", esc(t.team?.toLowerCase()))}${row("thèmes", esc((t.themes ?? []).join(", ")))}${row("planches", shown.length)}</dl>
    ${t.intro ? `<p class="intro">${esc(t.intro)}</p>` : ""}${media}
  </div><div class="plates">
    ${shown.length ? shown.map((i) => `<figure><img src="${esc(urlOf(i.sm ?? i.src))}" width="${i.width}" height="${i.height}" alt="">${i.caption ? `<figcaption>${esc(i.caption)}</figcaption>` : ""}</figure>`).join("") : `<p class="empty">${produit ? "pas encore de planche produit pour ce projet." : "le processus de ce projet n'est pas encore en ligne."}</p>`}
  </div></div>`;
  return doc(body, null);
}

export function pagePreview(name, p, plateUrl = () => null) {
  if (name === "processus")
    return doc(`<div class="hero"><p>${esc(p.surtitre)}</p><h1>${esc(p.titre)}</h1>${p.allersRetours ? `<p style="margin-top:20px;max-width:52ch">↺ ${esc(p.allersRetours)}</p>` : ""}${p.intro ? `<p style="color:#0a0a0a;margin-top:32px;font-size:24px;max-width:52ch">${esc(p.intro)}</p>` : ""}</div><ol class="steps">${(p.etapes ?? [])
      .map((e, n) => `<li><h2><span>${String(n + 1).padStart(2, "0")}</span>${esc(e.titre)}</h2><div>${(e.sousEtapes ?? []).length ? `<p class="muted" style="margin:0 0 16px;font:14px ui-monospace,monospace;text-transform:uppercase;letter-spacing:.04em">${e.sousEtapes.map((t, k) => `${n + 1}.${k + 1} ${esc(t)}`).join(" &nbsp; ")}</p>` : ""}<p>${esc(e.texte)}</p>${e.image && plateUrl(e.image) ? `<img src="${esc(plateUrl(e.image))}" alt="" style="margin-top:20px;width:100%;max-width:420px;border-radius:16px;display:block">` : e.note ? `<p style="margin-top:20px;font-size:28px;font-weight:600;line-height:1.1">« ${esc(e.note)} »</p>` : ""}<p class="muted">${esc(e.outils)}</p>${(e.exemples ?? []).length ? `<p class="muted" style="font-size:14px">exemples : ${e.exemples.map(esc).join(" · ")}</p>` : ""}</div></li>`).join("")}</ol>
      ${p.inspirations ? `<p class="muted" style="margin-top:96px;max-width:62ch">${esc(p.inspirations)}</p>` : ""}`, "processus");
  if (name === "cv")
    return doc(`<div class="cv">${(p.sections ?? []).map((s) => `<section><h2>${esc(s.title)}</h2>${(s.items ?? [])
      .map((i) => `<div class="line"><span class="muted">${esc(i.when)}</span><span>${i.href ? `<a>${esc(i.what)}</a>` : esc(i.what)}${i.logos ? " ▪▪▪" : ""}${i.detail ? `<span class="detail">${esc(i.detail)}</span>` : ""}</span></div>`).join("")}</section>`).join("")}</div>`, "cv");
  if (name === "contact")
    return doc(`<div class="contact"><p>${(p.identite ?? []).map(esc).join("<br>")}</p><p>${esc(p.telephone?.affichage)} — ${esc(p.email)}<br>appel visio → google meet</p>
      <p class="muted">formulaire : ${p.formspree ? `formspree ${esc(p.formspree)}` : "ouvre la messagerie"}</p><p>${(p.reseaux ?? []).map((r) => esc(r.label)).join(", ")}</p></div>`, "contact");
  if (name === "pourquoi")
    return doc(`<div class="hero"><p>manifeste · dsaa ensaama · 2026</p><h1>${rich(p.titre)}</h1></div>
      <div class="quote">${esc(p.exergue?.texte)}<small>${esc(p.exergue?.source)}</small></div>
      <div class="manif">${(p.sections ?? []).map((s) => `<section><h2>${esc(s.titre)}</h2>${(s.paragraphes ?? []).map((x) => `<p>${rich(x)}</p>`).join("")}${(s.liste ?? [])
        .map((x) => `<p><b>${esc(x.nom)}</b> <span class="muted">${esc(x.detail)}</span>${x.texte ? `<br>${esc(x.texte)}` : ""}</p>`).join("")}</section>`).join("")}
      <section><h2>notes</h2>${(p.notes ?? []).map((n, i) => `<p><span class="muted">${i + 1}</span> <b>${esc(n.terme)}</b> : ${esc(n.texte)}</p>`).join("")}</section>
      <section><h2>ouvrages</h2><div class="shelf">${(p.ouvrages ?? []).map((o) => `<span style="background:${esc(o.couleur)};color:${esc(o.encre)};height:${Number(o.h) || 200}px;width:${Number(o.l) || 24}px">${esc(o.titre)}</span>`).join("")}</div></section></div>`, "pourquoi");
  return doc("", null);
}
