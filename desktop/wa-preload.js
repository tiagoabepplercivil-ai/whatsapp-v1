// Roda dentro do WhatsApp Web: lê as mensagens novas da conversa aberta e as prévias das conversas
// não lidas e entrega para a interface do app (que decide o que mandar para a assistente).
// Só leitura: nada é enviado nem clicado no WhatsApp.
const { ipcRenderer } = require('electron');
const sent = new Set();

function chatName() {
  const h = document.querySelector('#main header');
  if (!h) return '';
  const s = h.querySelector('span[dir="auto"]');
  return s ? s.textContent.trim() : '';
}

function scanOpenChat() {
  const main = document.querySelector('#main');
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

function scanUnreadPreviews() {
  const side = document.querySelector('#pane-side');
  if (!side) return [];
  const out = [];
  side.querySelectorAll('[role="listitem"], [role="row"]').forEach(row => {
    const badge = row.querySelector('[aria-label*="não lida"], [aria-label*="unread"], [aria-label*="Não lida"]');
    if (!badge) return;
    const titles = [...row.querySelectorAll('span[title]')].map(s => s.getAttribute('title')).filter(Boolean);
    if (titles.length < 2) return;
    const name = titles[0], prev = titles[titles.length - 1];
    const id = 'p:' + name + '|' + prev;
    if (sent.has(id) || prev === name) return;
    sent.add(id);
    out.push({ chat: name, msgs: [{ id, meta: '', text: prev, out: false }] });
  });
  return out;
}

// fotos da conversa aberta: salva a imagem exibida (vai para a pasta do Drive, por conversa)
const mediaDone = new Set();
let lastChat = '';
async function scanMedia() {
  const main = document.querySelector('#main');
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

setInterval(() => {
  try {
    scanMedia();
    const batches = scanUnreadPreviews();
    const open = scanOpenChat();
    if (open) batches.push(open);
    if (batches.length) ipcRenderer.sendToHost('wa-msgs', batches);
  } catch (e) { /* o WhatsApp mudou o site: ignora e tenta de novo */ }
}, 5000);
