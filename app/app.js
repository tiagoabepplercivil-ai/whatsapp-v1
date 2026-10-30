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
db.brain = db.brain || { feed: [], pulse: null, voice: false, off: {} }; db.brain.off = db.brain.off || {};
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
// versão curta para listas: Hoje / Amanhã / Ontem / ter 03/11
function shortDay(s) { const f = fmtDay(s); if (!/,|de /.test(f)) return f; const d = parseLocal(s); return d.toLocaleDateString('pt-BR', { weekday: 'short' }).replace('.', '') + ' ' + d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }); }
const evHour = ev => ev.allDay ? 'dia todo' : fmtHour(ev.start);
function fmtWhen(ev) { return ev.allDay ? `${fmtDay(ev.start)}, dia todo` : `${fmtDay(ev.start)}, ${fmtHour(ev.start)}${ev.end ? '–' + fmtHour(ev.end) : ''}`; }
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
  save(); gcalPush(ev); return ev;
}
function addTask({ title, due, eventId, chatId, remindAt }) {
  const t = { id: uid(), title: title || 'Atividade', due: due || (remindAt ? remindAt.slice(0, 10) : ''), remindAt: remindAt || '', eventId: eventId || null, chatId: chatId || null, done: false, created: new Date().toISOString() };
  db.tasks.push(t); save(); return t;
}
function delEvent(id) { const gid = (db.events.find(e => e.id === id) || {}).gid; db.events = db.events.filter(e => e.id !== id); db.tasks.forEach(t => { if (t.eventId === id) t.eventId = null; }); save(); gcalDelete(gid); }
function sortedEvents() { return [...db.events].sort((a, b) => a.start.localeCompare(b.start)); }

// ---------- render: lista principal ----------
function setBadge(el, n) { el.textContent = n > 99 ? '99+' : n; el.classList.toggle('on', n > 0); }
function render() {
  scheduleManual();
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
  if (card.type === 'aud') return '🎤 Áudio · ' + (card.chat || '');
  if (card.type === 'week') return '📊 Resumo da semana';
  if (card.type === 'done?') return (card.status === 'pendente' || !card.status ? 'Isso foi feito? ' : '') + (db.tasks.find(t => t.id === card.id)?.title || '');
  if (card.type === 'sug') return (card.status === 'pendente' || !card.status ? 'Colocar como tarefa? ' : '') + card.titulo;
  if (card.type === 'plan') return 'Plano: ' + (db.plans.find(p => p.id === card.id)?.titulo || '');
  if (card.type === 'event') return db.events.find(e => e.id === card.id)?.title || 'Compromisso removido';
  return db.tasks.find(t => t.id === card.id)?.title || 'Atividade removida';
}

