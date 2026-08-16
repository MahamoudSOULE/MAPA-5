/* =========================================================
   FALIKI ZA DIMA — SIGA (Système d'Information Géographique Agricole)
   Front-end SPA — communique avec l'API Express/SQLite
   ========================================================= */

const ASSET_TYPES = [
  {id:'forage',label:'Forage / Point d\'eau',icon:'ico-forage'},
  {id:'retenue_eau',label:'Retenue d\'eau / Barrage',icon:'ico-barrage'},
  {id:'magasin_stockage',label:'Magasin de stockage',icon:'ico-hangar'},
  {id:'unite_transformation',label:'Unité de transformation',icon:'ico-usine'},
  {id:'piste_rurale',label:'Piste rurale d\'accès',icon:'ico-piste'},
  {id:'perimetre_irrigue',label:'Périmètre irrigué',icon:'ico-riz'},
  {id:'bas_fond',label:'Bas-fond aménagé',icon:'ico-basfond'},
  {id:'parc_elevage',label:'Parc d\'élevage',icon:'ico-parc'},
  {id:'aire_piscicole',label:'Aire piscicole',icon:'ico-etang'},
  {id:'terrain_restaure',label:'Terrain restauré / Reboisement',icon:'ico-rebois'}
];
const EVENT_TYPES = [
  {id:'plantation',label:'Plantation / Semis'},
  {id:'recolte',label:'Récolte & Post-récolte'},
  {id:'formation',label:'Formation technique'},
  {id:'distribution',label:'Distribution d\'intrants'},
  {id:'rehabilitation',label:'Réhabilitation infrastructure'},
  {id:'controle',label:'Contrôle & Certification'}
];
const STATUS = {
  demande:{label:'Demande',icon:'📝',cls:'sc-demande'},
  collecte:{label:'Collecte terrain',icon:'📍',cls:'sc-collecte'},
  en_validation_technique:{label:'Validation technique',icon:'🔬',cls:'sc-en_validation_technique'},
  en_validation_direction:{label:'Validation direction',icon:'🏛️',cls:'sc-en_validation_direction'},
  publie:{label:'Publié',icon:'🌍',cls:'sc-publie'},
  suivi:{label:'Suivi & évaluation',icon:'📈',cls:'sc-suivi'},
  rejete:{label:'Rejeté',icon:'⛔',cls:'sc-rejete'}
};
const WORKFLOW_ORDER = ['demande','collecte','en_validation_technique','en_validation_direction','publie','suivi'];
const ROLE_LABELS = { admin:'Administrateur', agent:'Agent terrain', validateur_tech:'Validateur technique', validateur_dir:'Direction nationale', visiteur:'Consultation' };
const COMORES_CENTER = [-11.75, 43.4];
const COMORES_BOUNDS = [[-13.0,43.0],[-11.0,45.0]];

// Contours approximatifs des trois îles (plan de fond de secours hors-ligne)
const COMOROS_ISLANDS = [
  // Ngazidja (Grande Comore)
  [[-11.95,43.30],[-11.75,43.22],[-11.55,43.27],[-11.38,43.30],[-11.43,43.42],[-11.55,43.45],[-11.68,43.42],[-11.82,43.40],[-11.95,43.30]],
  // Ndzuwani (Anjouan)
  [[-12.35,44.20],[-12.20,44.22],[-12.05,44.30],[-12.05,44.43],[-12.15,44.52],[-12.30,44.53],[-12.38,44.45],[-12.40,44.32],[-12.35,44.20]],
  // Mwali (Mohéli)
  [[-12.42,43.62],[-12.30,43.60],[-12.18,43.66],[-12.22,43.79],[-12.32,43.85],[-12.42,43.80],[-12.45,43.70],[-12.42,43.62]]
];

const state = { user:null, assets:[], events:[], projects:[], basemaps:[], settings:{}, currentBasemap:'satellite', currentPage:'carte' };
let appMap=null, visitorMap=null, pickerMap=null, pickerDrawn=null;

// Plan des îles (fond hors-ligne / secours) : océan + îles en couleur + noms
function buildLocalBasemap(map, note){
  const g=L.layerGroup();
  L.rectangle(COMORES_BOUNDS,{color:'#6db3d6',weight:0,fillColor:'#bfe3f0',fillOpacity:1,interactive:false}).addTo(g);
  const ileData=[
    {name:'Grande Comore',pts:COMOROS_ISLANDS[0],c:[11.5,-11.63,43.28]},
    {name:'Anjouan',pts:COMOROS_ISLANDS[1],c:[11.2,-12.22,44.38]},
    {name:'Mohéli',pts:COMOROS_ISLANDS[2],c:[11.0,-12.3,43.72]}
  ];
  ileData.forEach(d=>{
    L.polygon(d.pts,{color:'#3e6f4f',weight:1.5,fillColor:'#7cb48a',fillOpacity:1,interactive:false}).addTo(g);
    L.marker([d.c[1],d.c[2]],{icon:L.divIcon({html:'<div style="font-family:Inter,sans-serif;font-weight:700;font-size:15px;color:#1d4a30;text-shadow:0 1px 2px rgba(255,255,255,.8);white-space:nowrap">'+d.name+'</div>',className:'',iconSize:[0,0]})}).addTo(g);
  });
  if(note){
    L.marker([-12.15,43.9],{icon:L.divIcon({html:'<div style="font-family:Inter,sans-serif;font-weight:600;font-size:12px;color:#1d4a30;background:rgba(255,255,255,.9);padding:6px 12px;border-radius:8px;border:1px solid #3e6f4f;white-space:nowrap">'+note+'</div>',className:'',iconSize:[0,0]})}).addTo(g);
  }
  g.addTo(map);
  map.__localBg=g;
  return g;
}

/* ============================ API ============================ */
const api = {
  async req(method, url, body){
    const opts = { method, headers:{}, credentials:'same-origin' };
    if(body){ opts.headers['Content-Type']='application/json'; opts.body=JSON.stringify(body); }
    const r = await fetch('/api'+url, opts);
    const data = await r.json().catch(()=>({}));
    if(!r.ok) throw new Error(data.error||'Erreur serveur');
    return data;
  },
  async bootstrap(){ await Promise.all([this.loadSession(), this.loadBasemaps(), this.loadSettings()]); },
  loadSession(){ return fetch('/api/session').then(r=>r.json()).then(d=>{ state.user=d.user; }); },
  loadBasemaps(){ return fetch('/api/basemaps').then(r=>r.json()).then(d=>state.basemaps=d); },
  loadSettings(){ return fetch('/api/settings').then(r=>r.json()).then(d=>{ state.settings=d; state.currentBasemap=d.default_basemap||'satellite'; }); },
  async login(){
    const username=val('loginUser'), password=val('loginPass');
    if(!username || !password){ const el=el_('loginError'); el.style.display='block'; el.textContent='Veuillez saisir vos identifiants.'; return; }
    try{ const d = await this.req('POST','/login',{username,password}); await this.enterApp(d.user); }
    catch(e){ const el=el_('loginError'); el.style.display='block'; el.textContent=e.message; }
  },
  async visitorLogin(){
    const d = await this.req('POST','/visitor-login');
    state.user=d.user;
    showVisitorMode();
    await loadData();
    mapctrl.initVisitor();
  },
  async enterApp(user){
    state.user=user;
    el_('loginScreen').style.display='none';
    el_('visitorMode').classList.remove('active');
    el_('mainLayout').classList.add('active');
    ui.refreshIdentity();
    ui.buildSidebar();
    await appInit();
    ui.navigate('dashboard');
    toast('success','Connexion réussie',`Bienvenue, ${user.display_name||user.username}`);
  },
  logout(){ fetch('/api/logout',{method:'POST'}).then(()=>location.reload()); },
  assets(){ return this.req('GET','/assets'); },
  asset(id){ return this.req('GET','/assets/'+id); },
  assetHistory(id){ return this.req('GET','/assets/'+id+'/history'); },
  createAsset(b){ return this.req('POST','/assets',b); },
  updateAsset(id,b){ return this.req('PUT','/assets/'+id,b); },
  transition(id,to,note){ return this.req('POST',`/assets/${id}/transition`,{to,note}); },
  events(){ return this.req('GET','/events'); },
  projects(){ return this.req('GET','/projects'); },
  stats(){ return this.req('GET','/stats'); },
  users(){ return this.req('GET','/users'); },
  createUser(b){ return this.req('POST','/users',b); },
  updateUser(id,b){ return this.req('PUT','/users/'+id,b); },
  deleteUser(id){ return this.req('DELETE','/users/'+id); },
  referentiel(){ return this.req('GET','/referentiel'); },
  saveSettings(b){ return this.req('PUT','/settings',b); },
  deleteAsset(id){ return this.req('DELETE','/assets/'+id); }
};

/* ============================ UI ============================ */
const ui = {
  toggleSidebar(){ const sb=el_('sidebar'),ov=el_('sidebarOverlay'); const open=!sb.classList.contains('open'); sb.classList.toggle('open',open); ov.classList.toggle('active',open); },
  toggleTheme(){ const h=document.documentElement; h.dataset.theme=h.dataset.theme==='dark'?'light':'dark'; },
  refreshIdentity(){
    const u=state.user; if(!u)return;
    const ini=(u.display_name||u.username||'V')[0].toUpperCase();
    el_('headerAvatar').textContent=ini; el_('sidebarAvatar').textContent=ini;
    el_('headerUserName').textContent=u.display_name||u.username;
    el_('headerUserRole').textContent=ROLE_LABELS[u.role]||u.role;
    el_('sidebarUserName').textContent=u.display_name||u.username;
    el_('sidebarUserRole').textContent=ROLE_LABELS[u.role]||u.role;
  },
  buildSidebar(){
    const u=state.user; const nav=[];
    if(!u)return;
    nav.push(['dashboard','📊','Tableau de Bord','ico-chart',u.role!=='visiteur']);
    nav.push(['carte','🗺️','Carte des Actifs','ico-carte',true]);
    nav.push(['workflow','🔄','Workflow / Pipeline','ico-workflow',u.role!=='visiteur']);
    nav.push(['actifs','🏗️','Actifs','ico-hangar',true]);
    nav.push(['saisie','➕','Nouvelle Demande','ico-semis',u.role==='agent'||u.role==='admin']);
    nav.push(['validation','✅','Validation','ico-validation',u.role==='admin']);
    nav.push(['interventions','🚜','Interventions','ico-recolte',u.role!=='visiteur']);
    nav.push(['import','📂','Import / Export','ico-import',u.role!=='visiteur']);
    nav.push(['admin','⚙️','Administration','ico-admin',u.role==='admin']);
    const html = nav.filter(x=>x[4]).map(x=>`
      <div class="nav-section" style="padding-top:${x[0]==='dashboard'?'4px':''}"></div>
      <button class="nav-item" onclick="ui.navigate('${x[0]}')" data-page="${x[0]}">
        <span>${x[1]}</span><span style="flex:1">${x[2]}</span><span class="nav-badge" id="badge-${x[0]}" style="display:none"></span>
      </button>`).join('');
    el_('sidebarNav').innerHTML=html;
    // badges dynamiques
    document.querySelectorAll('[data-page]').forEach(b=>b.classList.remove('active'));
  },
  navigate(page){
    if(state.user?.role==='visiteur' && page!=='carte'){ toast('error','Accès restreint','Mode public : carte uniquement'); return; }
    state.currentPage=page;
    document.querySelectorAll('.page').forEach(p=>p.classList.remove('active'));
    const t=el_('page-'+page); if(t) t.classList.add('active');
    document.querySelectorAll('.nav-item').forEach(n=>n.classList.toggle('active',n.dataset.page===page));
    if(page==='carte'){ setTimeout(()=>{ if(appMap){ appMap.invalidateSize(); } mapctrl.render(); },250); }
    if(page==='workflow') renderWorkflow();
    if(page==='dashboard') renderDashboard();
    if(page==='actifs') renderActifs();
    if(page==='validation') renderValidation();
    if(page==='interventions') renderInterventions();
    if(page==='import') renderImport();
    if(page==='admin') renderAdmin();
    if(page==='saisie') initSaisie();
    if(page==='carte' && state.user?.role==='visiteur'){ /* handled separately */ }
    if(window.innerWidth<768) this.toggleSidebar();
    window.scrollTo(0,0);
  }
};

