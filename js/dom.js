// Petits utilitaires d'interface, sans bibliothèque.
export const $ = (s, el = document) => el.querySelector(s);
export const $$ = (s, el = document) => [...el.querySelectorAll(s)];

// h("button", { class: "ghost", onclick }, "texte", autreNoeud…)
export function h(tag, props, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props ?? {})) {
    if (v == null || v === false) continue;
    if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (k === "class") el.className = v;
    else if (k === "style" && typeof v === "object") Object.assign(el.style, v);
    else if (k === "value") el.value = v;
    else if (k === "checked") el.checked = v;
    else if (k === "dataset") Object.assign(el.dataset, v);
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const c of children.flat(Infinity)) if (c != null && c !== false) el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  return el;
}

export function toast(msg, kind = "") {
  const t = $("#toast");
  t.textContent = msg;
  t.className = `on ${kind}`;
  clearTimeout(t._h);
  t._h = setTimeout(() => (t.className = ""), kind === "error" ? 5000 : 2200);
}

// Fenêtre modale ; renvoie une promesse résolue par close(valeur).
export function modal(build, { wide } = {}) {
  return new Promise((ok) => {
    const d = h("dialog", { class: wide ? "wide" : "" });
    const close = (v) => { d.close(); d.remove(); ok(v); };
    d.append(build(close));
    d.addEventListener("cancel", (e) => { e.preventDefault(); close(null); });
    document.body.append(d);
    d.showModal();
  });
}

export function confirmBox(title, text, okLabel = "Confirmer", danger = false) {
  return modal((close) =>
    h("div", {},
      h("h2", {}, title),
      text && h("p", { class: "muted" }, text),
      h("div", { class: "row end" },
        h("button", { onclick: () => close(false) }, "Annuler"),
        h("button", { class: danger ? "danger" : "primary", onclick: () => close(true) }, okLabel)))
  );
}

// Glisser-déposer pour réordonner les enfants d'un conteneur ; onDrop(clés dans le nouvel ordre).
export function sortable(container, itemSel, onDrop) {
  let dragged = null;
  for (const el of $$(itemSel, container)) {
    el.draggable = true;
    el.addEventListener("dragstart", (e) => {
      if (e.target.closest("input,textarea,select")) return e.preventDefault();
      dragged = el;
      el.classList.add("drag");
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", el.dataset.key);
    });
    el.addEventListener("dragend", () => { el.classList.remove("drag"); $$(".over", container).forEach((o) => o.classList.remove("over")); dragged = null; });
    el.addEventListener("dragover", (e) => { if (!dragged || dragged === el) return; e.preventDefault(); el.classList.add("over"); });
    el.addEventListener("dragleave", () => el.classList.remove("over"));
    el.addEventListener("drop", (e) => {
      if (!dragged || dragged === el) return;
      e.preventDefault();
      el.classList.remove("over");
      const items = $$(itemSel, container);
      const before = items.indexOf(dragged) > items.indexOf(el);
      el.parentNode.insertBefore(dragged, before ? el : el.nextSibling);
      onDrop($$(itemSel, container).map((x) => x.dataset.key), dragged.dataset.key);
    });
  }
}

// Avant de remplacer un bloc redessiné : remet dans le nouveau bloc les images et vidéos déjà affichées
// (même adresse), au lieu d'en créer de nouvelles qui se rechargent et font clignoter l'écran.
export function keepMedia(oldRoot, newRoot) {
  const pool = new Map();
  for (const el of oldRoot.querySelectorAll("img[src], video[src]")) {
    const k = `${el.tagName}|${el.getAttribute("src")}`;
    pool.set(k, [...(pool.get(k) ?? []), el]);
  }
  for (const el of newRoot.querySelectorAll("img[src], video[src]")) {
    const old = pool.get(`${el.tagName}|${el.getAttribute("src")}`)?.shift();
    if (!old) continue;
    for (const a of [...old.attributes]) if (!el.hasAttribute(a.name)) old.removeAttribute(a.name);
    for (const a of [...el.attributes]) if (old.getAttribute(a.name) !== a.value) old.setAttribute(a.name, a.value);
    el.replaceWith(old);
  }
}

export const debounce =(fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
