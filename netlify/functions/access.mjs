// I Love My PDF — Fonction Netlify : gestion des accès temporaires.
// Permet la révocation à distance d'un lien invité (stockage @netlify/blobs).
// GET  ?probe=1        → ping (détection backend par le navigateur)
// GET  ?code=XXX       → validation : { ok, name, expiresAt } ou { ok:false, error, revoked }
// POST { action:'create', code, name, expiresAt }  → enregistre un partage (admin requis)
// POST { action:'revoke', code }                   → révoque un partage (admin requis)
// POST { action:'list' }                           → liste les partages (admin requis)
//
// Sécurité :
//  - Les actions d'écriture/liste exigent un jeton admin (header `x-admin-token`)
//    comparé à la variable d'environnement ADMIN_PASS_HASH (empreinte SHA-256 du mot de passe).
//    Si ADMIN_PASS_HASH n'est pas définie, les actions admin sont REFUSÉES (défaut sûr).
//  - Validation des entrées (expiresAt, name) côté serveur.
//  - Rate limiting basique par IP (mémoire ; à renforcer avec un store persistant en production).
import { getStore } from '@netlify/blobs';

const STORE = 'ilm-access';
const ADMIN_HASH = process.env.ADMIN_PASS_HASH || '';
const MAX_NAME = 100;
const RATE_LIMIT = 60;        // requêtes max
const RATE_WINDOW = 60_000;   // par fenêtre (ms)
const rateMap = new Map();

function rateLimited(ip) {
  const now = Date.now();
  const rec = rateMap.get(ip) || { count: 0, start: now };
  if (now - rec.start > RATE_WINDOW) { rec.count = 0; rec.start = now; }
  rec.count++;
  rateMap.set(ip, rec);
  return rec.count > RATE_LIMIT;
}

function isAdmin(req) {
  if (!ADMIN_HASH) return false; // pas de secret configuré → refus
  const token = req.headers.get('x-admin-token') || '';
  return token === ADMIN_HASH;
}

function clientIp(req) {
  return req.headers.get('x-nf-client-connection-ip') ||
         req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
         'unknown';
}

export default async (req) => {
  const url = new URL(req.url);
  const store = getStore(STORE);

  // Ping / détection backend
  if (req.method === 'GET' && url.searchParams.get('probe') === '1') {
    return Response.json({ ok: true, mode: 'remote' });
  }

  // Validation d'un lien invité (lecture publique : pas de jeton requis)
  if (req.method === 'GET') {
    const code = url.searchParams.get('code');
    if (!code) return Response.json({ ok: false, error: 'code manquant' });
    let blob = null;
    try { blob = await store.get(code, { type: 'json' }); } catch { blob = null; }
    if (!blob) return Response.json({ ok: false, error: 'lien inconnu' });
    if (blob.revoked) return Response.json({ ok: false, error: 'révoqué', revoked: true });
    if (blob.expiresAt && blob.expiresAt < Date.now()) return Response.json({ ok: false, error: 'expiré' });
    return Response.json({ ok: true, name: blob.name || '', expiresAt: blob.expiresAt || 0 });
  }

  // Création / révocation / liste : actions admin protégées
  if (req.method === 'POST') {
    const ip = clientIp(req);
    if (rateLimited(ip)) {
      return Response.json({ ok: false, error: 'trop de requêtes' }, { status: 429 });
    }
    if (!isAdmin(req)) {
      return Response.json({ ok: false, error: 'non autorisé' }, { status: 403 });
    }

    let body = {};
    try { body = await req.json(); } catch { body = {}; }
    const action = body.action;

    if (action === 'create') {
      const { code, name, expiresAt } = body;
      if (!code || typeof code !== 'string' || code.length > 256) {
        return Response.json({ ok: false, error: 'code invalide' });
      }
      const cleanName = typeof name === 'string' ? name.slice(0, MAX_NAME) : '';
      const exp = Number(expiresAt);
      const validExp = Number.isFinite(exp) && exp >= 0;
      await store.set(code, JSON.stringify({
        name: cleanName, expiresAt: validExp ? exp : 0,
        revoked: false, createdAt: Date.now()
      }));
      return Response.json({ ok: true });
    }

    if (action === 'revoke') {
      const { code } = body;
      if (!code || typeof code !== 'string' || code.length > 256) {
        return Response.json({ ok: false, error: 'code invalide' });
      }
      let blob = null;
      try { blob = await store.get(code, { type: 'json' }); } catch { blob = null; }
      if (blob) {
        blob.revoked = true;
        await store.set(code, JSON.stringify(blob));
      }
      return Response.json({ ok: true });
    }

    if (action === 'list') {
      const shares = [];
      let result = null;
      try { result = await store.list(); } catch { result = null; }
      if (result && result.blobs) {
        for (const item of result.blobs) {
          let b = null;
          try { b = await store.get(item.key, { type: 'json' }); } catch { b = null; }
          if (b) shares.push({
            key: item.key, name: b.name || '',
            expiresAt: b.expiresAt || 0, revoked: !!b.revoked,
            createdAt: b.createdAt || 0
          });
        }
      }
      return Response.json({ ok: true, shares });
    }

    return Response.json({ ok: false, error: 'action inconnue' });
  }

  return Response.json({ ok: false, error: 'méthode non supportée' });
};
