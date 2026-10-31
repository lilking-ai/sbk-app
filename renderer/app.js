// SBK app: renderer logic (bundled with esbuild)
import { initializeApp } from 'firebase/app';
import {
  getAuth, onAuthStateChanged, createUserWithEmailAndPassword, signInWithEmailAndPassword,
  sendEmailVerification, sendPasswordResetEmail, signOut, updateProfile,
} from 'firebase/auth';
import {
  getFirestore, doc, getDoc, setDoc, updateDoc, deleteDoc, addDoc, collection, query, orderBy,
  limit, onSnapshot, serverTimestamp, where,
} from 'firebase/firestore';
import { firebaseConfig, CHANNELS, LINKS, CLAN_RULES } from './config.js';

const $ = (id) => document.getElementById(id);
const show = (id) => ['rules', 'auth', 'gate', 'main'].forEach((s) => $(s).classList.toggle('hidden', s !== id));
// roles use Fortnite rarity tiers: Founder = Legendary, Leader = Epic, Member = Rare
const ROLE = {
  founder: { label: 'Founder', tier: 'legendary', color: '#FFB547' },
  leader: { label: 'Leader', tier: 'epic', color: '#D17BFF' },
  member: { label: 'Member', tier: 'rare', color: '#5CB8FF' },
  bot: { label: 'Bot', tier: 'bot', color: '#FFE03A' },
};
const BOT_NAME = 'SBK Bot';
const tile = (r, name, cls = '') => `<div class="av t-${r.tier} ${cls}">${r.tier === 'bot' ? '⚡' : esc(initials(name))}</div>`;
const BAD = ['fuck', 'shit', 'bitch', 'cunt', 'dick', 'pussy', 'nigg', 'fag', 'retard', 'whore', 'slut'];

let fb, auth, db, me = null, profile = null, current = 'general', unsubMsgs = null, unsubUsers = null, users = {};
let pendingImage = null, recorder = null, recChunks = [], recStart = 0, recTimer = null;
let events = [], botCmds = [], botConfig = {}, unsubEvents = null, unsubBot = [];

