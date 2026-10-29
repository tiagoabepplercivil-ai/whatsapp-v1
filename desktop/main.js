// WhatsApp v1 — app de computador (Windows): WhatsApp Web real + assistente, agenda e lembretes ao lado.
// Fecha para a bandeja para os lembretes continuarem tocando.
const { app, BrowserWindow, Tray, Menu, shell, protocol, net, nativeImage, session, clipboard, ipcMain, dialog } = require('electron');
const os = require('os');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');
const http = require('http');
const { spawn } = require('child_process');
const crypto = require('crypto');

protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } }]);

let win, tray, quitting = false, lastUnread = 0;

// arquivos: tudo vai para <pasta do Drive>/WhatsApp v1/<conversa>/ — o Google Drive para computador sincroniza sozinho
let driveDir = '', currentChat = '';
const idsFile = () => path.join(app.getPath('userData'), 'arquivos-salvos.json');
let savedIds = new Set(), idsTimer;
function loadIds() { try { savedIds = new Set(JSON.parse(fs.readFileSync(idsFile(), 'utf8'))); } catch {} }
function persistIds() { clearTimeout(idsTimer); idsTimer = setTimeout(() => { try { fs.writeFileSync(idsFile(), JSON.stringify([...savedIds].slice(-20000))); } catch {} }, 2000); }
function detectDrive() {
  const home = os.homedir();
  const cands = [];
  for (const L of 'GHIJKLMNOPQRSTUVWXYZDEF') cands.push(L + ':\\Meu Drive', L + ':\\My Drive');
  cands.push(path.join(home, 'Google Drive', 'Meu Drive'), path.join(home, 'Google Drive', 'My Drive'), path.join(home, 'Google Drive'), path.join(home, 'My Drive'), path.join(home, 'Meu Drive'));
  return cands.find(d => { try { return fs.statSync(d).isDirectory(); } catch { return false; } }) || '';
}
const baseDir = () => path.join(driveDir || path.join(app.getPath('documents')), 'WhatsApp v1');
const clean = s => String(s || 'Sem nome').replace(/[<>:"/\\|?*\x00-\x1f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || 'Sem nome';
const stamp = d => { const p = n => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}${p(d.getMinutes())}`; };
function targetPath(chat, name, when) {
  const dir = path.join(baseDir(), clean(chat || currentChat || 'Outros'));
  fs.mkdirSync(dir, { recursive: true });
  const ext = path.extname(name), stem = clean(path.basename(name, ext));
  let f = path.join(dir, `${stamp(when || new Date())} - ${stem}${ext}`), i = 2;
  while (fs.existsSync(f)) f = path.join(dir, `${stamp(when || new Date())} - ${stem} (${i++})${ext}`);
  return f;
}
function saved(f, extra) { win && win.webContents.send('wv1:saved', { file: f, rel: path.relative(path.dirname(baseDir()), f), ...(extra || {}) }); }
// downloads (WhatsApp e o próprio app) vão para uma pasta fixa, sem perguntar onde salvar.
// Padrão: <Área de Trabalho>\Dowload whas app (C:\Users\tiago\Desktop\Dowload whas app); muda em Configurações.
const DL_NAME = 'Dowload whas app';
const dlFile = () => path.join(app.getPath('userData'), 'downloads.json');
function dlDefault() {
  const desk = path.join(os.homedir(), 'Desktop');
  const isDir = d => { try { return fs.statSync(d).isDirectory(); } catch { return false; } };
  if (isDir(desk)) return path.join(desk, DL_NAME);
  try { return path.join(app.getPath('desktop'), DL_NAME); } catch { return path.join(desk, DL_NAME); }
}
let dlDir = '';
function loadDl() { try { dlDir = String(JSON.parse(fs.readFileSync(dlFile(), 'utf8')).dir || ''); } catch { dlDir = ''; } }
const dlCurrent = () => dlDir || dlDefault();
function downloadPath(name) {
  let dir = dlCurrent();
  try { fs.mkdirSync(dir, { recursive: true }); } catch (e) { console.warn('pasta de downloads:', e.message); dir = app.getPath('downloads'); fs.mkdirSync(dir, { recursive: true }); }
  const ext = path.extname(name), stem = clean(path.basename(name, ext));
  let f = path.join(dir, stem + ext), i = 2;
  while (fs.existsSync(f)) f = path.join(dir, `${stem} (${i++})${ext}`);
  return f;
}
function toDownloads(item, onDone) {
  const f = downloadPath(item.getFilename() || 'arquivo');
  item.setSavePath(f);
  item.once('done', (_, state) => { if (state === 'completed') onDone(f); });
}
function saveBuffer({ chat, name, buf, when, id }) {
  if (id) { if (savedIds.has(id)) return; savedIds.add(id); persistIds(); }
  try { const f = targetPath(chat, name, when ? new Date(when) : null); fs.writeFileSync(f, Buffer.from(buf)); saved(f); } catch (e) { console.warn('salvar arquivo:', e.message); }
}
ipcMain.handle('wv1:drive-set', (_, dir) => { driveDir = dir || detectDrive(); return { dir: driveDir, base: baseDir(), detected: !!driveDir }; });
ipcMain.handle('wv1:drive-pick', async () => { const r = await dialog.showOpenDialog(win, { title: 'Escolha a pasta do Google Drive', properties: ['openDirectory'] }); return r.canceled ? '' : r.filePaths[0]; });
ipcMain.handle('wv1:dl-get', () => ({ dir: dlCurrent(), custom: !!dlDir, def: dlDefault() }));
ipcMain.handle('wv1:dl-set', (_, dir) => {
  const d = String(dir || '').trim().replace(/^"(.*)"$/, '$1');
  if (d && !path.isAbsolute(d)) return { dir: dlCurrent(), custom: !!dlDir, def: dlDefault(), error: 'use o caminho completo, ex.: C:\\Users\\tiago\\Desktop\\Dowload whas app' };
  dlDir = d;
  try { fs.writeFileSync(dlFile(), JSON.stringify({ dir: dlDir })); } catch {}
  try { fs.mkdirSync(dlCurrent(), { recursive: true }); } catch (e) { return { dir: dlCurrent(), custom: !!dlDir, def: dlDefault(), error: e.message }; }
  return { dir: dlCurrent(), custom: !!dlDir, def: dlDefault() };
});
ipcMain.handle('wv1:dl-pick', async () => { const r = await dialog.showOpenDialog(win, { title: 'Escolha a pasta dos downloads', defaultPath: dlCurrent(), properties: ['openDirectory', 'createDirectory'] }); return r.canceled ? '' : r.filePaths[0]; });
ipcMain.handle('wv1:dl-open', () => { try { fs.mkdirSync(dlCurrent(), { recursive: true }); } catch {} shell.openPath(dlCurrent()); });
ipcMain.handle('wv1:drive-open', () => { fs.mkdirSync(baseDir(), { recursive: true }); shell.openPath(baseDir()); });
ipcMain.handle('wv1:save-file', (_, d) => { const m = /^data:([^;]+);base64,(.*)$/.exec(d.dataUrl || ''); if (m) saveBuffer({ chat: d.chat, name: d.name, buf: Buffer.from(m[2], 'base64') }); });
ipcMain.on('wa-chat', (_, name) => { if (name) currentChat = name; });
ipcMain.on('wa-media', (_, d) => saveBuffer(d));

// histórico no Drive: cada conversa lida vira <base>/Conversas/<nome>.md (um "## dia" por data, uma linha por mensagem)
// e os resumos escritos pela assistente vão para <base>/Resumos/AAAA-MM-DD.md. A assistente busca nesses arquivos.
const logDir = () => path.join(baseDir(), 'Conversas'), sumDir = () => path.join(baseDir(), 'Resumos');
const norm = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
function lastDayOf(f) { // último "## AAAA-MM-DD" do arquivo, lendo só o fim
  try { const fd = fs.openSync(f, 'r'), size = fs.fstatSync(fd).size, n = Math.min(size, 4000), b = Buffer.alloc(n); fs.readSync(fd, b, 0, n, size - n); fs.closeSync(fd); const m = b.toString('utf8').match(/^## (\d{4}-\d{2}-\d{2})/mg); return m ? m[m.length - 1].slice(3) : ''; } catch { return ''; }
}
ipcMain.handle('wv1:log-append', (_, { chat, lines }) => {
  try {
    fs.mkdirSync(logDir(), { recursive: true });
    const f = path.join(logDir(), clean(chat) + '.md'), exists = fs.existsSync(f);
    let day = exists ? lastDayOf(f) : '', out = exists ? '' : `# ${chat}\n`;
    for (const l of lines || []) {
      const d = String(l.when).slice(0, 10);
      if (d !== day) { out += `\n## ${d}\n`; day = d; }
      out += `- ${String(l.when).slice(11, 16)} ${l.who}: ${String(l.text).replace(/\s*\n\s*/g, ' / ')}\n`;
    }
    if (out) fs.appendFileSync(f, out);
  } catch (e) { console.warn('histórico:', e.message); }
});
ipcMain.handle('wv1:summary-append', (_, { date, text }) => {
  try { fs.mkdirSync(sumDir(), { recursive: true }); const f = path.join(sumDir(), date + '.md'); fs.appendFileSync(f, (fs.existsSync(f) ? '' : `# Resumo de ${date}\n`) + '\n' + text + '\n'); } catch (e) { console.warn('resumo:', e.message); }
});
ipcMain.handle('wv1:log-search', (_, { texto, conversa, limite }) => {
  const terms = norm(texto).split(/\s+/).filter(w => w.length > 2), cn = norm(conversa), hits = [];
  for (const [dir, kind] of [[logDir(), 'conversa'], [sumDir(), 'resumo']]) {
    let files = []; try { files = fs.readdirSync(dir).filter(x => x.endsWith('.md')).sort(); } catch { continue; }
    for (const file of files) {
      const name = file.slice(0, -3);
      if (cn && kind === 'conversa' && !norm(name).includes(cn)) continue;
      let day = kind === 'resumo' ? name : '';
      for (const line of fs.readFileSync(path.join(dir, file), 'utf8').split('\n')) {
        if (line.startsWith('## ')) { day = line.slice(3).trim(); continue; }
        if (kind === 'conversa' ? !line.startsWith('- ') : (!line.trim() || line.startsWith('# '))) continue;
        const n = norm(line), score = terms.filter(t => n.includes(t)).length;
        if (!terms.length || score) hits.push({ origem: kind === 'resumo' ? 'resumo do dia' : name + ' (WhatsApp)', data: day, texto: line.replace(/^(- |### )/, '').slice(0, 400), score });
      }
    }
  }
  hits.sort((a, b) => b.score - a.score || b.data.localeCompare(a.data));
  return hits.slice(0, limite || 40).map(({ score, ...h }) => h).sort((a, b) => a.data.localeCompare(b.data));
});
ipcMain.handle('wv1:doc-write', (_, { name, text, dir }) => { try { const d = dir ? path.join(baseDir(), clean(dir)) : baseDir(); fs.mkdirSync(d, { recursive: true }); const f = path.join(d, clean(name) + '.md'); fs.writeFileSync(f, String(text || '')); return { ok: true, file: f }; } catch (e) { return { error: e.message }; } });
ipcMain.handle('wv1:open-path', (_, f) => { const p = path.resolve(String(f || '')); if (!p.startsWith(path.dirname(baseDir())) && !p.startsWith(dlCurrent())) return { error: 'fora das pastas do app' }; shell.openPath(fs.existsSync(p) ? p : path.dirname(p)); return { ok: true }; });

// áudios do WhatsApp viram texto: serviço compatível com /audio/transcriptions (Groq ou OpenAI), com a chave do próprio usuário.
// O áudio fica guardado no Drive, na pasta da conversa, com a transcrição ao lado (.txt).
const STT = {
  groq: { url: 'https://api.groq.com/openai/v1/audio/transcriptions', model: 'whisper-large-v3-turbo' },
  openai: { url: 'https://api.openai.com/v1/audio/transcriptions', model: 'gpt-4o-mini-transcribe' }
};
const AUDIO_EXT = { 'audio/ogg': '.ogg', 'audio/opus': '.ogg', 'audio/mpeg': '.mp3', 'audio/mp3': '.mp3', 'audio/mp4': '.m4a', 'audio/x-m4a': '.m4a', 'audio/aac': '.m4a', 'audio/wav': '.wav', 'audio/x-wav': '.wav', 'audio/wave': '.wav', 'audio/webm': '.webm', 'audio/flac': '.flac', 'video/ogg': '.ogg' };
function multipart(fields, file) {
  const b = '----wv1' + crypto.randomBytes(12).toString('hex'), parts = [];
  for (const [k, v] of Object.entries(fields)) if (v !== undefined && v !== '') parts.push(Buffer.from(`--${b}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`));
  parts.push(Buffer.from(`--${b}\r\nContent-Disposition: form-data; name="file"; filename="${file.name}"\r\nContent-Type: ${file.type}\r\n\r\n`), file.data, Buffer.from(`\r\n--${b}--\r\n`));
  return { body: Buffer.concat(parts), type: 'multipart/form-data; boundary=' + b };
}
ipcMain.handle('wv1:stt', async (_, { provider, key, buf, file, type, chat, when, prompt, save }) => {
  try {
    const p = STT[provider] || STT.groq;
    if (!key) return { error: 'falta a chave do serviço de transcrição (Configurações)' };
    const data = buf ? Buffer.from(buf) : fs.readFileSync(file);
    if (!data.length) return { error: 'áudio vazio' };
    if (data.length > 25e6) return { error: 'áudio maior que 25 MB' };
    const mime = String(type || '').split(';')[0].trim().toLowerCase();
    let ext = file ? path.extname(file).toLowerCase() : (AUDIO_EXT[mime] || '.ogg');
    if (ext === '.opus') ext = '.ogg';
    let keep = '';
    if (buf && save !== false) { try { keep = targetPath(chat, 'áudio' + ext, when ? new Date(when) : null); fs.writeFileSync(keep, data); } catch (e) { console.warn('áudio no Drive:', e.message); keep = ''; } }
    const EXT_MIME = { '.ogg': 'audio/ogg', '.mp3': 'audio/mpeg', '.mpga': 'audio/mpeg', '.m4a': 'audio/mp4', '.wav': 'audio/wav', '.flac': 'audio/flac', '.webm': 'audio/webm' };
    const mp = multipart({ model: p.model, language: 'pt', prompt: String(prompt || '').slice(0, 800), response_format: 'json', temperature: '0' }, { name: 'audio' + ext, type: mime || EXT_MIME[ext] || 'application/octet-stream', data });
    const r = await net.fetch(p.url, { method: 'POST', headers: { authorization: 'Bearer ' + key, 'content-type': mp.type }, body: mp.body });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) return { error: (d.error && (d.error.message || d.error)) || ('HTTP ' + r.status), status: r.status };
    const text = String(d.text || '').trim();
    if (keep) { try { fs.writeFileSync(keep.slice(0, -ext.length) + '.txt', text + '\n'); } catch {} }
    return { text, file: keep };
  } catch (e) { return { error: e.message }; }
});
ipcMain.handle('wv1:notes-save', (_, { text }) => { try { fs.mkdirSync(baseDir(), { recursive: true }); fs.writeFileSync(path.join(baseDir(), 'Notas.md'), '# Notas importantes\n\n' + String(text || '') + '\n'); } catch (e) { console.warn('notas:', e.message); } });
ipcMain.handle('wv1:summary-recent', (_, { dias, max }) => { // últimos dias de resumos, para a assistente já saber sem procurar
  try {
    const files = fs.readdirSync(sumDir()).filter(x => /^\d{4}-\d{2}-\d{2}\.md$/.test(x)).sort().slice(-(dias || 3));
    let out = files.map(f => fs.readFileSync(path.join(sumDir(), f), 'utf8').trim()).join('\n\n');
    if (out.length > (max || 3500)) out = '…' + out.slice(-(max || 3500));
    return out;
  } catch { return ''; }
});
ipcMain.handle('wv1:log-read', (_, { conversa, linhas }) => {
  try {
    const files = fs.readdirSync(logDir()).filter(x => x.endsWith('.md')), q = norm(conversa);
    const f = files.find(x => norm(x.slice(0, -3)) === q) || files.find(x => norm(x.slice(0, -3)).includes(q));
    if (!f) return { erro: 'conversa não encontrada no histórico', conversas_disponiveis: files.map(x => x.slice(0, -3)).slice(0, 80) };
    const ls = fs.readFileSync(path.join(logDir(), f), 'utf8').split('\n').filter(Boolean);
    return { conversa: f.slice(0, -3), linhas: ls.slice(-(linhas || 60)) };
  } catch { return { erro: 'ainda não há histórico gravado' }; }
});

// Google Agenda: OAuth "app para computador" criado pelo próprio usuário (ID e segredo colados em Configurações).
// Autoriza no navegador, recebe o código numa porta local e guarda o refresh token em userData/google.json.
const gFile = () => path.join(app.getPath('userData'), 'google.json');
let gTok = null;
function gLoad() { try { gTok = JSON.parse(fs.readFileSync(gFile(), 'utf8')); } catch { gTok = null; } }
function gSave() { try { fs.writeFileSync(gFile(), JSON.stringify(gTok)); } catch {} }
function gForget() { gTok = null; try { fs.unlinkSync(gFile()); } catch {} }
const G_SCOPES = 'https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.readonly email';
const form = o => new URLSearchParams(o).toString();
ipcMain.handle('wv1:gcal-status', () => { if (!gTok) gLoad(); return { connected: !!(gTok && gTok.refresh_token), email: (gTok && gTok.email) || '' }; });
ipcMain.handle('wv1:gcal-disconnect', () => { gForget(); return { ok: true }; });
ipcMain.handle('wv1:gcal-connect', (_, { clientId, clientSecret }) => new Promise(resolve => {
  if (!clientId || !clientSecret) return resolve({ error: 'cole o ID e o segredo do cliente' });
  const verifier = crypto.randomBytes(32).toString('base64url'), challenge = crypto.createHash('sha256').update(verifier).digest('base64url'), state = crypto.randomBytes(8).toString('hex');
  let done = false; const finish = r => { if (!done) { done = true; resolve(r); try { srv.close(); } catch {} } };
  const page = (res, m) => { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(`<html><body style="font-family:sans-serif;padding:40px"><h2>${m}</h2>Pode fechar esta aba e voltar ao WhatsApp v1.</body></html>`); };
  const srv = http.createServer(async (req, res) => {
    const u = new URL(req.url, 'http://127.0.0.1');
    if (u.pathname !== '/') { res.writeHead(404); return res.end(); }
    const code = u.searchParams.get('code'), err = u.searchParams.get('error');
    if (err || !code || u.searchParams.get('state') !== state) { page(res, 'Não conectou: ' + (err || 'resposta inválida')); return finish({ error: err || 'resposta inválida' }); }
    try {
      const redirect = `http://127.0.0.1:${srv.address().port}`;
      const r = await net.fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: form({ code, client_id: clientId, client_secret: clientSecret, redirect_uri: redirect, grant_type: 'authorization_code', code_verifier: verifier }) });
      const t = await r.json();
      if (!r.ok || !t.refresh_token) throw new Error(t.error_description || t.error || 'o Google não devolveu o acesso permanente; em myaccount.google.com/permissions remova o app e tente de novo');
      gTok = { clientId, clientSecret, refresh_token: t.refresh_token, access_token: t.access_token, exp: Date.now() + ((t.expires_in || 3600) - 60) * 1000, email: '' };
      try { const me = await (await net.fetch('https://www.googleapis.com/oauth2/v3/userinfo', { headers: { authorization: 'Bearer ' + t.access_token } })).json(); gTok.email = me.email || ''; } catch {}
      gSave(); page(res, 'Google Agenda conectada ✓'); finish({ ok: true, email: gTok.email });
    } catch (e) { page(res, 'Não conectou: ' + e.message); finish({ error: e.message }); }
    show();
  });
  srv.listen(0, '127.0.0.1', () => {
    const url = 'https://accounts.google.com/o/oauth2/v2/auth?' + form({ client_id: clientId, redirect_uri: `http://127.0.0.1:${srv.address().port}`, response_type: 'code', scope: G_SCOPES, access_type: 'offline', prompt: 'consent', code_challenge: challenge, code_challenge_method: 'S256', state });
    shell.openExternal(url);
  });
  setTimeout(() => finish({ error: 'tempo esgotado (5 min)' }), 5 * 60e3);
}));
async function gToken() {
  if (!gTok) gLoad();
  if (!gTok || !gTok.refresh_token) throw new Error('Google Agenda não conectada');
  if (gTok.access_token && gTok.exp > Date.now()) return gTok.access_token;
  const r = await net.fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: form({ client_id: gTok.clientId, client_secret: gTok.clientSecret, refresh_token: gTok.refresh_token, grant_type: 'refresh_token' }) });
  const t = await r.json();
  if (!r.ok) { if (t.error === 'invalid_grant') gForget(); throw new Error(t.error_description || t.error || 'falha ao renovar o acesso'); }
  gTok.access_token = t.access_token; gTok.exp = Date.now() + ((t.expires_in || 3600) - 60) * 1000; gSave();
  return gTok.access_token;
}
ipcMain.handle('wv1:gcal', async (_, { method, path: p, query, body }) => {
  try {
    const tok = await gToken();
    const r = await net.fetch('https://www.googleapis.com/calendar/v3' + p + (query ? '?' + form(query) : ''), { method: method || 'GET', headers: { authorization: 'Bearer ' + tok, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    if (r.status === 204) return { ok: true };
    const d = await r.json().catch(() => ({}));
    if (!r.ok) return { error: (d.error && d.error.message) || ('HTTP ' + r.status), status: r.status };
    return d;
  } catch (e) { return { error: e.message }; }
});

// atualização: a interface (pasta app/) é baixada do GitHub para a pasta do usuário, sem reinstalar
const UPDATE_BASE = process.env.WV1_UPDATE_BASE || 'https://raw.githubusercontent.com/tiagoabepplercivil-ai/whatsapp-v1/main/';
const BUNDLED = path.join(__dirname, 'app');
const uiDir = () => path.join(app.getPath('userData'), 'ui');
const cmp = (a, b) => { const x = String(a).split('.').map(Number), y = String(b).split('.').map(Number); for (let i = 0; i < 3; i++) { if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) - (y[i] || 0); } return 0; };
const verOf = dir => { try { return JSON.parse(fs.readFileSync(path.join(dir, 'version.json'), 'utf8')).ui || '0'; } catch { return '0'; } };
// ícones da janela e da bandeja vêm da interface ativa: um ícone novo pode chegar pelo ⟳, sem instalador
const iconPath = f => { for (const d of [activeRoot(), BUNDLED]) { const p = path.join(d, 'icons', f); if (fs.existsSync(p)) return p; } return path.join(__dirname, 'app/icons', f); };
function activeRoot() { const d = uiDir(); return fs.existsSync(path.join(d, 'index.html')) && cmp(verOf(d), verOf(BUNDLED)) > 0 ? d : BUNDLED; }
// o leitor do WhatsApp (app/wa-reader.js) é entregue ao preload do webview a partir da pasta ativa, então o ⟳ também o atualiza
ipcMain.on('wv1:reader-src', e => { let src = ''; for (const d of [activeRoot(), BUNDLED]) { try { src = fs.readFileSync(path.join(d, 'wa-reader.js'), 'utf8'); break; } catch {} } e.returnValue = src; });
async function fetchJson(url) { const r = await net.fetch(url + '?t=' + Date.now(), { cache: 'no-store' }); if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); }
ipcMain.handle('wv1:update-check', async () => {
  const current = verOf(activeRoot());
  try {
    const v = await fetchJson(UPDATE_BASE + 'version.json');
    const desktopNeeded = cmp(v.desktop || '0', app.getVersion()) > 0;
    return { current, latest: desktopNeeded ? v.desktop : v.ui, notes: v.notes || '', available: cmp(v.ui, current) > 0 || desktopNeeded, desktopNeeded };
  } catch (e) { return { current, error: e.message }; }
});
ipcMain.handle('wv1:update-apply', async () => {
  try {
    const v = await fetchJson(UPDATE_BASE + 'version.json');
    if (cmp(v.desktop || '0', app.getVersion()) > 0) return { error: 'esta versão precisa do instalador (baixado automaticamente)', desktopNeeded: true };
    const tmp = uiDir() + '.new'; fs.rmSync(tmp, { recursive: true, force: true });
    for (const f of [...(v.files || []), 'version.json']) {
      const r = await net.fetch(UPDATE_BASE + 'app/' + f + '?t=' + Date.now(), { cache: 'no-store' });
      if (!r.ok) throw new Error(f + ': HTTP ' + r.status);
      const out = path.join(tmp, f); fs.mkdirSync(path.dirname(out), { recursive: true });
      fs.writeFileSync(out, Buffer.from(await r.arrayBuffer()));
    }
    if (!fs.existsSync(path.join(tmp, 'index.html'))) throw new Error('pacote incompleto');
    fs.rmSync(uiDir(), { recursive: true, force: true }); fs.renameSync(tmp, uiDir());
    win.webContents.reloadIgnoringCache();
    return { ok: true };
  } catch (e) { return { error: e.message }; }
});
// instalador novo: baixa em segundo plano para a pasta temporária (confere o sha256) e instala em silêncio quando a interface mandar
let dlState = { status: 'idle' };
const sha256File = f => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
ipcMain.handle('wv1:update-download', async () => {
  if (dlState.status === 'downloading') return dlState;
  try {
    const v = await fetchJson(UPDATE_BASE + 'version.json');
    if (cmp(v.desktop || '0', app.getVersion()) <= 0) return (dlState = { status: 'idle' });
    if (!v.installerUrl) throw new Error('version.json sem installerUrl');
    const dir = path.join(app.getPath('temp'), 'whatsapp-v1-update'); fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `WhatsApp-v1-${v.desktop}.exe`);
    if (fs.existsSync(file) && (!v.sha256 || sha256File(file) === v.sha256)) return (dlState = { status: 'ready', file, version: v.desktop, notes: v.notes || '' });
    dlState = { status: 'downloading', version: v.desktop, pct: 0 };
    const r = await net.fetch(v.installerUrl + (v.installerUrl.includes('?') ? '&' : '?') + 't=' + Date.now(), { cache: 'no-store' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const total = +r.headers.get('content-length') || 0; let got = 0, lastPct = -1;
    const tmp = file + '.part', out = fs.createWriteStream(tmp);
    for await (const chunk of r.body) {
      if (!out.write(Buffer.from(chunk))) await new Promise(res => out.once('drain', res));
      got += chunk.length;
      if (total) { dlState.pct = Math.round(got * 100 / total); if (dlState.pct !== lastPct) { lastPct = dlState.pct; win && win.webContents.send('wv1:update-progress', dlState); } }
    }
    await new Promise((res, rej) => out.end(e => e ? rej(e) : res()));
    if (v.sha256 && sha256File(tmp) !== v.sha256) { fs.rmSync(tmp, { force: true }); throw new Error('o arquivo baixado não confere (sha256)'); }
    fs.renameSync(tmp, file);
    for (const f of fs.readdirSync(dir)) if (f !== path.basename(file)) fs.rmSync(path.join(dir, f), { force: true });
    dlState = { status: 'ready', file, version: v.desktop, notes: v.notes || '' };
  } catch (e) { dlState = { status: 'error', error: e.message }; }
  win && win.webContents.send('wv1:update-progress', dlState);
  return dlState;
});
ipcMain.handle('wv1:update-install', () => {
  if (dlState.status !== 'ready') return { error: 'o instalador ainda não foi baixado' };
  try {
    const child = spawn(dlState.file, ['--updated', '/S', '--force-run'], { detached: true, stdio: 'ignore', windowsHide: true });
    child.on('error', e => { dlState = { status: 'error', error: e.message }; win && win.webContents.send('wv1:update-progress', dlState); });
    child.unref();
    setTimeout(() => { if (dlState.status === 'ready') { quitting = true; app.quit(); } }, 1500);
    return { ok: true };
  } catch (e) { return { error: e.message }; }
});
if (!app.requestSingleInstanceLock()) app.quit();
app.on('second-instance', () => show());
app.setAppUserModelId('br.tiago.whatsappv1');

function show() { if (!win) return; if (win.isMinimized()) win.restore(); win.show(); win.focus(); }
const toAssistant = data => win && win.webContents.send('wv1:to-assistant', data);

function createWindow() {
  win = new BrowserWindow({
    width: 1400, height: 880, minWidth: 420, minHeight: 560,
    title: 'WhatsApp', icon: iconPath('icon-512.png'),
    backgroundColor: '#f0f2f5', autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, backgroundThrottling: false, webviewTag: true, spellcheck: true, preload: path.join(__dirname, 'preload.js') }
  });
  win.loadURL('app://local/index.html');
  win.on('page-title-updated', e => e.preventDefault());
  win.on('focus', () => win.flashFrame(false));
  win.on('close', e => { if (!quitting) { e.preventDefault(); win.hide(); } });
}

// WhatsApp Web (webview): links fora, menu do botão direito com "Enviar para a assistente", contador de não lidas
app.on('web-contents-created', (_, wc) => {
  wc.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
  wc.on('will-attach-webview', (_, wp) => { wp.preload = path.join(__dirname, 'wa-preload.js'); wp.contextIsolation = true; wp.nodeIntegration = false; wp.backgroundThrottling = false; });
  if (wc.getType() !== 'webview') return;
  wc.on('will-navigate', (e, url) => { if (!/^https:\/\/web\.whatsapp\.com\//.test(url)) { e.preventDefault(); shell.openExternal(url); } });
  wc.on('page-title-updated', (_, title) => {
    const n = +((title.match(/\((\d+)\)/) || [])[1] || 0);
    if (n > lastUnread && win && !win.isFocused()) win.flashFrame(true);
    lastUnread = n;
    win && win.webContents.send('wv1:wa-unread', n);
    tray && tray.setToolTip(n ? `WhatsApp — ${n} não lida(s)` : 'WhatsApp');
  });
  wc.on('context-menu', (_, p) => {
    const items = [];
    if (p.selectionText && p.selectionText.trim()) items.push({ label: '📌 Enviar para a assistente', click: () => toAssistant({ text: p.selectionText }) });
    if (p.mediaType === 'image') items.push({ label: '📌 Enviar foto para a assistente', click: () => { wc.copyImageAt(p.x, p.y); setTimeout(() => { const im = clipboard.readImage(); if (!im.isEmpty()) toAssistant({ img: im.toDataURL(), text: p.selectionText || '' }); }, 300); } });
    if (items.length) items.push({ type: 'separator' });
    for (const s of p.dictionarySuggestions || []) items.push({ label: s, click: () => wc.replaceMisspelling(s) });
    if (p.isEditable) items.push({ role: 'cut', label: 'Recortar' }, { role: 'copy', label: 'Copiar' }, { role: 'paste', label: 'Colar' }, { role: 'selectAll', label: 'Selecionar tudo' });
    else if (p.selectionText) items.push({ role: 'copy', label: 'Copiar' });
    if (p.mediaType === 'image') items.push({ label: 'Copiar imagem', click: () => wc.copyImageAt(p.x, p.y) });
    if (items.length) Menu.buildFromTemplate(items).popup();
  });
});

app.whenReady().then(() => {
  loadIds(); loadDl();
  protocol.handle('app', req => {
    const root = activeRoot();
    const p = path.normalize(path.join(root, decodeURIComponent(new URL(req.url).pathname)));
    if (!p.startsWith(root)) return new Response('not found', { status: 404 });
    return net.fetch(pathToFileURL(p).toString());
  });
  const waSes = session.fromPartition('persist:whatsapp');
  const ok = ['notifications', 'media', 'clipboard-read', 'clipboard-sanitized-write', 'fullscreen', 'mediaKeySystem'];
  waSes.setPermissionRequestHandler((_, perm, cb) => cb(ok.includes(perm)));
  waSes.setSpellCheckerLanguages(['pt-BR']);
  // o que você baixa no WhatsApp vai para a pasta dos downloads (Dowload whas app); o app guarda uma cópia no Drive, por conversa
  waSes.on('will-download', (_, item) => toDownloads(item, f => {
    let copy = '';
    try { copy = targetPath(currentChat, path.basename(f)); fs.copyFileSync(f, copy); } catch (e) { console.warn('cópia no Drive:', e.message); }
    saved(copy || f, { downloads: f, name: path.basename(f), chat: currentChat });
  }));
  // backup e .ics do próprio app vão para a mesma pasta
  session.defaultSession.on('will-download', (_, item) => toDownloads(item, f => saved(f, { downloads: f, name: path.basename(f), appFile: true })));
  createWindow();
  tray = new Tray(nativeImage.createFromPath(iconPath('tray.png')));
  tray.setToolTip('WhatsApp');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Abrir', click: show },
    { label: 'Iniciar com o Windows', type: 'checkbox', checked: app.getLoginItemSettings().openAtLogin,
      click: i => app.setLoginItemSettings({ openAtLogin: i.checked, args: ['--hidden'] }) },
    { type: 'separator' },
    { label: 'Sair', click: () => { quitting = true; app.quit(); } }
  ]));
  tray.on('click', show);
  if (process.argv.includes('--hidden')) win.hide();
});
app.on('before-quit', () => { quitting = true; });
