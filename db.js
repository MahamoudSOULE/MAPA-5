const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const Database = require('better-sqlite3');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const DB_PATH = path.join(DATA_DIR, 'faliki.db');
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

// ------------------------------------------------------------------
// SCHÉMA
// ------------------------------------------------------------------
db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  display_name TEXT,
  role TEXT NOT NULL DEFAULT 'agent',   -- admin | agent | validateur_tech | validateur_dir | visiteur
  ile TEXT,
  active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS assets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  ile TEXT NOT NULL,
  commune TEXT,
  description TEXT,
  geom_type TEXT NOT NULL,          -- point | polyline | polygon
  coords TEXT NOT NULL,             -- JSON
  superficie REAL DEFAULT 0,
  capacite TEXT,
  status TEXT NOT NULL DEFAULT 'demande',
  /* workflow: demande | collecte | en_validation_technique | en_validation_direction | publie | rejete */
  request_number TEXT,
  author_id INTEGER,
  validated_tech_by INTEGER,
  validated_dir_by INTEGER,
  validation_tech_at TEXT,
  validation_dir_at TEXT,
  published_at TEXT,
  rejection_reason TEXT,
  photos TEXT DEFAULT '[]',         -- JSON array of uploaded photo urls
  budget REAL DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS asset_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  asset_id INTEGER NOT NULL,
  from_status TEXT,
  to_status TEXT NOT NULL,
  user_id INTEGER,
  note TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  type TEXT NOT NULL,
  ile TEXT,
  description TEXT,
  date TEXT,
  status TEXT DEFAULT 'soumis',     -- soumis | valide | rejete
  author_id INTEGER,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS projects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  bailleur TEXT,
  budget REAL DEFAULT 0,
  consumed REAL DEFAULT 0,
  benef INTEGER DEFAULT 0,
  statut TEXT DEFAULT 'En cours',
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);
`);

// ------------------------------------------------------------------
// SEED — utilisateurs initiaux
// ------------------------------------------------------------------
const count = db.prepare('SELECT COUNT(*) c FROM users').get().c;
if (count === 0) {
  const ins = db.prepare('INSERT INTO users (username, password_hash, display_name, role, ile) VALUES (?,?,?,?,?)');
  const seed = [
    ['admin', 'admin123', 'Administrateur National', 'admin', 'Ngazidja'],
    ['tech', 'tech123', 'Validateur Technique', 'validateur_tech', 'Ngazidja'],
    ['dir', 'dir123', 'Direction Nationale', 'validateur_dir', 'Ngazidja'],
    ['agent1', 'agent123', 'Ali Mchangama', 'agent', 'Ngazidja'],
    ['agent2', 'agent123', 'Hassani Abdou', 'agent', 'Ndzuwani'],
    ['agent3', 'agent123', 'Said Mohamed', 'agent', 'Mwali'],
  ];
  seed.forEach(([u, p, d, r, i]) => ins.run(u, bcrypt.hashSync(p, 10), d, r, i));
}

// ------------------------------------------------------------------
// SEED — actifs de démonstration + workflow varié
// ------------------------------------------------------------------
const aCount = db.prepare('SELECT COUNT(*) c FROM assets').get().c;
if (aCount === 0) {
  const insAsset = db.prepare(`INSERT INTO assets
    (name,type,ile,commune,description,geom_type,coords,superficie,capacite,status,request_number,author_id,validated_tech_by,validated_dir_by,validation_tech_at,validation_dir_at,published_at,budget,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);

  const now = new Date().toISOString().slice(0,10);
  const T = now, T1 = subDays(now,1), T2 = subDays(now,2), T7 = subDays(now,7), T14 = subDays(now,14), T21 = subDays(now,21), T30 = subDays(now,30);

  const admin = 1, agent1 = 4, agent2 = 5, agent3 = 6, tech = 2, dir = 3;

  const rows = [
    // Publié (workflow terminé) — visible carte publique
    ['Forage de Moroni Centre','forage','Ngazidja','Moroni','Forage équipé pompe solaire Grundfos — dessert 120 ha de périmètres maraîchers','point','[-11.7167,43.2500]',0,'120 m³/j','publie','FDZ-2026-001',agent1,tech,dir,T30,T21,T14,420000,subDay(T30),subDay(T14)],
    // Publié
    ['Retenue d’eau de Mitsamiouli','retenue_eau','Ngazidja','Mitsamiouli','Bassin de rétention en terre damée avec évacuateur de crue — irrigation 45 ha','polygon','[[[-11.8167,43.2833],[-11.8200,43.2900],[-11.8100,43.2950],[-11.8080,43.2850]]]',4500,'8000 m³','publie','FDZ-2026-003',agent1,tech,dir,T21,T14,T7,780000,subDay(T21),subDay(T7)],
    // Publié
    ['Piste rurale Ouroveni-Bambao','piste_rurale','Ndzuwani','Bambao','Piste d’accès aux champs de canne à sucre et girofle — largeur 4m','polyline','[[-12.1667,44.4167],[-12.1700,44.4200],[-12.1750,44.4250],[-12.1800,44.4300]]',0,'3.2 km','publie','FDZ-2026-004',agent2,tech,dir,T21,T14,T7,340000,subDay(T21),subDay(T7)],
    // Publié
    ['Unité de transformation Iconi','unite_transformation','Ngazidja','Iconi','Unité de transformation de manioc en farine et chapelure — capacité 2 t/j','point','[-11.6833,43.2500]',200,'2 tonnes/j','publie','FDZ-2026-006',agent1,tech,dir,T14,T7,T2,560000,subDay(T14),subDay(T2)],
    // En validation direction
    ['Magasin de Domoni','magasin_stockage','Ndzuwani','Domoni','Stockage de semences certifiées, engrais NPK et matériel de protection phytosanitaire','point','[-12.2583,44.5292]',120,'50 tonnes','en_validation_direction','FDZ-2026-011',agent2,tech,null,T7,null,null,310000,subDay(T7),subDay(T2)],
    // En validation technique
    ['Périmètre irrigué Fomboni','perimetre_irrigue','Mwali','Fomboni','Périmètre maraîcher avec canalisations PVC et bassin de stockage','polygon','[[[-12.2833,43.7500],[-12.2900,43.7600],[-12.2850,43.7700],[-12.2800,43.7600]]]',8200,'2.1 ha','en_validation_technique','FDZ-2026-012',agent3,null,null,null,null,null,650000,subDay(T2),subDay(T2)],
    // En collecte terrain
    ['Forage de Mitsoudjé','forage','Ngazidja','Mitsoudjé','Étude hydrogéologique en cours — coupe réalisée à 60m','point','[-11.7333,43.3000]',0,'—','collecte','FDZ-2026-013',agent1,null,null,null,null,null,240000,subDay(T1),subDay(T1)],
    // Demande initiale
    ['Bas-fond aménagé Moya','bas_fond','Ngazidja','Moya','Aménagement de bas-fond rizicole — demande validée au niveau communal','polygon','[[[-11.8333,43.3333],[-11.8400,43.3400],[-11.8300,43.3450],[-11.8280,43.3350]]]',15000,'3.5 ha','demande','FDZ-2026-014',agent1,null,null,null,null,null,480000,subDay(T1),subDay(T1)],
    // Rejeté
    ['Aire piscicole Fomboni','aire_piscicole','Mwali','Fomboni','Projet rejeté : emplacement non conforme au plan d’occupation des sols','point','[-12.3000,43.7333]',0,'—','rejete','FDZ-2026-009',agent3,null,null,null,null,null,150000,subDay(T14),subDay(T7)],
  ];
  rows.forEach((r,i) => {
    insAsset.run(r[0],r[1],r[2],r[3],r[4],r[5],r[6],r[7],r[8],r[9],r[10],r[11],r[12],r[13],r[14],r[15],r[16],r[17],r[18],r[19]);
  });
}

