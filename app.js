// ============================================================
// server.js — Serveur Express pour FALIKI ZA DIMA / SIGA
// Compatible Render, détection automatique de l'index.html
// ============================================================

const express = require('express');
const path = require('path');
const fs = require('fs');
const session = require('express-session');
const sqlite3 = require('sqlite3').verbose();
const { v4: uuidv4 } = require('uuid');
const bcrypt = require('bcrypt');

const app = express();
const PORT = process.env.PORT || 3000;

// ---------- Configuration de la base de données ----------
const DB_FILE = path.join(__dirname, 'data.db');
const db = new sqlite3.Database(DB_FILE, (err) => {
  if (err) {
    console.error('❌ Erreur de connexion à la base', err.message);
  } else {
    console.log('✅ Connecté à la base SQLite');
    initDb();
  }
});

// ---------- Initialisation des tables ----------
function initDb() {
  db.serialize(() => {
    // Utilisateurs
    db.run(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        display_name TEXT,
        role TEXT NOT NULL DEFAULT 'visiteur',
        ile TEXT,
        active INTEGER DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Actifs
    db.run(`
      CREATE TABLE IF NOT EXISTS assets (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        request_number TEXT UNIQUE NOT NULL,
        name TEXT NOT NULL,
        type TEXT NOT NULL,
        ile TEXT NOT NULL,
        commune TEXT,
        description TEXT,
        geom_type TEXT NOT NULL,
        coords TEXT NOT NULL,
        superficie REAL DEFAULT 0,
        capacite TEXT,
        budget REAL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'demande',
        author_id INTEGER,
        author_name TEXT,
        rejection_reason TEXT,
        validated_tech_by INTEGER,
        validated_dir_by INTEGER,
        published_at DATETIME,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (author_id) REFERENCES users(id),
        FOREIGN KEY (validated_tech_by) REFERENCES users(id),
        FOREIGN KEY (validated_dir_by) REFERENCES users(id)
      )
    `);

    // Historique
    db.run(`
      CREATE TABLE IF NOT EXISTS asset_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        asset_id INTEGER NOT NULL,
        from_status TEXT,
        to_status TEXT NOT NULL,
        note TEXT,
        user_id INTEGER,
        user_name TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (asset_id) REFERENCES assets(id),
        FOREIGN KEY (user_id) REFERENCES users(id)
      )
    `);

    // Événements
    db.run(`
      CREATE TABLE IF NOT EXISTS events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        type TEXT NOT NULL,
        ile TEXT NOT NULL,
        date TEXT NOT NULL,
        description TEXT,
        status TEXT DEFAULT 'en_attente',
        author_id INTEGER,
        author_name TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (author_id) REFERENCES users(id)
      )
    `);

    // Projets
    db.run(`
      CREATE TABLE IF NOT EXISTS projects (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        bailleur TEXT NOT NULL,
        budget REAL DEFAULT 0,
        consumed REAL DEFAULT 0,
        benef INTEGER DEFAULT 0,
        statut TEXT DEFAULT 'En cours'
      )
    `);

    // Paramètres
    db.run(`
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT
      )
    `);

    // Référentiel
    db.run(`
      CREATE TABLE IF NOT EXISTS referentiel (
        ile TEXT PRIMARY KEY,
        communes TEXT
      )
    `);

    // Fonds de carte
    db.run(`
      CREATE TABLE IF NOT EXISTS basemaps (
        id TEXT PRIMARY KEY,
        name TEXT,
        url TEXT,
        attribution TEXT,
        maxZoom INTEGER,
        preview TEXT,
        icon TEXT,
        comores INTEGER DEFAULT 0
      )
    `);

    // Données par défaut
    db.get("SELECT COUNT(*) as count FROM users", (err, row) => {
      if (err) return;
      if (row.count === 0) {
        const hashed = bcrypt.hashSync('admin123', 10);
        db.run(
          "INSERT INTO users (username, password, display_name, role) VALUES (?, ?, ?, ?)",
          ['admin', hashed, 'Administrateur', 'admin']
        );

        const projects = [
          ['Projet CVA', 'PNUD', 2500000, 1800000, 1200, 'En cours'],
          ['Programme Eau', 'Union Européenne', 3200000, 2100000, 800, 'En cours'],
          ['Restauration des sols', 'FAO', 1500000, 900000, 600, 'En cours']
        ];
        const stmt = db.prepare("INSERT INTO projects (name, bailleur, budget, consumed, benef, statut) VALUES (?, ?, ?, ?, ?, ?)");
        projects.forEach(p => stmt.run(p));
        stmt.finalize();

        const basemaps = [
          ['satellite', 'Satellite (ESRI)', 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', 'ESRI', 19, '#2d4a2d', '🛰️', 0],
          ['openstreetmap', 'OpenStreetMap', 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', 'OpenStreetMap', 18, '#f0f0e8', '🗺️', 0],
          ['comores', 'Orthophoto Comores', '', 'MAPA', 15, '#1a472a', '🇰🇲', 1]
        ];
        const bstmt = db.prepare("INSERT OR IGNORE INTO basemaps (id, name, url, attribution, maxZoom, preview, icon, comores) VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
        basemaps.forEach(b => bstmt.run(b));
        bstmt.finalize();

        db.run("INSERT OR IGNORE INTO settings (key, value) VALUES ('default_basemap', 'satellite')");
        db.run("INSERT OR IGNORE INTO settings (key, value) VALUES ('org_name', 'MAPA - Direction Nationale de Stratégie Agricole')");
        db.run("INSERT OR IGNORE INTO settings (key, value) VALUES ('org_subtitle', 'Union des Comores')");
      }
    });
  });
}

// ---------- Middlewares ----------
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Sessions (MemoryStore pour le dev – à remplacer en production)
app.use(session({
  secret: 'siga-secret-change-me',
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false, maxAge: 24 * 60 * 60 * 1000 }
}));

// CORS pour le dev
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
  next();
});

// ---------- Détection automatique de l'index.html ----------
const indexPaths = [
  path.join(__dirname, 'public', 'index.html'),
  path.join(__dirname, 'index.html')
];
let indexFile = indexPaths.find(p => fs.existsSync(p));
if (!indexFile) {
  console.warn('⚠️ index.html introuvable, fallback sur le chemin par défaut');
  indexFile = path.join(__dirname, 'public', 'index.html');
}
console.log(`📄 Fichier index.html servi depuis : ${indexFile}`);

// ---------- Fichiers statiques ----------
// Si le dossier public existe, on le sert
if (fs.existsSync(path.join(__dirname, 'public'))) {
  app.use(express.static(path.join(__dirname, 'public')));
  console.log('📁 Dossier public/ servi');
} else {
  console.warn('⚠️ Dossier public/ absent, seuls les fichiers statiques seront ignorés');
}

// ---------- Routes API ----------
// (Toutes les routes API identiques à celles fournies précédemment)
// Pour des raisons de concision, je les résume ici – veuillez copier l'intégralité du code
// des routes depuis la réponse précédente. Je les inclus ci-dessous de façon complète.

// Helper : récupérer l'utilisateur courant
function getCurrentUser(req) {
  if (req.session && req.session.userId) {
    return new Promise((resolve, reject) => {
      db.get(
        "SELECT id, username, display_name, role, ile, active FROM users WHERE id = ?",
        [req.session.userId],
        (err, user) => {
          if (err) reject(err);
          else resolve(user);
        }
      );
    });
  }
  return Promise.resolve(null);
}

// Middleware d'authentification
function requireAuth(req, res, next) {
  if (req.session && req.session.userId) {
    next();
  } else {
    res.status(401).json({ error: 'Non authentifié' });
  }
}

// -------- Routes ----------

// Session
app.get('/api/session', async (req, res) => {
  try {
    const user = await getCurrentUser(req);
    if (user && user.active !== 0) {
      res.json({ user });
    } else {
      res.json({ user: null });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Login
app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'Identifiants requis' });
  }
  try {
    const user = await new Promise((resolve, reject) => {
      db.get("SELECT * FROM users WHERE username = ?", [username], (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });
    if (!user || user.active === 0) {
      return res.status(401).json({ error: 'Utilisateur inactif ou inexistant' });
    }
    const match = await bcrypt.compare(password, user.password);
    if (!match) {
      return res.status(401).json({ error: 'Mot de passe incorrect' });
    }
    req.session.userId = user.id;
    res.json({ user: { id: user.id, username: user.username, display_name: user.display_name, role: user.role, ile: user.ile } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Visiteur
app.post('/api/visitor-login', (req, res) => {
  req.session.userId = null;
  res.json({ user: { id: null, username: 'visiteur', display_name: 'Visiteur', role: 'visiteur' } });
});

// Logout
app.post('/api/logout', (req, res) => {
  req.session.destroy();
  res.json({ ok: true });
});

// -------- Actifs --------
app.get('/api/assets', requireAuth, (req, res) => {
  let sql = "SELECT * FROM assets";
  const params = [];
  if (req.session.userId) {
    db.get("SELECT role FROM users WHERE id = ?", [req.session.userId], (err, user) => {
      if (err) return res.status(500).json({ error: err.message });
      if (user && user.role === 'visiteur') {
        sql += " WHERE status = 'publie'";
      }
      db.all(sql, params, (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        rows.forEach(r => { try { r.coords = JSON.parse(r.coords); } catch(e) { r.coords = []; } });
        res.json(rows);
      });
    });
  } else {
    sql += " WHERE status = 'publie'";
    db.all(sql, params, (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      rows.forEach(r => { try { r.coords = JSON.parse(r.coords); } catch(e) { r.coords = []; } });
      res.json(rows);
    });
  }
});

app.get('/api/assets/:id', requireAuth, (req, res) => {
  const id = req.params.id;
  db.get("SELECT * FROM assets WHERE id = ?", [id], (err, row) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!row) return res.status(404).json({ error: 'Actif non trouvé' });
    try { row.coords = JSON.parse(row.coords); } catch(e) { row.coords = []; }
    const techId = row.validated_tech_by;
    const dirId = row.validated_dir_by;
    const extra = {};
    if (techId) {
      db.get("SELECT display_name FROM users WHERE id = ?", [techId], (err, u) => {
        extra.tech_name = u ? u.display_name : null;
        if (dirId) {
          db.get("SELECT display_name FROM users WHERE id = ?", [dirId], (err, u2) => {
            extra.dir_name = u2 ? u2.display_name : null;
            res.json({ ...row, ...extra });
          });
        } else {
          res.json({ ...row, ...extra });
        }
      });
    } else {
      if (dirId) {
        db.get("SELECT display_name FROM users WHERE id = ?", [dirId], (err, u2) => {
          extra.dir_name = u2 ? u2.display_name : null;
          res.json({ ...row, ...extra });
        });
      } else {
        res.json(row);
      }
    }
  });
});

app.get('/api/assets/:id/history', requireAuth, (req, res) => {
  const id = req.params.id;
  db.all(
    "SELECT * FROM asset_history WHERE asset_id = ? ORDER BY created_at ASC",
    [id],
    (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json(rows);
    }
  );
});

app.post('/api/assets', requireAuth, async (req, res) => {
  const user = await getCurrentUser(req);
  if (!user) return res.status(401).json({ error: 'Non authentifié' });
  const { name, type, ile, commune, description, geom_type, coords, superficie, capacite, budget } = req.body;
  if (!name || !type || !ile || !geom_type || !coords) {
    return res.status(400).json({ error: 'Champs requis manquants' });
  }
  const count = await new Promise((resolve) => {
    db.get("SELECT COUNT(*) as cnt FROM assets", (err, row) => { resolve(row ? row.cnt : 0); });
  });
  const request_number = `FALIKI-${String(count + 1).padStart(4, '0')}`;
  const coordsJson = JSON.stringify(coords);
  const status = 'demande';
  const sql = `
    INSERT INTO assets 
    (request_number, name, type, ile, commune, description, geom_type, coords, superficie, capacite, budget, status, author_id, author_name)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `;
  db.run(sql, [request_number, name, type, ile, commune, description, geom_type, coordsJson, superficie || 0, capacite || '', budget || 0, status, user.id, user.display_name || user.username], function(err) {
    if (err) return res.status(500).json({ error: err.message });
    const assetId = this.lastID;
    db.run(
      "INSERT INTO asset_history (asset_id, from_status, to_status, user_id, user_name) VALUES (?, NULL, ?, ?, ?)",
      [assetId, status, user.id, user.display_name || user.username]
    );
    res.json({ id: assetId, request_number });
  });
});

app.put('/api/assets/:id', requireAuth, async (req, res) => {
  const user = await getCurrentUser(req);
  if (!user) return res.status(401).json({ error: 'Non authentifié' });
  const id = req.params.id;
  const { name, type, ile, commune, description, geom_type, coords, superficie, capacite, budget } = req.body;
  db.get("SELECT author_id, status FROM assets WHERE id = ?", [id], (err, asset) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!asset) return res.status(404).json({ error: 'Actif non trouvé' });
    if (user.role !== 'admin' && user.id !== asset.author_id) {
      return res.status(403).json({ error: 'Non autorisé' });
    }
    if (user.role !== 'admin' && !['demande', 'collecte'].includes(asset.status)) {
      return res.status(403).json({ error: 'Modification non autorisée à ce stade du workflow' });
    }
    const coordsJson = JSON.stringify(coords);
    const sql = `
      UPDATE assets SET 
        name = ?, type = ?, ile = ?, commune = ?, description = ?, geom_type = ?, coords = ?, superficie = ?, capacite = ?, budget = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `;
    db.run(sql, [name, type, ile, commune, description, geom_type, coordsJson, superficie || 0, capacite || '', budget || 0, id], function(err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ success: true });
    });
  });
});

app.post('/api/assets/:id/transition', requireAuth, async (req, res) => {
  const user = await getCurrentUser(req);
  if (!user) return res.status(401).json({ error: 'Non authentifié' });
  const id = req.params.id;
  const { to, note } = req.body;
  if (!to) return res.status(400).json({ error: 'Statut cible requis' });

  db.get("SELECT * FROM assets WHERE id = ?", [id], (err, asset) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!asset) return res.status(404).json({ error: 'Actif non trouvé' });

    const from = asset.status;
    const isAdmin = user.role === 'admin';
    const isAgent = user.role === 'agent';
    const isTech = user.role === 'validateur_tech';
    const isDir = user.role === 'validateur_dir';

    let allowed = false;
    if (isAdmin) {
      allowed = true;
    } else if (from === 'demande' && to === 'collecte' && isAgent) {
      allowed = true;
    } else if (from === 'collecte' && to === 'en_validation_technique' && (isAgent || isTech)) {
      allowed = true;
    } else if (from === 'en_validation_technique' && to === 'en_validation_direction' && isTech) {
      allowed = true;
    } else if (from === 'en_validation_direction' && to === 'publie' && isDir) {
      allowed = true;
    } else if (to === 'rejete' && (isAdmin || isTech || isDir)) {
      allowed = true;
    } else if (from === 'publie' && to === 'suivi' && isAdmin) {
      allowed = true;
    }

    if (!allowed) {
      return res.status(403).json({ error: 'Transition non autorisée pour ce rôle' });
    }

    const updates = { status: to, updated_at: new Date().toISOString() };
    if (to === 'rejete') {
      updates.rejection_reason = note || 'Rejeté';
    }
    if (to === 'en_validation_technique') {
      updates.validated_tech_by = user.id;
    }
    if (to === 'en_validation_direction') {
      updates.validated_dir_by = user.id;
    }
    if (to === 'publie') {
      updates.published_at = new Date().toISOString();
    }

    const setClause = Object.keys(updates).map(k => `${k} = ?`).join(', ');
    const values = Object.values(updates);
    values.push(id);

    db.run(`UPDATE assets SET ${setClause} WHERE id = ?`, values, function(err) {
      if (err) return res.status(500).json({ error: err.message });
      db.run(
        "INSERT INTO asset_history (asset_id, from_status, to_status, note, user_id, user_name) VALUES (?, ?, ?, ?, ?, ?)",
        [id, from, to, note || null, user.id, user.display_name || user.username]
      );
      res.json({ success: true });
    });
  });
});

