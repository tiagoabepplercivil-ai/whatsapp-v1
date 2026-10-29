// Leitor do WhatsApp Web. Roda dentro da página do WhatsApp (mundo isolado) e recebe `ipcRenderer` do
// carregador wa-preload.js. Lê o DOM da conversa aberta, as prévias das não lidas e as fotos; na
// "varredura" abre cada conversa (clique na lista) para ler o que chegou. Nada é enviado nem digitado.
// Este arquivo vem na pasta app/ e é trocado pelo ⟳ do app sem reinstalar.
// Áudios: um captador instalado no mundo da página (via webFrame) entrega o arquivo do áudio quando ele toca.
const sent = new Set();
const $ = (s, r) => (r || document).querySelector(s);
const $$ = (s, r) => [...(r || document).querySelectorAll(s)];
const sleep = ms => new Promise(r => setTimeout(r, ms));
const UNREAD_SEL = '[aria-label*="não lida"], [aria-label*="Não lida"], [aria-label*="unread"]';

function chatName() {
  const h = $('#main header');
  if (!h) return '';
  const s = h.querySelector('span[dir="auto"]');
  return s ? s.textContent.trim() : '';
}

function scanOpenChat() {
  const main = $('#main');
  if (!main) return null;
  const msgs = [];
  main.querySelectorAll('div[data-id]').forEach(row => {
    const id = row.getAttribute('data-id');
    if (!id || sent.has(id)) return;
    const cp = row.querySelector('.copyable-text[data-pre-plain-text]');
    if (!cp) return;
    const el = cp.querySelector('.selectable-text') || cp;
    const text = (el.innerText || '').trim();
    if (!text) return;
    sent.add(id);
    msgs.push({ id, meta: cp.getAttribute('data-pre-plain-text') || '', text, out: id.startsWith('true_') });
  });
  return msgs.length ? { chat: chatName(), msgs } : null;
}

// linhas da lista de conversas (a lista é virtual: só as visíveis existem no DOM)
function listRows() {
  const side = $('#pane-side');
  if (!side) return [];
  let rows = $$('[role="listitem"]', side);
  if (!rows.length) rows = $$('[role="row"]', side);
  const seen = new Set(), out = [];
  for (const row of rows) {
    const titles = $$('span[title]', row).map(s => s.getAttribute('title')).filter(Boolean);
    if (!titles.length || seen.has(titles[0])) continue;
    seen.add(titles[0]);
    const badge = row.querySelector(UNREAD_SEL);
    const unread = badge ? (parseInt(badge.getAttribute('aria-label') || '', 10) || 1) : 0;
    out.push({ row, name: titles[0], preview: titles.length > 1 ? titles[titles.length - 1] : '', unread });
  }
  return out;
}

function scanUnreadPreviews() {
  const out = [];
  for (const r of listRows()) {
    if (!r.unread || !r.preview || r.preview === r.name) continue;
    const id = 'p:' + r.name + '|' + r.preview;
    if (sent.has(id)) continue;
    sent.add(id);
    out.push({ chat: r.name, msgs: [{ id, meta: '', text: r.preview, out: false }] });
  }
  return out;
}

// fotos da conversa aberta: salva a imagem exibida (vai para a pasta do Drive, por conversa)
const mediaDone = new Set();
let lastChat = '';
async function scanMedia() {
  const main = $('#main');
  if (!main) return;
  const chat = chatName();
  if (chat && chat !== lastChat) { lastChat = chat; ipcRenderer.send('wa-chat', chat); }
  for (const row of main.querySelectorAll('div[data-id]')) {
    const id = row.getAttribute('data-id');
    if (!id || mediaDone.has(id)) continue;
    const img = [...row.querySelectorAll('img[src^="blob:"]')].find(i => i.naturalWidth >= 240 || i.naturalHeight >= 240);
    if (!img) continue;
    mediaDone.add(id);
    try {
      const b = await (await fetch(img.src)).blob();
      if (!/^image\/(jpeg|png)/.test(b.type)) continue; // figurinhas (webp) ficam de fora
      const meta = (row.querySelector('[data-pre-plain-text]') || {}).getAttribute?.('data-pre-plain-text') || '';
      const m = meta.match(/\[(\d{1,2}):(\d{2}),\s*(\d{1,2})\/(\d{1,2})\/(\d{4})\]/);
      const when = m ? new Date(+m[5], +m[4] - 1, +m[3], +m[1], +m[2]).toISOString() : null;
      const ext = b.type === 'image/png' ? '.png' : '.jpg';
      ipcRenderer.send('wa-media', { id, chat, when, name: 'foto' + ext, buf: new Uint8Array(await b.arrayBuffer()) });
    } catch (e) { /* imagem ainda carregando: tenta na próxima */ mediaDone.delete(id); }
  }
}