// ---------- helpers ----------
function toast(html, ms = 4000) {
  const t = $('toast'); t.innerHTML = html; t.classList.remove('hidden');
  clearTimeout(t._h); if (ms) t._h = setTimeout(() => t.classList.add('hidden'), ms);
  return t;
}
function esc(s) { return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function clean(s) {
  let out = s;
  for (const w of BAD) out = out.replace(new RegExp(w + '\\w*', 'gi'), (m) => m[0] + '*'.repeat(m.length - 1));
  return out;
}
function linkify(s) { return esc(s).replace(/https:\/\/[^\s<]+/g, (u) => `<a href="#" data-url="${u}">${u}</a>`); }
function colorFor(p) { return (ROLE[p?.role] || ROLE.member).color; }
function initials(n) { return (n || '?').trim().slice(0, 2).toUpperCase(); }
function timeStr(ts) {
  if (!ts?.toDate) return 'now';
  const d = ts.toDate(); const today = new Date().toDateString() === d.toDateString();
  return (today ? '' : d.toLocaleDateString() + ' ') + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}
const isStaff = () => profile && profile.status === 'member' && ['founder', 'leader'].includes(profile.role);
function friendly(e) {
  const c = e?.code || '';
  if (c.includes('invalid-credential') || c.includes('wrong-password') || c.includes('user-not-found')) return 'Wrong email or password.';
  if (c.includes('email-already-in-use')) return 'That email already has an account. Sign in instead.';
  if (c.includes('weak-password')) return 'Password needs at least 8 characters.';
  if (c.includes('invalid-email')) return 'That email doesn\'t look right.';
  if (c.includes('too-many-requests')) return 'Too many tries. Wait a minute and try again.';
  if (c.includes('permission-denied')) return 'Not allowed. (If you were just timed out, wait it out. Founder: make sure the latest SBK rules are published.)';
  if (c.includes('network')) return 'No internet connection.';
  return e?.message || 'Something went wrong.';
}

// ---------- boot ----------
document.addEventListener('click', (e) => {
  const a = e.target.closest('[data-url]');
  if (a) { e.preventDefault(); window.sbk.openExternal(a.dataset.url); }
});

// ---------- clan rules (must read before sign in) ----------
const RULES_KEY = 'sbk_rules_read_v1';
$('rules-list').innerHTML = CLAN_RULES.map(([t, d]) => `<li><b>${esc(t)}</b><span>${esc(d)}</span></li>`).join('');
function rulesScrolled() {
  const l = $('rules-list');
  if (l.scrollHeight - l.scrollTop - l.clientHeight < 12) {
    $('rules-ok').disabled = false; $('rules-ok-text').textContent = "I read all the rules and I'll follow them";
  }
}
$('rules-list').addEventListener('scroll', rulesScrolled);
$('rules-ok').onchange = () => { $('rules-go').disabled = !$('rules-ok').checked; };
$('rules-go').onclick = () => { localStorage.setItem(RULES_KEY, '1'); show('auth'); };
$('see-rules').onclick = (e) => { e.preventDefault(); showRules(); };
function showRules() {
  show('rules'); $('rules-list').scrollTop = 0;
  $('rules-ok').checked = false; $('rules-ok').disabled = true; $('rules-go').disabled = true;
  $('rules-ok-text').textContent = 'Scroll to the bottom of the rules first';
  setTimeout(rulesScrolled, 50); // short screens: no scrolling needed
}
const showSignedOut = () => (localStorage.getItem(RULES_KEY) ? show('auth') : showRules());

let signingUp = false;
(async function boot() {
  await window.SBKIntro.play();
  if (!firebaseConfig.apiKey) {
    show('gate');
    $('gate-title').textContent = 'Almost ready';
    $('gate-text').textContent = 'The SBK server isn\'t connected yet. The Founder needs to finish setup.';
    ['gate-refresh', 'gate-signout', 'claim-founder'].forEach((i) => $(i).classList.add('hidden'));
    return;
  }
  fb = initializeApp(firebaseConfig);
  auth = getAuth(fb);
  db = getFirestore(fb);
  onAuthStateChanged(auth, (u) => { me = u; if (!signingUp) route(); });
})();

async function route(justSignedUp = false) {
  if (!me) { cleanup(); showSignedOut(); return; }
  const ref = doc(db, 'users', me.uid);
  let snap = await getDoc(ref).catch(() => null);
  if (!snap || !snap.exists()) {
    if (!localStorage.getItem(RULES_KEY)) { showRules(); return; }
    show('auth');
    document.querySelector('.tab[data-tab=signup]').click();
    $('su-email').value = me.email || ''; $('su-email').disabled = true;
    $('su-pass').required = false; $('su-pass').classList.add('hidden');
    $('auth-msg').className = 'msg ok'; $('auth-msg').textContent = 'No clan profile on this account yet. Fill in your name, Epic and age to apply.';
    return;
  }
  profile = { id: me.uid, ...snap.data() };
  // the Founder's account promotes itself (the server rules only allow this for the Founder's email)
  if (profile.role !== 'founder' && profile.status !== 'banned') {
    try { await updateDoc(ref, { status: 'member', role: 'founder' }); profile = { ...profile, status: 'member', role: 'founder' }; } catch { /* not the Founder */ }
  }
  if (profile.status === 'banned') { show('gate'); gate('Banned', 'You were removed from SBK. Talk to the Founder if you think this is a mistake.'); return; }
  if (profile.status !== 'member') {
    show('gate');
    gate('Waiting for approval ⏳', `Thanks for joining, ${profile.name}! The Founder or a Leader has to approve you before you can chat. Check back soon.`);
    return;
  }
  // first time as an approved member: welcome cinematic
  const key = 'sbk_welcomed_' + me.uid;
  if (!localStorage.getItem(key)) { localStorage.setItem(key, '1'); await window.SBKIntro.play({ welcome: true, name: profile.name }); }
  startMain();
}

function gate(title, text) {
  $('gate-title').textContent = title; $('gate-text').textContent = text; $('gate-msg').textContent = '';
  ['gate-refresh', 'gate-signout'].forEach((i) => $(i).classList.remove('hidden'));
}
$('gate-refresh').onclick = async () => { await me?.reload().catch(() => {}); await me?.getIdToken(true).catch(() => {}); route(); };
$('gate-signout').onclick = () => signOut(auth);
$('claim-founder').onclick = async (e) => {
  e.preventDefault();
  const gm = $('gate-msg'); gm.className = 'msg'; gm.textContent = 'Checking...';
  try {
    await me.reload(); me = auth.currentUser;
    if (!me.emailVerified) {
      await sendEmailVerification(me).catch(() => {});
      gm.textContent = `Confirm your email first. We just sent a link to ${me.email}. Click it (check spam too), then press this button again.`;
      return;
    }
    await me.getIdToken(true);
    await updateDoc(doc(db, 'users', me.uid), { status: 'member', role: 'founder' });
    $('gate-msg').className = 'msg ok'; $('gate-msg').textContent = 'Founder confirmed 👑';
    setTimeout(route, 700);
  } catch (err) { $('gate-msg').className = 'msg'; $('gate-msg').textContent = 'Only the Founder\'s email can do this (and it must be confirmed from the email we sent).'; }
};

// ---------- auth ----------
document.querySelectorAll('.tab').forEach((b) => (b.onclick = () => {
  document.querySelectorAll('.tab').forEach((x) => x.classList.toggle('active', x === b));
  $('signin-form').classList.toggle('hidden', b.dataset.tab !== 'signin');
  $('signup-form').classList.toggle('hidden', b.dataset.tab !== 'signup');
  $('auth-msg').textContent = '';
}));

$('signin-form').onsubmit = async (e) => {
  e.preventDefault(); $('auth-msg').textContent = '';
  try { await signInWithEmailAndPassword(auth, $('si-email').value.trim(), $('si-pass').value); }
  catch (err) { $('auth-msg').textContent = friendly(err); }
};
$('forgot').onclick = async (e) => {
  e.preventDefault();
  const em = $('si-email').value.trim();
  if (!em) { $('auth-msg').textContent = 'Type your email first.'; return; }
  try { await sendPasswordResetEmail(auth, em); $('auth-msg').className = 'msg ok'; $('auth-msg').textContent = 'Reset email sent!'; }
  catch (err) { $('auth-msg').className = 'msg'; $('auth-msg').textContent = friendly(err); }
};

$('signup-form').onsubmit = async (e) => {
  e.preventDefault(); const m = $('auth-msg'); m.className = 'msg'; m.textContent = '';
  const age = parseInt($('su-age').value, 10);
  if (!(age >= 13)) { m.textContent = 'Sorry, you must be at least 13 to join SBK (Discord-style rule).'; return; }
  const name = clean($('su-name').value.trim()).slice(0, 24);
  const epic = $('su-epic').value.trim().slice(0, 32);
  if (name.length < 2) { m.textContent = 'Pick a longer display name.'; return; }
  signingUp = true;
  try {
    const user = auth.currentUser || (await createUserWithEmailAndPassword(auth, $('su-email').value.trim(), $('su-pass').value)).user;
    me = user;
    await updateProfile(user, { displayName: name }).catch(() => {});
    await setDoc(doc(db, 'users', user.uid), { name, epic, status: 'pending', role: 'member', createdAt: serverTimestamp() });
    await setDoc(doc(db, 'private', user.uid), { age, createdAt: serverTimestamp() }).catch(() => {});
    if (!user.emailVerified) sendEmailVerification(user).catch(() => {});
    $('su-email').disabled = false; $('su-pass').classList.remove('hidden'); $('su-pass').required = true;
    await window.SBKIntro.play({ welcome: true, name });
    m.className = 'msg ok'; m.textContent = 'Account created! Check your email ⚡';
    signingUp = false; route(true);
  } catch (err) { signingUp = false; m.className = 'msg'; m.textContent = friendly(err); }
};

// ---------- main ----------
function cleanup() { unsubMsgs?.(); unsubUsers?.(); unsubMsgs = unsubUsers = null; stopWatchers(); unsubWins?.(); unsubWins = null; unsubEvents?.(); unsubEvents = null; unsubBot.forEach((u) => u()); unsubBot = []; }

function startMain() {
  show('main');
  renderChannels();
  renderMe();
  $('pending-count').classList.add('hidden');
  document.querySelectorAll('.staff-only').forEach((x) => x.classList.toggle('hidden', !isStaff()));
  unsubUsers?.();
  unsubUsers = onSnapshot(collection(db, 'users'), (s) => {
    const old = users; users = {}; s.forEach((d) => (users[d.id] = { id: d.id, ...d.data(), _age: old[d.id]?._age }));
    if (!users[me.uid]) return route(); // kicked
    profile = users[me.uid]; if (profile.status !== 'member') return route();
    renderMembers(); renderStaff(); renderMe(); applyMute();
  });
  renderHub();
  clearInterval(hubTimer); tickCountdown(); hubTimer = setInterval(tickCountdown, 20000);
  startWatchers(); watchWins(); renderHype(); watchEvents(); watchBot();
  openChannel(current);
  setPanel('hub');
}

function renderChannels() {
  $('channels').innerHTML = CHANNELS.map((c) => `<button class="ch ${c.id === current ? 'active' : ''} ${c.id !== current && isUnread(c.id) ? 'unread' : ''}" data-ch="${c.id}"><span class="ic">${c.icon}</span>${c.name}${c.id !== current && isUnread(c.id) ? '<span class="dot" aria-label="new messages"></span>' : ''}</button>`).join('');
  document.querySelectorAll('.ch').forEach((b) => (b.onclick = () => openChannel(b.dataset.ch)));
}

function renderMe() {
  if (!profile) return;
  const r = ROLE[profile.role] || ROLE.member;
  $('me').innerHTML = `${tile(r, profile.name)}
    <div class="info"><b>${esc(profile.name)}</b><span class="tier-label t-${r.tier}">${r.label}</span></div>
    <button title="Sign out" id="so">⏻</button>`;
  $('so').onclick = () => signOut(auth);
}

function openChannel(id) {
  current = id; markRead(id);
  const ch = CHANNELS.find((c) => c.id === id);
  $('ch-title').textContent = ch.name.replace(/-/g, ' ');
  $('ch-desc').textContent = ch.desc;
  $('msg-input').placeholder = ch.staffOnly && !isStaff() ? 'Only staff can post here' : `Message #${ch.name}`;
  $('msg-input').disabled = !!(ch.staffOnly && !isStaff());
  applyMute();
  renderChannels();
  unsubMsgs?.();
  $('messages').innerHTML = '<div class="sys">Loading…</div>';
  const q = query(collection(db, 'channels', id, 'messages'), orderBy('createdAt', 'desc'), limit(100));
  unsubMsgs = onSnapshot(q, (s) => {
    const list = []; s.forEach((d) => list.push({ id: d.id, ...d.data() }));
    renderMessages(list.reverse());
  }, (err) => { $('messages').innerHTML = `<div class="sys">${esc(friendly(err))}</div>`; });
}

function renderMessages(list) {
  const box = $('messages');
  if (list.length) markRead(current, list[list.length - 1]);
  const atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 80;
  if (!list.length) {
    box.innerHTML = `<div class="empty"><img src="assets/logo.png" alt=""><p>Nothing here yet. Say something and start the storm ⚡</p></div>`;
    return;
  }
  box.innerHTML = list.map((m, i) => {
    const p = m.bot ? { role: 'bot', name: BOT_NAME } : (users[m.uid] || { role: m.role, name: m.name });
    const r = ROLE[p.role] || ROLE.member;
    const canDel = isStaff() || m.uid === me.uid;
    const prev = list[i - 1];
    const ms = (x) => (x?.createdAt?.toMillis ? x.createdAt.toMillis() : Date.now());
    const cont = prev && prev.uid === m.uid && !!prev.bot === !!m.bot && ms(m) - ms(prev) < 5 * 60 * 1000;
    const nm = p.name || m.name;
    return `<div class="m ${cont ? 'cont' : ''}" data-id="${m.id}">
      ${cont ? `<span class="gutter-time">${timeStr(m.createdAt).split(' ').slice(-2).join(' ')}</span>` : tile(r, nm)}
      <div class="body">
        ${cont ? '' : `<div class="top"><span class="name ${!m.bot && canMod(users[m.uid]) ? 'modable' : ''}" data-uid="${m.bot ? '' : m.uid}" style="color:${r.color}">${esc(nm)}${p.role === 'founder' ? ' <span class="crown" title="Founder">👑</span>' : ''}</span>
          <span class="badge t-${r.tier}">${r.label}</span>
          <span class="time">${timeStr(m.createdAt)}</span></div>`}
        ${m.text ? `<div class="text">${linkify(clean(m.text))}</div>` : ''}
        ${m.image ? `<img class="shot" src="${m.image}" alt="screenshot">` : ''}
      </div>
      <div class="acts">${m.uid !== me.uid && !m.bot ? '<button data-act="report">🚩 Report</button>' : ''}${!m.bot && canMod(users[m.uid]) ? '<button data-act="mod">🛡️ Mod</button>' : ''}${canDel ? '<button data-act="del">🗑️</button>' : ''}</div>
    </div>${botReplyFor(m)}`;
  }).join('');
  box.querySelectorAll('.name.modable').forEach((n) => (n.onclick = (e) => modMenu(n.dataset.uid, e.currentTarget)));
  box.querySelectorAll('img.shot').forEach((im) => (im.onclick = () => {
    const lb = document.createElement('div'); lb.className = 'lightbox'; lb.innerHTML = `<img src="${im.src}">`;
    lb.onclick = () => lb.remove(); document.body.appendChild(lb);
  }));
  box.querySelectorAll('[data-act]').forEach((b) => (b.onclick = async () => {
    const id = b.closest('.m').dataset.id;
    if (b.dataset.act === 'mod') { modMenu(list.find((x) => x.id === id).uid, b); return; }
    if (b.dataset.act === 'del') {
      if (confirmBox('Delete this message?')) await deleteDoc(doc(db, 'channels', current, 'messages', id)).catch((e) => toast(friendly(e)));
    } else {
      const msg = list.find((x) => x.id === id);
      await addDoc(collection(db, 'reports'), {
        reporter: me.uid, reporterName: profile.name, channel: current, messageId: id,
        author: msg.uid, authorName: msg.name, text: (msg.text || '').slice(0, 300), createdAt: serverTimestamp(),
      }).then(() => toast('🚩 Reported. Only staff can see reports. Thank you.')).catch((e) => toast(friendly(e)));
    }
  }));
  if (atBottom || box.dataset.first !== current) { box.scrollTop = box.scrollHeight; box.dataset.first = current; }
}

function confirmBox(text) { return window.confirm(text); }

$('composer').onsubmit = async (e) => {
  e.preventDefault();
  const text = $('msg-input').value.trim();
  if (!text && !pendingImage) return;
  if (text.startsWith('/') && !pendingImage) { $('msg-input').value = ''; runSlash(text); return; }
  if (mutedLeft() > 0) { toast(`⏱️ You're timed out until ${untilStr(profile.mutedUntil)}.`); return; }
  const data = { uid: me.uid, name: profile.name, role: profile.role, text: text.slice(0, 1000), createdAt: serverTimestamp() };
  if (pendingImage) data.image = pendingImage;
  $('msg-input').value = ''; clearAttach();
  await addDoc(collection(db, 'channels', current, 'messages'), data).catch((err) => toast(friendly(err)));
};

// ---------- panels ----------
document.querySelectorAll('[data-panel]').forEach((b) => (b.onclick = () => setPanel(b.dataset.panel)));
function setPanel(p) {
  ['hub', 'members', 'staff', 'bot'].forEach((x) => $('panel-' + x).classList.toggle('hidden', x !== p));
  if (p === 'bot') renderBot();
  document.querySelectorAll('[data-panel]').forEach((b) => b.classList.toggle('on', b.dataset.panel === p));
}

// ---------- cups, tournaments and events (staff add them, everyone sees them) ----------
const EVENT_TYPES = { cup: '🏆 Cup', tournament: '🎯 Tournament', war: '⚔️ Clan war', coaching: '🎓 Coaching', other: '🎉 Event' };
const evAt = (e) => (e.at?.toDate ? e.at.toDate() : new Date(e.at));
const evWhen = (e) => evAt(e).toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
function upcoming() { const cut = Date.now() - 3 * 3600e3; return events.filter((e) => evAt(e).getTime() > cut).sort((a, b) => evAt(a) - evAt(b)); }
const nextEvent = () => upcoming()[0] || null;
function watchEvents() {
  unsubEvents?.();
  unsubEvents = onSnapshot(query(collection(db, 'events'), orderBy('at', 'asc'), limit(50)), (s) => {
    events = []; s.forEach((d) => events.push({ id: d.id, ...d.data() }));
    renderHub(); tickCountdown();
  }, () => {});
}
let hubTimer = null;
function tickCountdown() {
  const el = $('cd'); if (!el) return;
  const ev = nextEvent(); if (!ev) return;
  const ms = evAt(ev) - new Date();
  if (ms <= 0) { el.innerHTML = '<span class="live">Live now</span>'; return; }
  const d = Math.floor(ms / 864e5), h = Math.floor(ms / 36e5) % 24, m = Math.floor(ms / 6e4) % 60;
  el.innerHTML = (d ? `<b>${d}</b><i>d</i>` : '') + `<b>${h}</b><i>h</i><b>${String(m).padStart(2, '0')}</b><i>m</i>`;
}
let evFormOpen = false;
function renderHub() {
  const list = upcoming(); const ev = list[0];
  const keepForm = evFormOpen && $('ev-form') ? collectEventForm() : null;
  $('panel-hub').innerHTML = `
    ${ev ? `<div class="next">
      <div class="next-label">Next up: ${EVENT_TYPES[ev.type] || EVENT_TYPES.other}</div>
      <div class="next-title">${esc(ev.title)}</div>
      <div class="cd" id="cd"></div>
      <div class="next-when">${evWhen(ev)}${ev.prize ? `<br>Prize: ${esc(ev.prize)}` : ''}</div>
      ${ev.link ? `<button class="btn gold next-btn" data-url="${esc(ev.link)}">Sign up</button>` : ''}
    </div>` : `<div class="next none"><div class="next-title">No cups or tournaments yet</div>
      <div class="next-when">${isStaff() ? 'Add one below and the whole clan gets a countdown.' : 'When staff add one, it shows up here with a countdown.'}</div></div>`}
    ${isStaff() ? `<button class="btn add-ev" id="add-ev">${evFormOpen ? 'Close' : '＋ Add a cup or tournament'}</button>
      ${evFormOpen ? eventFormHtml() : ''}` : ''}
    ${list.length > 1 || (list.length && isStaff()) ? `<h3>Coming up</h3><div class="card">${list.map((e) => `<div class="ev ${e === ev ? 'is-next' : ''}">
      <span>${(EVENT_TYPES[e.type] || EVENT_TYPES.other).split(' ')[0]} ${esc(e.title)}</span><b>${evWhen(e)}</b>
      ${isStaff() ? `<button class="x-ev" data-delev="${e.id}" title="Remove">✕</button>` : ''}</div>`).join('')}</div>` : ''}
    <h3>Most wins this week</h3>
    <div class="card lb" id="lb"><p class="small muted">Loading…</p></div>
    <h3>Forms</h3>
    <div class="card">
      <button class="linkbtn" data-url="${LINKS.challenge}">⚔️ Clan war challenge (send to other clans)</button>
      <button class="linkbtn" data-url="${LINKS.staff}">🎓 Apply for Staff / Coach</button>
      <button class="linkbtn" data-url="${LINKS.report}">🛡️ Private report to the Founder</button>
      <button class="linkbtn" id="hub-rules">📜 Clan rules</button>
    </div>
    <h3>Capture</h3>
    <div class="card small muted">Press <b>F8</b> for a screenshot and <b>F9</b> to start or stop recording, even in-game.
      Screenshots go to <b>Pictures\\SBK</b>, recordings to <b>Videos\\SBK</b>.</div>`;
  $('hub-rules').onclick = () => rulesPopup();
  if (isStaff()) {
    $('add-ev').onclick = () => { evFormOpen = !evFormOpen; renderHub(); };
    if (evFormOpen) { if (keepForm) fillEventForm(keepForm); $('ev-form').onsubmit = saveEvent; $('ev-type').onchange = () => { if (!$('ev-title').dataset.touched) $('ev-title').value = defaultTitle(); }; $('ev-title').oninput = () => ($('ev-title').dataset.touched = '1'); }
    $('panel-hub').querySelectorAll('[data-delev]').forEach((b) => (b.onclick = () => {
      if (confirmBox('Remove this event?')) deleteDoc(doc(db, 'events', b.dataset.delev)).catch((e) => toast(friendly(e)));
    }));
  }
  renderWins();
  tickCountdown();
}
const defaultTitle = () => ({ cup: 'SBK Cup', tournament: 'SBK Tournament', war: 'Clan War', coaching: 'Coaching Night', other: 'SBK Event' }[$('ev-type')?.value || 'cup']);
function eventFormHtml() {
  const d = new Date(Date.now() + 864e5); const day = d.toISOString().slice(0, 10);
  return `<form class="card ev-form" id="ev-form">
    <label>Type<select id="ev-type">${Object.entries(EVENT_TYPES).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></label>
    <label>Name<input id="ev-title" maxlength="60" value="SBK Cup" required></label>
    <div class="row2"><label>Day<input id="ev-date" type="date" value="${day}" required></label>
    <label>Time<input id="ev-time" type="time" value="20:00" required></label></div>
    <label>Prize (optional)<input id="ev-prize" maxlength="60" placeholder="e.g. 1,000 V-Bucks or Leader role"></label>
    <label>Sign-up link (optional)<input id="ev-link" maxlength="300" placeholder="https://tally.so/..."></label>
    <label class="check"><input id="ev-announce" type="checkbox" checked> SBK Bot announces it in #announcements</label>
    <button class="btn gold" type="submit">Post it</button>
  </form>`;
}
const collectEventForm = () => ({ type: $('ev-type').value, title: $('ev-title').value, date: $('ev-date').value, time: $('ev-time').value, prize: $('ev-prize').value, link: $('ev-link').value, announce: $('ev-announce').checked });
function fillEventForm(v) { $('ev-type').value = v.type; $('ev-title').value = v.title; $('ev-date').value = v.date; $('ev-time').value = v.time; $('ev-prize').value = v.prize; $('ev-link').value = v.link; $('ev-announce').checked = v.announce; }
async function saveEvent(e) {
  e.preventDefault();
  const v = collectEventForm();
  const at = new Date(`${v.date}T${v.time}`);
  if (isNaN(at)) { toast('Pick a day and time.'); return; }
  const link = v.link.trim();
  if (link && !/^https:\/\//.test(link)) { toast('The sign-up link has to start with https://'); return; }
  const data = { type: v.type, title: v.title.trim().slice(0, 60) || defaultTitle(), at, createdBy: me.uid, createdAt: serverTimestamp() };
  if (v.prize.trim()) data.prize = v.prize.trim().slice(0, 60);
  if (link) data.link = link;
  try {
    await addDoc(collection(db, 'events'), data);
    if (v.announce) {
      const ev = { ...data, at };
      await botSay('announcements', `${(EVENT_TYPES[data.type] || EVENT_TYPES.other).split(' ')[0]} ${data.title} is ON! ${evWhen(ev)} (Cairo time).${data.prize ? ` Prize: ${data.prize}.` : ''} ${link ? 'Sign up with the button in the Hub ⚡' : 'Check the Hub for the countdown ⚡'}`);
    }
    evFormOpen = false; renderHub(); toast('🏆 Posted! Everyone can see it in the Hub.');
  } catch (err) { toast(friendly(err)); }
}
function rulesPopup() {
  document.querySelector('.lightbox')?.remove();
  const lb = document.createElement('div'); lb.className = 'lightbox';
  lb.innerHTML = `<div class="rules-pop"><h2>Clan rules</h2><ol class="rules-list">${CLAN_RULES.map(([t, d]) => `<li><b>${esc(t)}</b><span>${esc(d)}</span></li>`).join('')}</ol><p class="tiny muted">Click anywhere to close</p></div>`;
  lb.onclick = () => lb.remove(); document.body.appendChild(lb);
}

function memberRow(u, buttons = '') {
  const r = ROLE[u.role] || ROLE.member;
  const t = mutedLeft(u);
  return `<div class="mem t-${r.tier}">${tile(r, u.name)}
    <div class="nm">${esc(u.name)}${u.role === 'founder' ? ' 👑' : ''}${t > 0 ? ' <span class="to-badge" title="Timed out">⏱️ ' + untilStr(u.mutedUntil) + '</span>' : ''}<small>${esc(u.epic || 'No Epic name')}${u._age ? ', age ' + u._age : ''}</small></div>${buttons}</div>`;
}

function renderMembers() {
  const list = Object.values(users).filter((u) => u.status === 'member');
  const order = { founder: 0, leader: 1, member: 2 };
  list.sort((a, b) => (order[a.role] ?? 3) - (order[b.role] ?? 3) || a.name.localeCompare(b.name));
  $('panel-members').innerHTML = `<h3>The squad <span class="h-count">${list.length}</span></h3>` + list.map((u) => memberRow(u)).join('');
}

function renderStaff() {
  if (!isStaff()) { $('panel-staff').innerHTML = ''; return; }
  const pending = Object.values(users).filter((u) => u.status === 'pending');
  pending.forEach((u) => {
    if (u._age === undefined && !ageCache[u.id]) {
      ageCache[u.id] = getDoc(doc(db, 'private', u.id)).then((d) => { users[u.id] && (users[u.id]._age = d.data()?.age ?? null); renderStaff(); }).catch(() => {});
    } else if (users[u.id] && ageCache[u.id] && u._age === undefined) { /* loading */ }
  });
  const banned = Object.values(users).filter((u) => u.status === 'banned');
  const members = Object.values(users).filter((u) => u.status === 'member' && u.id !== me.uid && u.role !== 'founder');
  const pc = $('pending-count'); pc.textContent = pending.length; pc.classList.toggle('hidden', !pending.length);
  $('panel-staff').innerHTML = `
    <h3>Waiting for approval <span class="h-count">${pending.length}</span></h3>
    ${pending.map((u) => memberRow(u, `<button class="ok-btn" data-ok="${u.id}">✓</button><button class="no-btn" data-ban="${u.id}">✕</button>`)).join('') || '<p class="small muted">Nobody waiting.</p>'}
    ${pending.some((u) => u._age === 13) ? '<p class="tiny muted">Age 13 needs Founder approval.</p>' : ''}
    <h3>Manage members</h3>
    <p class="tiny muted">Tip: click anyone's name in chat to time out, kick or ban them.</p>
    ${members.map((u) => memberRow(u, canMod(u) ? `${profile.role === 'founder' ? `<button class="mid-btn" data-lead="${u.id}" title="${u.role === 'leader' ? 'Make Member' : 'Make Leader'}">${u.role === 'leader' ? '↓' : '★'}</button>` : ''}<button class="mid-btn" data-mod="${u.id}" title="Timeout, kick or ban">🛡️</button>` : '')).join('') || '<p class="small muted">No members yet.</p>'}
    ${banned.length ? `<h3>Banned</h3>${banned.map((u) => memberRow(u, `<button class="mid-btn" data-ok="${u.id}">Unban</button>`)).join('')}` : ''}
    <h3>Reports</h3><div id="reports"><p class="small muted">Loading…</p></div>`;
  $('panel-staff').querySelectorAll('[data-ok]').forEach((b) => (b.onclick = () => approve(b.dataset.ok)));
  $('panel-staff').querySelectorAll('[data-ban]').forEach((b) => (b.onclick = () => modAction('ban', b.dataset.ban)));
  $('panel-staff').querySelectorAll('[data-mod]').forEach((b) => (b.onclick = () => modMenu(b.dataset.mod, b)));
  $('panel-staff').querySelectorAll('[data-lead]').forEach((b) => (b.onclick = () => {
    const u = users[b.dataset.lead];
    updateDoc(doc(db, 'users', u.id), { role: u.role === 'leader' ? 'member' : 'leader' }).catch((e) => toast(friendly(e)));
  }));
  loadReports();
}

async function approve(uid) {
  const u = users[uid];
  if (u._age === 13 && profile.role !== 'founder') { toast('Age 13 needs the Founder to approve.'); return; }
  try {
    await updateDoc(doc(db, 'users', uid), { status: 'member' });
    await botSay('general', (botConfig.welcome || DEFAULT_WELCOME).replace(/\{name\}/g, u.name));
  } catch (e) { toast(friendly(e)); }
}

let unsubReports = null;
const ageCache = {};
function loadReports() {
  unsubReports?.();
  unsubReports = onSnapshot(query(collection(db, 'reports'), orderBy('createdAt', 'desc'), limit(30)), (s) => {
    const el = $('reports'); if (!el) return;
    const rs = []; s.forEach((d) => rs.push({ id: d.id, ...d.data() }));
    el.innerHTML = rs.map((r) => `<div class="card small"><b>${esc(r.authorName)}</b> reported by ${esc(r.reporterName)} in #${esc(r.channel)}
      <div class="muted" style="margin:6px 0">"${esc(r.text || '[image]')}"</div>
      <button class="mid-btn" data-done="${r.id}">Done</button></div>`).join('') || '<p class="small muted">No reports. 🙌</p>';
    el.querySelectorAll('[data-done]').forEach((b) => (b.onclick = () => deleteDoc(doc(db, 'reports', b.dataset.done))));
  }, () => {});
}

// ---------- unread, pings and notifications ----------
const msOf = (m) => (m?.createdAt?.toMillis ? m.createdAt.toMillis() : Date.now());
const readKey = (ch) => `sbk_read_${me?.uid}_${ch}`;
const latest = {}; // newest message per channel
let watchers = [];
function isUnread(ch) {
  const l = latest[ch]; if (!l || l.uid === me?.uid) return false;
  return msOf(l) > +(localStorage.getItem(readKey(ch)) || 0);
}
function markRead(ch, m = latest[ch]) {
  if (m) localStorage.setItem(readKey(ch), String(Math.max(msOf(m), +(localStorage.getItem(readKey(ch)) || 0))));
}
function stopWatchers() { watchers.forEach((u) => u()); watchers = []; }
function startWatchers() {
  stopWatchers();
  CHANNELS.forEach((c) => {
    let first = true; const seen = new Set();
    watchers.push(onSnapshot(query(collection(db, 'channels', c.id, 'messages'), orderBy('createdAt', 'desc'), limit(1)), (s) => {
      let m = null; s.forEach((d) => (m = { id: d.id, ...d.data() }));
      latest[c.id] = m;
      if (first) { first = false; if (m) seen.add(m.id); if (m && !localStorage.getItem(readKey(c.id))) markRead(c.id, m); renderChannels(); return; }
      // wait for the server time on new messages, and handle each message once
      if (!m || !m.createdAt || seen.has(m.id)) { renderChannels(); return; }
      seen.add(m.id);
      if (c.id === current && document.hasFocus()) markRead(c.id, m);
      renderChannels();
      if (m.uid !== me.uid && !m.bot) ping(c, m);
      if (c.id === 'wins' && !m.bot) victory(m);
    }, () => {}));
  });
}
const muted = () => localStorage.getItem('sbk_mute') === '1';
let actx = null;
function tone(notes, type = 'triangle', vol = 0.12) {
  if (muted()) return;
  try {
    actx = actx || new AudioContext();
    let t = actx.currentTime;
    for (const [f, d] of notes) {
      const o = actx.createOscillator(), g = actx.createGain();
      o.type = type; o.frequency.setValueAtTime(f, t);
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + d);
      o.connect(g).connect(actx.destination); o.start(t); o.stop(t + d + 0.02); t += d * 0.7;
    }
  } catch { /* audio not available */ }
}
function ping(ch, m) {
  const away = !document.hasFocus() || document.hidden;
  if (away || ch.id !== current) tone([[880, 0.09], [1320, 0.14]]);
  if (away && !muted() && 'Notification' in window) {
    try {
      const n = new Notification(`${m.name} in #${ch.name}`, { body: m.text ? m.text.slice(0, 120) : '📸 sent a screenshot', silent: true });
      n.onclick = () => { window.focus(); openChannel(ch.id); };
    } catch { /* notifications blocked */ }
  }
}

// ---------- victory royale ----------
function victory(m) {
  document.querySelector('.vr')?.remove();
  const el = document.createElement('div'); el.className = 'vr';
  const who = m.uid === me.uid ? 'You got the dub!' : `${esc(m.name)} got the dub!`;
  el.innerHTML = `<div class="vr-flash"></div><div class="vr-rays"></div>
    <div class="vr-text"><span class="vr-1">#1</span><span class="vr-2">Victory Royale</span><span class="vr-3">${who}</span></div>
    <div class="vr-hint">Click to close</div>`;
  for (let i = 0; i < 46; i++) {
    const c = document.createElement('i'); c.className = 'vr-bit';
    c.style.cssText = `left:${Math.random() * 100}%;animation-delay:${(Math.random() * 0.6).toFixed(2)}s;animation-duration:${(1.6 + Math.random() * 1.4).toFixed(2)}s;background:${['#FFE03A', '#B651FF', '#69C6FF', '#FFC75A', '#fff'][i % 5]};transform:rotate(${Math.random() * 360}deg)`;
    el.appendChild(c);
  }
  el.onclick = () => el.remove();
  document.body.appendChild(el);
  tone([[523, 0.14], [659, 0.14], [784, 0.14], [1047, 0.5]], 'square', 0.07);
  setTimeout(() => el.classList.add('out'), 3600);
  setTimeout(() => el.remove(), 4200);
}

// ---------- wins leaderboard ----------
let unsubWins = null;
function watchWins() {
  unsubWins?.();
  unsubWins = onSnapshot(query(collection(db, 'channels', 'wins', 'messages'), orderBy('createdAt', 'desc'), limit(200)), (s) => {
    const since = Date.now() - 7 * 864e5, count = {};
    s.forEach((d) => { const m = d.data(); if (m.createdAt && !m.bot && msOf(m) >= since) count[m.uid] = (count[m.uid] || 0) + 1; });
    winsTop = Object.entries(count).sort((a, b) => b[1] - a[1]).slice(0, 5);
    renderWins();
  }, () => {});
}
let winsTop = null;
function renderWins() {
  const el = $('lb'); if (!el || !winsTop) return;
  const top = winsTop; {
    el.innerHTML = top.length ? top.map(([uid, n], i) => {
      const u = users[uid] || { name: 'Someone', role: 'member' }; const r = ROLE[u.role] || ROLE.member;
      return `<div class="lb-row ${i === 0 ? 'lb-top' : ''}"><span class="lb-pos">${i + 1}</span>${tile(r, u.name)}<span class="lb-name">${esc(u.name)}</span><span class="lb-n">${n}<small>${n === 1 ? 'win' : 'wins'}</small></span></div>`;
    }).join('') : '<p class="small muted">No wins posted yet. Drop a Victory Royale screenshot in #wins to take #1.</p>';
  }
}

// ---------- quick hype bar ----------
const HYPE = ['GG', 'W', '🔥', '💀', '👑', '⚡', 'clutch', 'on my way'];
function renderHype() {
  const bar = $('hype'); if (!bar) return;
  bar.innerHTML = HYPE.map((h) => `<button type="button" data-h="${esc(h)}">${esc(h)}</button>`).join('') +
    `<button type="button" class="mute" id="mute" title="Sounds and alerts">${muted() ? '🔕' : '🔔'}</button>`;
  bar.querySelectorAll('[data-h]').forEach((b) => (b.onclick = () => {
    const i = $('msg-input'); if (i.disabled) return;
    i.value = (i.value.trim() ? i.value.trimEnd() + ' ' : '') + b.dataset.h; i.focus();
  }));
  $('mute').onclick = () => {
    localStorage.setItem('sbk_mute', muted() ? '0' : '1'); renderHype();
    toast(muted() ? '🔕 Sounds and alerts off' : '🔔 Sounds and alerts on', 1800);
  };
}
window.addEventListener('focus', () => { if (latest[current]) { markRead(current); renderChannels(); } });

// ---------- mod powers: timeout, kick, ban ----------
const tsMs = (t) => (t?.toMillis ? t.toMillis() : t instanceof Date ? t.getTime() : 0);
function mutedLeft(u = profile) { return Math.max(0, tsMs(u?.mutedUntil) - Date.now()); }
function untilStr(t) {
  const d = new Date(tsMs(t)); const today = d.toDateString() === new Date().toDateString();
  return (today ? '' : d.toLocaleDateString([], { weekday: 'short' }) + ' ') + d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}
function canMod(u) {
  if (!u || !isStaff() || u.id === me.uid || u.role === 'founder') return false;
  return profile.role === 'founder' || u.role === 'member';
}
let muteTimer = null;
function applyMute() {
  if (!profile || !$('msg-input')) return;
  clearTimeout(muteTimer);
  const ch = CHANNELS.find((c) => c.id === current);
  const left = mutedLeft();
  if (left > 0) {
    $('msg-input').disabled = true; $('msg-input').placeholder = `⏱️ You're timed out until ${untilStr(profile.mutedUntil)}`;
    muteTimer = setTimeout(applyMute, Math.min(left + 500, 2 ** 31 - 1));
  } else {
    $('msg-input').disabled = !!(ch?.staffOnly && !isStaff());
    $('msg-input').placeholder = ch?.staffOnly && !isStaff() ? 'Only staff can post here' : `Message #${ch?.name}`;
  }
}
const TIMEOUTS = [['5 min', 5], ['10 min', 10], ['1 hour', 60], ['1 day', 1440], ['1 week', 10080]];
function modMenu(uid, anchor) {
  const u = users[uid]; const menu = $('modmenu');
  if (!canMod(u)) return;
  const r = ROLE[u.role] || ROLE.member;
  menu.innerHTML = `<div class="mm-head">${tile(r, u.name)}<div><b>${esc(u.name)}</b><small>${esc(u.epic || '')}</small></div></div>
    <div class="mm-label">Time out</div>
    <div class="mm-row">${TIMEOUTS.map(([l, m]) => `<button data-to="${m}">${l}</button>`).join('')}</div>
    ${mutedLeft(u) > 0 ? `<button class="mm-btn" data-act="untimeout">✅ End timeout (until ${untilStr(u.mutedUntil)})</button>` : ''}
    <button class="mm-btn warn" data-act="kick">👢 Kick from clan <small>they can apply again</small></button>
    <button class="mm-btn danger" data-act="ban">🔨 Ban <small>blocked for good</small></button>`;
  menu.classList.remove('hidden');
  const b = anchor.getBoundingClientRect();
  const x = Math.min(b.left, window.innerWidth - menu.offsetWidth - 12), y = b.bottom + 6 + menu.offsetHeight > window.innerHeight ? b.top - menu.offsetHeight - 6 : b.bottom + 6;
  menu.style.left = Math.max(8, x) + 'px'; menu.style.top = Math.max(8, y) + 'px';
  menu.querySelectorAll('[data-to]').forEach((x) => (x.onclick = () => { closeMod(); modAction('timeout', uid, +x.dataset.to); }));
  menu.querySelectorAll('[data-act]').forEach((x) => (x.onclick = () => { closeMod(); modAction(x.dataset.act, uid); }));
  setTimeout(() => document.addEventListener('click', closeModOutside), 0);
}
function closeMod() { $('modmenu').classList.add('hidden'); document.removeEventListener('click', closeModOutside); }
function closeModOutside(e) { if (!e.target.closest('#modmenu')) closeMod(); }
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeMod(); });
const durStr = (m) => (m >= 1440 ? `${Math.round(m / 1440)} day${m >= 2880 ? 's' : ''}` : m >= 60 ? `${Math.round(m / 60)} hour${m >= 120 ? 's' : ''}` : `${m} min`);
async function modAction(act, uid, mins, quiet = false) {
  const u = users[uid];
  if (!canMod(u)) { toast(u ? `You can't do that to ${esc(u.name)}.` : 'No one in the clan with that name.'); return false; }
  const ref = doc(db, 'users', uid);
  try {
    if (act === 'timeout') {
      await updateDoc(ref, { mutedUntil: new Date(Date.now() + mins * 60000) });
      if (!quiet) await botSay(current, `⏱️ ${u.name} was timed out for ${durStr(mins)}.`);
    } else if (act === 'untimeout') {
      await updateDoc(ref, { mutedUntil: new Date(0) });
      if (!quiet) await botSay(current, `✅ ${u.name}'s timeout is over. Behave 😤`);
    } else if (act === 'kick') {
      if (!confirmBox(`Kick ${u.name} from SBK? They'll have to apply again.`)) return false;
      await deleteDoc(ref);
      if (!quiet) await botSay(current, `👢 ${u.name} was kicked from the clan.`);
    } else if (act === 'ban') {
      if (!confirmBox(`Ban ${u.name} from SBK for good?`)) return false;
      await updateDoc(ref, { status: 'banned' });
      if (!quiet) await botSay(current, `🔨 ${u.name} was banned.`);
    } else if (act === 'unban') {
      await updateDoc(ref, { status: 'member' });
      if (!quiet) await botSay(current, `🕊️ ${u.name} was unbanned.`);
    }
    return true;
  } catch (e) { toast(friendly(e)); return false; }
}

