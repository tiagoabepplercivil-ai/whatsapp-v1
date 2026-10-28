'use strict';
/* WhatsApp v1 — app pessoal: conversas + agenda + atividades + Claude */

// ---------- estado ----------
const KEY = 'wv1-data';
const COLORS = ['#00a884', '#53bdeb', '#ffbc2d', '#ea0038', '#a560f5', '#ff7a4d', '#2196f3', '#6b8e23'];
const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

const INTRO = 'Oi! Sou sua assistente (Claude) dentro do WhatsApp v1.\n\n• Mande coisas nos seus grupos e conversas (texto ou foto): eu leio e crio lembretes, compromissos e atividades.\n• Aqui você me pede direto: "me lembra amanhã 8h de ligar pro Alex", "o que tenho essa semana?", "qual a data da minha crisma?".\n• Todo dia te mando um resumo do dia e aviso na hora de cada lembrete.';
function seed() {
  const now = new Date();
  return {
    settings: { apiKey: '', model: 'claude-sonnet-5-5', myName: 'Tiago' },
    chats: [
      { id: 'claude', name: 'Assistente', kind: 'claude', color: '#d97757', pinned: true, messages: [
        { id: uid(), from: 'them', ts: now.toISOString(), text: INTRO, read: true }
      ] },
      { id: uid(), name: 'Anotações', kind: 'normal', color: COLORS[1], pinned: false, watch: true, messages: [
        { id: uid(), from: 'me', ts: now.toISOString(), read: true, text: 'Segure (ou clique) numa mensagem para criar lembrete, atividade ou pedir para a assistente agendar.' }
      ] }
    ],
    events: [],
    tasks: [],
    meta: {}
  };
}
let db;
try { db = JSON.parse(localStorage.getItem(KEY)) || seed(); } catch { db = seed(); }
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(db)); } catch { toast('Memória cheia: faça um backup e limpe conversas antigas'); } };
db.meta = db.meta || {};
{ const a = db.chats.find(c => c.id === 'claude'); if (a && a.name === 'Claude') { a.name = 'Assistente'; a.messages.push({ id: uid(), from: 'them', ts: new Date().toISOString(), text: INTRO }); } }
db.chats.forEach(c => { if (c.kind !== 'claude' && c.watch === undefined) c.watch = true; });

const DESK = !!window.wv1desk, WIDE = () => window.matchMedia('(min-width:900px)').matches;
let tab = (DESK && (db.meta.view || 'wa')) || 'chats', openChatId = null, taskFilter = 'open', search = '', chatFilter = 'all', waUnread = 0;
let calMonth = startOfMonth(new Date()), calSel = ymd(new Date());

