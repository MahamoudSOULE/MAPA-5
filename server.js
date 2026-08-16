const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const db = require('./db');

// Fonds de carte (6 recommandés pour une plateforme agricole nationale)
// - Satellite haute résolution (Esri World Imagery)
// - Carte routière (Esri World Street Map)
// - Sentinel-2 vraies couleurs (EOX Cloudless, gratuit sans clé)
// - Sentinel-2 NDVI (végétation)
// - Relief / Terrain (OpenTopoMap)
// - Orthophoto nationale Comores (à connecter aux tuiles du Ministère)
// Le « Plan des îles » est généré côté client en secours automatique si un serveur échoue.
const BASEMAPS = [
  { id:'satellite', name:'Satellite haute résolution', icon:'🛰️', url:'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', attribution:'Tiles © Esri, Maxar, Earthstar', maxZoom:18, preview:'#1d2b1f' },
  { id:'esri-streets', name:'Carte routière', icon:'🗺️', url:'https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}', attribution:'Tiles © Esri', maxZoom:18, preview:'#e8e6df' },
  { id:'sentinel2', name:'Sentinel-2 (vraies couleurs)', icon:'🌱', url:'https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2020_3857/default/g/{z}/{y}/{x}.jpg', attribution:'© Sentinel-2 EOX', maxZoom:17, preview:'#4a6b4f' },
  { id:'ndvi', name:'Sentinel-2 NDVI (végétation)', icon:'🌿', url:'https://tiles.maps.eox.at/wmts/1.0.0/ndvi-2021_3857/default/g/{z}/{y}/{x}.jpg', attribution:'© Sentinel-2 EOX', maxZoom:17, preview:'#7aa855' },
  { id:'topo', name:'Relief / Terrain', icon:'⛰️', url:'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', attribution:'© OpenTopoMap (CC-BY-SA)', maxZoom:17, preview:'#ece8dc' },
  { id:'comores', name:'Orthophoto nationale Comores', icon:'🇰🇲', url:'', comores:true, attribution:'', maxZoom:18, preview:'#b5c6d8' }
];

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(session({
  secret: 'faliki-za-dima-siga-comores-2026',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 1000 * 60 * 60 * 12 } // 12h
}));

// Upload photos terrain
const UPLOAD_DIR = path.join(process.env.DATA_DIR || __dirname, 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, path.join(process.env.DATA_DIR || __dirname, 'uploads')),
  filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname.replace(/[^a-zA-Z0-9.\-_]/g, '_'))
});
const upload = multer({ storage, limits: { fileSize: 8 * 1024 * 1024 } });

app.use('/uploads', express.static(path.join(process.env.DATA_DIR || __dirname, 'uploads')));
app.use(express.static(path.join(__dirname, 'public')));

// ------------------------------------------------------------------
// HELPERS
// ------------------------------------------------------------------
function auth(roles) {
  return (req, res, next) => {
    if (!req.session.user) return res.status(401).json({ error: 'Non authentifié' });
    if (roles && !roles.includes(req.session.user.role))
      return res.status(403).json({ error: 'Accès refusé pour ce rôle' });
    next();
  };
}

const ROLE_LABELS = { admin:'Administrateur', agent:'Agent terrain', validateur_tech:'Validateur technique', validateur_dir:'Direction nationale', visiteur:'Consultation' };

// En-têtes anti-cache pour l'API
app.use('/api', (req,res,next)=>{ res.set('Cache-Control','no-store'); next(); });

// ------------------------------------------------------------------
// AUTH
// ------------------------------------------------------------------
app.get('/api/session', (req, res) => res.json({ user: req.session.user || null }));

app.post('/api/login', (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'Identifiants requis' });
  const user = db.prepare('SELECT * FROM users WHERE username = ? AND active = 1').get(String(username).toLowerCase());
  if (!user || !bcrypt.compareSync(String(password), user.password_hash))
    return res.status(401).json({ error: 'Identifiants incorrects' });
  const u = { id: user.id, username: user.username, display_name: user.display_name, role: user.role, ile: user.ile };
  req.session.user = u;
  res.json({ user: u });
});

