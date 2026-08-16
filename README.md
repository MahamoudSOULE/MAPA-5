# 🌴 FALIKI ZA DIMA — SIGA (déploiement Render)

**Système d'Information Géographique Agricole** — Union des Comores.
Plateforme développée avec l'appui du projet **Chaîne de Valeur Agricole (CVA)** et **PNUD**.

**Version partagée** : base de données SQLite (serveur) → **tous les agents voient les mêmes données**. **Aucun localStorage.**

---

## 🚀 Déploiement sur Render (gratuit)

Deux façons :

### Méthode 1 — Blueprint (render.yaml) — recommandée
1. Pousse ce dossier dans un dépôt GitHub/GitLab.
2. Sur **[render.com](https://render.com)** → **New** → **Blueprint** → connecte le dépôt.
3. Render détecte `render.yaml` et crée le **Web Service** automatiquement (avec le disque persistant).
4. **Deploy**.

### Méthode 2 — Manuelle (Web Service)
1. **render.com** → **New** → **Web Service** → connecte le dépôt.
2. Remplis :
   - **Name** : `faliki-za-dima`
   - **Environment** : `Node`
   - **Build Command** : `npm install`
   - **Start Command** : `npm start`
   - **Plan** : `Free`
3. **Advanced** → **Add Disk** : name `faliki-data`, mount `/data`, size `1 GB`.
4. **Environment Variables** :
   - `SESSION_SECRET` : (longue chaîne aléatoire)
   - `NODE_ENV` : `production`
   - `DATA_DIR` : `/data`
5. **Deploy Web Service**.

Tu obtiens une URL : **`https://faliki-za-dima.onrender.com`**.

---

## 🔐 Comptes par défaut (démo — à changer en production)

| Rôle | Identifiant | Mot de passe |
|---|---|---|
| Administrateur | `admin` | `admin123` |
| Agent terrain | `agent1` | `agent123` |
| Validateur technique | `tech` | `tech123` |
| Direction | `dir` | `dir123` |
| Visiteur | bouton « Consulter la carte » | — |

> ⚠️ **Seul l'administrateur** valide et publie (contrôlé serveur). Chaque validation est **tracée** (qui / quand).

---

## 🗄️ Persistance des données

- La base SQLite et les photos sont stockées sur le **disque `/data`** (Render Persistent Disk) via la variable `DATA_DIR`.
- **Sur le plan Free**, le disque persiste tant que le service existe. Pour de la production robuste, passez sur un plan payant ou PostgreSQL.

## ✨ Fonctionnalités
- Workflow de bout en bout (Demande → Collecte → Validations → Publication → Suivi).
- Carte avec 6 fonds de carte (Satellite, Carte routière, Sentinel-2, NDVI, Relief, Orthophoto).
- Coordonnées UTM 38S + Lat/Lon + **saisie en UTM**.
- **Import Shapefile / GeoJSON / CSV** (points, lignes, polygones).
- **Export** GeoJSON / CSV / JSON + fiches / registre PDF.
- Validation **admin uniquement** + **traçabilité**.

---

**© 2026 MAPA — Direction Nationale de Stratégie Agricole, Union des Comores.**
