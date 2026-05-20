// ============================================================
//  KONFIGURASI FIREBASE
//  1. Buka https://console.firebase.google.com
//  2. Buat project baru -> tambah Web App
//  3. Salin nilai di bawah dari 'Your web app Firebase config'
//  4. Di Firebase Console -> Realtime Database -> Rules, set:
//     { rules: { .read: true, .write: true } }
// ============================================================
const firebaseConfig = {
  apiKey:            'YOUR_API_KEY',
  authDomain:        'YOUR_PROJECT_ID.firebaseapp.com',
  databaseURL:       'https://YOUR_PROJECT_ID-default-rtdb.asia-southeast1.firebasedatabase.app',
  projectId:         'YOUR_PROJECT_ID',
  storageBucket:     'YOUR_PROJECT_ID.appspot.com',
  messagingSenderId: 'YOUR_SENDER_ID',
  appId:             'YOUR_APP_ID',
};

// ===== Init Firebase =====
firebase.initializeApp(firebaseConfig);
const db      = firebase.database();
const ROOT    = 'antrian';
const rootRef = db.ref(ROOT);

// ===== Constants =====
const FIXED_SERVICE = { name: 'Konsultasi QA – Mas Ari', prefix: 'A' };
const MY_TICKET_KEY = 'myTicket_masAri';

// ===== Runtime =====
let liveState  = null;
let currentTab = 'all';

// ===== Helpers =====
function getToday() {
  return new Date().toLocaleDateString('id-ID', {
    day: '2-digit', month: '2-digit', year: 'numeric',
  });
}

function formatTime(iso) {
  return new Date(iso).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
}

function estimateWait(queuesBefore) {
  const minutes = queuesBefore * 10;
  if (minutes === 0) return 'Segera';
  if (minutes < 60)  return '±' + minutes + ' menit';
  return '±' + Math.round(minutes / 60) + ' jam';
}

function showToast(msg, type = '') {
  const old = document.querySelector('.toast');
  if (old) old.remove();
  const t = document.createElement('div');
  t.className = 'toast ' + type;
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => { if (t.parentNode) t.remove(); }, 3500);
}

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// ===== My Ticket (per-device via localStorage) =====
function getMyTicket() {
  const raw = localStorage.getItem(MY_TICKET_KEY);
  try { return raw ? JSON.parse(raw) : null; } catch { return null; }
}

function saveMyTicket(ticket) {
  if (ticket) localStorage.setItem(MY_TICKET_KEY, JSON.stringify(ticket));
  else        localStorage.removeItem(MY_TICKET_KEY);
}

// ===== Take Queue =====
function takeQueue() {
  const name       = document.getElementById('patientName').value.trim() || 'Tamu';
  const counterRef = db.ref(ROOT + '/counters/A');

  counterRef.transaction((current) => (current || 0) + 1)
    .then(({ committed, snapshot }) => {

      const num         = String(snapshot.val()).padStart(3, '0');
      const queueNumber = 'A' + num;
      const now         = new Date().toISOString();

      const entry = {
        id:      queueNumber,
        name,
        service: FIXED_SERVICE.name,
        prefix:  FIXED_SERVICE.prefix,
        takenAt: now,
        status:  'waiting',
      };

      const newRef = db.ref(ROOT + '/queues').push(entry);
      saveMyTicket({ ...entry, fbKey: newRef.key });

      showTicket(entry);
      document.getElementById('formSection').style.display = 'none';
      showToast('Nomor antrian ' + queueNumber + ' berhasil diambil!', 'success');
    })
    .catch(() => showToast('Gagal terhubung ke server. Periksa koneksi internet.', 'error'));
}

function showTicket(entry) {
  const queues        = liveState ? Object.values(liveState.queues || {}) : [];
  const waitingBefore = queues.filter(q => q.status === 'waiting' && q.takenAt < entry.takenAt).length;

  document.getElementById('ticketSection').style.display  = 'flex';
  document.getElementById('ticketNumber').textContent     = entry.id;
  document.getElementById('ticketService').textContent    = entry.service;
  document.getElementById('ticketTime').textContent       = formatTime(entry.takenAt);
  document.getElementById('ticketEstimate').textContent   = estimateWait(waitingBefore);
}

function cancelTicket() {
  const myTicket = getMyTicket();

  db.ref(ROOT + '/queues/' + myTicket.fbKey).once('value').then((snap) => {
      showToast('Antrian tidak bisa dibatalkan (sudah dipanggil).', 'warning');
      return;
    }
    snap.ref.remove();
    saveMyTicket(null);
    document.getElementById('ticketSection').style.display = 'none';
    document.getElementById('formSection').style.display   = 'block';
    document.getElementById('patientName').value           = '';
    showToast('Antrian Anda telah dibatalkan.', 'warning');
  });
}

function printTicket() { window.print(); }

// ===== Admin: Call Next =====
function callNext() {

  const queues = Object.entries(liveState.queues || {})
    .map(([k, v]) => ({ ...v, fbKey: k }))
    .sort((a, b) => a.takenAt.localeCompare(b.takenAt));

  const next = queues.find(q => q.status === 'waiting');

  const updates = {};
  if (liveState.currentServing && liveState.currentServing.fbKey) {
    updates[ROOT + '/queues/' + liveState.currentServing.fbKey + '/status'] = 'done';
  }
  updates[ROOT + '/queues/' + next.fbKey + '/status'] = 'serving';
  updates[ROOT + '/currentServing'] = { ...next, status: 'serving' };

  db.ref().update(updates)
    .then(() => { showToast('Memanggil nomor ' + next.id + ' – ' + next.name, 'success'); playBeep(); })
    .catch(() => showToast('Gagal memanggil antrian.', 'error'));
}

