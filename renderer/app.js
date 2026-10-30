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
import { firebaseConfig, CHANNELS, LINKS, SCHEDULE } from './config.js';

const $ = (id) => document.getElementById(id);
const show = (id) => ['auth', 'gate', 'main'].forEach((s) => $(s).classList.toggle('hidden', s !== id));
const ROLE = {
  founder: { label: 'FOUNDER', color: '#FFD600' },
  leader: { label: 'LEADER', color: '#FF9F1A' },
  member: { label: 'MEMBER', color: '#5A8CFF' },
};
const BAD = ['fuck', 'shit', 'bitch', 'cunt', 'dick', 'pussy', 'nigg', 'fag', 'retard', 'whore', 'slut'];

let fb, auth, db, me = null, profile = null, current = 'general', unsubMsgs = null, unsubUsers = null, users = {};
let pendingImage = null, recorder = null, recChunks = [], recStart = 0, recTimer = null;

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
  if (c.includes('permission-denied')) return 'Blocked by the server rules. (Founder: make sure the SBK rules are published in Firestore → Rules.)';
  if (c.includes('network')) return 'No internet connection.';
  return e?.message || 'Something went wrong.';
}

// ---------- boot ----------
document.addEventListener('click', (e) => {
  const a = e.target.closest('[data-url]');
  if (a) { e.preventDefault(); window.sbk.openExternal(a.dataset.url); }
});

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
  if (!me) { cleanup(); show('auth'); return; }
  const ref = doc(db, 'users', me.uid);
  let snap = await getDoc(ref).catch(() => null);
  if (!snap || !snap.exists()) {
    show('auth');
    document.querySelector('.tab[data-tab=signup]').click();
    $('su-email').value = me.email || ''; $('su-email').disabled = true;
    $('su-pass').required = false; $('su-pass').classList.add('hidden');
    $('auth-msg').className = 'msg ok'; $('auth-msg').textContent = 'Almost done! Fill in your name, Epic and age to finish your profile.';
    return;
  }
  profile = { id: me.uid, ...snap.data() };
  if (profile.status === 'banned') { show('gate'); gate('Banned', 'You were removed from SBK. Talk to the Founder if you think this is a mistake.'); return; }
  if (profile.status !== 'member') {
    show('gate');
    gate('Waiting for approval ⏳', `Thanks for joining, ${profile.name}! A Founder or Leader has to approve you before you can chat. Check back soon.${me.emailVerified ? '' : ' We also sent you an email. Open it to confirm your address.'}`);
    return;
  }
  // first time as an approved member: welcome cinematic
  const key = 'sbk_welcomed_' + me.uid;
  if (!localStorage.getItem(key)) { localStorage.setItem(key, '1'); await window.SBKIntro.play({ welcome: true, name: profile.name }); }
  startMain();
}