function eventRow(ev) {
  const n = db.tasks.filter(t => t.eventId === ev.id), done = n.filter(t => t.done).length;
  return `<div class="ev" data-event="${ev.id}"><div class="hr">${evHour(ev)}</div><div class="body">
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
  if (up.length) l += `<div class="section">Próximos</div>` + up.map(e => `<div class="ev" data-event="${e.id}"><div class="hr" style="font-size:12px">${parseLocal(e.start).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })}</div><div class="body"><div class="t">${esc(e.title)}</div><div class="s">${evHour(e)}</div></div></div>`).join('');
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
    ? [DESK ? '📖 Ler todo o WhatsApp' : '📖 Ler todas as conversas', 'O que tenho hoje?', 'Minha semana', '📊 Resumo da semana', 'Meus lembretes', 'Atividades pendentes'].map(q => `<button data-quick="${esc(q)}">${esc(q)}</button>`).join('')
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

// nada sai da lista de atividades sem o Sim dele: a assistente pergunta "Isso foi feito?" (cartão) e o quadradinho pede confirmação
function askDone(id, motivo, force, where) {
  const t = db.tasks.find(x => x.id === id); if (!t || t.done || t.askDone) return false;
  if (!force && t.doneNo && Date.now() - t.doneNo < 24 * 3600e3) return false; // ele disse "ainda não" há menos de 24 h
  t.askDone = true;
  if (where === 'brain') brainAdd({ kind: 'done?', key: 'd:' + id, taskId: id, icon: '❓', text: 'Parece que já foi feito: ' + t.title + '. Foi?', sub: motivo || '' });
  else pushMsg('claude', { from: 'them', card: { type: 'done?', id, motivo: motivo || '', status: 'pendente' } });
  return true;
}
function doneAnswer(id, yes) {
  const t = db.tasks.find(x => x.id === id); if (!t) return;
  if (yes) { t.done = true; t.doneAt = new Date().toISOString(); } else t.doneNo = Date.now();
  t.askDone = false;
  for (const m of db.chats.find(c => c.id === 'claude').messages) if (m.card && m.card.type === 'done?' && m.card.id === id && (m.card.status || 'pendente') === 'pendente') m.card.status = yes ? 'feito' : 'nao';
  save(); render(); if (openChatId) renderMsgs();
}
function confirmDoneSheet(id) {
  const t = db.tasks.find(x => x.id === id); if (!t) return;
  sheet(`<h2>Isso foi feito?</h2><div class="field" style="font-size:15px">${esc(t.title)}</div><div class="hint" style="padding:0 0 8px">Só sai da lista se você confirmar.</div>
    <div class="btns"><button class="btn" data-act="close">Ainda não</button><button class="btn pri" data-act="done-yes" data-id="${t.id}">Sim, foi feito</button></div>`);
}
// triagem: só vira cartão o que é pedido/pergunta a ele, promessa dele ou compromisso com ele
const ORIGENS = { pedido: p => `${p || 'Alguém'} te pediu`, pergunta: p => `${p || 'Alguém'} te perguntou`, promessa: () => 'Você prometeu', compromisso: () => 'Compromisso com você' };
function cardHtml(card) {
  if (card.type === 'aud') {
    const st = card.status || 'pendente', its = card.items || [], n = its.length;
    const head = st === 'feito' ? `🎤 ${n > 1 ? n + ' áudios transcritos' : 'Áudio transcrito'}` : st === 'nao' ? 'Áudio não transcrito' : st === 'transcrevendo' ? '🎤 Transcrevendo…' : st === 'erro' ? '⚠️ Não consegui transcrever' : `🎤 ${n > 1 ? n + ' áudios novos' : 'Áudio novo'} · transcrever?`;
    const rows = its.map(x => `<div class="cs${x.text ? ' tq' : ''}">${x.text ? '' : '○ '}<b>${esc(x.who || card.chat)}</b>${x.dur ? ' · ' + fmtDur(x.dur) : ''}${x.when ? ' · ' + fmtHour(x.when) : ''}${x.text ? ': “' + esc(x.text.slice(0, 400)) + (x.text.length > 400 ? '…' : '') + '”' : x.erro ? ' — ⚠ ' + esc(x.erro) : ''}</div>`).join('');
    const acts = st === 'pendente' ? `<button class="ok" data-act="aud-go" data-id="${card.id}">🎤 Transcrever</button><button data-act="aud-auto" data-id="${card.id}">Sempre, sozinha</button><button data-act="aud-no" data-id="${card.id}">Agora não</button>`
      : st === 'erro' ? `<button data-act="aud-go" data-id="${card.id}">Tentar de novo</button>` : '';
    return `<div class="card aud ${st === 'nao' ? 'off' : ''}"><div class="ch" style="${st === 'pendente' || st === 'transcrevendo' ? 'background:#d9fdd3;color:#0b3d1e' : 'background:var(--panel);color:var(--muted)'}">${head}</div><div class="cb">
      <div class="ct">💬 ${esc(card.chat)}</div>${rows}${st === 'pendente' ? '<div class="cs hint2">Eu toco o áudio sem som para transcrever; quem mandou vê como ouvido.</div>' : ''}</div>${acts ? `<div class="acts">${acts}</div>` : ''}</div>`;
  }
  if (card.type === 'week') {
    const k = card.counts || {};
    return `<div class="card"><div class="ch" style="background:#1d4ed8;color:#fff">📊 Resumo da semana · ${esc(shortRange(card.de, card.ate))}</div><div class="cb">
      <div class="ct">${(card.obras || []).slice(0, 6).map(esc).join(' · ') || 'Geral'}</div>
      <div class="cs">✅ ${k.feito || 0} feito · ⏳ ${k.pendente || 0} pendente · 📨 ${k.esperando || 0} esperando terceiros</div>${card.atencao ? `<div class="cs" style="color:#b42318">⚠️ ${esc(card.atencao)}</div>` : ''}</div>
      <div class="acts"><button class="ok" data-act="week-view" data-id="${card.id}">Ver resumo</button>${card.file ? `<button data-act="week-open" data-id="${card.id}">Abrir no Drive</button>` : ''}</div></div>`;
  }
  if (card.type === 'done?') {
    const t = db.tasks.find(x => x.id === card.id); const st = card.status || 'pendente';
    if (!t) return `<div class="card off"><div class="cb cs">Atividade removida</div></div>`;
    const head = st === 'feito' ? '✓ Feito, saiu da lista' : st === 'nao' ? 'Ficou na lista' : 'Isso foi feito?';
    return `<div class="card ${st !== 'pendente' ? 'off' : ''}"><div class="ch" ${st !== 'pendente' ? 'style="background:var(--panel);color:var(--muted)"' : ''}>${head}</div><div class="cb">
      <div class="ct">${t.done ? '☑' : '☐'} ${esc(t.title)}</div>${card.motivo && st === 'pendente' ? `<div class="cs tq">${esc(card.motivo)}</div>` : ''}</div>
      ${st === 'pendente' ? `<div class="acts"><button class="ok" data-act="done-yes" data-id="${t.id}">✅ Sim, foi feito</button><button data-act="done-no" data-id="${t.id}">Ainda não</button></div>` : ''}</div>`;
  }
  if (card.type === 'sug') {
    const ic = { compromisso: '📅', lembrete: '🔔', responder: '💬' }[card.tipo] || '✅';
    const st = card.status || 'pendente', alta = card.prioridade === 'alta';
    const head = st === 'aceita' ? `✓ Virou ${card.eventId ? 'compromisso' : 'atividade'}` : st === 'descartada' ? 'Descartada' : (alta ? '🔴 ' : '') + (ORIGENS[card.origem] ? ORIGENS[card.origem](card.pessoa) : 'Coisa nova') + ' · colocar como tarefa?';
    const sub = [card.quando ? fmtDay(card.quando) + (card.quando.length > 10 ? ', ' + fmtHour(card.quando) : '') : '', card.pessoa, card.conversa ? '💬 ' + card.conversa : ''].filter(Boolean).join(' · ');
    const acts = st === 'pendente' ? `<button class="ok" data-act="sug-yes" data-id="${card.id}">✅ Sim, colocar</button><button data-act="sug-no" data-id="${card.id}">Não</button>`
      : st === 'aceita' ? (card.eventId ? `<button data-event="${card.eventId}">Abrir compromisso</button>` : card.taskId ? `<button data-task="${card.taskId}">Abrir atividade</button>` : '') : '';
    return `<div class="card sug ${st === 'descartada' ? 'off' : ''}"><div class="ch" ${st === 'pendente' && alta ? 'style="background:#ea0038;color:#fff"' : st !== 'pendente' ? 'style="background:var(--panel);color:var(--muted)"' : ''}>${head}</div><div class="cb">
      <div class="ct">${ic} ${esc(card.titulo)}</div>${sub ? `<div class="cs">${esc(sub)}</div>` : ''}${card.trecho && st === 'pendente' ? `<div class="cs tq">“${esc(card.trecho.slice(0, 160))}”</div>` : ''}</div>
      ${acts ? `<div class="acts">${acts}</div>` : ''}</div>`;
  }
  if (card.type === 'plan') {
    const p = db.plans.find(x => x.id === card.id);
    if (!p) return `<div class="card"><div class="cb cs">Plano removido</div></div>`;
    const acts = p.status === 'aguardando_ok' ? `<button class="ok" data-act="plan-ok" data-id="${p.id}">✅ Ok, pode fazer</button><button data-act="plan-cancel" data-id="${p.id}">Cancelar</button>`
      : p.status === 'executando' ? '<span class="cs">executando…</span>' : p.status === 'erro' ? `<button data-act="plan-ok" data-id="${p.id}">Tentar de novo</button><button data-act="plan-cancel" data-id="${p.id}">Cancelar</button>`
      : p.status === 'feito' ? '<span class="cs">✓ concluído</span>' : '<span class="cs">cancelado</span>';
    return `<div class="card"><div class="ch" style="background:#1d4ed8;color:#fff">🗂 ${p.status === 'feito' ? 'Feito' : p.status === 'aguardando_ok' ? 'Plano — diga "ok" para eu fazer' : 'Plano'}: ${esc(p.titulo)}</div><div class="cb">
      ${p.passos.map(st => `<div class="cs st-${st.status}">${st.status === 'feito' ? '✓' : st.status === 'erro' ? '⚠' : '○'} ${STEP_ICON[st.tipo] || '•'} ${esc(stepText(st))}${st.erro ? ' — ' + esc(st.erro) : ''}</div>`).join('')}</div>
      <div class="acts">${acts}</div></div>`;
  }
  if (card.type === 'event') {
    const ev = db.events.find(e => e.id === card.id);
    if (!ev) return `<div class="card"><div class="cb cs">Compromisso removido</div></div>`;
    const n = db.tasks.filter(t => t.eventId === ev.id);
    return `<div class="card"><div class="ch" ${card.soon ? 'style="background:#fde2b6;color:#6b3d00"' : ''}>${card.soon || '📅 Compromisso marcado'}</div><div class="cb">
      <div class="ct">${esc(ev.title)}</div><div class="cs">${esc(fmtWhen(ev))}${ev.location ? ' · 📍 ' + esc(ev.location) : ''}</div>
      ${n.length ? `<div class="cs">${n.map(t => (t.done ? '☑ ' : '☐ ') + esc(t.title)).join('<br>')}</div>` : ''}</div>
      <div class="acts">${gcalOn() ? '' : `<button data-gcal="${ev.id}">Google Agenda</button>`}<button data-ics="${ev.id}">.ics</button><button data-event="${ev.id}">Abrir</button></div></div>`;
  }
  const t = db.tasks.find(x => x.id === card.id);
  if (!t) return `<div class="card"><div class="cb cs">Atividade removida</div></div>`;
  const ev = t.eventId && db.events.find(e => e.id === t.eventId);
  const src = t.chatId && t.chatId !== 'claude' && db.chats.find(c => c.id === t.chatId);
  const head = card.alarm ? '⏰ Hora do lembrete!' : card.soon ? card.soon : t.remindAt ? '🔔 Lembrete criado' : '✅ Atividade criada';
  return `<div class="card"><div class="ch" style="background:${card.alarm ? '#ea0038;color:#fff' : card.soon ? '#fde2b6;color:#6b3d00' : '#ffbc2d;color:#3b2a00'}">${head}</div><div class="cb">
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
// bloco do alto do painel: compromissos da agenda + atividades pendentes, em ordem de horário, para ir lembrando
function soonInfo(when, allDay) { // "chegando": em N min / em N h (até 24 h) ou hoje (só data)
  if (!when) return null;
  if (when.length > 10 && !allDay) { const m = Math.round((parseLocal(when) - Date.now()) / 60000); if (m < 0 || m > 24 * 60) return null; return { txt: m < 1 ? 'agora' : m < 60 ? `em ${m} min` : m < 180 ? `em ${Math.floor(m / 60)} h${m % 60 ? ' ' + String(m % 60).padStart(2, '0') : ''}` : `em ${Math.round(m / 60)} h`, hot: m <= 60 }; }
  return when.slice(0, 10) === ymd(new Date()) ? { txt: 'hoje', hot: false } : null;
}
function ptRow(t) {
  const late = !t.done && ((t.remindAt && t.remindAt < localISO(new Date())) || (!t.remindAt && t.due && t.due < ymd(new Date())));
  const when = t.remindAt ? shortDay(t.remindAt) + ', ' + fmtHour(t.remindAt) : t.due ? shortDay(t.due) : '';
  const src = t.chatId && t.chatId !== 'claude' && db.chats.find(c => c.id === t.chatId);
  const sub = [when, src && src.name].filter(Boolean).join(' · ');
  const soon = !late && soonInfo(t.remindAt || t.due);
  const wait = db.plans.some(p => p.taskId === t.id && p.status === 'aguardando_ok');
  const subHtml = t.askDone ? `<div class="s ask">❓ foi feito? confirme ${brainFind(f => f.kind === 'done?' && f.taskId === t.id) ? 'no Cérebro' : 'na Conversa'}</div>`
    : sub ? `<div class="s ${late ? 'late' : soon ? 'soon' + (soon.hot ? ' hot' : '') : ''}">${late ? 'atrasada · ' : soon ? '⏳ ' + soon.txt + ' · ' : ''}${esc(sub)}</div>` : '';
  return `<div class="pt"><input type="checkbox" data-toggle="${t.id}" ${t.done ? 'checked' : ''}><div class="t" data-task="${t.id}"><div class="tt">${esc(t.title)}</div>${subHtml}</div>`
    + (wait ? '<span class="pa wait" title="Plano pronto, aguardando seu ok no chat">🗂</span>' : `<button class="pa" data-act="task-plan" data-id="${t.id}" title="Preparar execução (deixo a mensagem pronta, marco, anoto)">⚡</button>`) + '</div>';
}
function peRow(ev) {
  const soon = soonInfo(ev.start, ev.allDay);
  const sub = [ev.allDay ? shortDay(ev.start) + ' · dia todo' : shortDay(ev.start) + ', ' + fmtHour(ev.start), ev.location && '📍 ' + ev.location].filter(Boolean).join(' · ');
  return `<div class="pt ev" data-event="${ev.id}"><span class="ic">📅</span><div class="t"><div class="tt">${esc(ev.title)}</div><div class="s ${soon ? 'soon' + (soon.hot ? ' hot' : '') : ''}">${soon ? '⏳ ' + soon.txt + ' · ' : ''}${esc(sub)}</div></div></div>`;
}
function renderPTasks() {
  const box = $('#ptasks'); if (!box) return;
  const nowIso = localISO(new Date()), today = ymd(new Date()), lim = new Date(); lim.setDate(lim.getDate() + 7); const limIso = ymd(lim) + 'T23:59';
  const tkey = t => t.remindAt || (t.due ? t.due + 'T23:59' : '9999');
  const pend = db.tasks.filter(t => !t.done);
  const evs = db.events.filter(e => (e.allDay ? e.start.slice(0, 10) >= today : (e.end || e.start) >= nowIso) && e.start <= limIso);
  const items = [...pend.map(t => ({ k: tkey(t), h: () => ptRow(t) })), ...evs.map(e => ({ k: e.allDay ? e.start.slice(0, 10) + 'T00:00' : e.start, h: () => peRow(e) }))].sort((a, b) => a.k.localeCompare(b.k));
  const closed = !!db.meta.ptasksClosed, show = items.slice(0, 10), sug = (db.inbox || []).length;
  box.classList.toggle('closed', closed);
  box.innerHTML = `<div class="todo-h"><b class="lk"><button data-view="agenda" title="Abrir a agenda">Agenda</button> e <button data-view="tasks" title="Abrir todas as atividades">atividades · ${pend.length}</button></b><span><button data-act="ptasks-toggle" title="Recolher/abrir">${closed ? '▸' : '▾'}</button></span></div>`
    + (sug > 1 ? `<div class="sugbar"><span>💡 ${sug} coisas novas esperando seu Sim no Cérebro</span><button data-act="inbox-all">Sim para todas</button></div>` : '')
    + (items.length ? show.map(x => x.h()).join('') + (items.length > show.length ? `<button class="more" data-view="tasks">+ ${items.length - show.length} mais adiante</button>` : '') : '<div class="sugbar"><span>Nada agendado nem pendente.</span></div>');
}
function renderSide() {
  const box = $('#sideMsgs'); if (!box) return;
  const c = db.chats.find(x => x.id === 'claude');
  const atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 80;
  box.innerHTML = msgsHtml({ ...c, messages: c.messages.slice(-60) }, false); hydrateImgs(box);
  if (atBottom || !renderSide.done) box.scrollTop = box.scrollHeight; renderSide.done = true;
  if (sideVisible() && sideView() === 'chat' && !document.hidden && c.unread) { c.unread = 0; save(); }
  renderPTasks(); renderBrain();
  $('#sideStatus').textContent = waSweeping ? (waSweepFull ? 'lendo todas as conversas…' : 'abrindo as conversas não lidas…') : audN > 0 ? 'transcrevendo áudio…' : weekBusy ? 'montando o resumo da semana…' : reading || waBusy ? 'lendo mensagens…' : (DESK && db.settings.waRead !== false ? 'lendo seu WhatsApp' : 'online');
}
function pushMsg(chatId, msg) {
  const c = db.chats.find(x => x.id === chatId);
  const m = { id: uid(), ts: new Date().toISOString(), ...msg }; c.messages.push(m);
  const seen = !document.hidden && ((openChatId === chatId && tab !== 'wa') || (chatId === 'claude' && sideVisible() && sideView() === 'chat'));
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
  if (c.kind === 'claude') { if (/ler todo o whatsapp/i.test(text)) sweepNow(); else if (/^📖|ler todas as conversas/i.test(text)) await readAll(true); else if (WEEK_RE.test(text)) await weeklyReport({ manual: true }); else await askClaude(text); }
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
  { name: 'preparar_plano', description: 'Monta o plano de execução de uma atividade e mostra um cartão para o usuário aprovar com "ok". NADA é executado sem o ok dele. Use quando ele pedir para resolver/responder/cobrar/marcar/avisar algo, ou quando uma atividade puder ser resolvida com uma mensagem no WhatsApp. Passos: whatsapp (conversa = nome exatamente como na lista do WhatsApp; mensagem pronta em primeira pessoa, no tom dele: direto, educado, sem floreio), compromisso, lembrete, nota, concluir (dar baixa na atividade que o plano resolve). Depois de chamar, responda em UMA linha (o cartão já mostra os passos).',
    input_schema: { type: 'object', properties: { titulo: { type: 'string', description: 'Ex.: "Responder Alex sobre a vistoria"' }, atividade_id: { type: 'string', description: 'id da atividade relacionada, se houver' },
      passos: { type: 'array', items: { type: 'object', properties: { tipo: { type: 'string', enum: ['whatsapp', 'compromisso', 'lembrete', 'nota', 'concluir'] }, conversa: { type: 'string' }, mensagem: { type: 'string' }, titulo: { type: 'string' }, inicio: { type: 'string', description: 'compromisso: YYYY-MM-DDTHH:MM' }, fim: { type: 'string' }, local: { type: 'string' }, quando: { type: 'string', description: 'lembrete: YYYY-MM-DDTHH:MM' }, texto: { type: 'string', description: 'nota' }, atividade_id: { type: 'string', description: 'concluir' } }, required: ['tipo'] } } }, required: ['titulo', 'passos'] } },
  { name: 'anotar', description: 'Escreve nas "Notas importantes" do usuário (botão 📝 no cabeçalho do painel): informação de referência que ele vai precisar consultar depois — endereço de obra, número de contrato/processo, valor combinado, código, horário fixo, decisão. Não use para tarefas (use criar_atividade) nem compromissos.',
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
  { name: 'concluir_atividade', description: 'Pergunta ao usuário, num cartão "Isso foi feito?" com Sim/Não, se a atividade foi feita. A atividade só sai da lista quando ele clicar Sim. Diga a ele que deixou a confirmação no cartão; nunca diga que já deu baixa.',
    input_schema: { type: 'object', properties: { id: { type: 'string' }, motivo: { type: 'string', description: 'Por que parece feita, ex.: "você disse que já enviou"' } }, required: ['id'] } },
  { name: 'excluir_compromisso', description: 'Exclui um compromisso. Só use quando o usuário pedir explicitamente.',
    input_schema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] } },
  { name: 'resumo_semana', description: 'Monta o resumo da semana por obra (feito, pendente, esperando terceiros e próxima semana), salva no Drive (WhatsApp v1/Resumos semanais) e mostra um cartão no chat. Use quando ele pedir resumo, relatório ou balanço da semana. Depois responda em UMA linha.',
    input_schema: { type: 'object', properties: {} } }
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
    case 'preparar_plano': { const p = createPlan(i, chatId); return p ? { ok: true, plano_id: p.id, status: 'aguardando_ok', aviso: 'Nada foi executado: o usuário aprova com ok.' } : { erro: 'plano sem passos válidos' }; }
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
      if (i.local !== undefined) e.location = i.local; if (i.observacoes !== undefined) e.notes = i.observacoes; if (i.inicio) e.allDay = false; save(); gcalPush(e);
      pushMsg(chatId, { from: 'them', card: { type: 'event', id: e.id } }); return { ok: true, ...evOut(e) };
    }
    case 'concluir_atividade': { const t = db.tasks.find(x => x.id === i.id); if (!t) return { erro: 'não encontrada' }; if (t.done) return { ok: true, aviso: 'já estava concluída' }; askDone(t.id, i.motivo || '', true); return { ok: true, aviso: 'cartão "Isso foi feito?" mostrado; só sai da lista quando ele clicar Sim' }; }
    case 'excluir_compromisso': { if (!db.events.some(e => e.id === i.id)) return { erro: 'não encontrado' }; delEvent(i.id); return { ok: true }; }
    case 'resumo_semana': { const r = await weeklyReport({}); return r.error ? { erro: r.error } : { ok: true, aviso: 'cartão do resumo mostrado no chat', arquivo: r.file || '', obras: r.obras }; }
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
Para FAZER algo por ele (responder/cobrar/avisar alguém no WhatsApp, marcar, anotar, dar baixa), monte o plano com preparar_plano: o app mostra o cartão e ele aprova com "ok"; só então executa. Nunca diga que já mandou ou fez. ${db.plans.find(p => p.status === 'aguardando_ok') ? 'Há um plano aguardando o ok dele: "' + db.plans.find(p => p.status === 'aguardando_ok').titulo + '". Se ele pedir mudança, chame preparar_plano de novo (o novo substitui).' : ''}
Bloco "Notas importantes" dele (use anotar para acrescentar o que ele vai precisar consultar):\n${db.notes.trim() || '(vazio)'}
Você também lê o WhatsApp dele: buscar_conversas procura nas conversas do app e no histórico completo do WhatsApp guardado no Drive (todas as conversas lidas, sem limite de data, mais os resumos diários); ler_historico mostra as últimas mensagens de uma conversa. Antes de dizer que não sabe de uma pessoa, obra, valor ou combinado, procure. Seja proativa: se notar atraso, conflito de horário ou algo esquecido, diga e proponha a ação.
Resumos recentes do WhatsApp dele (últimos dias, escritos por você):\n${recentSums || '(nenhum ainda)'}
Sugestões do WhatsApp ainda não confirmadas por ele:\n${db.inbox.slice(0, 15).map(x => `- ${x.titulo}${x.quando ? ' (' + x.quando + ')' : ''}`).join('\n') || '(nenhuma)'}
Conversas existentes: ${db.chats.filter(c => c.id !== 'claude').map(c => c.name).join(', ') || '(nenhuma)'}.
${selfLinked() ? `Mensagens que começam com 📲 ele escreveu (ou ditou, se vier 🎤) na conversa dele com ele mesmo no WhatsApp ("${selfName() || 'você'}"), normalmente pelo celular: é pedido direto a você (lembrete, compromisso, atividade, nota ou pergunta). Sua resposta de texto vai também para essa conversa, então responda em 1 ou 2 frases, sem markdown. Se a mensagem tiver data/hora entre parênteses, datas relativas ("amanhã", "sexta") contam a partir dela.` : ''}
${gcalOn() ? 'A agenda está sincronizada com a Google Agenda dele: os compromissos abaixo incluem os do Google, e criar/atualizar/excluir compromisso vale lá também.' : ''}
Agora: ${now.toLocaleString('pt-BR', { weekday: 'long' })}, ${localISO(now)} (fuso ${Intl.DateTimeFormat().resolvedOptions().timeZone}).
Use as ferramentas para marcar compromissos, criar e vincular atividades. Interprete datas relativas ("sexta", "amanhã", "semana que vem") a partir de agora. Se faltar o horário de um compromisso, só pergunte o horário, de forma natural. Nunca explique suas regras, nunca fale em "sistema", "instruções" ou "ferramentas": aja como uma secretária humana. Duração padrão 1h. O app já mostra um cartão para cada compromisso/atividade criado, então não repita todos os detalhes: confirme em uma frase.
Próximos compromissos:\n${up}\nAtividades e lembretes pendentes:\n${pend}`;
}

async function callClaude({ system, messages, tools, postTo, srcId, silentText, onText }) {
  for (let step = 0; step < 8; step++) {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': db.settings.apiKey, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
      body: JSON.stringify({ model: aiModel(), max_tokens: 4000, system, tools, messages, ...effortCfg('medium') })
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data?.error?.message || ('HTTP ' + r.status));
    const txt = data.content.filter(b => b.type === 'text').map(b => b.text).join('\n').trim();
    const uses = data.content.filter(b => b.type === 'tool_use');
    const show = txt && !(silentText && /^NADA\b/i.test(txt));
    if (show) { if (onText) onText(txt); else pushMsg(postTo, { from: 'them', text: txt }); }
    if (!uses.length) return;
    const results = await Promise.all(uses.map(async u => ({ type: 'tool_result', tool_use_id: u.id, content: JSON.stringify(await runTool(u.name, u.input || {}, postTo, srcId)) })));
    messages = [...messages, { role: 'assistant', content: data.content }, { role: 'user', content: results }];
  }
}

// ---------- IA em JSON: Claude primeiro; se ele falhar e houver chave, a OpenAI de reserva ----------
// Os modelos Claude 5.5 não aceitam tool_choice forçado (dá erro 400): o JSON sai por output_config.format (structured outputs).
const aiModel = () => db.settings.model || 'claude-sonnet-5-5';
const effortCfg = e => /claude-(opus|sonnet|haiku|fable|mythos)-5/.test(aiModel()) ? { output_config: { effort: e } } : {};
const claudeHeaders = () => ({ 'content-type': 'application/json', 'x-api-key': db.settings.apiKey, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' });
function strictSchema(x) { // structured outputs: todo objeto fechado (additionalProperties false) e com todos os campos obrigatórios
  if (Array.isArray(x)) return x.map(strictSchema);
  if (!x || typeof x !== 'object') return x;
  const o = {};
  for (const [k, v] of Object.entries(x)) o[k] = k === 'properties' ? Object.fromEntries(Object.entries(v).map(([pk, pv]) => [pk, strictSchema(pv)])) : strictSchema(v);
  if (o.type === 'object' && o.properties) { o.additionalProperties = false; o.required = Object.keys(o.properties); }
  return o;
}
async function claudeJson({ system, user, schema, max, effort }) {
  const cfg = effortCfg(effort || 'medium');
  const r = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: claudeHeaders(),
    body: JSON.stringify({ model: aiModel(), max_tokens: max || 8000, system, messages: [{ role: 'user', content: user }], output_config: { ...(cfg.output_config || {}), format: { type: 'json_schema', schema: strictSchema(schema) } } }) });
  const data = await r.json(); if (!r.ok) throw new Error(data?.error?.message || ('HTTP ' + r.status));
  if (data.stop_reason === 'max_tokens') throw new Error('a resposta da IA veio cortada');
  const txt = (data.content || []).find(b => b.type === 'text')?.text; if (!txt) throw new Error('a IA não respondeu');
  return JSON.parse(txt);
}
function oaOn() { return !!(db.settings.oaKey || '').trim(); }
const blobToDataUrl = b => new Promise((res, rej) => { const f = new FileReader(); f.onload = () => res(f.result); f.onerror = rej; f.readAsDataURL(b); });
async function oaCall(path, body) { // no computador passa pelo processo principal (sem CORS); no celular vai direto
  const key = (db.settings.oaKey || '').trim();
  if (window.wv1desk && window.wv1desk.openai) { const r = await window.wv1desk.openai({ key, path, body }); if (!r || r.error) throw new Error((r && r.error) || 'falhou'); return r; }
  const r = await fetch('https://api.openai.com/v1/' + path, { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + key }, body: JSON.stringify(body) });
  if (!r.ok) { let m = 'HTTP ' + r.status; try { m = (await r.json()).error.message || m; } catch {} throw new Error(m); }
  return path === 'audio/speech' ? { audio: await blobToDataUrl(await r.blob()) } : { json: await r.json() };
}
async function openaiJson({ system, user, schema, max }) {
  const r = await oaCall('chat/completions', { model: db.settings.oaModel || 'gpt-5.4-mini', max_completion_tokens: Math.max(max || 8000, 8000), messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
    response_format: { type: 'json_schema', json_schema: { name: 'saida', strict: true, schema: strictSchema(schema) } } });
  const txt = r.json?.choices?.[0]?.message?.content; if (!txt) throw new Error('a OpenAI não respondeu');
  return JSON.parse(txt);
}
async function aiJson(o) {
  let err; aiJson.last = 'claude';
  if (db.settings.apiKey) { try { return await claudeJson(o); } catch (e) { err = e; console.warn('Claude:', e.message); } }
  if (oaOn() && db.settings.oaBackup !== false) { try { const r = await openaiJson(o); aiJson.last = 'openai'; return r; } catch (e) { console.warn('OpenAI:', e.message); err = err || e; } }
  throw err || new Error('sem chave da IA');
}
// voz: OpenAI (natural) se houver chave; senão a voz do Windows/celular em português
let voiceQ = Promise.resolve(), voiceAudio = null;
function speak(text) {
  text = String(text || '').replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/gu, '').replace(/\s+/g, ' ').trim().slice(0, 900); if (!text) return;
  voiceQ = voiceQ.then(() => speak1(text)).catch(() => {});
}
async function speak1(text) {
  if (oaOn() && db.settings.oaVoice !== false) {
    try {
      const r = await oaCall('audio/speech', { model: 'gpt-4o-mini-tts', voice: db.settings.oaVoiceName || 'marin', input: text, instructions: 'Fale em português do Brasil, como uma secretária experiente: natural, clara e num ritmo um pouco rápido.', response_format: 'mp3' });
      await new Promise(res => { const a = new Audio(r.audio); voiceAudio = a; a.onended = a.onerror = res; a.play().catch(res); setTimeout(res, 90e3); }); return;
    } catch (e) { console.warn('voz OpenAI:', e.message); }
  }
  if (!('speechSynthesis' in window)) return;
  await new Promise(res => { const u = new SpeechSynthesisUtterance(text); u.lang = 'pt-BR'; const v = speechSynthesis.getVoices().find(x => /^pt[-_]BR/i.test(x.lang)); if (v) u.voice = v; u.rate = 1.05; u.onend = u.onerror = res; speechSynthesis.speak(u); setTimeout(res, 60e3); });
}
function shush() { try { speechSynthesis.cancel(); } catch {} if (voiceAudio) { try { voiceAudio.pause(); } catch {} voiceAudio = null; } voiceQ = Promise.resolve(); }

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
    <div class="btns"><button class="btn" data-ics="${id}">Baixar .ics</button><button class="btn" data-act="edit-event" data-id="${id}">Editar</button>${gcalOn() ? `<span class="chip">📆 ${ev.gid ? 'na Google Agenda' : 'enviando à Google Agenda…'}</span>` : `<button class="btn pri" data-gcal="${id}">Google Agenda</button>`}</div>`);
}
function taskForm(t = {}) {
  const opts = sortedEvents().filter(e => e.start.slice(0, 10) >= ymd(new Date()) || e.id === t.eventId)
    .map(e => `<option value="${e.id}" ${e.id === t.eventId ? 'selected' : ''}>${esc(fmtDay(e.start))} ${evHour(e)} · ${esc(e.title)}</option>`).join('');
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
    ${DESK ? `<div class="field"><label>Google Agenda</label>
      ${gcal.connected ? `<div style="font-size:14px">✅ Conectada${gcal.email ? ' como ' + esc(gcal.email) : ''}. Compromissos vão e vêm da sua agenda principal (a cada 10 min).</div><div class="btns" style="margin-top:8px"><button class="btn" data-act="gcal-sync">Sincronizar agora</button><button class="btn" data-act="gcal-disconnect">Desconectar</button></div>`
      : `<input id="gI" value="${esc(s.gcalId || '')}" placeholder="ID do cliente (termina com .apps.googleusercontent.com)"><input id="gS" value="${esc(s.gcalSecret || '')}" placeholder="Segredo do cliente (GOCSPX-…)" style="margin-top:6px"><div class="btns" style="margin-top:8px"><button class="btn pri" data-act="gcal-connect">Conectar Google Agenda</button></div>
      <div class="hint">Cadastro único na sua conta Google: console.cloud.google.com → novo projeto → "APIs e serviços" → ativar "Google Calendar API" → "Tela de permissão OAuth" (Externo; em "Usuários de teste" adicione seu e-mail) → "Credenciais" → "Criar credenciais" → "ID do cliente OAuth" → tipo "App para computador". Cole aqui o ID e o segredo e clique em Conectar: abre o Google no navegador para você autorizar.</div>`}
    </div>` : ''}
    ${DESK ? `<div class="field"><label>WhatsApp</label>
      <label style="display:flex;gap:8px;align-items:center;color:var(--text);font-weight:400"><input type="checkbox" id="sW" ${s.waRead !== false ? 'checked' : ''} style="width:auto"> Assistente lê minhas mensagens e lista o que fazer</label>
      <label style="display:flex;gap:8px;align-items:center;color:var(--text);font-weight:400;margin-top:6px"><input type="checkbox" id="sA" ${s.waAuto ? 'checked' : ''} style="width:auto"> Adicionar direto, sem pedir confirmação</label>
      <label style="display:flex;gap:8px;align-items:center;color:var(--text);font-weight:400;margin-top:6px"><input type="checkbox" id="sS" ${s.waSweep !== false ? 'checked' : ''} style="width:auto"> Ler tudo: abrir cada conversa não lida quando eu não estiver usando (e todas a cada 2 h). Abrir marca a conversa como lida no WhatsApp.</label>
      <label style="display:flex;gap:8px;align-items:center;color:var(--text);font-weight:400;margin-top:6px"><input type="checkbox" id="sL" ${s.driveLog !== false ? 'checked' : ''} style="width:auto"> Guardar no Drive o texto das conversas lidas e os resumos do dia (WhatsApp v1/Conversas e Resumos)</label>
      <input id="sI" value="${esc(s.waIgnore || '')}" placeholder="Ignorar conversas (nomes separados por vírgula)" style="margin-top:6px">
      <div class="hint">Abrir a conversa marca como lida no WhatsApp (e manda o visto azul, se ativo). O texto vai para a Anthropic para análise (custo por uso da sua chave).</div></div>
    <div class="field"><label>🎤 Áudios do WhatsApp viram texto</label>
      <div style="display:flex;gap:6px"><select id="sTp" style="width:auto">${Object.entries(STT_NAMES).map(([k, v]) => `<option value="${k}" ${(s.sttProvider || 'groq') === k ? 'selected' : ''}>${v}</option>`).join('')}</select>
      <input id="sTk" type="password" value="${esc(s.sttKey || '')}" placeholder="Chave (Groq: gsk_…)" autocomplete="off" style="flex:1"></div>
      <label style="display:flex;gap:8px;align-items:center;color:var(--text);font-weight:400;margin-top:6px"><input type="checkbox" id="sTa" ${s.sttAuto ? 'checked' : ''} style="width:auto"> Transcrever áudios novos sozinha, sem perguntar (quem mandou vê o áudio como ouvido)</label>
      <div class="hint">O áudio que você toca no WhatsApp vira texto e passa pela triagem; áudio novo que você ainda não ouviu aparece no chat com o botão Transcrever. A transcrição e o áudio ficam no Drive, na pasta da conversa. Chave da Groq: console.groq.com → API Keys → Create API Key (tem plano gratuito; acima do limite, US$ 0,04 por hora de áudio). O áudio vai para o serviço escolhido só para virar texto.</div></div>
    <div class="field"><label>📲 Sua conversa com você mesmo</label>
      <label style="display:flex;gap:8px;align-items:center;color:var(--text);font-weight:400"><input type="checkbox" id="sSl" ${s.selfLink !== false ? 'checked' : ''} style="width:auto"> Ligar a sua conversa ${esc(selfName() || '“Seu nome (você)”')} à assistente: o que você mandar lá (texto ou áudio) vira lembrete, compromisso, atividade ou nota, e ela responde lá</label>
      <input id="sSn" value="${esc(s.selfName || '')}" placeholder="${esc(db.meta.selfAuto ? 'Achei: ' + db.meta.selfAuto : 'Nome da conversa (eu acho sozinho: a que termina com “(você)”)')}" style="margin-top:6px">
      <label style="display:flex;gap:8px;align-items:center;color:var(--text);font-weight:400;margin-top:6px"><input type="checkbox" id="sSa" ${s.selfNotices !== false ? 'checked' : ''} style="width:auto"> Mandar para lá também o briefing da manhã e da noite, os lembretes na hora e o resumo da semana</label>
      <label style="display:flex;gap:8px;align-items:center;color:var(--text);font-weight:400;margin-top:6px"><input type="checkbox" id="sSu" ${s.selfUrgent ? 'checked' : ''} style="width:auto"> E os avisos urgentes do Cérebro</label>
      <div class="hint">Vai só para o seu próprio número. O app manda quando você não está mexendo no WhatsApp (30 s parado) e volta para a conversa em que você estava. Tudo que ele manda começa com 🤖, e isso ele não lê como pedido. O celular não toca para mensagem que você manda para você mesmo: fica lá na conversa para você ver. Para mensagem a outra pessoa continua valendo o seu ok.</div></div>
    <div class="field"><label>🧠 Cérebro</label>
      <label style="display:flex;gap:8px;align-items:center;color:var(--text);font-weight:400"><input type="checkbox" id="sBr" ${s.brain !== false ? 'checked' : ''} style="width:auto"> Pensar sozinho quando chegar coisa nova (no máximo a cada 15 min, e a cada 1 h 30 no horário de trabalho)</label>
      <label style="display:flex;gap:8px;align-items:center;color:var(--text);font-weight:400;margin-top:6px"><input type="checkbox" id="sBv" ${db.brain.voice ? 'checked' : ''} style="width:auto"> Falar em voz alta quando chegar coisa importante (o botão 🔇/🔊 do painel também liga e desliga)</label>
      <div class="hint">Cada vez que o Cérebro pensa é uma chamada à IA com o que chegou nas últimas 12 h, a agenda e as atividades (custo por uso da sua chave). ↻ no painel faz pensar na hora.</div></div>
    <div class="field"><label>🤖 OpenAI (opcional)</label>
      <input id="sOk" type="password" value="${esc(s.oaKey || '')}" placeholder="Chave da OpenAI (sk-…)" autocomplete="off">
      <label style="display:flex;gap:8px;align-items:center;color:var(--text);font-weight:400;margin-top:6px"><input type="checkbox" id="sOv" ${s.oaVoice !== false ? 'checked' : ''} style="width:auto"> Voz natural quando o Cérebro fala (voz gerada por IA da OpenAI; sem a chave uso a voz do Windows)</label>
      <label style="display:flex;gap:8px;align-items:center;color:var(--text);font-weight:400;margin-top:6px"><input type="checkbox" id="sOb" ${s.oaBackup !== false ? 'checked' : ''} style="width:auto"> Reserva: se o Claude falhar ou ficar sem crédito, a leitura do WhatsApp, o Cérebro e o resumo da semana usam a OpenAI</label>
      <input id="sOm" value="${esc(s.oaModel || 'gpt-5.4-mini')}" placeholder="Modelo de reserva" style="margin-top:6px">
      <div class="hint">Crie a chave em platform.openai.com → API keys. Fica só neste aparelho. O Claude continua sendo o cérebro principal; a OpenAI entra na voz e quando o Claude não responde. Também transcreve áudios: em 🎤 Áudios escolha OpenAI (se a chave de lá estiver vazia, uso esta).</div></div>
    <div class="field"><label>📊 Resumo da semana</label>
      <label style="display:flex;gap:8px;align-items:center;color:var(--text);font-weight:400"><input type="checkbox" id="sWk" ${s.weekly !== false ? 'checked' : ''} style="width:auto"> Toda sexta às 17 h, por obra: feito, pendente e esperando terceiros (salvo no Drive, em WhatsApp v1/Resumos semanais)</label></div>
    <div class="field"><label>Sobre você e seu trabalho</label><textarea id="sP" rows="3">${esc(s.profile || '')}</textarea><div class="hint">Ajuda a assistente a entender o que é com você nas mensagens.</div></div>
    <div class="field"><label>Memória da assistente (${db.facts.length})</label><textarea id="sF" rows="4" placeholder="Uma linha por fato. Ela acrescenta sozinha o que aprende nas conversas.">${esc(db.facts.join('\n'))}</textarea></div>` : ''}
    ${DESK ? `<div class="field"><label>📁 Pasta dos arquivos (Google Drive)</label>
      <div style="font-size:14px;word-break:break-all">${esc(driveInfo?.base || '…')}</div>
      <div class="hint">${driveInfo?.detected ? 'Google Drive encontrado: fotos das conversas que você abre e documentos que você baixa no WhatsApp vão para cá, separados por conversa, e o Drive sincroniza sozinho.' : '⚠️ Não achei o Google Drive no PC. Instale o "Google Drive para computador" (google.com/drive/download) e reabra o app, ou escolha a pasta. Enquanto isso salvo em Documentos.'}</div>
      <div class="btns" style="justify-content:flex-start;padding:6px 0 0"><button class="btn" data-act="drive-pick">Escolher pasta</button><button class="btn" data-act="drive-open">Abrir pasta</button></div></div>` : ''}
    ${DESK && dlInfo ? `<div class="field"><label>⬇️ Pasta dos downloads</label>
      <input id="sD" value="${esc(dlInfo.dir || '')}" placeholder="${esc(dlInfo.def || '')}">
      <div class="hint">Tudo o que você baixa no WhatsApp cai aqui, sem perguntar onde salvar (o app guarda uma cópia no Drive, na pasta da conversa). Backup e arquivos de agenda do app também.${dlInfo.error ? ' ⚠️ ' + esc(dlInfo.error) : ''}</div>
      <div class="btns" style="justify-content:flex-start;padding:6px 0 0"><button class="btn" data-act="dl-pick">Escolher pasta</button><button class="btn" data-act="dl-open">Abrir pasta</button>${dlInfo.custom ? '<button class="btn" data-act="dl-reset">Voltar ao padrão</button>' : ''}</div></div>` : ''}
    <div class="field"><label>Avisos antes do horário</label>
      <label style="display:flex;gap:8px;align-items:center;color:var(--text);font-weight:400"><input type="checkbox" id="sAvD" ${s.avisoDia !== false ? 'checked' : ''} style="width:auto"> Na véspera (24 h antes; só data: às 9 h do dia anterior)</label>
      <label style="display:flex;gap:8px;align-items:center;color:var(--text);font-weight:400;margin-top:6px"><input type="checkbox" id="sAvH" ${s.avisoHora !== false ? 'checked' : ''} style="width:auto"> 1 hora antes (só data: às 8 h do dia)</label>
      <div class="hint">Vale para atividades com data e para os compromissos da agenda. O aviso aparece no chat da assistente e como notificação.</div></div>
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
  if (d.toggle) { const t = db.tasks.find(x => x.id === d.toggle); if (!t.done) { if (e.target.type === 'checkbox') e.target.checked = false; confirmDoneSheet(t.id); return; } t.done = false; t.doneAt = ''; save(); render(); if (openChatId) renderMsgs(); if ($('#sheetBg').classList.contains('open') && el.closest('.sheet')) { const evId = t.eventId; if (evId) eventDetail(evId); } return; }
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
    case 'dl-pick': { const d = await window.wv1desk.dlPick(); if (d) { dlInfo = await window.wv1desk.dlSet(d); settingsSheet(); toast(dlInfo.error ? 'Não consegui usar essa pasta' : 'Pasta dos downloads definida'); } break; }
    case 'dl-open': window.wv1desk.dlOpen(); break;
    case 'dl-reset': { dlInfo = await window.wv1desk.dlSet(''); settingsSheet(); toast('Downloads de volta para ' + dlInfo.dir); break; }
    case 'gcal-connect': {
      const clientId = $('#gI').value.trim(), clientSecret = $('#gS').value.trim();
      if (!clientId || !clientSecret) return toast('Cole o ID e o segredo do cliente');
      db.settings.gcalId = clientId; db.settings.gcalSecret = clientSecret; save();
      el.textContent = 'Autorize no navegador…'; el.disabled = true;
      const r = await window.wv1desk.gcalConnect({ clientId, clientSecret });
      await gcalRefreshStatus(); settingsSheet();
      if (r && r.ok) { toast('Google Agenda conectada ✓'); gcalPull(); } else toast('Não conectou: ' + (r && r.error || 'tente de novo'));
      break;
    }
    case 'gcal-disconnect': await window.wv1desk.gcalDisconnect(); await gcalRefreshStatus(); settingsSheet(); toast('Google Agenda desconectada'); break;
    case 'gcal-sync': el.textContent = 'Sincronizando…'; el.disabled = true; await gcalPull(); settingsSheet(); toast('Agenda sincronizada'); break;
    case 'mprev': calMonth = new Date(calMonth.getFullYear(), calMonth.getMonth() - 1, 1); renderCal(); break;
    case 'mnext': calMonth = new Date(calMonth.getFullYear(), calMonth.getMonth() + 1, 1); renderCal(); break;
    case 'done-yes': { const fromSheet = !!el.closest('.sheet'); doneAnswer(id, true); if (fromSheet) closeSheet(); toast('Feito ✓'); break; }
    case 'done-no': doneAnswer(id, false); break;
    case 'plan-ok': runPlan(id); break;
    case 'plan-cancel': { const p = db.plans.find(x => x.id === id); if (p) { p.status = 'cancelado'; save(); render(); } break; }
    case 'task-plan': planForTask(id); break;
    case 'upd-go': updGo(); break;
    case 'upd-later': if ($('#updBar')) $('#updBar').style.display = 'none'; break;
    case 'ptasks-toggle': db.meta.ptasksClosed = !db.meta.ptasksClosed; save(); renderPTasks(); break;
    case 'inbox-ok': case 'sug-yes': if (db.inbox.some(x => x.id === id)) acceptInbox(id); else { sugResolve(id, 'descartada'); save(); renderSide(); } break;
    case 'inbox-no': case 'sug-no': db.inbox = db.inbox.filter(x => x.id !== id); sugResolve(id, 'descartada'); brainResolve(id, 'off'); save(); renderSide(); render(); break;
    case 'side-view': setSideView(id); break;
    case 'brain-think': brainThink(true); break;
    case 'self-open': waOpen(selfName() || '(você)'); break;
    case 'self-send': { const f = brainFind(x => x.id === id); if (f && selfSend(feedPlain(f), 'manual')) toast('📲 Vai para a sua conversa no WhatsApp (assim que ele estiver parado)'); break; }
    case 'brain-self': { const p = db.brain.pulse; if (p && selfSend(['🧠 *Agora*', p.manchete, ...brainPrios().map(x => (URG[x.urgencia] || '•') + ' ' + x.titulo + (x.porque ? ' — ' + x.porque : ''))].join('\n'), 'manual')) toast('📲 Vai para a sua conversa no WhatsApp'); break; }
    case 'brain-say': { const p = db.brain.pulse; if (!p) break; shush(); speak([p.manchete, ...brainPrios().slice(0, 3).map(x => x.titulo + '. ' + (x.porque || ''))].join(' ')); break; }
    case 'brain-voice': db.brain.voice = !db.brain.voice; save(); renderBrain(); if (!db.brain.voice) shush(); toast(db.brain.voice ? '🔊 Vou falar em voz alta quando chegar coisa importante' : '🔇 Voz desligada'); break;
    case 'brain-more': { const f = brainFind(x => x.id === id); if (f) { f.open = !f.open; save(); renderBrain(); } break; }
    case 'brain-open': { const f = brainFind(x => x.id === id); if (f && f.chat) waOpen(f.chat); break; }
    case 'brain-acc': { const f = brainFind(x => x.id === id); if (f && db.inbox.some(x => x.id === f.sugId)) acceptInbox(f.sugId); break; }
    case 'brain-no': { const f = brainFind(x => x.id === id); if (f) { db.inbox = db.inbox.filter(x => x.id !== f.sugId); f.st = 'off'; sugResolve(f.sugId, 'descartada'); save(); render(); } break; }
    case 'brain-reply': {
      const f = brainFind(x => x.id === id), it = f && db.inbox.find(x => x.id === f.sugId); if (!it) break;
      if (!db.settings.apiKey) { toast('Para eu preparar a resposta, configure a chave do Claude em Configurações'); break; }
      db.inbox = db.inbox.filter(x => x.id !== it.id); f.st = 'ok'; sugResolve(it.id, 'descartada'); save();
      brainPlan({ acao: 'responder', titulo: it.titulo, porque: [it.pessoa, it.trecho && '“' + it.trecho.slice(0, 200) + '”'].filter(Boolean).join(': '), conversa: it.conversa }); break;
    }
    case 'brain-snooze': {
      const f = brainFind(x => x.id === id), t = f && db.tasks.find(x => x.id === f.taskId); if (!t) break;
      t.remindAt = localISO(new Date(Date.now() + 3600e3)); t.notified = false; f.head = '⏰ Adiado'; f.sub = 'lembro de novo às ' + fmtHour(t.remindAt); save(); render(); toast('Lembro de novo às ' + fmtHour(t.remindAt)); break;
    }
    case 'pr-plan': case 'pr-task': case 'pr-open': case 'pr-off': {
      const x = brainPrios().find(p => p.chave === id); if (!x) break;
      if (d.act === 'pr-plan') brainPlan(x);
      else if (d.act === 'pr-task') { addTask({ title: x.titulo, chatId: 'claude' }); db.brain.off[x.chave] = Date.now(); save(); render(); toast('Virou atividade ✓'); }
      else if (d.act === 'pr-open') waOpen(x.conversa);
      else { db.brain.off[x.chave] = Date.now(); save(); renderBrain(); }
      break;
    }
    case 'inbox-all': [...db.inbox].forEach(x => acceptInbox(x.id, true)); render(); break;
    case 'aud-go': case 'aud-auto': {
      const m = audCards().find(x => x.card.id === id); if (!m) break;
      if (!sttOn()) { toast('Cole a chave da transcrição em Configurações'); settingsSheet(); break; }
      if (d.act === 'aud-auto') { db.settings.sttAuto = true; toast('Daqui para frente transcrevo os áudios novos sozinha'); }
      const ids = m.card.items.filter(x => !x.text).map(x => x.id); m.card.items.forEach(x => { x.erro = ''; });
      m.card.status = 'transcrevendo'; save(); renderSide(); if (openChatId === 'claude') renderMsgs();
      audQueue.push({ chat: m.card.chat, ids }); audPump(); break;
    }
    case 'aud-no': { const m = audCards().find(x => x.card.id === id); if (m) { m.card.status = 'nao'; save(); renderSide(); if (openChatId === 'claude') renderMsgs(); } break; }
    case 'week-view': { const m = weekCard(id); if (m) sheet(`<div class="mdv">${mdHtml(m.card.md || '')}</div><div class="btns">${m.card.file ? `<button class="btn" data-act="week-open" data-id="${id}">Abrir no Drive</button>` : ''}<button class="btn pri" data-act="close">Fechar</button></div>`); break; }
    case 'week-open': { const m = weekCard(id); if (m && m.card.file && window.wv1desk.openPath) window.wv1desk.openPath(m.card.file); break; }
    case 'apply-update': { el.textContent = 'Atualizando…'; el.disabled = true; const r = await window.wv1desk.applyUpdate(); if (r && r.error) { toast('Falhou: ' + r.error); closeSheet(); } break; }
    case 'new-chat': if (tab === 'agenda') eventForm({}); else if (tab === 'tasks') taskForm({}); else newChatSheet(); break;
    case 'settings': settingsSheet(); break;
    case 'new-event-day': eventForm({}, calSel); break;
    case 'save-event': {
      const title = $('#fT').value.trim(), start = $('#fS').value, end = $('#fE').value;
      if (!start) return toast('Informe o início');
      if (end && end < start) return toast('O fim é antes do início');
      if (id) { const ev = db.events.find(x => x.id === id); Object.assign(ev, { title: title || 'Compromisso', start, end, location: $('#fL').value.trim(), notes: $('#fN').value.trim(), allDay: false }); save(); gcalPush(ev); }
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
      if ($('#sD') && dlInfo && $('#sD').value.trim() !== dlInfo.dir) { const v = $('#sD').value.trim(); window.wv1desk.dlSet(v === dlInfo.def ? '' : v).then(r => { dlInfo = r; if (r.error) toast('⚠️ Pasta dos downloads: ' + r.error); }); }
      if ($('#gI')) { db.settings.gcalId = $('#gI').value.trim(); db.settings.gcalSecret = $('#gS').value.trim(); }
      if ($('#sAvD')) { db.settings.avisoDia = $('#sAvD').checked; db.settings.avisoHora = $('#sAvH').checked; }
      if ($('#sSl')) {
        const was = selfLinked(); db.settings.selfLink = $('#sSl').checked; db.settings.selfName = $('#sSn').value.trim(); db.settings.selfNotices = $('#sSa').checked; db.settings.selfUrgent = $('#sSu').checked;
        if (!was && selfLinked()) db.meta.selfSince = localISO(new Date()); // religou: o que ficou lá no meio tempo é histórico
        setTimeout(selfCfg, 100);
      }
      if ($('#sOk')) { db.settings.oaKey = $('#sOk').value.trim(); db.settings.oaVoice = $('#sOv').checked; db.settings.oaBackup = $('#sOb').checked; db.settings.oaModel = $('#sOm').value.trim() || 'gpt-5.4-mini'; }
      if ($('#sBr')) { db.settings.brain = $('#sBr').checked; db.brain.voice = $('#sBv').checked; }
      if ($('#sTk')) { db.settings.sttProvider = $('#sTp').value; db.settings.sttKey = $('#sTk').value.trim(); db.settings.sttAuto = $('#sTa').checked; db.settings.weekly = $('#sWk').checked; audCfg(); }
      db.settings.myName = $('#sN').value.trim(); db.settings.apiKey = $('#sK').value.trim(); db.settings.model = $('#sM').value.trim() || 'claude-sonnet-5-5';
      save(); closeSheet(); render(); if (openChatId) openChat(openChatId); toast('Salvo'); break;
    case 'export': {
      const copy = { ...db, settings: { ...db.settings, apiKey: '', sttKey: '', oaKey: '' } };
      const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(copy, null, 1)], { type: 'application/json' }));
      a.download = `whatsapp-v1-backup-${ymd(new Date())}.json`; a.click(); break;
    }
    case 'import': {
      const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'application/json';
      inp.onchange = async () => { try { const data = JSON.parse(await inp.files[0].text()); if (!data.chats) throw 0; data.settings = { ...data.settings, apiKey: db.settings.apiKey, sttKey: db.settings.sttKey }; db = data; save(); closeSheet(); render(); toast('Backup restaurado'); } catch { toast('Arquivo inválido'); } };
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
// notas importantes: abrem pelo botão 📝 no cabeçalho da assistente; ele escreve, a assistente acrescenta (ponto verde = nota nova); cópia em Notas.md no Drive
let notesTimer = null;
function notesSync() { clearTimeout(notesTimer); notesTimer = setTimeout(() => { if (DESK && window.wv1desk.notesSave) window.wv1desk.notesSave({ text: db.notes }).catch(() => {}); }, 1500); }
function notesFit() { const t = $('#notesText'); if (!t) return; t.style.height = 'auto'; t.style.height = Math.min(t.scrollHeight + 2, 160) + 'px'; }
function renderNotes() { const t = $('#notesText'); if (!t) return; if (t.value !== db.notes) t.value = db.notes; $('#notes').classList.toggle('show', !!db.meta.notesOpen); if (db.meta.notesOpen) db.meta.notesNew = false; $('#notesDot')?.classList.toggle('on', !!db.meta.notesNew); notesFit(); }
function addNote(text) {
  const t = String(text || '').trim().replace(/^[•\-*]\s*/, ''); if (!t) return false;
  if (db.notes.toLowerCase().includes(t.toLowerCase())) return false;
  db.notes = (db.notes.trim() ? db.notes.replace(/\s+$/, '') + '\n' : '') + '• ' + t; if (!db.meta.notesOpen) db.meta.notesNew = true; save(); renderNotes(); notesSync(); return true;
}
if ($('#notesText')) {
  $('#notesText').addEventListener('input', () => { db.notes = $('#notesText').value; save(); notesFit(); notesSync(); });
  $('#notesToggle').addEventListener('click', () => { db.meta.notesOpen = false; save(); renderNotes(); });
  $('#notesBtn')?.addEventListener('click', () => { db.meta.notesOpen = !db.meta.notesOpen; save(); renderNotes(); if (db.meta.notesOpen) $('#notesText').focus(); });
  renderNotes();
}
// painel da assistente mais largo, com divisória para arrastar (a largura fica guardada)
function applySideW() { const w = Math.max(340, Math.min(db.meta.sideW || 480, Math.max(340, innerWidth - 560))); document.documentElement.style.setProperty('--sideW', w + 'px'); }
applySideW(); addEventListener('resize', applySideW);
$('#sideGrip')?.addEventListener('pointerdown', e => {
  e.preventDefault(); const g = e.currentTarget, cover = document.createElement('div'); cover.className = 'dragcover'; document.body.appendChild(cover); g.classList.add('on');
  const move = ev => { db.meta.sideW = Math.round(innerWidth - ev.clientX); applySideW(); };
  const up = () => { removeEventListener('pointermove', move); removeEventListener('pointerup', up); cover.remove(); g.classList.remove('on'); save(); };
  addEventListener('pointermove', move); addEventListener('pointerup', up);
});
$('#sideGrip')?.addEventListener('dblclick', () => { db.meta.sideW = 480; applySideW(); save(); });
$('#sideSend').addEventListener('click', () => sendSide());
$('#sideInput').addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendSide(); } });
async function sendSide() {
  const t = $('#sideInput').value.trim(); if (!t) return;
  $('#sideInput').value = ''; if (sideView() !== 'chat') setSideView('chat');
  pushMsg('claude', { from: 'me', text: t });
  if (OK_RE.test(t) && db.plans.some(p => p.status === 'aguardando_ok')) { runPlan(db.plans.find(p => p.status === 'aguardando_ok').id); return; }
  if (/ler todo o whatsapp/i.test(t)) sweepNow(); else if (/^📖|ler todas as conversas/i.test(t)) await readAll(true); else if (WEEK_RE.test(t)) await weeklyReport({ manual: true }); else await askClaude(t);
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

// ---------- atualização (app de computador): baixa sozinha; instala quando você não está usando ----------
let lastInputHost = Date.now(); ['mousedown', 'keydown'].forEach(ev => document.addEventListener(ev, () => { lastInputHost = Date.now(); }, true));
const hostIdle = () => document.hidden || Date.now() - lastInputHost > 5 * 60e3;
let updReady = null, updBusy = false; // { kind: 'ui' | 'desktop', version }
function updBar(text, btn) {
  let el = $('#updBar');
  if (!el) { el = document.createElement('div'); el.id = 'updBar'; el.style.cssText = 'position:fixed;left:50%;bottom:16px;transform:translateX(-50%);background:#111b21;color:#fff;padding:10px 14px;border-radius:10px;font-size:14px;z-index:9999;display:flex;gap:10px;align-items:center;box-shadow:0 4px 16px rgba(0,0,0,.3);max-width:90vw'; document.body.appendChild(el); }
  el.innerHTML = `<span>${esc(text)}</span>${btn ? `<button class="btn pri" data-act="upd-go" style="padding:6px 10px">${esc(btn)}</button><button class="btn" data-act="upd-later" style="padding:6px 10px">Depois</button>` : ''}`;
  el.style.display = '';
}
async function updGo() {
  if (!updReady || updBusy) return; updBusy = true;
  try {
    if (updReady.kind === 'desktop') { updBar(`Instalando a versão ${updReady.version}… o app reabre sozinho.`); const r = await window.wv1desk.updateInstall(); if (r && r.error) { updBar('Não consegui instalar: ' + r.error, null); updReady = null; } }
    else { updBar('Atualizando…'); const r = await window.wv1desk.applyUpdate(); if (r && r.error) { updBar('Falhou: ' + r.error, null); updReady = null; } }
  } finally { updBusy = false; }
}
async function checkUpdate(silent) {
  if (!DESK) return;
  try {
    const u = await window.wv1desk.checkUpdate();
    $('#rbUpd').classList.toggle('has', !!u.available);
    if (u.error) { if (!silent) toast('Não consegui verificar: ' + u.error); return; }
    if (!u.available) { if (!silent) toast(`Você já está na versão mais nova (${u.current})`); return; }
    if (u.desktopNeeded) {
      if (!silent) updBar(`Baixando a versão ${u.latest}…`);
      const d = await window.wv1desk.updateDownload();
      if (d.status !== 'ready') { if (!silent) updBar('Não consegui baixar: ' + (d.error || d.status), null); return; }
      updReady = { kind: 'desktop', version: d.version };
      if (silent && hostIdle()) return updGo();
      updBar(`Versão ${d.version} baixada e pronta.`, 'Reiniciar para atualizar');
    } else {
      updReady = { kind: 'ui', version: u.latest };
      if (silent && hostIdle()) return updGo();
      updBar(`Versão ${u.latest} pronta (leva segundos; o WhatsApp recarrega).`, 'Atualizar agora');
    }
  } catch (e) { if (!silent) toast('Não consegui verificar a atualização'); }
}
if (DESK) {
  $('#rbUpd').addEventListener('click', () => checkUpdate(false));
  setTimeout(() => checkUpdate(true), 20000); setInterval(() => checkUpdate(true), 4 * 3600e3);
  setInterval(() => { if (updReady && hostIdle()) updGo(); }, 60e3); // ficou pendente por estar em uso: instala assim que parar
  if (window.wv1desk.onUpdateProgress) window.wv1desk.onUpdateProgress(d => {
    const el = $('#updBar');
    if (d.status === 'downloading' && el && el.style.display !== 'none') updBar(`Baixando a versão ${d.version}… ${d.pct || 0}%`);
    if (d.status === 'error' && updReady) { updReady = null; updBar('Não consegui instalar a atualização: ' + d.error + '. Baixe o instalador no projeto.', null); }
  });
}

// ---------- leitura automática do WhatsApp → cartões "Colocar como tarefa?" no chat da assistente ----------
db.inbox = db.inbox || []; db.meta.waSeen = db.meta.waSeen || []; db.waLog = db.waLog || []; db.facts = db.facts || []; if (typeof db.notes !== 'string') db.notes = ''; db.plans = db.plans || [];
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
    if (b.chat && selfLinked() && isSelf(b.chat)) { selfIngest(b); continue; } // 📲 sua conversa com você mesmo: pedido direto à assistente
    if (b.chat && psiChat(b.chat)) { (b.msgs || []).forEach(m => waSeen.add(m.id)); continue; } // conversa com a psicóloga: fica fora do log, do Drive, da assistente e do Cérebro
    if (!b.chat || ign.some(x => b.chat.toLowerCase().includes(x))) { (b.msgs || []).forEach(m => waSeen.add(m.id)); continue; }
    for (const m of b.msgs || []) {
      if (waSeen.has(m.id)) continue; waSeen.add(m.id);
      const t = waTs(m.meta);
      if (!m.text || m.text.length < 2) continue;
      const rec = { chat: b.chat, who: m.out ? 'Eu' : (t.who || m.who || b.chat), when: localISO(t.d), text: m.text.slice(0, m.audio ? 3000 : 800) };
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
  if (waQueue.length) waSchedule(waQueue.length >= 25 ? 2000 : 45000);
}
// espera juntar mensagens antes da triagem; uma triagem pedida com pressa (áudio que ele mandou transcrever) não é empurrada
let waUrgent = 0;
function waSchedule(ms, urgent) {
  const now = Date.now();
  if (!urgent && waUrgent > now && waUrgent <= now + ms) return;
  if (urgent) waUrgent = now + ms;
  clearTimeout(waTimer); waTimer = setTimeout(flushWa, ms);
}
function addInbox(it) {
  const key = (it.titulo || '').toLowerCase();
  if (!key || db.inbox.some(x => x.titulo.toLowerCase() === key) || db.tasks.some(t => !t.done && t.title.toLowerCase() === key)) return;
  let quando = (it.quando || '').slice(0, 16), titulo = it.titulo;
  if (it.tipo === 'responder') { if (!/^respond/i.test(titulo)) titulo = 'Responder ' + (it.pessoa || it.conversa || '') + ': ' + titulo; if (quando.length < 16) quando = localISO(new Date(Date.now() + 2 * 3600e3)); }
  const item = { id: uid(), origem: it.origem || (it.tipo === 'compromisso' ? 'compromisso' : 'pedido'), tipo: it.tipo || 'atividade', titulo, quando, conversa: it.conversa || '', pessoa: it.pessoa || '', prioridade: it.prioridade || 'media', motivo: it.motivo || '', trecho: it.trecho || '', fala: it.fala || '', ts: new Date().toISOString() };
  db.inbox.unshift(item);
  if (db.settings.waAuto) acceptInbox(item.id, true); else askInbox(item);
  return item;
}
// toda coisa nova vira uma linha narrada no Cérebro ("Kaleu mandou…; tem isso para agendar") com Agendar / Virar tarefa / Responder
function askInbox(it, quiet) {
  if (brainFind(f => f.sugId === it.id)) return; it.card = 1;
  const sub = [it.quando ? fmtDay(it.quando) + (it.quando.length > 10 ? ', ' + fmtHour(it.quando) : '') : '', it.conversa ? '💬 ' + it.conversa : ''].filter(Boolean).join(' · ');
  brainAdd({ kind: 'sug', key: 's:' + it.id, sugId: it.id, icon: { compromisso: '📅', lembrete: '🔔', responder: '💬' }[it.tipo] || '✅', text: it.fala || sugFala(it), sub, chat: it.conversa || '', prio: it.prioridade === 'alta' ? 'alta' : 'media', ts: it.ts || new Date().toISOString(), quiet });
}
function sugMsg(id) { return db.chats.find(c => c.id === 'claude').messages.find(m => m.card && m.card.type === 'sug' && m.card.id === id); }
function sugResolve(id, status, ref) { const m = sugMsg(id); if (!m) return false; m.card.status = status; if (ref) Object.assign(m.card, ref); return true; }
function acceptInbox(id, quiet) {
  const it = db.inbox.find(x => x.id === id); if (!it) return;
  db.inbox = db.inbox.filter(x => x.id !== id);
  const notes = it.conversa ? `Do WhatsApp (${it.conversa}): ${it.trecho}` : it.trecho;
  if (it.tipo === 'compromisso' && it.quando.length > 10) {
    const ev = addEvent({ title: it.titulo, start: it.quando, notes, chatId: 'claude' });
    const a = sugResolve(id, 'aceita', { eventId: ev.id }), b = brainResolve(id, 'ok', { eventId: ev.id });
    if (!a && !b) brainAdd({ kind: 'info', icon: '📅', text: 'Agendei: ' + it.titulo, sub: fmtWhen(ev), quiet: true });
  } else {
    const remindAt = it.tipo === 'lembrete' || it.tipo === 'responder' || it.quando.length > 10 ? (it.quando.length > 10 ? it.quando : (it.quando ? it.quando + 'T08:00' : '')) : '';
    const t = addTask({ title: it.titulo, due: it.quando.slice(0, 10), remindAt, chatId: 'claude' });
    const a = sugResolve(id, 'aceita', { taskId: t.id }), b = brainResolve(id, 'ok', { taskId: t.id });
    if (!a && !b) brainAdd({ kind: 'info', icon: '✅', text: 'Virou atividade: ' + it.titulo, quiet: true });
    if (it.tipo === 'responder' && !quiet && db.settings.apiKey) setTimeout(() => planForTask(t.id), 300); // já deixa a resposta pronta para o ok
  }
  save(); if (!quiet) render(); else renderSide();
}
async function flushWa() {
  if (waBusy) { waTimer = setTimeout(flushWa, 5000); return; }
  const batch = waQueue.splice(0, 60); if (!batch.length) return;
  waBusy = true; renderSide();
  try {
    if (!db.settings.apiKey && !oaOn()) {
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
      const out = await aiJson({ max: 8000, effort: 'medium',
          system: `Você é a secretária executiva de ${db.settings.myName || 'o usuário'}. Perfil dele: ${db.settings.profile || '(não informado)'}
O que você já sabe (memória):\n${db.facts.slice(-60).map(f => '- ' + f).join('\n') || '(nada ainda)'}
Você lê as mensagens novas do WhatsApp dele ("Eu" = ele) e age como uma secretária atenta e proativa:
1) Faça TRIAGEM. Em "itens" entra só o que é com ele, em uma destas origens:
   - pedido: alguém pediu a ELE para fazer, enviar, pagar, decidir, conferir ou comparecer (conversa privada, ou no grupo citando o nome dele ou o papel dele);
   - pergunta: pergunta dirigida a ELE que ainda não teve resposta dele (tipo "responder");
   - promessa: ele mesmo se comprometeu ("Eu: mando amanhã", "Eu: vejo e te falo");
   - compromisso: reunião, visita, vistoria, prazo ou entrega com data que envolve ele.
   NÃO entra em "itens": mensagem só informativa, aviso geral de grupo, pedido feito a outra pessoa, tarefa de outro, assunto que ele já respondeu ou resolveu, agradecimento, "ok", "bom dia". Se for informação de trabalho, vai só para "resumos" ou "notas". Na dúvida se o pedido é para ele, não coloque. Cada item vira um cartão que ele precisa aprovar, então seja seletiva: pouco e certo.
2) Feito? Se as mensagens mostram que ele já cumpriu algo dos pendentes (ex.: "Eu: enviado", "Eu: já paguei"), liste o id em "concluidas" com o motivo (o trecho que mostra). O app pergunta a ele "Isso foi feito?" antes de tirar da lista.
3) Aprenda: fatos úteis e duradouros sobre pessoas, obras, clientes e empresas (quem é quem, papéis, locais, prazos de contrato) vão em "fatos", uma frase curta cada, só se forem novos. Nada de saúde, política, fofoca ou dados sensíveis.
4) Resuma: para cada conversa com novidade de trabalho (decisão, pedido, número, prazo, combinado), 1 a 3 frases objetivas em "resumos", mesmo sem ação para ele. Conversa só social não entra.
5) Notas: informação de referência que ele vai querer consultar depois (endereço de obra, número de contrato/processo/ofício, valor combinado, código, horário fixo, decisão fechada) vai em "notas", uma frase curta e completa cada, só se for nova. Notas já existentes:\n${db.notes.trim().slice(-1500) || '(nenhuma)'}
6) Narre, como quem conta em voz alta para ele: cada item tem "fala", uma frase curta que começa por quem mandou e diz o que fazer (ex.: "Kaleu mandou o cronograma da sondagem; tem a visita de sexta às 9h para agendar." / "O Alex perguntou se o financeiro já está rodando; está esperando sua resposta."). Em "novidades", até 4 coisas de trabalho que ele deve saber mesmo sem ação dele (documento ou foto de documento recebido, decisão, valor, mudança de data, alguém avisando que fez algo), no mesmo estilo de fala, com a conversa e a importância. Nada social nem repetido dos itens.
Ignore conversa social, figurinhas, propaganda, correntes, avisos genéricos de grupo e o que não é com ele. Em grupos grandes, só o que o menciona ou cabe ao papel dele.
Mensagens que começam com 🎤 são áudios transcritos automaticamente: nomes, números e termos técnicos podem ter saído errados na transcrição; entenda pela intenção e, no trecho, comece com "🎤".
Prioridade: alta = prazo em até 24h, cliente ou órgão público cobrando, dinheiro, ou pergunta a ele sem resposta há mais de 2h; media = prazo nesta semana; baixa = o resto.
Agora: ${localISO(now)} (${now.toLocaleDateString('pt-BR', { weekday: 'long' })}). Datas relativas contam a partir da hora de cada mensagem; sem hora, use só a data.
Pendentes já registrados (não repita; use os ids para dar baixa):\n${pend || '(nenhum)'}\nSugestões ainda não confirmadas (não repita):\n${sug || '(nenhuma)'}\nResponda só com o JSON pedido. Campo sem informação vai como texto vazio; se não houver nada novo, listas vazias.`,
          user: txt, schema: { type: 'object', properties: {
            itens: { type: 'array', items: { type: 'object', properties: {
              origem: { type: 'string', enum: ['pedido', 'pergunta', 'promessa', 'compromisso'], description: 'Por que é com ele (triagem)' },
              tipo: { type: 'string', enum: ['compromisso', 'lembrete', 'atividade', 'responder'] }, titulo: { type: 'string', description: 'Ação curta e concreta, ex.: "Enviar laudo SPT ao Alex"; para responder: "Responder Alex: data da vistoria"' },
              quando: { type: 'string', description: 'YYYY-MM-DDTHH:MM ou YYYY-MM-DD; vazio se não houver' }, conversa: { type: 'string' }, pessoa: { type: 'string', description: 'Quem pediu/perguntou' },
              prioridade: { type: 'string', enum: ['alta', 'media', 'baixa'] }, trecho: { type: 'string', description: 'Trecho da mensagem que originou' }, motivo: { type: 'string', description: 'Uma linha: por que isso importa' },
              fala: { type: 'string', description: 'Frase de narrador para ele: quem mandou + o que fazer' } } } },
            novidades: { type: 'array', items: { type: 'object', properties: { conversa: { type: 'string' }, fala: { type: 'string' }, importancia: { type: 'string', enum: ['alta', 'media'] } } } },
            concluidas: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, motivo: { type: 'string' } } } },
            fatos: { type: 'array', items: { type: 'string' } },
            resumos: { type: 'array', items: { type: 'object', properties: { conversa: { type: 'string' }, resumo: { type: 'string' } } } },
            notas: { type: 'array', items: { type: 'string' } } } } });
      const novos = (out.itens || []).filter(it => ORIGENS[it.origem]).map(addInbox).filter(Boolean); // triagem: só o que é com ele
      for (const c of out.concluidas || []) askDone(c.id, c.motivo ? 'Vi no WhatsApp: ' + c.motivo : 'Pelas mensagens do WhatsApp parece que já foi feito.', false, 'brain'); // só sai da lista com o Sim dele
      for (const n of (out.novidades || []).slice(0, 5)) if (n && n.fala) brainAdd({ kind: 'info', icon: '💬', text: n.fala, chat: n.conversa || '', sub: n.conversa ? '💬 ' + n.conversa : '', prio: n.importancia === 'alta' ? 'alta' : 'media' });
      for (const f of out.fatos || []) { const k = String(f).trim(); if (k && k.length < 200 && !db.facts.some(x => x.toLowerCase() === k.toLowerCase())) db.facts.push(k); }
      if (db.facts.length > 80) db.facts.splice(0, db.facts.length - 80);
      const sums = (out.resumos || []).filter(r => r && r.conversa && r.resumo).map(r => `### ${fmtHour(localISO(now))} — ${r.conversa}\n${String(r.resumo).trim()}`);
      if (sums.length && DESK && db.settings.driveLog !== false) window.wv1desk.summaryAppend({ date: ymd(now), text: sums.join('\n\n') }).then(refreshSums).catch(() => {});
      // proativa: conta o que anotou e avisa na hora o que é urgente
      const notas = (out.notas || []).filter(addNote);
      if (notas.length) brainAdd({ kind: 'note', icon: '📝', text: 'Anotei nas notas: ' + notas.join('; '), prio: 'baixa' });
      if (novos.length || (out.novidades || []).length || (out.concluidas || []).length) brainSoon(15000); // o Cérebro repensa as prioridades
      const soon = localISO(new Date(Date.now() + 3 * 3600e3));
      novos.filter(n => n.prioridade === 'alta' || (n.quando.length > 10 && n.quando <= soon)).slice(0, 3).forEach(n => notify('📌 ' + n.titulo, (n.pessoa ? n.pessoa + ' · ' : '') + n.conversa));
    }
    save();
  } catch (e) { console.warn('leitura do WhatsApp:', e.message); waQueue.unshift(...batch.slice(0, 30)); waTimer = setTimeout(flushWa, 120000); }
  finally { waBusy = false; render(); }
}

