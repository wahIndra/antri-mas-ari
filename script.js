// ===== State =====
const STORAGE_KEY = "antrian_data";

function getToday() {
  return new Date().toLocaleDateString("id-ID", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function loadState() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function defaultState() {
  return {
    date: getToday(),
    queues: [], // Array of queue entries
    counters: { A: 0 },
    currentServing: null, // { number, service, prefix }
    myTicket: null, // ticket the current browser session took
  };
}

function saveState(state) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

let state = loadState();
if (!state || state.date !== getToday()) {
  state = defaultState();
  saveState(state);
}

// ===== Helpers =====
let selectedService = null;
let currentTab = "all";

function formatTime(iso) {
  const d = new Date(iso);
  return d.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" });
}

function estimateWait(queuesBefore) {
  const minutes = queuesBefore * 10;
  if (minutes === 0) return "Segera";
  if (minutes < 60) return `±${minutes} menit`;
  return `±${Math.round(minutes / 60)} jam`;
}

function showToast(msg, type = "") {
  const old = document.querySelector(".toast");
  if (old) old.remove();
  const t = document.createElement("div");
  t.className = `toast ${type}`;
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => {
    if (t.parentNode) t.remove();
  }, 3500);
}

// ===== Fixed service (single purpose) =====
const FIXED_SERVICE = { name: "Konsultasi QA – Mas Ari", prefix: "A" };

// ===== Take Queue =====
function takeQueue() {
  const prefix = FIXED_SERVICE.prefix;
  state.counters[prefix] = (state.counters[prefix] || 0) + 1;
  const num = String(state.counters[prefix]).padStart(3, "0");
  const queueNumber = `${prefix}${num}`;
  const name = document.getElementById("patientName").value.trim() || "Tamu";
  const now = new Date().toISOString();

  const entry = {
    id: queueNumber,
    name,
    service: FIXED_SERVICE.name,
    prefix,
    takenAt: now,
    status: "waiting", // waiting | serving | done | skipped
  };

  state.queues.push(entry);
  state.myTicket = entry;
  saveState(state);

  // Show ticket
  showTicket(entry);
  document.getElementById("formSection").style.display = "none";

  showToast(`Nomor antrian ${queueNumber} berhasil diambil!`, "success");
  renderAll();
}

function showTicket(entry) {
  const waitingBefore = state.queues.filter(
    (q) => q.status === "waiting" && q.takenAt < entry.takenAt,
  ).length;

  document.getElementById("ticketSection").style.display = "flex";
  document.getElementById("ticketNumber").textContent = entry.id;
  document.getElementById("ticketService").textContent = entry.service;
  document.getElementById("ticketTime").textContent = formatTime(entry.takenAt);
  document.getElementById("ticketEstimate").textContent =
    estimateWait(waitingBefore);
}

function cancelTicket() {
  if (!state.myTicket) return;
  const idx = state.queues.findIndex((q) => q.id === state.myTicket.id);
  if (idx !== -1 && state.queues[idx].status === "waiting") {
    state.queues.splice(idx, 1);
    // Roll back counter so next number reuses (optional: keep counter for uniqueness)
    showToast("Antrian Anda telah dibatalkan.", "warning");
  }
  state.myTicket = null;
  saveState(state);

  document.getElementById("ticketSection").style.display = "none";
  document.getElementById("formSection").style.display = "block";
  resetServiceSelection();
  renderAll();
}

function resetServiceSelection() {
  document.getElementById("patientName").value = "";
}

// ===== Print Ticket =====
function printTicket() {
  window.print();
}

// ===== Admin: Call Next =====
function callNext() {
  const next = state.queues.find((q) => q.status === "waiting");
  if (!next) {
    showToast("Tidak ada antrian yang menunggu.", "warning");
    return;
  }

  // Mark current as done
  if (state.currentServing) {
    const idx = state.queues.findIndex((q) => q.id === state.currentServing.id);
    if (idx !== -1) state.queues[idx].status = "done";
  }

  next.status = "serving";
  state.currentServing = next;
  saveState(state);

  showToast(`Memanggil nomor ${next.id} – ${next.name}`, "success");
  playBeep();
  renderAll();
}

// ===== Admin: Recall Current =====
function recallCurrent() {
  if (!state.currentServing) {
    showToast("Tidak ada antrian yang sedang dilayani.", "warning");
    return;
  }
  showToast(
    `Memanggil ulang nomor ${state.currentServing.id} – ${state.currentServing.name}`,
    "",
  );
  playBeep();
}

// ===== Admin: Reset =====
function resetQueue() {
  const confirmed = window.confirm(
    "Reset semua antrian hari ini?\nTindakan ini tidak dapat dibatalkan.",
  );
  if (!confirmed) return;
  state = defaultState();
  saveState(state);
  document.getElementById("ticketSection").style.display = "none";
  document.getElementById("formSection").style.display = "block";
  resetServiceSelection();
  showToast("Antrian telah direset.", "warning");
  renderAll();
}

// ===== Beep =====
function playBeep() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = "sine";
    osc.frequency.setValueAtTime(880, ctx.currentTime);
    gain.gain.setValueAtTime(0.4, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.6);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.6);
  } catch (_) {
    /* audio not supported */
  }
}

