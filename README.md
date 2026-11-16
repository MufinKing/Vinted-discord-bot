# Dealbot

Bot qui surveille **Vinted** et les **alertes e-mail Leboncoin**, repère les articles qui laissent une marge à la revente et les envoie sur **Discord** avec leur photo, leur prix et la marge nette estimée.

> **Ce que c'est :** un programme Node.js qui tourne sur votre ordinateur (ou un Raspberry Pi, un petit serveur).
> **Ce que ce n'est pas :** une extension de navigateur, un Cloudflare Worker, ni un outil d'achat automatique. Voir [Hébergement](#hébergement-et-cloudflare).

## Avertissements importants

- **Conditions d'utilisation.** Lire automatiquement les pages de Vinted va, selon toute vraisemblance, à l'encontre de leurs conditions d'utilisation (lisez-les). Le risque principal est le blocage de votre adresse IP. Vérifiez aussi les règles de chaque plateforme avant d'automatiser quoi que ce soit.
- **Pas de contournement.** Ce projet n'implémente aucun contournement des protections anti-bot (proxys rotatifs, navigateur furtif, usurpation d'empreinte) et n'acceptera pas de contributions en ce sens. Il interroge à faible fréquence (60 secondes minimum par recherche) et se met en pause en cas d'erreur.
- **Pas de conseil financier.** Les prix de revente fournis sont des **exemples** à remplacer par vos propres relevés. Les marges affichées sont des estimations.
- **Revente en France.** Revendre régulièrement des objets d'occasion est une activité professionnelle : statut (micro-entreprise), registre des objets mobiliers, déclaration en préfecture, garanties légales. Renseignez-vous avant de vous lancer.
- Projet indépendant, **non affilié** à Vinted, Leboncoin, Facebook ou Discord. Fourni sans garantie (voir la licence).

## Fonctionnement

```
Vinted (nouveaux articles, par recherche) ──┐
                                             ├─> score.mjs ──> Discord (embed + photo)
Alertes e-mail Leboncoin (Gmail, IMAP) ─────┘   (marge nette)      └─> log.csv (journal)
```

1. **Vinted** : chaque recherche de `vinted-searches.json` est interrogée à intervalle régulier. Seuls les articles **publiés après le démarrage** sont évalués.
2. **E-mail** : vous créez des alertes sur Leboncoin ; le bot lit les mails d'alerte dans une boîte Gmail dédiée et en extrait titre, prix, ville, livraison et image.
3. **Score** : chaque annonce est comparée à vos catégories (marque, mots-clés, exclusions) et sa marge nette est calculée.
4. **Discord** : les annonces rentables arrivent dans votre salon, avec la photo, le coût d'achat tout compris et la fourchette de revente.
5. **Journal** : chaque annonce lue est enregistrée dans `log.csv` pour mesurer l'efficacité du bot (`npm run stats`).

### Calcul de la marge

```
marge nette = revente × (1 − cotisations − commission de vente)
            − [prix + protection acheteur + port d'achat]
            − emballage − port de vente éventuel
```

| Élément | Valeur par défaut |
|---|---|
| Cotisations (micro-entreprise, achat-revente) | 12,3 % du chiffre d'affaires (à vérifier pour votre situation) |
| Protection acheteur Vinted | 0,70 € + 5 % du prix |
| Port d'achat | Par catégorie (ordre de grandeur) |
| Port de vente | À la charge de l'acheteur (`SELL_SHIP_SHARE=0`) |
| Emballage | 2 € par article |

Tous ces chiffres sont des **hypothèses modifiables** dans `score.mjs` et `.env`.

## Prérequis

- **Node.js 20.6 ou plus** (`node -v`)
- Un serveur Discord et un **webhook** (Paramètres du salon > Intégrations > Webhooks)
- Pour la source e-mail : une **boîte Gmail dédiée** avec validation en 2 étapes et un **mot de passe d'application**

## Installation

```bash
git clone https://github.com/MufinKing/Dealbot.git
cd Dealbot
npm install
cp .env.example .env
cp vinted-searches.example.json vinted-searches.json
```

`npm install` n'installe pas les modules optionnels de navigateur automatisé (voir `.npmrc`) : ils ne sont pas utilisés.