// ---------- planos de execução: a assistente monta, ele aprova com "ok", o app executa ----------
const STEP_ICON = { whatsapp: '💬', compromisso: '📅', lembrete: '🔔', nota: '📝', concluir: '✅' };
const PLAN_STATUS = { aguardando_ok: 'aguardando ok', executando: 'executando', feito: 'feito', erro: 'com erro', cancelado: 'cancelado' };
function stepText(st) {
  switch (st.tipo) {
    case 'whatsapp': return `Enviar no WhatsApp para ${st.conversa}: “${st.mensagem}”`;
    case 'compromisso': return `Marcar "${st.titulo}" ${st.inicio ? fmtDay(st.inicio) + ', ' + fmtHour(st.inicio) : ''}${st.local ? ' @ ' + st.local : ''}`;
    case 'lembrete': return `Lembrete ${st.quando ? fmtDay(st.quando) + ', ' + fmtHour(st.quando) : ''}: ${st.titulo}`;
    case 'nota': return `Anotar: ${st.texto}`;
    case 'concluir': return `Dar baixa: ${(db.tasks.find(t => t.id === st.atividade_id) || {}).title || st.atividade_id || 'atividade'}`;
    default: return JSON.stringify(st);
  }
}
function createPlan(i, chatId) {
  const passos = (i.passos || []).filter(st => st && st.tipo && (st.tipo !== 'whatsapp' || (st.conversa && st.mensagem)) && (st.tipo !== 'compromisso' || (st.titulo && st.inicio)) && (st.tipo !== 'lembrete' || (st.titulo && st.quando)) && (st.tipo !== 'nota' || st.texto)).map(st => ({ ...st, status: 'pendente', erro: '' }));
  if (!passos.length) return null;
  db.plans.forEach(p => { if (p.status === 'aguardando_ok') p.status = 'cancelado'; }); // o plano novo substitui o que estava esperando
  const plan = { id: uid(), titulo: i.titulo || 'Plano', taskId: i.atividade_id || '', passos, status: 'aguardando_ok', criado: new Date().toISOString() };
  db.plans.unshift(plan); if (db.plans.length > 100) db.plans.length = 100;
  save(); pushMsg(chatId || 'claude', { from: 'them', card: { type: 'plan', id: plan.id } });
  brainAdd({ kind: 'plan', key: 'p:' + plan.id, planId: plan.id, icon: '🗂', text: 'Deixei pronto: ' + plan.titulo + '. Confere e me dá o ok.', quiet: true }); render();
  return plan;
}
const waSendWaiters = {};
function waSend(chat, text) {
  return new Promise(resolve => {
    if (!DESK || !waWv) return resolve({ ok: false, erro: 'o WhatsApp não está aberto dentro do app' });
    const id = uid(); waSendWaiters[id] = resolve;
    setTimeout(() => { if (waSendWaiters[id]) { delete waSendWaiters[id]; resolve({ ok: false, erro: 'o WhatsApp não respondeu (tempo esgotado)' }); } }, 45000);
    try { waWv.send('wa-send', { id, chat, text }); } catch (e) { delete waSendWaiters[id]; resolve({ ok: false, erro: e.message }); }
  });
}
async function runPlan(id) {
  const p = db.plans.find(x => x.id === id); if (!p || p.status === 'executando') return;
  p.status = 'executando'; save(); render();
  let failed = null;
  for (const st of p.passos) {
    if (st.status === 'feito') continue;
    try {
      if (st.tipo === 'whatsapp') { const r = await waSend(st.conversa, st.mensagem); if (!r.ok) throw new Error(r.erro || 'falhou'); }
      else if (st.tipo === 'compromisso') { const ev = addEvent({ title: st.titulo, start: st.inicio.slice(0, 16), end: (st.fim || '').slice(0, 16), location: st.local || '', notes: st.observacoes || '', chatId: 'claude' }); st.ref = ev.id; }
      else if (st.tipo === 'lembrete') { const t = addTask({ title: st.titulo, remindAt: st.quando.slice(0, 16), chatId: 'claude' }); st.ref = t.id; }
      else if (st.tipo === 'nota') addNote(st.texto);
      else if (st.tipo === 'concluir') { const t = db.tasks.find(x => x.id === (st.atividade_id || p.taskId)); if (t) { t.done = true; t.doneAt = new Date().toISOString(); } }
      st.status = 'feito'; st.erro = '';
    } catch (e) { st.status = 'erro'; st.erro = e.message; failed = st; break; }
    save(); render();
  }
  p.status = failed ? 'erro' : 'feito'; p.fim = new Date().toISOString(); save(); render();
  pushMsg('claude', { from: 'them', text: failed ? `⚠️ Parei em "${stepText(failed).slice(0, 80)}": ${failed.erro}. Ajuste e me diga "ok" de novo, ou faça por fora.` : `✅ Feito: ${p.titulo}.` });
}
async function planForTask(id) {
  const t = db.tasks.find(x => x.id === id); if (!t) return;
  if (!db.settings.apiKey) return toast('Preciso da chave da API para montar o plano');
  const typing = pushMsg('claude', { from: 'them', text: 'montando o plano…', pending: true }); renderSide();
  try {
    await callClaude({ system: systemPrompt(), tools: TOOLS, postTo: 'claude', messages: [{ role: 'user', content: `[pedido do app, não é mensagem digitada por ele] Monte com preparar_plano o plano de execução da atividade [${t.id}] "${t.title}"${t.due ? ' (prazo ' + t.due + ')' : ''}. Se precisar de contexto, use ler_historico ou buscar_conversas antes. Se for responder, cobrar ou avisar alguém, escreva a mensagem pronta em primeira pessoa, no tom dele (direto, educado, sem floreio), com o nome da conversa exatamente como aparece no WhatsApp. Inclua o passo "concluir" (atividade_id ${t.id}) se o plano resolver a atividade. Depois responda em uma linha pedindo o ok.` }] });
  } catch (e) { pushMsg('claude', { from: 'them', text: '⚠️ Não consegui montar o plano: ' + e.message }); }
  finally { const c = db.chats.find(x => x.id === 'claude'); c.messages = c.messages.filter(m => m.id !== typing.id); save(); render(); }
}
// manual no Drive (Atividades.md): pendentes com seus planos, planos executados e concluídas
let manualTimer = null, manualLast = '';
function scheduleManual() { if (!window.wv1desk || !window.wv1desk.docWrite || db.settings.driveLog === false) return; clearTimeout(manualTimer); manualTimer = setTimeout(writeManual, 3000); }
function writeManual() {
  const fmt = d => new Date(d).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  const key = t => t.remindAt || (t.due ? t.due + 'T23:59' : '9999');
  const stepLine = st => `${STEP_ICON[st.tipo] || '•'} ${stepText(st)}${st.status === 'feito' ? ' ✓' : st.status === 'erro' ? ' ⚠ ' + st.erro : ''}`;
  const pend = db.tasks.filter(t => !t.done).sort((a, b) => key(a).localeCompare(key(b))).map(t => {
    const p = db.plans.find(x => x.taskId === t.id && x.status !== 'cancelado' && x.status !== 'feito');
    return `- [ ] ${t.title}${t.due ? ' — prazo ' + t.due : ''}${t.remindAt ? ' — lembrete ' + t.remindAt.replace('T', ' ') : ''}${p ? `\n  - plano (${PLAN_STATUS[p.status]}): ` + p.passos.map(stepLine).join(' | ') : ''}`;
  });
  const plans = db.plans.filter(p => p.status === 'feito' || p.status === 'erro').slice(0, 30).map(p => `- ${p.status === 'feito' ? '✅' : '⚠️'} ${fmt(p.fim || p.criado)} — ${p.titulo}: ` + p.passos.map(stepLine).join(' | '));
  const done = db.tasks.filter(t => t.done).slice(-50).reverse().map(t => `- [x] ${t.title}`);
  const body = `## Pendentes (${pend.length})\n${pend.join('\n') || '(nenhuma)'}\n\n## Planos executados\n${plans.join('\n') || '(nenhum)'}\n\n## Concluídas\n${done.join('\n') || '(nenhuma)'}\n`;
  if (body === manualLast) return; manualLast = body;
  window.wv1desk.docWrite({ name: 'Atividades', text: `# Atividades — manual de execução (WhatsApp v1)\nAtualizado: ${fmt(new Date())}\n\n` + body }).catch(() => {});
}

