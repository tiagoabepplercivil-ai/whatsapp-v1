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
// texto de um balão com os emojis (o WhatsApp desenha emoji como <img alt="🤖">, que o innerText perde)
function txtOf(el) {
  if (!el) return '';
  if (!el.querySelector('img[alt]')) return el.innerText || '';
  let s = '';
  for (const n of el.childNodes) s += n.nodeType === 3 ? n.nodeValue : n.nodeType !== 1 ? '' : n.tagName === 'IMG' ? (n.getAttribute('alt') || '') : n.tagName === 'BR' ? '\n' : txtOf(n);
  return s;
}
// sua conversa com você mesmo ("Tiago (você)"): o app liga com a Conversa da assistente
const SELF_RE = /\((voc[eê]|you)\)\s*$/i;
let selfCfg = { on: false, name: '' }, selfPrev = null, selfDirty = false, selfSeen = '', selfFailAt = 0, selfSending = false;

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
    const text = txtOf(el).trim();
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
    if (SELF_RE.test(titles[0]) && titles[0] !== selfSeen) { selfSeen = titles[0]; try { ipcRenderer.sendToHost('wa-self-found', { name: titles[0] }); } catch {} }
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
document.addEventListener('keydown', e => { if (e.isTrusted && e.ctrlKey && e.shiftKey && (e.code === 'KeyT' || e.code === 'KeyY')) { e.preventDefault(); e.stopPropagation(); try { ipcRenderer.sendToHost('wa-hotkey', 'psi'); } catch {} } }, true); // atalho do app funciona com o WhatsApp em foco
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
  const au = scanAudios(true); if (au) ipcRenderer.sendToHost('wa-audio-seen', au);
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
const keyTxt = s => normTxt(s).replace(/[^a-z0-9]+/g, ''); // compara só letras e números: emoji, espaço e quebra de linha o WhatsApp desenha do jeito dele
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
  if (keyTxt(txtOf(box)) === keyTxt(text)) return true;
  box.focus(); const dt = new DataTransfer(); dt.setData('text/plain', text); // o editor não aceitou: tenta como colagem
  box.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  await sleep(400);
  return keyTxt(txtOf(box)) === keyTxt(text);
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
    const t = last ? txtOf(last.querySelector('.selectable-text') || last) : '';
    const b = composer();
    if (keyTxt(t) === keyTxt(text) && !(b && keyTxt(txtOf(b)))) return { ok: true, conversa: chatName() };
  }
  return { ok: false, erro: 'não confirmei o envio; confira na conversa ' + chatName() };
}
ipcRenderer.on('wa-open', async (_, o) => { // o Cérebro pediu para abrir a conversa (botão 💬 Abrir)
  o = o || {}; if (sweeping) { cancel = true; for (let i = 0; i < 40 && sweeping; i++) await sleep(250); }
  let ok = false; try { ok = await findAndOpen(o.chat); } catch {}
  ipcRenderer.sendToHost('wa-opened', { chat: o.chat, ok: !!ok });
});
ipcRenderer.on('wa-send', async (_, o) => { o = o || {}; let r; try { r = await sendTo(o.chat, o.text); } catch (e) { r = { ok: false, erro: e.message }; } ipcRenderer.sendToHost('wa-sent', { id: o.id, ...r }); });

