# I Love My PDF — Déploiement sur Netlify

Site web statique **gratuit** : toute l'analyse et la séparation se font dans le
navigateur (aucun serveur, vos PDFs ne quittent jamais votre appareil).

---

## Connexion & accès temporaire

Le site est protégé par une connexion :

- **Compte principal** : Mot de passe `Meliss@`
  → accès complet (application + panneau « Créer un accès temporaire »), thème noir & rose.
- **Accès temporaire pour un collègue** : depuis le panneau administrateur,
  choisissez une durée (2 h, 6 h, 12 h, 1 j, 2 j, 3 j, 7 j ou date personnalisée).
  Un **lien expirant** est généré : envoyez-le au collègue, il pourra utiliser
  l'application jusqu'à l'expiration, puis le lien devient inactif.
  L'interface du collègue s'affiche en **thème bleu** pour bien distinguer son accès,
  et **sans le Guide ni la FAQ** (réservés à l'admin).
- **Révoquer un partage** : bouton « Mes partages » → liste des liens en cours →
  « Révoguer ». L'invité perd immédiatement l'accès (à distance une fois déployé
  avec les fonctions Netlify ; sinon sur le navigateur de l'admin).
- Session administrateur mémorisée 30 jours sur le navigateur (bouton
  « Se déconnecter » pour la fermer — masqué pour l'invité).

---

## 🔒 Sécurité (mise à jour importante)

Des corrections de sécurité ont été appliquées :

- **Le mot de passe n'est plus en clair dans le code** : seul son empreinte
  SHA-256 est embarquée dans `app.js`.
- **Backend protégé** : les actions « créer / révoquer / lister » de la fonction
  Netlify exigent un jeton admin. Pour les activer, définis la variable
  d'environnement Netlify :
  - `ADMIN_PASS_HASH` = `a7e9fe0a5eb7116101caa49b5aeab594235bae39635f63b715acccbc3261623a`
    (c'est l'empreinte SHA-256 de `Meliss@` — ne change pas le mot de passe sans
    recalculer cette valeur).
  - **Sans cette variable, les actions admin du backend sont refusées** (défaut sûr).
- **Codes d'accès en fragment** (`#code=...`) : ils n'apparaissent plus dans
  l'historique du navigateur ni dans les logs serveur.
- **Validation des entrées + limitation de débit** ajoutées côté serveur.
- **En-têtes de sécurité** : CSP, X-Frame-Options, HSTS, Permissions-Policy.
- **Intégrité des bibliothèques CDN** (SRI) : un CDN compromis ne peut plus
  injecter de code.

> ⚠️ **Limite réelle à connaître** : ce site est **statique** — la vérification
> du mot de passe se fait dans le navigateur. Le mot de passe n'est plus lisible
> en clair dans le code, mais une personne très technique pourrait toujours
> récupérer l'empreinte. Pour une sécurité maximale (vrais comptes, sessions
> serveur, secrets hors du navigateur), il faudrait un **backend d'authentification
> complet** — c'est un chantier plus lourd (voir plus bas).
> La **révocation à distance** n'est réellement effective que si la fonction
> Netlify est déployée (méthode GitHub ci-dessous).

---

## Déploiement en 2 minutes (Netlify Drop — le plus simple)

1. **Prépare le dossier à déployer** : tout le contenu de ce dossier
   `site_web/` (`index.html`, `styles.css`, `app.js`, et aussi
   `netlify.toml`, `package.json` et `netlify/functions/`).
   → Tu peux créer un fichier ZIP de ce dossier, ou garder le dossier ouvert.

2. Va sur **https://app.netlify.com/drop** (gratuit, pas besoin de compte
   pour tester — un compte gratuit suffit pour garder le site en ligne).

3. **Glisse-dépose le dossier `site_web`** (ou son ZIP) dans la zone de dépôt.

4. Netlify publie ton site en quelques secondes et te donne une adresse du type :
   `https://nom-aleatoire.netlify.app`

5. **Personnalise le nom** : Site settings → Change site name →
   par exemple `i-love-m-transit.netlify.app`.

> **Révocation à distance** : Netlify Drop publie un site **statique** ; les
> fonctions peuvent ne pas être activées. Pour que « Révoguer » soit immédiat
> pour l'invité partout, utilise la **méthode GitHub** ci-dessous (ou un
> déploiement Netlify connecté à un dépôt). Sans fonctions, la révocation
> s'applique au navigateur de l'admin (mode local).

**Ton site est en ligne, utilisable par toute l'équipe.**

---

## Mettre à jour le site

Chaque fois que tu modifies `index.html`, `styles.css` ou `app.js` :

- **Netlify Drop** : redépose le dossier entier (même méthode) → nouvelle version en ligne.

Ou (méthode pro, recommandée — active aussi la révocation à distance) :

- Mets les fichiers dans un dépôt **GitHub** puis connecte-le à Netlify
  (Deploy → Import an existing project → GitHub). Chaque `git push` publie
  automatiquement la nouvelle version et **les fonctions sont déployées**,
  ce qui rend la révocation d'un partage **immédiate pour l'invité**.

---

## Fichiers du site

| Fichier | Rôle |
|---------|------|
| `index.html` | Page principale (connexion + application + guide + FAQ) |
| `styles.css` | Design noir & rose (thème bleu pour les invités, Guide/FAQ masqués) |
| `app.js` | Logique : connexion, accès temporaire, mes partages, lecture PDF, OCR, détection, découpage, ZIP |
| `netlify/functions/access.mjs` | Fonction Netlify : révocation à distance des liens invités (protégée par jeton admin) |
| `package.json` | Dépendance `@netlify/blobs` (nécessaire pour les fonctions) |
| `netlify.toml` | Déclare le dossier des fonctions à Netlify |
| `README_deploiement_netlify.md` | Ce guide |

---

## Notes importantes

- **Internet requis au premier chargement** : les bibliothèques (pdf.js,
  pdf-lib, JSZip, Tesseract) viennent de CDN. Après chargement, le traitement
  se fait localement.
- **OCR** : le module français (~10 Mo) se télécharge au premier usage d'un
  PDF scanné. Les utilisateurs voient un message de progression.
- **Sécurité** : aucun fichier n'est envoyé sur un serveur. Tout est traité
  dans le navigateur. Parfait pour des documents clients sensibles.

---

## Tester en local avant déploiement

Depuis ce dossier :

```
python -m http.server 8765
```

Puis ouvre `http://localhost:8765` dans ton navigateur.

En local, les fonctions Netlify ne sont pas actives : le site bascule en
**mode local** (la révocation s'applique au navigateur de l'admin). Tout le
reste (connexion, accès temporaires, séparation PDF) fonctionne à l'identique.

---

**I Love M**