// ---------- Google Agenda (computador): OAuth do próprio usuário; compromissos vão e vêm da agenda principal ----------
let gcal = { connected: false, email: '' }, gcalPulling = false;
const TZ = Intl.DateTimeFormat().resolvedOptions().timeZone;
const gcalOn = () => DESK && !!gcal.connected;
async function gcalRefreshStatus() { if (!DESK || !window.wv1desk.gcalStatus) return; try { gcal = await window.wv1desk.gcalStatus(); } catch {} }
function gBody(ev) {
  if (ev.allDay) { const d = ev.start.slice(0, 10); return { summary: ev.title, location: ev.location || '', description: ev.notes || '', start: { date: d }, end: { date: ymd(new Date(parseLocal(d).getTime() + 864e5)) } }; }
  const start = ev.start.length > 10 ? ev.start : ev.start + 'T08:00';
  const end = ev.end && ev.end.length > 10 && ev.end > start ? ev.end : localISO(new Date(parseLocal(start).getTime() + 3600e3));
  return { summary: ev.title, location: ev.location || '', description: ev.notes || '', start: { dateTime: start + ':00', timeZone: TZ }, end: { dateTime: end + ':00', timeZone: TZ } };
}
async function gcalPush(ev) {
  if (!gcalOn() || !ev) return;
  try {
    const r = ev.gid ? await window.wv1desk.gcal({ method: 'PATCH', path: '/calendars/primary/events/' + encodeURIComponent(ev.gid), body: gBody(ev) })
                     : await window.wv1desk.gcal({ method: 'POST', path: '/calendars/primary/events', body: gBody(ev) });
    if (r && r.error) { if (r.status === 404 && ev.gid) { ev.gid = ''; return gcalPush(ev); } throw new Error(r.error); }
    ev.gid = r.id; ev.getag = r.updated || ''; ev.gdirty = false; save();
  } catch (e) { ev.gdirty = true; save(); toast('Google Agenda: ' + e.message); }
}
async function gcalDelete(gid) { if (!gcalOn() || !gid) return; try { await window.wv1desk.gcal({ method: 'DELETE', path: '/calendars/primary/events/' + encodeURIComponent(gid) }); } catch {} }
function gToLocal(it) {
  const allDay = !!(it.start && it.start.date);
  return { title: it.summary || '(sem título)', start: allDay ? it.start.date + 'T00:00' : (it.start.dateTime || '').slice(0, 16), end: allDay ? '' : ((it.end && it.end.dateTime) || '').slice(0, 16), location: it.location || '', notes: it.description || '', allDay, getag: it.updated || '' };
}
async function gcalPull() { // traz 7 dias para trás e 90 para a frente; o que foi apagado lá some aqui; o que é só daqui sobe
  if (!gcalOn() || gcalPulling) return; gcalPulling = true;
  try {
    const from = new Date(Date.now() - 7 * 864e5), to = new Date(Date.now() + 90 * 864e5);
    const r = await window.wv1desk.gcal({ path: '/calendars/primary/events', query: { timeMin: from.toISOString(), timeMax: to.toISOString(), singleEvents: 'true', orderBy: 'startTime', maxResults: '250', timeZone: TZ } });
    if (!r || r.error) throw new Error((r && r.error) || 'sem resposta');
    const seen = new Set(); let changed = false;
    for (const it of r.items || []) {
      if (it.status === 'cancelled' || !it.start) continue;
      seen.add(it.id);
      const loc = gToLocal(it);
      let ev = db.events.find(e => e.gid === it.id);
      if (!ev) { ev = db.events.find(e => !e.gid && e.title === loc.title && e.start === loc.start); if (ev) { ev.gid = it.id; changed = true; } } // já existia aqui: só liga
      if (ev) { if (ev.getag !== loc.getag && !ev.gdirty) { Object.assign(ev, loc); changed = true; } }
      else { db.events.push({ id: uid(), gid: it.id, ...loc, chatId: null, source: 'google', created: new Date().toISOString() }); changed = true; }
    }
    const fromS = localISO(from), toS = localISO(to);
    const gone = db.events.filter(e => e.gid && !seen.has(e.gid) && e.start >= fromS && e.start <= toS);
    if (gone.length) { const ids = new Set(gone.map(e => e.id)); db.events = db.events.filter(e => !ids.has(e.id)); db.tasks.forEach(t => { if (ids.has(t.eventId)) t.eventId = null; }); changed = true; }
    for (const e of db.events.filter(e => (!e.gid || e.gdirty) && e.start >= ymd(new Date()))) await gcalPush(e);
    db.meta.gcalSync = new Date().toISOString();
    if (changed) { save(); render(); } else save();
  } catch (e) { console.warn('Google Agenda:', e.message); }
  finally { gcalPulling = false; }
}

// ---------- áudios do WhatsApp: viram texto (Groq ou OpenAI, chave dele) e entram na leitura e na triagem como mensagem ----------
const STT_NAMES = { groq: 'Groq (recomendado)', openai: 'OpenAI' };
const STT_PROMPT = 'Áudio de WhatsApp em português do Brasil, trabalho de engenharia civil: SPT, CPTu, sondagem rotativa, CBUQ, Marshall, Benkelman, talude, recalque, aterro sanitário, ART, medição, aditivo, reequilíbrio, DNIT, ABNT, Trojan, NEV.';
const sttKeyNow = () => (db.settings.sttKey || '').trim() || (db.settings.sttProvider === 'openai' ? (db.settings.oaKey || '').trim() : '');
const sttOn = () => DESK && !!sttKeyNow() && db.settings.waRead !== false && !!(window.wv1desk && window.wv1desk.stt);
const fmtDur = s => s ? `${Math.floor(s / 60)}:${pad(Math.round(s % 60))}` : '';
const audDone = new Set(db.meta.audioDone || []), audBusy = new Set(), audQueue = [], audWaiters = {};
var audN = 0, audPumping = false; // var: o painel lê antes desta linha rodar
function audMark(...keys) { keys.filter(Boolean).forEach(k => audDone.add(k)); db.meta.audioDone = [...audDone].slice(-4000); }
function audCfg() { try { waWv && waWv.send('wa-audio-cfg', { on: sttOn() }); } catch {} }
// textos dos áudios, para mostrar embaixo de cada balão na conversa (o WhatsApp recria as linhas; o leitor recoloca)
const audTx = new Map(db.meta.audTx || []), audBound = new Set();
function audKeep(keys, text) { for (const k of keys.filter(Boolean)) { audTx.delete(k); audTx.set(k, String(text).slice(0, 2500)); } while (audTx.size > 200) audTx.delete(audTx.keys().next().value); db.meta.audTx = [...audTx]; }
function audTell(o) { try { waWv && waWv.send('wa-audio-text', o); } catch {} }
function audTxSync() { try { waWv && waWv.send('wa-audio-texts', [...audTx].filter(([k]) => !/^[hf]:/.test(k))); } catch {} }
function audCards() { return db.chats.find(c => c.id === 'claude').messages.filter(m => m.card && m.card.type === 'aud'); }
function audUpdate(id, patch) { // atualiza os cartões que têm esse áudio
  if (!id) return;
  for (const m of audCards()) {
    const it = (m.card.items || []).find(x => x.id === id); if (!it) continue;
    if (patch) Object.assign(it, patch);
    const its = m.card.items;
    if (its.every(x => x.text)) m.card.status = 'feito';
    else if (m.card.status === 'transcrevendo' && its.every(x => x.text || x.erro)) m.card.status = 'erro';
  }
  save(); renderSide(); if (openChatId === 'claude') renderMsgs();
}
function audIgnored(chat) { const ign = (db.settings.waIgnore || '').toLowerCase().split(',').map(x => x.trim()).filter(Boolean); return ign.some(x => String(chat).toLowerCase().includes(x)); }
// o leitor viu áudios na conversa aberta: os novos (até 36 h, de outra pessoa) viram um cartão "transcrever?" por conversa
function audioSeen(a) {
  if (!sttOn() || !a || !a.chat || audIgnored(a.chat) || psiChat(a.chat)) return;
  const asked = new Set(db.meta.audioAsked || []), cutoff = Date.now() - 36 * 3600e3, self = selfLinked() && isSelf(a.chat);
  const fresh = (a.audios || []).filter(x => x.id && (!x.out || self) && !audDone.has(x.id) && !asked.has(x.id) && waTs(x.meta).d.getTime() >= cutoff && (!self || localISO(waTs(x.meta).d) >= (db.meta.selfSince || '')));
  if (!fresh.length) return;
  db.meta.audioAsked = [...asked, ...fresh.map(x => x.id)].slice(-3000);
  if (self) { // áudio que você mandou para você mesmo: vira texto sozinho (é a sua conversa, ninguém recebe "ouvido") e vai para a assistente
    save();
    if (!a.sweep) try { waWv.send('wa-audio-auto', fresh.map(x => x.id)); } catch {}
    else { audQueue.push({ chat: a.chat, ids: fresh.map(x => x.id), auto: true }); if (!waSweeping) audPump(); }
    return;
  }
  if (!a.sweep) { // conversa aberta na sua frente: o botão "🎤 Transcrever" já está embaixo de cada áudio; no modo sozinha, transcreve ali mesmo
    save(); if (db.settings.sttAuto) try { waWv.send('wa-audio-auto', fresh.map(x => x.id)); } catch {}
    return;
  }
  const items = fresh.map(x => { const t = waTs(x.meta); return { id: x.id, dur: x.dur || 0, who: t.who, when: localISO(t.d) }; });
  const st = db.settings.sttAuto ? 'transcrevendo' : 'pendente'; // modo sozinha: o cartão já nasce "transcrevendo" e mostra o texto quando sai
  const m = audCards().reverse().find(x => x.card.chat === a.chat && x.card.status === st);
  if (m) { m.card.items.push(...items); save(); renderSide(); if (openChatId === 'claude') renderMsgs(); }
  else pushMsg('claude', { from: 'them', card: { type: 'aud', id: uid(), chat: a.chat, items, status: st } });
  if (db.settings.sttAuto) { audQueue.push({ chat: a.chat, ids: items.map(x => x.id), auto: true }); if (!waSweeping) audPump(); }
}
// pede ao leitor para tocar (sem som) os áudios de uma conversa; o arquivo de cada um chega por 'wa-audio'
function audGet(job) {
  return new Promise(resolve => {
    const reqId = uid(); audWaiters[reqId] = resolve;
    setTimeout(() => { if (audWaiters[reqId]) { delete audWaiters[reqId]; resolve({ ok: false, erro: 'o WhatsApp não respondeu' }); } }, 30000 + job.ids.length * 16000);
    try { waWv.send('wa-audio-get', { reqId, chat: job.chat, ids: job.ids, auto: !!job.auto }); } catch (e) { delete audWaiters[reqId]; resolve({ ok: false, erro: e.message }); }
  });
}
async function audPump() {
  if (audPumping || !waWv) return; audPumping = true;
  try {
    while (audQueue.length) {
      const job = audQueue.shift(), r = await audGet(job);
      if (r.busy && job.auto) { audQueue.unshift(job); break; } // você está usando o WhatsApp: fica para a próxima leitura
      for (const id of r.miss || []) audUpdate(id, { erro: 'não achei o áudio na conversa' });
      if (!r.ok) for (const id of job.ids) audUpdate(id, { erro: r.erro || 'falhou' });
    }
  } finally { audPumping = false; }
}
async function onWaAudio(a) {
  if (!a || !a.buf || !sttOn()) { if (a && a.id) audTell({ id: a.id }); return; }
  const hk = 'h:' + a.hash, key = a.id || hk;
  const old = audTx.get(a.id) || audTx.get(hk) || (a.id && (audCards().flatMap(m => m.card.items).find(x => x.id === a.id && x.text) || {}).text);
  if ((audDone.has(hk) || (a.id && audDone.has(a.id))) && (old || !a.req)) { // já transcrito: só devolve o texto para aparecer embaixo do áudio
    if (a.id) { if (old) audKeep([a.id], old); audTell({ id: a.id, text: old || '' }); audUpdate(a.id, null); }
    return;
  }
  if (audBusy.has(key)) return;
  audBusy.add(key); audN++; renderSide();
  const t = a.meta ? waTs(a.meta) : { d: new Date(), who: '' };
  let r;
  try { r = await window.wv1desk.stt({ provider: db.settings.sttProvider || 'groq', key: sttKeyNow(), buf: a.buf, type: a.type, chat: a.chat, when: t.d.toISOString(), prompt: STT_PROMPT, ...((selfLinked() && isSelf(a.chat)) || psiChat(a.chat) ? { save: false } : {}) }); } // ditado para você mesmo e áudio da psicóloga não viram arquivo no Drive
  catch (e) { r = { error: e.message }; }
  audBusy.delete(key); audN--; renderSide();
  if (!r || r.error) { const erro = (r && r.error) || 'falhou'; audUpdate(a.id, { erro }); if (a.id) audTell({ id: a.id, erro }); else toast('🎤 Não transcrevi o áudio: ' + erro); return; }
  audMark(key, hk);
  const text = r.text || '(sem fala reconhecível)';
  audKeep([a.id, hk], text); if (a.id) audTell({ id: a.id, text });
  const meta = a.meta || `[${pad(t.d.getHours())}:${pad(t.d.getMinutes())}, ${pad(t.d.getDate())}/${pad(t.d.getMonth() + 1)}/${t.d.getFullYear()}] ${a.chat}: `;
  ingestWa([{ chat: a.chat, msgs: [{ id: 'a:' + key, meta, out: a.out, audio: true, text: `🎤 (áudio${a.dur ? ' ' + fmtDur(a.dur) : ''}) ${text}` }] }]);
  audUpdate(a.id, { text });
  if (waQueue.length && a.req) waSchedule(3000, true); // pedido por ele: triagem logo
  if (!a.req && !a.id) toast(`🎤 Áudio${a.chat ? ' de ' + a.chat : ''} virou texto`); // com id o texto já aparece embaixo do áudio
  save();
}
// arquivo de áudio baixado no WhatsApp (ogg, mp3, m4a…) também vira texto
async function audFile(d) {
  const key = 'f:' + d.downloads; if (audDone.has(key)) return;
  audN++; renderSide(); audTell({ recent: true, key, busy: true });
  let r; try { r = await window.wv1desk.stt({ provider: db.settings.sttProvider || 'groq', key: sttKeyNow(), file: d.downloads, save: false, prompt: STT_PROMPT }); } catch (e) { r = { error: e.message }; }
  audN--; renderSide();
  if (!r || r.error) { audTell({ recent: true, key, erro: (r && r.error) || 'falhou' }); return toast('🎤 Não transcrevi ' + d.name + ': ' + ((r && r.error) || 'falhou')); }
  audMark(key); audKeep([key], r.text || '(sem fala reconhecível)'); audTell({ recent: true, key, text: r.text || '(sem fala reconhecível)' });
  await new Promise(res => setTimeout(res, 2500)); // o texto foi para embaixo do áudio em que você clicou "Baixar"? então não repete no painel
  const bound = audBound.has(key);
  const now = new Date(), chat = d.chat || 'Áudios baixados', meta = `[${pad(now.getHours())}:${pad(now.getMinutes())}, ${pad(now.getDate())}/${pad(now.getMonth() + 1)}/${now.getFullYear()}] ${chat}: `;
  ingestWa([{ chat, msgs: [{ id: key, meta, audio: true, text: `🎤 (arquivo de áudio ${d.name}) ${r.text || '(sem fala)'}` }] }]);
  if (!bound) pushMsg('claude', { from: 'them', text: `🎤 ${d.name}${d.chat ? ' · ' + d.chat : ''}\n“${r.text || '(sem fala reconhecível)'}”` });
  save();
}