// ------------------------------------------------------------------
// SEED — événements / interventions
// ------------------------------------------------------------------
const eCount = db.prepare('SELECT COUNT(*) c FROM events').get().c;
if (eCount === 0) {
  const ins = db.prepare('INSERT INTO events (title,type,ile,description,date,status,author_id) VALUES (?,?,?,?,?,?,?)');
  ins.run('Distribution plants de vanille Bourbon — Moya','distribution','Ngazidja','Distribution de 5 000 plants aux producteurs certifiés','2026-08-05','valide',4);
  ins.run('Formation GAP Groupement Bambao (riz)','formation','Ngazidja','Formation sur les bonnes pratiques agricoles — riz pluvial','2026-08-02','valide',4);
  ins.run('Réhabilitation piste Mutsamudu-Ongoni','rehabilitation','Ndzuwani','Réhabilitation de 2 km de piste rurale','2026-07-25','soumis',5);
  ins.run('Distribution intrants — Fomboni','distribution','Mwali','Engrais NPK et semences pour la campagne 2026','2026-07-30','soumis',6);
}

// ------------------------------------------------------------------
// SEED — projets / bailleurs
// ------------------------------------------------------------------
const pCount = db.prepare('SELECT COUNT(*) c FROM projects').get().c;
if (pCount === 0) {
  const ins = db.prepare('INSERT INTO projects (name,bailleur,budget,consumed,benef,statut) VALUES (?,?,?,?,?,?)');
  ins.run('PADESCA II','Banque Mondiale',12500000,8200000,12400,'En cours');
  ins.run('Projet Riz (FAO)','FAO',3500000,2100000,3800,'En cours');
  ins.run('Appui Pêche Durable','Union Européenne',2800000,1900000,2100,'En cours');
  ins.run('REDD+ Comores','GEF / PNUD',4200000,1200000,5600,'Démarrage');
}

// ------------------------------------------------------------------
// SEED — paramètres par défaut
// ------------------------------------------------------------------
const sCount = db.prepare('SELECT COUNT(*) c FROM settings').get().c;
if (sCount === 0) {
  const ins = db.prepare('INSERT INTO settings (key,value) VALUES (?,?)');
  ins.run('default_basemap','osm');
  ins.run('org_name','FALIKI ZA DIMA');
  ins.run('org_subtitle','Système d\'Information Géographique Agricole — Union des Comores');
}

function subDays(dateStr, n) {
  const d = new Date(dateStr);
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0,10);
}
function subDay(dateStr) { return dateStr; }

module.exports = db;
