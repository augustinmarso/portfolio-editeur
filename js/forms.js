// Formulaires des pages (processus, cv, contact, pourquoi) décrits par un schéma : chaque champ écrit
// directement dans les données, les listes s'ajoutent, se retirent et se réordonnent.
import { h } from "./dom.js";
import { S, change } from "./store.js";

const get = (o, path) => path.reduce((x, k) => x?.[k], o);
function set(o, path, v, optional) {
  const parent = get(o, path.slice(0, -1));
  const k = path.at(-1);
  const empty = v === "" || v === false || v == null || (Array.isArray(v) && !v.length);
  if (optional && empty) delete parent[k];
  else parent[k] = v;
}

const text = (label, opts = {}) => ({ type: "text", label, ...opts });
const area = (label, opts = {}) => ({ type: "textarea", label, ...opts });
const list = (label, item, opts = {}) => ({ type: "list", label, item, ...opts });
const obj = (fields, opts = {}) => ({ type: "object", fields, ...opts });

export const SCHEMAS = {
  processus: obj({
    surtitre: text("surtitre"),
    titre: text("titre"),
    allersRetours: area("allers-retours (sous le titre)", { optional: true, rows: 2 }),
    intro: area("introduction", { optional: true, rows: 3 }),
    etapes: list(
      "étapes",
      obj({
        titre: text("titre"),
        sousEtapes: { type: "lines", label: "sous-étapes techniques — une par ligne (affichées sous le titre)", optional: true },
        texte: area("texte"),
        image: { type: "plate", label: "image de l'étape (à côté du texte) — « slug-du-projet numéro »", optional: true, from: "exemples" },
        note: area("note (affichée seulement s'il n'y a pas d'image)", { optional: true, rows: 2 }),
        outils: text("outils"),
        exemples: { type: "lines", label: "planches en exemple — une par ligne : « slug-du-projet numéro » (numéro à partir de 0)", optional: true },
      }),
      { title: (e) => e.titre, blank: () => ({ titre: "nouvelle étape", texte: "", outils: "" }) }
    ),
    inspirations: area("inspirations (bas de page)", { optional: true, rows: 3 }),
  }),
  cv: obj({
    sections: list(
      "sections",
      obj({
        title: text("titre"),
        items: list(
          "lignes",
          obj({
            when: text("quand / domaine"),
            what: text("intitulé"),
            detail: area("détail", { optional: true, rows: 2 }),
            href: text("lien (site de l'école, de la structure)", { optional: true, kind: "url" }),
            logos: { type: "bool", label: "afficher les logos d'applications", optional: true },
          }),
          { title: (i) => `${i.when} — ${i.what}`, blank: () => ({ when: "", what: "nouvelle ligne" }) }
        ),
      }),
      { title: (s) => s.title, blank: () => ({ title: "nouvelle section", items: [] }) }
    ),
  }),
  contact: obj({
    identite: { type: "lines", label: "présentation (une ligne par ligne affichée)" },
    email: text("e-mail", { kind: "email" }),
    telephone: obj({ affichage: text("téléphone affiché"), international: text("téléphone international (+33…), sert aussi à WhatsApp") }, { label: "téléphone" }),
    formspree: text("identifiant Formspree du formulaire (vide : le formulaire ouvre la messagerie)"),
    meet: text("lien Google Meet", { kind: "url" }),
    reseaux: list("réseaux (contact et cv)", obj({ label: text("nom"), href: text("adresse", { kind: "url" }) }), {
      title: (r) => r.label,
      blank: () => ({ label: "réseau", href: "https://" }),
    }),
  }),
  pourquoi: obj({
    titre: text("titre — [1] renvoie à la note 1", { big: true }),
    exergue: obj({ texte: area("citation"), source: text("source") }, { label: "exergue" }),
    sections: list(
      "sections",
      obj({
        id: text("ancre (sans espace)"),
        titre: text("titre"),
        paragraphes: { type: "paragraphs", label: "texte — une ligne vide sépare les paragraphes ; [n] = note, [[texte|/projets/slug]] = lien", optional: true },
        liste: list("liste (personnes, références)", obj({ nom: text("nom"), detail: text("détail"), texte: area("texte", { optional: true, rows: 3 }), photo: text("photo (/manifeste/…)", { optional: true }) }), {
          optional: true,
          title: (x) => x.nom,
          blank: () => ({ nom: "nom", detail: "" }),
        }),
      }),
      { title: (s) => s.titre, blank: () => ({ id: "section", titre: "nouvelle section", paragraphes: [""] }) }
    ),
    notes: list("notes", obj({ terme: text("terme"), texte: area("texte", { rows: 3 }) }), { title: (n) => n.terme, blank: () => ({ terme: "terme", texte: "" }), numbered: true }),
    ouvrages: list(
      "ouvrages (étagère)",
      obj({
        auteur: text("auteur"),
        titre: text("titre"),
        detail: text("détail"),
        couleur: { type: "color", label: "couleur du dos" },
        encre: { type: "color", label: "couleur du texte" },
        h: { type: "number", label: "hauteur" },
        l: { type: "number", label: "épaisseur" },
      }),
      { title: (o) => `${o.auteur} — ${o.titre}`, blank: () => ({ auteur: "", titre: "nouveau livre", detail: "", couleur: "#d9d4c7", encre: "#111111", h: 200, l: 24 }) }
    ),
  }),
};

