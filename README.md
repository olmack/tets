# Site web DYLAN AUTO

Système complet pour le garage **DYLAN AUTO** (6 rue du Ribéral, 66240 Saint-Estève) :

| Fonction | Ce que ça fait |
|---|---|
| **Site vitrine** | Accueil, prestations & tarifs, avis, horaires (ouvert/fermé en direct), plan Google Maps, mentions légales/RGPD. Optimisé mobile et référencement (données structurées Google). |
| **Générateur de devis** | Le client choisit son type de véhicule et ses prestations, le prix se calcule en direct. À l'envoi : devis **PDF** généré automatiquement, envoyé au client **et** au dirigeant (avec les photos jointes par le client). |
| **Prise de rendez-vous** | Calendrier avec créneaux réels (horaires du garage, jours fériés et congés bloqués, capacité par créneau). Email récapitulatif au client avec invitation calendrier (.ics) et lien d'annulation, email au dirigeant. Confirmation en 1 clic depuis l'admin → email de confirmation automatique. |
| **Formulaire de contact** | Le message arrive directement dans la boîte mail du dirigeant (« Répondre » répond au client). Accusé de réception automatique au client. |
| **Espace administration** | `/admin` protégé par mot de passe : tableau de bord, liste des RDV (confirmer / annuler / terminer), devis (PDF, statuts), messages, blocage des dates de congés, test d'envoi d'email. |
| **Sécurité** | Anti-spam (pot de miel + limitation de débit), validation de toutes les données côté serveur, en-têtes de sécurité, mots de passe comparés en temps constant. |

**Aucune dépendance à installer** : tout fonctionne avec Node.js seul (serveur HTTP, base SQLite intégrée, client SMTP, générateur PDF et .ics écrits maison). Pas de `npm install`.

---

## 1. Démarrer en 2 minutes (sur votre ordinateur)

1. Installez **Node.js 22 ou plus récent** : https://nodejs.org (bouton « LTS »).
2. Ouvrez un terminal dans ce dossier et lancez :
   ```bash
   cp .env.example .env      # Windows : copy .env.example .env
   npm start
   ```
3. Ouvrez http://localhost:3000 — le site fonctionne. Sans configuration email, les emails s'affichent dans le terminal au lieu d'être envoyés (mode test).
4. Ouvrez http://localhost:3000/admin/ après avoir défini `ADMIN_PASSWORD` dans `.env`.

Tests automatiques (vérifie toutes les fonctionnalités) : `npm test`

---

## 2. Configurer les emails (obligatoire pour la mise en ligne)

Tout se passe dans le fichier **`.env`** (copie de `.env.example`) :

```ini
OWNER_EMAIL=contact@dylanauto.fr        # boîte mail du dirigeant (plusieurs adresses : séparées par des virgules)
SMTP_HOST=smtp.gmail.com                # serveur d'envoi
SMTP_PORT=587
SMTP_USER=contact@dylanauto.fr          # identifiant du compte email
SMTP_PASS=xxxxxxxxxxxxxxxx              # mot de passe (voir ci-dessous)
MAIL_FROM="DYLAN AUTO <contact@dylanauto.fr>"
ADMIN_PASSWORD=un-mot-de-passe-solide
SECRET_KEY=une-longue-phrase-aleatoire
SITE_URL=https://dylanauto.fr
```

### Quel serveur SMTP utiliser ?

| Votre email est chez… | SMTP_HOST | SMTP_PORT | Mot de passe |
|---|---|---|---|
| **Gmail / Google Workspace** | `smtp.gmail.com` | 587 | Un **mot de passe d'application** (pas votre mot de passe habituel) : Compte Google → Sécurité → Validation en deux étapes → Mots de passe des applications. |
| **OVH** (email inclus avec le nom de domaine) | `ssl0.ovh.net` | 465 | Le mot de passe de la boîte mail. |
| **Outlook / Hotmail / Office 365** | `smtp.office365.com` | 587 | Le mot de passe de la boîte mail (SMTP AUTH doit être activé). |
| **Orange** | `smtp.orange.fr` | 465 | Mot de passe de la boîte mail. |
| **Brevo (ex-Sendinblue)** — gratuit 300 emails/jour, recommandé pour une délivrabilité parfaite | `smtp-relay.brevo.com` | 587 | Clé SMTP fournie par Brevo. |

Vérifiez ensuite avec : `npm run test-email` (ou le bouton « Tester l'envoi d'email » dans l'admin). Si l'email n'arrive pas : regardez les spams, puis vérifiez identifiant/mot de passe.

> **Conseil** : utilisez comme expéditeur (`MAIL_FROM`) une adresse du même domaine que le site (ex. contact@dylanauto.fr) pour éviter les spams. Chez la plupart des hébergeurs, l'adresse est fournie avec le nom de domaine.

---

## 3. Mettre en ligne

Le site est une application Node.js : il faut un serveur qui l'exécute en continu. Trois options, de la plus simple à la plus « pro ».

### Option A — Hébergeur « clé en main » (Railway, Render, Fly.io…) — le plus simple

1. Mettez ce dossier sur GitHub (déjà fait si vous lisez ceci depuis GitHub).
2. Créez un compte sur https://railway.app ou https://render.com, choisissez « New Web Service », connectez le dépôt GitHub.
3. Commande de démarrage : `npm start`. Node 22 est détecté automatiquement (`engines` dans package.json).
4. Ajoutez les variables d'environnement (copiez celles du `.env` une par une dans l'interface : `OWNER_EMAIL`, `SMTP_*`, `ADMIN_PASSWORD`, `SECRET_KEY`, `SITE_URL`).
5. **Important** : ajoutez un **volume persistant** monté sur `/app/data` (sinon la base des rendez-vous est effacée à chaque redéploiement). Sur Railway : onglet Volumes ; sur Render : « Disks ».
6. Reliez le nom de domaine `dylanauto.fr` (onglet Domains → suivez les instructions DNS chez le registrar du domaine). Le certificat HTTPS est automatique.