// ---------- utilidades de data ----------
function pad(n) { return String(n).padStart(2, '0'); }
function ymd(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
function startOfMonth(d) { return new Date(d.getFullYear(), d.getMonth(), 1); }
function localISO(d) { return `${ymd(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`; }
function parseLocal(s) { // "YYYY-MM-DD" ou "YYYY-MM-DDTHH:MM"
  if (!s) return null;
  const [a, b] = s.split('T'); const [y, m, d] = a.split('-').map(Number);
  const [hh, mm] = (b || '00:00').split(':').map(Number);
  return new Date(y, m - 1, d, hh || 0, mm || 0);
}
const WD = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
function fmtHour(s) { const d = parseLocal(s); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; }
function fmtDay(s) {
  const d = parseLocal(s), t = new Date(); t.setHours(0, 0, 0, 0);
  const diff = Math.round((new Date(d.getFullYear(), d.getMonth(), d.getDate()) - t) / 864e5);
  if (diff === 0) return 'Hoje'; if (diff === 1) return 'Amanhã'; if (diff === -1) return 'Ontem';
  return d.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' });
}
function fmtWhen(ev) { return `${fmtDay(ev.start)}, ${fmtHour(ev.start)}${ev.end ? '–' + fmtHour(ev.end) : ''}`; }
function msgTime(iso) { const d = new Date(iso); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; }
function listTime(iso) {
  const d = new Date(iso), t = new Date();
  if (ymd(d) === ymd(t)) return msgTime(iso);
  const y = new Date(); y.setDate(y.getDate() - 1);
  if (ymd(d) === ymd(y)) return 'Ontem';
  return d.toLocaleDateString('pt-BR');
}
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const $ = s => document.querySelector(s);
function toast(t) { const el = $('#toast'); el.textContent = t; el.classList.add('on'); clearTimeout(toast.h); toast.h = setTimeout(() => el.classList.remove('on'), 2200); }

// ---------- fotos (IndexedDB, fora do localStorage) ----------
const idb = new Promise((res, rej) => { const r = indexedDB.open('wv1-img', 1); r.onupgradeneeded = () => r.result.createObjectStore('img'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
async function imgPut(id, data) { const d = await idb; return new Promise((res, rej) => { const tx = d.transaction('img', 'readwrite'); tx.objectStore('img').put(data, id); tx.oncomplete = res; tx.onerror = () => rej(tx.error); }); }
const imgCache = {};
async function imgGet(id) { if (imgCache[id]) return imgCache[id]; const d = await idb; return new Promise(res => { const q = d.transaction('img').objectStore('img').get(id); q.onsuccess = () => res(imgCache[id] = q.result); q.onerror = () => res(null); }); }
async function imgDel(id) { const d = await idb; d.transaction('img', 'readwrite').objectStore('img').delete(id); delete imgCache[id]; }
function shrink(file, max = 1600) {
  return new Promise((res, rej) => {
    const im = new Image(); im.onload = () => {
      const k = Math.min(1, max / Math.max(im.width, im.height)); const c = document.createElement('canvas');
      c.width = Math.round(im.width * k); c.height = Math.round(im.height * k); c.getContext('2d').drawImage(im, 0, 0, c.width, c.height);
      URL.revokeObjectURL(im.src); res(c.toDataURL('image/jpeg', 0.82));
    }; im.onerror = rej; im.src = URL.createObjectURL(file);
  });
}
function hydrateImgs(root) { root.querySelectorAll('img[data-imgid]').forEach(async el => { const d = await imgGet(el.dataset.imgid); if (d) el.src = d; }); }

// ---------- Google Agenda / .ics ----------
function gcalUrl(ev) {
  const f = s => s.replace(/[-:]/g, '') + '00';
  const end = ev.end || localISO(new Date(parseLocal(ev.start).getTime() + 3600e3));
  const tasks = db.tasks.filter(t => t.eventId === ev.id).map(t => '• ' + t.title).join('\n');
  const details = [ev.notes, tasks && 'Atividades:\n' + tasks, 'Criado pelo WhatsApp v1'].filter(Boolean).join('\n\n');
  const p = new URLSearchParams({ action: 'TEMPLATE', text: ev.title, dates: `${f(ev.start)}/${f(end)}`, details, location: ev.location || '', ctz: Intl.DateTimeFormat().resolvedOptions().timeZone });
  return 'https://calendar.google.com/calendar/render?' + p.toString();
}
function downloadIcs(ev) {
  const f = s => s.replace(/[-:]/g, '') + '00';
  const end = ev.end || localISO(new Date(parseLocal(ev.start).getTime() + 3600e3));
  const e = s => String(s || '').replace(/([,;\\])/g, '\\$1').replace(/\n/g, '\\n');
  const tasks = db.tasks.filter(t => t.eventId === ev.id).map(t => '- ' + t.title).join('\n');
  const ics = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//WhatsApp v1//PT-BR', 'BEGIN:VEVENT', `UID:${ev.id}@wv1`,
    `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, '').slice(0, 15)}Z`, `DTSTART:${f(ev.start)}`, `DTEND:${f(end)}`,
    `SUMMARY:${e(ev.title)}`, `LOCATION:${e(ev.location)}`, `DESCRIPTION:${e([ev.notes, tasks].filter(Boolean).join('\n'))}`,
    'BEGIN:VALARM', 'TRIGGER:-PT30M', 'ACTION:DISPLAY', 'DESCRIPTION:Lembrete', 'END:VALARM', 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([ics], { type: 'text/calendar' }));
  a.download = (ev.title || 'evento').replace(/[^\w\- ]+/g, '').slice(0, 40) + '.ics';
  a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

// ---------- operações de agenda/atividades ----------
function addEvent({ title, start, end, location, notes, chatId, tasks }) {
  const ev = { id: uid(), title: title || 'Compromisso', start, end: end || '', location: location || '', notes: notes || '', chatId: chatId || null, created: new Date().toISOString() };
  db.events.push(ev);
  (tasks || []).forEach(t => addTask({ title: t, eventId: ev.id, chatId }));
  save(); return ev;
}
function addTask({ title, due, eventId, chatId, remindAt }) {
  const t = { id: uid(), title: title || 'Atividade', due: due || (remindAt ? remindAt.slice(0, 10) : ''), remindAt: remindAt || '', eventId: eventId || null, chatId: chatId || null, done: false, created: new Date().toISOString() };
  db.tasks.push(t); save(); return t;
}
function delEvent(id) { db.events = db.events.filter(e => e.id !== id); db.tasks.forEach(t => { if (t.eventId === id) t.eventId = null; }); save(); }
function sortedEvents() { return [...db.events].sort((a, b) => a.start.localeCompare(b.start)); }

// ---------- render: lista principal ----------
function setBadge(el, n) { el.textContent = n > 99 ? '99+' : n; el.classList.toggle('on', n > 0); }
function render() {
  if (tab === 'wa' && !DESK) tab = 'chats';
  document.querySelectorAll('.tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === tab));
  document.querySelectorAll('.rb[data-view]').forEach(b => b.classList.toggle('on', b.dataset.view === tab));
  document.body.classList.toggle('view-wa', tab === 'wa');
  document.body.classList.toggle('nocal', !!db.meta.nocal);
  const pend = db.tasks.filter(t => !t.done).length;
  const badge = $('#taskBadge'); badge.style.display = pend ? '' : 'none'; badge.textContent = pend;
  setBadge($('#tkBadge'), db.tasks.filter(t => !t.done && t.remindAt && t.remindAt <= localISO(new Date())).length);
  setBadge($('#chBadge'), db.chats.reduce((a, c) => a + (c.unread || 0), 0));
  setBadge($('#waBadge'), waUnread);
  renderSide();
  if (tab === 'wa') return;
  const v = $('#view');
  if (tab === 'chats') v.innerHTML = renderChats();
  if (tab === 'agenda') { v.innerHTML = renderAgenda(); renderCal(); }
  if (tab === 'tasks') v.innerHTML = renderTasks();
  if (tab === 'chats') { const si = $('#search'); if (si) { si.value = search; } }
}

function lastMsg(c) { return c.messages[c.messages.length - 1]; }
function renderChats() {
  let h = '';
  if (!db.settings.apiKey) h += `<div class="banner"><span>A assistente está no modo básico (só entende datas simples e não lê fotos). Cole sua chave da API para ela ler tudo.</span><button data-act="settings">Configurar</button></div>`;
  h += `<div class="search"><svg width="18" height="18" viewBox="0 0 24 24" fill="#8696a0"><path d="M15.5 14h-.8l-.3-.3A6.5 6.5 0 109.5 16a6.5 6.5 0 004.2-1.6l.3.3v.8l5 5 1.5-1.5-5-5zm-6 0a4.5 4.5 0 110-9 4.5 4.5 0 010 9z"/></svg><input id="search" placeholder="Pesquisar ou começar uma nova conversa" autocomplete="off"></div>`;
  const nUn = db.chats.filter(c => c.unread).length, nGr = db.chats.filter(c => c.kind === 'group').length;
  h += `<div class="filters" style="padding:6px 12px 8px">${[['all', 'Tudo', ''], ['unread', 'Não lidas', nUn], ['fav', 'Favoritas', ''], ['group', 'Grupos', nGr]].map(([k, l, n]) => `<button data-cfilter="${k}" class="${chatFilter === k ? 'on' : ''}">${l}${n ? `<small>${n}</small>` : ''}</button>`).join('')}</div>`;
  const q = search.toLowerCase();
  const list = db.chats
    .filter(c => chatFilter === 'all' || (chatFilter === 'unread' ? c.unread : chatFilter === 'fav' ? c.pinned : c.kind === 'group'))
    .filter(c => !q || c.name.toLowerCase().includes(q) || c.messages.some(m => ((m.text || '') + ' ' + (m.desc || '')).toLowerCase().includes(q)))
    .sort((a, b) => (b.pinned - a.pinned) || ((lastMsg(b)?.ts || '').localeCompare(lastMsg(a)?.ts || '')));
  for (const c of list) {
    const m = lastMsg(c);
    let prev = m ? (m.card ? (m.card.type === 'event' ? '📅 ' : m.card.remind ? '🔔 ' : '✅ ') + cardTitle(m.card) : m.img ? '📷 ' + (m.text || 'Foto') : m.text) : '';
    if (m && m.from === 'me') prev = '✓✓ ' + prev;
    h += `<div class="item ${c.id === openChatId ? 'on' : ''}" data-chat="${c.id}">
      <div class="av" style="background:${c.color}">${c.kind === 'claude' ? '✳' : c.kind === 'group' ? '👥' : esc(c.name[0]?.toUpperCase())}</div>
      <div class="mid"><div class="l1"><span class="name">${esc(c.name)}</span><span class="time ${c.unread ? 'unread' : ''}">${m ? listTime(m.ts) : ''}</span></div>
      <div class="l2"><span class="pv">${esc(prev)}</span>${c.pinned ? '<span class="pin">📌</span>' : ''}${c.unread ? `<span class="ub">${c.unread}</span>` : ''}</div></div></div>`;
  }
  if (!list.length) h += `<div class="empty">Nenhuma conversa encontrada.</div>`;
  return h + '<div style="height:90px"></div>';
}
function cardTitle(card) {
  if (card.type === 'event') return db.events.find(e => e.id === card.id)?.title || 'Compromisso removido';
  return db.tasks.find(t => t.id === card.id)?.title || 'Atividade removida';
}

function eventRow(ev) {
  const n = db.tasks.filter(t => t.eventId === ev.id), done = n.filter(t => t.done).length;
  return `<div class="ev" data-event="${ev.id}"><div class="hr">${fmtHour(ev.start)}</div><div class="body">
    <div class="t">${esc(ev.title)}</div>
    <div class="s">${ev.end ? 'até ' + fmtHour(ev.end) : ''}${ev.location ? ' · 📍 ' + esc(ev.location) : ''}</div>
    ${n.length ? `<div class="s"><span class="chip">✅ ${done}/${n.length} atividades</span></div>` : ''}</div></div>`;
}
function renderAgenda() {
  const today = ymd(new Date());
  const evs = sortedEvents().filter(e => e.start.slice(0, 10) >= today);
  const cal = `<div class="mhead"><button data-act="mprev">‹</button><b id="mTitle"></b><button data-act="mnext">›</button></div><div class="grid" id="mGrid"></div><div class="daylist" id="dayList"></div><div class="section" style="border-top:1px solid var(--line);margin-top:6px">Todos os próximos</div>`;
  if (!evs.length) return cal + `<div class="empty">Nenhum compromisso futuro.<br>Peça à assistente: “marca dentista amanhã 9h”.</div>`;
  let h = cal, day = '';
  for (const ev of evs) {
    const d = ev.start.slice(0, 10);
    if (d !== day) { day = d; h += `<div class="section">${esc(fmtDay(ev.start))}</div>`; }
    h += eventRow(ev);
  }
  const past = db.events.length - evs.length;
  if (past) h += `<div class="empty" style="padding:20px">${past} compromisso(s) passado(s) — veja no calendário.</div>`;
  return h + '<div style="height:90px"></div>';
}
function taskRow(t) {
  const ev = t.eventId && db.events.find(e => e.id === t.eventId);
  const late = t.due && !t.done && t.due < ymd(new Date());
  return `<div class="task ${t.done ? 'done' : ''}"><input type="checkbox" data-toggle="${t.id}" ${t.done ? 'checked' : ''}>
    <div class="t" data-task="${t.id}"><div class="tt">${esc(t.title)}</div><div class="s">
    ${t.remindAt ? `<span class="chip ${late ? 'late' : ''}">🔔 ${esc(fmtDay(t.remindAt))} ${fmtHour(t.remindAt)}</span>` : t.due ? `<span class="chip ${late ? 'late' : ''}">⏰ ${parseLocal(t.due).toLocaleDateString('pt-BR')}</span>` : ''}
    ${t.chatId && t.chatId !== 'claude' && db.chats.find(c => c.id === t.chatId) ? `<span class="chip link" data-gochat="${t.chatId}">💬 ${esc(db.chats.find(c => c.id === t.chatId).name)}</span>` : ''}
    ${ev ? `<span class="chip link" data-event="${ev.id}">📅 ${esc(ev.title)}</span>` : ''}</div></div></div>`;
}
function renderTasks() {
  let h = `<div class="filters">${[['open', 'Pendentes'], ['remind', '🔔 Lembretes'], ['done', 'Concluídas'], ['all', 'Todas']].map(([k, l]) => `<button data-filter="${k}" class="${taskFilter === k ? 'on' : ''}">${l}</button>`).join('')}</div>`;
  const list = db.tasks.filter(t => taskFilter === 'all' || (taskFilter === 'remind' ? (t.remindAt && !t.done) : taskFilter === 'done' ? t.done : !t.done))
    .sort((a, b) => (a.done - b.done) || (a.due || '9999').localeCompare(b.due || '9999'));
  if (!list.length) return h + `<div class="empty">Nada por aqui.</div>`;
  return h + list.map(taskRow).join('') + '<div style="height:90px"></div>';
}

// ---------- calendário lateral ----------
function renderCal() {
  if (!$('#mGrid')) return;
  const y = calMonth.getFullYear(), m = calMonth.getMonth();
  { const mt = calMonth.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' }); $('#mTitle').textContent = mt[0].toUpperCase() + mt.slice(1); }
  const first = new Date(y, m, 1), start = new Date(y, m, 1 - first.getDay());
  const byDay = {};
  db.events.forEach(e => { const k = e.start.slice(0, 10); (byDay[k] = byDay[k] || { e: 0, t: 0 }).e++; });
  db.tasks.filter(t => t.due && !t.done).forEach(t => { const k = t.due.slice(0, 10); (byDay[k] = byDay[k] || { e: 0, t: 0 }).t++; });
  const today = ymd(new Date());
  let h = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'].map(d => `<div class="wd">${d}</div>`).join('');
  for (let i = 0; i < 42; i++) {
    const d = new Date(start); d.setDate(start.getDate() + i); const k = ymd(d), c = byDay[k];
    const dots = c ? `<span class="dots">${'<i></i>'.repeat(Math.min(c.e, 3))}${c.t ? '<i class="t"></i>' : ''}</span>` : '';
    h += `<div class="d ${d.getMonth() !== m ? 'out' : ''} ${k === today ? 'today' : ''} ${k === calSel ? 'sel' : ''}" data-day="${k}">${d.getDate()}${dots}</div>`;
  }
  $('#mGrid').innerHTML = h;
  const evs = sortedEvents().filter(e => e.start.slice(0, 10) === calSel);
  const tks = db.tasks.filter(t => t.due && t.due.slice(0, 10) === calSel);
  let l = `<div class="dl-h"><b>${esc(fmtDay(calSel))}</b><button data-act="new-event-day">+ Novo</button></div>`;
  l += evs.length ? evs.map(eventRow).join('') : `<div class="empty" style="padding:16px">Sem compromissos neste dia.</div>`;
  if (tks.length) l += `<div class="section">Atividades com prazo</div>` + tks.map(taskRow).join('');
  // próximos
  const up = sortedEvents().filter(e => e.start.slice(0, 10) > calSel).slice(0, 5);
  if (up.length) l += `<div class="section">Próximos</div>` + up.map(e => `<div class="ev" data-event="${e.id}"><div class="hr" style="font-size:12px">${parseLocal(e.start).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })}</div><div class="body"><div class="t">${esc(e.title)}</div><div class="s">${fmtHour(e.start)}</div></div></div>`).join('');
  $('#dayList').innerHTML = l;
}
function sideVisible() { return WIDE() ? !db.meta.nocal : $('#cal').classList.contains('open'); }
function openCal(open) { $('#cal').classList.toggle('open', open); $('#calScrim').classList.toggle('open', open); }

// ---------- conversa ----------
function openChat(id) {
  openChatId = id; const c = db.chats.find(x => x.id === id); c.unread = 0; save();
  if (tab === 'wa' || (WIDE() && tab !== 'chats')) { tab = 'chats'; db.meta.view = tab; }
  if (WIDE()) render();
  $('#chatAv').style.background = c.color; $('#chatAv').textContent = c.kind === 'claude' ? '✳' : c.kind === 'group' ? '👥' : c.name[0].toUpperCase();
  $('#chatName').textContent = c.name;
  $('#chatStatus').textContent = chatStatus(c);
  $('#quick').innerHTML = c.kind === 'claude'
    ? [DESK ? '📖 Ler todo o WhatsApp' : '📖 Ler todas as conversas', 'O que tenho hoje?', 'Minha semana', 'Meus lembretes', 'Atividades pendentes'].map(q => `<button data-quick="${esc(q)}">${esc(q)}</button>`).join('')
    : '';
  $('#attach').style.display = c.kind === 'claude' ? 'none' : '';
  $('#chat').classList.add('open'); renderMsgs(); if (!WIDE()) history.pushState({ chat: id }, '');
}
function chatStatus(c) {
  if (c.kind === 'claude') return db.settings.apiKey ? 'online · lendo suas conversas' : 'online · modo básico';
  const who = c.kind === 'group' ? (c.members ? 'Você, ' + c.members : 'Você') : 'toque numa mensagem para opções';
  return (c.watch ? '👁 assistente lendo · ' : '') + who;
}
function closeChat() { openChatId = null; $('#chat').classList.remove('open'); render(); }

function cardHtml(card) {
  if (card.type === 'event') {
    const ev = db.events.find(e => e.id === card.id);
    if (!ev) return `<div class="card"><div class="cb cs">Compromisso removido</div></div>`;
    const n = db.tasks.filter(t => t.eventId === ev.id);
    return `<div class="card"><div class="ch">📅 Compromisso marcado</div><div class="cb">
      <div class="ct">${esc(ev.title)}</div><div class="cs">${esc(fmtWhen(ev))}${ev.location ? ' · 📍 ' + esc(ev.location) : ''}</div>
      ${n.length ? `<div class="cs">${n.map(t => (t.done ? '☑ ' : '☐ ') + esc(t.title)).join('<br>')}</div>` : ''}</div>
      <div class="acts"><button data-gcal="${ev.id}">Google Agenda</button><button data-ics="${ev.id}">.ics</button><button data-event="${ev.id}">Abrir</button></div></div>`;
  }
  const t = db.tasks.find(x => x.id === card.id);
  if (!t) return `<div class="card"><div class="cb cs">Atividade removida</div></div>`;
  const ev = t.eventId && db.events.find(e => e.id === t.eventId);
  const src = t.chatId && t.chatId !== 'claude' && db.chats.find(c => c.id === t.chatId);
  const head = card.alarm ? '⏰ Hora do lembrete!' : t.remindAt ? '🔔 Lembrete criado' : '✅ Atividade criada';
  return `<div class="card"><div class="ch" style="background:${card.alarm ? '#ea0038;color:#fff' : '#ffbc2d;color:#3b2a00'}">${head}</div><div class="cb">
    <div class="ct">${t.done ? '☑' : '☐'} ${esc(t.title)}</div>
    <div class="cs">${t.remindAt ? '🔔 ' + esc(fmtDay(t.remindAt)) + ', ' + fmtHour(t.remindAt) : t.due ? 'Prazo: ' + parseLocal(t.due).toLocaleDateString('pt-BR') : 'Sem prazo'}${ev ? ' · 📅 ' + esc(ev.title) : ''}${src ? ' · 💬 ' + esc(src.name) : ''}</div></div>
    <div class="acts"><button data-toggle="${t.id}">${t.done ? 'Reabrir' : 'Concluir'}</button>${ev ? `<button data-event="${ev.id}">Ver compromisso</button>` : ''}</div></div>`;
}
function renderMsgs() {
  const c = db.chats.find(x => x.id === openChatId); if (!c) return;
  const box = $('#msgs'); box.innerHTML = msgsHtml(c, true); hydrateImgs(box);
  box.scrollTop = box.scrollHeight; box.querySelectorAll('img.ph').forEach(i => i.addEventListener('load', () => { box.scrollTop = box.scrollHeight; }, { once: true }));
}
function msgsHtml(c, menus) {
  let h = '', day = '';
  for (const m of c.messages) {
    const d = ymd(new Date(m.ts));
    if (d !== day) { day = d; h += `<div class="day"><span>${esc(fmtDay(d))}</span></div>`; }
    if (m.card) { h += `<div style="display:flex;justify-content:${m.from === 'me' ? 'flex-end' : 'flex-start'}">${cardHtml(m.card)}</div>`; continue; }
    const img = m.img ? `<img class="ph" data-imgid="${m.img}" alt="foto">` : '';
    const seen = m.read && c.kind !== 'claude' ? ' <span title="lido pela assistente">👁</span>' : '';
    h += `<div class="b ${m.from === 'me' ? 'out' : 'in'} ${m.pending ? 'typing' : ''} ${m.img ? 'hasimg' : ''}" ${menus ? `data-msg="${m.id}"` : ''}>${img}${esc(m.text)}<span class="meta">${msgTime(m.ts)}${seen}${m.from === 'me' ? ' <span class="tick">✓✓</span>' : ''}</span></div>`;
  }
  return h;
}
function renderSide() {
  const box = $('#sideMsgs'); if (!box) return;
  const c = db.chats.find(x => x.id === 'claude');
  const atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 80;
  box.innerHTML = msgsHtml({ ...c, messages: c.messages.slice(-60) }, false); hydrateImgs(box);
  if (atBottom || !renderSide.done) box.scrollTop = box.scrollHeight; renderSide.done = true;
  if (sideVisible() && !document.hidden && c.unread) { c.unread = 0; save(); }
  // A fazer (sugestões vindas do WhatsApp)
  const inbox = db.inbox || [];
  const pend = db.tasks.filter(t => !t.done).length;
  let h = '';
  if (inbox.length) {
    h += `<div class="todo-h"><b>📋 A fazer · ${inbox.length} novo(s)</b><button data-act="inbox-all">Adicionar tudo</button></div>`;
    for (const it of inbox.slice(0, 30)) {
      const ic = it.tipo === 'compromisso' ? '📅' : it.tipo === 'lembrete' ? '🔔' : it.tipo === 'responder' ? '💬' : '✅';
      h += `<div class="todo-i ${it.prioridade === 'alta' ? 'alta' : ''}"><div class="tx"><div class="tt">${it.prioridade === 'alta' ? '<span class="pri">urgente</span> ' : ''}${ic} ${esc(it.titulo)}</div>
        <div class="ts">${it.quando ? esc(fmtDay(it.quando)) + (it.quando.length > 10 ? ', ' + fmtHour(it.quando) : '') + ' · ' : ''}${it.pessoa ? esc(it.pessoa) + ' · ' : ''}💬 ${esc(it.conversa || 'WhatsApp')}</div>
        ${it.trecho ? `<div class="tq">“${esc(it.trecho.slice(0, 140))}”</div>` : ''}</div>
        <div class="ta"><button class="ok" data-act="inbox-ok" data-id="${it.id}" title="Adicionar">✓</button><button class="no" data-act="inbox-no" data-id="${it.id}" title="Descartar">✕</button></div></div>`;
    }
  } else {
    h += `<div class="todo-h"><span>${DESK && db.settings.waRead !== false ? '👁 Lendo seu WhatsApp. Nada novo a fazer.' : 'Nada novo a fazer.'}</span>${pend ? `<button data-view="tasks">${pend} pendente(s)</button>` : ''}</div>`;
  }
  $('#todo').innerHTML = h;
  $('#sideStatus').textContent = waSweeping ? (waSweepFull ? 'lendo todas as conversas…' : 'abrindo as conversas não lidas…') : reading || waBusy ? 'lendo mensagens…' : (DESK && db.settings.waRead !== false ? 'lendo seu WhatsApp' : 'online');
}
function pushMsg(chatId, msg) {
  const c = db.chats.find(x => x.id === chatId);
  const m = { id: uid(), ts: new Date().toISOString(), ...msg }; c.messages.push(m);
  const seen = !document.hidden && ((openChatId === chatId && tab !== 'wa') || (chatId === 'claude' && sideVisible()));
  if (m.from === 'them' && !m.pending && !seen) c.unread = (c.unread || 0) + 1;
  save();
  if (openChatId === chatId) renderMsgs();
  if (chatId === 'claude') renderSide();
  if (!seen) { clearTimeout(pushMsg.t); pushMsg.t = setTimeout(render, 50); }
  return m;
}

async function send(text) {
  text = text.trim(); if (!text) return;
  const c = db.chats.find(x => x.id === openChatId);
  const m = pushMsg(c.id, { from: 'me', text });
  $('#input').value = ''; autosize();
  if (c.kind === 'claude') { if (/ler todo o whatsapp/i.test(text)) sweepNow(); else if (/^📖|ler todas as conversas/i.test(text)) await readAll(true); else await askClaude(text); }
  else if (c.watch) queueRead(c.id);
}
async function sendImage(file) {
  const c = db.chats.find(x => x.id === openChatId); if (!c || !file) return;
  try {
    const data = await shrink(file), id = 'img_' + uid(); await imgPut(id, data); imgCache[id] = data;
    const cap = $('#input').value.trim(); $('#input').value = ''; autosize();
    pushMsg(c.id, { from: 'me', text: cap, img: id });
    if (DESK) window.wv1desk.saveFile({ chat: c.name, name: (file.name || 'foto').replace(/\.\w+$/, '') + '.jpg', dataUrl: data });
    if (c.watch) queueRead(c.id);
  } catch { toast('Não consegui abrir a foto'); }
}

// ---------- Claude ----------
const TOOLS = [
  { name: 'criar_compromisso', description: 'Cria um compromisso na agenda do usuário. Use horário local no formato YYYY-MM-DDTHH:MM. Pode já criar atividades vinculadas.',
    input_schema: { type: 'object', properties: {
      titulo: { type: 'string' }, inicio: { type: 'string', description: 'YYYY-MM-DDTHH:MM' }, fim: { type: 'string', description: 'YYYY-MM-DDTHH:MM (opcional; padrão +1h)' },
      local: { type: 'string' }, observacoes: { type: 'string' },
      atividades: { type: 'array', items: { type: 'string' }, description: 'Atividades a vincular a este compromisso' } }, required: ['titulo', 'inicio'] } },
  { name: 'criar_atividade', description: 'Cria uma atividade (tarefa). Pode vincular a um compromisso existente pelo id.',
    input_schema: { type: 'object', properties: { titulo: { type: 'string' }, prazo: { type: 'string', description: 'YYYY-MM-DD (opcional)' }, compromisso_id: { type: 'string' } }, required: ['titulo'] } },
  { name: 'criar_lembrete', description: 'Cria um lembrete com dia e hora: o app avisa o usuário nesse horário. Use para tudo que ele precisa lembrar de fazer ou levar.',
    input_schema: { type: 'object', properties: { titulo: { type: 'string', description: 'Frase curta e acionável, ex.: "Levar certidão de crisma na secretaria da paróquia"' }, quando: { type: 'string', description: 'YYYY-MM-DDTHH:MM' }, compromisso_id: { type: 'string' } }, required: ['titulo', 'quando'] } },
  { name: 'buscar_conversas', description: 'Procura nas conversas e grupos do usuário (texto das mensagens e descrição/transcrição das fotos) e no histórico completo do WhatsApp guardado no Drive (sem limite de data), inclusive nos resumos diários. Use para responder perguntas sobre algo que ele mandou ou que alguém falou.',
    input_schema: { type: 'object', properties: { texto: { type: 'string', description: 'Palavras-chave (vazio = mensagens mais recentes)' }, conversa: { type: 'string', description: 'Nome da conversa (opcional)' } } } },
  { name: 'anotar', description: 'Escreve no bloco "Notas importantes" do usuário (topo do painel): informação de referência que ele vai precisar consultar depois — endereço de obra, número de contrato/processo, valor combinado, código, horário fixo, decisão. Não use para tarefas (use criar_atividade) nem compromissos.',
    input_schema: { type: 'object', properties: { texto: { type: 'string', description: 'Uma frase curta e completa' } }, required: ['texto'] } },
  { name: 'ler_historico', description: 'Lê as últimas mensagens de uma conversa do WhatsApp no histórico completo (arquivo no Drive). Use para "o que o fulano falou", "como ficou aquilo com X", "me atualiza sobre a obra Y".',
    input_schema: { type: 'object', properties: { conversa: { type: 'string', description: 'Nome (ou parte) da conversa ou grupo' }, linhas: { type: 'integer', description: 'Quantas linhas do fim (padrão 60)' } }, required: ['conversa'] } },
  { name: 'vincular_atividade', description: 'Vincula uma atividade existente a um compromisso existente.',
    input_schema: { type: 'object', properties: { atividade_id: { type: 'string' }, compromisso_id: { type: 'string' } }, required: ['atividade_id', 'compromisso_id'] } },
  { name: 'listar_agenda', description: 'Lista compromissos entre duas datas (inclusive) com as atividades vinculadas.',
    input_schema: { type: 'object', properties: { de: { type: 'string', description: 'YYYY-MM-DD' }, ate: { type: 'string', description: 'YYYY-MM-DD' } }, required: ['de', 'ate'] } },
  { name: 'listar_atividades', description: 'Lista atividades. status: pendentes | concluidas | todas.',
    input_schema: { type: 'object', properties: { status: { type: 'string', enum: ['pendentes', 'concluidas', 'todas'] } } } },
  { name: 'atualizar_compromisso', description: 'Altera campos de um compromisso existente (remarcar, mudar local, etc.).',
    input_schema: { type: 'object', properties: { id: { type: 'string' }, titulo: { type: 'string' }, inicio: { type: 'string' }, fim: { type: 'string' }, local: { type: 'string' }, observacoes: { type: 'string' } }, required: ['id'] } },
  { name: 'concluir_atividade', description: 'Marca uma atividade como concluída.',
    input_schema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] } },
  { name: 'excluir_compromisso', description: 'Exclui um compromisso. Só use quando o usuário pedir explicitamente.',
    input_schema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] } }
];

async function runTool(name, i, chatId, srcId) {
  const origin = srcId || chatId;
  const evOut = e => ({ id: e.id, titulo: e.title, inicio: e.start, fim: e.end, local: e.location, atividades: db.tasks.filter(t => t.eventId === e.id).map(t => ({ id: t.id, titulo: t.title, concluida: t.done })) });
  switch (name) {
    case 'criar_compromisso': {
      if (!parseLocal(i.inicio) || isNaN(parseLocal(i.inicio))) return { erro: 'inicio inválido' };
      const ev = addEvent({ title: i.titulo, start: i.inicio.slice(0, 16), end: (i.fim || '').slice(0, 16), location: i.local, notes: i.observacoes, chatId: origin, tasks: i.atividades });
      pushMsg(chatId, { from: 'them', card: { type: 'event', id: ev.id } }); return { ok: true, ...evOut(ev) };
    }
    case 'criar_atividade': {
      const t = addTask({ title: i.titulo, due: i.prazo, eventId: db.events.some(e => e.id === i.compromisso_id) ? i.compromisso_id : null, chatId: origin });
      pushMsg(chatId, { from: 'them', card: { type: 'task', id: t.id } }); return { ok: true, id: t.id };
    }
    case 'criar_lembrete': {
      if (!i.quando || isNaN(parseLocal(i.quando))) return { erro: 'quando inválido' };
      const t = addTask({ title: i.titulo, remindAt: i.quando.slice(0, 16), eventId: db.events.some(e => e.id === i.compromisso_id) ? i.compromisso_id : null, chatId: origin });
      pushMsg(chatId, { from: 'them', card: { type: 'task', id: t.id, remind: true } }); return { ok: true, id: t.id };
    }
    case 'buscar_conversas': {
      const q = (i.texto || '').toLowerCase().split(/\s+/).filter(w => w.length > 2), cn = (i.conversa || '').toLowerCase();
      const out = [];
      for (const c of db.chats) {
        if (c.id === 'claude' || (cn && !c.name.toLowerCase().includes(cn))) continue;
        for (const m of c.messages) {
          const hay = ((m.text || '') + ' ' + (m.desc || '')).toLowerCase();
          if (!hay.trim() || (q.length && !q.some(w => hay.includes(w)))) continue;
          out.push({ conversa: c.name, data: m.ts.slice(0, 16), texto: m.text || '', foto: m.img ? (m.desc || 'foto sem descrição') : undefined });
        }
      }
      for (const m of db.waLog) {
        const hay = (m.text + ' ' + m.who).toLowerCase();
        if ((cn && !m.chat.toLowerCase().includes(cn)) || (q.length && !q.some(w => hay.includes(w)))) continue;
        out.push({ conversa: m.chat + ' (WhatsApp)', data: m.when, de: m.who, texto: m.text });
      }
      if (DESK && window.wv1desk.logSearch) { // histórico completo no Drive (além dos 30 dias guardados no app)
        try {
          for (const h of await window.wv1desk.logSearch({ texto: i.texto || '', conversa: i.conversa || '', limite: 30 })) {
            const body = h.texto.replace(/^\d{2}:\d{2} [^:]*: /, '').slice(0, 120);
            if (!out.some(o => (o.texto || '').slice(0, 120) === body)) out.push({ conversa: h.origem, data: h.data, texto: h.texto });
          }
        } catch {}
      }
      out.sort((a, b) => a.data.localeCompare(b.data));
      return out.slice(-40);
    }
    case 'anotar': return addNote(i.texto) ? { ok: true } : { ok: false, motivo: 'já estava anotado ou vazio' };
    case 'ler_historico': return DESK ? await window.wv1desk.logRead({ conversa: i.conversa || '', linhas: i.linhas }) : { erro: 'histórico só no app do computador' };
    case 'registrar_descricao': {
      for (const c of db.chats) { const m = c.messages.find(x => x.id === i.mensagem_id); if (m) { m.desc = i.descricao; save(); return { ok: true }; } }
      return { erro: 'mensagem não encontrada' };
    }
    case 'vincular_atividade': {
      const t = db.tasks.find(x => x.id === i.atividade_id); if (!t || !db.events.some(e => e.id === i.compromisso_id)) return { erro: 'id não encontrado' };
      t.eventId = i.compromisso_id; save(); return { ok: true };
    }
    case 'listar_agenda': return db.events.filter(e => e.start.slice(0, 10) >= i.de && e.start.slice(0, 10) <= i.ate).sort((a, b) => a.start.localeCompare(b.start)).map(evOut);
    case 'listar_atividades': return db.tasks.filter(t => !i.status || i.status === 'todas' || (i.status === 'concluidas' ? t.done : !t.done)).map(t => ({ id: t.id, titulo: t.title, prazo: t.due, concluida: t.done, compromisso_id: t.eventId }));
    case 'atualizar_compromisso': {
      const e = db.events.find(x => x.id === i.id); if (!e) return { erro: 'não encontrado' };
      if (i.titulo) e.title = i.titulo; if (i.inicio) e.start = i.inicio.slice(0, 16); if (i.fim !== undefined) e.end = (i.fim || '').slice(0, 16);
      if (i.local !== undefined) e.location = i.local; if (i.observacoes !== undefined) e.notes = i.observacoes; save();
      pushMsg(chatId, { from: 'them', card: { type: 'event', id: e.id } }); return { ok: true, ...evOut(e) };
    }
    case 'concluir_atividade': { const t = db.tasks.find(x => x.id === i.id); if (!t) return { erro: 'não encontrada' }; t.done = true; save(); return { ok: true }; }
    case 'excluir_compromisso': { if (!db.events.some(e => e.id === i.id)) return { erro: 'não encontrado' }; delEvent(i.id); return { ok: true }; }
  }
  return { erro: 'ferramenta desconhecida' };
}

// resumos dos últimos dias (arquivos em Resumos/ no Drive) ficam sempre no contexto da assistente
let recentSums = '';
async function refreshSums() { if (!DESK || !window.wv1desk.summaryRecent) return; try { recentSums = (await window.wv1desk.summaryRecent({ dias: 3, max: 3500 })) || ''; } catch {} }
function systemPrompt() {
  const now = new Date();
  const up = sortedEvents().filter(e => e.start >= localISO(now).slice(0, 10)).slice(0, 15).map(e => `- [${e.id}] ${e.start} ${e.title}${e.location ? ' @ ' + e.location : ''}`).join('\n') || '(nenhum)';
  const pend = db.tasks.filter(t => !t.done).slice(0, 25).map(t => `- [${t.id}] ${t.title}${t.remindAt ? ' (lembrete ' + t.remindAt + ')' : t.due ? ' (prazo ' + t.due + ')' : ''}${t.eventId ? ' → compromisso ' + t.eventId : ''}`).join('\n') || '(nenhuma)';
  const pendTasks = db.tasks.filter(t => !t.done);
  return `Você é a assistente pessoal (Claude) dentro do app "WhatsApp v1", o app pessoal de ${db.settings.myName || 'o usuário'}. Você lê as conversas e grupos dele, cria lembretes e o ajuda a não esquecer nada. Responda em português do Brasil, curto e no tom de conversa de WhatsApp (sem markdown pesado).
Para perguntas sobre algo que ele mandou nas conversas (documentos, fotos, datas, nomes), use buscar_conversas antes de responder e cite de qual conversa veio. Para "me lembra de...", use criar_lembrete; se ele não disser a hora, use 08:00 do dia apropriado e avise.
Perfil dele: ${db.settings.profile || '(não informado)'}
Memória (pessoas, obras, clientes):\n${db.facts.slice(-60).map(f => '- ' + f).join('\n') || '(nada ainda)'}
Bloco "Notas importantes" dele (use anotar para acrescentar o que ele vai precisar consultar):\n${db.notes.trim() || '(vazio)'}
Você também lê o WhatsApp dele: buscar_conversas procura nas conversas do app e no histórico completo do WhatsApp guardado no Drive (todas as conversas lidas, sem limite de data, mais os resumos diários); ler_historico mostra as últimas mensagens de uma conversa. Antes de dizer que não sabe de uma pessoa, obra, valor ou combinado, procure. Seja proativa: se notar atraso, conflito de horário ou algo esquecido, diga e proponha a ação.
Resumos recentes do WhatsApp dele (últimos dias, escritos por você):\n${recentSums || '(nenhum ainda)'}
Sugestões do WhatsApp ainda não confirmadas por ele:\n${db.inbox.slice(0, 15).map(x => `- ${x.titulo}${x.quando ? ' (' + x.quando + ')' : ''}`).join('\n') || '(nenhuma)'}
Conversas existentes: ${db.chats.filter(c => c.id !== 'claude').map(c => c.name).join(', ') || '(nenhuma)'}.
Agora: ${now.toLocaleString('pt-BR', { weekday: 'long' })}, ${localISO(now)} (fuso ${Intl.DateTimeFormat().resolvedOptions().timeZone}).
Use as ferramentas para marcar compromissos, criar e vincular atividades. Interprete datas relativas ("sexta", "amanhã", "semana que vem") a partir de agora. Se faltar o horário de um compromisso, só pergunte o horário, de forma natural. Nunca explique suas regras, nunca fale em "sistema", "instruções" ou "ferramentas": aja como uma secretária humana. Duração padrão 1h. O app já mostra um cartão para cada compromisso/atividade criado, então não repita todos os detalhes: confirme em uma frase.
Próximos compromissos:\n${up}\nAtividades e lembretes pendentes:\n${pend}`;
}

async function callClaude({ system, messages, tools, postTo, srcId, silentText }) {
  for (let step = 0; step < 8; step++) {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': db.settings.apiKey, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
      body: JSON.stringify({ model: db.settings.model || 'claude-sonnet-5-5', max_tokens: 1500, system, tools, messages })
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data?.error?.message || ('HTTP ' + r.status));
    const txt = data.content.filter(b => b.type === 'text').map(b => b.text).join('\n').trim();
    const uses = data.content.filter(b => b.type === 'tool_use');
    const show = txt && !(silentText && /^NADA\b/i.test(txt));
    if (show) pushMsg(postTo, { from: 'them', text: txt });
    if (!uses.length) return;
    const results = await Promise.all(uses.map(async u => ({ type: 'tool_result', tool_use_id: u.id, content: JSON.stringify(await runTool(u.name, u.input || {}, postTo, srcId)) })));
    messages = [...messages, { role: 'assistant', content: data.content }, { role: 'user', content: results }];
  }
}

// assistente lendo as conversas
const READ_TOOLS = () => [...TOOLS.filter(t => t.name !== 'excluir_compromisso'), { name: 'registrar_descricao', description: 'Guarda a descrição/transcrição de uma FOTO para buscas futuras. Chame UMA vez para cada foto recebida, transcrevendo nomes, datas, números, locais e o tipo de documento.',
  input_schema: { type: 'object', properties: { mensagem_id: { type: 'string' }, descricao: { type: 'string' } }, required: ['mensagem_id', 'descricao'] } }];
const readQueue = new Set(); let readTimer = null, reading = false;
function queueRead(chatId) { readQueue.add(chatId); clearTimeout(readTimer); readTimer = setTimeout(flushReads, 4000); }
async function flushReads() {
  if (reading) { readTimer = setTimeout(flushReads, 3000); return; }
  const ids = [...readQueue]; readQueue.clear();
  for (const id of ids) await readChat(id);
}
async function readAll(announce) {
  const chats = db.chats.filter(c => c.id !== 'claude' && c.watch && c.messages.some(m => !m.read && !m.card && (m.text || m.img)));
  if (!chats.length) { if (announce) pushMsg('claude', { from: 'them', text: 'Já li tudo. Nenhuma mensagem nova nas conversas. 👍' }); return; }
  if (announce) pushMsg('claude', { from: 'them', text: `Lendo ${chats.length} conversa(s)…` });
  let before = db.tasks.length + db.events.length;
  for (const c of chats) await readChat(c.id);
  if (announce) { const n = db.tasks.length + db.events.length - before; pushMsg('claude', { from: 'them', text: n ? `Pronto: criei ${n} item(ns) a partir das conversas.` : 'Li tudo e não achei nada novo para lembrar.' }); }
}
async function readChat(chatId) {
  const c = db.chats.find(x => x.id === chatId); if (!c || !c.watch) return;
  const fresh = c.messages.filter(m => !m.read && !m.card && (m.text || m.img));
  if (!fresh.length) return;
  reading = true;
  try {
    if (!db.settings.apiKey) {
      for (const m of fresh) { m.read = true; if (m.text) basicReader(m.text, c.id); }
      save(); return;
    }
    for (let k = 0; k < fresh.length; k += 12) {
      const batch = fresh.slice(k, k + 12), content = [];
      content.push({ type: 'text', text: `Mensagens novas na conversa "${c.name}"${c.kind === 'group' ? ' (grupo' + (c.members ? ' com ' + c.members : '') + ')' : ''}. Contexto anterior:\n` +
        c.messages.filter(m => m.read && m.text).slice(-6).map(m => `- ${m.text}`).join('\n') });
      for (const m of batch) {
        content.push({ type: 'text', text: `[mensagem ${m.id} · ${m.ts.slice(0, 16)}] ${m.text || '(foto sem legenda)'}` });
        if (m.img) { const d = await imgGet(m.img); if (d) content.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: d.split(',')[1] } }); }
      }
      content.push({ type: 'text', text: 'Leia essas mensagens como a assistente do usuário. 1) Para cada foto, chame registrar_descricao com a transcrição útil. 2) Se houver algo que ele precisa lembrar, fazer, levar, pagar, entregar ou um compromisso com data, crie com criar_lembrete / criar_compromisso / criar_atividade (sem duplicar o que já existe na lista de pendentes). Se a data for vaga, escolha uma data razoável e diga qual. 3) Responda em UMA frase curta dizendo o que anotou (cite a conversa). Se não houver nada a lembrar, responda só: NADA' });
      $('#chatStatus') && openChatId === 'claude' && ($('#chatStatus').textContent = 'lendo ' + c.name + '…');
      await callClaude({ system: systemPrompt(), messages: [{ role: 'user', content }], tools: READ_TOOLS(), postTo: 'claude', srcId: c.id, silentText: true });
      batch.forEach(m => { m.read = true; }); save();
    }
  } catch (e) {
    pushMsg('claude', { from: 'them', text: `⚠️ Não consegui ler "${c.name}": ${e.message}` });
  } finally {
    reading = false; render(); if (openChatId) { renderMsgs(); $('#chatStatus').textContent = chatStatus(db.chats.find(x => x.id === openChatId)); }
  }
}
function basicReader(text, chatId) {
  const p = parseBasic(text);
  if (!p.date) return;
  p.date.setHours(p.hh ?? 8, p.mm, 0, 0);
  const t = addTask({ title: p.title || text.slice(0, 80), remindAt: localISO(p.date), chatId });
  pushMsg('claude', { from: 'them', card: { type: 'task', id: t.id, remind: true } });
}

