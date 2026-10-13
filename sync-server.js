#!/usr/bin/env node
/* Server sinkronisasi sederhana untuk aplikasi Kasir Wong Fei Gouw.
   - Tanpa dependensi (hanya Node.js 16+).
   - Menyimpan salinan data per-perangkat di folder DATA_DIR/<id-perangkat>/<kunci>.json.
   - Tidak menggabungkan data antarperangkat: tiap perangkat punya salinan sendiri,
     sehingga satu perangkat tidak bisa menimpa data perangkat lain.

   Jalankan:   SYNC_API_KEY="rahasia-panjang" node sync-server.js
   Opsional:   PORT=8787  HOST=0.0.0.0  DATA_DIR=./sync-data
   Di internet, taruh di belakang HTTPS (Caddy / Nginx / Cloudflare Tunnel). */
const http = require('http'), fs = require('fs'), path = require('path'), crypto = require('crypto');

const PORT = Number(process.env.PORT || 8787);
const HOST = process.env.HOST || '0.0.0.0';
const DIR = path.resolve(process.env.DATA_DIR || './sync-data');
const API_KEY = process.env.SYNC_API_KEY || '';
const MAX_BODY = 80 * 1024 * 1024;
if (!API_KEY || API_KEY.length < 8) { console.error('Setel SYNC_API_KEY (minimal 8 karakter), contoh: SYNC_API_KEY="rahasia-panjang" node sync-server.js'); process.exit(1); }

const RE_DEVICE = /^[A-Za-z0-9_-]{3,64}$/;
const RE_KEY = /^wfg_[a-z_]{1,40}$/;
const DILARANG = new Set(['wfg_users', 'wfg_sesi_login']);      // akun & password tidak pernah disimpan di server

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type, X-API-Key', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Max-Age': '600' };
function kirim(res, kode, obj) { const b = JSON.stringify(obj); res.writeHead(kode, Object.assign({ 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(b) }, CORS)); res.end(b); }
function kunciCocok(req) {
  const a = Buffer.from(String(req.headers['x-api-key'] || '')), b = Buffer.from(API_KEY);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
function bacaBody(req) {
  return new Promise((ok, gagal) => {
    let n = 0; const potong = [];
    req.on('data', c => { n += c.length; if (n > MAX_BODY) { gagal(Object.assign(new Error('Terlalu besar'), { kode: 413 })); req.destroy(); } else potong.push(c); });
    req.on('end', () => ok(Buffer.concat(potong).toString('utf8')));
    req.on('error', gagal);
  });
}
function tulisAtomik(file, teks) { const tmp = file + '.' + process.pid + '.tmp'; fs.writeFileSync(tmp, teks); fs.renameSync(tmp, file); }
function bacaJson(file, def) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return def; } }

http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://x');
    if (req.method === 'OPTIONS') { res.writeHead(204, CORS); return res.end(); }
    if (url.pathname === '/health') return kirim(res, 200, { ok: true, auth: kunciCocok(req), waktu: new Date().toISOString() });
    if (!kunciCocok(req)) return kirim(res, 401, { ok: false, error: 'API key salah' });

    if (url.pathname === '/sync' && req.method === 'POST') {
      let j; try { j = JSON.parse(await bacaBody(req)); } catch (e) { if (e.kode) return kirim(res, e.kode, { ok: false, error: e.message }); return kirim(res, 400, { ok: false, error: 'JSON tidak valid' }); }
      if (!j || !RE_DEVICE.test(String(j.device || '')) || !j.data || typeof j.data !== 'object') return kirim(res, 400, { ok: false, error: 'device/data tidak valid' });
      const dir = path.join(DIR, j.device); fs.mkdirSync(dir, { recursive: true });
      const meta = bacaJson(path.join(dir, '_meta.json'), { device: j.device, keys: {} });
      const tersimpan = [];
      for (const k of Object.keys(j.data)) {
        if (!RE_KEY.test(k) || DILARANG.has(k)) continue;
        const teks = JSON.stringify(j.data[k]);
        tulisAtomik(path.join(dir, k + '.json'), teks);
        meta.keys[k] = { updatedAt: new Date().toISOString(), bytes: Buffer.byteLength(teks) }; tersimpan.push(k);
      }
      meta.usaha = String(j.usaha || meta.usaha || ''); meta.updatedAt = new Date().toISOString();
      tulisAtomik(path.join(dir, '_meta.json'), JSON.stringify(meta, null, 1));
      return kirim(res, 200, { ok: true, saved: tersimpan });
    }
    if (url.pathname === '/sync' && req.method === 'GET') {
      const dev = url.searchParams.get('device') || '';
      if (!RE_DEVICE.test(dev)) return kirim(res, 400, { ok: false, error: 'device tidak valid' });
      const dir = path.join(DIR, dev);
      if (!fs.existsSync(dir)) return kirim(res, 404, { ok: false, error: 'Belum ada data' });
      const meta = bacaJson(path.join(dir, '_meta.json'), { keys: {} }); const data = {};
      for (const k of Object.keys(meta.keys || {})) { if (RE_KEY.test(k) && !DILARANG.has(k)) data[k] = bacaJson(path.join(dir, k + '.json'), null); }
      return kirim(res, 200, { ok: true, device: dev, usaha: meta.usaha || '', updatedAt: meta.updatedAt || '', data });
    }
    if (url.pathname === '/devices' && req.method === 'GET') {
      const out = fs.existsSync(DIR) ? fs.readdirSync(DIR).filter(d => RE_DEVICE.test(d)).map(d => { const m = bacaJson(path.join(DIR, d, '_meta.json'), {}); return { device: d, usaha: m.usaha || '', updatedAt: m.updatedAt || '' }; }) : [];
      return kirim(res, 200, { ok: true, devices: out });
    }
    kirim(res, 404, { ok: false, error: 'Tidak ditemukan' });
  } catch (err) { console.error(err); kirim(res, 500, { ok: false, error: 'Kesalahan server' }); }
}).listen(PORT, HOST, () => console.log(`Server sinkronisasi aktif di http://${HOST}:${PORT}  (data: ${DIR})`));
