# Vérification de documents PDF par QR code

Un petit site web qui permet de **prouver l'authenticité de vos documents PDF** (attestations, certificats, factures, diplômes…).

1. Dans l'**administration**, vous choisissez un PDF : le site y ajoute un **QR code** (avec le n° du document) et l'enregistre dans un registre.
2. Vous envoyez ce PDF à son destinataire.
3. Quiconque **scanne le QR code** avec son téléphone arrive sur votre site, qui affiche :
   - ✅ **Document authentique** : avec l'intitulé, le destinataire et la date, pour comparer avec le papier ;
   - ⚠️ **Document expiré** : si vous avez fixé une date de validité ;
   - ❌ **Document révoqué** : si vous l'avez annulé depuis l'administration ;
   - ❌ **Document non reconnu** : faux QR code ou numéro inconnu.
4. Si la personne a le **fichier PDF**, elle peut aussi le déposer sur la page : le site vérifie qu'il n'a pas été modifié, même d'un seul caractère (comparaison de l'empreinte SHA-256).

**Aucune installation de bibliothèque** : il suffit de Node.js. Pas de `npm install`.

---

## 1. Lancer le site sur votre ordinateur

1. Installez **Node.js** (version 20.12 ou plus récente) : https://nodejs.org, bouton « LTS ».
2. Récupérez ce dossier `verification-pdf` sur votre disque dur (sur GitHub : bouton **Code → Download ZIP**, puis décompressez).
3. Lancez le site :
   - **Windows** : double-cliquez sur `demarrer.bat`.
   - **Mac / Linux** : ouvrez un terminal dans le dossier, puis :
     ```bash
     cp .env.example .env
     npm start
     ```
4. Ouvrez **http://localhost:3000/admin**. Identifiant : `admin`, mot de passe : `changez-moi`. **Changez-le** dans le fichier `.env` (ouvrez-le avec le Bloc-notes), puis relancez le site.

Dans `.env`, indiquez aussi le nom de votre organisme (`ISSUER_NAME`) : il est affiché sur la page de vérification.

Pour arrêter le site, fermez la fenêtre noire (ou faites `Ctrl+C`).

## 2. Tester avec votre téléphone

Sans réglage particulier, les QR codes pointent vers l'adresse de votre ordinateur **sur votre réseau Wi-Fi** (par exemple `http://192.168.1.20:3000`). L'adresse exacte est affichée au démarrage.

- Votre téléphone doit être connecté **au même Wi-Fi** que l'ordinateur.
- Si la page ne s'ouvre pas, le pare-feu de Windows bloque sans doute la connexion. Au premier lancement, Windows demande s'il faut autoriser Node.js : acceptez pour les **réseaux privés**.

> ⚠️ **Avant d'émettre de vrais documents**, lisez la partie 3. L'adresse est **imprimée définitivement** dans chaque QR code. Si un document a été émis avec l'adresse de votre réseau local, il ne pourra pas être vérifié depuis l'extérieur.

## 3. Mettre le site en ligne (pour les vrais documents)

Pour que n'importe qui puisse scanner vos documents, le site doit être accessible sur Internet, à une adresse qui ne changera plus (idéalement votre propre nom de domaine, par exemple `https://verification.mon-site.fr`).

1. Hébergez le dossier chez un hébergeur Node.js (Railway, Render, Fly.io, un VPS…). La commande de démarrage est `npm start`.
2. Configurez les variables d'environnement : `ISSUER_NAME`, `ADMIN_USER`, `ADMIN_PASSWORD` et surtout **`BASE_URL`** = l'adresse publique du site.
3. Prévoyez un **stockage persistant** pour le dossier `data/` (« volume » ou « disk » chez l'hébergeur), sinon le registre est effacé à chaque redéploiement.
4. Utilisez **HTTPS** (fourni automatiquement par ces hébergeurs).

Vous pouvez aussi garder le site sur votre ordinateur et l'exposer avec un tunnel (Cloudflare Tunnel, par exemple). Dans ce cas, l'ordinateur doit rester allumé pour que les vérifications fonctionnent.

## 4. Sauvegarde

Tout est dans le dossier **`data/`** :
- `documents.json` : le registre (numéros, intitulés, empreintes, états) ;
- `pdf/` : une copie de chaque PDF tamponné.

**Copiez ce dossier régulièrement.** Si vous le perdez, tous vos documents émis afficheront « Document non reconnu ».

## 5. Questions fréquentes

**Quelqu'un peut-il copier le QR code sur un faux document ?**
Il peut copier l'image, mais la page de vérification affiche l'intitulé, le destinataire et la date du **vrai** document. La personne qui vérifie doit les comparer avec le document qu'elle a sous les yeux, et la page le lui rappelle. Si elle a le fichier PDF, le contrôle d'empreinte détecte toute modification.

**Le numéro peut-il être deviné ?**
Non. Chaque numéro contient 12 caractères aléatoires (plus d'un milliard de milliards de combinaisons), et le nombre de vérifications par minute est limité.

**Révoquer ou supprimer ?**
*Révoquer* garde la trace du document : la page affiche « Document révoqué », avec le motif si vous en indiquez un. *Supprimer* l'efface du registre : la page affiche alors « Document non reconnu ». En général, préférez révoquer.

**Mon PDF est refusé.**
Les PDF protégés par mot de passe ou chiffrés ne peuvent pas être modifiés. Ré-enregistrez-le sans protection (par exemple avec « Imprimer → Enregistrer en PDF »), puis réessayez.

**Le QR code cache une partie de mon document.**
Choisissez un autre emplacement (les quatre coins sont possibles), ou prévoyez un espace libre d'environ 3 × 3,5 cm dans votre modèle de document.

**Une signature électronique déjà présente dans le PDF reste-t-elle valide ?**
Le QR code est ajouté sans réécrire le fichier d'origine (mise à jour « incrémentale », comme Acrobat). Selon le logiciel de lecture, la signature peut toutefois apparaître comme « modifiée après signature ». Si vous signez vos documents, ajoutez le QR code **avant** de les signer.

## 6. Fonctionnement technique

```
server/index.js      serveur HTTP : pages publiques, administration (mot de passe), API
server/pdf-stamp.js  lecture du PDF et ajout du QR code (mise à jour incrémentale du fichier)
server/qrcode.js     générateur de QR codes
server/store.js      registre : data/documents.json + data/pdf/
server/pages.js      pages HTML de vérification
public/              styles, scripts de l'administration et de la page de vérification
test/                tests automatiques (npm test)
```

Tests : `npm test`. Si Poppler (`pdftoppm`) est installé, les tests affichent aussi chaque PDF tamponné en image et relisent le QR code à partir des pixels.