async function askClaude(text) {
  const chatId = 'claude';
  if (!db.settings.apiKey) return basicAssistant(text, chatId);
  const c = db.chats.find(x => x.id === chatId);
  // histórico textual recente
  const hist = [];
  for (const m of c.messages.filter(m => m.text && !m.pending).slice(-20)) {
    const role = m.from === 'me' ? 'user' : 'assistant';
    if (hist.length && hist[hist.length - 1].role === role) hist[hist.length - 1].content += '\n' + m.text;
    else hist.push({ role, content: m.text });
  }
  while (hist.length && hist[0].role !== 'user') hist.shift();
  const typing = pushMsg(chatId, { from: 'them', text: 'digitando…', pending: true }); $('#sideStatus').textContent = 'digitando…';
  $('#chatStatus').textContent = 'digitando…';
  try {
    await callClaude({ system: systemPrompt(), messages: hist, tools: TOOLS, postTo: chatId });
  } catch (e) {
    pushMsg(chatId, { from: 'them', text: '⚠️ Não consegui falar com o Claude: ' + e.message + '\nConfira a chave em Configurações. Enquanto isso, tento no modo básico.' });
    basicAssistant(text, chatId);
  } finally {
    c.messages = c.messages.filter(m => m.id !== typing.id); save();
    if (openChatId === chatId) { renderMsgs(); $('#chatStatus').textContent = chatStatus(c); }
    render();
  }
}