const labelOf = (path) => `Page ${path[1]}`;

// root : ["pages", "cv"] ; rerender : redessine la page après un changement de structure.
export function form(schema, path, rerender) {
  if (schema.type === "object")
    return h("div", { class: schema.label ? "group" : "fields-stack" },
      schema.label && h("div", { class: "group-label" }, schema.label),
      Object.entries(schema.fields).map(([k, f]) => field(f, [...path, k], rerender)));
  return field(schema, path, rerender);
}

function field(f, path, rerender) {
  const value = get(S.docs, path);
  const key = path.join(".");
  const write = (v) => change(labelOf(path), (d) => set(d, path, v, f.optional), { coalesce: key, soft: true });

  if (f.type === "object") return form(f, path, rerender);
  if (f.type === "plate") return plateField(f, path, value, write, rerender);
  if (f.type === "list") return listField(f, path, value ?? [], rerender);
  if (f.type === "bool")
    return h("label", { class: "check" }, h("input", { type: "checkbox", checked: !!value, onchange: (e) => write(e.target.checked) }), f.label);

  let input;
  if (f.type === "textarea") input = h("textarea", { rows: f.rows ?? 4, oninput: (e) => write(e.target.value) }, value ?? "");
  else if (f.type === "lines") input = h("textarea", { rows: 4, oninput: (e) => write(f.optional ? e.target.value.split("\n").filter((l) => l.trim()) : e.target.value.split("\n")) }, (value ?? []).join("\n"));
  else if (f.type === "paragraphs") input = h("textarea", { rows: 8, oninput: (e) => write(e.target.value.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean)) }, (value ?? []).join("\n\n"));
  else if (f.type === "number") input = h("input", { type: "number", value: value ?? "", oninput: (e) => write(e.target.value === "" ? 0 : Number(e.target.value)) });
  else if (f.type === "color")
    return h("label", { class: "field" }, h("span", {}, f.label),
      h("span", { class: "color" }, h("input", { type: "color", value: value ?? "#000000", oninput: (e) => { write(e.target.value); e.target.nextSibling.value = e.target.value; } }), h("input", { value: value ?? "", oninput: (e) => write(e.target.value) })));
  else input = h("input", { type: f.kind ?? "text", value: value ?? "", class: f.big ? "big" : "", oninput: (e) => write(e.target.value) });
  return h("label", { class: "field" }, h("span", {}, f.label), input);
}