/* ============================ APP INIT ============================ */
async function appInit(){
  await loadData();
  populateSelects();
  mapctrl.initApp();
  updateBadges();
}
async function loadData(){
  const [assets,events,projects,stats] = await Promise.all([api.assets(),api.events(),api.projects(),api.stats()]);
  state.assets=assets; state.events=events; state.projects=projects; state.stats=stats;
}
async function updateBadges(){
  if(state.user?.role==='visiteur')return;
  const pending = state.stats?.byStatus?.en_validation_technique||0;
  const queue = state.stats?.byStatus?.en_validation_direction||0;
  setBadge('validation', pending+queue);
}
function setBadge(page, n){
  const b=el_('badge-'+page); if(!b)return;
  if(n>0){ b.style.display='inline-block'; b.textContent=n; } else b.style.display='none';
}
function populateSelects(){
  const f=(sel)=>ASSET_TYPES.forEach(t=>{const o=document.createElement('option');o.value=t.id;o.textContent=t.label;sel.appendChild(o);});
  f(el_('mapFilterType'));
  const st=el_('mapFilterStatus');
  Object.entries(STATUS).forEach(([k,v])=>{ const o=document.createElement('option'); o.value=k; o.textContent=v.label; st.appendChild(o); });
}

/* ============================ MAP ============================ */
const mapctrl = {
  initApp(){
    if(appMap) return;
    appMap = L.map('appMap', {center:COMORES_CENTER, zoom:9, minZoom:8, maxBounds:COMORES_BOUNDS, maxBoundsViscosity:1.0});
    mapctrl.applyBasemap(appMap, state.currentBasemap);
    bindCoordinateBar(appMap, 'coordUtm', 'coordLatLon', true);
    mapctrl.render();
    mapctrl.buildBasemapPanel();
  },
  initVisitor(){
    if(visitorMap) return;
    visitorMap = L.map('visitorMap', {center:COMORES_CENTER, zoom:9, minZoom:8, maxBounds:COMORES_BOUNDS, maxBoundsViscosity:1.0});
    mapctrl.applyBasemap(visitorMap, state.currentBasemap||'satellite');
    bindCoordinateBar(visitorMap, 'coordUtmV', 'coordLatLonV', false);
    mapctrl.renderVisitor();
    const leg=el_('visitorLegend');
    leg.innerHTML=`<h4>Actifs publiés</h4><div class="legend-line"><span class="dot" style="background:#16a34a"></span> Valide / Publié</div>`;
  },
  applyBasemap(map, id){
    map.eachLayer(l=>{ if(l instanceof L.TileLayer || l===map.__fallback || l===map.__localBg) map.removeLayer(l); });
    map.__fallback=null; map.__localBg=null;
    const bm = state.basemaps.find(b=>b.id===id)||state.basemaps[0];
    if(!bm)return;
    // Fonds sans serveur public : orthophoto nationale ou plan des îles
    if(bm.comores || !bm.url){
      buildLocalBasemap(map, bm.comores ? '🇰🇲 Orthophoto nationale — à connecter aux tuiles du Ministère' : '');
      return;
    }
    const tiles = L.tileLayer(bm.url, {attribution: bm.attribution+' | FALIKI ZA DIMA — DG Stratégie Agricole', maxZoom:bm.maxZoom});
    tiles.addTo(map);
    // Secours local : si les tuiles externes échouent (aperçu hors-ligne, 403, etc.),
    // on affiche le plan des îles pour que la carte reste exploitable.
    tiles.on('tileerror', function(){
      if(map.__localBg) return;
      buildLocalBasemap(map);
    });
  },
  buildBasemapPanel(){
    const grid=el_('basemapGrid');
    if(!grid)return;
    grid.innerHTML = state.basemaps.map(b=>`
      <div class="basemap-opt ${b.id===state.currentBasemap?'active':''}" data-id="${b.id}" onclick="mapctrl.selectBasemap('${b.id}')" title="${b.name}">
        <div class="thumb" style="background:${b.preview}"><span class="bm-ico">${b.icon||'🗺️'}</span><span class="bm-name">${b.name}</span></div>
      </div>`).join('');
  },
  async selectBasemap(id){
    state.currentBasemap=id;
    mapctrl.applyBasemap(appMap,id);
    if(visitorMap) mapctrl.applyBasemap(visitorMap,id);
    mapctrl.buildBasemapPanel();
    mapctrl.closeBasemapPanel();
    if(state.user?.role==='admin'){ try{ await api.saveSettings({default_basemap:id}); }catch(e){} }
    const bm=state.basemaps.find(b=>b.id===id);
    toast('info','Fond de carte',(bm?(bm.icon+' '):'')+(bm?bm.name:id));
  },
  toggleBasemapPanel(){ const p=el_('basemapPanel'); if(p) p.classList.toggle('open'); },
  closeBasemapPanel(){ const p=el_('basemapPanel'); if(p) p.classList.remove('open'); },
  center(){ (appMap||visitorMap)?.flyTo(COMORES_CENTER,9); },
  zoomIle(ile){ zoomToIle(ile); },
  search(q){ searchMap(q); },
  searchPick(id){ searchPick(id); },
  copyCoords(){ copyCoords(); },
  geoFor(a){
    const coords=a.coords;
    if(a.geom_type==='point') return L.marker(coords,{icon:mapctrl.icon(a.type, colorOf(a))}).bindPopup(popupHtml(a));
    if(a.geom_type==='polyline') return L.polyline(coords,{color:colorOf(a),weight:4}).bindPopup(popupHtml(a));
    if(a.geom_type==='polygon') return L.polygon(coords,{color:colorOf(a),fillColor:colorOf(a),fillOpacity:0.2,weight:2}).bindPopup(popupHtml(a));
    return null;
  },
  icon(type,color){
    const t=ASSET_TYPES.find(x=>x.id===type);
    const html=`<div style="width:28px;height:28px;border-radius:50%;background:${color};display:flex;align-items:center;justify-content:center;box-shadow:0 2px 6px rgba(0,0,0,0.3);border:2px solid white"><svg width="14" height="14" stroke="white" fill="none" stroke-width="2"><use href="#${t?.icon||'ico-forage'}"/></svg></div>`;
    return L.divIcon({html,className:'',iconSize:[28,28]});
  },
  render(){
    if(!appMap)return;
    const type=val('mapFilterType'), ile=val('mapFilterIle'), st=val('mapFilterStatus');
    mapctrl.clearLayers(appMap);
    let list=state.assets;
    if(state.user?.role==='visiteur') list=list.filter(a=>a.status==='publie');
    if(type) list=list.filter(a=>a.type===type);
    if(ile) list=list.filter(a=>a.ile===ile);
    if(st) list=list.filter(a=>a.status===st);
    list.forEach(a=>{ const g=mapctrl.geoFor(a); if(g) g.addTo(appMap); });
    el_('mapLegend').innerHTML = `
      <span class="legend-line"><span class="dot" style="background:#16a34a"></span> Publié</span>
      <span class="legend-line"><span class="dot" style="background:#059669"></span> Suivi</span>
      <span class="legend-line"><span class="dot" style="background:#4338ca"></span> Demande</span>
      <span class="legend-line"><span class="dot" style="background:#b45309"></span> Collecte</span>
      <span class="legend-line"><span class="dot" style="background:#075985"></span> Valid. technique</span>
      <span class="legend-line"><span class="dot" style="background:#86198f"></span> Valid. direction</span>
      <span class="legend-line"><span class="dot" style="background:#b91c1c"></span> Rejeté</span>`;
  },
  renderVisitor(){
    if(!visitorMap)return;
    mapctrl.clearLayers(visitorMap);
    state.assets.filter(a=>a.status==='publie').forEach(a=>{ const g=mapctrl.geoFor(a); if(g) g.addTo(visitorMap); });
  },
  clearLayers(map){
    map.eachLayer(l=>{ if(l instanceof L.Marker||l instanceof L.Polyline||l instanceof L.Polygon) map.removeLayer(l); });
  }
};
function colorOf(a){ return a.status==='publie'?'#16a34a':a.status==='suivi'?'#059669':a.status==='demande'?'#4338ca':a.status==='collecte'?'#b45309':a.status==='en_validation_technique'?'#075985':a.status==='en_validation_direction'?'#86198f':a.status==='rejete'?'#b91c1c':'#f59e0b'; }

/* ============ CONVERSION WGS84 → UTM (inspiré de SIG-DNSAE) ============ */
function latLonToUTM(lat, lon){
  // Zone UTM calculée depuis la longitude ; hémisphère sud pour les Comores
  const zone = Math.floor((lon+180)/6)+1;
  const southern = lat < 0;
  const a=6378137.0, f=1/298.257223563, k0=0.9996;
  const e=Math.sqrt(2*f-f*f), e2=e*e, e4=e2*e2, e6=e4*e2;
  const latRad=lat*Math.PI/180, lonRad=lon*Math.PI/180;
  const lon0=(zone*6-183)*Math.PI/180;
  const dLon=lonRad-lon0;
  const sinLat=Math.sin(latRad),cosLat=Math.cos(latRad),tanLat=Math.tan(latRad);
  const N=a/Math.sqrt(1-e2*sinLat*sinLat);
  const T=tanLat*tanLat;
  const C=e2*cosLat*cosLat/(1-e2);
  const A=cosLat*dLon;
  const M=a*((1-e2/4-3*e4/64-5*e6/256)*latRad-(3*e2/8+3*e4/32+45*e6/1024)*Math.sin(2*latRad)+(15*e4/256+45*e6/1024)*Math.sin(4*latRad)-(35*e6/3072)*Math.sin(6*latRad));
  let easting=k0*N*(A+(1-T+C)*A*A*A/6+(5-18*T+T*T+72*C-58*e2)*A*A*A*A*A/120);
  let northing=k0*(M+N*tanLat*(A*A/2+(5-T+9*C+4*C*C)*A*A*A*A/24+(61-58*T+T*T+600*C-330*e2)*A*A*A*A*A*A/720));
  easting+=500000;
  if(southern) northing+=10000000;
  return {easting:Math.round(easting*100)/100,northing:Math.round(northing*100)/100,zone,hemisphere:southern?'S':'N'};
}
function formatUTM(u){ return `${u.zone}${u.hemisphere} ${u.easting.toFixed(2)}E ${u.northing.toFixed(2)}N`; }
// Conversion inverse : UTM → Lat/Lng (WGS84). zone=38 (Comores), hemisphere='S'
function utmToLatLng(zone, hemisphere, easting, northing){
  const a=6378137.0, f=1/298.257223563, k0=0.9996;
  const e=Math.sqrt(2*f-f*f), e2=e*e, e4=e2*e2, e6=e4*e2;
  const ePrimeSq = e2/(1-e2);
  const N = hemisphere==='S' ? northing-10000000 : northing;
  const M = N/k0;
  const e1 = (1-Math.sqrt(1-e2))/(1+Math.sqrt(1-e2));
  const mu = M/(a*(1 - e2/4 - 3*e4/64 - 5*e6/256));
  const J1 = 3*e1/2 - 27*Math.pow(e1,3)/32;
  const J2 = 21*e1*e1/16 - 55*Math.pow(e1,4)/32;
  const J3 = 151*Math.pow(e1,3)/96;
  const J4 = 1097*Math.pow(e1,4)/512;
  const fp = mu + J1*Math.sin(2*mu) + J2*Math.sin(4*mu) + J3*Math.sin(6*mu) + J4*Math.sin(8*mu);
  const C1 = ePrimeSq*Math.pow(Math.cos(fp),2);
  const T1 = Math.pow(Math.tan(fp),2);
  const N1 = a/Math.sqrt(1-e2*Math.pow(Math.sin(fp),2));
  const R1 = a*(1-e2)/Math.pow(1-e2*Math.pow(Math.sin(fp),2),1.5);
  const D = (easting-500000)/(N1*k0);
  const latRad = fp - (N1*Math.tan(fp)/R1)*(D*D/2 - (5+3*T1+10*C1-4*C1*C1-9*e2)*Math.pow(D,4)/24 + (61+90*T1+298*C1+45*T1*T1-252*e2-3*C1*C1)*Math.pow(D,6)/720);
  const lon0 = (zone*6-183)*Math.PI/180;
  const lonRad = lon0 + (D - (1+2*T1+C1)*Math.pow(D,3)/6 + (5-2*C1+28*T1-3*C1*C1+8*e2+24*T1*T1)*Math.pow(D,5)/120)/Math.cos(fp);
  return { lat: latRad*180/Math.PI, lng: lonRad*180/Math.PI };
}
function bindCoordinateBar(map, utmId, latlonId, animate){
  map.on('mousemove', e=>{
    const lat=e.latlng.lat, lon=e.latlng.lng;
    const u=latLonToUTM(lat,lon);
    const us=formatUTM(u), ll=`Lat: ${lat.toFixed(6)}° | Lon: ${lon.toFixed(6)}°`;
    const uEl=el_(utmId), llEl=el_(latlonId);
    if(animate&&uEl.textContent!==`UTM: ${us}`){
      uEl.classList.add('coordinate-update'); llEl.classList.add('coordinate-update');
      setTimeout(()=>{uEl.classList.remove('coordinate-update');llEl.classList.remove('coordinate-update');},400);
    }
    uEl.textContent=`UTM: ${us}`; llEl.textContent=ll;
  });
}
function copyCoords(){
  const t=(el_('coordUtm').textContent+' '+el_('coordLatLon').textContent).trim();
  navigator.clipboard?.writeText(t).then(()=>toast('success','Coordonnées copiées',t)).catch(()=>toast('error','Copie impossible','Presse-papier indisponible'));
}
// Zoom vers une île
const ILE_BBOX = { 'Ngazidja':[[-12.0,43.18],[-11.35,43.5]], 'Ndzuwani':[[-12.45,44.15],[-12.0,44.6]], 'Mwali':[[-12.5,43.55],[-12.15,43.9]] };
function zoomToIle(ile){
  const m=appMap||visitorMap; if(!m)return;
  const b=ILE_BBOX[ile]; if(!b)return;
  m.fitBounds(L.latLngBounds(b[0],b[1]));
}