// ---------- SBK Bot: staff tell it what to do ----------
const DEFAULT_WELCOME = '⚡ Welcome to the storm, {name}! Read the rules (type !rules) and say hi 👋';
function botSay(ch, text) {
  return addDoc(collection(db, 'channels', ch, 'messages'), {
    uid: me.uid, name: BOT_NAME, role: 'bot', bot: true, text: String(text).slice(0, 1000), createdAt: serverTimestamp(),
  });
}
function watchBot() {
  unsubBot.forEach((u) => u()); unsubBot = [];
  unsubBot.push(onSnapshot(collection(db, 'botcmds'), (s) => {
    botCmds = []; s.forEach((d) => botCmds.push({ id: d.id, ...d.data() }));
    botCmds.sort((a, b) => a.trigger.localeCompare(b.trigger));
    if (!$('panel-bot').classList.contains('hidden')) renderBot();
  }, () => {}));
  unsubBot.push(onSnapshot(doc(db, 'bot', 'config'), (d) => { botConfig = d.exists() ? d.data() : {}; }, () => {}));
}
// "!command" messages get a bot reply right under them (worked out on each PC, nothing extra is saved)
function botAnswer(text) {
  const mt = /^!([a-z0-9_-]{1,20})\b/i.exec((text || '').trim()); if (!mt) return null;
  const t = mt[1].toLowerCase();
  if (t === 'rules') return '📜 SBK rules:\n' + CLAN_RULES.map(([a, b], i) => `${i + 1}. ${a}: ${b}`).join('\n');
  if (t === 'next' || t === 'cup') { const e = nextEvent(); return e ? `${(EVENT_TYPES[e.type] || EVENT_TYPES.other).split(' ')[0]} Next up: ${e.title}, ${evWhen(e)}${e.prize ? `. Prize: ${e.prize}` : ''}.` : 'No cups or tournaments scheduled yet. Stay tuned ⚡'; }
  if (t === 'commands' || t === 'help') return 'Try: !rules, !next' + (botCmds.length ? ', ' + botCmds.map((c) => '!' + c.trigger).join(', ') : '');
  const c = botCmds.find((x) => x.trigger === t);
  return c ? c.reply : null;
}
function botReplyFor(m) {
  if (m.bot || !m.text) return '';
  const a = botAnswer(m.text); if (!a) return '';
  return `<div class="m bot-reply">${tile(ROLE.bot, BOT_NAME)}<div class="body"><div class="top"><span class="name" style="color:${ROLE.bot.color}">${BOT_NAME}</span><span class="badge t-bot">Bot</span></div><div class="text">${linkify(a)}</div></div></div>`;
}
function renderBot() {
  if (!isStaff()) { $('panel-bot').innerHTML = ''; return; }
  $('panel-bot').innerHTML = `
    <h3>Make SBK Bot say something</h3>
    <form class="card bot-form" id="bot-say">
      <label>Channel<select id="bot-ch">${CHANNELS.map((c) => `<option value="${c.id}" ${c.id === current ? 'selected' : ''}>${c.icon} ${c.name}</option>`).join('')}</select></label>
      <label>Message<textarea id="bot-text" maxlength="1000" rows="3" placeholder="e.g. Cup starts in 10 minutes, get in the lobby!" required></textarea></label>
      <button class="btn gold" type="submit">Send as SBK Bot</button>
    </form>
    <h3>Custom commands <span class="h-count">${botCmds.length}</span></h3>
    <div class="card">
      ${botCmds.map((c) => `<div class="cmd"><b>!${esc(c.trigger)}</b><span>${esc(c.reply)}</span><button class="x-ev" data-delcmd="${c.id}" title="Delete">✕</button></div>`).join('') || '<p class="small muted">No custom commands yet. When anyone types one, the bot answers.</p>'}
      <form class="bot-form add-cmd" id="bot-cmd">
        <label>Command (people type it with ! in front)<input id="cmd-trig" maxlength="20" placeholder="lobby" required></label>
        <label>Bot answers<textarea id="cmd-reply" maxlength="500" rows="2" placeholder="Party code is SBK123, join up!" required></textarea></label>
        <button class="btn" type="submit">Add command</button>
      </form>
    </div>
    <h3>Welcome message</h3>
    <form class="card bot-form" id="bot-welcome">
      <label>Sent in #general when you approve someone. {name} becomes their name.<textarea id="welcome-text" maxlength="300" rows="2">${esc(botConfig.welcome || DEFAULT_WELCOME)}</textarea></label>
      <button class="btn" type="submit">Save</button>
    </form>
    <h3>Staff commands</h3>
    <div class="card small cheat">
      <p>Type these in any chat box:</p>
      <code>/say message</code> bot talks here<br>
      <code>/announce message</code> bot posts in #announcements<br>
      <code>/timeout name 10m</code> also 1h, 1d, 1w<br>
      <code>/untimeout name</code><br>
      <code>/kick name</code> <code>/ban name</code> <code>/unban name</code><br>
      <code>/clear 10</code> deletes the last 10 messages here<br>
      <code>/help</code> shows this list
      <p class="muted">Everyone can use <code>!rules</code>, <code>!next</code> and your custom commands.</p>
    </div>`;
  $('bot-say').onsubmit = async (e) => {
    e.preventDefault(); const t = $('bot-text').value.trim(); if (!t) return;
    try { await botSay($('bot-ch').value, t); $('bot-text').value = ''; toast('⚡ SBK Bot sent it.', 1800); } catch (err) { toast(friendly(err)); }
  };
  $('bot-cmd').onsubmit = async (e) => {
    e.preventDefault();
    const trigger = $('cmd-trig').value.trim().replace(/^!/, '').toLowerCase();
    if (!/^[a-z0-9_-]{1,20}$/.test(trigger)) { toast('Commands can use letters, numbers, - and _ only.'); return; }
    if (['rules', 'next', 'cup', 'commands', 'help'].includes(trigger)) { toast(`!${trigger} is built in already.`); return; }
    try { await setDoc(doc(db, 'botcmds', trigger), { trigger, reply: $('cmd-reply').value.trim().slice(0, 500), by: me.uid }); toast(`✅ !${trigger} added.`, 1800); } catch (err) { toast(friendly(err)); }
  };
  $('bot-welcome').onsubmit = async (e) => {
    e.preventDefault();
    try { await setDoc(doc(db, 'bot', 'config'), { welcome: $('welcome-text').value.trim().slice(0, 300) || DEFAULT_WELCOME }, { merge: true }); toast('✅ Saved.', 1500); } catch (err) { toast(friendly(err)); }
  };
  $('panel-bot').querySelectorAll('[data-delcmd]').forEach((b) => (b.onclick = () => deleteDoc(doc(db, 'botcmds', b.dataset.delcmd)).catch((err) => toast(friendly(err)))));
}
function findUser(q) {
  q = (q || '').replace(/^@/, '').trim().toLowerCase(); if (!q) return null;
  const all = Object.values(users);
  return all.find((u) => u.name.toLowerCase() === q) || all.find((u) => (u.epic || '').toLowerCase() === q) || all.find((u) => u.name.toLowerCase().startsWith(q)) || null;
}
function parseDur(t) { const mt = /^(\d+)\s*(m|min|h|hr|d|w)?$/i.exec(t || ''); if (!mt) return 10; const n = +mt[1]; const u = (mt[2] || 'm')[0].toLowerCase(); return n * ({ m: 1, h: 60, d: 1440, w: 10080 }[u]); }
async function runSlash(text) {
  const [cmd, ...rest] = text.slice(1).split(/\s+/); const arg = rest.join(' ');
  const c = cmd.toLowerCase();
  if (c === 'help') { if (isStaff()) setPanel('bot'); else toast('Bot commands are for staff. Try typing !rules or !next.'); return; }
  if (!isStaff()) { toast('Only the Founder and Leaders can use / commands. Try !rules or !next.'); return; }
  try {
    if (c === 'say') { if (arg) await botSay(current, arg); return; }
    if (c === 'announce') { if (arg) { await botSay('announcements', '📢 ' + arg); toast('📢 Posted in #announcements.', 1800); } return; }
    if (c === 'clear') {
      const n = Math.min(50, Math.max(1, parseInt(arg, 10) || 10));
      const ids = [...$('messages').querySelectorAll('.m[data-id]')].slice(-n).map((x) => x.dataset.id);
      if (!ids.length || !confirmBox(`Delete the last ${ids.length} messages in #${current}?`)) return;
      await Promise.all(ids.map((id) => deleteDoc(doc(db, 'channels', current, 'messages', id))));
      toast(`🧹 Cleared ${ids.length} messages.`, 1800); return;
    }
    const acts = { timeout: 'timeout', mute: 'timeout', untimeout: 'untimeout', unmute: 'untimeout', kick: 'kick', ban: 'ban', unban: 'unban' };
    if (acts[c]) {
      const parts = rest; let dur = 10;
      if (acts[c] === 'timeout' && parts.length > 1 && /^\d+\s*[a-z]*$/i.test(parts[parts.length - 1])) dur = parseDur(parts.pop());
      const u = findUser(parts.join(' '));
      if (!u) { toast(`No one called "${esc(parts.join(' '))}" in the clan.`); return; }
      await modAction(acts[c], u.id, dur); return;
    }
    toast(`Unknown command /${esc(cmd)}. Type /help for the list.`);
  } catch (err) { toast(friendly(err)); }
}