function gate(title, text) {
  $('gate-title').textContent = title; $('gate-text').textContent = text; $('gate-msg').textContent = '';
  ['gate-refresh', 'gate-signout', 'claim-founder'].forEach((i) => $(i).classList.remove('hidden'));
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
function cleanup() { unsubMsgs?.(); unsubUsers?.(); unsubMsgs = unsubUsers = null; }

function startMain() {
  show('main');
  renderChannels();
  renderMe();
  $('pending-count').classList.add('hidden');
  document.querySelectorAll('.staff-only').forEach((x) => x.classList.toggle('hidden', !isStaff()));
  unsubUsers?.();
  unsubUsers = onSnapshot(collection(db, 'users'), (s) => {
    const old = users; users = {}; s.forEach((d) => (users[d.id] = { id: d.id, ...d.data(), _age: old[d.id]?._age }));
    if (users[me.uid]) { profile = users[me.uid]; if (profile.status !== 'member') return route(); }
    renderMembers(); renderStaff(); renderMe();
  });
  renderHub();
  openChannel(current);
  setPanel('hub');
}

function renderChannels() {
  $('channels').innerHTML = CHANNELS.map((c) => `<button class="ch ${c.id === current ? 'active' : ''}" data-ch="${c.id}">${c.icon} ${c.name}</button>`).join('');
  document.querySelectorAll('.ch').forEach((b) => (b.onclick = () => openChannel(b.dataset.ch)));
}

function renderMe() {
  if (!profile) return;
  $('me').innerHTML = `<div class="av" style="background:${colorFor(profile)}">${esc(initials(profile.name))}</div>
    <div class="info"><b>${esc(profile.name)}</b><span class="tiny muted">${esc((ROLE[profile.role] || ROLE.member).label)}</span></div>
    <button title="Sign out" id="so">⏻</button>`;
  $('so').onclick = () => signOut(auth);
}

function openChannel(id) {
  current = id;
  const ch = CHANNELS.find((c) => c.id === id);
  $('ch-title').textContent = `${ch.icon} ${ch.name}`;
  $('ch-desc').textContent = ch.desc;
  $('msg-input').placeholder = ch.staffOnly && !isStaff() ? 'Only staff can post here' : `Message #${ch.name}`;
  $('msg-input').disabled = !!(ch.staffOnly && !isStaff());
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
  const atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 80;
  if (!list.length) {
    box.innerHTML = `<div class="empty"><img src="assets/logo.png" alt=""><p>No messages yet. Be the first! ⚡</p></div>`;
    return;
  }
  box.innerHTML = list.map((m) => {
    const p = users[m.uid] || { role: m.role, name: m.name };
    const r = ROLE[p.role] || ROLE.member;
    const canDel = isStaff() || m.uid === me.uid;
    return `<div class="m" data-id="${m.id}">
      <div class="av" style="background:${r.color}">${esc(initials(p.name || m.name))}</div>
      <div class="body">
        <div class="top"><span class="name" style="color:${r.color}">${esc(p.name || m.name)}</span>
          <span class="badge" style="background:${r.color}22;color:${r.color}">${r.label}</span>
          <span class="time">${timeStr(m.createdAt)}</span></div>
        ${m.text ? `<div class="text">${linkify(clean(m.text))}</div>` : ''}
        ${m.image ? `<img class="shot" src="${m.image}" alt="screenshot">` : ''}
      </div>
      <div class="acts">${m.uid !== me.uid ? '<button data-act="report">🚩 Report</button>' : ''}${canDel ? '<button data-act="del">🗑️</button>' : ''}</div>
    </div>`;
  }).join('');
  box.querySelectorAll('img.shot').forEach((im) => (im.onclick = () => {
    const lb = document.createElement('div'); lb.className = 'lightbox'; lb.innerHTML = `<img src="${im.src}">`;
    lb.onclick = () => lb.remove(); document.body.appendChild(lb);
  }));
  box.querySelectorAll('[data-act]').forEach((b) => (b.onclick = async () => {
    const id = b.closest('.m').dataset.id;
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
  const data = { uid: me.uid, name: profile.name, role: profile.role, text: text.slice(0, 1000), createdAt: serverTimestamp() };
  if (pendingImage) data.image = pendingImage;
  $('msg-input').value = ''; clearAttach();
  await addDoc(collection(db, 'channels', current, 'messages'), data).catch((err) => toast(friendly(err)));
};

// ---------- panels ----------
document.querySelectorAll('[data-panel]').forEach((b) => (b.onclick = () => setPanel(b.dataset.panel)));
function setPanel(p) {
  ['hub', 'members', 'staff'].forEach((x) => $('panel-' + x).classList.toggle('hidden', x !== p));
  document.querySelectorAll('[data-panel]').forEach((b) => b.classList.toggle('on', b.dataset.panel === p));
}

function renderHub() {
  $('panel-hub').innerHTML = `
    <h3>⚡ THIS WEEK (Cairo time)</h3>
    <div class="card">${SCHEDULE.map(([a, b]) => `<div class="ev"><span>${a}</span><b>${b}</b></div>`).join('')}</div>
    <h3>📋 FORMS</h3>
    <div class="card">
      <button class="linkbtn" data-url="${LINKS.cup}">🏆 Sign up for the Weekly Cup</button>
      <button class="linkbtn" data-url="${LINKS.challenge}">⚔️ Clan war challenge (send to other clans)</button>
      <button class="linkbtn" data-url="${LINKS.staff}">🎓 Apply for Staff / Coach</button>
      <button class="linkbtn" data-url="${LINKS.report}">🛡️ Private report to the Founder</button>
    </div>
    <h3>📸 CAPTURE</h3>
    <div class="card small muted">Press <b>F8</b> for a screenshot and <b>F9</b> to start or stop recording, even in-game.
      Screenshots go to <b>Pictures\\SBK</b>, recordings to <b>Videos\\SBK</b>.</div>
    <h3>🔒 STAY SAFE</h3>
    <div class="card small muted">Never share your address, school, passwords or photos of yourself. If anyone makes you uncomfortable, hit 🚩 Report on their message or tell the Founder.</div>`;
}

function memberRow(u, buttons = '') {
  const r = ROLE[u.role] || ROLE.member;
  return `<div class="mem"><div class="av" style="background:${r.color}">${esc(initials(u.name))}</div>
    <div class="nm" style="color:${r.color}">${esc(u.name)}<small>${esc(u.epic || '')}${u._age ? ' • age ' + u._age : ''}</small></div>${buttons}</div>`;
}

function renderMembers() {
  const list = Object.values(users).filter((u) => u.status === 'member');
  const order = { founder: 0, leader: 1, member: 2 };
  list.sort((a, b) => (order[a.role] ?? 3) - (order[b.role] ?? 3) || a.name.localeCompare(b.name));
  $('panel-members').innerHTML = `<h3>👥 MEMBERS (${list.length})</h3>` + list.map((u) => memberRow(u)).join('');
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
    <h3>⏳ WAITING FOR APPROVAL (${pending.length})</h3>
    ${pending.map((u) => memberRow(u, `<button class="ok-btn" data-ok="${u.id}">✓</button><button class="no-btn" data-ban="${u.id}">✕</button>`)).join('') || '<p class="small muted">Nobody waiting.</p>'}
    ${pending.some((u) => u._age === 13) ? '<p class="tiny muted">Age 13 needs Founder approval.</p>' : ''}
    <h3 style="margin-top:16px">🛠️ MEMBERS</h3>
    ${members.map((u) => memberRow(u, `${profile.role === 'founder' ? `<button class="mid-btn" data-lead="${u.id}">${u.role === 'leader' ? '↓' : '★'}</button>` : ''}<button class="no-btn" data-ban="${u.id}">Ban</button>`)).join('') || '<p class="small muted">No members yet.</p>'}
    ${banned.length ? `<h3 style="margin-top:16px">🚫 BANNED</h3>${banned.map((u) => memberRow(u, `<button class="mid-btn" data-ok="${u.id}">Unban</button>`)).join('')}` : ''}
    <h3 style="margin-top:16px">🚩 REPORTS</h3><div id="reports"><p class="small muted">Loading…</p></div>`;
  $('panel-staff').querySelectorAll('[data-ok]').forEach((b) => (b.onclick = () => approve(b.dataset.ok)));
  $('panel-staff').querySelectorAll('[data-ban]').forEach((b) => (b.onclick = () => {
    if (confirmBox('Ban this person from SBK?')) updateDoc(doc(db, 'users', b.dataset.ban), { status: 'banned' }).catch((e) => toast(friendly(e)));
  }));
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
    await addDoc(collection(db, 'channels', 'general', 'messages'), {
      uid: me.uid, name: profile.name, role: profile.role, createdAt: serverTimestamp(),
      text: `⚡ Welcome to the storm, ${u.name}! Everyone say hi 👋`,
    });
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
      clearInterval(recTimer); $('rec-badge').classList.add('hidden'); $('btn-rec').textContent = '🔴 Record';
      window.sbk.recordingState(false);
      const buf = await new Blob(recChunks, { type: 'video/webm' }).arrayBuffer();
      const file = await window.sbk.saveRecording(new Uint8Array(buf));
      toast(`<b>🎥 Recording saved</b><br><span class="muted">${esc(file)}</span><div class="row" style="margin-top:8px"><button class="btn gold" id="t-open">Open folder</button></div>`, 8000)
        .querySelector('#t-open').onclick = () => window.sbk.openFolder('video');
    };
    recorder.start(1000);
    recStart = Date.now();
    $('rec-badge').classList.remove('hidden'); $('btn-rec').textContent = '⏹️ Stop recording';
    window.sbk.recordingState(true);
    recTimer = setInterval(() => {
      const s = Math.floor((Date.now() - recStart) / 1000);
      $('rec-time').textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    }, 500);
  } catch (e) { toast('Recording failed: ' + e.message); }
}
$('btn-rec').onclick = toggleRecord;
window.sbk.onToggleRecord(() => { if (profile?.status === 'member') toggleRecord(); });