// ---------- varredura: abre cada conversa para ler ----------
// Só roda quando você não está mexendo no WhatsApp (90 s sem clique/tecla) ou quando o app pede com force
// (painel escondido). Se você tocar em qualquer coisa no meio, para e volta para a conversa que estava aberta.
let lastInput = 0;
['mousedown', 'keydown', 'wheel', 'touchstart', 'pointerdown'].forEach(ev => document.addEventListener(ev, e => { if (e.isTrusted) lastInput = Date.now(); }, true)); // só evento real do usuário (os cliques da varredura são sintéticos)
const idle = () => Date.now() - lastInput > 90e3;
let sweeping = false, cancel = false;
const report = o => { try { ipcRenderer.sendToHost('wa-sweep', o); } catch {} };

function fire(el) { for (const t of ['mousedown', 'mouseup', 'click']) el.dispatchEvent(new MouseEvent(t, { bubbles: true, cancelable: true, view: window })); }
const findRow = name => listRows().find(r => r.name === name);
async function openChat(name) {
  if (chatName() === name) return true;
  const r = findRow(name);
  if (!r) return false;
  fire(r.row.querySelector('span[title]') || r.row);
  for (let i = 0; i < 25; i++) { await sleep(160); if (chatName() === name) return true; }
  return false;
}
function msgPane() {
  const main = $('#main');
  return main && $$('div', main).find(d => d.scrollHeight > d.clientHeight + 40 && /auto|scroll/.test(getComputedStyle(d).overflowY)) || null;
}
async function readOpen(unread) {
  await sleep(900);
  const batches = [];
  const a = scanOpenChat(); if (a) batches.push(a);
  if (unread > 8) { // muitas mensagens novas: sobe um pouco para pegar as que ficaram fora da tela
    const p = msgPane();
    if (p) { p.scrollTop = Math.max(0, p.scrollTop - 1500); await sleep(700); const b = scanOpenChat(); if (b) batches.push(b); }
  }
  if (batches.length) ipcRenderer.sendToHost('wa-msgs', batches);
  const au = scanAudios(); if (au) ipcRenderer.sendToHost('wa-audio-seen', au);
  await scanMedia();
}

async function sweep(o) {
  if (sweeping) return;
  const pane = $('#pane-side');
  if (!pane || !$('#main, #pane-side [role="listitem"], #pane-side [role="row"]')) { report({ state: 'skip', reason: 'carregando' }); return; }
  if (!o.force && !idle()) { report({ state: 'skip', reason: 'em uso', full: !!o.full }); return; }
  sweeping = true; cancel = false;
  const start = Date.now(), max = o.full ? 60 : 30;
  const abort = () => cancel || lastInput > start;
  const orig = chatName(), origTop = pane.scrollTop;
  const done = new Set(); let opened = 0, aborted = false;
  report({ state: 'start', full: !!o.full });
  try {
    pane.scrollTop = 0; await sleep(300);
    for (let step = 0; step < 80 && opened < max; step++) {
      for (const r of listRows()) {
        if (done.has(r.name) || (!o.full && !r.unread)) continue;
        done.add(r.name);
        if (abort()) break;
        if (await openChat(r.name)) { opened++; await readOpen(r.unread); }
        if (opened >= max) break;
      }
      if (abort()) { aborted = true; break; }
      const before = pane.scrollTop;
      pane.scrollTop = before + pane.clientHeight * 0.8; await sleep(450);
      if (pane.scrollTop === before) break; // fim da lista
    }
  } catch (e) { /* o WhatsApp mudou algo no meio: encerra e tenta na próxima */ }
  // volta para onde estava
  try {
    if (orig && chatName() !== orig) {
      pane.scrollTop = 0; await sleep(250);
      for (let i = 0; i < 12 && !(await openChat(orig)); i++) { const b = pane.scrollTop; pane.scrollTop = b + pane.clientHeight * 0.8; await sleep(350); if (pane.scrollTop === b) break; }
    }
    pane.scrollTop = origTop;
  } catch {}
  sweeping = false;
  report({ state: 'end', opened, full: !!o.full, aborted, ms: Date.now() - start });
}