// ---------- resumo da semana: toda sexta às 17 h (ou quando ele pede), por obra, salvo no Drive ----------
const WEEK_RE = /^📊|resumo (da|desta|de) semana|relat[oó]rio (da|desta|de) semana|balan[cç]o (da|desta) semana/i;
var weekBusy = false;
function weekRange(ref) { const mon = new Date(ref); mon.setHours(0, 0, 0, 0); mon.setDate(mon.getDate() - ((mon.getDay() + 6) % 7)); const sun = new Date(mon); sun.setDate(sun.getDate() + 6); return { de: ymd(mon), ate: ymd(sun) }; }
function lastFriday17() { const d = new Date(); d.setHours(17, 0, 0, 0); d.setDate(d.getDate() - ((d.getDay() + 2) % 7)); return d; }
const brDay = s => { const d = parseLocal(s); return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}`; };
const shortRange = (a, b) => a && b ? `${brDay(a)} a ${brDay(b)}` : '';
function weekCard(id) { return db.chats.find(c => c.id === 'claude').messages.find(m => m.card && m.card.type === 'week' && m.card.id === id); }
function weekData(ref) {
  const now = new Date(), w = weekRange(ref), nxs = new Date(parseLocal(w.ate)); nxs.setDate(nxs.getDate() + 1); const nx = weekRange(nxs);
  const day = iso => iso ? localISO(new Date(iso)).slice(0, 10) : '', inW = d => d && d >= w.de && d <= w.ate;
  const evLine = e => `- ${e.start.slice(0, 10)} ${evHour(e)} ${e.title}${e.location ? ' @ ' + e.location : ''}`;
  const feitas = db.tasks.filter(t => t.done && inW(day(t.doneAt))).map(t => `- ${t.title} (feito ${brDay(day(t.doneAt))})`);
  const pend = db.tasks.filter(t => !t.done).map(t => { const q = t.remindAt || t.due, late = q && q < (q.length > 10 ? localISO(now) : ymd(now)); return `- ${t.title}${q ? ` (${late ? 'ATRASADA, ' : ''}prazo ${q.replace('T', ' ')})` : ''}`; });
  const evW = sortedEvents().filter(e => inW(e.start.slice(0, 10))).map(evLine);
  const evN = sortedEvents().filter(e => e.start.slice(0, 10) >= nx.de && e.start.slice(0, 10) <= nx.ate).map(evLine);
  const planos = db.plans.filter(p => p.status === 'feito' && inW(day(p.fim))).flatMap(p => p.passos.filter(x => x.tipo === 'whatsapp').map(x => `- ${brDay(day(p.fim))} para ${x.conversa}: "${String(x.mensagem).slice(0, 220)}"`));
  const log = db.waLog.filter(m => !m.prev && !isSelf(m.chat) && inW(m.when.slice(0, 10))), mine = [];
  log.forEach((m, i) => { if (m.who === 'Eu') mine.push(`- ${m.when.slice(5, 16).replace('T', ' ')} ${m.chat}: "${m.text.slice(0, 200)}"${log.slice(i + 1).some(x => x.chat === m.chat && x.who !== 'Eu') ? '' : ' [sem resposta depois]'}`); });
  const sug = db.inbox.map(x => `- ${x.titulo}${x.conversa ? ' (' + x.conversa + ')' : ''}`);
  return { w, nx, feitas, pend, evW, evN, planos, mine: mine.slice(-80), sug };
}
function weekMd(r, w) {
  const L = [`# Resumo da semana — ${shortRange(w.de, w.ate)}/${w.de.slice(0, 4)}`, `Gerado em ${new Date().toLocaleString('pt-BR', { weekday: 'long', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}`, ''];
  const list = (t, a) => { if (a && a.length) { L.push(`**${t}**`); a.forEach(x => L.push('- ' + x)); L.push(''); } };
  if ((r.atencao || []).length) { L.push('## ⚠️ Atenção'); r.atencao.forEach(x => L.push('- ' + x)); L.push(''); }
  for (const o of r.obras || []) {
    L.push('## ' + (o.nome || 'Geral'));
    list('✅ Feito', o.feito); list('⏳ Pendente', o.pendente);
    list('📨 Esperando terceiros', (o.esperando || []).map(e => typeof e === 'string' ? e : [e.o_que, e.quem && '— ' + e.quem, e.desde && '(desde ' + e.desde + ')'].filter(Boolean).join(' ')));
    if (!(o.feito || []).length && !(o.pendente || []).length && !(o.esperando || []).length) L.push('- sem movimento registrado', '');
  }
  if ((r.proxima_semana || []).length) { L.push('## 📅 Próxima semana'); r.proxima_semana.forEach(x => L.push('- ' + x)); L.push(''); }
  return L.join('\n').trim() + '\n';
}
function mdHtml(md) { // markdown simples do resumo → HTML
  return String(md).split('\n').map(l => { const e = esc(l).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>'); return l.startsWith('# ') ? `<h2>${e.slice(2)}</h2>` : l.startsWith('## ') ? `<h3>${e.slice(3)}</h3>` : l.startsWith('- ') ? `<div class="li">• ${e.slice(2)}</div>` : l.trim() ? `<div>${e}</div>` : ''; }).join('');
}
async function weeklyReport({ ref, auto, manual, self }) {
  if (weekBusy) return { error: 'o resumo já está sendo montado' };
  weekBusy = true; renderSide();
  const typing = manual ? pushMsg('claude', { from: 'them', text: 'montando o resumo da semana…', pending: true }) : null;
  try {
    const D = weekData(ref || new Date()), w = D.w;
    let sums = ''; try { if (DESK && window.wv1desk.summaryRecent) sums = await window.wv1desk.summaryRecent({ dias: 8, max: 14000 }) || ''; } catch {}
    let r;
    if (!db.settings.apiKey && !oaOn()) r = { obras: [{ nome: 'Geral', feito: D.feitas.map(x => x.slice(2)), pendente: D.pend.map(x => x.slice(2)), esperando: D.mine.filter(x => x.includes('[sem resposta depois]')).map(x => x.slice(2).replace(' [sem resposta depois]', '')) }], proxima_semana: D.evN.map(x => x.slice(2)), atencao: [] };
    else {
      const sec = (t, a) => `${t}:\n${(Array.isArray(a) ? a.join('\n') : a) || '(nada)'}`;
      const dados = [sec('Atividades concluídas na semana', D.feitas), sec('Atividades pendentes (todas)', D.pend), sec('Sugestões do WhatsApp ainda sem resposta dele', D.sug), sec('Compromissos desta semana', D.evW), sec('Compromissos da próxima semana', D.evN), sec('Mensagens que o app enviou por ele (planos aprovados)', D.planos), sec('Mensagens dele no WhatsApp nesta semana ([sem resposta depois] = ninguém escreveu na conversa depois)', D.mine), sec('Resumos diários do WhatsApp (escritos por você; use só os desta semana)', sums)].join('\n\n');
      r = await aiJson({ max: 10000, effort: 'medium',
          system: `Você é a secretária executiva de ${db.settings.myName || 'o usuário'}. Perfil dele: ${db.settings.profile || '(não informado)'}
Memória (pessoas, obras, clientes):\n${db.facts.slice(-60).map(f => '- ' + f).join('\n') || '(nada ainda)'}
Monte o resumo da semana de ${w.de} a ${w.ate} usando SÓ os dados que ele mandar. Agrupe por obra, contrato ou cliente (use os nomes da memória e das conversas, ex.: "Obra Araquari (Trojan)"); o que não for de uma obra vai em "Geral" e o que for pessoal em "Pessoal". Para cada grupo:
- feito: o que foi concluído ou entregue na semana (atividades marcadas como feitas, entregas confirmadas nas conversas e nos resumos);
- pendente: o que ainda depende DELE (atividades abertas, pedidos e perguntas a ele sem resposta), com prazo quando houver, e "ATRASADA" se passou;
- esperando: o que ele pediu ou cobrou de outra pessoa e ainda não veio (mensagens dele com pedido e sem resposta depois, mensagens enviadas pelos planos), com quem e desde quando.
Frases curtas e concretas, com número, documento e prazo quando houver. Não invente nem estime: sem dado, deixe de fora. Não repita o mesmo item em dois grupos. Em "atencao", no máximo 4 riscos reais (prazo vencendo, contrato, órgão público cobrando, dinheiro, conflito de agenda). Em "proxima_semana", os compromissos e prazos de ${D.nx.de} a ${D.nx.ate}. Responda só com o JSON pedido; campo sem informação vai como texto vazio.`,
          user: dados, schema: { type: 'object', properties: {
            obras: { type: 'array', items: { type: 'object', properties: { nome: { type: 'string' }, feito: { type: 'array', items: { type: 'string' } }, pendente: { type: 'array', items: { type: 'string' } },
              esperando: { type: 'array', items: { type: 'object', properties: { o_que: { type: 'string' }, quem: { type: 'string' }, desde: { type: 'string', description: 'DD/MM' } } } } } } },
            proxima_semana: { type: 'array', items: { type: 'string' } }, atencao: { type: 'array', items: { type: 'string' } } } } });
    }
    const md = weekMd(r, w);
    let file = '';
    if (DESK && window.wv1desk.docWrite) { const o = await window.wv1desk.docWrite({ dir: 'Resumos semanais', name: `Semana ${w.de} a ${w.ate}`, text: md }); if (o && o.file) file = o.file; }
    const cnt = k => (r.obras || []).reduce((n, o) => n + (o[k] || []).length, 0);
    if (typing) { const c = db.chats.find(x => x.id === 'claude'); c.messages = c.messages.filter(x => x.id !== typing.id); }
    const wid = uid();
    pushMsg('claude', { from: 'them', card: { type: 'week', id: wid, de: w.de, ate: w.ate, file, md, obras: (r.obras || []).map(o => o.nome), atencao: (r.atencao || [])[0] || '', counts: { feito: cnt('feito'), pendente: cnt('pendente'), esperando: cnt('esperando') } } });
    selfSend(waFmt(md), self ? 'reply' : 'aviso');
    brainAdd({ kind: 'week', icon: '📊', cardId: wid, text: `Resumo da semana pronto (${shortRange(w.de, w.ate)}): ${cnt('pendente')} pendente(s), ${cnt('esperando')} esperando terceiros.`, sub: (r.obras || []).map(o => o.nome).join(' · '), quiet: true });
    if (auto) notify('📊 Resumo da semana pronto', `${(r.obras || []).length} obra(s) · ${cnt('pendente')} pendente(s) · ${cnt('esperando')} esperando terceiros`);
    return { ok: true, file, obras: (r.obras || []).map(o => o.nome) };
  } catch (e) {
    if (typing) { const c = db.chats.find(x => x.id === 'claude'); c.messages = c.messages.filter(x => x.id !== typing.id); }
    pushMsg('claude', { from: 'them', text: '⚠️ Não consegui montar o resumo da semana: ' + e.message + '. Peça de novo com "📊 Resumo da semana".' });
    return { error: e.message };
  } finally { weekBusy = false; save(); renderSide(); }
}

// ---------- 🧠 Cérebro: lê tudo o que chega, vai narrando no meio do painel e diz o que importa agora ----------
// feed = o que ele foi contando (o mais novo em cima); pulse = "Agora": prioridades cruzando conversas, agenda e atividades
var brainBusy = false, brainTimer = null, brainErr = ''; // var: o painel lê antes desta linha rodar
var URG = { alta: '🔴', media: '🟠', baixa: '⚪' };
function sideView() { return db.meta.sideView === 'chat' ? 'chat' : 'brain'; }
function setSideView(v) {
  db.meta.sideView = v === 'chat' ? 'chat' : 'brain'; save();
  if (v === 'chat') { const c = db.chats.find(x => x.id === 'claude'); if (c.unread) { c.unread = 0; save(); } }
  renderSide();
  if (v === 'chat') { const b = $('#sideMsgs'); if (b) b.scrollTop = b.scrollHeight; }
}
function renderSideTabs() {
  const t = $('#sideTabs'); if (!t) return;
  const sb = $('#selfBar'); if (sb) sb.innerHTML = !selfLinked() ? '' : selfName() ? `<span>📲 Ligada à sua conversa <b>${esc(selfName())}</b> no WhatsApp: o que você mandar lá chega aqui, e eu respondo lá.</span><button data-act="self-open">Abrir</button>`
    : '<span>📲 Ainda não achei a sua conversa com você mesmo no WhatsApp. Mande qualquer mensagem para você mesmo lá, ou escreva o nome dela em Configurações.</span>';
  const v = sideView(), n = db.chats.find(x => x.id === 'claude').unread || 0;
  $('#cal').classList.toggle('vchat', v === 'chat');
  t.innerHTML = `<button data-act="side-view" data-id="brain" class="${v === 'brain' ? 'on' : ''}">🧠 Cérebro${brainBusy ? ' <span class="think">pensando…</span>' : ''}</button>`
    + `<button data-act="side-view" data-id="chat" class="${v === 'chat' ? 'on' : ''}">💬 Conversa${n && v !== 'chat' ? ` <i>${n}</i>` : ''}</button>`
    + (DESK ? `<button class="vt" data-act="self-open" title="Abrir a sua conversa ${esc(selfName() || 'com você mesmo')} no WhatsApp">📲</button>` : '')
    + `<button class="vt" data-act="brain-voice" title="${db.brain.voice ? 'Falando sozinho quando chega coisa importante (clique para calar)' : 'Clique para eu falar em voz alta quando chegar coisa importante'}">${db.brain.voice ? '🔊' : '🔇'}</button>`;
}
function brainAdd(e) {
  const B = db.brain, x = { id: uid(), ts: new Date().toISOString(), prio: 'media', ...e };
  if (x.key) B.feed = B.feed.filter(f => f.key !== x.key); // um por assunto: o aviso novo da mesma atividade substitui o anterior
  B.feed.unshift(x); if (B.feed.length > 150) B.feed.length = 150;
  save(); renderBrain();
  if (B.voice && x.prio === 'alta' && !x.quiet) speak(x.say || x.text);
  return x;
}
function brainFind(pred) { return db.brain.feed.find(pred); }
function brainResolve(sugId, st, ref) { const f = brainFind(x => x.sugId === sugId); if (!f) return false; f.st = st; if (ref) Object.assign(f, ref); save(); renderBrain(); return true; }
function feedTime(iso) { const d = new Date(iso); return ymd(d) === ymd(new Date()) ? `${pad(d.getHours())}:${pad(d.getMinutes())}` : `${pad(d.getDate())}/${pad(d.getMonth() + 1)}`; }
function sugFala(it) { // frase de narrador quando a leitura não mandou uma
  const fim = { compromisso: 'tem isso para agendar', lembrete: 'vale um lembrete', responder: 'está esperando sua resposta' }[it.tipo] || 'fica com você';
  return `${it.pessoa || it.conversa || 'Alguém'}: ${it.titulo.replace(/^Responder [^:]*:\s*/i, '')} — ${fim}.`;
}
function feedLive(f) { // ainda pede algo dele?
  if (f.kind === 'sug') return db.inbox.some(x => x.id === f.sugId);
  if (f.kind === 'done?') { const t = db.tasks.find(x => x.id === f.taskId); return !!(t && !t.done && t.askDone); }
  if (f.kind === 'rem') { if (f.eventId) return db.events.some(e => e.id === f.eventId); const t = db.tasks.find(x => x.id === f.taskId); return !!(t && !t.done); }
  if (f.kind === 'plan') { const p = db.plans.find(x => x.id === f.planId); return !!(p && p.status === 'aguardando_ok'); }
  return f.st !== 'off';
}
function feedSub(f) {
  if (f.kind === 'sug' && !feedLive(f)) return f.st === 'ok' ? (f.eventId ? '✓ virou compromisso' : f.taskId ? '✓ virou atividade' : '✓ resposta preparada na Conversa') : 'dispensado';
  if (f.kind === 'done?' && !feedLive(f)) { const t = db.tasks.find(x => x.id === f.taskId); return t && t.done ? '✓ feito, saiu da lista' : 'ficou na lista'; }
  if (f.kind === 'rem' && f.taskId && !feedLive(f)) return '✓ feito';
  if (f.kind === 'plan') { const p = db.plans.find(x => x.id === f.planId); if (!p) return ''; return p.status === 'aguardando_ok' ? p.passos.map(st => (STEP_ICON[st.tipo] || '•') + ' ' + stepText(st)).join('\n') : '✓ ' + (PLAN_STATUS[p.status] || p.status); }
  return f.sub || '';
}
function feedActs(f) {
  const b = (act, label, cls) => `<button ${cls ? `class="${cls}"` : ''} data-act="${act}" data-id="${f.id}">${label}</button>`;
  const open = f.chat && DESK ? b('brain-open', '💬 Abrir') : '';
  if (!feedLive(f)) return f.kind === 'sug' ? (f.eventId ? `<button data-event="${f.eventId}">📅 Ver</button>` : f.taskId ? `<button data-task="${f.taskId}">✅ Ver</button>` : '') : f.kind === 'info' || f.kind === 'pulse' ? open : '';
  if (f.kind === 'sug') {
    const it = db.inbox.find(x => x.id === f.sugId), agendar = it.tipo === 'compromisso' && it.quando.length > 10;
    const main = it.tipo === 'responder' ? b('brain-reply', '✍️ Responder', 'ok') + b('brain-acc', '✅ Virar tarefa') : b('brain-acc', agendar ? '📅 Agendar' : it.tipo === 'lembrete' ? '🔔 Lembrar' : '✅ Virar tarefa', 'ok') + (it.pessoa && db.settings.apiKey ? b('brain-reply', '✍️ Responder') : '');
    return main + open + b('brain-no', '✕', 'x');
  }
  if (f.kind === 'done?') return `<button class="ok" data-act="done-yes" data-id="${f.taskId}">✅ Sim, foi feito</button><button data-act="done-no" data-id="${f.taskId}">Ainda não</button>`;
  if (f.kind === 'rem') return f.eventId ? `<button data-event="${f.eventId}">📅 Abrir</button>` : `<button class="ok" data-toggle="${f.taskId}">✅ Feito</button>` + b('brain-snooze', '⏰ +1 h') + `<button data-act="task-plan" data-id="${f.taskId}">⚡ Resolver</button>`;
  if (f.kind === 'plan') return `<button class="ok" data-act="plan-ok" data-id="${f.planId}">✅ Ok, pode fazer</button><button data-act="plan-cancel" data-id="${f.planId}">Cancelar</button>`;
  if (f.kind === 'week') return f.cardId ? `<button data-act="week-view" data-id="${f.cardId}">Ver resumo</button>` : '';
  if (f.kind === 'self') return '<button data-act="side-view" data-id="chat">💬 Ver na Conversa</button>';
  return open;
}
function feedHtml(f) {
  const live = feedLive(f), sub = feedSub(f), acts = feedActs(f) + (selfReady() && f.kind !== 'self' && f.text ? `<button class="x" data-act="self-send" data-id="${f.id}" title="Mandar para a sua conversa no WhatsApp">📲</button>` : ''), lines = String(f.text || '').split('\n'), long = f.kind === 'brief' && lines.length > 7;
  const txt = long && !f.open ? lines.slice(0, 6).join('\n') + '\n…' : f.text;
  const dim = !live && ['sug', 'done?', 'rem', 'plan'].includes(f.kind);
  return `<div class="fe k-${f.kind}${f.prio === 'alta' && !dim ? ' alta' : ''}${dim ? ' off' : ''}${Date.now() - new Date(f.ts) < 8000 ? ' fresh' : ''}"><div class="tm">${feedTime(f.ts)}</div><div class="fb">`
    + (f.head ? `<div class="fh">${esc(f.head)}</div>` : '')
    + `<div class="tx">${f.icon ? f.icon + ' ' : ''}${esc(txt)}</div>` + (long ? `<button class="more2" data-act="brain-more" data-id="${f.id}">${f.open ? 'mostrar menos' : 'ver tudo'}</button>` : '')
    + (sub ? `<div class="sb">${esc(sub)}</div>` : '') + (acts ? `<div class="fa">${acts}</div>` : '') + '</div></div>';
}
function prActs(x) {
  const b = (act, label, cls) => `<button ${cls ? `class="${cls}"` : ''} data-act="${act}" data-id="${esc(x.chave)}">${label}</button>`;
  const main = { responder: b('pr-plan', '✍️ Preparar resposta', 'ok'), cobrar: b('pr-plan', '✍️ Preparar cobrança', 'ok'), agendar: b('pr-plan', '📅 Agendar', 'ok'), tarefa: b('pr-task', '✅ Virar tarefa', 'ok'),
    concluir: x.atividade_id && db.tasks.some(t => t.id === x.atividade_id) ? `<button class="ok" data-toggle="${esc(x.atividade_id)}">✅ Foi feito?</button>` : '' }[x.acao] || '';
  return main + (x.conversa && DESK ? b('pr-open', '💬 Abrir') : '') + b('pr-off', '✕', 'x');
}
function brainPrios() {
  const p = db.brain.pulse, off = db.brain.off, now = Date.now();
  return ((p && p.prioridades) || []).filter(x => !(off[x.chave] > now - 864e5) && !(x.atividade_id && (db.tasks.find(t => t.id === x.atividade_id) || {}).done));
}
function pulseHtml() {
  const p = db.brain.pulse, keyless = !db.settings.apiKey && !oaOn();
  const st = brainBusy ? '<span class="think">pensando…</span>' : brainErr ? '⚠️ ' + esc(brainErr) : p && p.ts ? 'atualizado ' + feedTime(p.ts) + (p.via === 'openai' ? ' · pela OpenAI (reserva)' : p.via === 'basico' ? ' · modo básico' : '') : '';
  const head = `<div class="bh"><b>Agora</b><span class="bs">${st}</span><span class="bb">${p && selfReady() ? '<button data-act="brain-self" title="Mandar para a sua conversa no WhatsApp">📲</button>' : ''}<button data-act="brain-say" title="Ouvir em voz alta">🗣️</button><button data-act="brain-think" title="Pensar de novo agora">↻</button></span></div>`;
  if (!p) return `<div class="bnow">${head}<div class="man mu">${keyless ? 'Sem a chave do Claude eu só organizo o básico (Configurações).' : 'Estou juntando o que chegou; já te conto o que importa.'}</div></div>`;
  const pr = brainPrios();
  return `<div class="bnow">${head}<div class="man">${esc(p.manchete || '')}</div>`
    + pr.map(x => `<div class="pr"><span class="n">${URG[x.urgencia] || '•'}</span><div class="pb"><div class="pt2">${esc(x.titulo)}</div>${x.porque ? `<div class="why">${esc(x.porque)}</div>` : ''}<div class="fa">${prActs(x)}</div></div></div>`).join('')
    + ((p.conexoes || []).length ? `<div class="bcx">${p.conexoes.slice(0, 3).map(c => '🔗 ' + esc(c)).join('<br>')}</div>` : '') + '</div>';
}
function renderBrain() {
  renderSideTabs();
  const box = $('#brain'); if (!box || sideView() !== 'brain') return;
  const feed = db.brain.feed.slice(0, 80);
  box.innerHTML = pulseHtml() + (feed.length ? `<div class="bfeed">${feed.map(feedHtml).join('')}</div>`
    : `<div class="bempty">Assim que chegar coisa nova no WhatsApp eu conto aqui, com o mais novo em cima.</div>`);
}
// o que mudou desde a última vez que pensei (só repenso sozinho quando muda)
function brainSig() { return [db.waLog.length, db.inbox.length, db.tasks.filter(t => !t.done).length, db.events.length, db.plans.filter(p => p.status === 'aguardando_ok').length].join('|'); }
function brainSec(t, a) { return `## ${t}\n${(Array.isArray(a) ? a.join('\n') : a) || '(nada)'}`; }
function brainInput() {
  const now = new Date(), nowIso = localISO(now), today = ymd(now), lim = localISO(new Date(Date.now() + 36 * 3600e3));
  const evs = sortedEvents().filter(e => (e.allDay ? e.start.slice(0, 10) >= today : (e.end || e.start) >= nowIso) && e.start <= lim).slice(0, 12)
    .map(e => `- [${e.id}] ${e.allDay ? e.start.slice(0, 10) + ' (dia todo)' : e.start} ${e.title}${e.location ? ' @ ' + e.location : ''}`);
  const late = t => (t.remindAt && t.remindAt < nowIso) || (!t.remindAt && t.due && t.due < today);
  const tasks = db.tasks.filter(t => !t.done).sort((a, b) => (a.remindAt || a.due || '9').localeCompare(b.remindAt || b.due || '9')).slice(0, 30).map(t => {
    const src = t.chatId && t.chatId !== 'claude' && db.chats.find(c => c.id === t.chatId);
    return `- [${t.id}] ${t.title}${t.remindAt ? ' · lembrete ' + t.remindAt : t.due ? ' · prazo ' + t.due : ''}${late(t) ? ' · ATRASADA' : ''}${src ? ' · ' + src.name : ''}`;
  });
  const sug = db.inbox.slice(0, 15).map(x => `- ${x.titulo}${x.quando ? ' (' + x.quando + ')' : ''} · ${[x.pessoa, x.conversa].filter(Boolean).join(' · ')} · prioridade ${x.prioridade}${x.trecho ? ' · “' + x.trecho.slice(0, 140) + '”' : ''}`);
  const since = localISO(new Date(Date.now() - 12 * 3600e3)), wk = localISO(new Date(Date.now() - 7 * 864e5)), byChat = {}, week = {};
  for (const m of db.waLog) { if (m.prev || isSelf(m.chat)) continue; if (m.when >= since) (byChat[m.chat] = byChat[m.chat] || []).push(m); if (m.when >= wk) (week[m.chat] = week[m.chat] || []).push(m); }
  const wa = Object.entries(byChat).sort((a, b) => b[1][b[1].length - 1].when.localeCompare(a[1][a[1].length - 1].when)).slice(0, 18).map(([chat, ms]) => {
    const k = ms.map(m => m.who !== 'Eu').lastIndexOf(true), answered = k >= 0 && ms.slice(k + 1).some(m => m.who === 'Eu');
    return `### ${chat}\n` + ms.slice(-10).map(m => `- ${m.when.slice(11, 16)} ${m.who}: ${m.text.slice(0, 260)}${m === ms[k] && !answered ? ' [sem resposta sua]' : ''}`).join('\n');
  }).join('\n');
  const waiting = Object.entries(week).map(([chat, ms]) => ms[ms.length - 1]).filter(m => m.who === 'Eu' && /\?|manda|envia|aguardo|confirma|preciso|pode|consegue/i.test(m.text))
    .slice(0, 10).map(m => `- ${m.when.slice(8, 10)}/${m.when.slice(5, 7)} ${m.when.slice(11, 16)} ${m.chat}: ${m.text.slice(0, 160)}`);
  const P = db.brain.pulse, prev = P ? `manchete: ${P.manchete}\n` + (P.prioridades || []).map(x => `- ${x.chave}: ${x.titulo}`).join('\n') : '(primeira vez)';
  const off = Object.entries(db.brain.off).filter(([, t]) => t > Date.now() - 864e5).map(([k]) => k);
  return [`Agora: ${nowIso} (${now.toLocaleDateString('pt-BR', { weekday: 'long' })}).`, brainSec('Agenda (próximas 36 h)', evs), brainSec('Atividades pendentes', tasks),
    brainSec('Coisas novas do WhatsApp esperando o Sim dele', sug), brainSec('WhatsApp nas últimas 12 h, por conversa ("Eu" = ele)', wa), brainSec('Ele pediu algo e ninguém respondeu ainda (7 dias)', waiting),
    brainSec('Memória (pessoas, obras, clientes)', db.facts.slice(-40).map(f => '- ' + f)), brainSec('Resumos recentes do WhatsApp (escritos por você)', (recentSums || '').slice(-2500)),
    brainSec('O que você disse da última vez', prev), brainSec('Dispensados por ele (não traga de volta hoje)', off)].join('\n\n');
}
function brainSystem() {
  return `Você é o cérebro da assistente pessoal de ${db.settings.myName || 'o usuário'}, dentro do app de WhatsApp dele. Perfil dele: ${db.settings.profile || '(não informado)'}
Você recebe o que chegou no WhatsApp dele nas últimas horas, a agenda, as atividades e o que você disse da última vez. Diga, como uma secretária executiva muito boa que conhece as obras, os contratos e as pessoas, o que importa AGORA.
- manchete: 1 ou 2 frases para ele ouvir, começando pelo mais importante, com nome, hora e assunto (ex.: "Tiago, o Alex espera sua resposta sobre o financeiro desde 14:53; às 17:30 tem a reunião com o Tiago."). Sem cumprimento e sem emoji. Se não há nada importante, diga isso em uma frase.
- prioridades: no máximo 5, em ordem de importância. Entram: pergunta ou pedido a ele sem resposta (cliente, órgão público e prazo primeiro; quanto mais antigo, mais alto), atividade atrasada ou vencendo, compromisso nas próximas horas e o que ele precisa levar ou preparar, conflito de horário, dinheiro, e o que outra pessoa ficou de mandar e não mandou. "porque" é UMA frase que liga os fatos: quem, desde quando, de qual conversa veio e o que depende disso. "acao": responder (ele precisa responder alguém), cobrar (cobrar alguém), agendar (marcar algo com data), tarefa (vira atividade), concluir (parece feita; atividade_id obrigatório), ver (só olhar). "conversa": o nome exatamente como nos títulos "###" (ou vazio). "atividade_id": o id exatamente como na lista (ou vazio). "chave": identificador curto e estável do assunto (ex.: "alex-financeiro"); repita a chave da última vez quando for o mesmo assunto.
- conexoes: até 3 cruzamentos que ele não veria sozinho: mesmo assunto em conversas diferentes, conflito de agenda, alguém esperando outra pessoa, documento pedido num lugar e recebido em outro, prazo de uma obra afetando outra. Só com dado real; sem isso, lista vazia.
Use só os dados enviados: não invente nome, valor, data ou documento. O que ele dispensou não volta hoje. Nunca diga que mandou ou fez algo: as ações só preparam, e ele aprova.`;
}
var BRAIN_SCHEMA = { type: 'object', properties: {
  manchete: { type: 'string', description: '1 ou 2 frases faladas, começando pelo mais importante' },
  prioridades: { type: 'array', description: 'no máximo 5, em ordem', items: { type: 'object', properties: {
    chave: { type: 'string' }, titulo: { type: 'string', description: 'ação curta' }, porque: { type: 'string', description: 'uma frase que liga os fatos' },
    conversa: { type: 'string' }, atividade_id: { type: 'string' },
    acao: { type: 'string', enum: ['responder', 'cobrar', 'agendar', 'tarefa', 'concluir', 'ver'] }, urgencia: { type: 'string', enum: ['alta', 'media', 'baixa'] } } } },
  conexoes: { type: 'array', items: { type: 'string' } } } };
function brainBasic() { // sem chave da IA: o básico, contado pelo próprio app
  const nowIso = localISO(new Date()), today = ymd(new Date()), soon = localISO(new Date(Date.now() + 3 * 3600e3));
  const late = db.tasks.filter(t => !t.done && ((t.remindAt && t.remindAt < nowIso) || (!t.remindAt && t.due && t.due < today)));
  const evs = sortedEvents().filter(e => !e.allDay && e.start >= nowIso && e.start <= soon);
  const pr = [...db.inbox.filter(x => x.prioridade === 'alta').slice(0, 2).map(x => ({ chave: 's-' + x.id, titulo: x.titulo, porque: [x.pessoa, x.conversa].filter(Boolean).join(' · '), conversa: x.conversa, atividade_id: '', acao: 'ver', urgencia: 'alta' })),
    ...evs.slice(0, 2).map(e => ({ chave: 'e-' + e.id, titulo: e.title, porque: 'Às ' + fmtHour(e.start) + (e.location ? ' · ' + e.location : ''), conversa: '', atividade_id: '', acao: 'ver', urgencia: 'alta' })),
    ...late.slice(0, 3).map(t => ({ chave: 't-' + t.id, titulo: t.title, porque: 'Atrasada', conversa: '', atividade_id: t.id, acao: 'concluir', urgencia: 'media' }))];
  const parts = [late.length ? `${late.length} atividade(s) atrasada(s)` : '', evs.length ? `compromisso às ${fmtHour(evs[0].start)}` : '', db.inbox.length ? `${db.inbox.length} coisa(s) nova(s) do WhatsApp esperando seu Sim` : ''].filter(Boolean);
  return { manchete: parts.length ? 'Agora: ' + parts.join('; ') + '.' : 'Nada urgente agora.', prioridades: pr.slice(0, 5), conexoes: [], ts: new Date().toISOString(), via: 'basico' };
}
function brainSoon(ms) { clearTimeout(brainTimer); brainTimer = setTimeout(() => brainThink(), ms == null ? 20000 : ms); }
async function brainThink(force) {
  if (brainBusy) return;
  const B = db.brain, since = Date.now() - (B.at || 0);
  if (!force && since < 4 * 60e3) { brainSoon(4 * 60e3 - since + 500); return; }
  clearTimeout(brainTimer);
  if (!db.settings.apiKey && !oaOn()) { B.pulse = brainBasic(); B.at = Date.now(); B.sig = brainSig(); save(); renderBrain(); return; }
  brainBusy = true; brainErr = ''; renderBrain(); renderSide();
  try {
    const out = await aiJson({ system: brainSystem(), user: brainInput(), schema: BRAIN_SCHEMA, max: 8000, effort: 'medium' });
    const old = new Set(((B.pulse || {}).prioridades || []).map(p => p.chave)), first = !B.pulse;
    out.prioridades = (out.prioridades || []).filter(p => p && p.titulo && !(B.off[p.chave] > Date.now() - 864e5)).slice(0, 5);
    out.conexoes = (out.conexoes || []).filter(Boolean).slice(0, 3);
    B.pulse = { ...out, ts: new Date().toISOString(), via: aiJson.last };
    const novas = out.prioridades.filter(p => p.urgencia === 'alta' && !old.has(p.chave));
    if (novas.length && !first) { // mudou algo importante: fala sozinho
      brainAdd({ kind: 'pulse', icon: '🧠', text: out.manchete, chat: novas[0].conversa || '', prio: 'alta', quiet: true });
      notify('🧠 ' + novas[0].titulo, novas[0].porque || out.manchete);
      if (B.voice) speak(out.manchete);
      selfSend('🧠 ' + out.manchete, 'urgente');
    }
  } catch (e) { brainErr = String(e.message || e).slice(0, 90); console.warn('cérebro:', brainErr); }
  finally { B.at = Date.now(); B.sig = brainSig(); brainBusy = false; save(); renderBrain(); renderSide(); }
}
async function brainPlan(x) { // ✍️: a assistente lê a conversa e monta o plano; nada sai sem o ok dele
  if (!db.settings.apiKey) { toast('Para eu preparar a mensagem, configure a chave do Claude em Configurações'); return; }
  const verbo = { cobrar: 'Prepare a cobrança', agendar: 'Agende', responder: 'Prepare a resposta' }[x.acao] || 'Resolva';
  if (x.chave) { db.brain.off[x.chave] = Date.now(); save(); }
  setSideView('chat');
  pushMsg('claude', { from: 'me', text: `✍️ ${verbo}: ${x.titulo}.${x.porque ? ' ' + x.porque : ''}${x.conversa ? ` (conversa "${x.conversa}")` : ''}${x.atividade_id ? ` [atividade ${x.atividade_id}]` : ''} Leia a conversa antes e monte para eu aprovar.` });
  await askClaude('');
}
function waOpen(chat) { // abre a conversa no WhatsApp ao lado
  if (!DESK || !waWv || !chat) return;
  tab = 'wa'; db.meta.view = 'wa'; save(); render();
  try { waWv.send('wa-open', { chat }); } catch {}
}

// ---------- 📲 sua conversa com você mesmo no WhatsApp ("Tiago (você)") ligada à Conversa da assistente ----------
// O que você manda lá (texto ou áudio, do celular) chega na Conversa como pedido seu: ela age e responde lá, com 🤖 na frente.
// Do app para lá: as respostas, o briefing, os lembretes na hora e o resumo da semana. É o seu número: não vai para mais ninguém.
var selfQ = [], selfTimer = null, selfBusy = false, selfOut = [], selfPumping = false; // var: o painel lê antes desta linha rodar
var OK_RE = /^(ok|okay|pode|pode sim|manda|vai|faz|confirmo|aprovado|pode mandar|pode fazer|ok pode)\s*[.!]*$/i;
if (!db.meta.selfSince) db.meta.selfSince = localISO(new Date()); // o que já estava lá antes de ligar é histórico, não pedido
function selfLinked() { return DESK && db.settings.selfLink !== false && db.settings.waRead !== false; }
function selfName() { return (db.settings.selfName || '').trim() || db.meta.selfAuto || ''; }
function selfReady() { return selfLinked() && !!selfName(); } // já sei qual é a conversa (achei na lista ou você escreveu o nome)
function isSelf(chat) { const n = selfName().toLowerCase(); chat = String(chat || '').trim(); return !!chat && (/\((voc[eê]|you)\)$/i.test(chat) || (!!n && chat.toLowerCase() === n)); }
function selfKey(s) { return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ''); }
function selfCfg() { try { waWv && waWv.send('wa-self-cfg', { on: selfLinked(), name: selfName() }); } catch {} }
function waFmt(t) { // markdown do app → formatação do WhatsApp
  return String(t || '').split('\n').map(l => /^#{1,3} /.test(l) ? '*' + l.replace(/^#+ /, '').trim() + '*' : l.startsWith('- ') ? '• ' + l.slice(2) : l).join('\n').replace(/\*\*(.+?)\*\*/g, '*$1*').replace(/\n{3,}/g, '\n\n').trim();
}
function selfIngest(b) {
  const since = db.meta.selfSince || '', wk = localISO(new Date(Date.now() - 7 * 864e5)), sent = new Set(db.meta.selfSent || []), lines = [];
  for (const m of b.msgs || []) {
    if (waSeen.has(m.id)) continue; waSeen.add(m.id);
    const text = String(m.text || '').trim();
    if (!text || m.id.startsWith('p:') || /^\s*🤖/u.test(text) || sent.has(selfKey(text))) continue; // a prévia não serve; 🤖 é o que o app mandou lá
    const when = localISO(waTs(m.meta).d);
    if (PSI_RE.test(text)) { if (when >= since && when >= wk) psiFromSelf(text.replace(PSI_RE, ''), when, !!m.audio); continue; } // "psi …": só o espaço pessoal, fora da busca e do Drive
    const rec = { chat: b.chat, who: 'Eu', when, text: text.slice(0, 3000) };
    db.waLog.push(rec); lines.push(rec); // fica na busca ("o que eu anotei sobre…")
    if (when >= since && when >= wk) selfQ.push(rec);
  }
  if (lines.length && db.settings.driveLog !== false && window.wv1desk && window.wv1desk.logAppend) window.wv1desk.logAppend({ chat: b.chat, lines }).catch(() => {});
  if (selfQ.length) { clearTimeout(selfTimer); selfTimer = setTimeout(selfFlush, 4000); }
}
async function selfFlush() {
  if (selfBusy || reading) { clearTimeout(selfTimer); selfTimer = setTimeout(selfFlush, 3000); return; }
  const batch = selfQ.splice(0, 15); if (!batch.length) return;
  selfBusy = true;
  try {
    const stamp = batch.length > 1 || Date.now() - parseLocal(batch[0].when).getTime() > 10 * 60e3; // mandada com o app fechado: a hora vai junto
    const raw = batch.map(m => m.text).join('\n'), shown = batch.map(m => (stamp ? `(${shortDay(m.when)} ${fmtHour(m.when)}) ` : '') + m.text).join('\n');
    pushMsg('claude', { from: 'me', text: '📲 ' + shown, via: 'self' });
    const plan = db.plans.find(p => p.status === 'aguardando_ok' && p.selfAt);
    const lines = batch.length === 1 && OK_RE.test(raw) && plan && batch[0].when >= plan.selfAt ? await selfMirror(() => runPlan(plan.id)) // o ok que você deu lá, depois de ver o plano lá
      : WEEK_RE.test(raw) ? await selfMirror(() => weeklyReport({ manual: true, self: true }))
      : await selfMirror(() => askClaude(raw));
    brainAdd({ kind: 'self', icon: '📲', text: 'Do seu WhatsApp: “' + raw.replace(/\s+/g, ' ').slice(0, 160) + (raw.length > 160 ? '…' : '') + '”', sub: lines.length ? '↪ ' + lines[0].replace(/\s+/g, ' ').slice(0, 150) : '', quiet: true });
  } catch (e) { console.warn('conversa com você mesmo:', e.message); }
  finally { selfBusy = false; if (selfQ.length) selfTimer = setTimeout(selfFlush, 1000); }
}
async function selfMirror(fn) { // o que a assistente respondeu na Conversa vai também para lá
  const before = new Set(db.chats.find(x => x.id === 'claude').messages.map(m => m.id));
  await fn();
  const fresh = db.chats.find(x => x.id === 'claude').messages.filter(m => !before.has(m.id) && m.from === 'them' && !m.pending);
  const lines = [...fresh.filter(m => m.text), ...fresh.filter(m => !m.text)].map(selfLine).filter(Boolean); // a frase dela primeiro, depois o que ficou marcado
  if (lines.length) selfSend(lines.join('\n'), 'reply');
  return lines;
}
function selfLine(m) {
  if (m.text) return waFmt(m.text);
  const k = m.card; if (!k) return '';
  if (k.type === 'task') { const t = db.tasks.find(x => x.id === k.id); return !t ? '' : t.remindAt ? `🔔 ${shortDay(t.remindAt)}, ${fmtHour(t.remindAt)}: ${t.title}` : `✅ Atividade: ${t.title}${t.due ? ' (prazo ' + shortDay(t.due) + ')' : ''}`; }
  if (k.type === 'event') { const e = db.events.find(x => x.id === k.id); return e ? `📅 ${fmtWhen(e)}: ${e.title}${e.location ? ' — ' + e.location : ''}` : ''; }
  if (k.type === 'plan') {
    const p = db.plans.find(x => x.id === k.id); if (!p || p.status !== 'aguardando_ok') return '';
    p.selfAt = localISO(new Date()); save();
    return `🗂 Deixei pronto para o seu ok: ${p.titulo}\n` + p.passos.map(st => '• ' + stepText(st)).join('\n') + '\nResponda *ok* aqui para eu fazer, ou aprove no app.';
  }
  return '';
}
// kind: reply (resposta ao que você mandou lá) e manual sempre vão; aviso (briefing, lembretes, semana) se ligado; urgente (Cérebro) só se você ligar
function selfSend(text, kind) {
  text = String(text || '').trim(); if (!text || !selfLinked() || !waWv) return false;
  if ((kind === 'aviso' || kind === 'urgente') && !selfReady()) return false; // sem achar a conversa ainda, aviso automático não tenta
  if (kind === 'aviso' && db.settings.selfNotices === false) return false;
  if (kind === 'urgente' && !db.settings.selfUrgent) return false;
  selfOut.push(text); setTimeout(selfPump, 300); return true;
}
async function selfPump() {
  if (selfPumping || !waWv) return; selfPumping = true;
  try {
    while (selfOut.length) {
      let text = selfOut.shift();
      while (selfOut.length && text.length + selfOut[0].length < 3000) text += '\n\n' + selfOut.shift(); // o que juntou enquanto o WhatsApp estava em uso vai numa mensagem só
      text = '🤖 ' + text.slice(0, 3500);
      const k = selfKey(text); db.meta.selfSent = [...(db.meta.selfSent || []).filter(x => x !== k), k].slice(-60); save(); // a leitura reconhece e não responde a si mesma
      const r = await new Promise(resolve => {
        const id = uid(); waSendWaiters[id] = resolve;
        setTimeout(() => { if (waSendWaiters[id]) { delete waSendWaiters[id]; resolve({ ok: false, erro: 'o WhatsApp não respondeu (tempo esgotado)' }); } }, 25 * 60e3);
        try { waWv.send('wa-self-send', { id, text }); } catch (e) { delete waSendWaiters[id]; resolve({ ok: false, erro: e.message }); }
      });
      if (!r.ok) brainAdd({ kind: 'info', icon: '📲', text: 'Não consegui mandar para a sua conversa no WhatsApp: ' + (r.erro || 'falhou'), prio: 'baixa', quiet: true });
    }
  } finally { selfPumping = false; }
}
function feedPlain(f) { const sub = feedSub(f); return [f.head ? '*' + f.head + '*' : '', (f.icon ? f.icon + ' ' : '') + waFmt(f.text || ''), sub && f.kind !== 'plan' ? sub : ''].filter(Boolean).join('\n'); }

// ---------- 🌱 Espaço pessoal (escondido: Ctrl+Shift+Y): conselheira de desenvolvimento pessoal, diário, metas e o resumo da semana para a psicóloga ----------
// Fica só neste PC, numa gaveta separada do resto (fora do db): não entra na assistente, no Cérebro, no Drive nem no backup.
// Não é terapia. O resumo só vai para a psicóloga quando ele revisa e confirma o envio.
var PSI_KEY = 'wv1-psi', psiOpen = false, psiUnlocked = false, psiTab = 'psicologa', psiBusy = false, psiIdleT = null, psiConfirm = false, psiErr = '', psiFails = 0, psiWait = 0, psiForgot = false;
var PSI_RE = /^(?:🎤 \([^)]*\)\s*)?#?\s*(?:psi|psy|p\.\s?s\.\s?i)(?![a-zà-ú])[\s.,:;!-]*/i; // "psi …" na sua conversa com você mesmo (o áudio vem com "🎤 (áudio 0:12)" na frente)
var PSI_SES_RE = /^(?:pra |para (?:a )?)?(?:sess[aã]o|levar|psic[oó]loga|terapia)(?![a-zà-ú])[\s.,:;!-]*/i; // "psi sessão …": vai para a aba Psicóloga
var PSI_RISK = /(me matar|suic[ií]d|n[aã]o (quero|aguento) mais viver|vontade de morrer|queria (estar )?morr|acabar com (a )?minha vida|tirar (a )?minha (pr[oó]pria )?vida|me machucar|me cortar|sumir (de vez|pra sempre)|n[aã]o vejo sa[ií]da)/i;
var PSI_HELP = 'Se você está pensando em se machucar ou em morrer, fale agora com alguém: CVV 188 (ligação gratuita, 24 h, ou chat em cvv.org.br), a sua psicóloga, ou o SAMU 192 se houver perigo imediato. Se puder, chame alguém de confiança para ficar com você.';
var PSI_DIAS = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
function psiLoad() {
  let o = {}; try { o = JSON.parse(localStorage.getItem(PSI_KEY)) || {}; } catch {}
  o.chat = o.chat || []; o.diary = o.diary || []; o.goals = o.goals || []; o.sessao = o.sessao || []; o.drafts = o.drafts || [];
  o.cfg = Object.assign({ nome: '', dia: 0, hora: '18:00', auto: true, pin: '' }, o.cfg || {});
  return o;
}
var psi = psiLoad();
function psiSave() { try { localStorage.setItem(PSI_KEY, JSON.stringify(psi)); } catch { toast('Memória cheia'); } }
function psiChat(chat) { const n = selfKey(psi.cfg.nome); return !!n && selfKey(chat) === n; } // a conversa com a psicóloga no WhatsApp
function psiPurge() { const n = db.waLog.length; db.waLog = db.waLog.filter(m => !psiChat(m.chat)); if (db.waLog.length !== n) save(); } // tira do log do app o que já tinha sido lido dela
psiPurge();
function psiNums(t) { // "psi humor 6, estresse 8, dormi 5h" → números do diário
  const o = {}, n = re => { const m = String(t).match(re); return m ? Math.max(0, Math.min(10, parseFloat(m[1].replace(',', '.')))) : null; };
  const h = n(/humor\s*(?:de|:|=|em)?\s*(\d+(?:[.,]\d)?)/i), en = n(/energia\s*(?:de|:|=|em)?\s*(\d+(?:[.,]\d)?)/i), es = n(/estresse\s*(?:de|:|=|em)?\s*(\d+(?:[.,]\d)?)/i);
  const sn = String(t).match(/(?:sono|dormi)\s*(?:de|:|=)?\s*(\d+(?:[.,]\d)?)\s*h/i);
  if (h != null) o.humor = h; if (en != null) o.energia = en; if (es != null) o.estresse = es; if (sn) o.sono = Math.min(16, parseFloat(sn[1].replace(',', '.')));
  return o;
}
function psiFromSelf(body, when, audio) { // veio da conversa "Tiago (você)" começando com psi: vai só para o espaço pessoal
  body = String(body || '').trim(); if (!body) return;
  const ses = PSI_SES_RE.test(body), raw = body; if (ses) body = body.replace(PSI_SES_RE, '').trim(); if (!body) return;
  if (ses) psi.sessao.push({ id: uid(), ts: when, texto: body.slice(0, 2000), via: audio ? '📲 🎤' : '📲' }); // "psi sessão …": aba Psicóloga
  else psi.diary.push({ id: uid(), ts: when, texto: body.slice(0, 2000), via: audio ? '📲 🎤' : '📲', ...psiNums(body) });
  if (psi.diary.length > 1500) psi.diary.splice(0, psi.diary.length - 1500);
  psiSave(); if (psiOpen) psiRender();
  if (audio) { for (const [k, v] of [...audTx]) if (v && (v.includes(raw.slice(0, 40)) || v.includes(body.slice(0, 40)))) audTx.delete(k); db.meta.audTx = [...audTx]; } // o texto do áudio também não fica no app
  selfSend(ses ? '🌱 Anotei para a sessão.' : '🌱 Guardei no seu espaço pessoal.', 'reply');
}
const psiAvg = a => a.length ? Math.round(a.reduce((x, y) => x + y, 0) / a.length * 10) / 10 : null;
function psiWeek() { // últimos 7 dias
  const e = localISO(new Date()), s = localISO(new Date(Date.now() - 7 * 864e5)), inW = iso => !!iso && iso >= s && iso <= e;
  const diary = psi.diary.filter(d => inW(d.ts)), nums = k => diary.map(d => d[k]).filter(v => typeof v === 'number');
  const mine = db.waLog.filter(m => !m.prev && m.who === 'Eu' && !isSelf(m.chat) && inW(m.when));
  return { de: s.slice(0, 10), ate: e.slice(0, 10), diary, humor: nums('humor'), energia: nums('energia'), estresse: nums('estresse'), sono: nums('sono'),
    mine: mine.length, late: mine.filter(m => { const h = +m.when.slice(11, 13); return h >= 22 || h < 6; }).length,
    evs: db.events.filter(ev => inW(ev.start)).length, feitas: db.tasks.filter(t => t.done && t.doneAt && inW(localISO(new Date(t.doneAt)))).length,
    atrasadas: db.tasks.filter(t => !t.done && ((t.remindAt && t.remindAt < e) || (!t.remindAt && t.due && t.due < e.slice(0, 10)))).length,
    chat: psi.chat.filter(m => m.from === 'me' && inW(m.ts)) };
}
function psiNumLine(W) {
  const r = (a, u) => a.length ? `${String(psiAvg(a)).replace('.', ',')}${u}${a.length > 1 ? ` (de ${Math.min(...a)} a ${Math.max(...a)})` : ''}` : '';
  return [W.humor.length ? 'humor ' + r(W.humor, '/10') : '', W.energia.length ? 'energia ' + r(W.energia, '/10') : '', W.estresse.length ? 'estresse ' + r(W.estresse, '/10') : '', W.sono.length ? 'sono ' + r(W.sono, ' h') : ''].filter(Boolean).join(' · ');
}
function psiContext() {
  const W = psiWeek();
  const diary = psi.diary.slice(-25).map(d => `- ${d.ts.slice(0, 16).replace('T', ' ')}${d.humor != null ? ` humor ${d.humor}/10` : ''}${d.energia != null ? ` energia ${d.energia}/10` : ''}${d.estresse != null ? ` estresse ${d.estresse}/10` : ''}${d.sono != null ? ` sono ${d.sono} h` : ''}: ${d.texto || ''}`);
  const goals = psi.goals.map(g => `- [${g.id}] ${g.titulo} (${g.status})${g.porque ? ' — porque: ' + g.porque : ''}${(g.passos || []).length ? ' — passos: ' + g.passos.join('; ') : ''}${(g.notas || []).length ? ' — avanços: ' + g.notas.slice(-3).map(n => n.texto).join(' | ') : ''}`);
  return [`Agora: ${localISO(new Date())} (${new Date().toLocaleDateString('pt-BR', { weekday: 'long' })}).`,
    `## Diário dele (mais recentes)\n${diary.join('\n') || '(vazio)'}`, `## Metas\n${goals.join('\n') || '(nenhuma)'}`,
    `## O que ele lançou para levar à sessão\n${psi.sessao.filter(x => !x.usado).map(x => `- (${brDay(x.ts.slice(0, 10))}) ${x.texto}`).join('\n') || '(nada)'}`,
    `## Números dos últimos 7 dias\n- diário: ${psiNumLine(W) || 'sem números'}\n- ${W.evs} compromisso(s) na agenda; ${W.feitas} atividade(s) concluída(s); ${W.atrasadas} atrasada(s) agora\n- ${W.mine} mensagem(ns) dele no WhatsApp, ${W.late} entre 22 h e 6 h`].join('\n\n');
}
function psiSystem() {
  return `Você é a conselheira de desenvolvimento pessoal de ${db.settings.myName || 'o usuário'}, num espaço privado do app dele que só ele vê. Perfil: ${db.settings.profile || '(não informado)'}
Você NÃO é psicóloga e não faz terapia: não diagnostica, não usa rótulos clínicos como diagnóstico, não fala de remédio. Ele faz terapia com uma psicóloga; você complementa entre as sessões.
O que você faz: ajuda a pensar com clareza; separa o problema em partes (o que é fato, o que é interpretação, o que está no controle dele); ajuda a escolher o próximo passo pequeno e concreto, com quando; acompanha as metas; aponta padrões do diário (sono, estresse, horários, temas que voltam).
Jeito: português do Brasil, direta e calorosa, sem frase pronta de autoajuda e sem sermão. Uma pergunta por vez. Respostas curtas (até 6 linhas), como conversa. Ele é engenheiro e gosta de concretude.
Tema profundo (relacionamentos, família, luto, trauma, medo intenso, autoestima): acolha, ajude no que for prático e sugira levar à sessão; se ele topar, use anotar_para_sessao.
Use criar_meta quando ele decidir uma meta e atualizar_meta para registrar avanço, mudar status ou passos. Use só o que ele disse e o contexto abaixo; não invente.
RISCO: se ele falar em se machucar, em morrer, em suicídio ou em não ver saída, deixe o resto de lado: acolha em poucas palavras, pergunte se ele está seguro agora e diga para falar já com o CVV (188, ligação gratuita, 24 h, ou chat em cvv.org.br), com a psicóloga dele ou com o SAMU (192) se houver perigo imediato, e para chamar alguém de confiança para ficar com ele.
Nunca diga que é psicóloga nem que substitui a terapia.

${psiContext()}`;
}
var PSI_TOOLS = [
  { name: 'criar_meta', description: 'Cria uma meta pessoal que ele decidiu, com passos pequenos e concretos.', input_schema: { type: 'object', properties: { titulo: { type: 'string' }, porque: { type: 'string' }, passos: { type: 'array', items: { type: 'string' } } }, required: ['titulo'] } },
  { name: 'atualizar_meta', description: 'Registra avanço numa meta, muda o status (ativa, pausada, feita) ou troca os passos.', input_schema: { type: 'object', properties: { id: { type: 'string' }, nota: { type: 'string' }, status: { type: 'string', enum: ['ativa', 'pausada', 'feita'] }, passos: { type: 'array', items: { type: 'string' } } }, required: ['id'] } },
  { name: 'anotar_para_sessao', description: 'Anota um tema para ele levar à próxima sessão com a psicóloga (entra no resumo da semana).', input_schema: { type: 'object', properties: { texto: { type: 'string' } }, required: ['texto'] } }];
function psiTool(name, i) {
  if (name === 'criar_meta') { const g = { id: uid(), titulo: String(i.titulo || '').slice(0, 160), porque: i.porque || '', passos: (i.passos || []).slice(0, 8), status: 'ativa', notas: [], criado: localISO(new Date()) }; psi.goals.push(g); return { ok: true, id: g.id }; }
  if (name === 'atualizar_meta') { const g = psi.goals.find(x => x.id === i.id); if (!g) return { erro: 'meta não encontrada' }; if (i.nota) g.notas.push({ ts: localISO(new Date()), texto: i.nota }); if (i.status) g.status = i.status; if (Array.isArray(i.passos)) g.passos = i.passos.slice(0, 8); return { ok: true }; }
  if (name === 'anotar_para_sessao') { psi.sessao.push({ id: uid(), ts: localISO(new Date()), texto: String(i.texto || '').slice(0, 400), via: '💬' }); return { ok: true }; }
  return { erro: 'ferramenta desconhecida' };
}
async function psiAsk() {
  if (!db.settings.apiKey) { psi.chat.push({ from: 'them', ts: localISO(new Date()), text: 'Para conversar eu preciso da chave do Claude (⚙️ Configurações). O diário, as metas e o resumo da semana funcionam sem ela.' }); psiSave(); psiRender(); return; }
  psiBusy = true; psiRender();
  try {
    let messages = [];
    for (const m of psi.chat.slice(-30).filter(m => !m.err)) { const role = m.from === 'me' ? 'user' : 'assistant'; if (messages.length && messages[messages.length - 1].role === role) messages[messages.length - 1].content += '\n' + m.text; else messages.push({ role, content: m.text }); }
    while (messages.length && messages[0].role !== 'user') messages.shift();
    for (let step = 0; step < 5; step++) {
      const r = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: claudeHeaders(), body: JSON.stringify({ model: aiModel(), max_tokens: 2000, system: psiSystem(), tools: PSI_TOOLS, messages, ...effortCfg('medium') }) });
      const data = await r.json(); if (!r.ok) throw new Error(data?.error?.message || ('HTTP ' + r.status));
      const txt = data.content.filter(b => b.type === 'text').map(b => b.text).join('\n').trim(), uses = data.content.filter(b => b.type === 'tool_use');
      if (txt) psi.chat.push({ from: 'them', ts: localISO(new Date()), text: txt });
      if (!uses.length) break;
      messages = [...messages, { role: 'assistant', content: data.content }, { role: 'user', content: uses.map(u => ({ type: 'tool_result', tool_use_id: u.id, content: JSON.stringify(psiTool(u.name, u.input || {})) })) }];
      psiSave(); psiRender();
    }
  } catch (e) { psi.chat.push({ from: 'them', ts: localISO(new Date()), text: '⚠️ Não consegui responder agora: ' + e.message, err: 1 }); }
  finally { psiBusy = false; psiSave(); psiRender(); }
}
var PSI_DRAFT_SCHEMA = { type: 'object', properties: {
  como_estive: { type: 'string', description: '2 a 4 frases em primeira pessoa sobre como foi a semana' },
  temas: { type: 'array', items: { type: 'string' }, description: 'temas que voltaram na semana' },
  situacoes: { type: 'array', items: { type: 'string' }, description: 'situações marcantes, com as palavras dele entre aspas quando ajudar' },
  metas: { type: 'array', items: { type: 'string' }, description: 'como andaram as metas' } } };