## Configuration

### 1. Variables d'environnement (`.env`)

Remplissez au minimum `DISCORD_WEBHOOK_URL`. Pour la source e-mail, ajoutez `GMAIL_USER` et `GMAIL_APP_PASSWORD`.

| Variable | Rôle | Défaut |
|---|---|---|
| `DISCORD_WEBHOOK_URL` | Webhook du salon Discord (secret) | obligatoire |
| `GMAIL_USER`, `GMAIL_APP_PASSWORD` | Boîte Gmail dédiée et mot de passe d'application (secret) | — |
| `ALERT_FROM` | Expéditeurs des alertes (fragments d'adresse, séparés par des virgules) | `leboncoin` |
| `SKIP_SUBJECT` | Objets de mails à ignorer (expression régulière) | reçus, codes, messages, offres… |
| `SOURCES` | `mail`, `vinted` ou `mail,vinted` | les deux |
| `POLL_SECONDS` | Intervalle de relevé de la boîte mail | `120` |
| `VINTED_POLL_SECONDS` | Intervalle par recherche Vinted (minimum 60) | `120` |
| `MIN_NET` | Marge nette minimale pour alerter (€) | `10` |
| `MAX_PER_ITEM` | Prix d'achat maximum par article (€) | `60` |
| `SELL_FEE` | Commission de vente (`0.05` pour Vinted Pro) | `0` |
| `SELL_SHIP_SHARE` | Part du port de vente à votre charge (0 à 1) | `0` |
| `REQUIRE_DELIVERY` | Ignorer les annonces e-mail sans « Livraison possible » | `1` |

### 2. Source e-mail (Leboncoin)

1. Sur Gmail, activez la validation en 2 étapes, puis créez un **mot de passe d'application**.
2. Sur Leboncoin, créez des **recherches enregistrées avec alerte e-mail** vers cette adresse (une par marque ou produit).
3. Gardez les alertes dans la **boîte de réception** (pas de filtre qui les archive ; vérifiez le spam au début).
4. Vérifiez la lecture : `npm run dry`.

Le lecteur de mails est réglé sur le format des alertes Leboncoin (cartes avec titre, prix, ville, « Livraison possible »). Les alertes Facebook Marketplace et Vinted par e-mail ne sont ni prises en charge ni vérifiées.

Si un mail est mal lu, `npm run dump` enregistre le dernier mail d'alerte dans `sample.html` (il contient des liens personnels : ne le publiez pas).

### 3. Source Vinted

Éditez `vinted-searches.json` :

```json
[
  { "query": "sendra", "priceMax": 60 },
  { "query": "barbour", "priceMax": 50, "country": "fr" }
]
```

| Champ | Rôle |
|---|---|
| `query` | Mots de la recherche. Astuce : « joy-con » est coupé en deux mots par Vinted, préférez `joycon nintendo switch`. |
| `priceMax` | Prix maximum demandé (réduit le bruit et le volume) |
| `country` | Pays Vinted (`fr` par défaut) |

Plus il y a de recherches, plus le risque de blocage augmente : commencez avec 3 ou 4.

### 4. Vos catégories et prix de revente

Tout se règle dans `CATEGORIES`, en haut de [`score.mjs`](score.mjs) : mots-clés de marque, mots exigés (`needs`) et exclus (`not`), prix de revente prudent (`resale`), fourchette haute (`high`), achat maximum (`maxBuy`), port d'achat (`buyShip`) et, si vous le souhaitez, des prix **par modèle** (`models`).

**Les prix fournis sont des exemples** (bottes western, vestes Barbour, chapeaux, consoles). Remplacez-les par vos propres relevés. Méthode conseillée : relever les prix demandés pour la même marque sur plusieurs pages d'annonces, prendre le **premier quartile** comme prix de revente prudent (les prix demandés dépassent toujours les prix obtenus), puis corriger avec vos ventes réelles.

`node score.mjs` lance les tests : ajoutez-y des cas dès que vous touchez aux filtres.

## Utilisation

| Commande | Effet |
|---|---|
| `npm run dry` | Affiche ce qui est lu et le verdict, **sans rien envoyer** (à lancer en premier) |
| `npm start` | Lance le bot (Ctrl+C pour l'arrêter) |
| `npm run dump` | Enregistre le dernier mail d'alerte dans `sample.html` |
| `npm run stats` | Résume `log.csv` : volume, bruit par recherche, alertes par catégorie |
| `npm test` | Tests du scoring |

Au premier démarrage, chaque recherche Vinted mémorise l'article le plus récent **sans alerter** sur l'existant.

## Mesurer l'efficacité

`log.csv` contient une ligne par annonce lue (date, source, titre, prix, catégorie, marge, alerte envoyée, marque, taille, ville, livraison). Ouvrez-le dans un tableur ou lancez `npm run stats`. Mesures utiles :

- **Taux de bruit** par recherche (part des lignes hors cible) : une requête trop floue gaspille des appels.
- **Volume d'alertes** par heure : trop haut, relevez `MIN_NET` ; trop bas, vérifiez vos prix de revente.
- **Précision** : parmi vos alertes, combien valent vraiment le coup après vérification manuelle.
- **Rappel** : les bonnes annonces trouvées à la main figurent-elles dans le journal ?

## Hébergement et Cloudflare

Dealbot est un **programme Node.js à exécution continue** : il garde un état (`state.json`), écrit un journal (`log.csv`) et lit une boîte mail en IMAP. Il **ne fonctionne pas tel quel sur Cloudflare Workers** :

| Limite (offre gratuite) | Conséquence |
|---|---|
| 10 ms de temps CPU par exécution | Trop court pour lire des pages et scorer plusieurs recherches |
| 50 sous-requêtes externes par exécution | Un cycle complet peut les dépasser |
| 5 déclencheurs Cron par compte, pas de processus permanent | Pas de boucle ; état et journal à déplacer vers KV ou D1 |
| IMAP (sockets TCP) | À réécrire avec l'API Gmail ou Cloudflare Email Routing |

Surtout, Vinted et Leboncoin se protègent contre le trafic automatisé et les adresses de centres de données (dont Cloudflare) sont plus souvent bloquées qu'une connexion domestique. **L'hébergement recommandé est donc une machine chez vous** (ordinateur toujours allumé, Raspberry Pi), avec `caffeinate -i npm start` sur Mac pour éviter la mise en veille.

Un portage partiel (la partie e-mail seulement, sur Cloudflare Email Routing ou Google Apps Script) est envisageable : voir la feuille de route.

## Feuille de route

- [ ] Version e-mail seule en Worker / Apps Script (Vinted resterait sur une machine locale)
- [ ] Catégories dans un fichier de configuration plutôt que dans le code
- [ ] Étalonnage des prix à partir d'un fichier de ventes réelles
- [ ] Prise en charge d'autres formats d'alerte e-mail (à vérifier sur des mails réels)
- [ ] README en anglais

## Limites connues

- Le lecteur de mails n'est validé que sur des **exemples** de mails Leboncoin ; son comportement sur tous les formats réels n'est pas garanti.
- Les prix de revente, ports et frais sont des **ordres de grandeur** à confirmer par vos ventes.
- Les articles Vinted venant d'un autre pays ont des frais de port d'achat plus élevés, non modélisés.
- Aucun ajustement de prix par taille : il n'existe pas de données fiables de prix obtenus par taille. La taille est enregistrée dans le journal pour une calibration ultérieure.

## Sécurité

- **Ne publiez jamais** `.env`, le webhook Discord, le mot de passe d'application, `log.csv`, `state.json` ni `sample.html` (le `.gitignore` les exclut déjà). Relisez `git status` avant chaque commit.
- Si un secret fuite, supprimez-le et recréez-le (webhook Discord, mot de passe d'application Google).
- Utilisez une **boîte Gmail dédiée** : le mot de passe d'application donne accès à toute la boîte.

## Contribuer

Les issues et pull requests sont bienvenues, en particulier : exemples de mails d'alerte (anonymisés), cas de test pour `score.mjs`, prix de revente documentés. Les contributions visant à contourner des protections anti-bot ne seront pas acceptées.

## Licence

[MIT](LICENSE). La lecture de Vinted s'appuie sur [`@googlarz/vinted-client`](https://github.com/googlarz/vinted-mcp-cli) (MIT), un projet tiers indépendant.