ipcRenderer.on('wa-sweep', (_, o) => { o = o || {}; if (o.cancel) { cancel = true; return; } sweep(o); });

// ---------- envio: abre a conversa, digita e envia (só roda quando o usuário aprovou um plano no app) ----------
const normTxt = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
async function findAndOpen(name) {
  const want = normTxt(name);
  if (!want) return false;
  if (normTxt(chatName()) === want) return true;
  const pane = $('#pane-side'); if (!pane) return false;
  const match = () => listRows().find(r => normTxt(r.name) === want) || listRows().find(r => normTxt(r.name).includes(want));
  const origTop = pane.scrollTop;
  let r = match();
  if (!r) { pane.scrollTop = 0; await sleep(250); for (let i = 0; i < 40 && !(r = match()); i++) { const b = pane.scrollTop; pane.scrollTop = b + pane.clientHeight * 0.8; await sleep(300); if (pane.scrollTop === b) break; } }
  if (!r) { pane.scrollTop = origTop; return false; }
  return openChat(r.name);
}
const composer = () => $('#main footer div[contenteditable="true"]') || $('#main [role="textbox"][contenteditable="true"]');
async function typeInto(box, text) {
  box.focus();
  document.execCommand('selectAll', false, null); document.execCommand('delete', false, null);
  document.execCommand('insertText', false, text);
  await sleep(250);
  if (normTxt(box.innerText) === normTxt(text)) return true;
  box.focus(); const dt = new DataTransfer(); dt.setData('text/plain', text); // o editor não aceitou: tenta como colagem
  box.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  await sleep(400);
  return normTxt(box.innerText) === normTxt(text);
}
async function sendTo(chat, text) {
  if (sweeping) { cancel = true; for (let i = 0; i < 40 && sweeping; i++) await sleep(250); }
  if (!(await findAndOpen(chat))) return { ok: false, erro: 'não achei a conversa "' + chat + '" na lista do WhatsApp' };
  await sleep(500);
  const box = composer(); if (!box) return { ok: false, erro: 'caixa de mensagem não encontrada' };
  if (!(await typeInto(box, text))) return { ok: false, erro: 'não consegui digitar na caixa de mensagem' };
  const btn = $('#main footer button[aria-label="Enviar"], #main footer [data-icon="send"], #main footer button[aria-label="Send"]');
  if (btn) (btn.closest('button') || btn).click();
  else box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
  for (let i = 0; i < 40; i++) { // confirma: a mensagem aparece como enviada e a caixa esvaziou
    await sleep(250);
    const rows = $$('#main div[data-id^="true_"]'), last = rows[rows.length - 1];
    const t = last ? ((last.querySelector('.selectable-text') || last).innerText || '') : '';
    const b = composer();
    if (normTxt(t) === normTxt(text) && !(b && normTxt(b.innerText))) return { ok: true, conversa: chatName() };
  }
  return { ok: false, erro: 'não confirmei o envio; confira na conversa ' + chatName() };
}
ipcRenderer.on('wa-send', async (_, o) => { o = o || {}; let r; try { r = await sendTo(o.chat, o.text); } catch (e) { r = { ok: false, erro: e.message }; } ipcRenderer.sendToHost('wa-sent', { id: o.id, ...r }); });