async function psiDraft(auto) {
  if (psiBusy) return null;
  psiBusy = true; psiErr = ''; psiRender();
  const W = psiWeek(); let r = null;
  try {
    if (db.settings.apiKey) {
      try {
        r = await claudeJson({ max: 4000, effort: 'medium', schema: PSI_DRAFT_SCHEMA,
          system: `Você prepara, para ${db.settings.myName || 'o usuário'} revisar e mandar à psicóloga dele, o resumo da semana de ${brDay(W.de)} a ${brDay(W.ate)}. Escreva em primeira pessoa, como se fosse ele ("nesta semana eu…"), em português do Brasil, simples e honesto. Use SÓ o que está nos dados: o diário, o que ele escreveu para a conselheira, as metas, os temas para a sessão e os números. Não diagnostique, não use rótulos clínicos e não interprete causas: descreva o que aconteceu e o que ele sentiu, com as palavras dele entre aspas quando ajudar. De outras pessoas, só o primeiro nome ou o papel, e só o necessário. Sem conselho. Campo sem dado fica vazio. O que ele lançou para levar à sessão entra no resumo do jeito que ele escreveu, numa seção própria: não repita esses itens nos seus campos.`,
          user: psiContext() + '\n\n## O que ele escreveu para a conselheira nesta semana\n' + (W.chat.map(m => `- ${m.ts.slice(5, 16).replace('T', ' ')}: ${m.text}`).join('\n') || '(nada)') });
      } catch (e) { psiErr = 'A IA não respondeu (' + e.message + '); montei o básico.'; }
    }
    if (!r) r = { como_estive: '', temas: [], situacoes: W.diary.filter(d => d.texto).slice(-8).map(d => `${brDay(d.ts.slice(0, 10))}: "${d.texto.slice(0, 300)}"`), metas: psi.goals.filter(g => g.status !== 'feita' || (g.notas || []).some(n => n.ts >= W.de)).map(g => `${g.titulo} (${g.status})`) };
    const L = [`*Resumo da minha semana (${brDay(W.de)} a ${brDay(W.ate)})*`], sec = (t, v) => { const list = Array.isArray(v), a = (list ? v : [v]).map(x => String(x || '').trim()).filter(Boolean); if (a.length) L.push('', `*${t}*`, ...(list ? a.map(x => '• ' + x) : a)); };
    sec('Como estive', r.como_estive);
    const nl = psiNumLine(W); if (nl) L.push('', `*Diário:* ${nl}`);
    sec('Temas', r.temas); sec('Situações', r.situacoes); sec('Metas', r.metas); sec('Quero levar para a sessão', psi.sessao.filter(x => !x.usado).map(x => x.texto)); // as palavras dele, sem a IA reescrever
    L.push('', `*Rotina:* ${W.evs} compromisso(s) na agenda, ${W.atrasadas} atividade(s) atrasada(s), ${W.late} mensagem(ns) de trabalho entre 22 h e 6 h.`);
    const d = { id: uid(), de: W.de, ate: W.ate, ts: localISO(new Date()), auto: !!auto, text: L.join('\n'), status: 'rascunho' };
    psi.drafts.unshift(d); if (psi.drafts.length > 12) psi.drafts.length = 12; psiSave();
    return d;
  } finally { psiBusy = false; psiRender(); }
}
function psiTick() { // monta sozinho no dia e hora escolhidos; só monta, nunca envia
  const c = psi.cfg; if (c.auto === false) return;
  const now = new Date(), [h, m] = String(c.hora || '18:00').split(':').map(Number), at = new Date(now);
  at.setHours(h || 0, m || 0, 0, 0); at.setDate(at.getDate() - ((at.getDay() - (+c.dia || 0) + 7) % 7)); if (at > now) at.setDate(at.getDate() - 7);
  const key = localISO(at);
  if (!psi.lastAuto) { psi.lastAuto = key; psiSave(); return; } // primeira vez: começa a contar daqui
  if (psi.lastAuto === key || psiBusy || now - at > 2 * 864e5) return;
  psi.lastAuto = key; psiSave();
  psiDraft(true).then(d => { if (!d) return; notify('🌱 Espaço pessoal', 'O resumo da semana está pronto para você revisar (Ctrl+Shift+Y).'); selfSend('🌱 O resumo da semana do seu espaço pessoal está pronto para revisar no app (Ctrl+Shift+Y).', 'aviso'); });
}
async function psiHash(pin) { const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('wv1psi:' + pin)); return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join(''); }
function psiFocus() { setTimeout(() => { const i = $('#psi [data-focus]'); if (i) i.focus(); }, 50); }
function psiToggle() { if (psiOpen) psiClose(); else { psiOpen = true; psiConfirm = false; psiTab = 'psicologa'; $('#psi').hidden = false; psiTouch(); psiRender(); psiFocus(); } }
function psiClose() { psiOpen = false; psiUnlocked = false; psiForgot = false; psiErr = ''; clearTimeout(psiIdleT); const el = $('#psi'); if (el) { el.hidden = true; el.innerHTML = ''; } }
function psiTouch() { clearTimeout(psiIdleT); psiIdleT = setTimeout(psiClose, 10 * 60e3); } // 10 min parado: fecha (e tranca)
const psiTime = iso => `${brDay(iso.slice(0, 10))} ${iso.slice(11, 16)}`;
function psiRender() {
  const el = $('#psi'); if (!el || !psiOpen) return;
  const c = psi.cfg, keep = el.querySelector('.psi-in'), draft = keep ? keep.value : '', keepS = el.querySelector('#psiSes'), sesDraft = keepS ? keepS.value : '';
  const lockBox = inner => { el.innerHTML = `<div class="psi-box psi-lock"><div class="psi-h"><b>🌱 Espaço pessoal</b><span class="psi-tabs"></span><button data-psi="close" title="Fechar (Esc)">✕</button></div><div class="psi-pin">${inner}<div class="psi-err">${esc(psiErr)}</div></div></div>`; };
  if (!c.pin) { // senha obrigatória: na primeira vez, ele cria
    lockBox(`<div class="psi-mu">Crie a senha deste espaço. Ela vai ser pedida toda vez que ele abrir. Pode usar letras e números. Guarde bem: se esquecer, não tem como recuperar, só apagando o que estiver aqui.</div>
      <input type="password" maxlength="64" placeholder="Senha (no mínimo 4)" autocomplete="new-password" data-focus id="psiPw1"><input type="password" maxlength="64" placeholder="Repita a senha" autocomplete="new-password" id="psiPw2"><button class="ok" data-psi="pw-create">Criar senha</button>`);
    return;
  }
  if (!psiUnlocked) {
    if (psiForgot) lockBox(`<div class="psi-mu">Sem a senha, o único jeito é apagar o espaço pessoal deste computador: diário, metas, conversas, anotações para a sessão e rascunhos. O nome da psicóloga e o horário do resumo continuam. Para confirmar, escreva <b>APAGAR</b>.</div>
      <input id="psiWipe" maxlength="10" placeholder="APAGAR" autocomplete="off" data-focus><span class="psi-gb2"><button class="warn" data-psi="wipe">Apagar tudo e criar outra senha</button><button data-psi="forgot-back">Voltar</button></span>`);
    else lockBox(`<input type="password" maxlength="64" placeholder="Senha" autocomplete="current-password" data-focus id="psiPin"><button class="ok" data-psi="unlock">Abrir</button><button class="psi-lk" data-psi="forgot">Esqueci a senha</button>`);
    return;
  }
  const tabs = [['psicologa', '🩺 Psicóloga'], ['conversa', '💬 Conversa'], ['diario', '📓 Diário'], ['metas', '🎯 Metas'], ['semana', '📄 Semana']];
  const risk = psi.chat.slice(-6).some(m => m.from === 'me' && PSI_RISK.test(m.text)) || psi.sessao.slice(-4).some(x => !x.usado && PSI_RISK.test(x.texto));
  let body = '';
  if (psiTab === 'psicologa') {
    const ses = psi.sessao.filter(x => !x.usado).reverse(), old = psi.sessao.filter(x => x.usado).slice(-8).reverse(), quem = c.nome || 'a sua psicóloga';
    body = `<div class="psi-scroll"><div class="psi-form"><b class="psi-ft">Para levar ${c.nome ? 'à ' + esc(quem) : 'à sua psicóloga'}</b>
      <textarea id="psiSes" rows="3" placeholder="O que aconteceu, o que você sentiu, o que quer conversar na sessão" data-focus>${esc(sesDraft)}</textarea>
      <button class="ok" data-psi="ses-add">Lançar</button>
      <div class="psi-hint">Enter lança, Shift+Enter pula linha. Tudo o que estiver aqui entra no resumo da semana (${PSI_DIAS[+c.dia || 0]} às ${esc(c.hora || '18:00')}), com as suas palavras. Pelo celular: mande para a sua conversa com você mesmo começando com <b>psi sessão</b>, por texto ou áudio.</div></div>`
      + (ses.length ? ses.map(x => `<div class="psi-d"><div class="psi-dh">${psiTime(x.ts)}${x.via ? ' · ' + x.via : ''}<span class="psi-gb"><button data-psi="ses-ok" data-id="${esc(x.id || x.ts)}" title="Já falei disso na sessão">✓ Já falei</button><button data-psi="ses-rm" data-id="${esc(x.id || x.ts)}" title="Apagar">✕</button></span></div><div>${esc(x.texto)}</div></div>`).join('')
        : '<div class="psi-empty">Nada lançado ainda. Escreva acima o que você quer levar para a sessão: um fato, um sentimento, uma dúvida.</div>')
      + (old.length ? `<div class="psi-d psi-old"><div class="psi-dh"><b>Já levados</b></div>${old.map(x => `<div>• ${esc(x.texto.length > 160 ? x.texto.slice(0, 160) + '…' : x.texto)} <span class="psi-mu">(${x.usadoComo === 'sessao' ? 'falei na sessão' : 'foi no resumo'}${x.usadoEm ? ' ' + brDay(x.usadoEm.slice(0, 10)) : ''})</span></div>`).join('')}</div>` : '')
      + (risk ? `<div class="psi-risk psi-risk-in">🆘 ${esc(PSI_HELP)}</div>` : '') + '</div>';
  } else if (psiTab === 'conversa') {
    body = `<div class="psi-msgs" id="psiMsgs">${psi.chat.length ? '' : `<div class="psi-empty">Este espaço é só seu, para pensar com calma. Pode começar pelo que está pesando hoje, por uma meta ou por uma decisão. Eu ajudo a organizar e a dar o próximo passo. O que for mais fundo, a gente anota para a sessão com a sua psicóloga.</div>`}`
      + psi.chat.slice(-80).map(m => `<div class="psi-m ${m.from === 'me' ? 'me' : ''}"><div>${esc(m.text)}</div><i>${psiTime(m.ts)}</i></div>`).join('')
      + (psiBusy ? '<div class="psi-m"><div class="think">pensando…</div></div>' : '') + '</div>'
      + (risk ? `<div class="psi-risk">🆘 ${esc(PSI_HELP)}</div>` : '')
      + `<div class="psi-compose"><textarea class="psi-in" rows="2" placeholder="Escreva aqui" data-focus>${esc(draft)}</textarea><button class="ok" data-psi="send">Enviar</button></div>`;
  } else if (psiTab === 'diario') {
    const sl = (k, l) => `<label>${l} <b id="psiV_${k}">–</b><input type="range" min="0" max="10" step="1" value="5" data-k="${k}" data-psi-range></label>`;
    body = `<div class="psi-scroll"><div class="psi-form">${sl('humor', 'Humor')}${sl('energia', 'Energia')}${sl('estresse', 'Estresse')}<label>Sono (h) <input type="number" min="0" max="16" step="0.5" id="psiSono" style="width:80px"></label>
      <textarea id="psiTxt" rows="3" placeholder="Como foi o dia? O que pesou, o que foi bom" data-focus></textarea><button class="ok" data-psi="diary-add">Guardar no diário</button>
      <div class="psi-hint">Pelo celular: mande para a sua conversa ${esc(selfName() || '"você mesmo"')} começando com <b>psi</b>, por texto ou áudio. Por exemplo: "psi humor 6, estresse 8, dormi 5h, reunião tensa com o fiscal". Vai só para cá: não passa pela assistente nem pelo Drive.</div></div>`
      + psi.diary.slice(-60).reverse().map(d => `<div class="psi-d"><div class="psi-dh">${psiTime(d.ts)}${d.via ? ' · ' + d.via : ''}${d.humor != null ? ' · humor ' + d.humor : ''}${d.energia != null ? ' · energia ' + d.energia : ''}${d.estresse != null ? ' · estresse ' + d.estresse : ''}${d.sono != null ? ' · sono ' + d.sono + ' h' : ''}<button data-psi="diary-del" data-id="${d.id}" title="Apagar">✕</button></div>${d.texto ? `<div>${esc(d.texto)}</div>` : ''}</div>`).join('') + '</div>';
  } else if (psiTab === 'metas') {
    const st = { ativa: '🟢', pausada: '⏸️', feita: '✅' };
    body = `<div class="psi-scroll"><div class="psi-form"><input id="psiGoal" placeholder="Nova meta (ex.: dormir antes da meia-noite 5 dias por semana)" data-focus><input id="psiWhy" placeholder="Por que ela importa (opcional)"><button class="ok" data-psi="goal-add">Criar meta</button></div>`
      + (psi.goals.length ? psi.goals.slice().reverse().map(g => `<div class="psi-d"><div class="psi-dh">${st[g.status] || '•'} <b>${esc(g.titulo)}</b><span class="psi-gb"><button data-psi="goal-st" data-id="${g.id}" data-v="${g.status === 'feita' ? 'ativa' : 'feita'}">${g.status === 'feita' ? 'Reabrir' : '✅ Feita'}</button>${g.status === 'ativa' ? `<button data-psi="goal-st" data-id="${g.id}" data-v="pausada">Pausar</button>` : g.status === 'pausada' ? `<button data-psi="goal-st" data-id="${g.id}" data-v="ativa">Retomar</button>` : ''}<button data-psi="goal-del" data-id="${g.id}" title="Apagar">✕</button></span></div>`
        + (g.porque ? `<div class="psi-mu">${esc(g.porque)}</div>` : '') + ((g.passos || []).length ? `<div>${g.passos.map(x => '• ' + esc(x)).join('<br>')}</div>` : '') + ((g.notas || []).length ? `<div class="psi-mu">${g.notas.slice(-3).map(n => psiTime(n.ts) + ': ' + esc(n.texto)).join('<br>')}</div>` : '') + '</div>').join('')
        : '<div class="psi-empty">Nenhuma meta ainda. Dá para criar aqui ou conversando: quando você decidir algo, a conselheira registra.</div>') + '</div>';
  } else {
    const d = psi.drafts[0], ses = psi.sessao.filter(x => !x.usado);
    body = `<div class="psi-scroll"><div class="psi-form psi-cfg"><label>Psicóloga no WhatsApp <input id="psiNome" value="${esc(c.nome)}" placeholder="nome exatamente como na lista"></label>
      <label>Montar o rascunho <select id="psiDia">${PSI_DIAS.map((x, i) => `<option value="${i}" ${+c.dia === i ? 'selected' : ''}>${x}</option>`).join('')}</select> às <input id="psiHora" type="time" value="${esc(c.hora)}"></label>
      <label class="psi-ck"><input type="checkbox" id="psiAuto" ${c.auto !== false ? 'checked' : ''}> montar sozinho e me avisar (nunca envia sem você)</label>
      <label>Trocar a senha <input id="psiNewPin" type="password" maxlength="64" placeholder="nova senha (vazio = mantém)" autocomplete="new-password"><input id="psiNewPin2" type="password" maxlength="64" placeholder="repita a nova senha" autocomplete="new-password"></label><span class="psi-gb2"><button class="ok" data-psi="cfg-save">Salvar</button></span></div>`
      + (ses.length ? `<div class="psi-mu psi-sesn">${ses.length === 1 ? '1 anotação' : ses.length + ' anotações'} da aba 🩺 Psicóloga ${ses.length === 1 ? 'entra' : 'entram'} no rascunho, do jeito que você escreveu.</div>` : '')
      + `<div class="psi-d"><div class="psi-dh"><b>Rascunho para a psicóloga</b>${d ? ` · ${brDay(d.de)} a ${brDay(d.ate)} · ${d.status === 'enviado' ? '✓ enviado ' + psiTime(d.sentAt) : 'rascunho'}` : ''}<span class="psi-gb"><button data-psi="draft">${psiBusy ? 'montando…' : d ? 'Montar de novo' : 'Montar agora'}</button></span></div>`
      + (d ? `<textarea id="psiDraft" rows="16">${esc(d.text)}</textarea><div class="psi-gb2"><button data-psi="copy">Copiar</button>${c.nome ? `<button class="${psiConfirm ? 'warn' : 'ok'}" data-psi="send-draft">${psiConfirm ? 'Confirmar: enviar para ' + esc(c.nome) + ' agora' : 'Enviar para ' + esc(c.nome) + ' no WhatsApp'}</button>${psiConfirm ? '<button data-psi="send-cancel">Cancelar</button>' : ''}` : '<span class="psi-mu">Escreva o nome da psicóloga acima para enviar pelo WhatsApp.</span>'}</div>` : '<div class="psi-mu">Ainda não há rascunho. Ele junta o diário, as conversas daqui, as metas e os números da semana.</div>')
      + `${psiErr ? `<div class="psi-err">${esc(psiErr)}</div>` : ''}<div class="psi-hint">Revise e edite antes de enviar: o texto vai como está. Ele sai das suas palavras e dos números da semana; o que outras pessoas escreveram no WhatsApp fica de fora, e nada aqui é diagnóstico.</div></div></div>`;
  }
  el.innerHTML = `<div class="psi-box"><div class="psi-h"><b>🌱 Espaço pessoal</b><span class="psi-tabs">${tabs.map(([k, l]) => `<button class="${psiTab === k ? 'on' : ''}" data-psi="tab" data-id="${k}">${l}</button>`).join('')}</span><button data-psi="close" title="Trancar">🔒</button><button data-psi="close" title="Fechar (Esc)">✕</button></div>
    <div class="psi-note">Apoio para pensar e se organizar entre as sessões. Não é terapia e não substitui a sua psicóloga. Em crise: CVV 188 (24 h, gratuito) · SAMU 192. Fica só neste computador; o texto passa pela sua chave do Claude para ela responder.</div>${body}</div>`;
  const ms = $('#psiMsgs'); if (ms) ms.scrollTop = ms.scrollHeight;
}
document.addEventListener('keydown', e => {
  if (e.ctrlKey && e.shiftKey && e.code === 'KeyY') { e.preventDefault(); psiToggle(); return; }
  if (!psiOpen) return; psiTouch();
  if (e.key === 'Escape') { psiClose(); return; }
  if (e.key === 'Enter' && !e.shiftKey && e.target.classList && e.target.classList.contains('psi-in')) { e.preventDefault(); psiAct('send'); }
  if (e.key === 'Enter' && !e.shiftKey && e.target.id === 'psiSes' && !e.isComposing) { e.preventDefault(); psiAct('ses-add'); }
  if (e.key === 'Enter' && e.target.id === 'psiPin') psiAct('unlock');
  if (e.key === 'Enter' && (e.target.id === 'psiPw1' || e.target.id === 'psiPw2')) { if (e.target.id === 'psiPw1') $('#psiPw2').focus(); else psiAct('pw-create'); }
  if (e.key === 'Enter' && e.target.id === 'psiWipe') psiAct('wipe');
}, true);
document.addEventListener('input', e => {
  if (!psiOpen) return;
  if (e.target.matches && e.target.matches('[data-psi-range]')) { const v = $('#psiV_' + e.target.dataset.k); if (v) v.textContent = e.target.value; e.target.dataset.set = '1'; }
  if (e.target.id === 'psiDraft' && psi.drafts[0]) { psi.drafts[0].text = e.target.value; psiSave(); }
});
async function psiAct(a, id, v) {
  psiTouch(); const c = psi.cfg;
  if (a === 'close') return psiClose();
  if (a === 'tab') { psiTab = id; psiConfirm = false; psiErr = ''; return psiRender(); }
  if (a === 'unlock') {
    if (Date.now() < psiWait) { psiErr = `Muitas tentativas. Espere ${Math.ceil((psiWait - Date.now()) / 1000)} s.`; psiRender(); return psiFocus(); }
    const pin = ($('#psiPin') || {}).value || '';
    if ((await psiHash(pin)) === c.pin) { psiUnlocked = true; psiErr = ''; psiFails = 0; psiTab = 'psicologa'; }
    else if (++psiFails >= 5) { psiFails = 0; psiWait = Date.now() + 60e3; psiErr = 'Senha errada. Espere 1 minuto para tentar de novo.'; }
    else psiErr = 'Senha errada';
    psiRender(); return psiFocus();
  }
  if (a === 'pw-create') {
    const p1 = ($('#psiPw1') || {}).value || '', p2 = ($('#psiPw2') || {}).value || '';
    if (p1.trim().length < 4) psiErr = 'A senha precisa ter pelo menos 4 caracteres';
    else if (p1 !== p2) psiErr = 'As duas senhas não estão iguais';
    else { c.pin = await psiHash(p1); psiUnlocked = true; psiErr = ''; psiTab = 'psicologa'; psiSave(); toast('🔒 Senha criada'); }
    psiRender(); return psiFocus();
  }
  if (a === 'forgot') { psiForgot = true; psiErr = ''; psiRender(); return psiFocus(); }
  if (a === 'forgot-back') { psiForgot = false; psiErr = ''; psiRender(); return psiFocus(); }
  if (a === 'wipe') {
    if ((($('#psiWipe') || {}).value || '').trim().toUpperCase() !== 'APAGAR') { psiErr = 'Escreva APAGAR para confirmar'; psiRender(); return psiFocus(); }
    psi = { chat: [], diary: [], goals: [], sessao: [], drafts: [], lastAuto: psi.lastAuto, cfg: Object.assign({}, c, { pin: '' }) };
    psiSave(); psiForgot = false; psiErr = ''; toast('Espaço pessoal apagado'); psiRender(); return psiFocus();
  }
  if (!psiUnlocked) return; // daqui para baixo, só com a senha
  if (a === 'ses-add') {
    const el = $('#psiSes'), t = ((el || {}).value || '').trim(); if (!t) return toast('Escreva o que você quer levar');
    psi.sessao.push({ id: uid(), ts: localISO(new Date()), texto: t.slice(0, 2000) }); psiSave(); el.value = ''; toast('🌱 Lançado'); psiRender(); return psiFocus();
  }
  if (a === 'ses-ok') { const x = psi.sessao.find(s => (s.id || s.ts) === id); if (x) { x.usado = true; x.usadoComo = 'sessao'; x.usadoEm = localISO(new Date()); psiSave(); } return psiRender(); }
  if (a === 'ses-rm') { psi.sessao = psi.sessao.filter(s => (s.id || s.ts) !== id); psiSave(); return psiRender(); }
  if (a === 'send') { const t = ($('#psi .psi-in') || {}).value || ''; if (!t.trim() || psiBusy) return; $('#psi .psi-in').value = ''; psi.chat.push({ from: 'me', ts: localISO(new Date()), text: t.trim().slice(0, 4000) }); psiSave(); return psiAsk(); }
  if (a === 'diary-add') {
    const e = { id: uid(), ts: localISO(new Date()), texto: ($('#psiTxt').value || '').trim().slice(0, 2000) };
    document.querySelectorAll('#psi [data-psi-range]').forEach(r => { if (r.dataset.set) e[r.dataset.k] = +r.value; });
    const sono = parseFloat(String($('#psiSono').value).replace(',', '.')); if (!isNaN(sono)) e.sono = sono;
    if (!e.texto && Object.keys(e).length <= 3) return toast('Escreva algo ou marque um número');
    psi.diary.push(e); psiSave(); toast('🌱 Guardado'); return psiRender();
  }
  if (a === 'diary-del') { psi.diary = psi.diary.filter(d => d.id !== id); psiSave(); return psiRender(); }
  if (a === 'goal-add') { const t = $('#psiGoal').value.trim(); if (!t) return; psiTool('criar_meta', { titulo: t, porque: $('#psiWhy').value.trim() }); psiSave(); return psiRender(); }
  if (a === 'goal-st') { const g = psi.goals.find(x => x.id === id); if (g) { g.status = v; g.notas.push({ ts: localISO(new Date()), texto: 'status: ' + v }); psiSave(); } return psiRender(); }
  if (a === 'goal-del') { psi.goals = psi.goals.filter(g => g.id !== id); psiSave(); return psiRender(); }
  if (a === 'cfg-save') {
    const np = $('#psiNewPin').value, np2 = $('#psiNewPin2').value;
    if (np && np.trim().length < 4) { psiErr = 'A senha precisa ter pelo menos 4 caracteres'; return psiRender(); }
    if (np && np !== np2) { psiErr = 'As duas senhas novas não estão iguais'; return psiRender(); }
    c.nome = $('#psiNome').value.trim(); c.dia = +$('#psiDia').value; c.hora = $('#psiHora').value || '18:00'; c.auto = $('#psiAuto').checked;
    if (np) c.pin = await psiHash(np);
    psiErr = ''; psiSave(); psiPurge(); toast(np ? '🔒 Salvo, com a senha nova' : '🌱 Salvo'); return psiRender();
  }
  if (a === 'draft') { await psiDraft(false); return; }
  if (a === 'copy') { try { await navigator.clipboard.writeText($('#psiDraft').value); toast('Copiado'); } catch { toast('Não consegui copiar'); } return; }
  if (a === 'send-cancel') { psiConfirm = false; return psiRender(); }
  if (a === 'send-draft') {
    const d = psi.drafts[0]; if (!d || !c.nome) return;
    if (!psiConfirm) { psiConfirm = true; return psiRender(); } // dois toques: nada sai por engano
    psiConfirm = false; d.text = $('#psiDraft').value; psiErr = 'Enviando…'; psiRender();
    const r = await waSend(c.nome, d.text.trim());
    if (r.ok) { d.status = 'enviado'; d.sentAt = localISO(new Date()); psi.sessao.forEach(x => { if (!x.usado) { x.usado = true; x.usadoComo = 'resumo'; x.usadoEm = d.sentAt; } }); psiErr = ''; toast('🌱 Enviado para ' + c.nome); }
    else psiErr = 'Não enviei: ' + (r.erro || 'falhou');
    psiSave(); return psiRender();
  }
}
document.addEventListener('click', e => { const b = e.target.closest && e.target.closest('[data-psi]'); if (!b || !psiOpen) return; e.preventDefault(); psiAct(b.dataset.psi, b.dataset.id, b.dataset.v); });