/* ============ RECHERCHE CARTE ============ */
function searchMap(q){
  const box=el_('mapSearchResults'); q=(q||'').toLowerCase().trim();
  if(q.length<2){ box.classList.remove('open'); box.innerHTML=''; return; }
  const filtered=state.assets.filter(a=>a.status==='publie'||state.user?.role!=='visiteur').filter(a=>{
    const hay=(a.name+' '+(a.request_number||'')+' '+(a.ile||'')+' '+(a.commune||'')+' '+a.type).toLowerCase();
    return hay.includes(q);
  }).slice(0,12);
  if(!filtered.length){ box.innerHTML='<div class="map-search-empty">Aucun résultat</div>'; box.classList.add('open'); return; }
  box.innerHTML=filtered.map(a=>{
    const icon=ASSET_TYPES.find(t=>t.id===a.type)?.icon||'ico-forage';
    return `<div class="sr-item" onclick="mapctrl.searchPick(${a.id})">
      <div class="sr-ico" style="background:${colorOf(a)}22"><svg width="14" height="14" stroke="${colorOf(a)}" fill="none" stroke-width="2"><use href="#${icon}"/></svg></div>
      <div><div class="sr-name">${esc(a.name)}</div><div class="sr-meta">${esc(a.ile)}${a.commune?' • '+esc(a.commune):''} • ${STATUS[a.status]?.label||a.status}</div></div>
      <span class="sr-req">${esc(a.request_number||'')}</span>
    </div>`;
  }).join('');
  box.classList.add('open');
}
function searchPick(id){
  el_('mapSearchResults').classList.remove('open');
  const a=state.assets.find(x=>x.id===id); if(!a||!appMap)return;
  appMap.eachLayer(l=>{ if(l.__hl){ appMap.removeLayer(l); } });
  let hl;
  if(a.geom_type==='point') hl=L.circleMarker(a.coords,{radius:14,color:'#e74c3c',weight:3,fillColor:'#e74c3c',fillOpacity:0.25}).addTo(appMap);
  else if(a.geom_type==='polyline') hl=L.polyline(a.coords,{color:'#e74c3c',weight:6}).addTo(appMap);
  else if(a.geom_type==='polygon') hl=L.polygon(a.coords,{color:'#e74c3c',weight:3,fillColor:'#e74c3c',fillOpacity:0.25}).addTo(appMap);
  hl.__hl=true;
  appMap.fitBounds(hl.getBounds().pad(0.3));
  showDetail(id);
}
function esc(s){ return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function popupHtml(a){
  const t=ASSET_TYPES.find(x=>x.id===a.type)?.label||a.type;
  const st=STATUS[a.status]?.label||a.status;
  const c=colorOf(a);
  let coord='';
  if(a.geom_type==='point') coord=`${a.coords[0].toFixed(5)}, ${a.coords[1].toFixed(5)}`;
  else if(a.geom_type==='polyline') coord=`${a.coords.length} points`;
  else coord=`${a.coords[0].length} sommets`;
  const photos=a.photos&&a.photos.length?`<div class="photo-strip" style="margin-top:6px">${a.photos.slice(0,3).map(p=>`<img src="${p}" onerror="this.style.display='none'">`).join('')}</div>`:'';
  return `<div style="min-width:200px"><b>${a.name}</b><br><span style="font-size:12px;color:var(--t3)">${t} • ${a.ile}</span><br>
    <span style="color:${c};font-weight:700">● ${st}</span>${a.status==='rejete'&&a.rejection_reason?`<br><span style="font-size:12px">Motif : ${a.rejection_reason}</span>`:''}
    <br><span style="font-size:12px;color:var(--t3)">${coord}${a.superficie?' • '+a.superficie.toLocaleString()+' m²':''}</span>
    ${photos}<br><span style="font-size:11px;color:var(--t3)">Réf. ${a.request_number||'-'}</span></div>`;
}

/* ============================ CHARTS ============================ */
function barChart(elId, data, colors, unit){
  const el=el_(elId); if(!el)return;
  const max=Math.max(...data.map(d=>d.value),1);
  const h=180, bottom=30, bw=Math.min(54, 500/data.length), gap=12, start=40;
  let svg=`<svg class="chart-svg" viewBox="0 0 ${start+data.length*(bw+gap)+20} ${h+40}">`;
  data.forEach((d,i)=>{
    const bh=(d.value/max)*(h-bottom), x=start+i*(bw+gap), y=h-bh-bottom;
    svg+=`<rect class="chart-bar" x="${x}" y="${y}" width="${bw}" height="${bh}" rx="6" fill="${colors[i%colors.length]}"><title>${d.label}: ${d.value}${unit||''}</title></rect>`;
    svg+=`<text x="${x+bw/2}" y="${h-8}" text-anchor="middle" font-size="10" fill="var(--t3)">${d.label}</text>`;
  });
  svg+=`</svg>`; el.innerHTML=svg;
}
function donut(elId, data, colors, centerLabel){
  const el=el_(elId); if(!el)return;
  const total=data.reduce((s,d)=>s+d.value,0)||1;
  let svg=`<svg class="chart-svg" viewBox="0 0 200 200"><g transform="translate(100,100)">`;
  let angle=0;
  data.forEach((d,i)=>{
    const a=(d.value/total)*Math.PI*2;
    const x1=Math.cos(angle)*80,y1=Math.sin(angle)*80,x2=Math.cos(angle+a)*80,y2=Math.sin(angle+a)*80;
    const large=a>Math.PI?1:0;
    svg+=`<path d="M ${x1} ${y1} A 80 80 0 ${large} 1 ${x2} ${y2}" fill="none" stroke="${colors[i%colors.length]}" stroke-width="24" stroke-linecap="round"/>`;
    angle+=a;
  });
  svg+=`<text text-anchor="middle" dy="5" font-size="14" font-weight="700" fill="var(--t)">${total.toLocaleString()}</text><text text-anchor="middle" dy="20" font-size="9" fill="var(--t3)">${centerLabel||''}</text></g></svg>`;
  let legend='<div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:10px;justify-content:center">';
  data.forEach((d,i)=>{ legend+=`<span style="display:flex;align-items:center;gap:4px;font-size:11px;color:var(--t2)"><span style="width:8px;height:8px;border-radius:50%;background:${colors[i%colors.length]};display:inline-block"></span>${d.label} (${Math.round(d.value/total*100)}%)</span>`; });
  legend+='</div>';
  el.innerHTML=svg+legend;
}
function lineChart(elId, data){
  const el=el_(elId); if(!el)return;
  const max=Math.max(...data.map(d=>d.value),1);
  const w=500,h=160,pad=30; let pts='';
  data.forEach((d,i)=>{ const x=pad+(i/(data.length-1))*(w-pad*2), y=h-pad-(d.value/max)*(h-pad*2); pts+=`${x},${y} `; });
  let svg=`<svg class="chart-svg" viewBox="0 0 ${w} ${h}"><polyline points="${pts}" fill="none" stroke="#1a472a" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>`;
  data.forEach((d,i)=>{ const x=pad+(i/(data.length-1))*(w-pad*2), y=h-pad-(d.value/max)*(h-pad*2); svg+=`<circle cx="${x}" cy="${y}" r="4" fill="#1a472a" stroke="white" stroke-width="2"/><text x="${x}" y="${h-6}" text-anchor="middle" font-size="9" fill="var(--t3)">${d.label}</text>`; });
  svg+='</svg>'; el.innerHTML=svg;
}

/* ============================ DASHBOARD ============================ */
function renderDashboard(){
  const s=state.stats; const el=el_('page-dashboard');
  const v=state.assets.filter(a=>a.status==='publie'||a.status==='suivi').length;
  const budgetTotal=state.projects.reduce((x,p)=>x+p.budget,0);
  const budgetConso=state.projects.reduce((x,p)=>x+p.consumed,0);
  const taux=budgetTotal?Math.round(budgetConso/budgetTotal*100):0;
  const stats=[
    {l:'Actifs recensés',v:s.total,ic:'ico-hangar',c:'linear-gradient(135deg,#1a472a,#2d6a3f)'},
    {l:'Publiés / Suivis',v:v,ic:'ico-recolte',c:'linear-gradient(135deg,#047857,#059669)'},
    {l:'En pipeline',v:s.pending,ic:'ico-workflow',c:'linear-gradient(135deg,#1e6091,#0f2e4d)'},
    {l:'Rejetés',v:s.rejete,ic:'ico-validation',c:'linear-gradient(135deg,#c65d3b,#9a3412)'},
    {l:'Interventions',v:s.events,ic:'ico-riz',c:'linear-gradient(135deg,#d4a017,#a16207)'},
    {l:'Superficie',v:(s.superficie/10000).toFixed(1)+' ha',ic:'ico-barrage',c:'linear-gradient(135deg,#0f766e,#14b8a6)'}
  ];
  const filiereData=ASSET_TYPES.map(t=>({label:t.label.split(' ')[0],value:state.assets.filter(a=>a.type===t.id).length})).filter(d=>d.value>0);
  el.innerHTML=`
  <div class="page-header"><h1>Tableau de Suivi & Évaluation</h1><p>Indicateurs clés de performance — Campagne agricole 2025-2026</p></div>
  <div class="stats-grid">${stats.map(x=>`
    <div class="stat-card"><div class="stat-icon" style="background:${x.c};color:#fff"><svg width="24" height="24"><use href="#${x.ic}"/></svg></div>
    <div><div class="stat-value" style="background:${x.c};-webkit-background-clip:text;-webkit-text-fill-color:transparent">${x.v}</div><div class="stat-label">${x.l}</div></div></div>`).join('')}
  </div>
  <div class="grid-2">
    <div class="card"><div class="card-header"><div class="card-title">🌾 Répartition par filière</div></div><div class="card-body"><div id="dFiliere"></div></div></div>
    <div class="card"><div class="card-header"><div class="card-title">💰 Consommation budgétaire par bailleur</div></div><div class="card-body"><div id="dBudget"></div></div></div>
  </div>
  <div class="grid-3" style="margin-top:20px">
    <div class="card"><div class="card-header"><div class="card-title">📈 Tendance des saisies</div></div><div class="card-body"><div id="dTrend"></div></div></div>
    <div class="card"><div class="card-header"><div class="card-title">⚡ Workflow par étape</div></div><div class="card-body"><div id="dWorkflow"></div></div></div>
    <div class="card"><div class="card-header"><div class="card-title">📋 Indicateurs S&E</div></div><div class="card-body" id="dKpi"></div></div>
  </div>
  <div class="card" style="margin-top:20px"><div class="card-header"><div class="card-title">📋 Suivi des Projets & Bailleurs</div></div>
    <div class="card-body"><div class="table-wrap"><table class="data-table"><thead><tr><th>Projet</th><th>Bailleur</th><th>Budget (€)</th><th>Engagé (€)</th><th>Taux</th><th>Bénéf.</th><th>Statut</th></tr></thead><tbody>
    ${state.projects.map(p=>{const t=p.budget?Math.round(p.consumed/p.budget*100):0;return `<tr><td><strong>${p.name}</strong></td><td>${p.bailleur}</td><td>${p.budget.toLocaleString()}</td><td>${p.consumed.toLocaleString()}</td><td>${t}%</td><td>${p.benef.toLocaleString()}</td><td><span class="badge ${p.statut==='En cours'?'badge-green':'badge-yellow'}">${p.statut}</span></td></tr>`;}).join('')}
    </tbody></table></div></div></div>
  <div class="footer-app"><strong>© 2026 MAPA — Direction Nationale de Stratégie Agricole, Union des Comores.</strong><br>
  Plateforme développée avec l'appui du projet Chaîne de Valeur Agricole (CVA) et PNUD.<br>
  Données consolidées par les services déconcentrés de Moroni, Mutsamudu et Fomboni.</div>`;
  barChart('dFiliere', filiereData, ['#1a472a','#c65d3b','#1e6091','#d4a017','#047857','#8b5a2b']);
  donut('dBudget', state.projects.map(p=>({label:p.bailleur,value:p.consumed})), ['#1a472a','#c65d3b','#1e6091','#d4a017','#047857','#8b5a2b'], '€ engagés');
  lineChart('dTrend', WORKFLOW_ORDER.map((s,i)=>({label:(STATUS[s]?.label||s).split(' ')[0], value:state.stats.byStatus[s]||0})));
  const wfCols=['#4338ca','#b45309','#075985','#86198f','#16a34a','#059669'];
  barChart('dWorkflow', WORKFLOW_ORDER.map((s,i)=>({label:(STATUS[s]?.label||s).split(' ')[0], value:state.stats.byStatus[s]||0})), wfCols);
  el_('dKpi').innerHTML=`
    <div style="display:grid;gap:14px">
      <div><div class="kpi-small">Taux de publication</div><div class="kpi-big">${s.total?Math.round(v/s.total*100):0}%</div><div class="kpi-delta up">↑ Objectif 85%</div></div>
      <div><div class="kpi-small">Budget consommé</div><div class="kpi-big">${taux}%</div><div class="kpi-delta ${taux>70?'up':'down'}">${taux>70?'↑ Bon rythme':'↓ À accélérer'}</div></div>
      <div><div class="kpi-small">Densité actifs / 100 km²</div><div class="kpi-big">${(s.total/1.86).toFixed(1)}</div><div class="kpi-delta up">↑ +12% vs 2025</div></div>
      <div><div class="kpi-small">Pipeline actif</div><div class="kpi-big">${s.pending}</div><div class="kpi-delta ${s.pending?'down':'up'}">${s.pending?'↳ '+s.pending+' dossiers en cours':'Aucun dossier en attente'}</div></div>
    </div>`;
}

/* ============================ WORKFLOW ============================ */
function renderWorkflow(){
  const el=el_('page-workflow');
  const s=state.stats.byStatus||{};
  const currentRole=state.user.role;
  el.innerHTML=`
  <div class="page-header"><h1>Workflow de bout en bout</h1><p>Parcours complet : demande → collecte terrain → validations → publication → suivi-évaluation</p></div>
  <div class="pipeline">
    ${WORKFLOW_ORDER.map((k,i)=>`
      <div class="pipe-step ${(s[k]||0)>0?'done':''}">
        <div class="pipe-ico">${STATUS[k].icon}</div>
        <div class="pipe-label">${i+1}. ${STATUS[k].label}</div>
        <div class="pipe-count">${s[k]||0} actif(s)</div>
      </div>${i<WORKFLOW_ORDER.length-1?'<div class="pipe-arrow">›</div>':''}`).join('')}
    ${(s.rejete||0)>0?`<div class="pipe-step rejected"><div class="pipe-ico">⛔</div><div class="pipe-label">Rejet</div><div class="pipe-count">${s.rejete} actif(s)</div></div>`:''}
  </div>
  <div class="card" style="margin-top:20px"><div class="card-header"><div class="card-title">🔄 Actifs par étape du workflow</div></div>
    <div class="card-body"><div id="wfList"></div></div></div>`;
  const container=el_('wfList');
  if(!state.assets.length){ container.innerHTML=emptyState('Aucun actif','Créez une demande pour démarrer le workflow'); return; }
  container.innerHTML=state.assets.map(a=>{
    const st=STATUS[a.status]||{label:a.status};
    const canAdvance = canTransition(a);
    const canReject = ['validateur_tech','validateur_dir','admin'].includes(currentRole) && a.status!=='rejete' && a.status!=='publie' && a.status!=='suivi';
    return `
    <div class="list-item" onclick="showDetail(${a.id})">
      <div class="list-item-icon"><svg width="22" height="22"><use href="#${ASSET_TYPES.find(t=>t.id===a.type)?.icon||'ico-forage'}"/></svg></div>
      <div class="list-item-content">
        <div class="list-item-title">${a.name} <span style="font-size:11px;color:var(--t3)">(${a.request_number})</span></div>
        <div class="list-item-meta">${ASSET_TYPES.find(t=>t.id===a.type)?.label||a.type} • ${a.ile} • ${a.author_name||'-'}</div>
        <div class="list-item-actions">
          <span class="status-chip ${st.cls}">${st.icon} ${st.label}</span>
          ${a.status==='publie'?`<span class="badge badge-green">✓ Publié ${a.published_at?('le '+short(a.published_at)):''}</span>`:''}
          <button class="btn btn-secondary btn-sm" onclick="event.stopPropagation();showDetail(${a.id})">Détails</button>
          ${canAdvance?`<button class="btn btn-primary btn-sm" onclick="event.stopPropagation();advance(${a.id})">${advanceLabel(a)}</button>`:''}
          ${canReject?`<button class="btn btn-danger btn-sm" onclick="event.stopPropagation();rejectAsset(${a.id})">⛔ Rejeter</button>`:''}
        </div>
      </div>
    </div>`;
  }).join('');
}
function nextStatus(s){
  const idx=WORKFLOW_ORDER.indexOf(s);
  return idx>=0&&idx<WORKFLOW_ORDER.length-1?WORKFLOW_ORDER[idx+1]:null;
}
function canTransition(a){
  const r=state.user.role;
  const ns=nextStatus(a.status);
  if(!ns)return false;
  // Seul l'admin peut faire avancer depuis les étapes de validation
  const rule={collecte:['agent','admin'],en_validation_technique:['agent','admin'],en_validation_direction:['admin'],publie:['admin'],suivi:['admin']};
  return (rule[ns]||[]).includes(r);
}
function advanceLabel(a){
  const ns=nextStatus(a.status);
  const lab={collecte:'▶ Démarrer collecte',en_validation_technique:'📨 Soumettre à validation',en_validation_direction:'🔬 Valider techniquement',publie:'🏛️ Approuver & publier',suivi:'📈 Passer en suivi'};
  return lab[ns]||'Suivant';
}
async function advance(id){
  const a=state.assets.find(x=>x.id===id); if(!a)return;
  const ns=nextStatus(a.status); if(!ns)return;
  let note='';
  if(ns==='en_validation_direction'){ note=prompt('Avis technique (optionnel) :')||''; }
  try{
    const d=await api.transition(id,ns,note);
    toast('success','Workflow avancé',`${a.name} → ${STATUS[ns].label}`);
    state.assets=await api.assets(); state.stats=await api.stats();
    updateBadges(); renderWorkflow(); mapctrl.render();
  }catch(e){ toast('error','Erreur',e.message); }
}
async function rejectAsset(id){
  const a=state.assets.find(x=>x.id===id); if(!a)return;
  const reason=prompt('Motif du rejet :')||'Non conforme';
  try{ await api.transition(id,'rejete',reason); toast('info','Actif rejeté',a.name); state.assets=await api.assets(); state.stats=await api.stats(); renderWorkflow(); mapctrl.render(); }catch(e){ toast('error','Erreur',e.message); }
}

/* ============================ ACTIFS (liste) ============================ */
function renderActifs(){
  const el=el_('page-actifs');
  el.innerHTML=`
  <div class="page-header"><h1>Actifs agricoles</h1><p>Recensement national des actifs productifs et de stockage — ${state.assets.length} enregistré(s)</p></div>
  <div class="filter-bar">
    <input id="assetSearch" placeholder="🔍 Rechercher..." oninput="renderAssetList()">
    <select id="assetFilterType" onchange="renderAssetList()"><option value="">Toutes filières</option>${ASSET_TYPES.map(t=>`<option value="${t.id}">${t.label}</option>`).join('')}</select>
    <select id="assetFilterStatus" onchange="renderAssetList()"><option value="">Tous statuts</option>${Object.entries(STATUS).map(([k,v])=>`<option value="${k}">${v.label}</option>`).join('')}</select>
    ${(state.user.role==='agent'||state.user.role==='admin')?`<button class="btn btn-primary btn-sm" onclick="ui.navigate('saisie')">+ Nouvelle demande</button>`:''}
  </div>
  <div id="assetListContainer"></div>`;
  renderAssetList();
}
function renderAssetList(){
  const q=val('assetSearch').toLowerCase(), tf=val('assetFilterType'), sf=val('assetFilterStatus');
  let list=state.assets;
  if(q) list=list.filter(a=>a.name.toLowerCase().includes(q)||(a.request_number||'').includes(q));
  if(tf) list=list.filter(a=>a.type===tf);
  if(sf) list=list.filter(a=>a.status===sf);
  const c=el_('assetListContainer');
  if(!list.length){ c.innerHTML=emptyState('Aucun actif','Modifiez vos filtres'); return; }
  c.innerHTML=list.map(a=>{
    const st=STATUS[a.status]||{label:a.status,cls:'sc-demande'};
    const canEdit=(state.user.role==='admin')||(state.user.role==='agent'&&a.author_id===state.user.id&&['demande','collecte'].includes(a.status));
    const canDelete=(state.user.role==='admin')||(state.user.role==='agent'&&a.author_id===state.user.id);
    return `
    <div class="list-item" onclick="showDetail(${a.id})">
      <div class="list-item-icon"><svg width="22" height="22"><use href="#${ASSET_TYPES.find(t=>t.id===a.type)?.icon||'ico-forage'}"/></svg></div>
      <div class="list-item-content">
        <div class="list-item-title">${a.name} <span style="font-size:11px;color:var(--t3)">(${a.request_number})</span></div>
        <div class="list-item-meta">${ASSET_TYPES.find(t=>t.id===a.type)?.label||a.type} • ${a.ile}${a.commune?' • '+a.commune:''} • ${a.author_name||'-'} • ${short(a.created_at)}</div>
        <div class="list-item-actions">
          <span class="status-chip ${st.cls}">${st.icon} ${st.label}</span>
          ${a.superficie?`<span class="badge badge-gray">${a.superficie.toLocaleString()} m²</span>`:''}
          ${a.capacite?`<span class="badge badge-gray">${a.capacite}</span>`:''}
          ${canEdit?`<button class="btn btn-ghost btn-sm" onclick="event.stopPropagation();ui.navigate('saisie');editAsset(${a.id})">✏️ Modifier</button>`:''}
          ${canDelete?`<button class="btn btn-danger btn-sm" onclick="event.stopPropagation();delAsset(${a.id})">🗑️</button>`:''}
        </div>
      </div>
    </div>`;
  }).join('');
}
async function delAsset(id){
  const a=state.assets.find(x=>x.id===id); if(!confirm(`Supprimer "${a.name}" ?`))return;
  try{ await api.deleteAsset(id); toast('info','Actif supprimé',a.name); state.assets=await api.assets(); state.stats=await api.stats(); renderActifs(); mapctrl.render(); }catch(e){ toast('error','Erreur',e.message); }
}

/* ============================ DÉTAIL + TIMELINE ============================ */
async function showDetail(id){
  const a=state.assets.find(x=>x.id===id); if(!a)return;
  const [detail,history]=await Promise.all([api.asset(id),api.assetHistory(id)]);
  const st=STATUS[a.status]||{label:a.status};
  const photos=a.photos&&a.photos.length?`<div class="photo-strip" style="margin-bottom:12px">${a.photos.map(p=>`<img src="${p}" onerror="this.style.display='none'">`).join('')}</div>`:'';
  const tim=history.map(h=>`
    <div class="timeline-item">
      <div class="tl-status">${STATUS[h.to_status]?.icon||'→'} ${STATUS[h.to_status]?.label||h.to_status}${h.to_status==='rejete'?' <span style="color:var(--d)">(rejeté)</span>':''}</div>
      <div class="tl-meta">${short(h.created_at)} • ${h.user_name||'Système'}</div>
      ${h.note?`<div class="tl-note">💬 ${h.note}</div>`:''}
    </div>`).join('');
  let coord='';
  if(a.geom_type==='point') coord=`${a.coords[0].toFixed(6)}, ${a.coords[1].toFixed(6)}`;
  else if(a.geom_type==='polyline') coord=`${a.coords.length} points`;
  else coord=`${a.coords[0].length} sommets`;
  const isAdmin=state.user.role==='admin', canEdit=(state.user.role==='agent'&&a.author_id===state.user.id&&['demande','collecte'].includes(a.status));
  openModal('Fiche technique', `
    <div style="display:flex;align-items:center;gap:14px;margin-bottom:14px">
      <div style="width:54px;height:54px;border-radius:16px;background:linear-gradient(135deg,var(--pl),var(--p));display:flex;align-items:center;justify-content:center"><svg width="26" height="26" stroke="#fff" fill="none" stroke-width="1.6"><use href="#${ASSET_TYPES.find(t=>t.id===a.type)?.icon||'ico-forage'}"/></svg></div>
      <div><div style="font-weight:800;font-size:17px">${a.name}</div><div style="font-size:12px;color:var(--t3)">${ASSET_TYPES.find(t=>t.id===a.type)?.label||a.type} • ${a.ile} • Réf. ${a.request_number}</div></div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px">
      <div><span style="color:var(--t3);font-size:12px">Statut</span><div><span class="status-chip ${st.cls}">${st.icon} ${st.label}</span></div></div>
      <div><span style="color:var(--t3);font-size:12px">Géométrie</span><div>${a.geom_type}</div></div>
      <div><span style="color:var(--t3);font-size:12px">Superficie</span><div>${(a.superficie||0).toLocaleString()} m² (${((a.superficie||0)/10000).toFixed(2)} ha)</div></div>
      <div><span style="color:var(--t3);font-size:12px">Capacité</span><div>${a.capacite||'-'}</div></div>
    </div>
    <div style="font-size:13px;color:var(--t2);margin-bottom:12px"><b>Description :</b> ${a.description||'-'}</div>
    <div style="font-size:13px;margin-bottom:12px"><b>Coordonnées WGS84 :</b> <code>${coord}</code></div>
    ${photos}
    <div style="margin-bottom:12px"><b>Traçabilité des validations :</b>
      <div style="display:grid;gap:8px;margin-top:8px;font-size:13px">
        <div style="display:flex;justify-content:space-between;background:var(--sf2);padding:8px 12px;border-radius:8px"><span>Validation technique</span><b>${detail.validated_tech_by?((detail.tech_name||'Admin')+' — '+short(detail.validation_tech_at)):'—'}</b></div>
        <div style="display:flex;justify-content:space-between;background:var(--sf2);padding:8px 12px;border-radius:8px"><span>Validation direction</span><b>${detail.validated_dir_by?((detail.dir_name||'Admin')+' — '+short(detail.validation_dir_at)):'—'}</b></div>
        <div style="display:flex;justify-content:space-between;background:var(--sf2);padding:8px 12px;border-radius:8px"><span>Publication</span><b>${detail.published_at?short(detail.published_at):'—'}</b></div>
        ${detail.rejection_reason&&detail.rejection_reason!=='—'?`<div style="display:flex;justify-content:space-between;background:#fef2f2;padding:8px 12px;border-radius:8px;color:var(--d)"><span>Rejet</span><b>${short(detail.updated_at)} — ${detail.rejection_reason}</b></div>`:''}
      </div>
    </div>
    <div style="margin-bottom:12px"><b>Timeline du workflow :</b></div>
    <div class="timeline">${tim}</div>
    <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:18px">
      ${canEdit?`<button class="btn btn-primary" onclick="closeModal();ui.navigate('saisie');editAsset(${a.id})">✏️ Modifier</button>`:''}
      <button class="btn btn-secondary" onclick="exportFichePDF(${a.id})">🖨️ PDF</button>
      <button class="btn btn-secondary" onclick="closeModal()">Fermer</button>
    </div>`);
}
function editUserFromAsset(){ /* placeholder non requis */ }

/* ============================ SAISIE / DEMANDE ============================ */
let editingId=null, saisieGeom='point', saisieLoc='map', pickedGeom=null, saisieBasemap='satellite';
function initSaisie(){
  el_('page-saisie').innerHTML=`
  <div class="page-header"><h1>${editingId?'Modifier la demande':'Nouvelle demande / Saisie'}</h1><p>Étape 1 — Créer la demande d'intervention ou d'actif. La collecte terrain et les validations suivront dans le workflow.</p></div>
  <div class="card"><div class="card-body">
    <div class="form-group"><label class="form-label">Dénomination <span class="required">*</span></label><input class="form-input" id="sName" placeholder="Ex : Forage de Moroni Centre"></div>
    <div class="form-row form-row-2">
      <div class="form-group"><label class="form-label">Filière / Type <span class="required">*</span></label>
        <select class="form-select" id="sType"><option value="">Choisir...</option>${ASSET_TYPES.map(t=>`<option value="${t.id}">${t.iconLabel?t.iconLabel:''} ${t.label}</option>`).join('')}</select></div>
      <div class="form-group"><label class="form-label">Île <span class="required">*</span></label>
        <select class="form-select" id="sIle" onchange="loadCommunes()"><option value="">Choisir...</option><option>Ngazidja</option><option>Ndzuwani</option><option>Mwali</option></select></div>
    </div>
    <div class="form-group"><label class="form-label">Commune</label><select class="form-select" id="sCommune"></select></div>
    <div class="form-group"><label class="form-label">Description technique</label><textarea class="form-textarea" id="sDesc" placeholder="État, équipement, population desservie, objectifs..."></textarea></div>
    <div class="form-group">
      <label class="form-label">Type de géométrie <span class="required">*</span></label>
      <div class="geom-tabs">
        <button class="geom-tab ${saisieGeom==='point'?'active':''}" onclick="setSaisieGeom('point')">● Point</button>
        <button class="geom-tab ${saisieGeom==='polyline'?'active':''}" onclick="setSaisieGeom('polyline')">〰 Ligne</button>
        <button class="geom-tab ${saisieGeom==='polygon'?'active':''}" onclick="setSaisieGeom('polygon')">⬠ Polygone</button>
      </div>
    </div>
    <div class="form-group">
      <label class="form-label">Localisation géographique <span class="required">*</span></label>
      <div class="map-picker-container" id="sPicker"></div>
      <div class="gps-info" id="sInfo" style="margin-top:8px">🖱️ Dessinez la géométrie sur la carte ci-dessus (clic pour point, clic-clic pour ligne, clic-fermeture pour polygone).</div>
      <div style="display:flex;gap:8px;margin-top:8px;flex-wrap:wrap">
        <button class="btn btn-secondary btn-sm" onclick="captureGPSPick()">📡 Position GPS</button>
        <button class="btn btn-secondary btn-sm" onclick="showCoordInput()">⌨️ Lat/Lon</button>
        <button class="btn btn-secondary btn-sm" onclick="showUTMInput()">📍 Saisir en UTM</button>
      </div>
    </div>
    <div class="form-row form-row-2">
      <div class="form-group"><label class="form-label">Superficie (m²)</label><input type="number" class="form-input" id="sSuperficie" placeholder="0"></div>
      <div class="form-group"><label class="form-label">Capacité / Débit</label><input class="form-input" id="sCapacite" placeholder="Ex : 120 m³/j ou 50 tonnes"></div>
    </div>
    <div class="form-group"><label class="form-label">Budget prévisionnel (€)</label><input type="number" class="form-input" id="sBudget" placeholder="0"></div>
    ${state.user.role==='admin'?`<div class="form-group"><label class="form-label">Fond de carte de la saisie</label><select class="form-select" id="sBasemap" onchange="applyPickerBasemap(this.value)">${state.basemaps.map(b=>`<option value="${b.id}">${b.name}</option>`).join('')}</select></div>`:''}
    <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:22px">
      <button class="btn btn-secondary" onclick="ui.navigate('actifs')">Annuler</button>
      <button class="btn btn-primary" onclick="submitSaisie()">${editingId?'💾 Enregistrer les modifications':'📨 Créer la demande'}</button>
    </div>
  </div></div>`;
  // Réinitialiser la géométrie saisie
  pickedGeom=null;
  // L'élément #sPicker est recréé à chaque affichage : on détruit l'ancienne carte
  if(pickerMap){ try{ pickerMap.remove(); }catch(e){} pickerMap=null; pickerDrawn=null; }
  initPicker();
  loadCommunes();
  if(editingId){ const a=state.assets.find(x=>x.id===editingId); if(a) fillSaisie(a); }
}
async function loadCommunes(){
  try{ const ref=await api.referentiel(); const ile=val('sIle'); const key=Object.keys(ref).find(k=>k===ile); const c=el_('sCommune'); if(key){ c.innerHTML=`<option value="">Choisir...</option>`+ref[key].map(x=>`<option>${x}</option>`).join(''); } }catch(e){}
}
function setSaisieGeom(g){
  saisieGeom=g;
  document.querySelectorAll('#page-saisie .geom-tab').forEach(t=>t.classList.remove('active'));
  [...document.querySelectorAll('#page-saisie .geom-tab')].forEach(t=>{ if(t.textContent.includes(g==='point'?'Point':g==='polyline'?'Ligne':'Polygone'))t.classList.add('active'); });
  if(pickerMap){ pickerDrawn.clearLayers(); setupPickerDraw(); }
  pickedGeom=null; el_('sInfo').textContent='Dessinez la géométrie.';
}
function initPicker(){
  if(pickerMap) return;
  pickerMap=L.map('sPicker',{center:COMORES_CENTER,zoom:9,minZoom:8,maxBounds:COMORES_BOUNDS,maxBoundsViscosity:1.0});
  const bm=state.basemaps.find(b=>b.id===(val('sBasemap')||'satellite'))||state.basemaps[0];
  addTilesWithFallback(pickerMap, bm);
  pickerDrawn=new L.FeatureGroup().addTo(pickerMap);
  setupPickerDraw();
  pickerMap.on('click',(e)=>{
    if(saisieGeom!=='point')return;
    pickerDrawn.clearLayers();
    const m=L.marker(e.latlng).addTo(pickerDrawn);
    pickedGeom={type:'Point',coordinates:[e.latlng.lng,e.latlng.lat]};
    el_('sInfo').textContent=`Point : ${e.latlng.lat.toFixed(6)}, ${e.latlng.lng.toFixed(6)}`;
  });
}
function addTilesWithFallback(map, bm){
  // Fonds sans serveur public : orthophoto nationale ou plan des îles
  if(bm.comores || !bm.url){
    buildLocalBasemap(map, bm.comores ? '🇰🇲 Orthophoto nationale — à connecter aux tuiles du Ministère' : '');
    return;
  }
  const tiles=L.tileLayer(bm.url,{attribution:bm.attribution,maxZoom:bm.maxZoom}).addTo(map);
  tiles.on('tileerror',function(){
    if(map.__localBg)return;
    buildLocalBasemap(map);
  });
}
function setupPickerDraw(){
  if(!pickerMap)return;
  if(pickerMap.__drawBtn){ pickerMap.__drawBtn.remove(); }
  const btn=L.DomUtil.create('div','btn btn-primary btn-sm');
  btn.style.cssText='margin:8px;z-index:500';
  btn.innerHTML = saisieGeom==='point'?'● Mode point':'✏️ Tracer';
  const bar=btn;
  pickerMap.addControl({ onAdd(){return bar;}, onRemove(){bar.remove();} });
  pickerMap.__drawBtn=bar;
  // gestion ligne / polygone via clics
  pickerMap.off('click');
  if(saisieGeom==='point'){
    pickerMap.on('click',(e)=>{
      pickerDrawn.clearLayers();
      pickerDrawn.addLayer(L.marker(e.latlng));
      pickedGeom={type:'Point',coordinates:[e.latlng.lng,e.latlng.lat]};
      el_('sInfo').textContent=`Point : ${e.latlng.lat.toFixed(6)}, ${e.latlng.lng.toFixed(6)}`;
    });
  } else {
    let pts=[]; let tmp=null;
    pickerMap.on('click',(e)=>{
      pts.push([e.latlng.lat,e.latlng.lng]);
      if(tmp){ pickerMap.removeLayer(tmp); }
      if(saisieGeom==='polyline'&&pts.length>=2){
        tmp=L.polyline(pts,{color:'#1a472a',weight:4}).addTo(pickerMap);
      } else if(saisieGeom==='polygon'&&pts.length>=3){
        tmp=L.polygon(pts,{color:'#1a472a',fillOpacity:0.2}).addTo(pickerMap);
      }
      el_('sInfo').textContent=`${pts.length} point(s) — ${saisieGeom==='polyline'?'Double-clic pour terminer':'Cliquez sur « Terminer » quand le tracé est fermé'}`;
      pickerMap.__pts=pts;
    });
    pickerMap.on('dblclick',()=>{ if(saisieGeom==='polyline'&&pts.length>=2){ finalizeDraw('LineString',pts); } });
    // bouton terminer
    const fin=L.DomUtil.create('div','btn btn-accent btn-sm');
    fin.style.cssText='margin:8px;z-index:500;margin-left:90px';
    fin.textContent='✔ Terminer';
    const bar2=fin;
    pickerMap.addControl({ onAdd(){return bar2;}, onRemove(){bar2.remove();} });
    pickerMap.__finBtn=bar2;
    bar2.onclick=()=>{ if(saisieGeom==='polyline'&&pts.length>=2) finalizeDraw('LineString',pts); else if(saisieGeom==='polygon'&&pts.length>=3) finalizeDraw('Polygon',pts); };
  }
}
function finalizeDraw(type,pts){
  const coords = type==='LineString'?pts.map(p=>[p[1],p[0]]):[pts.map(p=>[p[1],p[0]])];
  pickedGeom={type,coordinates:coords};
  el_('sInfo').textContent = `${type==='LineString'?'Ligne':'Polygone'} tracé(e) — ${pts.length} points`;
  toast('success','Géométrie tracée',type==='LineString'?'Ligne enregistrée':'Polygone enregistré');
}
function applyPickerBasemap(id){
  if(!pickerMap)return;
  pickerMap.eachLayer(l=>{ if(l instanceof L.TileLayer || l===pickerMap.__pickfallback || l===pickerMap.__localBg) pickerMap.removeLayer(l); });
  pickerMap.__localBg=null;
  const bm=state.basemaps.find(b=>b.id===id)||state.basemaps[0];
  addTilesWithFallback(pickerMap, bm);
}
function captureGPSPick(){
  if(!navigator.geolocation){ toast('error','GPS indisponible','Navigateur non supporté'); return; }
  navigator.geolocation.getCurrentPosition(p=>{
    const lat=p.coords.latitude,lng=p.coords.longitude;
    pickedGeom={type:'Point',coordinates:[lng,lat]};
    if(pickerMap){ pickerMap.setView([lat,lng],14); pickerDrawn.clearLayers(); pickerDrawn.addLayer(L.marker([lat,lng])); }
    el_('sInfo').textContent=`Position GPS : ${lat.toFixed(6)}, ${lng.toFixed(6)} (préc. ${Math.round(p.coords.accuracy)} m)`;
    toast('success','Position capturée',`Précision ${Math.round(p.coords.accuracy)} m`);
  },e=>toast('error','Erreur GPS',e.message),{enableHighAccuracy:true,timeout:12000});
}
function showCoordInput(){
  const lat=prompt('Latitude (WGS84) :', '-11.7167');
  const lng=prompt('Longitude (WGS84) :', '43.2500');
  const la=parseFloat(lat),lo=parseFloat(lng);
  if(isNaN(la)||isNaN(lo))return;
  pickedGeom={type:'Point',coordinates:[lo,la]};
  if(pickerMap){ pickerMap.setView([la,lo],14); pickerDrawn.clearLayers(); pickerDrawn.addLayer(L.marker([la,lo])); }
  el_('sInfo').textContent=`Point : ${la.toFixed(6)}, ${lo.toFixed(6)}`;
}
function showUTMInput(){
  // Saisie des coordonnées prises lors des descentes terrain en UTM
  const zone = prompt('Zone UTM (38 pour les Comores) :', '38');
  const easting = prompt('Easting (X) en mètres :', '309272.58');
  const northing = prompt('Northing (Y) en mètres :', '8704181.18');
  const z=parseInt(zone,10), e=parseFloat(easting), n=parseFloat(northing);
  if(isNaN(z)||isNaN(e)||isNaN(n)){ toast('error','Valeurs invalides','Vérifiez la zone et les coordonnées UTM'); return; }
  const pt = utmToLatLng(z, 'S', e, n);
  // Vérifier que le point est plausible (océan Comores / région)
  if(pt.lat<-20||pt.lat>0||pt.lng<40||pt.lng>48){
    toast('error','Point hors zone','Vérifiez les coordonnées UTM (zone 38S, hémisphère Sud)');
    return;
  }
  pickedGeom={type:'Point',coordinates:[pt.lng,pt.lat]};
  if(pickerMap){ pickerMap.setView([pt.lat,pt.lng],14); pickerDrawn.clearLayers(); pickerDrawn.addLayer(L.marker([pt.lat,pt.lng])); }
  el_('sInfo').textContent=`UTM ${z}S ${e.toFixed(2)}E ${n.toFixed(2)}N → Lat ${pt.lat.toFixed(6)}, Lng ${pt.lng.toFixed(6)}`;
  toast('success','Coordonnées UTM converties',`${z}S ${e.toFixed(2)}E ${n.toFixed(2)}N`);
}
function fillSaisie(a){
  el_('sName').value=a.name; el_('sType').value=a.type; el_('sIle').value=a.ile;
  el_('sDesc').value=a.desc||a.description||''; el_('sSuperficie').value=a.superficie||'';
  el_('sCapacite').value=a.capacite||''; el_('sBudget').value=a.budget||'';
  setSaisieGeom(a.geom_type);
  // Réafficher la géométrie existante
  if(pickerMap && a.coords){
    const c=a.coords;
    if(a.geom_type==='point'){ pickerDrawn.clearLayers(); pickerDrawn.addLayer(L.marker(c)); pickerMap.setView(c,12); pickedGeom={type:'Point',coordinates:[c[1],c[0]]}; el_('sInfo').textContent=`Point : ${c[0].toFixed(6)}, ${c[1].toFixed(6)}`; }
    else if(a.geom_type==='polyline'){ const pts=c; pickerDrawn.clearLayers(); pickerDrawn.addLayer(L.polyline(pts,{color:'#1a472a',weight:4})); pickerMap.fitBounds(L.latLngBounds(pts)); pickedGeom={type:'LineString',coordinates:pts.map(p=>[p[1],p[0]])}; el_('sInfo').textContent=`Ligne — ${pts.length} points`; }
    else if(a.geom_type==='polygon'){ const pts=c[0]; pickerDrawn.clearLayers(); pickerDrawn.addLayer(L.polygon(pts,{color:'#1a472a',fillOpacity:0.2})); pickerMap.fitBounds(L.latLngBounds(pts)); pickedGeom={type:'Polygon',coordinates:[pts.map(p=>[p[1],p[0]])]}; el_('sInfo').textContent=`Polygone — ${pts.length} sommets`; }
  }
  loadCommunes().then(()=>{ if(a.commune) el_('sCommune').value=a.commune; });
}
async function submitSaisie(){
  const name=val('sName').trim(), type=val('sType'), ile=val('sIle'), commune=val('sCommune');
  const desc=val('sDesc').trim(), superficie=parseFloat(val('sSuperficie'))||0, capacite=val('sCapacite').trim(), budget=parseFloat(val('sBudget'))||0;
  if(!name||!type||!ile){ toast('error','Champs requis','Nom, filière et île obligatoires'); return; }
  if(!pickedGeom){ toast('error','Géométrie requise','Dessinez la géométrie sur la carte'); return; }
  let coords;
  if(pickedGeom.type==='Point') coords=[pickedGeom.coordinates[1],pickedGeom.coordinates[0]];
  else if(pickedGeom.type==='LineString') coords=pickedGeom.coordinates.map(c=>[c[1],c[0]]);
  else coords=[pickedGeom.coordinates[0].map(c=>[c[1],c[0]])];
  const geom_type=pickedGeom.type==='LineString'?'polyline':pickedGeom.type==='Polygon'?'polygon':'point';
  const payload={name,type,ile,commune,description:desc,geom_type,coords,superficie,capacite,budget};
  try{
    if(editingId){ await api.updateAsset(editingId,payload); toast('success','Modifié','Demande mise à jour'); }
    else { await api.createAsset(payload); toast('success','Demande créée','La demande entre dans le workflow. Un agent procédera à la collecte terrain.'); }
    editingId=null;
    state.assets=await api.assets(); state.stats=await api.stats();
    ui.navigate('actifs'); renderWorkflow(); updateBadges(); mapctrl.render();
  }catch(e){ toast('error','Erreur',e.message); }
}
function editAsset(id){ editingId=id; initSaisie(); }

/* ============================ VALIDATION ============================ */
async function renderValidation(){
  const el=el_('page-validation');
  const role=state.user.role;
  // SEUL L'ADMINISTRATEUR peut valider
  if(role!=='admin'){
    el.innerHTML=`
      <div class="page-header"><h1>Validation</h1><p>Accès réservé à l'administrateur</p></div>
      <div class="readonly-banner">🔐 <span>Seul l'<b>administrateur</b> peut valider et publier les actifs. Contactez-le pour le traitement des dossiers en attente.</span></div>
      <div id="valList">${emptyState('Accès restreint','La validation est réservée à l\'administrateur')}</div>`;
    return;
  }
  let list=state.assets.filter(a=>a.status==='en_validation_technique'||a.status==='en_validation_direction');
  el.innerHTML=`
  <div class="page-header"><h1>Validation (Administrateur)</h1><p>Vous seul pouvez valider et publier — chaque action est tracée (qui / quand)</p></div>
  <div id="valList"></div>`;
  const c=el_('valList');
  if(!list.length){ c.innerHTML=emptyState('Aucun dossier en attente','Tous les dossiers sont traités'); return; }
  c.innerHTML=list.map(a=>{
    const stage = a.status==='en_validation_technique'?'🔬 Validation technique':'🏛️ Validation direction';
    return `
    <div class="list-item" onclick="showDetail(${a.id})">
      <div class="list-item-icon" style="background:linear-gradient(135deg,#1e6091,#0f2e4d)"><svg width="22" height="22"><use href="#${ASSET_TYPES.find(t=>t.id===a.type)?.icon||'ico-forage'}"/></svg></div>
      <div class="list-item-content">
        <div class="list-item-title">${a.name} <span style="font-size:11px;color:var(--t3)">(${a.request_number})</span></div>
        <div class="list-item-meta">${stage} • ${ASSET_TYPES.find(t=>t.id===a.type)?.label||a.type} • ${a.ile} • Saisi par ${a.author_name||'-'}</div>
        <div class="list-item-actions">
          <span class="badge badge-blue">Validation réservée à l'administrateur</span>
          <button class="btn btn-secondary btn-sm" onclick="event.stopPropagation();showDetail(${a.id})">Détails</button>
          <button class="btn btn-primary btn-sm" onclick="approve(${a.id})">${a.status==='en_validation_technique'?'✔ Valider techniquement':'✔ Approuver & publier'}</button>
          <button class="btn btn-danger btn-sm" onclick="rejectFromVal(${a.id})">⛔ Rejeter</button>
        </div>
      </div>
    </div>`;
  }).join('');
}
async function approve(id){
  const a=state.assets.find(x=>x.id===id);
  const to=a.status==='en_validation_technique'?'en_validation_direction':'publie';
  if(to==='publie'&&!confirm(`Publier "${a.name}" sur la carte nationale ?`))return;
  try{ await api.transition(id,to); toast('success','Approbation',`${a.name} → ${STATUS[to].label}`); state.assets=await api.assets(); state.stats=await api.stats(); renderValidation(); renderWorkflow(); updateBadges(); mapctrl.render(); }catch(e){ toast('error','Erreur',e.message); }
}
async function rejectFromVal(id){
  const reason=prompt('Motif du rejet :')||'Non conforme';
  try{ await api.transition(id,'rejete',reason); toast('info','Rejeté',reason); state.assets=await api.assets(); state.stats=await api.stats(); renderValidation(); renderWorkflow(); updateBadges(); mapctrl.render(); }catch(e){ toast('error','Erreur',e.message); }
}

/* ============================ INTERVENTIONS ============================ */
async function renderInterventions(){
  const el=el_('page-interventions');
  const canAdd=['admin','agent','validateur_tech','validateur_dir'].includes(state.user.role);
  el.innerHTML=`
  <div class="page-header"><h1>Interventions & Campagnes</h1><p>Suivi des actions terrain, distributions et formations</p></div>
  ${canAdd?`<button class="btn btn-primary" style="margin-bottom:16px" onclick="newEventModal()">+ Nouvelle intervention</button>`:''}
  <div id="evtList"></div>`;
  const c=el_('evtList');
  if(!state.events.length){ c.innerHTML=emptyState('Aucune intervention','Les campagnes apparaîtront ici'); return; }
  c.innerHTML=state.events.map(e=>`
    <div class="list-item">
      <div class="list-item-icon" style="background:linear-gradient(135deg,#c65d3b,#9a3412)"><svg width="22" height="22"><use href="#ico-recolte"/></svg></div>
      <div class="list-item-content">
        <div class="list-item-title">${e.title}</div>
        <div class="list-item-meta">${EVENT_TYPES.find(t=>t.id===e.type)?.label||e.type} • ${e.ile} • ${e.date} • ${e.author_name||'-'}</div>
        ${e.description?`<div style="font-size:13px;color:var(--t2);margin-top:4px">${e.description}</div>`:''}
        <div class="list-item-actions"><span class="status-chip ${e.status==='valide'?'sc-publie':e.status==='rejete'?'sc-rejete':'sc-collecte'}">${e.status==='valide'?'✓':'⏳'} ${e.status}</span></div>
      </div>
    </div>`).join('');
}
function newEventModal(){
  openModal('Nouvelle intervention', `
    <div class="form-group"><label class="form-label">Titre <span class="required">*</span></label><input class="form-input" id="eTitle"></div>
    <div class="form-row form-row-2">
      <div class="form-group"><label class="form-label">Type</label><select class="form-select" id="eType">${EVENT_TYPES.map(t=>`<option value="${t.id}">${t.label}</option>`).join('')}</select></div>
      <div class="form-group"><label class="form-label">Île</label><select class="form-select" id="eIle"><option>Ngazidja</option><option>Ndzuwani</option><option>Mwali</option></select></div>
    </div>
    <div class="form-group"><label class="form-label">Date</label><input type="date" class="form-input" id="eDate"></div>
    <div class="form-group"><label class="form-label">Description</label><textarea class="form-textarea" id="eDesc"></textarea></div>
    <div style="display:flex;gap:10px;justify-content:flex-end"><button class="btn btn-secondary" onclick="closeModal()">Annuler</button><button class="btn btn-primary" onclick="submitEvent()">Enregistrer</button></div>`);
}
async function submitEvent(){
  try{ await api.req('POST','/events',{title:val('eTitle'),type:val('eType'),ile:val('eIle'),date:val('eDate'),description:val('eDesc')}); closeModal(); state.events=await api.events(); toast('success','Intervention créée',''); renderInterventions(); }catch(e){ toast('error','Erreur',e.message); }
}

/* ============================ IMPORT / EXPORT ============================ */
function renderImport(){
  el_('page-import').innerHTML=`
  <div class="page-header"><h1>Import / Export SIG</h1><p>Données géospatiales conformes aux standards OGC</p></div>
  <div class="grid-2">
    <div class="card"><div class="card-body">
      <h4 style="font-weight:700;margin-bottom:12px">📥 Import GeoJSON / Shapefile / CSV</h4>
      <input type="file" id="importFile" accept=".geojson,.json,.csv,.shp,.zip" onchange="handleImport(this)" class="form-input" style="padding:10px">
      <p style="font-size:12px;color:var(--t3);margin-top:8px">Supporte : <b>GeoJSON</b> (.geojson), <b>Shapefile</b> (.shp ou .zip contenant .shp/.dbf/.prj), <b>CSV</b> (lat/lon). Points, lignes et polygones acceptés. Les fichiers entrent dans le workflow en « Validation technique » (traités par l'administrateur).</p>
    </div></div>
    <div class="card"><div class="card-body">
      <h4 style="font-weight:700;margin-bottom:12px">📤 Export des actifs</h4>
      <div style="display:flex;flex-direction:column;gap:8px">
        <button class="btn btn-secondary" onclick="exportData('geojson')">🌐 GeoJSON</button>
        <button class="btn btn-secondary" onclick="exportData('csv')">📄 CSV</button>
        <button class="btn btn-secondary" onclick="exportData('json')">🗃️ JSON natif</button>
        <button class="btn btn-secondary" onclick="exportListPDF()">🖨️ Registre PDF</button>
      </div>
    </div></div>
  </div>`;
}
async function handleImport(input){
  const f=input.files[0]; if(!f)return;
  const ext=f.name.split('.').pop().toLowerCase();
  let data, type;
  try{
    if(ext==='shp'||ext==='zip'){
      // Fichier de formes (Shapefile) → conversion en GeoJSON via shpjs
      if(typeof window.shp==='undefined'){ toast('error','Bibliothèque absente','shpjs non chargé'); input.value=''; return; }
      const buf = await f.arrayBuffer();
      const geo = await window.shp(buf);
      // Normaliser en FeatureCollection (un seul fichier ou collection)
      let fc = Array.isArray(geo) ? { type:'FeatureCollection', features: geo } : geo;
      if(!fc.features) fc={ type:'FeatureCollection', features:[] };
      data = JSON.stringify(fc);
      type = 'geojson';
      if(!fc.features.length){ toast('error','Import échoué','Aucune entité trouvée dans le Shapefile'); input.value=''; return; }
      toast('info','Shapefile lu',`${fc.features.length} entité(s) (points/lignes/polygones)`);
    } else {
      const text=await f.text();
      type = ext==='csv'?'csv':'geojson';
      data = text;
    }
    const d=await api.req('POST','/import',{data,type});
    toast('success','Import réussi',`${d.count} actif(s) en validation technique`);
    state.assets=await api.assets(); state.stats=await api.stats(); updateBadges(); renderWorkflow(); mapctrl.render();
  }catch(e){ toast('error','Import échoué',e.message); }
  input.value='';
}
function exportData(fmt){
  window.location='/api/export/'+fmt;
  toast('info','Export','Téléchargement en cours...');
}

/* ============ EXPORT PDF (jsPDF) — fiche d'actif ============ */
function exportFichePDF(id){
  if(typeof window.jspdf==='undefined'){ toast('error','Bibliothèque absente','jsPDF non chargé'); return; }
  const a=state.assets.find(x=>x.id===id); if(!a)return;
  const { jsPDF }=window.jspdf;
  const doc=new jsPDF();
  const W=doc.internal.pageSize.getWidth();
  // En-tête
  doc.setFillColor(26,71,42); doc.rect(0,0,W,30,'F');
  doc.setTextColor(255,255,255); doc.setFont('helvetica','bold'); doc.setFontSize(15);
  doc.text('FALIKI ZA DIMA — SIGA', 14, 12);
  doc.setFont('helvetica','normal'); doc.setFontSize(9);
  doc.text('Système d\'Information Géographique Agricole — Union des Comores', 14, 18);
  doc.text('Direction Nationale de Stratégie Agricole', 14, 23);
  // Titre
  doc.setTextColor(26,71,42); doc.setFont('helvetica','bold'); doc.setFontSize(16);
  doc.text(a.name, 14, 42);
  doc.setTextColor(100,100,100); doc.setFont('helvetica','normal'); doc.setFontSize(10);
  doc.text(`Réf. ${a.request_number||'—'}  •  ${ASSET_TYPES.find(t=>t.id===a.type)?.label||a.type}`, 14, 49);
  // Champs
  const st=STATUS[a.status]?.label||a.status;
  let coords='';
  if(a.geom_type==='point'){ const u=latLonToUTM(a.coords[0],a.coords[1]); coords=`${a.coords[0].toFixed(6)}, ${a.coords[1].toFixed(6)}\nUTM: ${formatUTM(u)}`; }
  else if(a.geom_type==='polyline') coords=`${a.coords.length} points`;
  else coords=`${a.coords[0].length} sommets`;
  const rows=[
    ['Statut',st],['Île',a.ile],['Commune',a.commune||'—'],['Géométrie',a.geom_type],
    ['Superficie',(a.superficie||0).toLocaleString()+' m² ('+((a.superficie||0)/10000).toFixed(2)+' ha)'],
    ['Capacité / Débit',a.capacite||'—'],['Budget (€)',(a.budget||0).toLocaleString()],
    ['Coordonnées',coords],['Saisi par',a.author_name||'—'],['Date',short(a.created_at)],
    ['Validé technique',a.tech_name||'—'],['Validé direction',a.dir_name||'—']
  ];
  let y=58;
  doc.setFont('helvetica','bold'); doc.setFontSize(10); doc.setTextColor(26,71,42);
  doc.text('FICHE TECHNIQUE', 14, y); y+=6;
  doc.setFont('helvetica','normal'); doc.setTextColor(40,40,40);
  rows.forEach(r=>{
    doc.setFontSize(9); doc.setFont('helvetica','bold'); doc.text(String(r[0]),14,y);
    doc.setFont('helvetica','normal');
    const x1=doc.splitTextToSize(String(r[1]), W-20-60); 
    doc.text(x1, 70, y);
    y+=6*x1.length+2;
  });
  y+=4;
  // Description
  if(a.description){
    doc.setFont('helvetica','bold'); doc.setFontSize(10); doc.setTextColor(26,71,42); doc.text('DESCRIPTION',14,y); y+=5;
    doc.setFont('helvetica','normal'); doc.setFontSize(9); doc.setTextColor(40,40,40);
    const lines=doc.splitTextToSize(String(a.description), W-28);
    doc.text(lines,14,y); y+=5*lines.length;
  }
  y+=4;
  // Pied de page
  if(y>250){ doc.addPage(); y=20; }
  doc.setDrawColor(200,200,200); doc.line(14,y,W-14,y); y+=6;
  doc.setFont('helvetica','italic'); doc.setFontSize(7.5); doc.setTextColor(120,120,120);
  doc.text('Document généré le '+new Date().toLocaleDateString('fr-FR')+' — FALIKI ZA DIMA', 14, y);
  doc.text('Appui : Projet Chaîne de Valeur Agricole (CVA) & PNUD', 14, y+4);
  doc.save(`FALIKI-${a.request_number||a.id}.pdf`);
  toast('success','PDF généré','Fiche téléchargée');
}
function exportListPDF(){
  if(typeof window.jspdf==='undefined'){ toast('error','Bibliothèque absente','jsPDF non chargé'); return; }
  const { jsPDF }=window.jspdf;
  const doc=new jsPDF();
  const W=doc.internal.pageSize.getWidth();
  doc.setFillColor(26,71,42); doc.rect(0,0,210,26,'F');
  doc.setTextColor(255,255,255); doc.setFont('helvetica','bold'); doc.setFontSize(14);
  doc.text('FALIKI ZA DIMA — Registre des actifs agricoles', 14, 12);
  doc.setFont('helvetica','normal'); doc.setFontSize(9);
  doc.text(`Total : ${state.assets.length} actifs — ${new Date().toLocaleDateString('fr-FR')}`, 14, 19);
  let y=34; doc.setTextColor(30,30,30);
  state.assets.forEach(a=>{
    if(y>270){ doc.addPage(); y=18; }
    const st=STATUS[a.status]?.label||a.status;
    doc.setFont('helvetica','bold'); doc.setFontSize(10); doc.text(a.name,14,y);
    doc.setFont('helvetica','normal'); doc.setFontSize(8); doc.setTextColor(90,90,90);
    const meta=`${a.request_number||''} • ${ASSET_TYPES.find(t=>t.id===a.type)?.label||a.type} • ${a.ile} • ${st}`;
    const lines=doc.splitTextToSize(meta, W-28);
    doc.text(lines,14,y+4.5);
    y+=4.5*lines.length+7;
  });
  doc.save(`FALIKI-registre-${new Date().toISOString().slice(0,10)}.pdf`);
  toast('success','PDF généré','Registre téléchargé');
}

/* ============================ ADMIN ============================ */
async function renderAdmin(){
  const el=el_('page-admin');
  if(state.user.role!=='admin'){ el.innerHTML=emptyState('Accès restreint','Réservé à l\'administrateur'); return; }
  const users=await api.users();
  el.innerHTML=`
  <div class="page-header"><h1>Administration Système</h1><p>Gestion des utilisateurs, fonds de carte et référentiels</p></div>
  <div class="grid-2">
    <div class="card"><div class="card-body">
      <h4 style="font-weight:700;margin-bottom:10px">🗺️ Fonds de carte (libres)</h4>
      <div style="display:flex;flex-direction:column;gap:8px">${state.basemaps.map(b=>`
        <label style="display:flex;align-items:center;gap:10px;padding:10px;background:var(--sf2);border-radius:8px;cursor:pointer;font-size:13px">
          <input type="radio" name="defbm" value="${b.id}" ${b.id===state.currentBasemap?'checked':''} onchange="setDefaultBasemap('${b.id}')"> <span style="width:14px;height:14px;border-radius:4px;background:${b.preview};border:1px solid var(--b)"></span> ${b.name}
        </label>`).join('')}
      </div>
    </div></div>
    <div class="card"><div class="card-body">
      <h4 style="font-weight:700;margin-bottom:10px">🛠️ Paramètres de l'organisation</h4>
      <div class="form-group"><label class="form-label">Nom de l'organisation</label><input class="form-input" id="setOrgName" value="${state.settings.org_name||''}"></div>
      <div class="form-group"><label class="form-label">Sous-titre</label><input class="form-input" id="setOrgSub" value="${state.settings.org_subtitle||''}"></div>
      <button class="btn btn-primary btn-sm" onclick="saveOrgSettings()">💾 Enregistrer</button>
    </div></div>
  </div>
  <div class="card" style="margin-top:20px">
    <div class="card-header"><div class="card-title">👥 Gestion des utilisateurs</div><button class="btn btn-primary btn-sm" onclick="userModal()">+ Nouvel utilisateur</button></div>
    <div class="card-body" id="usersList"></div>
  </div>`;
  el_('usersList').innerHTML=users.map(u=>`
    <div class="user-card">
      <div class="user-card-avatar">${(u.display_name||u.username)[0]}</div>
      <div class="user-card-info">
        <div class="user-card-name">${u.display_name||u.username}</div>
        <div class="user-card-meta">${ROLE_LABELS[u.role]||u.role} • @${u.username}${u.ile?' • '+u.ile:''}${u.active===0?' • <span style="color:var(--d)">inactif</span>':''}</div>
      </div>
      <div class="user-card-actions">
        <button class="btn btn-ghost btn-sm" onclick="editUser(${u.id})">✏️</button>
        ${u.role!=='admin'?`<button class="btn btn-danger btn-sm" onclick="delUser(${u.id})">🗑️</button>`:''}
      </div>
    </div>`).join('');
}
function setDefaultBasemap(id){ state.currentBasemap=id; api.saveSettings({default_basemap:id}).then(()=>toast('info','Fond par défaut','Enregistré')).catch(()=>{}); }
async function saveOrgSettings(){ try{ await api.saveSettings({org_name:val('setOrgName'),org_subtitle:val('setOrgSub')}); toast('success','Paramètres enregistrés',''); }catch(e){ toast('error','Erreur',e.message); } }
function userModal(){
  openModal('Nouvel utilisateur', `
    <div class="form-group"><label class="form-label">Identifiant <span class="required">*</span></label><input class="form-input" id="uUser"></div>
    <div class="form-group"><label class="form-label">Nom complet</label><input class="form-input" id="uName"></div>
    <div class="form-group"><label class="form-label">Mot de passe <span class="required">*</span></label><input class="form-input" id="uPass" type="password"></div>
    <div class="form-group"><label class="form-label">Rôle</label><select class="form-select" id="uRole">
      <option value="agent">🤝 Agent terrain</option><option value="validateur_tech">🔬 Validateur technique</option><option value="validateur_dir">🏛️ Direction nationale</option><option value="visiteur">👁️ Consultation</option>
    </select></div>
    <div class="form-group"><label class="form-label">Île de rattachement</label><select class="form-select" id="uIle"><option value="">—</option><option>Ngazidja</option><option>Ndzuwani</option><option>Mwali</option></select></div>
    <div style="display:flex;gap:10px;justify-content:flex-end"><button class="btn btn-secondary" onclick="closeModal()">Annuler</button><button class="btn btn-primary" onclick="submitUser()">Créer</button></div>`);
}
async function submitUser(){
  try{ await api.createUser({username:val('uUser'),display_name:val('uName'),password:val('uPass'),role:val('uRole'),ile:val('uIle')}); closeModal(); toast('success','Utilisateur créé',''); renderAdmin(); }catch(e){ toast('error','Erreur',e.message); }
}
async function editUser(id){
  openModal('Modifier l\'utilisateur', `<div class="form-group"><label class="form-label">Nouveau mot de passe (laisser vide pour conserver)</label><input class="form-input" id="uPass2" type="password"></div><div style="display:flex;gap:10px;justify-content:flex-end"><button class="btn btn-secondary" onclick="closeModal()">Annuler</button><button class="btn btn-primary" onclick="submitUserEdit(${id})">Enregistrer</button></div>`);
}
async function submitUserEdit(id){ const p=val('uPass2'); if(p){ try{ await api.updateUser(id,{password:p}); closeModal(); toast('success','Mot de passe mis à jour',''); }catch(e){ toast('error','Erreur',e.message); } } else closeModal(); }
async function delUser(id){ if(!confirm('Supprimer cet utilisateur ?'))return; try{ await api.deleteUser(id); toast('info','Utilisateur supprimé',''); renderAdmin(); }catch(e){ toast('error','Erreur',e.message); } }

/* ============================ MODAL / TOAST ============================ */
function openModal(title,bodyHtml){
  const ov=document.createElement('div'); ov.className='modal-overlay active'; ov.id='activeModal';
  ov.innerHTML=`<div class="modal"><div class="modal-header"><h2>${title}</h2><button class="modal-close" onclick="closeModal()">×</button></div><div class="modal-body">${bodyHtml}</div></div>`;
  ov.onclick=e=>{ if(e.target===ov) closeModal(); };
  document.body.appendChild(ov);
}
function closeModal(){ const m=el_('activeModal'); if(m)m.remove(); }
function emptyState(title,desc){ return `<div class="empty-state"><div class="empty-state-icon">📄</div><h3>${title}</h3><p>${desc}</p></div>`; }
function toast(type,title,msg){
  const c=el_('toastContainer'); const t=document.createElement('div');
  t.className=`toast toast-${type}`;
  const ic=type==='success'?'✓':type==='error'?'✕':'ℹ';
  t.innerHTML=`<div class="toast-icon">${ic}</div><div><div class="toast-title">${title}</div><div class="toast-msg">${msg}</div></div>`;
  c.appendChild(t); setTimeout(()=>{ t.style.opacity='0'; t.style.transform='translateX(30px)'; setTimeout(()=>t.remove(),300); },4000);
}
function short(d){ if(!d)return''; const x=new Date(d); return x.toLocaleDateString('fr-FR',{day:'2-digit',month:'short',year:'numeric'}); }

/* ============================ HELPERS / BOOT ============================ */
function val(id){ const e=el_(id); return e?e.value.trim():''; }
function el_(id){ return document.getElementById(id); }

function showVisitorMode(){ el_('loginScreen').style.display='none'; el_('mainLayout').classList.remove('active'); el_('visitorMode').classList.add('active'); }
function showLoginForm(){ el_('loginForm').style.display='block'; }
function showVisitorLogin(){ el_('visitorMode').classList.remove('active'); el_('loginScreen').style.display='flex'; }
document.querySelectorAll('.role-chip').forEach(ch=>ch.addEventListener('click',()=>{ document.querySelectorAll('.role-chip').forEach(c=>c.classList.remove('active')); ch.classList.add('active'); }));

(async function boot(){
  try{ await api.bootstrap(); }
  catch(e){ console.error('Boot error',e); }
  // Visiteur : carte publique uniquement
  if(state.user && state.user.role==='visiteur'){
    showVisitorMode();
    await loadData();
    mapctrl.initVisitor();
    return;
  }
  // Session ouverte non-visiteur -> application
  if(state.user){
    el_('loginScreen').style.display='none';
    el_('mainLayout').classList.add('active');
    ui.refreshIdentity(); ui.buildSidebar();
    await loadData(); populateSelects(); mapctrl.initApp(); updateBadges();
    ui.navigate('dashboard');
  }
})();