// modo básico: entende frases simples sem chave da API
const WDN = { domingo: 0, segunda: 1, terca: 2, 'terça': 2, quarta: 3, quinta: 4, sexta: 5, sabado: 6, 'sábado': 6 };
function parseBasic(text) {
  const t = ' ' + text.toLowerCase() + ' ';
  const now = new Date(); let date = null, rm = [];
  let m;
  if ((m = t.match(/\bdepois de amanh[ãa](?![\wà-ú])/))) { date = new Date(now); date.setDate(now.getDate() + 2); rm.push(m[0]); }
  else if ((m = t.match(/\bamanh[ãa](?![\wà-ú])/))) { date = new Date(now); date.setDate(now.getDate() + 1); rm.push(m[0]); }
  else if ((m = t.match(/\bhoje\b/))) { date = new Date(now); rm.push(m[0]); }
  else if ((m = t.match(/\b(?:dia\s+)?(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/))) {
    let y = m[3] ? +m[3] : now.getFullYear(); if (y < 100) y += 2000;
    date = new Date(y, +m[2] - 1, +m[1]); if (!m[3] && date < new Date(now.getFullYear(), now.getMonth(), now.getDate())) date.setFullYear(y + 1); rm.push(m[0]);
  } else if ((m = t.match(/\b(?:na |no |nesta |neste |pr[óo]xim[ao] )?(domingo|segunda|ter[çc]a|quarta|quinta|sexta|s[áa]bado)(?:-feira)?(?![\wà-ú])/))) {
    const wd = WDN[m[1]] ?? WDN[m[1].normalize('NFD').replace(/[̀-ͯ]/g, '')];
    date = new Date(now); let add = (wd - now.getDay() + 7) % 7; if (add === 0) add = 7; date.setDate(now.getDate() + add); rm.push(m[0]);
  }
  let hh = null, mm = 0;
  if ((m = t.match(/\b(?:[àa]s?\s+)?(\d{1,2})(?:h|:)(\d{2})?\s*(?:h|hs|horas)?\b/))) { hh = +m[1]; mm = +(m[2] || 0); rm.push(m[0]); }
  let title = text; rm.forEach(r => { title = title.replace(new RegExp(r.trim().replace(/[.*+?^${}()|[\]\\/]/g, '\\$&'), 'i'), ' '); });
  title = title.replace(/\b(marca(r)?|agenda(r)?|marque|cria(r)?|crie|lembra(r)?|me lembre de|para|pra)\b/gi, ' ').replace(/\s+/g, ' ').trim();
  title = title.charAt(0).toUpperCase() + title.slice(1);
  return { date, hh, mm, title };
}
function basicAssistant(text, chatId) {
  const low = text.toLowerCase();
  if (/o que tenho hoje|agenda de hoje|hoje\?$/.test(low) || /minha semana/.test(low)) {
    const from = ymd(new Date()), to = new Date(); to.setDate(to.getDate() + (/semana/.test(low) ? 7 : 0));
    const evs = sortedEvents().filter(e => e.start.slice(0, 10) >= from && e.start.slice(0, 10) <= ymd(to));
    pushMsg(chatId, { from: 'them', text: evs.length ? evs.map(e => `• ${fmtWhen(e)} — ${e.title}`).join('\n') : 'Nada marcado nesse período. 👌' });
    return;
  }
  if (/meus lembretes/.test(low)) {
    const ts = db.tasks.filter(t => !t.done && t.remindAt).sort((a, b) => a.remindAt.localeCompare(b.remindAt));
    pushMsg(chatId, { from: 'them', text: ts.length ? ts.map(t => `🔔 ${fmtDay(t.remindAt)} ${fmtHour(t.remindAt)} — ${t.title}`).join('\n') : 'Nenhum lembrete pendente.' });
    return;
  }
  if (/^me lembr|^lembr/.test(low)) {
    const p = parseBasic(text);
    const d = p.date || new Date(Date.now() + 864e5); d.setHours(p.hh ?? 8, p.mm, 0, 0);
    const t = addTask({ title: p.title.replace(/^(me )?lembr\w*\s*(de\s+)?/i, '') || text, remindAt: localISO(d), chatId });
    pushMsg(chatId, { from: 'them', card: { type: 'task', id: t.id, remind: true } });
    render(); return;
  }
  if (/pendente|atividades/.test(low) && !/cri|marc/.test(low)) {
    const ts = db.tasks.filter(t => !t.done);
    pushMsg(chatId, { from: 'them', text: ts.length ? ts.map(t => '☐ ' + t.title).join('\n') : 'Nenhuma atividade pendente. ✅' });
    return;
  }
  const p = parseBasic(text);
  if (p.date && p.hh !== null) {
    p.date.setHours(p.hh, p.mm, 0, 0);
    const ev = addEvent({ title: p.title || 'Compromisso', start: localISO(p.date), chatId });
    pushMsg(chatId, { from: 'them', card: { type: 'event', id: ev.id } });
    pushMsg(chatId, { from: 'them', text: 'Marcado! Toque em "Google Agenda" para mandar para o seu calendário.' });
  } else if (/^(atividade|tarefa|lembrar|lembra|fazer|todo)\b/i.test(text.trim()) || p.date) {
    const t = addTask({ title: p.title.replace(/^(atividade|tarefa|fazer|todo)\s*:?\s*/i, '') || text, due: p.date ? ymd(p.date) : '', chatId });
    pushMsg(chatId, { from: 'them', card: { type: 'task', id: t.id } });
  } else {
    pushMsg(chatId, { from: 'them', text: 'No modo básico eu entendo frases como:\n• "reunião com Alex amanhã 14h"\n• "vistoria sexta 9h30"\n• "tarefa: enviar laudo dia 05/11"\n\nPara conversar livremente, cole sua chave da API em Configurações (⋮).' });
  }
  render();
}

// ---------- folhas (modais) ----------
function sheet(html) { $('#sheet').innerHTML = html; $('#sheetBg').classList.add('open'); }
function closeSheet() { $('#sheetBg').classList.remove('open'); }

function eventForm(ev = {}, presetDay) {
  const start = ev.start || (presetDay ? presetDay + 'T09:00' : localISO(new Date(Math.ceil(Date.now() / 36e5) * 36e5)));
  sheet(`<h2>${ev.id ? 'Editar compromisso' : 'Novo compromisso'}</h2>
    <div class="field"><label>Título</label><input id="fT" value="${esc(ev.title)}" placeholder="Ex.: Reunião obra BR-280"></div>
    <div class="field"><label>Início</label><input id="fS" type="datetime-local" value="${esc(start)}"></div>
    <div class="field"><label>Fim</label><input id="fE" type="datetime-local" value="${esc(ev.end)}"></div>
    <div class="field"><label>Local</label><input id="fL" value="${esc(ev.location)}"></div>
    <div class="field"><label>Observações</label><textarea id="fN" rows="2">${esc(ev.notes)}</textarea></div>
    ${ev.id ? '' : `<div class="field"><label>Atividades (uma por linha)</label><textarea id="fA" rows="2" placeholder="Levar relatório&#10;Confirmar equipe"></textarea></div>`}
    <div class="btns">${ev.id ? `<button class="btn" data-act="del-event" data-id="${ev.id}" style="color:#ea0038">Excluir</button>` : ''}
      <button class="btn" data-act="close">Cancelar</button><button class="btn pri" data-act="save-event" data-id="${ev.id || ''}">Salvar</button></div>`);
}
function eventDetail(id) {
  const ev = db.events.find(e => e.id === id); if (!ev) return;
  const ts = db.tasks.filter(t => t.eventId === id);
  const chat = ev.chatId && db.chats.find(c => c.id === ev.chatId);
  sheet(`<h2>${esc(ev.title)}</h2>
    <div class="field"><div>📅 ${esc(fmtWhen(ev))}</div>${ev.location ? `<div style="margin-top:6px">📍 ${esc(ev.location)}</div>` : ''}
    ${ev.notes ? `<div style="margin-top:6px;color:var(--muted)">${esc(ev.notes)}</div>` : ''}
    ${chat ? `<div style="margin-top:6px"><span class="chip link" data-gochat="${chat.id}">💬 ${esc(chat.name)}</span></div>` : ''}</div>
    <div class="section">Atividades vinculadas</div>
    ${ts.map(taskRow).join('') || '<div class="field" style="color:var(--muted)">Nenhuma ainda.</div>'}
    <div class="field" style="display:flex;gap:8px"><input id="newTask" placeholder="Adicionar atividade…"><button class="btn" data-act="add-task-ev" data-id="${id}">Adicionar</button></div>
    <div class="btns"><button class="btn" data-ics="${id}">Baixar .ics</button><button class="btn" data-act="edit-event" data-id="${id}">Editar</button><button class="btn pri" data-gcal="${id}">Google Agenda</button></div>`);
}
function taskForm(t = {}) {
  const opts = sortedEvents().filter(e => e.start.slice(0, 10) >= ymd(new Date()) || e.id === t.eventId)
    .map(e => `<option value="${e.id}" ${e.id === t.eventId ? 'selected' : ''}>${esc(fmtDay(e.start))} ${fmtHour(e.start)} · ${esc(e.title)}</option>`).join('');
  sheet(`<h2>${t.id ? 'Editar atividade' : 'Nova atividade'}</h2>
    <div class="field"><label>Atividade</label><input id="tT" value="${esc(t.title)}"></div>
    <div class="field"><label>Prazo</label><input id="tD" type="date" value="${esc(t.due)}"></div>
    <div class="field"><label>🔔 Lembrar em (opcional)</label><input id="tR" type="datetime-local" value="${esc(t.remindAt)}"></div>
    <div class="field"><label>Vincular a compromisso</label><select id="tE"><option value="">— nenhum —</option>${opts}</select></div>
    <div class="btns">${t.id ? `<button class="btn" data-act="del-task" data-id="${t.id}" style="color:#ea0038">Excluir</button>` : ''}
      <button class="btn" data-act="close">Cancelar</button><button class="btn pri" data-act="save-task" data-id="${t.id || ''}">Salvar</button></div>`);
}
function settingsSheet() {
  const s = db.settings;
  sheet(`<h2>Configurações</h2>
    <div class="field"><label>Seu nome</label><input id="sN" value="${esc(s.myName)}"></div>
    <div class="field"><label>Chave da API do Claude</label><input id="sK" type="password" value="${esc(s.apiKey)}" placeholder="sk-ant-…" autocomplete="off">
      <div class="hint">Crie em console.anthropic.com → API Keys. Fica salva só neste aparelho e vai direto para a Anthropic. Sem chave, o Claude funciona no modo básico.</div></div>
    <div class="field"><label>Modelo</label><input id="sM" value="${esc(s.model)}"></div>
    ${DESK ? `<div class="field"><label>WhatsApp</label>
      <label style="display:flex;gap:8px;align-items:center;color:var(--text);font-weight:400"><input type="checkbox" id="sW" ${s.waRead !== false ? 'checked' : ''} style="width:auto"> Assistente lê minhas mensagens e lista o que fazer</label>
      <label style="display:flex;gap:8px;align-items:center;color:var(--text);font-weight:400;margin-top:6px"><input type="checkbox" id="sA" ${s.waAuto ? 'checked' : ''} style="width:auto"> Adicionar direto, sem pedir confirmação</label>
      <label style="display:flex;gap:8px;align-items:center;color:var(--text);font-weight:400;margin-top:6px"><input type="checkbox" id="sS" ${s.waSweep !== false ? 'checked' : ''} style="width:auto"> Ler tudo: abrir cada conversa não lida quando eu não estiver usando (e todas a cada 2 h). Abrir marca a conversa como lida no WhatsApp.</label>
      <label style="display:flex;gap:8px;align-items:center;color:var(--text);font-weight:400;margin-top:6px"><input type="checkbox" id="sL" ${s.driveLog !== false ? 'checked' : ''} style="width:auto"> Guardar no Drive o texto das conversas lidas e os resumos do dia (WhatsApp v1/Conversas e Resumos)</label>
      <input id="sI" value="${esc(s.waIgnore || '')}" placeholder="Ignorar conversas (nomes separados por vírgula)" style="margin-top:6px">
      <div class="hint">Abrir a conversa marca como lida no WhatsApp (e manda o visto azul, se ativo). O texto vai para a Anthropic para análise (custo por uso da sua chave).</div></div>
    <div class="field"><label>Sobre você e seu trabalho</label><textarea id="sP" rows="3">${esc(s.profile || '')}</textarea><div class="hint">Ajuda a assistente a entender o que é com você nas mensagens.</div></div>
    <div class="field"><label>Memória da assistente (${db.facts.length})</label><textarea id="sF" rows="4" placeholder="Uma linha por fato. Ela acrescenta sozinha o que aprende nas conversas.">${esc(db.facts.join('\n'))}</textarea></div>` : ''}
    ${DESK ? `<div class="field"><label>📁 Pasta dos arquivos (Google Drive)</label>
      <div style="font-size:14px;word-break:break-all">${esc(driveInfo?.base || '…')}</div>
      <div class="hint">${driveInfo?.detected ? 'Google Drive encontrado: fotos das conversas que você abre e documentos que você baixa no WhatsApp vão para cá, separados por conversa, e o Drive sincroniza sozinho.' : '⚠️ Não achei o Google Drive no PC. Instale o "Google Drive para computador" (google.com/drive/download) e reabra o app, ou escolha a pasta. Enquanto isso salvo em Documentos.'}</div>
      <div class="btns" style="justify-content:flex-start;padding:6px 0 0"><button class="btn" data-act="drive-pick">Escolher pasta</button><button class="btn" data-act="drive-open">Abrir pasta</button></div></div>` : ''}
    <div class="field"><label>Avisos no celular</label><button class="btn pri" data-act="notif" style="margin-top:6px">${'Notification' in window && Notification.permission === 'granted' ? '✓ Avisos ativados' : 'Ativar avisos'}</button>
      <div class="hint">O aviso aparece na hora do lembrete com o app aberto ou em segundo plano. Com o app totalmente fechado o celular pode atrasar; para garantia, mande o compromisso pro Google Agenda.</div></div>
    <div class="btns"><button class="btn" data-act="export">Backup (exportar)</button><button class="btn" data-act="import">Restaurar</button></div>
    <div class="btns"><button class="btn" data-act="close">Cancelar</button><button class="btn pri" data-act="save-settings">Salvar</button></div>`);
}
function newChatSheet() {
  sheet(`<h2>Nova conversa</h2>
    <div class="filters" style="padding:4px 20px"><button data-act="ctype" data-id="normal" class="on">💬 Conversa</button><button data-act="ctype" data-id="group">👥 Grupo</button></div>
    <div class="field"><label>Nome (pessoa, obra, projeto, grupo…)</label><input id="cN" placeholder="Ex.: Cadê o documento?"></div>
    <div class="field" id="cMw" style="display:none"><label>Participantes (só para referência)</label><input id="cM" placeholder="Ex.: Pri, Yulia"></div>
    <div class="field"><label style="display:flex;gap:8px;align-items:center;color:var(--text);font-weight:400"><input type="checkbox" id="cW" checked style="width:auto"> Assistente lê esta conversa e cria lembretes</label></div>
    <div class="btns"><button class="btn" data-act="close">Cancelar</button><button class="btn pri" data-act="save-chat">Criar</button></div>`);
  setTimeout(() => $('#cN')?.focus(), 50);
}
function msgMenu(msgId) {
  const c = db.chats.find(x => x.id === openChatId), m = c.messages.find(x => x.id === msgId); if (!m) return;
  sheet(`<h2 style="font-size:15px;color:var(--muted);font-weight:400">${m.img ? '📷 ' : ''}“${esc((m.text || m.desc || 'Foto').slice(0, 80))}${(m.text || '').length > 80 ? '…' : ''}”</h2>
    ${m.desc ? `<div class="field" style="font-size:13px;color:var(--muted)">👁 A assistente leu: ${esc(m.desc.slice(0, 300))}</div>` : ''}
    <button class="opt" data-act="msg-task" data-id="${msgId}">✅ Transformar em atividade</button>
    <button class="opt" data-act="msg-event" data-id="${msgId}">📅 Criar compromisso com isso</button>
    <button class="opt" data-act="msg-remind" data-id="${msgId}">🔔 Criar lembrete</button>
    <button class="opt" data-act="msg-claude" data-id="${msgId}">✳ Pedir para a assistente agendar</button>
    <button class="opt" data-act="msg-copy" data-id="${msgId}">📋 Copiar</button>
    <button class="opt danger" data-act="msg-del" data-id="${msgId}">🗑 Apagar</button>`);
}
function chatMenuSheet() {
  const c = db.chats.find(x => x.id === openChatId);
  sheet(`<h2>${esc(c.name)}</h2>
    <button class="opt" data-act="chat-event">📅 Novo compromisso desta conversa</button>
    <button class="opt" data-act="chat-pin">📌 ${c.pinned ? 'Desafixar' : 'Fixar'} conversa</button>
    ${c.kind === 'claude' ? '<button class="opt" data-act="read-all">📖 Ler todas as conversas agora</button>' : `<button class="opt" data-act="chat-watch">${c.watch ? '🙈 Assistente parar de ler esta conversa' : '👁 Assistente ler esta conversa'}</button><button class="opt" data-act="chat-reread">🔁 Assistente reler tudo desta conversa</button>`}
    ${c.kind === 'claude' ? '<button class="opt" data-act="settings">⚙️ Configurar Claude</button>' : `<button class="opt" data-act="chat-rename">✏️ Renomear</button><button class="opt danger" data-act="chat-del">🗑 Apagar conversa</button>`}
    <button class="opt danger" data-act="chat-clear">🧹 Limpar mensagens</button>`);
}

// ---------- eventos de interface ----------
document.addEventListener('click', async e => {
  const el = e.target.closest('[data-view],[data-cfilter],[data-menu],[data-tab],[data-chat],[data-event],[data-toggle],[data-task],[data-filter],[data-day],[data-act],[data-gcal],[data-ics],[data-quick],[data-msg],[data-gochat],[data-opencal]');
  if (!el) return;
  const d = el.dataset;
  if (d.tab) { tab = d.tab; render(); return; }
  if (d.view) { const was = tab; tab = d.view; db.meta.view = tab; save(); render(); if (was === 'wa' && tab !== 'wa' && db.settings.waSweep !== false) setTimeout(() => { if (tab !== 'wa') requestSweep({ full: false, force: true }); }, 3000); if (tab === 'wa' && waSweeping && !manualSweep) requestSweep({ cancel: true }); return; }
  if (d.cfilter) { chatFilter = d.cfilter; render(); return; }
  if (d.opencal !== undefined) { openCal(true); return; }
  if (d.chat) { openChat(d.chat); return; }
  if (d.gochat) { closeSheet(); openCal(false); openChat(d.gochat); return; }
  if (d.toggle) { const t = db.tasks.find(x => x.id === d.toggle); t.done = !t.done; save(); render(); if (openChatId) renderMsgs(); if ($('#sheetBg').classList.contains('open') && el.closest('.sheet')) { const evId = t.eventId; if (evId) eventDetail(evId); } return; }
  if (d.gcal) { window.open(gcalUrl(db.events.find(x => x.id === d.gcal)), '_blank'); return; }
  if (d.ics) { downloadIcs(db.events.find(x => x.id === d.ics)); return; }
  if (d.event && !d.act) { eventDetail(d.event); return; }
  if (d.task && !d.act) { taskForm(db.tasks.find(x => x.id === d.task)); return; }
  if (d.filter) { taskFilter = d.filter; render(); return; }
  if (d.day) { calSel = d.day; renderCal(); return; }
  if (d.quick) { send(d.quick); return; }
  if (d.menu) { msgMenu(d.msg); return; }
  if (d.msg) {
    if (e.target.matches('img.ph') && e.target.src) { sheet(`<img src="${e.target.src}" style="width:100%;display:block">${findMsg(d.msg).desc ? `<div class="field" style="font-size:13px;color:var(--muted)">👁 ${esc(findMsg(d.msg).desc)}</div>` : ''}<div class="btns"><button class="btn" data-act="close">Fechar</button><button class="btn pri" data-msg="${d.msg}" data-menu="1">Opções</button></div>`); return; }
    const c = db.chats.find(x => x.id === openChatId); if (c.kind !== 'claude' || c.messages.find(m => m.id === d.msg)?.from === 'me') msgMenu(d.msg); return;
  }

  const id = d.id;
  switch (d.act) {
    case 'close': closeSheet(); break;
    case 'drive-pick': { const d = await window.wv1desk.drivePick(); if (d) { db.settings.driveDir = d; save(); driveInfo = await window.wv1desk.driveSet(d); settingsSheet(); toast('Pasta definida'); } break; }
    case 'drive-open': window.wv1desk.driveOpen(); break;
    case 'mprev': calMonth = new Date(calMonth.getFullYear(), calMonth.getMonth() - 1, 1); renderCal(); break;
    case 'mnext': calMonth = new Date(calMonth.getFullYear(), calMonth.getMonth() + 1, 1); renderCal(); break;
    case 'inbox-ok': acceptInbox(id); break;
    case 'inbox-no': db.inbox = db.inbox.filter(x => x.id !== id); save(); renderSide(); break;
    case 'inbox-all': [...db.inbox].forEach(x => acceptInbox(x.id, true)); render(); break;
    case 'apply-update': { el.textContent = 'Atualizando…'; el.disabled = true; const r = await window.wv1desk.applyUpdate(); if (r && r.error) { toast('Falhou: ' + r.error); closeSheet(); } break; }
    case 'new-chat': if (tab === 'agenda') eventForm({}); else if (tab === 'tasks') taskForm({}); else newChatSheet(); break;
    case 'settings': settingsSheet(); break;
    case 'new-event-day': eventForm({}, calSel); break;
    case 'save-event': {
      const title = $('#fT').value.trim(), start = $('#fS').value, end = $('#fE').value;
      if (!start) return toast('Informe o início');
      if (end && end < start) return toast('O fim é antes do início');
      if (id) { Object.assign(db.events.find(x => x.id === id), { title: title || 'Compromisso', start, end, location: $('#fL').value.trim(), notes: $('#fN').value.trim() }); save(); }
      else {
        const ev = addEvent({ title, start, end, location: $('#fL').value.trim(), notes: $('#fN').value.trim(), chatId: openChatId, tasks: $('#fA').value.split('\n').map(s => s.trim()).filter(Boolean) });
        if (openChatId) pushMsg(openChatId, { from: 'me', card: { type: 'event', id: ev.id } });
        calSel = start.slice(0, 10); calMonth = startOfMonth(parseLocal(start));
      }
      closeSheet(); render(); toast('Compromisso salvo'); break;
    }
    case 'edit-event': eventForm(db.events.find(x => x.id === id)); break;
    case 'del-event': if (confirm('Excluir este compromisso?')) { delEvent(id); closeSheet(); render(); if (openChatId) renderMsgs(); } break;
    case 'add-task-ev': { const v = $('#newTask').value.trim(); if (!v) return; addTask({ title: v, eventId: id }); eventDetail(id); render(); break; }
    case 'save-task': {
      const title = $('#tT').value.trim(); if (!title) return toast('Escreva a atividade');
      const fields = { title, due: $('#tD').value, remindAt: $('#tR').value, eventId: $('#tE').value || null };
      const old = id && db.tasks.find(x => x.id === id); if (old && old.remindAt !== fields.remindAt) old.notified = false;
      if (id) { Object.assign(db.tasks.find(x => x.id === id), fields); save(); }
      else { const t = addTask({ ...fields, chatId: openChatId }); if (openChatId) pushMsg(openChatId, { from: 'me', card: { type: 'task', id: t.id } }); }
      closeSheet(); render(); break;
    }
    case 'del-task': db.tasks = db.tasks.filter(x => x.id !== id); save(); closeSheet(); render(); if (openChatId) renderMsgs(); break;
    case 'save-settings':
      if ($('#sW')) { db.settings.waRead = $('#sW').checked; db.settings.waAuto = $('#sA').checked; db.settings.waSweep = $('#sS').checked; db.settings.driveLog = $('#sL').checked; db.settings.waIgnore = $('#sI').value.trim(); db.settings.profile = $('#sP').value.trim(); db.facts = $('#sF').value.split('\n').map(x => x.trim()).filter(Boolean); }
      db.settings.myName = $('#sN').value.trim(); db.settings.apiKey = $('#sK').value.trim(); db.settings.model = $('#sM').value.trim() || 'claude-sonnet-5-5';
      save(); closeSheet(); render(); if (openChatId) openChat(openChatId); toast('Salvo'); break;
    case 'export': {
      const copy = { ...db, settings: { ...db.settings, apiKey: '' } };
      const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(copy, null, 1)], { type: 'application/json' }));
      a.download = `whatsapp-v1-backup-${ymd(new Date())}.json`; a.click(); break;
    }
    case 'import': {
      const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'application/json';
      inp.onchange = async () => { try { const data = JSON.parse(await inp.files[0].text()); if (!data.chats) throw 0; data.settings = { ...data.settings, apiKey: db.settings.apiKey }; db = data; save(); closeSheet(); render(); toast('Backup restaurado'); } catch { toast('Arquivo inválido'); } };
      inp.click(); break;
    }
    case 'ctype': document.querySelectorAll('[data-act="ctype"]').forEach(b => b.classList.toggle('on', b === el)); $('#cMw').style.display = id === 'group' ? '' : 'none'; break;
    case 'save-chat': {
      const n = $('#cN').value.trim(); if (!n) return;
      const kind = document.querySelector('[data-act="ctype"].on')?.dataset.id || 'normal';
      const c = { id: uid(), name: n, kind, members: kind === 'group' ? $('#cM').value.trim() : '', watch: $('#cW').checked, color: COLORS[db.chats.length % COLORS.length], pinned: false, messages: [] };
      db.chats.push(c); save(); closeSheet(); render(); openChat(c.id); break;
    }
    case 'msg-task': { const m = findMsg(id); closeSheet(); taskForm({ title: m.text.slice(0, 120) }); break; }
    case 'msg-event': {
      const m = findMsg(id), p = parseBasic(m.text); closeSheet();
      let start = ''; if (p.date) { p.date.setHours(p.hh ?? 9, p.mm, 0, 0); start = localISO(p.date); }
      eventForm({ title: p.title || m.text.slice(0, 80), start }); break;
    }
    case 'msg-claude': {
      const m = findMsg(id), from = db.chats.find(x => x.id === openChatId).name; closeSheet();
      openChat('claude'); send(`Da conversa "${from}": ${m.text || ''}${m.desc ? '\n(foto: ' + m.desc + ')' : ''}\n\nMarque na agenda e crie os lembretes e atividades que fizerem sentido.`); break;
    }
    case 'msg-remind': {
      const m = findMsg(id), p = parseBasic(m.text || ''); closeSheet();
      const d = p.date || new Date(Date.now() + 864e5); d.setHours(p.hh ?? 8, p.mm, 0, 0);
      taskForm({ title: (p.title || m.text || m.desc || 'Lembrete').slice(0, 120), remindAt: localISO(d) }); break;
    }
    case 'notif': {
      if (!('Notification' in window)) { toast('Este navegador não suporta avisos'); break; }
      const r = await Notification.requestPermission(); toast(r === 'granted' ? 'Avisos ativados' : 'Avisos bloqueados no navegador'); settingsSheet(); break;
    }
    case 'read-all': closeSheet(); readAll(true); break;
    case 'chat-watch': { const c = db.chats.find(x => x.id === openChatId); c.watch = !c.watch; save(); closeSheet(); $('#chatStatus').textContent = chatStatus(c); if (c.watch) queueRead(c.id); break; }
    case 'chat-reread': { const c = db.chats.find(x => x.id === openChatId); c.messages.forEach(m => { m.read = false; }); c.watch = true; save(); closeSheet(); toast('A assistente vai reler esta conversa'); readChat(c.id); break; }
    case 'msg-copy': navigator.clipboard?.writeText(findMsg(id).text || findMsg(id).desc || ''); closeSheet(); toast('Copiado'); break;
    case 'msg-del': { const c = db.chats.find(x => x.id === openChatId); const m = c.messages.find(x => x.id === id); if (m?.img) imgDel(m.img); c.messages = c.messages.filter(x => x.id !== id); save(); closeSheet(); renderMsgs(); break; }
    case 'chat-event': closeSheet(); eventForm({}); break;
    case 'chat-pin': { const c = db.chats.find(x => x.id === openChatId); c.pinned = !c.pinned; save(); closeSheet(); break; }
    case 'chat-rename': { const c = db.chats.find(x => x.id === openChatId); const n = prompt('Novo nome', c.name); if (n) { c.name = n.trim(); save(); openChat(c.id); } closeSheet(); break; }
    case 'chat-clear': if (confirm('Apagar todas as mensagens desta conversa? Compromissos e atividades continuam.')) { db.chats.find(x => x.id === openChatId).messages = []; save(); renderMsgs(); } closeSheet(); break;
    case 'chat-del': if (confirm('Apagar esta conversa?')) { db.chats = db.chats.filter(x => x.id !== openChatId); save(); closeSheet(); closeChat(); } break;
  }
});
function findMsg(id) { return db.chats.find(x => x.id === openChatId).messages.find(m => m.id === id); }

