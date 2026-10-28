// Leitor do WhatsApp Web. Roda dentro da página do WhatsApp (mundo isolado) e recebe `ipcRenderer` do
// carregador wa-preload.js. Lê o DOM da conversa aberta, as prévias das não lidas e as fotos; na
// "varredura" abre cada conversa (clique na lista) para ler o que chegou. Nada é enviado nem digitado.
// Este arquivo vem na pasta app/ e é trocado pelo ⟳ do app sem reinstalar.
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

setInterval(() => {
  if (sweeping) return;
  try {
    scanMedia();
    const batches = scanUnreadPreviews();
    const open = scanOpenChat();
    if (open) batches.push(open);
    if (batches.length) ipcRenderer.sendToHost('wa-msgs', batches);
  } catch (e) { /* o WhatsApp mudou o site: ignora e tenta de novo */ }
}, 5000);