// ===== Tabs =====
function switchTab(el, tab) {
  document
    .querySelectorAll(".tab")
    .forEach((t) => t.classList.remove("active"));
  el.classList.add("active");
  currentTab = tab;
  renderQueueTable();
}

// ===== Render =====
function renderAll() {
  renderStatusPanel();
  renderServiceQueues();
  renderQueueTable();
  renderMyTicketStatus();
}

function renderStatusPanel() {
  const serving = state.currentServing ? state.currentServing.id : "-";
  const waiting = state.queues.filter((q) => q.status === "waiting").length;
  const total = state.queues.length;

  document.getElementById("currentNumber").textContent = serving;
  document.getElementById("waitingCount").textContent = waiting;
  document.getElementById("totalCount").textContent = total;
}

function renderServiceQueues() {
  // Single service – nothing to render in grid
}

function renderQueueTable() {
  const tbody = document.getElementById("queueTableBody");
  let rows = [...state.queues].reverse(); // latest first

  if (currentTab === "waiting")
    rows = rows.filter((q) => q.status === "waiting");
  if (currentTab === "done")
    rows = rows.filter((q) => q.status === "done" || q.status === "serving");

  if (rows.length === 0) {
    tbody.innerHTML = `<tr class="empty-row"><td colspan="4">Tidak ada antrian</td></tr>`;
    return;
  }

  const statusMap = {
    waiting: `<span class="badge badge-waiting">Menunggu</span>`,
    serving: `<span class="badge badge-serving">Dipanggil</span>`,
    done: `<span class="badge badge-done">Selesai</span>`,
    skipped: `<span class="badge badge-skipped">Dilewati</span>`,
  };

  tbody.innerHTML = rows
    .map(
      (q) => `
    <tr>
      <td class="ticket-num-cell">${q.id}</td>
      <td>${escHtml(q.name)}</td>
      <td>${formatTime(q.takenAt)}</td>
      <td>${statusMap[q.status] || q.status}</td>
    </tr>
  `,
    )
    .join("");
}

function renderMyTicketStatus() {
  if (!state.myTicket) return;
  const entry = state.queues.find((q) => q.id === state.myTicket.id);
  if (entry && entry.status !== state.myTicket.status) {
    state.myTicket.status = entry.status;
    if (entry.status === "serving") {
      showToast(`Nomor ${entry.id} – Anda sedang dipanggil!`, "success");
      playBeep();
      playBeep();
    }
  }
}

// XSS guard
function escHtml(str) {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// ===== Init =====
renderAll();

// Auto-refresh every 5 seconds (simulates multi-window sync via localStorage)
setInterval(() => {
  const fresh = loadState();
  if (fresh && JSON.stringify(fresh) !== JSON.stringify(state)) {
    state = fresh;
    renderAll();
  }
}, 5000);

// Listen to storage events from other tabs
window.addEventListener("storage", (e) => {
  if (e.key === STORAGE_KEY) {
    const fresh = loadState();
    if (fresh) {
      state = fresh;
      renderAll();
    }
  }
});
