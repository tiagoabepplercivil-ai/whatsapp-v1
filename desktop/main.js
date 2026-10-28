// WhatsApp v1 — app de computador (Windows): WhatsApp Web real + assistente, agenda e lembretes ao lado.
// Fecha para a bandeja para os lembretes continuarem tocando.
const { app, BrowserWindow, Tray, Menu, shell, protocol, net, nativeImage, session, clipboard, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');

protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } }]);

let win, tray, quitting = false, lastUnread = 0;

// atualização: a interface (pasta app/) é baixada do GitHub para a pasta do usuário, sem reinstalar
const UPDATE_BASE = process.env.WV1_UPDATE_BASE || 'https://raw.githubusercontent.com/tiagoabepplercivil-ai/whatsapp-v1/main/';
const BUNDLED = path.join(__dirname, 'app');
const uiDir = () => path.join(app.getPath('userData'), 'ui');
const cmp = (a, b) => { const x = String(a).split('.').map(Number), y = String(b).split('.').map(Number); for (let i = 0; i < 3; i++) { if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) - (y[i] || 0); } return 0; };
const verOf = dir => { try { return JSON.parse(fs.readFileSync(path.join(dir, 'version.json'), 'utf8')).ui || '0'; } catch { return '0'; } };
function activeRoot() { const d = uiDir(); return fs.existsSync(path.join(d, 'index.html')) && cmp(verOf(d), verOf(BUNDLED)) > 0 ? d : BUNDLED; }
async function fetchJson(url) { const r = await net.fetch(url + '?t=' + Date.now(), { cache: 'no-store' }); if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); }
ipcMain.handle('wv1:update-check', async () => {
  const current = verOf(activeRoot());
  try {
    const v = await fetchJson(UPDATE_BASE + 'version.json');
    return { current, latest: v.ui, notes: v.notes || '', available: cmp(v.ui, current) > 0, desktopNeeded: cmp(v.desktop || '0', app.getVersion()) > 0 };
  } catch (e) { return { current, error: e.message }; }
});
ipcMain.handle('wv1:update-apply', async () => {
  try {
    const v = await fetchJson(UPDATE_BASE + 'version.json');
    if (cmp(v.desktop || '0', app.getVersion()) > 0) { shell.openExternal(v.installer || 'https://github.com/tiagoabepplercivil-ai/whatsapp-v1/releases/latest'); return { ok: true }; }
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
if (!app.requestSingleInstanceLock()) app.quit();
app.on('second-instance', () => show());
app.setAppUserModelId('br.tiago.whatsappv1');

function show() { if (!win) return; if (win.isMinimized()) win.restore(); win.show(); win.focus(); }
const toAssistant = data => win && win.webContents.send('wv1:to-assistant', data);

function createWindow() {
  win = new BrowserWindow({
    width: 1400, height: 880, minWidth: 420, minHeight: 560,
    title: 'WhatsApp', icon: path.join(__dirname, 'app/icons/icon-512.png'),
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
  wc.on('will-attach-webview', (_, wp) => { wp.preload = path.join(__dirname, 'wa-preload.js'); wp.contextIsolation = true; wp.nodeIntegration = false; });
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
  createWindow();
  tray = new Tray(nativeImage.createFromPath(path.join(__dirname, 'app/icons/tray.png')));
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