// ---------- screenshots ----------
function shrink(dataUrl, maxW = 1100, q = 0.72) {
  return new Promise((res) => {
    const im = new Image();
    im.onload = () => {
      const s = Math.min(1, maxW / im.width);
      const c = document.createElement('canvas'); c.width = im.width * s; c.height = im.height * s;
      c.getContext('2d').drawImage(im, 0, 0, c.width, c.height);
      let out = c.toDataURL('image/jpeg', q);
      if (out.length > 850000) out = c.toDataURL('image/jpeg', 0.5);
      res(out);
    };
    im.src = dataUrl;
  });
}
async function onShot(r) {
  const small = await shrink(r.preview);
  const t = toast(`<b>📸 Screenshot saved</b><img src="${small}"><div class="row">
    <button class="btn gold" id="t-share">Share to #clips</button><button class="btn" id="t-attach">Attach here</button></div>`, 9000);
  t.querySelector('#t-share').onclick = async () => {
    t.classList.add('hidden');
    await addDoc(collection(db, 'channels', 'clips', 'messages'), { uid: me.uid, name: profile.name, role: profile.role, text: '', image: small, createdAt: serverTimestamp() })
      .then(() => toast('Shared to #clips 🎬')).catch((e) => toast(friendly(e)));
  };
  t.querySelector('#t-attach').onclick = () => { t.classList.add('hidden'); setAttach(small); };
}
function setAttach(img) { pendingImage = img; $('attach-img').src = img; $('attach').classList.remove('hidden'); $('msg-input').focus(); }
function clearAttach() { pendingImage = null; $('attach').classList.add('hidden'); }
$('attach-x').onclick = clearAttach;
$('btn-shot').onclick = async () => { try { onShot(await window.sbk.screenshot()); } catch (e) { toast('Screenshot failed: ' + e.message); } };
window.sbk.onScreenshot((r) => { if (profile?.status === 'member') onShot(r); });
$('btn-pics').onclick = () => window.sbk.openFolder('picture');
$('btn-vids').onclick = () => window.sbk.openFolder('video');

