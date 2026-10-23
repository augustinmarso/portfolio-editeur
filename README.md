# Éditeur du portfolio

Éditeur en ligne du portfolio d'Augustin Marsollier : https://augustinmarso.github.io/portfolio-editeur/

Il modifie directement le dépôt [augustinmarso/portfolio](https://github.com/augustinmarso/portfolio) par l'API GitHub.
Chaque publication est **un seul commit** sur `main` : GitHub Pages reconstruit alors le site (1 à 2 minutes).
Ce dépôt-ci ne contient que l'éditeur (HTML, CSS et JavaScript sans dépendance ni compilation).

## Se connecter : code d'accès

On entre avec un **code d'accès** (au moins 10 caractères). Coché « se souvenir sur cet ordinateur », l'éditeur
s'ouvre ensuite directement sur cet appareil ; ailleurs, on tape le code.

Comment ça marche : le jeton GitHub (voir plus bas) est chiffré dans le navigateur avec le code (PBKDF2-SHA256,
1 200 000 itérations → AES-GCM 256) et rangé dans le dépôt du portfolio, `editeur/acces.json`. Ce fichier est
public mais illisible sans le code ; il n'est pas servi par le site. Le jeton en clair n'est jamais gardé d'une
visite à l'autre (seulement le temps de l'onglet). Changer le code : bouton « code d'accès ». Code oublié ou jeton
expiré : « Se connecter avec un jeton GitHub », puis recréer un code.

## Le jeton GitHub (une seule fois, puis à chaque expiration)

Il faut un jeton GitHub « fine-grained » :

1. https://github.com/settings/personal-access-tokens/new
2. Repository access : *Only select repositories* → `portfolio`.
3. Permissions : **Contents : Read and write** ; en option **Actions : Read-only**, pour que l'éditeur affiche quand le site est à jour après une publication.
4. Coller le jeton dans l'éditeur (lien « Se connecter avec un jeton GitHub ») : il propose aussitôt de créer le code d'accès.

## Ce qu'on peut faire

- **Projets** : créer, réordonner (glisser dans la liste), retirer (corbeille), titre, année, contexte, équipe, lien ENSAAMA, thèmes, texte.
- **Planches** : ajouter (glisser des images : conversion en WebP 2000 px + variante 1000 px dans le navigateur, GIF gardés tels quels), réordonner, légender, classer **produit / processus**, choisir la vignette de l'index, image de survol, déplacer vers un autre projet.
- **Édition par lot** : clic, Ctrl + clic, Maj + clic pour sélectionner ; puis produit / processus, début / fin, légende commune, déplacer vers un projet, retirer.
- **Vidéos** : vidéo de présentation (mp4, affiche tirée automatiquement de la vidéo), vidéos YouTube (lien, titre, crédit, verticale).
- **Pages** : processus, cv, contact et réseaux, pourquoi (manifeste, notes, étagère d'ouvrages).
- **Aperçu en direct** de la page (ordinateur ou téléphone), onglets produit / processus cliquables.
- **Annuler / rétablir** (Ctrl + Z / Ctrl + Maj + Z), journal de la session, **brouillon** gardé dans le navigateur tant qu'on n'a pas publié.
- **Versions** : historique des publications, restauration du contenu d'une ancienne version.
- **Corbeille** : projets retirés et planches qui ne sont plus utilisées, remis d'un clic (rien n'est effacé du dépôt).
- **Publication** (Ctrl + S) : vérifie d'abord ce qui casserait le site (projet sans planche ou sans vignette, lien YouTube invalide…), prévient si un fichier a été modifié ailleurs entre-temps, puis suit le déploiement.

Raccourcis : touche `?` dans l'éditeur.

## Fichiers du portfolio touchés

`src/data/projects.json`, `src/data/texts/*.json` (+ `index.ts`), `src/data/site.json`, `src/data/embeds.json`,
`src/data/pages/*.json`, `src/data/corbeille.json`, et les médias ajoutés dans `public/projects/<projet>/` et `public/videos/`.

## Essayer sans risque (sur cet ordinateur)

Un faux GitHub local rejoue l'API sur une copie du dépôt :

```bash
git clone https://github.com/augustinmarso/portfolio.git ../portfolio-copie
node outils/mock-github.mjs ../portfolio-copie 5331
python -m http.server 5330
```

Puis ouvrir http://localhost:5330/?mock=http://localhost:5331 avec n'importe quel jeton. Le mode essai ne s'active que sur `localhost`.