$('#sheetBg').addEventListener('click', e => { if (e.target.id === 'sheetBg') closeSheet(); });
$('#calScrim').addEventListener('click', () => openCal(false));
$('#calClose').addEventListener('click', () => openCal(false));
// bloco de notas importantes (topo do painel da assistente): ele escreve, a assistente acrescenta; cópia em Notas.md no Drive
let notesTimer = null;
function notesSync() { clearTimeout(notesTimer); notesTimer = setTimeout(() => { if (DESK && window.wv1desk.notesSave) window.wv1desk.notesSave({ text: db.notes }).catch(() => {}); }, 1500); }
function notesFit() { const t = $('#notesText'); if (!t) return; t.style.height = 'auto'; t.style.height = Math.min(t.scrollHeight + 2, 160) + 'px'; }
function renderNotes() { const t = $('#notesText'); if (!t) return; if (t.value !== db.notes) t.value = db.notes; $('#notes').classList.toggle('closed', !!db.meta.notesClosed); $('#notesToggle').textContent = db.meta.notesClosed ? '▸' : '▾'; notesFit(); }
function addNote(text) {
  const t = String(text || '').trim().replace(/^[•\-*]\s*/, ''); if (!t) return false;
  if (db.notes.toLowerCase().includes(t.toLowerCase())) return false;
  db.notes = (db.notes.trim() ? db.notes.replace(/\s+$/, '') + '\n' : '') + '• ' + t; save(); renderNotes(); notesSync(); return true;
}
if ($('#notesText')) {
  $('#notesText').addEventListener('input', () => { db.notes = $('#notesText').value; save(); notesFit(); notesSync(); });
  $('#notesToggle').addEventListener('click', () => { db.meta.notesClosed = !db.meta.notesClosed; save(); renderNotes(); });
  renderNotes();
}
$('#sideSend').addEventListener('click', () => sendSide());
$('#sideInput').addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendSide(); } });
async function sendSide() {
  const t = $('#sideInput').value.trim(); if (!t) return;
  $('#sideInput').value = '';
  pushMsg('claude', { from: 'me', text: t });
  if (/ler todo o whatsapp/i.test(t)) sweepNow(); else if (/^📖|ler todas as conversas/i.test(t)) await readAll(true); else await askClaude(t);
}
function sweepNow() {
  if (!DESK) return;
  manualSweep = true; pushMsg('claude', { from: 'them', text: 'Vou abrir todas as conversas para ler. Se você mexer no WhatsApp eu paro e volto onde estava.' });
  requestSweep({ full: true, force: true });
}
$('#fab').addEventListener('click', () => { if (tab === 'chats') newChatSheet(); else if (tab === 'agenda') eventForm({}); else taskForm({}); });
$('#btnSettings').addEventListener('click', settingsSheet);
$('#chatBack').addEventListener('click', () => history.back());
$('#chatMenu').addEventListener('click', chatMenuSheet);
$('#send').addEventListener('click', () => send($('#input').value));
$('#input').addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey && window.matchMedia('(pointer:fine)').matches) { e.preventDefault(); send($('#input').value); } });
function autosize() { const t = $('#input'); t.style.height = 'auto'; t.style.height = Math.min(t.scrollHeight, 120) + 'px'; }
$('#input').addEventListener('input', autosize);
document.addEventListener('input', e => { if (e.target.id === 'search') { search = e.target.value; const pos = e.target.selectionStart; $('#view').innerHTML = renderChats(); const si = $('#search'); si.value = search; si.focus(); si.setSelectionRange(pos, pos); } });
window.addEventListener('popstate', () => { if (openChatId && !WIDE()) closeChat(); });
$('#rbCal').addEventListener('click', () => { db.meta.nocal = !db.meta.nocal; save(); render(); });