### Option B — Serveur VPS (OVH, Hetzner, Scaleway… ~5 €/mois) avec Docker

```bash
git clone <ce-dépôt> dylan-auto && cd dylan-auto
cp .env.example .env && nano .env          # remplir la configuration
docker compose up -d --build               # le site tourne sur le port 3000
```
Puis installez nginx + certbot avec la configuration fournie dans `deploy/nginx.conf` pour avoir `https://dylanauto.fr`.

### Option C — Serveur VPS sans Docker (Node.js + systemd)

```bash
sudo apt install -y nodejs nginx certbot python3-certbot-nginx   # Node ≥ 22 requis
sudo mkdir -p /var/www/dylan-auto && sudo chown www-data /var/www/dylan-auto
# copier les fichiers du projet dans /var/www/dylan-auto, créer le .env
sudo cp deploy/dylan-auto.service /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now dylan-auto
sudo cp deploy/nginx.conf /etc/nginx/sites-available/dylanauto.fr
sudo ln -s /etc/nginx/sites-available/dylanauto.fr /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d dylanauto.fr -d www.dylanauto.fr
```

### Nom de domaine
Le garage possède déjà `dylanauto.fr`. Chez le registrar (OVH, Gandi, IONOS…), modifiez l'enregistrement DNS `A` (ou `CNAME`) pour pointer vers le nouveau serveur, comme indiqué par l'hébergeur choisi. La propagation prend de quelques minutes à 24 h.

---

## 4. Personnaliser

| Quoi | Où |
|---|---|
| **Tarifs** du générateur de devis et de la page prestations | `config/pricing.json` (prix TTC de base pour une citadine ; coefficients par type de véhicule). Redémarrer le site après modification. |
| **Horaires**, capacité de rendez-vous (nombre de véhicules par créneau), durée des créneaux, délai minimum, jours fériés | `config/garage.json` → `openingHours` (0 = dimanche … 6 = samedi) et `booking`. |
| Coordonnées, téléphone, adresse affichés sur le site | `public/partials/header.html`, `public/partials/footer.html` (communs à toutes les pages), et `config/garage.json` (emails et PDF). |
| Textes, avis clients, sections de l'accueil | `public/index.html` |
| Couleurs, polices | `public/css/style.css` (variables `--navy`, `--amber` en haut du fichier) |
| Logo | `public/img/logo.svg` et `public/favicon.svg` |
| Motifs de rendez-vous proposés | liste déroulante dans `public/rendez-vous.html` |
| Textes des emails | `server/mailer.js` |
| Hébergeur dans les mentions légales | `public/mentions-legales.html` (à compléter) |

Congés / fermetures exceptionnelles : directement dans l'admin, onglet « Fermetures ». Pas besoin de toucher aux fichiers.

---

## 5. Comment ça marche (pour comprendre)

```
Navigateur du client ──► server/index.js (serveur HTTP Node.js)
                           ├── public/            pages HTML, CSS, JS (site + admin)
                           ├── server/services.js logique : devis, créneaux, RDV, messages
                           ├── server/db.js       base SQLite  → data/dylan-auto.db
                           ├── server/smtp.js     envoi des emails via votre compte SMTP
                           ├── server/pdf.js      génération du devis PDF
                           └── server/ics.js      invitation calendrier pour les RDV
```

- **Demande de devis** → enregistrée en base → PDF généré → 2 emails (client + dirigeant, avec photos).
- **Rendez-vous** → le créneau est vérifié en base (capacité, horaires, congés) → enregistré « en attente » → 2 emails. Le dirigeant confirme dans l'admin → email de confirmation au client. Le client peut annuler par le lien de son email.
- **Contact** → enregistré → email au dirigeant (Répondre = répondre au client) + accusé de réception.
- Les emails partent en arrière-plan : si le serveur SMTP est en panne, la demande est quand même enregistrée et visible dans l'admin.
- Toutes les données sont dans `data/dylan-auto.db` : **sauvegardez ce fichier** régulièrement (copie simple).

### API (pour info)
`GET /api/config` · `POST /api/quotes/compute` · `POST /api/quotes` (multipart, photos) · `GET /api/appointments/availability?date=YYYY-MM-DD` ou `?year=&month=` · `POST /api/appointments` · `GET /api/appointments/:ref/cancel?token=` · `POST /api/contact` · `/api/admin/*` (authentification HTTP Basic).

---

## 6. Questions fréquentes

**Les emails arrivent dans les spams.** Utilisez une adresse d'expéditeur du domaine du site et configurez SPF/DKIM chez votre hébergeur email (Brevo le fait automatiquement).

**Je veux 1 seul véhicule par créneau (ou 3).** `config/garage.json` → `booking.capacityPerSlot`.

**Je veux des créneaux de 30 minutes.** `booking.slotMinutes: 30`.

**Ouvrir le samedi matin.** `openingHours["6"]: [["09:00","12:00"]]`.

**J'ai perdu le mot de passe admin.** Changez `ADMIN_PASSWORD` dans `.env` et redémarrez.

**Mettre à jour le site après une modification.** Redémarrez le service (`docker compose up -d --build`, `systemctl restart dylan-auto`, ou redéploiement automatique chez Railway/Render à chaque `git push`).