app.post('/api/logout', (req, res) => { req.session.destroy(()=>res.json({ ok: true })); });

// Accès visiteur public (carte uniquement)
app.post('/api/visitor-login', (req, res) => {
  req.session.user = { id: 0, username: 'visiteur', display_name: 'Visiteur', role: 'visiteur', ile: null };
  res.json({ user: req.session.user });
});

// ------------------------------------------------------------------
// WORKFLOW — définition des étapes
// ------------------------------------------------------------------
app.get('/api/workflow', (req, res) => {
  res.json({
    stages: [
      { key:'demande', label:'Demande', icon:'📝', desc:'Dépôt de la demande d\'intervention / actif', roles:['agent'] },
      { key:'collecte', label:'Collecte terrain', icon:'📍', desc:'Relevés GPS, mesures, photos sur le terrain', roles:['agent'] },
      { key:'en_validation_technique', label:'Validation technique', icon:'🔬', desc:'Contrôle qualité géospatiale et technique', roles:['validateur_tech','admin'] },
      { key:'en_validation_direction', label:'Validation direction', icon:'🏛️', desc:'Approbation hiérarchique nationale', roles:['validateur_dir','admin'] },
      { key:'publie', label:'Publication', icon:'🌍', desc:'Diffusion publique sur la carte nationale', roles:['admin','validateur_dir'] },
      { key:'suivi', label:'Suivi & évaluation', icon:'📈', desc:'Monitoring, indicateurs, résultats', roles:['admin'] }
    ]
  });
});

// Transitions autorisées
const TRANSITIONS = {
  'demande':['collecte','rejete'],
  'collecte':['en_validation_technique','rejete'],
  'en_validation_technique':['en_validation_direction','rejete'],
  'en_validation_direction':['publie','rejete','en_validation_technique'],
  'publie':['suivi','rejete'],
  'suivi':['rejete']
};

// ------------------------------------------------------------------
// ASSETS
// ------------------------------------------------------------------
const ASSET_SELECT = `SELECT a.*, u.display_name AS author_name, tu.display_name AS tech_name, du.display_name AS dir_name
  FROM assets a
  LEFT JOIN users u ON u.id = a.author_id
  LEFT JOIN users tu ON tu.id = a.validated_tech_by
  LEFT JOIN users du ON du.id = a.validated_dir_by`;

function serializeAsset(a) {
  let coords = a.coords;
  try { coords = JSON.parse(a.coords); } catch(e) {}
  let photos = [];
  try { photos = JSON.parse(a.photos); } catch(e) {}
  return { ...a, coords, photos };
}

app.get('/api/assets', auth(null), (req, res) => {
  const { status, ile, type } = req.query;
  const isVisitor = req.session.user.role === 'visiteur';
  let sql = ASSET_SELECT;
  const where = [];
  const params = [];
  if (isVisitor) where.push('a.status = \'publie\'');
  if (status) { where.push('a.status = ?'); params.push(status); }
  if (ile) { where.push('a.ile = ?'); params.push(ile); }
  if (type) { where.push('a.type = ?'); params.push(type); }
  if (where.length) sql += ' WHERE ' + where.join(' AND ');
  sql += ' ORDER BY a.created_at DESC';
  const rows = db.prepare(sql).all(...params).map(serializeAsset);
  res.json(rows);
});

app.get('/api/assets/:id', auth(null), (req, res) => {
  const a = db.prepare(ASSET_SELECT + ' WHERE a.id = ?').get(req.params.id);
  if (!a) return res.status(404).json({ error: 'Actif introuvable' });
  if (req.session.user.role === 'visiteur' && a.status !== 'publie')
    return res.status(403).json({ error: 'Accès restreint pour les visiteurs' });
  res.json(serializeAsset(a));
});