// ---------- áudios ----------
// O WhatsApp toca o áudio no mundo da página. O captador abaixo roda lá (webFrame.executeJavaScript, que passa pela CSP):
// guarda os blobs de áudio criados e, quando um <audio> começa a tocar, manda o arquivo para cá por postMessage.
// Passivo: você toca o áudio e ele vira texto. Sob pedido (botão Transcrever ou modo automático): abre a conversa,
// toca sem som e pausa em seguida. Tocar marca o áudio como ouvido para quem mandou, por isso só acontece com o seu ok.
const PAGE_HOOK = `(() => {
  if (window.__wv1page) return; window.__wv1page = 1;
  const blobs = new Map(), isAud = b => b instanceof Blob && /^(audio|video[/]ogg)/.test(b.type || '');
  const C = URL.createObjectURL, R = URL.revokeObjectURL;
  URL.createObjectURL = function (o) { const u = C.apply(URL, arguments); try { if (isAud(o)) { blobs.set(u, o); if (blobs.size > 40) blobs.delete(blobs.keys().next().value); } } catch (e) {} return u; };
  URL.revokeObjectURL = function (u) { if (blobs.has(u)) { setTimeout(() => { blobs.delete(u); R.call(URL, u); }, 120000); return; } return R.apply(URL, arguments); };
  let capUntil = 0; const done = new WeakMap();
  async function grab(el, cap) {
    for (let i = 0; i < 40 && !String(el.currentSrc || el.src || '').startsWith('blob:'); i++) await new Promise(r => setTimeout(r, 100));
    const src = String(el.currentSrc || el.src || '');
    if (!src.startsWith('blob:') || done.get(el) === src) return;
    done.set(el, src);
    let b = blobs.get(src);
    if (!b) { try { b = await (await fetch(src)).blob(); } catch (e) { return; } }
    if (!b || !b.size) return;
    window.postMessage({ __wv1: 'audio', blob: b, src, type: b.type || 'audio/ogg', dur: isFinite(el.duration) ? el.duration : 0, cap }, '*');
  }
  const P = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function () {
    const el = this, cap = capUntil > Date.now();
    if (cap) {
      capUntil = 0; const was = el.muted; el.muted = true;
      setTimeout(() => { try { el.pause(); el.currentTime = 0; } catch (e) {} setTimeout(() => { try { el.muted = was; } catch (e) {} }, 300); }, 700);
    }
    try { return P.apply(this, arguments); } finally { grab(el, cap).catch(() => {}); }
  };
  window.addEventListener('message', e => { if (e.source === window && e.data && e.data.__wv1 === 'capture') capUntil = Date.now() + (e.data.ms || 12000); });
})();`;
function hookPage() { try { if (typeof webFrame !== 'undefined' && webFrame && webFrame.executeJavaScript) webFrame.executeJavaScript(PAGE_HOOK).catch(() => {}); } catch {} }
hookPage(); document.addEventListener('DOMContentLoaded', hookPage);

