// Dépôt du portfolio que l'éditeur modifie. L'éditeur lui-même vit dans un dépôt à part (portfolio-editeur).
export const OWNER = "augustinmarso";
export const REPO = "portfolio";
export const BRANCH = "main";
export const SITE = "https://augustinmarso.github.io/portfolio";

// Fichiers de données du site (tout le reste du dépôt n'est jamais touché, sauf les médias ajoutés).
export const PATHS = {
  projects: "src/data/projects.json",
  site: "src/data/site.json",
  embeds: "src/data/embeds.json",
  corbeille: "src/data/corbeille.json",
  acces: "editeur/acces.json", // jeton chiffré par le code d'accès (hors du site : seul public/ est servi)
  textsDir: "src/data/texts/",
  textsIndex: "src/data/texts/index.ts",
  pages: {
    processus: "src/data/pages/processus.json",
    cv: "src/data/pages/cv.json",
    contact: "src/data/pages/contact.json",
    pourquoi: "src/data/pages/pourquoi.json",
  },
};

// Mêmes thèmes que src/lib/projects.ts (on peut en saisir d'autres).
export const THEMES = ["objet", "service", "jeu", "mobilier", "numérique", "packaging", "espace public", "enfance", "nature", "rituel"];

// Tailles des images, identiques à scripts/optimize-images.mjs du portfolio.
export const IMG = { full: 2000, small: 1000, thumb: 560, qFull: 0.8, qSmall: 0.78, qThumb: 0.78 };

// Police du site, lue dans le dépôt public (sert à l'éditeur et à l'aperçu).
export const FONT = `https://raw.githubusercontent.com/${OWNER}/${REPO}/${BRANCH}/src/app/fonts/scoutie-normal-latin.woff2`;

// Mode essai (outils/mock-github.mjs) : seulement depuis cet ordinateur, jamais sur la version en ligne,
// pour que personne ne puisse détourner le jeton vers un autre serveur avec un lien piégé.
const local = ["localhost", "127.0.0.1"].includes(location.hostname);
export const MOCK = local ? new URLSearchParams(location.search).get("mock") : null;
export const API_BASE = MOCK || "https://api.github.com";
export const RAW_BASE = MOCK ? `${MOCK}/raw` : `https://raw.githubusercontent.com/${OWNER}/${REPO}`;