app.get('/api/assets/:id/history', auth(null), (req, res) => {
  const rows = db.prepare(`SELECT h.*, u.display_name AS user_name FROM asset_history h
    LEFT JOIN users u ON u.id = h.user_id WHERE h.asset_id = ? ORDER BY h.created_at ASC`).all(req.params.id);
  res.json(rows);
});

// Créer une demande (agent)
app.post('/api/assets', auth(['admin','agent','validateur_tech','validateur_dir']), (req, res) => {
  const b = req.body || {};
  if (!b.name || !b.type || !b.ile || !b.geom_type || !b.coords)
    return res.status(400).json({ error: 'Nom, type, île, géométrie et coordonnées requis' });
  const num = `FDZ-${new Date().getFullYear()}-${String(Math.floor(Math.random()*9000)+1000)}`;
  const info = db.prepare(`INSERT INTO assets
    (name,type,ile,commune,description,geom_type,coords,superficie,capacite,status,request_number,author_id,budget)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(b.name,b.type,b.ile,b.commune||'',b.description||'',b.geom_type,JSON.stringify(b.coords),b.superficie||0,b.capacite||'','demande',num,req.session.user.id,b.budget||0);
  logHistory(info.lastInsertRowid, null, 'demande', req.session.user.id, 'Demande créée');
  res.json({ ok:true, id: info.lastInsertRowid, request_number: num });
});

// Mettre à jour (pendant brouillon / collecte par l'agent propriétaire ou admin)
app.put('/api/assets/:id', auth(null), (req, res) => {
  const a = db.prepare('SELECT * FROM assets WHERE id=?').get(req.params.id);
  if (!a) return res.status(404).json({ error: 'Introuvable' });
  const u = req.session.user;
  const allowed = u.role === 'admin' || (u.role === 'agent' && a.author_id === u.id);
  if (!allowed) return res.status(403).json({ error: 'Vous ne pouvez modifier que vos propres saisies' });
  if (!['demande','collecte'].includes(a.status) && u.role !== 'admin')
    return res.status(400).json({ error: 'Modification possible uniquement avant soumission à validation' });
  const b = req.body;
  db.prepare(`UPDATE assets SET name=?, type=?, ile=?, commune=?, description=?, geom_type=?, coords=?, superficie=?, capacite=?, budget=?, updated_at=datetime('now') WHERE id=?`)
    .run(b.name||a.name, b.type||a.type, b.ile||a.ile, b.commune??a.commune, b.description??a.description, b.geom_type||a.geom_type, JSON.stringify(b.coords||JSON.parse(a.coords)), b.superficie??a.superficie, b.capacite??a.capacite, b.budget??a.budget, a.id);
  res.json({ ok:true });
});

// Transition de workflow
app.post('/api/assets/:id/transition', auth(null), (req, res) => {
  const a = db.prepare('SELECT * FROM assets WHERE id=?').get(req.params.id);
  if (!a) return res.status(404).json({ error: 'Introuvable' });
  const { to, note } = req.body || {};
  const u = req.session.user;
  const allowedTo = TRANSITIONS[a.status] || [];
  if (!allowedTo.includes(to)) return res.status(400).json({ error: `Transition ${a.status} → ${to} non autorisée` });

  // Vérifier les rôles par étape (acteur qui fait avancer depuis le statut courant)
  // SEUL L'ADMINISTRATEUR peut valider / rejeter (étapes de validation)
  const wf = { demande:['agent','admin'], collecte:['agent','admin'], en_validation_technique:['admin'], en_validation_direction:['admin'], publie:['admin'], suivi:['admin'] };
  const actorRoles = wf[a.status] || [];
  if (actorRoles.length && !actorRoles.includes(u.role))
    return res.status(403).json({ error: 'Votre rôle ne permet pas cette étape' });

  const upd = { status: to, updated_at: new Date().toISOString() };
  // Le validateur est enregistré quand il donne son feu vert (transition sortante de sa propre étape)
  if (to === 'en_validation_direction') { upd.validation_tech_at = new Date().toISOString(); upd.validated_tech_by = u.id; }
  if (to === 'publie') { upd.validation_dir_at = new Date().toISOString(); upd.validated_dir_by = u.id; upd.published_at = new Date().toISOString(); }
  if (to === 'rejete') { upd.rejection_reason = note || '—'; }

  const keys = Object.keys(upd);
  db.prepare(`UPDATE assets SET ${keys.map(k=>k+'=?').join(', ')} WHERE id=?`).run(...keys.map(k=>upd[k]), a.id);
  logHistory(a.id, a.status, to, u.id, note || '');
  res.json({ ok:true, status: to });
});

app.post('/api/assets/:id/photos', auth(['agent','validateur_tech','validateur_dir','admin']), upload.array('photos', 6), (req, res) => {
  const a = db.prepare('SELECT * FROM assets WHERE id=?').get(req.params.id);
  if (!a) return res.status(404).json({ error: 'Introuvable' });
  let photos = []; try { photos = JSON.parse(a.photos); } catch(e){}
  const urls = (req.files||[]).map(f => '/uploads/' + f.filename);
  photos = photos.concat(urls);
  db.prepare('UPDATE assets SET photos=? WHERE id=?').run(JSON.stringify(photos), a.id);
  res.json({ ok:true, photos: urls });
});

app.delete('/api/assets/:id', auth(['admin','agent','validateur_tech','validateur_dir']), (req, res) => {
  const a = db.prepare('SELECT * FROM assets WHERE id=?').get(req.params.id);
  if (!a) return res.status(404).json({ error:'Introuvable' });
  const u = req.session.user;
  if (u.role !== 'admin' && !(u.role==='agent' && a.author_id===u.id))
    return res.status(403).json({ error:'Suppression non autorisée' });
  db.prepare('DELETE FROM asset_history WHERE asset_id=?').run(a.id);
  db.prepare('DELETE FROM assets WHERE id=?').run(a.id);
  res.json({ ok:true });
});

function logHistory(assetId, from, to, userId, note) {
  db.prepare('INSERT INTO asset_history (asset_id,from_status,to_status,user_id,note) VALUES (?,?,?,?,?)')
    .run(assetId, from||null, to, userId||null, note||'');
}

// ------------------------------------------------------------------
// EVENTS / INTERVENTIONS
// ------------------------------------------------------------------
app.get('/api/events', auth(null), (req, res) => {
  const isVisitor = req.session.user.role === 'visiteur';
  let sql = 'SELECT e.*, u.display_name AS author_name FROM events e LEFT JOIN users u ON u.id=e.author_id';
  if (isVisitor) sql += ' WHERE e.status = \'valide\'';
  res.json(db.prepare(sql + ' ORDER BY e.date DESC').all());
});
app.post('/api/events', auth(['admin','agent','validateur_tech','validateur_dir']), (req, res) => {
  const b = req.body;
  const info = db.prepare('INSERT INTO events (title,type,ile,description,date,status,author_id) VALUES (?,?,?,?,?,?,?)')
    .run(b.title,b.type,b.ile||'',b.description||'',b.date||'',b.status||'soumis',req.session.user.id);
  res.json({ ok:true, id: info.lastInsertRowid });
});

// ------------------------------------------------------------------
// PROJECTS / SUIVI & ÉVALUATION
// ------------------------------------------------------------------
app.get('/api/projects', auth(null), (req, res) => res.json(db.prepare('SELECT * FROM projects ORDER BY budget DESC').all()));
app.post('/api/projects', auth(['admin','validateur_dir']), (req, res) => {
  const b = req.body;
  const info = db.prepare('INSERT INTO projects (name,bailleur,budget,consumed,benef,statut) VALUES (?,?,?,?,?,?)')
    .run(b.name,b.bailleur,b.budget||0,b.consumed||0,b.benef||0,b.statut||'En cours');
  res.json({ ok:true, id: info.lastInsertRowid });
});
app.put('/api/projects/:id', auth(['admin','validateur_dir']), (req, res) => {
  const b = req.body;
  db.prepare('UPDATE projects SET name=?,bailleur=?,budget=?,consumed=?,benef=?,statut=? WHERE id=?')
    .run(b.name,b.bailleur,b.budget||0,b.consumed||0,b.benef||0,b.statut||'En cours',req.params.id);
  res.json({ ok:true });
});
app.get('/api/stats', auth(null), (req, res) => {
  const isVisitor = req.session.user.role === 'visiteur';
  const cond = isVisitor ? "WHERE status='publie'" : '';
  const total = db.prepare(`SELECT COUNT(*) c FROM assets ${cond}`).get().c;
  const publie = db.prepare(`SELECT COUNT(*) c FROM assets WHERE status='publie'`).get().c;
  const pending = isVisitor ? 0 : db.prepare(`SELECT COUNT(*) c FROM assets WHERE status IN ('demande','collecte','en_validation_technique','en_validation_direction')`).get().c;
  const rejete = isVisitor ? 0 : db.prepare(`SELECT COUNT(*) c FROM assets WHERE status='rejete'`).get().c;
  const superficie = db.prepare(`SELECT COALESCE(SUM(superficie),0) s FROM assets ${cond}`).get().s;
  const filieres = db.prepare(`SELECT COUNT(DISTINCT type) c FROM assets ${cond}`).get().c;
  const events = db.prepare(`SELECT COUNT(*) c FROM events ${isVisitor?"WHERE status='valide'":''}`).get().c;
  const byStatus = {};
  ['demande','collecte','en_validation_technique','en_validation_direction','publie','rejete'].forEach(s=>{
    byStatus[s] = db.prepare('SELECT COUNT(*) c FROM assets WHERE status=?').get(s).c;
  });
  res.json({ total, publie, pending, rejete, superficie, filieres, events, byStatus });
});

// ------------------------------------------------------------------
// USERS (admin)
// ------------------------------------------------------------------
app.get('/api/users', auth(['admin']), (req, res) => {
  const rows = db.prepare('SELECT id,username,display_name,role,ile,active,created_at FROM users').all();
  res.json(rows);
});
app.post('/api/users', auth(['admin']), (req, res) => {
  const b = req.body;
  if (!b.username || !b.password) return res.status(400).json({ error:'Identifiant et mot de passe requis' });
  const exists = db.prepare('SELECT id FROM users WHERE username=?').get(String(b.username).toLowerCase());
  if (exists) return res.status(400).json({ error:'Identifiant déjà utilisé' });
  db.prepare('INSERT INTO users (username,password_hash,display_name,role,ile) VALUES (?,?,?,?,?)')
    .run(String(b.username).toLowerCase(), bcrypt.hashSync(b.password,10), b.display_name||b.username, b.role||'agent', b.ile||'');
  res.json({ ok:true });
});
app.put('/api/users/:id', auth(['admin']), (req, res) => {
  const b = req.body;
  if (b.password) {
    db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(bcrypt.hashSync(b.password,10), req.params.id);
  }
  db.prepare('UPDATE users SET display_name=?, role=?, ile=?, active=? WHERE id=?')
    .run(b.display_name, b.role, b.ile||'', b.active===false?0:1, req.params.id);
  res.json({ ok:true });
});
app.delete('/api/users/:id', auth(['admin']), (req, res) => {
  db.prepare('DELETE FROM users WHERE id=? AND role != \'admin\'').run(req.params.id);
  res.json({ ok:true });
});

// ------------------------------------------------------------------
// SETTINGS (basemap + org)
// ------------------------------------------------------------------
app.get('/api/settings', (req, res) => {
  const rows = db.prepare('SELECT key,value FROM settings').all();
  const s = {}; rows.forEach(r=>s[r.key]=r.value);
  res.json(s);
});
app.put('/api/settings', auth(['admin']), (req, res) => {
  const b = req.body || {};
  const keys = ['default_basemap','org_name','org_subtitle'];
  keys.forEach(k=>{ if(b[k]!==undefined){ db.prepare('INSERT INTO settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(k,String(b[k])); } });
  res.json({ ok:true });
});

// ------------------------------------------------------------------
// EXPORT
// ------------------------------------------------------------------
app.get('/api/export/:format', auth(null), (req, res) => {
  const fmt = req.params.format;
  const isVisitor = req.session.user.role === 'visiteur';
  const cond = isVisitor ? "WHERE status='publie'" : '';
  const rows = db.prepare(`SELECT * FROM assets ${cond}`).all().map(serializeAsset);
  if (fmt === 'geojson') {
    const features = rows.map(a=>{
      let geometry;
      if (a.geom_type==='point') geometry={type:'Point',coordinates:[a.coords[1],a.coords[0]]};
      else if (a.geom_type==='polyline') geometry={type:'LineString',coordinates:a.coords.map(c=>[c[1],c[0]])};
      else if (a.geom_type==='polygon') geometry={type:'Polygon',coordinates:[a.coords[0].map(c=>[c[1],c[0]])]};
      else geometry={type:'Point',coordinates:[0,0]};
      return { type:'Feature', geometry, properties:{ name:a.name, request_number:a.request_number, type:a.type, ile:a.ile, commune:a.commune, status:a.status, superficie:a.superficie, capacite:a.capacite, author:a.author_name } };
    });
    res.setHeader('Content-Type','application/geo+json');
    return res.send(JSON.stringify({ type:'FeatureCollection', features }, null, 2));
  }
  if (fmt === 'csv') {
    const head = 'request_number,name,type,ile,commune,geom_type,latitude,longitude,superficie,capacite,status,author';
    const lines = rows.map(a=>{
      const lat = Array.isArray(a.coords[0]) ? (a.coords[0][0]||'') : a.coords[0];
      const lng = Array.isArray(a.coords[0]) ? (a.coords[0][1]||'') : a.coords[1];
      return [a.request_number,a.name,a.type,a.ile,a.commune,a.geom_type,lat,lng,a.superficie,a.capacite,a.status,a.author_name].map(csvVal).join(',');
    });
    res.setHeader('Content-Type','text/csv');
    res.setHeader('Content-Disposition','attachment; filename=faliki-export.csv');
    return res.send([head, ...lines].join('\n'));
  }
  if (fmt === 'json') {
    res.setHeader('Content-Type','application/json');
    return res.send(JSON.stringify(rows, null, 2));
  }
  res.status(400).json({ error:'Format inconnu' });
});

function csvVal(v){ const s=String(v==null?'':v); if(s.includes(',')||s.includes('"')||s.includes('\n')) return '"'+s.replace(/"/g,'""')+'"'; return s; }

// ------------------------------------------------------------------
// IMPORT (GeoJSON / CSV) — admin & agents
// ------------------------------------------------------------------
const ASSET_TYPES_SET = new Set(['forage','retenue_eau','magasin_stockage','unite_transformation','piste_rurale','perimetre_irrigue','bas_fond','parc_elevage','aire_piscicole','terrain_restaure']);
app.post('/api/import', auth(['admin','agent','validateur_tech','validateur_dir']), express.json(), (req, res) => {
  const { data, type } = req.body || {};
  let imported = [];
  try {
    if (type === 'geojson') {
      const geo = typeof data === 'string' ? JSON.parse(data) : data;
      (geo.features||[]).forEach((f,i)=>{
        const g = f.geometry, p = f.properties||{};
        let geom_type='point', coords=[];
        if (g.type==='Point'){ geom_type='point'; coords=[g.coordinates[1],g.coordinates[0]]; }
        else if (g.type==='LineString'){ geom_type='polyline'; coords=g.coordinates.map(c=>[c[1],c[0]]); }
        else if (g.type==='Polygon'){ geom_type='polygon'; coords=[g.coordinates[0].map(c=>[c[1],c[0]])]; }
        const ile = ASSET_ILE_VALID.includes(p.ile) ? p.ile : 'Ngazidja';
        const num = `FDZ-${new Date().getFullYear()}-${String(Math.floor(Math.random()*9000)+1000)}`;
        imported.push({ name:p.name||('Importé '+i), type:ASSET_TYPES_SET.has(p.type)?p.type:'forage', ile, commune:p.commune||'', description:p.description||'', geom_type, coords, superficie:p.superficie||0, capacite:p.capacite||'', request_number:num, status:'en_validation_technique' });
      });
    } else if (type === 'csv') {
      const lines = (typeof data === 'string' ? data : JSON.stringify(data)).split('\n').filter(l=>l.trim());
      const headers = lines[0].split(',').map(h=>h.trim().toLowerCase());
      lines.slice(1).forEach(line=>{
        const cols = line.split(',');
        const get = h=>{ const i=headers.indexOf(h); return i>=0?(cols[i]||'').trim():''; };
        const lat=parseFloat(get('latitude')||get('lat')), lng=parseFloat(get('longitude')||get('lng')||get('lon'));
        if(!isNaN(lat)&&!isNaN(lng)){
          imported.push({ name:get('name')||get('nom')||'Importé', type:ASSET_TYPES_SET.has(get('type'))?get('type'):'forage', ile:ASSET_ILE_VALID.includes(get('ile'))?get('ile'):'Ngazidja', commune:get('commune')||'', description:get('description')||'', geom_type:'point', coords:[lat,lng], superficie:parseFloat(get('superficie'))||0, capacite:get('capacite')||'', request_number:`FDZ-${new Date().getFullYear()}-${String(Math.floor(Math.random()*9000)+1000)}`, status:'en_validation_technique' });
        }
      });
    } else return res.status(400).json({ error:'Type d\'import inconnu' });
  } catch(e){ return res.status(400).json({ error:'Fichier illisible : '+e.message }); }

  const ins = db.prepare('INSERT INTO assets (name,type,ile,commune,description,geom_type,coords,superficie,capacite,status,request_number,author_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)');
  const tx = db.transaction(()=>{ imported.forEach(a=>{ const r=ins.run(a.name,a.type,a.ile,a.commune,a.description,a.geom_type,JSON.stringify(a.coords),a.superficie,a.capacite,a.status,a.request_number,req.session.user.id); logHistory(r.lastInsertRowid,null,'en_validation_technique',req.session.user.id,'Importé'); }); });
  tx();
  res.json({ ok:true, count: imported.length });
});
const ASSET_ILE_VALID = ['Ngazidja','Ndzuwani','Mwali','Ngazidja (Grande Comore)','Ndzuwani (Anjouan)','Mwali (Mohéli)'];

// ------------------------------------------------------------------
// Référentiel (communes par île)
// ------------------------------------------------------------------
const REFERENTIEL = {
  'Ngazidja':['Moroni','Mitsamiouli','Iconi','Foumbouni','Mitsoudjé','Moya','Bambao','Itsandra','Oichili','Mitsamihuli'],
  'Ndzuwani':['Mutsamudu','Domoni','Bambao','Ongoni','Ouani','Mramani','Koni','Sima'],
  'Mwali':['Fomboni','Nioumachoua','Hoani','Wanani','Miringoni']
};
app.get('/api/referentiel', auth(null), (req,res)=>res.json(REFERENTIEL));

// Basemaps libres (définition serveur pour la config)
app.get('/api/basemaps', (req,res)=>res.json(BASEMAPS));

// ------------------------------------------------------------------
// SPA
// ------------------------------------------------------------------
app.get('/', (req,res)=>res.sendFile(path.join(__dirname,'public','index.html')));

app.listen(PORT, '0.0.0.0', ()=>console.log(`FALIKI ZA DIMA sur http://0.0.0.0:${PORT}`));