// ---------- sua conversa com você mesmo ligada ao app ----------
// Mensagem que você manda para si mesmo não fica "não lida": o leitor percebe pela prévia da lista que mudou,
// abre a conversa quando você não está mexendo no WhatsApp (30 s), lê e volta para a conversa onde você estava.
const isSelfName = n => !!n && (SELF_RE.test(n) || (!!selfCfg.name && normTxt(n) === normTxt(selfCfg.name)));
const selfTarget = () => selfCfg.name || selfSeen || '(você)';
const quiet = ms => Date.now() - lastInput > ms;
ipcRenderer.on('wa-self-cfg', (_, o) => {
  const was = selfCfg.on; selfCfg = { on: !!(o && o.on), name: String((o && o.name) || '') };
  if (selfCfg.on && !was) { selfDirty = true; selfFailAt = 0; } // ao ligar (e ao abrir o app) lê uma vez: pega o que você mandou com o app fechado
});
function selfWatch() {
  if (!selfCfg.on) return;
  const open = isSelfName(chatName());
  if (open) selfDirty = false; // aberta na sua frente: a leitura normal (a cada 5 s) já pega
  const r = listRows().find(x => isSelfName(x.name)); if (!r) return;
  if (selfPrev !== null && r.preview !== selfPrev && !open && !/^\s*🤖/u.test(r.preview)) selfDirty = true;
  selfPrev = r.preview;
}
async function selfRead() {
  selfDirty = false; sweeping = true;
  const pane = $('#pane-side'), top = pane ? pane.scrollTop : 0, orig = chatName();
  try {
    if (await findAndOpen(selfTarget())) {
      await sleep(900);
      const a = scanOpenChat(); if (a) ipcRenderer.sendToHost('wa-msgs', [a]);
      const au = scanAudios(true); if (au) ipcRenderer.sendToHost('wa-audio-seen', au);
      const r = listRows().find(x => isSelfName(x.name)); if (r) selfPrev = r.preview;
    } else selfFailAt = Date.now();
    if (orig && normTxt(chatName()) !== normTxt(orig)) await findAndOpen(orig);
    if (pane) pane.scrollTop = top;
  } catch {}
  sweeping = false;
}
ipcRenderer.on('wa-self-send', async (_, o) => { // o app manda para a sua conversa (sempre começa com 🤖): espera você largar o WhatsApp e volta onde estava
  o = o || {};
  for (let i = 0; i < 240 && (sweeping || selfSending || !quiet(30e3) || !$('#pane-side')); i++) await sleep(5000);
  selfSending = true;
  const pane = $('#pane-side'), top = pane ? pane.scrollTop : 0, orig = chatName();
  let r; try { r = await sendTo(selfTarget(), o.text); } catch (e) { r = { ok: false, erro: e.message }; }
  try { // já está na conversa: pega o que você mandou do celular nesse meio tempo (a prévia da lista agora mostra a resposta do app)
    if (isSelfName(chatName())) {
      const a = scanOpenChat(); if (a) ipcRenderer.sendToHost('wa-msgs', [a]);
      const au = scanAudios(!isSelfName(orig)); if (au) ipcRenderer.sendToHost('wa-audio-seen', au); // vou sair daqui: o áudio vai para a fila
      const row = listRows().find(x => isSelfName(x.name)); if (row) selfPrev = row.preview; // mesmo instante da leitura: o que chegar depois muda a prévia e é lido
    }
  } catch {}
  try { if (orig && !isSelfName(orig) && normTxt(chatName()) !== normTxt(orig)) await findAndOpen(orig); if (pane) pane.scrollTop = top; } catch {}
  selfSending = false;
  ipcRenderer.sendToHost('wa-sent', { id: o.id, ...r });
});

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
  const AC = window.BaseAudioContext || window.AudioContext, DA = AC && AC.prototype.decodeAudioData;
  if (DA) AC.prototype.decodeAudioData = function (buf) { // se o WhatsApp tocar pelo Web Audio: pega o arquivo (só Ogg/Opus, que é o formato da mensagem de voz)
    try { if (buf && buf.byteLength > 2000 && String.fromCharCode(...new Uint8Array(buf, 0, 4)) === 'OggS') { const cap = capUntil > Date.now(); if (cap) capUntil = 0; window.postMessage({ __wv1: 'audio', blob: new Blob([buf.slice(0)], { type: 'audio/ogg' }), type: 'audio/ogg', dur: 0, cap, via: 'decode' }, '*'); } } catch (e) {}
    return DA.apply(this, arguments);
  };
  window.addEventListener('message', e => { if (e.source === window && e.data && e.data.__wv1 === 'capture') capUntil = Date.now() + (e.data.ms || 12000); });
})();`;
function hookPage() { try { if (typeof webFrame !== 'undefined' && webFrame && webFrame.executeJavaScript) webFrame.executeJavaScript(PAGE_HOOK).catch(() => {}); } catch {} }
hookPage(); document.addEventListener('DOMContentLoaded', hookPage);

let audioOn = false, lastRow = null, lastRowAt = 0;
const capWait = [], audSent = new Set();
const markRow = e => { if (!e.isTrusted) return; /* só o seu clique: os da leitura e do "Transcrever" são sintéticos */ const r = e.target && e.target.closest && e.target.closest('#main div[data-id]'); if (r) { lastRow = r; lastRowAt = Date.now(); } };
document.addEventListener('click', markRow, true); document.addEventListener('contextmenu', markRow, true);
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
function scanAudios(sweep) { // áudios que aparecem na conversa aberta (o app decide se pergunta, transcreve ou ignora)
  const main = $('#main'); if (!main || !audioOn) return null;
  const out = [];
  for (const row of main.querySelectorAll('div[data-id]')) {
    const id = row.getAttribute('data-id');
    if (!id || audSent.has(id) || !isAudioRow(row)) continue;
    audSent.add(id);
    out.push({ id, meta: rowMeta(row), out: id.startsWith('true_'), dur: rowDur(row) });
  }
  return out.length ? { chat: chatName(), audios: out, sweep: !!sweep } : null;
}
function fnv(buf) { let h = 0x811c9dc5; for (let i = 0; i < buf.length; i++) { h ^= buf[i]; h = Math.imul(h, 0x01000193) >>> 0; } return buf.length.toString(36) + '-' + h.toString(36); }
window.addEventListener('message', async e => {
  const d = e.data;
  if (e.source !== window || !d || d.__wv1 !== 'audio') return;
  const w = d.cap ? capWait.find(x => x.until > Date.now()) : null;
  if (!audioOn && !w) return;
  const recent = lastRow && lastRow.isConnected && Date.now() - lastRowAt < (d.via === 'decode' ? 6000 : 20000) ? lastRow : null;
  if (!w && d.via === 'decode' && !(recent && isAudioRow(recent))) return; // som do próprio WhatsApp, não é mensagem de voz
  const row = w ? w.row : recent;
  const id = row ? row.getAttribute('data-id') || '' : '';
  try {
    const blob = d.blob instanceof Blob ? d.blob : await (await fetch(d.src)).blob();
    const buf = new Uint8Array(await blob.arrayBuffer());
    ipcRenderer.sendToHost('wa-audio', { id, hash: fnv(buf), chat: chatName(), meta: row ? rowMeta(row) : '', out: id.startsWith('true_'), dur: Math.round(d.dur || (row ? rowDur(row) : 0)), type: d.type || blob.type, buf, req: !!w });
    if (id && !(audTexts.get(id) || {}).text) setAud(id, { busy: 1 });
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
// ---------- transcrição dentro da conversa: botão "🎤 Transcrever" e o texto logo abaixo do balão do áudio ----------
// O WhatsApp recria as linhas ao rolar ou trocar de conversa; o texto fica guardado aqui (e no app) e é recolocado.
const audTexts = new Map();
function setAud(id, st) {
  if (!id) return; audTexts.set(id, st); if (audTexts.size > 600) audTexts.delete(audTexts.keys().next().value); paintSoon();
  if (st.busy) setTimeout(() => { if (audTexts.get(id) === st) setAud(id, { erro: 'demorou demais' }); }, 120e3); // nunca fica preso em "Transcrevendo…"
}
const isDark = () => !!(document.body && document.body.classList.contains('dark'));
function boxFor(row, id) {
  let box = [...row.children].find(c => c.getAttribute && c.getAttribute('data-wv1t') === id);
  if (!box) {
    box = document.createElement('div'); box.setAttribute('data-wv1t', id);
    box.style.cssText = `display:flex;justify-content:${id.startsWith('true_') ? 'flex-end' : 'flex-start'};padding:2px 63px 8px;box-sizing:border-box;width:100%`;
    box.addEventListener('click', e => { const b = e.target.closest('[data-wv1go]'); if (!b) return; e.stopPropagation(); e.preventDefault(); inplace(row); }, true);
    row.appendChild(box);
  }
  return box;
}
const escH = t => String(t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
function paintRow(row) {
  const id = row.getAttribute('data-id'); if (!id || !isAudioRow(row)) return;
  const st = audTexts.get(id) || {}, key = st.text ? 't:' + st.text.length : st.busy ? 'b' : st.erro ? 'e:' + st.erro : audioOn ? 'n' : '';
  const old = [...row.children].find(c => c.getAttribute && c.getAttribute('data-wv1t') === id);
  if (!key) { if (old) old.remove(); return; }
  if (old && old.getAttribute('data-k') === key + isDark()) return;
  const box = boxFor(row, id); box.setAttribute('data-k', key + isDark());
  const dk = isDark(), card = `max-width:min(65%,560px);background:${dk ? '#202c33' : '#ffffff'};color:${dk ? '#e9edef' : '#111b21'};border-left:3px solid #25d366;border-radius:7.5px;padding:6px 10px;font-size:13.5px;line-height:19px;box-shadow:0 1px .5px rgba(11,20,26,.13);white-space:pre-wrap;user-select:text`;
  const btn = `background:${dk ? '#005c4b' : '#d9fdd3'};color:${dk ? '#e9edef' : '#008069'};border:0;border-radius:12px;padding:3px 10px;font-size:12.5px;font-weight:600;cursor:pointer`;
  box.innerHTML = st.text ? `<div style="${card}"><span style="font-size:11.5px;color:#25d366;font-weight:600">🎤 Transcrição</span><br><span style="font-style:italic">${escH(st.text)}</span></div>`
    : st.busy ? `<div style="${card};color:${dk ? '#8696a0' : '#667781'}">🎤 Transcrevendo…</div>`
    : st.erro ? `<div style="${card}">⚠️ Não transcrevi: ${escH(st.erro)} <button data-wv1go="1" style="${btn}">Tentar de novo</button></div>`
    : `<button data-wv1go="1" style="${btn}" title="Toca o áudio sem som e mostra o texto aqui. Quem mandou vê como ouvido.">🎤 Transcrever</button>`;
}
function paintAll() { const main = $('#main'); if (!main) return; for (const row of main.querySelectorAll('div[data-id]')) { try { paintRow(row); } catch {} } }
let paintT = 0; function paintSoon() { clearTimeout(paintT); paintT = setTimeout(paintAll, 150); }
const ours = n => n.nodeType === 1 ? n.hasAttribute('data-wv1t') || !!n.closest('[data-wv1t]') : !!(n.parentElement && n.parentElement.closest('[data-wv1t]'));
new MutationObserver(muts => { if (muts.some(m => m.addedNodes.length && !ours(m.target) && ![...m.addedNodes].every(ours))) paintSoon(); })
  .observe(document, { childList: true, subtree: true }); // document: o preload roda antes de existir o <html>