// ---------- recording ----------
async function toggleRecord() {
  if (recorder && recorder.state === 'recording') { recorder.stop(); return; }
  try {
    const stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 60 }, audio: true });
    const mime = MediaRecorder.isTypeSupported('video/webm;codecs=vp9') ? 'video/webm;codecs=vp9' : 'video/webm';
    recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 12_000_000 });
    recChunks = [];
    recorder.ondataavailable = (e) => e.data.size && recChunks.push(e.data);
    recorder.onstop = async () => {
      stream.getTracks().forEach((tr) => tr.stop());
      clearInterval(recTimer); $('rec-badge').classList.add('hidden'); $('btn-rec').innerHTML = '🔴 Record <kbd>F9</kbd>';
      window.sbk.recordingState(false);
      const buf = await new Blob(recChunks, { type: 'video/webm' }).arrayBuffer();
      const file = await window.sbk.saveRecording(new Uint8Array(buf));
      toast(`<b>🎥 Recording saved</b><br><span class="muted">${esc(file)}</span><div class="row" style="margin-top:8px"><button class="btn gold" id="t-open">Open folder</button></div>`, 8000)
        .querySelector('#t-open').onclick = () => window.sbk.openFolder('video');
    };
    recorder.start(1000);
    recStart = Date.now();
    $('rec-badge').classList.remove('hidden'); $('btn-rec').innerHTML = '⏹️ Stop recording <kbd>F9</kbd>';
    window.sbk.recordingState(true);
    recTimer = setInterval(() => {
      const s = Math.floor((Date.now() - recStart) / 1000);
      $('rec-time').textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    }, 500);
  } catch (e) { toast('Recording failed: ' + e.message); }
}
$('btn-rec').onclick = toggleRecord;
window.sbk.onToggleRecord(() => { if (profile?.status === 'member') toggleRecord(); });