let audioOn = false, lastRow = null, lastRowAt = 0;
const capWait = [], audSent = new Set();
document.addEventListener('click', e => { const r = e.target && e.target.closest && e.target.closest('#main div[data-id]'); if (r) { lastRow = r; lastRowAt = Date.now(); } }, true);
const AUD_SEL = '[data-icon*="audio-play"], [data-icon*="ptt-play"], [data-icon*="audio-download"], [data-icon*="ptt-download"], button[aria-label*="voz" i], button[aria-label*="voice" i], button[aria-label*="áudio" i], button[aria-label*="audio" i], audio';
const PLAY_SEL = '[data-icon*="audio-play"], [data-icon*="ptt-play"], button[aria-label*="Reproduzir" i], button[aria-label*="Play" i], [data-icon*="audio-download"], [data-icon*="ptt-download"]';
function isAudioRow(row) {
  if (!row.querySelector(AUD_SEL)) return false;
  const cp = row.querySelector('.copyable-text[data-pre-plain-text]'); // texto que só cita um áudio não conta
  return !(cp && ((cp.querySelector('.selectable-text') || cp).innerText || '').trim());
}
function playBtn(row) { const el = row.querySelector(PLAY_SEL); return el ? (el.closest('button, [role="button"]') || el) : null; }
const clockTexts = row => $$('span, div', row).filter(e => !e.children.length && /^\d{1,2}:\d{2}$/.test((e.textContent || '').trim())).map(e => e.textContent.trim());
function rowDur(row) { const t = clockTexts(row); if (t.length < 2) return 0; const [m, s] = t[0].split(':').map(Number); return m * 60 + s; }
function groupSender(id) {
  const m = id.match(/@g\.us_[^_]+_(.+)$/); if (!m) return '';
  for (const r of $$('#main div[data-id]')) {
    if (!(r.getAttribute('data-id') || '').endsWith('_' + m[1])) continue;
    const cp = r.querySelector('[data-pre-plain-text]'), mm = cp && (cp.getAttribute('data-pre-plain-text') || '').match(/\]\s*([^:]+):/);
    if (mm) return mm[1].trim();
  }
  return '+' + m[1].replace(/@.*/, '');
}
const metaDate = r => { const cp = r.querySelector('[data-pre-plain-text]'), m = cp && (cp.getAttribute('data-pre-plain-text') || '').match(/\[(\d{1,2}):(\d{2}),\s*(\d{1,2})\/(\d{1,2})\/(\d{4})\]/); return m ? new Date(+m[5], +m[4] - 1, +m[3], +m[1], +m[2]) : null; };
function rowDate(row, hm) { // a linha do áudio só mostra a hora: o dia vem da mensagem de texto mais próxima (antes ou depois)
  const rows = $$('#main div[data-id]'), k = rows.indexOf(row), [h, mi] = hm ? hm.split(':').map(Number) : [NaN, NaN];
  for (let i = k - 1; i >= 0; i--) { const d = metaDate(rows[i]); if (!d) continue; if (isNaN(h)) return d; const x = new Date(d); x.setHours(h, mi, 0, 0); if (x < d) x.setDate(x.getDate() + 1); return x; }
  for (let i = k + 1; i < rows.length; i++) { const d = metaDate(rows[i]); if (!d) continue; if (isNaN(h)) return d; const x = new Date(d); x.setHours(h, mi, 0, 0); if (x > d) x.setDate(x.getDate() - 1); return x; }
  const now = new Date(), x = new Date(now); if (!isNaN(h)) { x.setHours(h, mi, 0, 0); if (x > now) x.setDate(x.getDate() - 1); } return x;
}
function rowMeta(row) { // mesmo formato do data-pre-plain-text: "[14:32, 29/10/2026] Fulano: "
  const id = row.getAttribute('data-id') || '', t = clockTexts(row), hm = t.length ? t[t.length - 1] : '';
  const d = rowDate(row, hm), p = n => String(n).padStart(2, '0');
  const who = id.startsWith('true_') ? 'Eu' : (groupSender(id) || chatName());
  return `[${p(d.getHours())}:${p(d.getMinutes())}, ${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}] ${who}: `;
}
function scanAudios() { // áudios que aparecem na conversa aberta (o app decide se pergunta, transcreve ou ignora)
  const main = $('#main'); if (!main || !audioOn) return null;
  const out = [];
  for (const row of main.querySelectorAll('div[data-id]')) {
    const id = row.getAttribute('data-id');
    if (!id || audSent.has(id) || !isAudioRow(row)) continue;
    audSent.add(id);
    out.push({ id, meta: rowMeta(row), out: id.startsWith('true_'), dur: rowDur(row) });
  }
  return out.length ? { chat: chatName(), audios: out } : null;
}
function fnv(buf) { let h = 0x811c9dc5; for (let i = 0; i < buf.length; i++) { h ^= buf[i]; h = Math.imul(h, 0x01000193) >>> 0; } return buf.length.toString(36) + '-' + h.toString(36); }
window.addEventListener('message', async e => {
  const d = e.data;
  if (e.source !== window || !d || d.__wv1 !== 'audio') return;
  const w = d.cap ? capWait.find(x => x.until > Date.now()) : null;
  if (!audioOn && !w) return;
  const row = w ? w.row : (Date.now() - lastRowAt < 20000 && lastRow && lastRow.isConnected ? lastRow : null);
  const id = row ? row.getAttribute('data-id') || '' : '';
  try {
    const blob = d.blob instanceof Blob ? d.blob : await (await fetch(d.src)).blob();
    const buf = new Uint8Array(await blob.arrayBuffer());
    ipcRenderer.sendToHost('wa-audio', { id, hash: fnv(buf), chat: chatName(), meta: row ? rowMeta(row) : '', out: id.startsWith('true_'), dur: Math.round(d.dur || (row ? rowDur(row) : 0)), type: d.type || blob.type, buf, req: !!w });
  } catch (err) { /* blob já descartado: fica para a próxima vez que tocar */ }
  if (w) { capWait.splice(capWait.indexOf(w), 1); w.resolve(true); }
});
const rowById = id => $$('#main div[data-id]').find(r => r.getAttribute('data-id') === id);
async function captureAudios(o) {
  if (o.auto && Date.now() - lastInput < 30e3) return { ok: false, busy: true, erro: 'WhatsApp em uso' };
  if (sweeping) { cancel = true; for (let i = 0; i < 40 && sweeping; i++) await sleep(250); }
  const start = Date.now(), orig = chatName(), got = [], miss = [];
  if (!(await findAndOpen(o.chat))) return { ok: false, erro: 'não achei a conversa "' + o.chat + '" na lista do WhatsApp' };
  await sleep(800);
  for (const id of o.ids || []) {
    if (o.auto && lastInput > start) break; // você mexeu no WhatsApp: para
    let row = rowById(id);
    const pane = msgPane();
    for (let i = 0; i < 6 && !row && pane; i++) { pane.scrollTop = Math.max(0, pane.scrollTop - 1200); await sleep(500); row = rowById(id); }
    const btn = row && playBtn(row);
    if (!btn) { miss.push(id); continue; }
    try { row.scrollIntoView({ block: 'center' }); } catch {}
    await sleep(250);
    const ok = await new Promise(res => {
      const w = { row, id, resolve: res, until: Date.now() + 15000 }; capWait.push(w);
      window.postMessage({ __wv1: 'capture', ms: 15000 }, '*');
      fire(btn);
      setTimeout(() => { const k = capWait.indexOf(w); if (k >= 0) { capWait.splice(k, 1); res(false); } }, 15000);
    });
    (ok ? got : miss).push(id);
    await sleep(500);
  }
  if (orig && orig !== o.chat) { try { await findAndOpen(orig); } catch {} }
  return { ok: true, got, miss };
}
ipcRenderer.on('wa-audio-cfg', (_, o) => { audioOn = !!(o && o.on); });
ipcRenderer.on('wa-audio-get', async (_, o) => { o = o || {}; let r; try { r = await captureAudios(o); } catch (e) { r = { ok: false, erro: e.message }; } ipcRenderer.sendToHost('wa-audio-done', { reqId: o.reqId, chat: o.chat, ...r }); });

setInterval(() => {
  if (sweeping) return;
  try {
    scanMedia();
    const batches = scanUnreadPreviews();
    const open = scanOpenChat();
    if (open) batches.push(open);
    if (batches.length) ipcRenderer.sendToHost('wa-msgs', batches);
    const au = scanAudios(); if (au) ipcRenderer.sendToHost('wa-audio-seen', au);
  } catch (e) { /* o WhatsApp mudou o site: ignora e tenta de novo */ }
}, 5000);
