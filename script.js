// ============================================================
//  KONFIGURASI FIREBASE
// ============================================================
const firebaseConfig = {
  apiKey: "AIzaSyCbrHqIAUHYotq6eygL9LwACfW9net6RXQ",
  authDomain: "antri-mas-ari.firebaseapp.com",
  databaseURL:
    "https://antri-mas-ari-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "antri-mas-ari",
  storageBucket: "antri-mas-ari.firebasestorage.app",
  messagingSenderId: "762311648576",
  appId: "1:762311648576:web:c3af752797f89d1bf186a5",
};

firebase.initializeApp(firebaseConfig);
const db = firebase.database();
const ROOT = "antrian";
const rootRef = db.ref(ROOT);

const FIXED_SERVICE = { name: "Konsultasi QA – Mas Ari", prefix: "A" };
const MY_TICKET_KEY = "myTicket_masAri";

let liveState = null;
let currentTab = "all";

function getToday() {
  return new Date().toLocaleDateString("id-ID", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function formatTime(iso) {
  return new Date(iso).toLocaleTimeString("id-ID", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function estimateWait(n) {
  const m = n * 10;
  if (m === 0) return "Segera";
  if (m < 60) return "±" + m + " menit";
  return "±" + Math.round(m / 60) + " jam";
}

function showToast(msg, type) {
  type = type || "";
  var old = document.querySelector(".toast");
  if (old) old.remove();
  var t = document.createElement("div");
  t.className = "toast " + type;
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(function () {
    if (t.parentNode) t.remove();
  }, 3500);
}

function escHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function getMyTicket() {
  var raw = localStorage.getItem(MY_TICKET_KEY);
  try {
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}

function saveMyTicket(t) {
  if (t) localStorage.setItem(MY_TICKET_KEY, JSON.stringify(t));
  else localStorage.removeItem(MY_TICKET_KEY);
}

// ===== Take Queue =====
function takeQueue() {
  var name = document.getElementById("patientName").value.trim() || "Tamu";
  var counterRef = db.ref(ROOT + "/counters/A");

  counterRef
    .transaction(function (cur) {
      return (cur || 0) + 1;
    })
    .then(function (res) {
      var num = String(res.snapshot.val()).padStart(3, "0");
      var queueNumber = "A" + num;
      var now = new Date().toISOString();
      var entry = {
        id: queueNumber,
        name: name,
        service: FIXED_SERVICE.name,
        prefix: FIXED_SERVICE.prefix,
        takenAt: now,
        status: "waiting",
      };
      var newRef = db.ref(ROOT + "/queues").push(entry);
      saveMyTicket(Object.assign({}, entry, { fbKey: newRef.key }));
      showTicket(entry);
      document.getElementById("formSection").style.display = "none";
      showToast(
        "Nomor antrian " + queueNumber + " berhasil diambil!",
        "success",
      );
    })
    .catch(function () {
      showToast(
        "Gagal terhubung ke server. Periksa koneksi internet.",
        "error",
      );
    });
}

function showTicket(entry) {
  var queues = liveState ? Object.values(liveState.queues || {}) : [];
  var wb = queues.filter(function (q) {
    return q.status === "waiting" && q.takenAt < entry.takenAt;
  }).length;
  document.getElementById("ticketSection").style.display = "flex";
  document.getElementById("ticketNumber").textContent = entry.id;
  document.getElementById("ticketService").textContent = entry.service;
  document.getElementById("ticketTime").textContent = formatTime(entry.takenAt);
  document.getElementById("ticketEstimate").textContent = estimateWait(wb);
}

function cancelTicket() {
  var myTicket = getMyTicket();
  if (!myTicket) return;
  db.ref(ROOT + "/queues/" + myTicket.fbKey)
    .once("value")
    .then(function (snap) {
      if (!snap.exists() || snap.val().status !== "waiting") {
        showToast(
          "Antrian tidak bisa dibatalkan (sudah dipanggil).",
          "warning",
        );
        return;
      }
      snap.ref.remove();
      saveMyTicket(null);
      document.getElementById("ticketSection").style.display = "none";
      document.getElementById("formSection").style.display = "block";
      document.getElementById("patientName").value = "";
      showToast("Antrian Anda telah dibatalkan.", "warning");
    });
}

function printTicket() {
  window.print();
}

// ===== Admin: Call Next =====
function callNext() {
  var queues = Object.entries(liveState.queues || {})
    .map(function (kv) {
      return Object.assign({}, kv[1], { fbKey: kv[0] });
    })
    .sort(function (a, b) {
      return a.takenAt.localeCompare(b.takenAt);
    });
  var next = queues.find(function (q) {
    return q.status === "waiting";
  });
  var updates = {};
  if (liveState.currentServing && liveState.currentServing.fbKey) {
    updates[ROOT + "/queues/" + liveState.currentServing.fbKey + "/status"] =
      "done";
  }
  updates[ROOT + "/queues/" + next.fbKey + "/status"] = "serving";
  updates[ROOT + "/currentServing"] = Object.assign({}, next, {
    status: "serving",
  });
  db.ref()
    .update(updates)
    .then(function () {
      showToast("Memanggil nomor " + next.id + " – " + next.name, "success");
      playBeep();
    })
    .catch(function () {
      showToast("Gagal memanggil antrian.", "error");
    });
}

function recallCurrent() {
  showToast(
    "Memanggil ulang nomor " +
      liveState.currentServing.id +
      " – " +
      liveState.currentServing.name,
    "",
  );
  playBeep();
}

function resetQueue() {
  rootRef
    .set({
      date: getToday(),
      counters: { A: 0 },
      currentServing: null,
      queues: {},
    })
    .then(function () {
      saveMyTicket(null);
      document.getElementById("ticketSection").style.display = "none";
      document.getElementById("formSection").style.display = "block";
      document.getElementById("patientName").value = "";
      showToast("Antrian telah direset.", "warning");
    })
    .catch(function () {
      showToast("Gagal mereset antrian.", "error");
    });
}

function playBeep() {
  try {
    var ctx = new (window.AudioContext || window.webkitAudioContext)();
    var osc = ctx.createOscillator(),
      gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = "sine";
    osc.frequency.setValueAtTime(880, ctx.currentTime);
    gain.gain.setValueAtTime(0.4, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.6);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.6);
  } catch (e) {}
}

function switchTab(el, tab) {
  document.querySelectorAll(".tab").forEach(function (t) {
    t.classList.remove("active");
  });
  el.classList.add("active");
  currentTab = tab;
  renderQueueTable();
}

function renderAll(data) {
  liveState = data;
  renderStatusPanel();
  renderQueueTable();
  checkMyTicketStatus();
}

function renderStatusPanel() {
  var serving =
    liveState && liveState.currentServing ? liveState.currentServing.id : "-";
  var queues = Object.values((liveState && liveState.queues) || {});
  document.getElementById("currentNumber").textContent = serving;
  document.getElementById("waitingCount").textContent = queues.filter(
    function (q) {
      return q.status === "waiting";
    },
  ).length;
  document.getElementById("totalCount").textContent = queues.length;
}

function renderQueueTable() {
  var tbody = document.getElementById("queueTableBody");
  if (!liveState) {
    tbody.innerHTML =
      '<tr class="empty-row"><td colspan="4">Menghubungkan ke server...</td></tr>';
    return;
  }
  var rows = Object.entries(liveState.queues || {})
    .map(function (kv) {
      return Object.assign({}, kv[1], { fbKey: kv[0] });
    })
    .sort(function (a, b) {
      return b.takenAt.localeCompare(a.takenAt);
    });
  if (currentTab === "waiting")
    rows = rows.filter(function (q) {
      return q.status === "waiting";
    });
  if (currentTab === "done")
    rows = rows.filter(function (q) {
      return q.status === "done" || q.status === "serving";
    });
  if (rows.length === 0) {
    tbody.innerHTML =
      '<tr class="empty-row"><td colspan="4">Tidak ada antrian</td></tr>';
    return;
  }
  var statusMap = {
    waiting: '<span class="badge badge-waiting">Menunggu</span>',
    serving: '<span class="badge badge-serving">Dipanggil</span>',
    done: '<span class="badge badge-done">Selesai</span>',
    skipped: '<span class="badge badge-skipped">Dilewati</span>',
  };
  tbody.innerHTML = rows
    .map(function (q) {
      return (
        '<tr><td class="ticket-num-cell">' +
        q.id +
        "</td><td>" +
        escHtml(q.name) +
        "</td><td>" +
        formatTime(q.takenAt) +
        "</td><td>" +
        (statusMap[q.status] || q.status) +
        "</td></tr>"
      );
    })
    .join("");
}

function checkMyTicketStatus() {
  var myTicket = getMyTicket();
  if (!myTicket || !liveState) return;
  var entry = Object.values(liveState.queues || {}).find(function (q) {
    return q.id === myTicket.id;
  });
  if (!entry) return;
  if (entry.status !== myTicket.status) {
    saveMyTicket(Object.assign({}, myTicket, { status: entry.status }));
    if (entry.status === "serving") {
      showToast("Nomor " + entry.id + " – Anda sedang dipanggil!", "success");
      playBeep();
      playBeep();
    }
  }
  if (document.getElementById("ticketSection").style.display !== "none") {
    var queues = Object.values(liveState.queues || {});
    var wb = queues.filter(function (q) {
      return q.status === "waiting" && q.takenAt < entry.takenAt;
    }).length;
    document.getElementById("ticketEstimate").textContent = estimateWait(wb);
  }
}

// ===== Bootstrap =====
document.getElementById("queueTableBody").innerHTML =
  '<tr class="empty-row"><td colspan="4">Menghubungkan ke server...</td></tr>';

rootRef
  .once("value")
  .then(function (snap) {
    var data = snap.val();
    if (!data || data.date !== getToday()) {
      rootRef.set({
        date: getToday(),
        counters: { A: 0 },
        currentServing: null,
        queues: {},
      });
      saveMyTicket(null);
    } else {
      var myTicket = getMyTicket();
      if (myTicket) {
        var stillExists = Object.values(data.queues || {}).some(function (q) {
          return q.id === myTicket.id;
        });
        if (stillExists) {
          showTicket(myTicket);
          document.getElementById("formSection").style.display = "none";
        } else saveMyTicket(null);
      }
    }
    rootRef.on("value", function (snapshot) {
      renderAll(
        snapshot.val() || {
          date: getToday(),
          counters: { A: 0 },
          currentServing: null,
          queues: {},
        },
      );
    });
  })
  .catch(function () {
    showToast("Tidak dapat terhubung ke server.", "error");
  });