// ===== Admin: Recall Current =====
function recallCurrent() {
    showToast('Tidak ada antrian yang sedang dilayani.', 'warning'); return;
  }
  showToast('Memanggil ulang nomor ' + liveState.currentServing.id + ' – ' + liveState.currentServing.name, '');
  playBeep();
}

// ===== Admin: Reset =====
function resetQueue() {

  rootRef.set({ date: getToday(), counters: { A: 0 }, currentServing: null, queues: {} })
    .then(() => {
      saveMyTicket(null);
      document.getElementById('ticketSection').style.display = 'none';
      document.getElementById('formSection').style.display   = 'block';
      document.getElementById('patientName').value           = '';
      showToast('Antrian telah direset.', 'warning');
    })
    .catch(() => showToast('Gagal mereset antrian.', 'error'));
}

// ===== Beep =====
function playBeep() {
  try {
    const ctx  = new (window.AudioContext || window.webkitAudioContext)();
    const osc  = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain); gain.connect(ctx.destination);
    osc.type = 'sine';
    osc.frequency.setValueAtTime(880, ctx.currentTime);
    gain.gain.setValueAtTime(0.4, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.6);
    osc.start(ctx.currentTime); osc.stop(ctx.currentTime + 0.6);
  } catch (_) {}
}

// ===== Tabs =====
function switchTab(el, tab) {
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  el.classList.add('active');
  currentTab = tab;
  renderQueueTable();
}

// ===== Render =====
function renderAll(data) {
  liveState = data;
  renderStatusPanel();
  renderQueueTable();
  checkMyTicketStatus();
}

function renderStatusPanel() {
  const serving = liveState && liveState.currentServing ? liveState.currentServing.id : '-';
  const queues  = Object.values((liveState && liveState.queues) || {});
  document.getElementById('currentNumber').textContent = serving;
  document.getElementById('waitingCount').textContent  = queues.filter(q => q.status === 'waiting').length;
  document.getElementById('totalCount').textContent    = queues.length;
}

function renderQueueTable() {
  const tbody = document.getElementById('queueTableBody');

    tbody.innerHTML = '<tr class="empty-row"><td colspan="4">Menghubungkan ke server...</td></tr>';
    return;
  }

  let rows = Object.entries(liveState.queues || {})
    .map(([k, v]) => ({ ...v, fbKey: k }))
    .sort((a, b) => b.takenAt.localeCompare(a.takenAt));

  if (currentTab === 'waiting') rows = rows.filter(q => q.status === 'waiting');
  if (currentTab === 'done')    rows = rows.filter(q => q.status === 'done' || q.status === 'serving');

  if (rows.length === 0) {
    tbody.innerHTML = '<tr class="empty-row"><td colspan="4">Tidak ada antrian</td></tr>';
    return;
  }

  const statusMap = {
    waiting: '<span class="badge badge-waiting">Menunggu</span>',
    serving: '<span class="badge badge-serving">Dipanggil</span>',
    done:    '<span class="badge badge-done">Selesai</span>',
    skipped: '<span class="badge badge-skipped">Dilewati</span>',
  };

  tbody.innerHTML = rows.map(q =>
    '<tr><td class="ticket-num-cell">' + q.id + '</td><td>' + escHtml(q.name) + '</td><td>' + formatTime(q.takenAt) + '</td><td>' + (statusMap[q.status] || q.status) + '</td></tr>'
  ).join('');
}

function checkMyTicketStatus() {
  const myTicket = getMyTicket();

  const entry = Object.values(liveState.queues || {}).find(q => q.id === myTicket.id);

  if (entry.status !== myTicket.status) {
    saveMyTicket({ ...myTicket, status: entry.status });
    if (entry.status === 'serving') {
      showToast('Nomor ' + entry.id + ' – Anda sedang dipanggil!', 'success');
      playBeep(); playBeep();
    }
  }

  if (document.getElementById('ticketSection').style.display !== 'none') {
    const queues        = Object.values(liveState.queues || {});
    const waitingBefore = queues.filter(q => q.status === 'waiting' && q.takenAt < entry.takenAt).length;
    document.getElementById('ticketEstimate').textContent = estimateWait(waitingBefore);
  }
}

// ===== Bootstrap =====
document.getElementById('queueTableBody').innerHTML =
  '<tr class="empty-row"><td colspan="4">Menghubungkan ke server...</td></tr>';

rootRef.once('value').then((snap) => {
  const data = snap.val();

    rootRef.set({ date: getToday(), counters: { A: 0 }, currentServing: null, queues: {} });
    saveMyTicket(null);
  } else {
    const myTicket = getMyTicket();
    if (myTicket) {
      const stillExists = Object.values(data.queues || {}).some(q => q.id === myTicket.id);
      if (stillExists) {
        showTicket(myTicket);
        document.getElementById('formSection').style.display = 'none';
      } else {
        saveMyTicket(null);
      }
    }
  }

  rootRef.on('value', (snapshot) => {
    renderAll(snapshot.val() || {
      date: getToday(), counters: { A: 0 }, currentServing: null, queues: {},
    });
  });
});