let inq = Promise.resolve();
function inplace(row) { // você clicou em "🎤 Transcrever" embaixo do áudio (ou o modo "sempre, sozinha" pediu): um por vez
  const id = row.getAttribute('data-id'); setAud(id, { busy: 1 });
  return (inq = inq.then(() => inplace1(row, id)).catch(() => {}));
}
async function inplace1(row, id) {
  if (!row.isConnected) row = rowById(id) || row;
  const btn = playBtn(row);
  if (!btn) { setAud(id, { erro: 'não achei o botão de tocar' }); return; }
  const ok = await new Promise(res => {
    const w = { row, id, resolve: res, until: Date.now() + 15000 }; capWait.push(w);
    window.postMessage({ __wv1: 'capture', ms: 15000 }, '*'); fire(btn);
    setTimeout(() => { const k = capWait.indexOf(w); if (k >= 0) { capWait.splice(k, 1); res(false); } }, 15000);
  });
  if (!ok) setAud(id, { erro: 'o áudio não carregou' });
}
const fileRow = new Map(); // arquivo baixado pelo "Baixar" -> áudio em que você clicou antes
ipcRenderer.on('wa-audio-text', (_, o) => { // resposta do app: texto, erro, "transcrevendo" ou "nada a fazer"
  o = o || {};
  let id = o.id;
  if (!id && o.recent) {
    id = fileRow.get(o.key);
    if (!id && lastRow && lastRow.isConnected && Date.now() - lastRowAt < 180e3 && isAudioRow(lastRow)) { id = lastRow.getAttribute('data-id'); fileRow.set(o.key, id); }
    if (id && o.text) { fileRow.delete(o.key); ipcRenderer.sendToHost('wa-audio-bind', { id, key: o.key, text: o.text }); }
  }
  if (!id) return;
  if (o.text) setAud(id, { text: o.text }); else if (o.busy) setAud(id, { busy: 1 }); else if (o.erro) setAud(id, { erro: o.erro }); else { audTexts.delete(id); paintSoon(); }
});
ipcRenderer.on('wa-audio-auto', async (_, ids) => { // modo "sempre, sozinha": transcreve os áudios novos da conversa aberta, ali mesmo
  for (const id of ids || []) { const row = rowById(id), st = audTexts.get(id) || {}; if (row && !st.text && !st.busy) inplace(row); }
});
ipcRenderer.on('wa-audio-texts', (_, list) => { for (const [id, text] of list || []) if (id && text) audTexts.set(id, { text }); paintSoon(); });
ipcRenderer.on('wa-audio-cfg', (_, o) => { audioOn = !!(o && o.on); paintSoon(); });
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
    paintAll();
    selfWatch();
    if (selfCfg.on && selfDirty && !selfSending && quiet(30e3) && Date.now() - selfFailAt > 10 * 60e3 && $('#pane-side [role="listitem"], #pane-side [role="row"]')) selfRead();
  } catch (e) { /* o WhatsApp mudou o site: ignora e tenta de novo */ }
}, 5000);