// ---------- atualização (app de computador) ----------
async function checkUpdate(silent) {
  if (!DESK) return;
  try {
    const u = await window.wv1desk.checkUpdate();
    $('#rbUpd').classList.toggle('has', !!u.available);
    if (silent) return;
    if (u.error) return toast('Não consegui verificar: ' + u.error);
    if (!u.available) return toast(`Você já está na versão mais nova (${u.current})`);
    sheet(`<h2>Atualização disponível</h2>
      <div class="field">Versão ${esc(u.current)} → <b>${esc(u.latest)}</b>${u.notes ? `<div class="hint" style="font-size:14px;white-space:pre-wrap;margin-top:8px">${esc(u.notes)}</div>` : ''}
      ${u.desktopNeeded ? '<div class="hint" style="color:#ea0038;margin-top:8px">Esta versão precisa do instalador novo: vou abrir a página de download.</div>' : '<div class="hint" style="margin-top:8px">Leva poucos segundos. Suas conversas, lembretes e o login do WhatsApp continuam.</div>'}</div>
      <div class="btns"><button class="btn" data-act="close">Depois</button><button class="btn pri" data-act="apply-update">Atualizar agora</button></div>`);
  } catch (e) { if (!silent) toast('Não consegui verificar a atualização'); }
}
if (DESK) {
  $('#rbUpd').addEventListener('click', () => checkUpdate(false));
  setTimeout(() => checkUpdate(true), 8000); setInterval(() => checkUpdate(true), 6 * 3600e3);
}