// ---------- computador: WhatsApp Web dentro do app ----------
let driveInfo = null, dlInfo = null;
const dlName = p => String(p || '').split(/[\\/]/).filter(Boolean).pop() || 'Downloads';
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
  if (window.wv1desk.dlGet) window.wv1desk.dlGet().then(r => { dlInfo = r; });
  gcalRefreshStatus().then(() => { if (gcalOn()) gcalPull(); });
  setInterval(gcalPull, 10 * 60e3);
  setInterval(refreshSums, 10 * 60e3);
  window.wv1desk.onSaved(d => {
    db.meta.savedCount = (db.meta.savedCount || 0) + 1; save();
    toast(d.downloads ? `⬇️ Salvo em ${dlInfo ? dlName(dlInfo.dir) : 'Downloads'}: ${d.name}${d.appFile ? '' : ' (cópia no Drive)'}` : '📁 Salvo: ' + d.rel);
    if (d.downloads && !d.appFile && /\.(ogg|opus|mp3|m4a|wav|flac|mpga)$/i.test(d.name || '') && sttOn()) audFile(d);
  });
  waWv = wv;
  wv.addEventListener('dom-ready', () => { audCfg(); audTxSync(); selfCfg(); });
  wv.addEventListener('ipc-message', e => {
    if (e.channel === 'wa-msgs') ingestWa(e.args[0]);
    if (e.channel === 'wa-hotkey' && e.args[0] === 'psi') psiToggle();
    if (e.channel === 'wa-self-found') { const n = String((e.args[0] || {}).name || ''); if (n && n !== db.meta.selfAuto) { db.meta.selfAuto = n; save(); selfCfg(); renderSideTabs(); } }
    if (e.channel === 'wa-audio-seen') audioSeen(e.args[0]);
    if (e.channel === 'wa-audio') onWaAudio(e.args[0]);
    if (e.channel === 'wa-opened') { const r = e.args[0] || {}; if (!r.ok) toast('Não achei a conversa "' + (r.chat || '') + '" na lista do WhatsApp'); }
    if (e.channel === 'wa-audio-bind') { const b = e.args[0] || {}; if (b.id && b.text) { audKeep([b.id], b.text); audMark(b.id); if (b.key) audBound.add(b.key); save(); } }
    if (e.channel === 'wa-audio-done') { const r = e.args[0] || {}; const w = audWaiters[r.reqId]; if (w) { delete audWaiters[r.reqId]; w(r); } }
    if (e.channel === 'wa-sent') { const r = e.args[0] || {}; const w = waSendWaiters[r.id]; if (w) { delete waSendWaiters[r.id]; w(r); } }
    if (e.channel === 'wa-sweep') {
      const st = e.args[0] || {}; waSweeping = st.state === 'start'; waSweepFull = !!st.full; renderSide();
      if (st.state === 'skip') { // WhatsApp em uso ou carregando: tenta de novo em ~2 min
        lastSweepU = Date.now() - 8 * 60e3; if (st.full) lastSweepF = Date.now() - 118 * 60e3;
        if (manualSweep) { manualSweep = false; pushMsg('claude', { from: 'them', text: st.reason === 'carregando' ? 'O WhatsApp ainda está carregando. Tento de novo daqui a pouco.' : 'Você está usando o WhatsApp agora; faço a leitura completa assim que ele ficar parado.' }); }
      }
      if (st.state === 'end') {
        if (audQueue.length) setTimeout(audPump, 1500); // áudios na fila (modo sozinha) aproveitam o WhatsApp parado
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
      const src = t.chatId && t.chatId !== 'claude' && db.chats.find(c => c.id === t.chatId);
      brainAdd({ kind: 'rem', key: 't:' + t.id, taskId: t.id, head: '⏰ Hora do lembrete · ' + fmtHour(t.remindAt), text: t.title, sub: src ? '💬 ' + src.name : '', prio: 'alta', say: 'Lembrete: ' + t.title });
      selfSend('⏰ Lembrete ' + fmtHour(t.remindAt) + ': ' + t.title, 'aviso');
      notify('⏰ ' + t.title, 'Lembrete do WhatsApp v1');
    }
  }
  // avisos antecipados: véspera e 1 hora antes (só data: "vence amanhã" às 9 h da véspera e "vence hoje" às 8 h)
  for (const t of db.tasks) {
    if (t.done) continue;
    for (const w of dueWarnings(t, t.remindAt || t.due, false)) {
      changed = true; const head = warnHead(w, t.remindAt || t.due, 'task');
      brainAdd({ kind: 'rem', key: 't:' + t.id, taskId: t.id, head, text: t.title, prio: w === 'h1' ? 'alta' : 'media', say: head.replace(/^\W+/, '') + ': ' + t.title });
      notify('⏳ ' + t.title, head);
    }
  }
  for (const ev of db.events) {
    for (const w of dueWarnings(ev, ev.start, ev.allDay)) {
      changed = true; const head = warnHead(w, ev.start, 'event', ev.allDay);
      brainAdd({ kind: 'rem', key: 'e:' + ev.id, eventId: ev.id, head, text: ev.title, sub: ev.location ? '📍 ' + ev.location : '', prio: w === 'h1' ? 'alta' : 'media', say: head.replace(/^\W+/, '') + ': ' + ev.title });
      if (w === 'h1') selfSend(head + ': ' + ev.title + (ev.location ? ' — ' + ev.location : ''), 'aviso');
      notify('📅 ' + ev.title, head + (ev.location ? ' · ' + ev.location : ''));
    }
  }
  if (dueWarnings.dirty) { dueWarnings.dirty = false; changed = true; }
  renderPTasks();
  const today = ymd(new Date());
  const hr = new Date().getHours();
  if (db.meta.digest !== today && hr >= 6) { db.meta.digest = today; changed = true; briefing('manha'); }
  if (db.meta.digestPm !== today && hr >= 18) { db.meta.digestPm = today; changed = true; briefing('tarde'); }
  const fri = lastFriday17(); // resumo da semana: sexta às 17 h (se o PC estava desligado, sai até segunda à tarde)
  if (db.settings.weekly !== false && Date.now() >= fri.getTime() && Date.now() - fri.getTime() < 3 * 864e5 && db.meta.weekly !== ymd(fri)) { db.meta.weekly = ymd(fri); changed = true; weeklyReport({ ref: fri, auto: true }); }
  if (changed) { save(); render(); }
  scheduleSweeps();
  if (db.settings.brain !== false && !brainBusy) {
    const age = Date.now() - (db.brain.at || 0), h = new Date().getHours();
    if (!db.settings.apiKey && !oaOn()) { if (!db.brain.pulse || age > 10 * 60e3) brainThink(); }
    else if ((db.brain.sig !== brainSig() && age > 15 * 60e3) || (age > 90 * 60e3 && h >= 7 && h < 22)) brainThink();
  }
}

function warnPoints(when, allDay) {
  if (when.length > 10 && !allDay) { const at = parseLocal(when).getTime(); return { d1: at - 24 * 3600e3, h1: at - 3600e3, end: at }; }
  const day = parseLocal(when.slice(0, 10)), d1 = new Date(day), h1 = new Date(day), end = new Date(day);
  d1.setDate(d1.getDate() - 1); d1.setHours(9, 0, 0, 0); h1.setHours(8, 0, 0, 0); end.setHours(23, 59, 0, 0);
  return { d1: d1.getTime(), h1: h1.getTime(), end: end.getTime() };
}
// devolve os avisos que vencem agora; na primeira vez que vê o item (ou se a data mudou) marca como já dados os que já passaram, para não disparar tudo de uma vez
function dueWarnings(obj, when, allDay) {
  if (!when) return [];
  const key = when + (allDay ? '|d' : ''), now = Date.now(), p = warnPoints(when, allDay);
  if (!obj.warned || obj.warned.key !== key) { obj.warned = { key, d1: now >= p.d1, h1: now >= p.h1 }; dueWarnings.dirty = true; }
  const w = obj.warned, out = [];
  if (!w.h1 && now >= p.h1 && now < p.end) { w.h1 = w.d1 = true; out.push('h1'); }
  else if (!w.d1 && now >= p.d1 && now < p.h1) { w.d1 = true; out.push('d1'); }
  return out.filter(k => k === 'd1' ? db.settings.avisoDia !== false : db.settings.avisoHora !== false);
}
function warnHead(k, when, kind, allDay) {
  if (when.length > 10 && !allDay) {
    if (k === 'h1') { const m = Math.max(1, Math.round((parseLocal(when) - Date.now()) / 60000)); return `⏳ ${m >= 55 ? 'Em 1 hora' : 'Em ' + m + ' min'} (${fmtHour(when)})`; }
    return `⏳ Chegando: ${fmtDay(when)}, ${fmtHour(when)}`;
  }
  if (kind === 'event') return k === 'h1' ? '📅 Hoje (dia todo)' : '📅 Amanhã (dia todo)';
  return k === 'h1' ? '📌 Vence hoje' : '⏳ Vence amanhã';
}
function briefData(kind) {
  const today = ymd(new Date()), tm = new Date(); tm.setDate(tm.getDate() + 1); const tomorrow = ymd(tm);
  const day = kind === 'manha' ? today : tomorrow;
  const evs = sortedEvents().filter(e => e.start.slice(0, 10) === day);
  const rem = db.tasks.filter(t => !t.done && t.remindAt && t.remindAt.slice(0, 10) === day);
  const late = db.tasks.filter(t => !t.done && ((t.remindAt && t.remindAt < localISO(new Date())) || (!t.remindAt && t.due && t.due < today)));
  const pend = db.tasks.filter(t => !t.done);
  const lines = [kind === 'manha' ? `☀️ Bom dia${db.settings.myName ? ', ' + db.settings.myName : ''}! Seu dia:` : `🌙 Fechando o dia. Amanhã:`];
  lines.push(evs.length ? evs.map(e => `📅 ${evHour(e)} ${e.title}${e.location ? ' — ' + e.location : ''}`).join('\n') : (kind === 'manha' ? '📅 Nenhum compromisso hoje.' : '📅 Nenhum compromisso amanhã.'));
  if (rem.length) lines.push(rem.map(t => `🔔 ${fmtHour(t.remindAt)} ${t.title}`).join('\n'));
  if (late.length) lines.push(`⚠️ Atrasados: ${late.slice(0, 8).map(t => t.title).join('; ')}`);
  if (db.inbox.length) lines.push(`📋 ${db.inbox.length} sugestão(ões) do WhatsApp esperando sua confirmação${db.inbox.some(x => x.prioridade === 'alta') ? ', com urgência' : ''}.`);
  lines.push(`✅ ${pend.length} atividade(s) pendente(s).`);
  return lines.join('\n\n');
}
async function briefing(kind) {
  const head = kind === 'manha' ? '☀️ Briefing da manhã' : '🌙 Fechando o dia';
  const text = briefData(kind), post = t => { brainAdd({ kind: 'brief', head, text: t, quiet: true }); selfSend('*' + head + '*\n' + waFmt(t), 'aviso'); };
  if (!db.settings.apiKey) { post(text); return; }
  try {
    await callClaude({ system: systemPrompt() + `\nVocê está escrevendo, por iniciativa própria, o briefing ${kind === 'manha' ? 'da manhã' : 'do fim do dia'}.`, tools: TOOLS, postTo: 'claude', onText: post,
      messages: [{ role: 'user', content: `[briefing automático, não é mensagem do usuário] Dados:\n${text}\n\nEscreva o briefing ${kind === 'manha' ? 'da manhã' : 'do fim do dia: o que ficou pendente e o que vem amanhã'} como secretária: curto, em tópicos com emojis, e no máximo 2 sugestões práticas (cobrar alguém, remarcar, mandar um documento). Se algo atrasado merecer lembrete, crie com criar_lembrete. Sem cumprimento longo.` }] });
  } catch { post(text); }
}
setInterval(tick, 30e3);
setInterval(psiTick, 60e3); setTimeout(psiTick, 5000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) { tick(); if (db.settings.apiKey) readAll(false); } else if (db.settings.waSweep !== false) setTimeout(() => { if (document.hidden) requestSweep({ full: false, force: true }); }, 20000); });

// instalação
let deferredPrompt;
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferredPrompt = e; $('#btnInstall').style.display = ''; });
$('#btnInstall').addEventListener('click', async () => { if (!deferredPrompt) return; deferredPrompt.prompt(); await deferredPrompt.userChoice; deferredPrompt = null; $('#btnInstall').style.display = 'none'; });
if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => {});

db.inbox.slice().reverse().forEach(it => askInbox(it, true)); // o que estava esperando o Sim dele entra no Cérebro
render();
tick();
if (db.settings.apiKey) setTimeout(() => readAll(false), 1500);
setTimeout(() => { if (db.settings.brain !== false && Date.now() - (db.brain.at || 0) > 20 * 60e3) brainThink(); }, 8000);
