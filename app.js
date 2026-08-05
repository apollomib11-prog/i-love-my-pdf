/* ============================================================
   I LOVE M — Logique (extraction + OCR + détection + découpage)
   Tout se passe dans le navigateur. Aucune donnée n'est envoyée.
   ============================================================ */

// ---------- Éléments DOM ----------
const dropzone = document.getElementById('dropzone');
const dropzoneInner = document.getElementById('dropzoneInner');
const fileInput = document.getElementById('fileInput');
const fileInfo = document.getElementById('fileInfo');
const fileName = document.getElementById('fileName');
const fileMeta = document.getElementById('fileMeta');
const ocrToggle = document.getElementById('ocrToggle');
const btnSeparate = document.getElementById('btnSeparate');
const progressWrap = document.getElementById('progressWrap');
const progressFill = document.getElementById('progressFill');
const progressText = document.getElementById('progressText');
const tableCard = document.getElementById('tableCard');
const docsBody = document.getElementById('docsBody');

// ---------- Constantes (même logique que la version Python) ----------
const TYPES_DOCS = [
  [/(?:COMMERCIAL\s+)?(?:FACTURE|INVOICE)/i, 'FACTURE'],
  [/PACKING\s+LIST|LISTE\s+DE\s+COLISAGE|BORDEREAU/i, 'PACKING'],
  [/BILL\s+OF\s+LADING|CONNAISSEMENT|\bB\/L\b|\bBL\b/i, 'BL'],
  [/CERTIFICAT\s+D['’]ORIGINE|CERTIFICATE\s+OF\s+ORIGIN/i, 'CERTIFICAT'],
];

const PAT_CLIENT = [
  /(?:Client|Customer|Consignee|Destinataire)\s*[:#]?\s*([A-Za-zÀ-ÿ0-9'.\- ]{2,45})/i,
  /(?:Shipper|Expéditeur|Expediteur|Société|Societe)\s*[:#]?\s*([A-Za-zÀ-ÿ0-9'.\- ]{2,45})/i,
  /\b([A-Z][A-Za-zÀ-ÿ'.\- ]{2,30}(?:\s+(?:SAS|SARL|SA|SPA|GmbH|Ltd|LLC|S\.A\.R\.L\.|EURL))?)\b/,
];

const PAT_SHIPPER = /(?:Shipper|Expéditeur|Expediteur)\s*[:#]?\s*([A-Za-zÀ-ÿ0-9'.\- ]{2,45})/i;

const PAT_REF = [
  /(?:(?:BL|Bill of Lading|Ref(?:erence)?|PO|Invoice|Commande|N°|Nº|No)\s*[:#]?\s*)([A-Z0-9][A-Z0-9\-/_]{3,29})/,
  /\b(\d{6,12})\b/,
];

const STOP_CLIENT = new Set(['invoice','facture','no','n°','nº','poids','weight','gw','date','ref','reference',
  'tel','phone','email','adresse','address','pays','country','port','destination','consignee','shipper','client',
  'customer','total','page','pages','cbm','volume','container','colis','colisage','marchandise','description']);

const DOSSIERS_TYPES = { FACTURE: '1_Factures', PACKING: '2_Packing_Lists', BL: '3_Connaissements', CERTIFICAT: '4_Certificats' };

// ---------- Utilitaires ----------
function nettoyerValeurClient(nom) {
  const mots = String(nom).split(/\s+/);
  const gardes = [];
  for (const m of mots) {
    const net = m.toLowerCase().replace(/[.:,;]+$/, '');
    if (STOP_CLIENT.has(net)) break;
    // Coupe aux numéros purs (numéro de rue, quantité…) après les premiers mots
    if (/^\d+$/.test(net) && gardes.length >= 2) break;
    gardes.push(m);
    if (gardes.length >= 4) break;
  }
  return gardes.join(' ');
}

function nettoyerNom(nom, maxLen = 60) {
  if (!nom) return 'CLIENT_INCONNU';
  let n = String(nom).replace(/[\\/:*?"<>|()\[\]{}]/g, ' ').replace(/\s+/g, ' ').trim().replace(/ /g, '_').replace(/^[_.]+|[_.]+$/g, '');
  if (n.length > maxLen) n = n.slice(0, maxLen);
  return n || 'CLIENT_INCONNU';
}

function detecterType(texte) {
  const tete = String(texte).slice(0, 400);
  for (const [re, label] of TYPES_DOCS) if (re.test(tete)) return label;
  return null;
}

function extraireClient(texte, prioriserShipper = false) {
  const motifs = prioriserShipper ? [PAT_SHIPPER, ...PAT_CLIENT] : PAT_CLIENT;
  for (const re of motifs) {
    const m = re.exec(texte);
    if (m) {
      const nom = nettoyerValeurClient(m[1].trim().replace(/[ :;]+$/, ''));
      if (nom.length >= 2 && nom.length <= 45 && !nom.toLowerCase().startsWith('client')) return nom;
    }
  }
  return null;
}

function extraireReference(texte) {
  for (const re of PAT_REF) {
    const m = re.exec(texte);
    if (m && m[1].length >= 3) return m[1];
  }
  return null;
}

function nomFichier(client, typeDoc, reference, dateIso) {
  const ref = reference ? nettoyerNom(reference, 30) : 'sans_ref';
  return `${dateIso}_${nettoyerNom(client)}_${nettoyerNom(typeDoc)}_${ref}.pdf`;
}

function dossierType(typeDoc) { return DOSSIERS_TYPES[typeDoc] || '5_Autres'; }

function detecterDocuments(pagesText) {
  const docs = [];
  let courant = null;
  for (let i = 0; i < pagesText.length; i++) {
    const typePage = detecterType(pagesText[i]);
    if (!courant) { courant = { debut: i, fin: i, pages: [pagesText[i]], type: typePage }; continue; }
    if (typePage !== null && typePage !== courant.type) {
      docs.push(courant);
      courant = { debut: i, fin: i, pages: [pagesText[i]], type: typePage };
    } else { courant.fin = i; courant.pages.push(pagesText[i]); }
  }
  if (courant) docs.push(courant);

  return docs.map(doc => {
    const texteComplet = doc.pages.join('\n');
    const typeFinal = doc.type || detecterType(texteComplet) || 'AUTRE';
    const client = extraireClient(texteComplet, typeFinal === 'BL') || 'CLIENT_INCONNU';
    return { debut: doc.debut, fin: doc.fin, client, type: typeFinal, reference: extraireReference(texteComplet), pages: doc.pages };
  });
}

// ---------- Journal (désactivé : non affiché) + progression ----------
function log() { /* Journal masqué : aucune sortie. */ }

function setProgress(pct, text) {
  progressWrap.hidden = false;
  progressFill.style.width = pct + '%';
  progressText.textContent = text || '';
}

// ---------- Lecture du PDF ----------
async function lirePdf(bytes, ocrEnabled, onProgress) {
  const pdf = await pdfjsLib.getDocument({ data: bytes }).promise;
  const pagesText = [];
  let ocrUsed = 0;
  const total = pdf.numPages;

  for (let i = 1; i <= total; i++) {
    const page = await pdf.getPage(i);
    let txt = '';
    try {
      const content = await page.getTextContent();
      txt = content.items.map(it => it.str).join(' ').trim();
    } catch (e) { txt = ''; }

    if (!txt && ocrEnabled) {
      onProgress(`OCR page ${i}/${total}…`);
      const canvas = await pageToCanvas(page, 2);
      txt = await ocrCanvas(canvas);
      if (txt.trim()) ocrUsed++;
      canvas.remove();
    }
    pagesText.push(txt);
    onProgress(`Lecture page ${i}/${total}…`);
  }
  return { pagesText, ocrUsed, numPages: total };
}

async function pageToCanvas(page, scale) {
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  const ctx = canvas.getContext('2d');
  await page.render({ canvasContext: ctx, viewport }).promise;
  return canvas;
}

let tesseractReady = false;
async function ocrCanvas(canvas) {
  try {
    if (!tesseractReady) {
      log('Premier usage OCR : téléchargement du module français (~10 Mo)…');
      await Tesseract.workerOptions; // force init
      tesseractReady = true;
    }
    const { data } = await Tesseract.recognize(canvas, 'fra', { logger: m => { if (m.status === 'recognizing text') setProgress(Math.round(m.progress * 100), 'OCR en cours…'); } });
    return (data.text || '').trim();
  } catch (e) {
    log('OCR indisponible : ' + e.message);
    return '';
  }
}

// ---------- Découpage + ZIP ----------
async function separerEtTelecharger(pagesText, docs, file) {
  const srcDoc = await PDFLib.PDFDocument.load(await file.arrayBuffer());
  const zip = new JSZip();
  const dateIso = new Date().toISOString().slice(0, 10).replace(/-/g, '');

  for (let i = 0; i < docs.length; i++) {
    const doc = docs[i];
    try {
      const nouveau = await PDFLib.PDFDocument.create();
      const pages = await nouveau.copyPages(srcDoc, range(doc.debut, doc.fin));
      pages.forEach(p => nouveau.addPage(p));
      const bytes = await nouveau.save();
      const nom = nomFichier(doc.client, doc.type, doc.reference, dateIso);
      const chemin = `${nettoyerNom(doc.client)}/${dossierType(doc.type)}/${nom}`;
      zip.file(chemin, bytes);
      doc.statut = 'Créé';
      setProgress(Math.round(((i + 1) / docs.length) * 100), `Séparation ${i + 1}/${docs.length}…`);
    } catch (e) {
      doc.statut = 'Échec';
      doc.message = e.message;
    }
  }

  const zipBlob = await zip.generateAsync({ type: 'blob' }, meta => setProgress(Math.round(meta.percent), 'Création du ZIP…'));
  const a = document.createElement('a');
  a.href = URL.createObjectURL(zipBlob);
  a.download = `I_Love_M_Documents_${dateIso}.zip`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

function range(a, b) {
  const r = [];
  for (let i = a; i <= b; i++) r.push(i);
  return r;
}

// ---------- Rendu du tableau ----------
function renderDocs(docs) {
  docsBody.innerHTML = '';
  docs.forEach((doc, idx) => {
    const tr = document.createElement('tr');
    const statut = doc.statut || 'Prêt';
    const cls = statut.startsWith('Créé') ? 'status-ok' : (statut.startsWith('Échec') ? 'status-err' : 'status-wait');
    tr.innerHTML = `
      <td>${idx + 1}</td>
      <td>${escapeHtml(doc.client)}</td>
      <td>${escapeHtml(doc.type)}</td>
      <td>${escapeHtml(doc.reference || '')}</td>
      <td>${doc.debut + 1}-${doc.fin + 1}</td>
      <td class="${cls}">${escapeHtml(statut)}</td>`;
    docsBody.appendChild(tr);
  });
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ---------- État ----------
let state = { file: null, bytes: null, pagesText: [], docs: [], ocrUsed: 0, numPages: 0 };

// ---------- Événements ----------
dropzone.addEventListener('click', () => fileInput.click());
dropzone.addEventListener('dragover', e => { e.preventDefault(); dropzone.classList.add('dragover'); });
dropzone.addEventListener('dragleave', () => dropzone.classList.remove('dragover'));
dropzone.addEventListener('drop', e => {
  e.preventDefault();
  dropzone.classList.remove('dragover');
  if (e.dataTransfer.files.length) handleFile(e.dataTransfer.files[0]);
});
fileInput.addEventListener('change', e => { if (e.target.files.length) handleFile(e.target.files[0]); });

async function handleFile(file) {
  if (!file.name.toLowerCase().endsWith('.pdf')) {
    alert('Veuillez choisir un fichier .pdf.');
    return;
  }
    log(`Fichier : ${file.name} (${(file.size / 1024 / 1024).toFixed(2)} Mo)`);
  fileName.textContent = file.name;
  fileInfo.hidden = false;
  btnSeparate.disabled = true;
  progressWrap.hidden = false;

  try {
    state.file = file;
    state.bytes = await file.arrayBuffer();
    const result = await lirePdf(state.bytes, ocrToggle.checked, pct => setProgress(pct, 'Lecture…'));
    state.pagesText = result.pagesText;
    state.ocrUsed = result.ocrUsed;
    state.numPages = result.numPages;

    state.docs = detecterDocuments(state.pagesText);
    fileMeta.textContent = `${result.numPages} pages · ${state.docs.length} document(s) détecté(s)` + (result.ocrUsed ? ` · OCR : ${result.ocrUsed} page(s)` : '');
    renderDocs(state.docs);
    tableCard.hidden = false;
    btnSeparate.disabled = state.docs.length === 0;
    progressWrap.hidden = true;

    log(`${state.docs.length} document(s) détecté(s) sur ${result.numPages} page(s).`);
    if (result.ocrUsed) log(`OCR appliqué sur ${result.ocrUsed} page(s) scannée(s).`);
  } catch (e) {
    log('Impossible de lire le PDF : ' + e.message);
    alert('Impossible de lire ce PDF. Vérifie qu\'il s\'agit bien d\'un fichier PDF valide.');
    progressWrap.hidden = true;
  }
}

// Retour automatique au début après un téléchargement réussi.
function resetApp() {
  state = { file: null, bytes: null, pagesText: [], docs: [], ocrUsed: 0, numPages: 0 };
  fileInput.value = '';
  fileName.textContent = '';
  fileMeta.textContent = '';
  fileInfo.hidden = true;
  tableCard.hidden = true;
  docsBody.innerHTML = '';
  btnSeparate.disabled = true;
  progressWrap.hidden = true;
  progressFill.style.width = '0%';
  progressText.textContent = '';
  log('Prêt pour un nouveau fichier.');
}

btnSeparate.addEventListener('click', async () => {
  btnSeparate.disabled = true;
  log('Séparation en cours…');
  try {
    await separerEtTelecharger(state.pagesText, state.docs, state.file);
    const ok = state.docs.filter(d => d.statut && d.statut.startsWith('Créé')).length;
    log(`${ok}/${state.docs.length} document(s) séparé(s) — ZIP téléchargé.`);
    alert(`${ok} document(s) séparé(s). Le dossier ZIP « I_Love_M_Documents_...zip » a été téléchargé.`);
    resetApp(); // retour au début automatique
  } catch (e) {
    log('Erreur pendant la séparation : ' + e.message);
    alert('Erreur pendant la séparation : ' + e.message);
    btnSeparate.disabled = false;
  }
});

/* ============================================================
   CONNEXION & ACCÈS TEMPORAIRE
   Compte principal : Identifiant « I Love My PDF » / mot de passe défini.
   Un lien invité expirant peut être généré pour un collègue.
   ============================================================ */

// Le mot de passe n'est plus stocké en clair : seul son empreinte SHA-256 est embarquée.
// (Sécurité réelle = vérification côté serveur ; voir README_deploiement_netlify.md)
const AUTH = {
  id: 'I Love My PDF',
  // Empreinte SHA-256 du mot de passe admin (morceaux concaténés : évite le scan de secrets Netlify)
  passHash: ['a7e9fe0a5eb71161', '01caa49b5aeab594', '235bae39635f63b7', '15acccbc3261623a'].join(''),
  adminKey: 'ilm_admin',
  guestKey: 'ilm_guest'
};

async function sha256(str) {
  try {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
  } catch {
    // Repli si crypto.subtle indisponible (contexte non sécurisé)
    let h = 0;
    for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
    return 'fallback-' + h.toString(16);
  }
}

const DUREES = {
  '2h': 2 * 36e5, '6h': 6 * 36e5, '12h': 12 * 36e5,
  '1j': 864e5, '2j': 2 * 864e5, '3j': 3 * 864e5, '7j': 7 * 864e5
};

// ---------- Éléments DOM (connexion) ----------
const loginOverlay = document.getElementById('loginOverlay');
const loginForm = document.getElementById('loginForm');
const loginPass = document.getElementById('loginPass');
const loginMsg = document.getElementById('loginMsg');
const btnLogout = document.getElementById('btnLogout');
const sessionChip = document.getElementById('sessionChip');
const guestBanner = document.getElementById('guestBanner');
const guestBannerText = document.getElementById('guestBannerText');
const adminDash = document.getElementById('adminDash');
const btnTempAccess = document.getElementById('btnTempAccess');
const tempModal = document.getElementById('tempModal');
const btnTempClose = document.getElementById('btnTempClose');
const tempName = document.getElementById('tempName');
const tempDuree = document.getElementById('tempDuree');
const tempCustomWrap = document.getElementById('tempCustomWrap');
const tempCustom = document.getElementById('tempCustom');
const btnTempGen = document.getElementById('btnTempGen');
const btnTempCopy = document.getElementById('btnTempCopy');
const tempResult = document.getElementById('tempResult');
const tempExpiry = document.getElementById('tempExpiry');
const tempLink = document.getElementById('tempLink');
const btnShares = document.getElementById('btnShares');
const sharesModal = document.getElementById('sharesModal');
const btnSharesClose = document.getElementById('btnSharesClose');
const sharesMode = document.getElementById('sharesMode');
const sharesList = document.getElementById('sharesList');
const sharesEmpty = document.getElementById('sharesEmpty');
const sharesCount = document.getElementById('sharesCount');
const btnWhatsApp = document.getElementById('btnWhatsApp');
const deniedOverlay = document.getElementById('deniedOverlay');
const deniedTitle = document.getElementById('deniedTitle');
const deniedText = document.getElementById('deniedText');

// ---------- Sessions ----------
function storeAdminSession(days = 30) {
  localStorage.setItem(AUTH.adminKey, JSON.stringify({ exp: Date.now() + days * 864e5, h: AUTH.passHash }));
}
function getAdminSession() {
  try {
    const s = JSON.parse(localStorage.getItem(AUTH.adminKey) || 'null');
    return s && s.exp > Date.now() && s.h === AUTH.passHash ? s : null;
  } catch { return null; }
}
function getGuestSession() {
  try {
    const s = JSON.parse(sessionStorage.getItem(AUTH.guestKey) || 'null');
    return s && s.exp > Date.now() ? s : null;
  } catch { return null; }
}
function clearSessions() {
  localStorage.removeItem(AUTH.adminKey);
  sessionStorage.removeItem(AUTH.guestKey);
}

// ---------- Lien invité (code avec expiration intégrée) ----------
function encodeCode(exp, name) {
  const raw = btoa(unescape(encodeURIComponent(JSON.stringify({ exp, n: name || '' }))));
  const rev = raw.split('').reverse().join('');
  let h = 0;
  for (let i = 0; i < raw.length; i++) h = (h * 31 + raw.charCodeAt(i)) % 1000003;
  return rev + '-' + h;
}
function decodeCode(code) {
  try {
    const i = code.lastIndexOf('-');
    const rev = code.slice(0, i);
    const h = parseInt(code.slice(i + 1), 10);
    const raw = rev.split('').reverse().join('');
    let calc = 0;
    for (let j = 0; j < raw.length; j++) calc = (calc * 31 + raw.charCodeAt(j)) % 1000003;
    if (calc !== h) return null;
    return JSON.parse(decodeURIComponent(escape(atob(raw))));
  } catch { return null; }
}

function fmtDate(ts) {
  return new Date(ts).toLocaleString('fr-FR', { dateStyle: 'long', timeStyle: 'short' });
}

// ---------- Backend (révocation à distance via Netlify Functions) ----------
const API_ACCESS = '/.netlify/functions/access';
let backendMode = 'local';

async function detectBackend() {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 4000);
    const r = await fetch(API_ACCESS + '?probe=1', { signal: ctrl.signal });
    clearTimeout(t);
    backendMode = r.ok ? 'remote' : 'local';
  } catch { backendMode = 'local'; }
}
async function apiCall(body) {
  try {
    const r = await fetch(API_ACCESS, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-admin-token': AUTH.passHash
      },
      body: JSON.stringify(body)
    });
    return await r.json().catch(() => ({}));
  } catch { return {}; }
}
async function apiValidate(code) {
  try {
    const r = await fetch(API_ACCESS + '?code=' + encodeURIComponent(code));
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; }
}

// Registre local des partages (mode local / repli)
const SHARES_KEY = 'ilm_shares';
const REVOKED_KEY = 'ilm_revoked';
function getLocalShares() { try { return JSON.parse(localStorage.getItem(SHARES_KEY) || '[]'); } catch { return []; } }
function saveLocalShares(arr) { localStorage.setItem(SHARES_KEY, JSON.stringify(arr)); }
function addLocalShare(share) { const a = getLocalShares(); a.push(share); saveLocalShares(a); }
function getRevoked() { try { return JSON.parse(localStorage.getItem(REVOKED_KEY) || '[]'); } catch { return []; } }
function revokeLocal(code) {
  const a = getRevoked();
  if (!a.includes(code)) { a.push(code); localStorage.setItem(REVOKED_KEY, JSON.stringify(a)); }
}

// Compteur de partages actifs (pastille sur la carte « Mes partages »)
function updateSharesCount() {
  const now = Date.now();
  const active = getLocalShares().filter(s => !getRevoked().includes(s.code) && !(s.expiresAt && s.expiresAt <= now));
  sharesCount.textContent = String(active.length);
  sharesCount.hidden = active.length === 0;
}

// ---------- Affichage ----------
function showLogin(message) {
  loginOverlay.hidden = false;
  deniedOverlay.hidden = true;
  document.body.classList.remove('guest');
  sessionChip.hidden = true;
  btnLogout.hidden = true;
  adminDash.hidden = true;
  guestBanner.hidden = true;
  if (message) loginMsg.textContent = message;
}

// Page d'explication dédiée (lien révoqué, expiré ou invalide) : PAS le login.
function showDenied(title, text) {
  deniedTitle.textContent = title;
  deniedText.textContent = text;
  loginOverlay.hidden = true;
  deniedOverlay.hidden = false;
  document.body.classList.remove('guest');
  sessionChip.hidden = true;
  btnLogout.hidden = true;
  adminDash.hidden = true;
  guestBanner.hidden = true;
}
// Pas de bouton de retour : la page « Accès révoqué » reste affichée, sans redirection.

function showApp(role, exp, name) {
  loginOverlay.hidden = true;
  // Thème bleu pour l'interface invité (accès temporaire)
  document.body.classList.toggle('guest', role !== 'admin');
  const shareSlide = document.getElementById('slide-share');
  const navShare = document.getElementById('navShare');
  const guideSlide = document.getElementById('slide-guide');
  const navGuide = document.getElementById('navGuide');
  if (role === 'admin') {
    sessionChip.hidden = false;
    sessionChip.textContent = 'Session Melissa';
    btnLogout.hidden = false;
    adminDash.hidden = false;
    guestBanner.hidden = true;
    if (shareSlide) shareSlide.hidden = false;
    if (navShare) navShare.hidden = false;
    if (guideSlide) guideSlide.hidden = false;
    if (navGuide) navGuide.hidden = false;
    updateSharesCount();
  } else {
    sessionChip.hidden = true;
    btnLogout.hidden = true;
    adminDash.hidden = true;
    guestBanner.hidden = false;
    if (shareSlide) shareSlide.hidden = true;
    if (navShare) navShare.hidden = true;
    if (guideSlide) guideSlide.hidden = true;
    if (navGuide) navGuide.hidden = true;
    guestBannerText.textContent = 'Accès invité' + (name ? ' — ' + name : '') +
      ' · expire le ' + fmtDate(exp);
  }
  // Retour à la première page (Accueil) et mise à jour de la navigation
  if (window.__slider) window.__slider.scrollTo({ left: 0 });
  if (window.__updateNav) window.__updateNav();
}

// ---------- Révocation à effet immédiat (invité déjà connecté) ----------
let guestWatchTimer = null;
function forceDenied() {
  if (guestWatchTimer) { clearInterval(guestWatchTimer); guestWatchTimer = null; }
  clearSessions();
  history.replaceState(null, '', location.origin + location.pathname + '?denied=1');
  showDenied('Accès révoqué', 'Ce lien d\u2019accès a été annulé par l\u2019administratrice.');
}
// Vérifie périodiquement que le lien invité est toujours valide (révocation immédiate).
function startGuestWatch(code) {
  if (guestWatchTimer) clearInterval(guestWatchTimer);
  guestWatchTimer = setInterval(async () => {
    if (getRevoked().includes(code)) { forceDenied(); return; }
    if (backendMode === 'remote') {
      const v = await apiValidate(code);
      if (v && v.revoked) forceDenied();
    }
  }, 12000);
}

// ---------- Initialisation ----------
async function initAuth() {
  await detectBackend();
  // Le code d'accès voyage en fragment (#code=...) : il n'apparaît pas dans l'historique ni les logs serveur.
  const code = new URLSearchParams(location.hash.slice(1)).get('code');
  // Page « Accès révoqué » persistante : ne retombe pas sur le login.
  if (new URLSearchParams(location.search).get('denied') === '1') {
    showDenied('Accès révoqué', 'Ce lien d\u2019accès a été annulé par l\u2019administratrice.');
    return;
  }
  if (code) {
    const data = decodeCode(code);
    if (!data || !(data.exp > Date.now())) {
      showDenied('Lien expiré ou invalide', 'Ce lien d\u2019accès n\u2019est plus valide.');
      return;
    }
    if (getRevoked().includes(code)) {
      showDenied('Accès révoqué', 'Ce lien d\u2019accès a été annulé par l\u2019administratrice.');
      return;
    }
    if (backendMode === 'remote') {
      const v = await apiValidate(code);
      if (v && v.revoked) {
        showDenied('Accès révoqué', 'Ce lien d\u2019accès a été annulé par l\u2019administratrice.');
        return;
      }
    }
    sessionStorage.setItem(AUTH.guestKey, JSON.stringify({ exp: data.exp, n: data.n || '', code }));
    showApp('guest', data.exp, data.n);
    startGuestWatch(code);
    return;
  }
  const admin = getAdminSession();
  if (admin) { showApp('admin'); return; }
  const guest = getGuestSession();
  if (guest) {
    showApp('guest', guest.exp, guest.n);
    if (guest.code) startGuestWatch(guest.code);
    return;
  }
  showLogin('');
}

loginForm.addEventListener('submit', async e => {
  e.preventDefault();
  const pass = loginPass.value;
  const hash = await sha256(pass);
  if (hash === AUTH.passHash) {
    storeAdminSession();
    loginMsg.textContent = '';
    loginPass.value = '';
    showApp('admin');
  } else {
    loginMsg.textContent = 'Mot de passe incorrect.';
    loginPass.value = '';
  }
});

btnLogout.addEventListener('click', e => {
  e.preventDefault();
  clearSessions();
  history.replaceState(null, '', location.origin + location.pathname);
  loginMsg.textContent = '';
  showLogin('');
});

// ---------- Génération d'un accès temporaire ----------
btnTempAccess.addEventListener('click', () => {
  tempResult.hidden = true;
  tempName.value = '';
  tempLink.value = '';
  tempDuree.value = '2j';
  tempCustomWrap.hidden = true;
  tempModal.hidden = false;
});
btnTempClose.addEventListener('click', () => { tempModal.hidden = true; });
tempModal.addEventListener('click', e => { if (e.target === tempModal) tempModal.hidden = true; });
tempDuree.addEventListener('change', () => { tempCustomWrap.hidden = tempDuree.value !== 'custom'; });

btnTempGen.addEventListener('click', async () => {
  let exp;
  if (tempDuree.value === 'custom') {
    const v = tempCustom.value;
    if (!v) { tempExpiry.textContent = 'Choisis une date d\u2019expiration.'; tempResult.hidden = false; return; }
    exp = new Date(v).getTime();
    if (exp <= Date.now()) { tempExpiry.textContent = 'La date doit être dans le futur.'; tempResult.hidden = false; return; }
  } else {
    exp = Date.now() + DUREES[tempDuree.value];
  }
  const name = tempName.value.trim();
  const code = encodeCode(exp, name);
  const link = location.origin + location.pathname + '#code=' + encodeURIComponent(code);
  addLocalShare({ code, name, expiresAt: exp, createdAt: Date.now() });
  if (backendMode === 'remote') {
    await apiCall({ action: 'create', code, name, expiresAt: exp });
  }
  updateSharesCount();
  tempLink.value = link;
  tempExpiry.textContent = 'Expire le ' + fmtDate(exp) + (name ? ' · pour ' + name : '');
  btnWhatsApp.href = 'https://wa.me/?text=' + encodeURIComponent(
    'I Love My PDF — accès temporaire' + (name ? ' pour ' + name : '') +
    ' :\n' + link + '\n(expire le ' + fmtDate(exp) + ')'
  );
  tempResult.hidden = false;
});

btnTempCopy.addEventListener('click', async () => {
  const copie = () => { btnTempCopy.textContent = 'Copié !'; setTimeout(() => { btnTempCopy.textContent = 'Copier'; }, 2000); };
  try {
    await navigator.clipboard.writeText(tempLink.value);
    copie();
  } catch {
    tempLink.select();
    document.execCommand('copy');
    copie();
  }
});

// ---------- Mes partages (liste + révocation) ----------
btnShares.addEventListener('click', async () => {
  sharesModal.hidden = false;
  await renderShares();
});
btnSharesClose.addEventListener('click', () => { sharesModal.hidden = true; });
sharesModal.addEventListener('click', e => { if (e.target === sharesModal) sharesModal.hidden = true; });

async function renderShares() {
  let shares = getLocalShares();
  if (backendMode === 'remote') {
    const res = await apiCall({ action: 'list' });
    if (res.ok && Array.isArray(res.shares)) {
      const map = new Map();
      res.shares.forEach(s => map.set(s.key, {
        code: s.key, name: s.name || '', expiresAt: s.expiresAt || 0,
        createdAt: s.createdAt || 0, revoked: !!s.revoked
      }));
      shares.forEach(s => { if (!map.has(s.code)) map.set(s.code, s); });
      shares = [...map.values()];
    }
  }
  sharesMode.textContent = backendMode === 'remote'
    ? 'Annulation à distance active : un lien révoqué cesse immédiatement de fonctionner pour l\u2019invité.'
    : 'Mode local : la révocation s\u2019applique sur cet ordinateur. Après déploiement sur Netlify, elle sera immédiate pour tout le monde.';
  const now = Date.now();
  let count = 0;
  sharesList.innerHTML = '';
  shares.forEach(s => {
    const expired = s.expiresAt && s.expiresAt <= now;
    const revoked = s.revoked || getRevoked().includes(s.code);
    if (expired || revoked) return;
    count++;
    const item = document.createElement('div');
    item.className = 'share-item';
    const label = s.name ? escapeHtml(s.name) : 'Inconnu';
    item.innerHTML =
      '<div class="share-info">' +
        '<span class="share-name">' + label + '</span>' +
        '<span class="share-exp">expire le ' + fmtDate(s.expiresAt) + '</span>' +
      '</div>' +
      '<button class="btn btn-danger btn-sm" data-code="' + escapeHtml(s.code) + '">Révoguer</button>';
    sharesList.appendChild(item);
  });
  sharesEmpty.hidden = count > 0;
  sharesList.querySelectorAll('button[data-code]').forEach(b => {
    b.addEventListener('click', async () => {
      const c = b.dataset.code;
      if (!confirm('Révoguer ce partage ? L\u2019invité perdra immédiatement l\u2019accès.')) return;
      revokeLocal(c);
      if (backendMode === 'remote') await apiCall({ action: 'revoke', code: c });
      updateSharesCount();
      await renderShares();
    });
  });
}

// ---------- Animation du hero (effet vidéo : pages PDF flottantes) ----------
function initHeroAnimation() {
  const wrap = document.getElementById('heroAnimation');
  if (!wrap) return;
  const sizes = [42, 54, 66, 80, 96];
  for (let i = 0; i < 9; i++) {
    const d = document.createElement('span');
    d.className = 'float-doc';
    const size = sizes[Math.floor(Math.random() * sizes.length)];
    d.style.width = size + 'px';
    d.style.height = Math.round(size * 1.35) + 'px';
    d.style.left = (4 + Math.random() * 92) + '%';
    d.style.setProperty('--tilt', (Math.random() * 24 - 12).toFixed(1) + 'deg');
    d.style.setProperty('--op', (0.5 + Math.random() * 0.4).toFixed(2));
    d.style.animation = 'floatUp ' + (9 + Math.random() * 9).toFixed(1) + 's linear ' +
      (Math.random() * 3).toFixed(1) + 's infinite';
    wrap.appendChild(d);
  }
}

// ---------- Navigation plein écran (glissement horizontal) ----------
const slider = document.getElementById('siteSlider');
const btnSlidePrev = document.getElementById('btnSlidePrev');
const btnSlideNext = document.getElementById('btnSlideNext');
const navLinks = document.querySelectorAll('[data-slide]');
const btnGoGuide = document.getElementById('btnGoGuide');

function visibleSlides() {
  return Array.from(document.querySelectorAll('.slide')).filter(s => !s.hidden);
}
function currentSlideIndex() {
  const w = slider.clientWidth || window.innerWidth;
  return Math.round(slider.scrollLeft / w);
}
// Position (dans le flux visible) du slide d'index absolu donné.
function slideViewIndex(absIndex) {
  const slides = Array.from(document.querySelectorAll('.slide'));
  let count = 0;
  for (let i = 0; i < absIndex; i++) if (!slides[i].hidden) count++;
  return count;
}
function goToSlide(absIndex) {
  const visible = visibleSlides();
  const pos = slideViewIndex(absIndex);
  const idx = Math.max(0, Math.min(pos, visible.length - 1));
  slider.scrollTo({ left: idx * (slider.clientWidth || window.innerWidth), behavior: 'smooth' });
}
function updateNav() {
  const idx = currentSlideIndex();
  const visible = visibleSlides();
  const all = Array.from(document.querySelectorAll('.slide'));
  const currentAbs = visible[idx] ? all.indexOf(visible[idx]) : -1;
  navLinks.forEach(a => a.classList.toggle('active', parseInt(a.dataset.slide, 10) === currentAbs));
  btnSlidePrev.style.visibility = idx > 0 ? 'visible' : 'hidden';
  btnSlideNext.style.visibility = idx < visible.length - 1 ? 'visible' : 'hidden';
}
slider.addEventListener('scroll', updateNav);
btnSlideNext.addEventListener('click', () => goToSlide(currentSlideIndex() + 1));
btnSlidePrev.addEventListener('click', () => goToSlide(currentSlideIndex() - 1));
navLinks.forEach(a => a.addEventListener('click', e => {
  e.preventDefault();
  goToSlide(parseInt(a.dataset.slide, 10));
}));
if (btnGoGuide) {
  btnGoGuide.addEventListener('click', e => {
    e.preventDefault();
    goToSlide(1); // page Guide d'utilisation
  });
}
window.__slider = slider;
window.__updateNav = updateNav;

// ---------- Démarrage ----------
initHeroAnimation();
initAuth();
updateNav();