app.delete('/api/assets/:id', requireAuth, async (req, res) => {
  const user = await getCurrentUser(req);
  if (!user) return res.status(401).json({ error: 'Non authentifié' });
  const id = req.params.id;
  db.get("SELECT author_id, status FROM assets WHERE id = ?", [id], (err, asset) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!asset) return res.status(404).json({ error: 'Actif non trouvé' });
    if (user.role !== 'admin' && (user.id !== asset.author_id || !['demande', 'collecte'].includes(asset.status))) {
      return res.status(403).json({ error: 'Non autorisé à supprimer' });
    }
    db.run("DELETE FROM assets WHERE id = ?", [id], function(err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ success: true });
    });
  });
});

// -------- Événements --------
app.get('/api/events', requireAuth, (req, res) => {
  db.all("SELECT * FROM events ORDER BY created_at DESC", (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

app.post('/api/events', requireAuth, async (req, res) => {
  const user = await getCurrentUser(req);
  if (!user) return res.status(401).json({ error: 'Non authentifié' });
  const { title, type, ile, date, description } = req.body;
  if (!title || !type || !ile || !date) {
    return res.status(400).json({ error: 'Champs requis manquants' });
  }
  db.run(
    "INSERT INTO events (title, type, ile, date, description, author_id, author_name) VALUES (?, ?, ?, ?, ?, ?, ?)",
    [title, type, ile, date, description || '', user.id, user.display_name || user.username],
    function(err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ id: this.lastID });
    }
  );
});

// -------- Projets --------
app.get('/api/projects', (req, res) => {
  db.all("SELECT * FROM projects", (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

// -------- Statistiques --------
app.get('/api/stats', (req, res) => {
  const stats = { total: 0, pending: 0, rejete: 0, events: 0, superficie: 0, byStatus: {} };
  db.get("SELECT COUNT(*) as total FROM assets", (err, row) => {
    if (err) return res.status(500).json({ error: err.message });
    stats.total = row.total;
    db.get("SELECT COUNT(*) as pending FROM assets WHERE status IN ('demande','collecte','en_validation_technique','en_validation_direction')", (err2, row2) => {
      if (err2) return res.status(500).json({ error: err2.message });
      stats.pending = row2.pending;
      db.get("SELECT COUNT(*) as rejete FROM assets WHERE status = 'rejete'", (err3, row3) => {
        if (err3) return res.status(500).json({ error: err3.message });
        stats.rejete = row3.rejete;
        db.get("SELECT COUNT(*) as events FROM events", (err4, row4) => {
          if (err4) return res.status(500).json({ error: err4.message });
          stats.events = row4.events;
          db.get("SELECT SUM(superficie) as superficie FROM assets", (err5, row5) => {
            if (err5) return res.status(500).json({ error: err5.message });
            stats.superficie = row5.superficie || 0;
            db.all("SELECT status, COUNT(*) as count FROM assets GROUP BY status", (err6, rows) => {
              if (err6) return res.status(500).json({ error: err6.message });
              const byStatus = {};
              rows.forEach(r => { byStatus[r.status] = r.count; });
              stats.byStatus = byStatus;
              res.json(stats);
            });
          });
        });
      });
    });
  });
});

// -------- Utilisateurs (admin) --------
app.get('/api/users', requireAuth, async (req, res) => {
  const user = await getCurrentUser(req);
  if (!user || user.role !== 'admin') {
    return res.status(403).json({ error: 'Accès réservé à l\'administrateur' });
  }
  db.all("SELECT id, username, display_name, role, ile, active FROM users", (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

app.post('/api/users', requireAuth, async (req, res) => {
  const admin = await getCurrentUser(req);
  if (!admin || admin.role !== 'admin') {
    return res.status(403).json({ error: 'Accès réservé à l\'administrateur' });
  }
  const { username, display_name, password, role, ile } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'Identifiant et mot de passe requis' });
  }
  const hashed = await bcrypt.hash(password, 10);
  db.run(
    "INSERT INTO users (username, password, display_name, role, ile) VALUES (?, ?, ?, ?, ?)",
    [username, hashed, display_name || username, role || 'visiteur', ile || null],
    function(err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ id: this.lastID });
    }
  );
});

app.put('/api/users/:id', requireAuth, async (req, res) => {
  const admin = await getCurrentUser(req);
  if (!admin || admin.role !== 'admin') {
    return res.status(403).json({ error: 'Accès réservé à l\'administrateur' });
  }
  const id = req.params.id;
  const { password } = req.body;
  if (password) {
    const hashed = await bcrypt.hash(password, 10);
    db.run("UPDATE users SET password = ? WHERE id = ?", [hashed, id], function(err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ success: true });
    });
  } else {
    res.status(400).json({ error: 'Aucune modification fournie' });
  }
});

app.delete('/api/users/:id', requireAuth, async (req, res) => {
  const admin = await getCurrentUser(req);
  if (!admin || admin.role !== 'admin') {
    return res.status(403).json({ error: 'Accès réservé à l\'administrateur' });
  }
  const id = req.params.id;
  if (parseInt(id) === admin.id) {
    return res.status(400).json({ error: 'Vous ne pouvez pas vous supprimer vous-même' });
  }
  db.run("DELETE FROM users WHERE id = ?", [id], function(err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ success: true });
  });
});

// -------- Référentiel --------
app.get('/api/referentiel', (req, res) => {
  const ref = {
    'Ngazidja': ['Moroni', 'Mitsamiouli', 'Mboini', 'Hahaia', 'Ntsoudjini', 'Mboudé', 'Vanambouani', 'Ouellah', 'Itsandra', 'Ndjouoni'],
    'Ndzuwani': ['Mutsamudu', 'Domoni', 'Sima', 'Ouani', 'Mirontsi', 'Mremani', 'Koni-Djoj', 'Koni-Ngani', 'Ongodjou', 'Jimilimé'],
    'Mwali': ['Fomboni', 'Nioumachoua', 'Moimbassa', 'Djoiezi', 'Miringoni', 'Hoani', 'Ziroudani']
  };
  res.json(ref);
});

// -------- Fonds de carte --------
app.get('/api/basemaps', (req, res) => {
  db.all("SELECT * FROM basemaps", (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

// -------- Paramètres --------
app.get('/api/settings', (req, res) => {
  db.all("SELECT key, value FROM settings", (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    const settings = {};
    rows.forEach(r => { settings[r.key] = r.value; });
    res.json(settings);
  });
});

app.put('/api/settings', requireAuth, async (req, res) => {
  const user = await getCurrentUser(req);
  if (!user || user.role !== 'admin') {
    return res.status(403).json({ error: 'Accès réservé à l\'administrateur' });
  }
  const updates = req.body;
  const stmt = db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)");
  for (const [key, value] of Object.entries(updates)) {
    stmt.run(key, String(value));
  }
  stmt.finalize();
  res.json({ success: true });
});

// -------- Export --------
app.get('/api/export/:format', requireAuth, (req, res) => {
  const format = req.params.format;
  db.all("SELECT * FROM assets", (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    rows.forEach(r => { try { r.coords = JSON.parse(r.coords); } catch(e) { r.coords = []; } });
    if (format === 'geojson') {
      const features = rows.map(a => {
        let geometry = null;
        if (a.geom_type === 'point') {
          geometry = { type: 'Point', coordinates: a.coords };
        } else if (a.geom_type === 'polyline') {
          geometry = { type: 'LineString', coordinates: a.coords };
        } else if (a.geom_type === 'polygon') {
          geometry = { type: 'Polygon', coordinates: a.coords };
        }
        return {
          type: 'Feature',
          geometry: geometry,
          properties: {
            id: a.id,
            request_number: a.request_number,
            name: a.name,
            type: a.type,
            ile: a.ile,
            commune: a.commune,
            description: a.description,
            superficie: a.superficie,
            capacite: a.capacite,
            budget: a.budget,
            status: a.status,
            author_name: a.author_name,
            created_at: a.created_at,
            published_at: a.published_at
          }
        };
      });
      const fc = { type: 'FeatureCollection', features };
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', `attachment; filename=assets.geojson`);
      res.send(JSON.stringify(fc));
    } else if (format === 'csv') {
      const header = 'id,request_number,name,type,ile,commune,description,geom_type,superficie,capacite,budget,status,author_name,created_at,published_at\n';
      const lines = rows.map(a => {
        const coordsStr = a.coords ? JSON.stringify(a.coords) : '';
        return `${a.id},${a.request_number},"${a.name}","${a.type}","${a.ile}","${a.commune||''}","${a.description||''}","${a.geom_type}",${a.superficie},"${a.capacite||''}",${a.budget},"${a.status}","${a.author_name||''}","${a.created_at}","${a.published_at||''}"`;
      });
      const csv = header + lines.join('\n');
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename=assets.csv`);
      res.send(csv);
    } else {
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', `attachment; filename=assets.json`);
      res.send(JSON.stringify(rows));
    }
  });
});

// -------- Import --------
app.post('/api/import', requireAuth, async (req, res) => {
  const user = await getCurrentUser(req);
  if (!user) return res.status(401).json({ error: 'Non authentifié' });
  const { data, type } = req.body;
  if (!data) return res.status(400).json({ error: 'Données manquantes' });
  let features = [];
  try {
    if (type === 'geojson') {
      const parsed = JSON.parse(data);
      if (parsed.type === 'FeatureCollection') {
        features = parsed.features;
      } else if (parsed.type === 'Feature') {
        features = [parsed];
      } else {
        return res.status(400).json({ error: 'Format GeoJSON non reconnu' });
      }
    } else if (type === 'csv') {
      const lines = data.split('\n').filter(line => line.trim() !== '');
      if (lines.length < 2) return res.status(400).json({ error: 'CSV vide' });
      const headers = lines[0].split(',').map(h => h.trim());
      const rows = lines.slice(1).map(line => {
        const cols = line.split(',').map(c => c.trim());
        const obj = {};
        headers.forEach((h, i) => { obj[h] = cols[i] || ''; });
        return obj;
      });
      features = rows.map(row => {
        const lat = parseFloat(row.lat || row.latitude || 0);
        const lon = parseFloat(row.lon || row.longitude || 0);
        const geom = (lat && lon) ? { type: 'Point', coordinates: [lon, lat] } : null;
        return {
          type: 'Feature',
          geometry: geom,
          properties: row
        };
      }).filter(f => f.geometry);
    } else {
      return res.status(400).json({ error: 'Type non supporté' });
    }
  } catch(e) {
    return res.status(400).json({ error: 'Erreur de parsing : ' + e.message });
  }

  let count = 0;
  for (const feature of features) {
    const props = feature.properties || {};
    const geom = feature.geometry;
    if (!geom) continue;
    const name = props.name || 'Importé';
    const type = props.type || 'forage';
    const ile = props.ile || 'Ngazidja';
    const commune = props.commune || '';
    const description = props.description || '';
    const geom_type = geom.type === 'Point' ? 'point' : geom.type === 'LineString' ? 'polyline' : geom.type === 'Polygon' ? 'polygon' : 'point';
    const coords = geom.coordinates;
    const superficie = parseFloat(props.superficie) || 0;
    const capacite = props.capacite || '';
    const budget = parseFloat(props.budget) || 0;
    const cnt = await new Promise((resolve) => {
      db.get("SELECT COUNT(*) as cnt FROM assets", (err, row) => { resolve(row ? row.cnt : 0); });
    });
    const request_number = `FALIKI-${String(cnt + 1 + count).padStart(4, '0')}`;
    const status = 'en_validation_technique';
    const sql = `
      INSERT INTO assets 
      (request_number, name, type, ile, commune, description, geom_type, coords, superficie, capacite, budget, status, author_id, author_name)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;
    try {
      await new Promise((resolve, reject) => {
        db.run(sql, [request_number, name, type, ile, commune, description, geom_type, JSON.stringify(coords), superficie, capacite, budget, status, user.id, user.display_name || user.username], function(err) {
          if (err) reject(err);
          else {
            const assetId = this.lastID;
            db.run(
              "INSERT INTO asset_history (asset_id, from_status, to_status, user_id, user_name) VALUES (?, NULL, ?, ?, ?)",
              [assetId, status, user.id, user.display_name || user.username]
            );
            resolve();
          }
        });
      });
      count++;
    } catch(err) {
      console.error('Erreur import ligne', err);
    }
  }
  res.json({ count });
});

// ---------- Fallback SPA (après les routes API) ----------
// Cette route renvoie index.html pour toute requête non-API,
// permettant au routeur côté client de gérer la navigation.

app.get('*', (req, res) => {
  if (req.path.startsWith('/api')) {
    return res.status(404).json({ error: 'API endpoint not found' });
  }
  // Vérifier si indexFile existe, sinon renvoyer une erreur 500
  if (!fs.existsSync(indexFile)) {
    return res.status(500).send('Fichier index.html introuvable');
  }
  res.sendFile(indexFile);
});

// ---------- Démarrage du serveur ----------
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 FALIKI ZA DIMA lancé sur http://0.0.0.0:${PORT}`);
  console.log(`📁 Base : ${DB_FILE}`);
  console.log(`🔑 Admin par défaut : admin / admin123`);
});

// Gestion propre de l'arrêt
process.on('SIGTERM', () => {
  console.log('🛑 Arrêt du serveur...');
  db.close();
  process.exit(0);
});