// ---------- leitura automática do WhatsApp → lista "A fazer" ----------
db.inbox = db.inbox || []; db.meta.waSeen = db.meta.waSeen || []; db.waLog = db.waLog || []; db.facts = db.facts || []; if (typeof db.notes !== 'string') db.notes = '';
if (db.settings.profile === undefined) db.settings.profile = 'Engenheiro civil em Joinville/SC. Trojan Engenharia (projetos, controle tecnológico de pavimentação, investigação geotécnica, supervisão de contratos públicos) e Grupo NEV (sócio da NEV Geotecnia; sócio: Alex Rafael Niepiçuy).';
const waCtx = {}; db.waLog.slice(-600).forEach(m => { (waCtx[m.chat] = waCtx[m.chat] || []).push(m); });
let waSweeping = false, waSweepFull = false, manualSweep = false, waWv = null;
function requestSweep(o) { try { waWv && waWv.send('wa-sweep', o || {}); } catch {} }
// varredura automática: não lidas a cada 10 min, todas as conversas a cada 2 h (o leitor só executa se o WhatsApp estiver parado)
let lastSweepU = Date.now() - 7 * 60e3, lastSweepF = Date.now() - 105 * 60e3;
function scheduleSweeps() {
  if (!DESK || !waWv || waSweeping || db.settings.waSweep === false || db.settings.waRead === false) return;
  const n = Date.now();
  if (n - lastSweepF > 2 * 3600e3) { lastSweepF = lastSweepU = n; requestSweep({ full: true }); }
  else if (n - lastSweepU > 10 * 60e3) { lastSweepU = n; requestSweep({ full: false }); }
}
const waSeen = new Set(db.meta.waSeen), prevSeen = new Set(); let waQueue = [], waTimer = null, waBusy = false;
function waTs(meta) { // "[14:17, 28/10/2026] Nome: "
  const m = (meta || '').match(/\[(\d{1,2}):(\d{2}),\s*(\d{1,2})\/(\d{1,2})\/(\d{4})\]\s*([^:]*):?/);
  return m ? { d: new Date(+m[5], +m[4] - 1, +m[3], +m[1], +m[2]), who: m[6].trim() } : { d: new Date(), who: '' };
}
function ingestWa(batches) {
  if (db.settings.waRead === false) return;
  const ign = (db.settings.waIgnore || '').toLowerCase().split(',').map(x => x.trim()).filter(Boolean);
  const cutoff = Date.now() - 36 * 3600e3, toLog = {};
  for (const b of batches || []) {
    if (!b.chat || ign.some(x => b.chat.toLowerCase().includes(x))) { (b.msgs || []).forEach(m => waSeen.add(m.id)); continue; }
    for (const m of b.msgs || []) {
      if (waSeen.has(m.id)) continue; waSeen.add(m.id);
      const t = waTs(m.meta);
      if (!m.text || m.text.length < 2) continue;
      const rec = { chat: b.chat, who: m.out ? 'Eu' : (t.who || m.who || b.chat), when: localISO(t.d), text: m.text.slice(0, 800) };
      const isPrev = m.id.startsWith('p:'), pk = b.chat + '|' + rec.text; // prévia da lista (sem hora/autor) vs. mensagem real
      if (isPrev) { rec.prev = 1; prevSeen.add(pk); }
      else if (DESK && db.settings.driveLog !== false) (toLog[b.chat] = toLog[b.chat] || []).push(rec); // histórico completo no Drive
      if (t.d.getTime() < Date.now() - 30 * 864e5) continue;
      let dup = false; // a mensagem real substitui a prévia já guardada (e não vai de novo para a assistente)
      if (!isPrev && prevSeen.has(pk)) { dup = true; prevSeen.delete(pk); const k = db.waLog.findIndex(x => x.prev && x.chat === rec.chat && x.text === rec.text); if (k >= 0) db.waLog.splice(k, 1); if (waCtx[b.chat]) waCtx[b.chat] = waCtx[b.chat].filter(x => !(x.prev && x.text === rec.text)); }
      db.waLog.push(rec); (waCtx[b.chat] = waCtx[b.chat] || []).push(rec); if (waCtx[b.chat].length > 40) waCtx[b.chat].splice(0, waCtx[b.chat].length - 40);
      if (dup || t.d.getTime() < cutoff || m.text.length < 3) continue;
      waQueue.push(rec);
    }
  }
  db.meta.waSeen = [...waSeen].slice(-6000); if (db.waLog.length > 2000) db.waLog.splice(0, db.waLog.length - 2000); save();
  for (const [chat, lines] of Object.entries(toLog)) window.wv1desk.logAppend({ chat, lines: lines.sort((a, b) => a.when.localeCompare(b.when)) }).catch(() => {});
  if (waQueue.length) { clearTimeout(waTimer); waTimer = setTimeout(flushWa, waQueue.length >= 25 ? 2000 : 45000); }
}
function addInbox(it) {
  const key = (it.titulo || '').toLowerCase();
  if (!key || db.inbox.some(x => x.titulo.toLowerCase() === key) || db.tasks.some(t => !t.done && t.title.toLowerCase() === key)) return;
  let quando = (it.quando || '').slice(0, 16), titulo = it.titulo;
  if (it.tipo === 'responder') { if (!/^respond/i.test(titulo)) titulo = 'Responder ' + (it.pessoa || it.conversa || '') + ': ' + titulo; if (quando.length < 16) quando = localISO(new Date(Date.now() + 2 * 3600e3)); }
  const item = { id: uid(), tipo: it.tipo || 'atividade', titulo, quando, conversa: it.conversa || '', pessoa: it.pessoa || '', prioridade: it.prioridade || 'media', motivo: it.motivo || '', trecho: it.trecho || '', ts: new Date().toISOString() };
  db.inbox.unshift(item);
  if (db.settings.waAuto) acceptInbox(item.id, true);
  return item;
}
function acceptInbox(id, quiet) {
  const it = db.inbox.find(x => x.id === id); if (!it) return;
  db.inbox = db.inbox.filter(x => x.id !== id);
  const notes = it.conversa ? `Do WhatsApp (${it.conversa}): ${it.trecho}` : it.trecho;
  if (it.tipo === 'compromisso' && it.quando.length > 10) {
    const ev = addEvent({ title: it.titulo, start: it.quando, notes, chatId: 'claude' });
    pushMsg('claude', { from: 'them', card: { type: 'event', id: ev.id } });
  } else {
    const remindAt = it.tipo === 'lembrete' || it.tipo === 'responder' || it.quando.length > 10 ? (it.quando.length > 10 ? it.quando : (it.quando ? it.quando + 'T08:00' : '')) : '';
    const t = addTask({ title: it.titulo, due: it.quando.slice(0, 10), remindAt, chatId: 'claude' });
    pushMsg('claude', { from: 'them', card: { type: 'task', id: t.id, remind: !!remindAt } });
  }
  save(); if (!quiet) render();
}
async function flushWa() {
  if (waBusy) { waTimer = setTimeout(flushWa, 5000); return; }
  const batch = waQueue.splice(0, 60); if (!batch.length) return;
  waBusy = true; renderSide();
  try {
    if (!db.settings.apiKey) {
      for (const m of batch) { const p = parseBasic(m.text); if (p.date && p.hh !== null) { p.date.setHours(p.hh, p.mm, 0, 0); addInbox({ tipo: 'compromisso', titulo: p.title || m.text.slice(0, 60), quando: localISO(p.date), conversa: m.chat, trecho: m.text }); } }
    } else {
      const byChat = {}; batch.forEach(m => (byChat[m.chat] = byChat[m.chat] || []).push(m));
      const txt = Object.entries(byChat).map(([chat, ms]) => {
        const ctx = (waCtx[chat] || []).filter(m => !ms.includes(m)).slice(-10);
        return `### Conversa: ${chat}\n` + (ctx.length ? 'Contexto anterior (já visto):\n' + ctx.map(m => `- ${m.when.slice(5, 16)} ${m.who}: ${m.text.slice(0, 200)}`).join('\n') + '\n' : '') + 'Mensagens novas:\n' + ms.map(m => `- ${m.when} ${m.who}: ${m.text}`).join('\n');
      }).join('\n\n');
      const pend = db.tasks.filter(t => !t.done).slice(0, 40).map(t => `- [${t.id}] ${t.title}${t.remindAt ? ' (' + t.remindAt + ')' : t.due ? ' (' + t.due + ')' : ''}`).join('\n');
      const sug = db.inbox.map(x => '- ' + x.titulo).join('\n');
      const now = new Date();
      const r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': db.settings.apiKey, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
        body: JSON.stringify({ model: db.settings.model || 'claude-sonnet-5-5', max_tokens: 1500,
          system: `Você é a secretária executiva de ${db.settings.myName || 'o usuário'}. Perfil dele: ${db.settings.profile || '(não informado)'}
O que você já sabe (memória):\n${db.facts.slice(-60).map(f => '- ' + f).join('\n') || '(nada ainda)'}
Você lê as mensagens novas do WhatsApp dele ("Eu" = ele) e age como uma secretária atenta e proativa:
1) Extraia TUDO que exige ação dele ou que ele precisa lembrar: pedidos feitos a ele, perguntas dirigidas a ele ainda sem resposta (tipo "responder"), prazos, entregas, pagamentos, cobranças, documentos a enviar, reuniões/visitas/vistorias com data, e promessas que ele mesmo fez ("Eu: mando amanhã").
2) Dê baixa no que já foi feito: se as mensagens mostram que ele já cumpriu algo dos pendentes (ex.: "Eu: enviado", "Eu: já paguei"), liste o id em "concluidas".
3) Aprenda: fatos úteis e duradouros sobre pessoas, obras, clientes e empresas (quem é quem, papéis, locais, prazos de contrato) vão em "fatos", uma frase curta cada, só se forem novos. Nada de saúde, política, fofoca ou dados sensíveis.
4) Resuma: para cada conversa com novidade de trabalho (decisão, pedido, número, prazo, combinado), 1 a 3 frases objetivas em "resumos", mesmo sem ação para ele. Conversa só social não entra.
5) Notas: informação de referência que ele vai querer consultar depois (endereço de obra, número de contrato/processo/ofício, valor combinado, código, horário fixo, decisão fechada) vai em "notas", uma frase curta e completa cada, só se for nova. Notas já existentes:\n${db.notes.trim().slice(-1500) || '(nenhuma)'}
Ignore conversa social, figurinhas, propaganda, correntes, avisos genéricos de grupo e o que não é com ele. Em grupos grandes, só o que o menciona ou cabe ao papel dele.
Prioridade: alta = prazo em até 24h, cliente ou órgão público cobrando, dinheiro, ou pergunta a ele sem resposta há mais de 2h; media = prazo nesta semana; baixa = o resto.
Agora: ${localISO(now)} (${now.toLocaleDateString('pt-BR', { weekday: 'long' })}). Datas relativas contam a partir da hora de cada mensagem; sem hora, use só a data.
Pendentes já registrados (não repita; use os ids para dar baixa):\n${pend || '(nenhum)'}\nSugestões ainda não confirmadas (não repita):\n${sug || '(nenhuma)'}\nSe não houver nada novo, chame a ferramenta com listas vazias.`,
          tools: [{ name: 'itens_a_fazer', description: 'Resultado da leitura', input_schema: { type: 'object', properties: {
            itens: { type: 'array', items: { type: 'object', properties: {
              tipo: { type: 'string', enum: ['compromisso', 'lembrete', 'atividade', 'responder'] }, titulo: { type: 'string', description: 'Ação curta e concreta, ex.: "Enviar laudo SPT ao Alex"; para responder: "Responder Alex: data da vistoria"' },
              quando: { type: 'string', description: 'YYYY-MM-DDTHH:MM ou YYYY-MM-DD; vazio se não houver' }, conversa: { type: 'string' }, pessoa: { type: 'string', description: 'Quem pediu/perguntou' },
              prioridade: { type: 'string', enum: ['alta', 'media', 'baixa'] }, trecho: { type: 'string', description: 'Trecho da mensagem que originou' }, motivo: { type: 'string', description: 'Uma linha: por que isso importa' } }, required: ['tipo', 'titulo', 'conversa', 'prioridade'] } },
            concluidas: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, motivo: { type: 'string' } }, required: ['id'] } },
            fatos: { type: 'array', items: { type: 'string' } },
            resumos: { type: 'array', items: { type: 'object', properties: { conversa: { type: 'string' }, resumo: { type: 'string' } }, required: ['conversa', 'resumo'] } },
            notas: { type: 'array', items: { type: 'string' } } }, required: ['itens'] } }],
          tool_choice: { type: 'tool', name: 'itens_a_fazer' },
          messages: [{ role: 'user', content: txt }] })
      });
      const data = await r.json(); if (!r.ok) throw new Error(data?.error?.message || ('HTTP ' + r.status));
      const use = data.content.find(b => b.type === 'tool_use'), out = use?.input || {};
      const novos = (out.itens || []).map(addInbox).filter(Boolean);
      const baixas = [];
      for (const c of out.concluidas || []) { const t = db.tasks.find(x => x.id === c.id && !x.done); if (t) { t.done = true; baixas.push(t.title + (c.motivo ? ' (' + c.motivo + ')' : '')); } }
      for (const f of out.fatos || []) { const k = String(f).trim(); if (k && k.length < 200 && !db.facts.some(x => x.toLowerCase() === k.toLowerCase())) db.facts.push(k); }
      if (db.facts.length > 80) db.facts.splice(0, db.facts.length - 80);
      const sums = (out.resumos || []).filter(r => r && r.conversa && r.resumo).map(r => `### ${fmtHour(localISO(now))} — ${r.conversa}\n${String(r.resumo).trim()}`);
      if (sums.length && DESK && db.settings.driveLog !== false) window.wv1desk.summaryAppend({ date: ymd(now), text: sums.join('\n\n') }).then(refreshSums).catch(() => {});
      // proativa: conta o que anotou e avisa na hora o que é urgente
      const lines = [];
      if (novos.length && !db.settings.waAuto) lines.push('📥 Do WhatsApp anotei (confira na lista acima):\n' + novos.map(n => `• ${n.prioridade === 'alta' ? '🔴 ' : ''}${n.titulo}${n.pessoa ? ' — ' + n.pessoa : ''}`).join('\n'));
      if (baixas.length) lines.push('✅ Dei baixa: ' + baixas.join('; '));
      const notas = (out.notas || []).filter(addNote);
      if (notas.length) lines.push('📝 Anotei nas notas: ' + notas.join('; '));
      if (lines.length) pushMsg('claude', { from: 'them', text: lines.join('\n\n') });
      const soon = localISO(new Date(Date.now() + 3 * 3600e3));
      novos.filter(n => n.prioridade === 'alta' || (n.quando.length > 10 && n.quando <= soon)).slice(0, 3).forEach(n => notify('📌 ' + n.titulo, (n.pessoa ? n.pessoa + ' · ' : '') + n.conversa));
    }
    save();
  } catch (e) { console.warn('leitura do WhatsApp:', e.message); waQueue.unshift(...batch.slice(0, 30)); waTimer = setTimeout(flushWa, 120000); }
  finally { waBusy = false; render(); }
}