// « slug numéro » → adresse de la miniature (fournie par l'application, qui connaît les projets)
let plateUrl = () => null;
export const setPlateResolver = (fn) => (plateUrl = fn);

// Une planche d'un projet : champ « slug numéro », miniature, et choix rapide parmi les exemples de l'étape.
function plateField(f, path, value, write, rerender) {
  const siblings = get(S.docs, [...path.slice(0, -1), f.from]) ?? [];
  const img = h("img", { class: "plate-thumb", alt: "", hidden: !plateUrl(value ?? "") });
  const refresh = (v) => { const u = plateUrl(v); img.hidden = !u; if (u) img.src = u; };
  refresh(value ?? "");
  const input = h("input", { value: value ?? "", placeholder: "ex. le-jeu-de-la-grenouille 17", oninput: (e) => { write(e.target.value.trim()); refresh(e.target.value); } });
  const pick = (v) => { change(labelOf(path), (d) => set(d, path, v, true)); rerender(); };
  return h("div", { class: "field" },
    h("span", {}, f.label),
    h("div", { class: "plate-field" }, img,
      h("div", { class: "fields-stack" }, input,
        siblings.length ? h("div", { class: "chips" }, h("span", { class: "hint" }, "prendre un exemple :"),
          siblings.map((s) => h("button", { class: `chip-btn ${s === value ? "on" : ""}`, title: s, onclick: () => pick(s) },
            plateUrl(s) ? h("img", { src: plateUrl(s), alt: s, class: "chip-thumb" }) : s))) : null,
        value ? h("button", { class: "ghost small danger-text", onclick: () => pick("") }, "retirer l'image") : null)));
}

// éléments de liste dépliés : gardés ouverts quand la page se redessine
const opened = new Set();

function listField(f, path, items, rerender) {
  const structural = (label, fn) => {
    change(label, (d) => {
      if (!get(d, path)) set(d, path, []);
      fn(get(d, path));
      if (f.optional && !get(d, path).length) set(d, path, [], true);
    });
    rerender();
  };
  return h("div", { class: "list" },
    h("div", { class: "list-head" }, h("span", {}, `${f.label} (${items.length})`),
      h("button", { class: "small", onclick: () => structural(`${labelOf(path)} : ajout`, (l) => l.push(f.item.type === "object" ? f.blank() : "")) }, "+ ajouter")),
    items.map((it, n) =>
      h("details", {
        class: "item",
        open: (opened.has(`${path.join(".")}.${n}`) ?? false) || items.length <= 3 || undefined,
        ontoggle: (e) => opened[e.target.open ? "add" : "delete"](`${path.join(".")}.${n}`),
      },
        h("summary", {},
          h("span", { class: "item-title" }, f.numbered ? `${n + 1}. ` : "", (f.title?.(it) || "—").slice(0, 90)),
          h("span", { class: "item-acts" },
            h("button", { class: "ghost small", title: "Monter", disabled: n === 0, onclick: (e) => { e.preventDefault(); structural(`${labelOf(path)} : ordre`, (l) => l.splice(n - 1, 0, ...l.splice(n, 1))); } }, "↑"),
            h("button", { class: "ghost small", title: "Descendre", disabled: n === items.length - 1, onclick: (e) => { e.preventDefault(); structural(`${labelOf(path)} : ordre`, (l) => l.splice(n + 1, 0, ...l.splice(n, 1))); } }, "↓"),
            h("button", { class: "ghost small", title: "Dupliquer", onclick: (e) => { e.preventDefault(); structural(`${labelOf(path)} : copie`, (l) => l.splice(n + 1, 0, structuredClone(l[n]))); } }, "⧉"),
            h("button", { class: "ghost small danger-text", title: "Retirer", onclick: (e) => { e.preventDefault(); structural(`${labelOf(path)} : retrait`, (l) => l.splice(n, 1)); } }, "✕"))),
        form(f.item, [...path, n], rerender)))
  );
}