// ---------- computador: WhatsApp Web dentro do app ----------
let driveInfo = null;
const WA_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
function fromWaChat() {
  let c = db.chats.find(x => x.id === 'fromwa');
  if (!c) { c = { id: 'fromwa', name: 'Do WhatsApp', kind: 'group', members: '', watch: true, color: '#25d366', pinned: false, messages: [] }; db.chats.push(c); save(); }
  return c;
}
if (DESK) {
  document.body.classList.add('desk'); document.title = 'WhatsApp';
  const wv = document.createElement('webview');
  wv.setAttribute('src', 'https://web.whatsapp.com/');
  wv.setAttribute('partition', 'persist:whatsapp');
  wv.setAttribute('useragent', WA_UA);
  $('#waPane').appendChild(wv);
  window.wv1desk.onWaUnread(n => { waUnread = n; setBadge($('#waBadge'), n); });
  window.wv1desk.driveSet(db.settings.driveDir || '').then(r => { driveInfo = r; refreshSums(); });
  setInterval(refreshSums, 10 * 60e3);
  window.wv1desk.onSaved(d => { db.meta.savedCount = (db.meta.savedCount || 0) + 1; save(); toast('📁 Salvo: ' + d.rel); });
  waWv = wv;
  wv.addEventListener('ipc-message', e => {
    if (e.channel === 'wa-msgs') ingestWa(e.args[0]);
    if (e.channel === 'wa-sweep') {
      const st = e.args[0] || {}; waSweeping = st.state === 'start'; waSweepFull = !!st.full; renderSide();
      if (st.state === 'skip') { // WhatsApp em uso ou carregando: tenta de novo em ~2 min
        lastSweepU = Date.now() - 8 * 60e3; if (st.full) lastSweepF = Date.now() - 118 * 60e3;
        if (manualSweep) { manualSweep = false; pushMsg('claude', { from: 'them', text: st.reason === 'carregando' ? 'O WhatsApp ainda está carregando. Tento de novo daqui a pouco.' : 'Você está usando o WhatsApp agora; faço a leitura completa assim que ele ficar parado.' }); }
      }
      if (st.state === 'end') {
        if (st.full) db.meta.lastFullSweep = new Date().toISOString(); db.meta.lastSweep = new Date().toISOString(); save();
        if (manualSweep) { manualSweep = false; pushMsg('claude', { from: 'them', text: st.aborted ? `Parei porque você mexeu no WhatsApp. Li ${st.opened} conversa(s); continuo depois.` : st.opened ? `Li ${st.opened} conversa(s). O que precisar de ação aparece na lista acima em instantes.` : 'Não consegui abrir as conversas agora (o WhatsApp ainda carregando?). Tento de novo daqui a pouco.' }); }
      }
    }
  });
  window.wv1desk.onToAssistant(async d => {
    const c = fromWaChat();
    let img;
    if (d.img) { img = 'img_' + uid(); await imgPut(img, d.img); imgCache[img] = d.img; window.wv1desk.saveFile({ chat: 'Enviados para a assistente', name: 'foto.png', dataUrl: d.img }); }
    pushMsg(c.id, { from: 'me', text: (d.text || '').trim(), img });
    if (!db.settings.apiKey && d.img && !d.text) toast('Foto guardada. Para a assistente ler fotos, configure a chave da API.');
    else toast('Enviado para a assistente ✓');
    queueRead(c.id);
  });
}

$('#attach').addEventListener('click', () => $('#file').click());
$('#file').addEventListener('change', async e => { for (const f of e.target.files) await sendImage(f); e.target.value = ''; });

// lembretes na hora + resumo do dia
async function notify(title, body) {
  try {
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    const reg = await navigator.serviceWorker?.getRegistration();
    if (reg) reg.showNotification(title, { body, icon: 'icons/icon-192.png', badge: 'icons/icon-192.png', tag: title + body, vibrate: [200, 100, 200] });
    else new Notification(title, { body, icon: 'icons/icon-192.png' });
  } catch {}
}
function tick() {
  const now = localISO(new Date()); let changed = false;
  for (const t of db.tasks) {
    if (t.remindAt && !t.done && !t.notified && t.remindAt <= now) {
      t.notified = true; changed = true;
      pushMsg('claude', { from: 'them', card: { type: 'task', id: t.id, remind: true, alarm: true } });
      notify('⏰ ' + t.title, 'Lembrete do WhatsApp v1');
    }
  }
  const soon = localISO(new Date(Date.now() + 30 * 60e3));
  for (const ev of db.events) {
    if (!ev.notified && ev.start <= soon && ev.start >= now.slice(0, 10)) {
      ev.notified = true; changed = true;
      if (ev.start >= localISO(new Date(Date.now() - 15 * 60e3))) { pushMsg('claude', { from: 'them', text: `📅 Daqui a pouco (${fmtHour(ev.start)}): ${ev.title}${ev.location ? ' — ' + ev.location : ''}` }); notify('📅 ' + ev.title, `${fmtHour(ev.start)}${ev.location ? ' · ' + ev.location : ''}`); }
    }
  }
  const today = ymd(new Date());
  const hr = new Date().getHours();
  if (db.meta.digest !== today && hr >= 6) { db.meta.digest = today; changed = true; briefing('manha'); }
  if (db.meta.digestPm !== today && hr >= 18) { db.meta.digestPm = today; changed = true; briefing('tarde'); }
  if (changed) { save(); render(); }
  scheduleSweeps();
}
function briefData(kind) {
  const today = ymd(new Date()), tm = new Date(); tm.setDate(tm.getDate() + 1); const tomorrow = ymd(tm);
  const day = kind === 'manha' ? today : tomorrow;
  const evs = sortedEvents().filter(e => e.start.slice(0, 10) === day);
  const rem = db.tasks.filter(t => !t.done && t.remindAt && t.remindAt.slice(0, 10) === day);
  const late = db.tasks.filter(t => !t.done && ((t.remindAt && t.remindAt < localISO(new Date())) || (!t.remindAt && t.due && t.due < today)));
  const pend = db.tasks.filter(t => !t.done);
  const lines = [kind === 'manha' ? `☀️ Bom dia${db.settings.myName ? ', ' + db.settings.myName : ''}! Seu dia:` : `🌙 Fechando o dia. Amanhã:`];
  lines.push(evs.length ? evs.map(e => `📅 ${fmtHour(e.start)} ${e.title}${e.location ? ' — ' + e.location : ''}`).join('\n') : (kind === 'manha' ? '📅 Nenhum compromisso hoje.' : '📅 Nenhum compromisso amanhã.'));
  if (rem.length) lines.push(rem.map(t => `🔔 ${fmtHour(t.remindAt)} ${t.title}`).join('\n'));
  if (late.length) lines.push(`⚠️ Atrasados: ${late.slice(0, 8).map(t => t.title).join('; ')}`);
  if (db.inbox.length) lines.push(`📋 ${db.inbox.length} sugestão(ões) do WhatsApp esperando sua confirmação${db.inbox.some(x => x.prioridade === 'alta') ? ', com urgência' : ''}.`);
  lines.push(`✅ ${pend.length} atividade(s) pendente(s).`);
  return lines.join('\n\n');
}
async function briefing(kind) {
  const text = briefData(kind);
  if (!db.settings.apiKey) { pushMsg('claude', { from: 'them', text }); return; }
  try {
    await callClaude({ system: systemPrompt() + `\nVocê está escrevendo, por iniciativa própria, o briefing ${kind === 'manha' ? 'da manhã' : 'do fim do dia'}.`, tools: TOOLS, postTo: 'claude',
      messages: [{ role: 'user', content: `[briefing automático, não é mensagem do usuário] Dados:\n${text}\n\nEscreva o briefing ${kind === 'manha' ? 'da manhã' : 'do fim do dia: o que ficou pendente e o que vem amanhã'} como secretária: curto, em tópicos com emojis, e no máximo 2 sugestões práticas (cobrar alguém, remarcar, mandar um documento). Se algo atrasado merecer lembrete, crie com criar_lembrete. Sem cumprimento longo.` }] });
  } catch { pushMsg('claude', { from: 'them', text }); }
}
setInterval(tick, 30e3);
document.addEventListener('visibilitychange', () => { if (!document.hidden) { tick(); if (db.settings.apiKey) readAll(false); } else if (db.settings.waSweep !== false) setTimeout(() => { if (document.hidden) requestSweep({ full: false, force: true }); }, 20000); });

// instalação
let deferredPrompt;
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferredPrompt = e; $('#btnInstall').style.display = ''; });
$('#btnInstall').addEventListener('click', async () => { if (!deferredPrompt) return; deferredPrompt.prompt(); await deferredPrompt.userChoice; deferredPrompt = null; $('#btnInstall').style.display = 'none'; });
if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => {});

render();
tick();
if (db.settings.apiKey) setTimeout(() => readAll(false), 1500);
