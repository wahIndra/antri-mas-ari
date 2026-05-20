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
const ADMIN_PIN = "1357";
const settingsRef = db.ref(ROOT + "/settings");

let liveState = null;
let currentTab = "all";
let adminUnlocked = false;
let currentServiceName = FIXED_SERVICE.name;
let currentPaymentQRUrl = "";
let pendingName = "";
let pendingPhone = "";

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
function isValidPhone(p) {
  // Optional field — empty is always fine
  if (!p) return true;
  // Accept: starts with 08, +62, or 62; 8-15 digits; spaces/dashes allowed
  return /^(\+62|62|0)[0-9][\d\s\-]{6,13}$/.test(p);
}

function requestQueue() {
  var name = document.getElementById("patientName").value.trim() || "Tamu";
  var phone = document.getElementById("patientPhone").value.trim();
  if (phone && !isValidPhone(phone)) {
    showToast("Nomor HP tidak valid. Contoh: 0812-3456-7890", "error");
    document.getElementById("patientPhone").focus();
    return;
  }
  if (currentPaymentQRUrl) {
    pendingName = name;
    pendingPhone = phone;
    document.getElementById("paymentQRImage").src = currentPaymentQRUrl;
    document.getElementById("formSection").style.display = "none";
    document.getElementById("paymentSection").style.display = "flex";
  } else {
    takeQueue(name, phone);
  }
}

function confirmPayment() {
  document.getElementById("paymentSection").style.display = "none";
  takeQueue(pendingName, pendingPhone);
  pendingName = "";
  pendingPhone = "";
}

function cancelPayment() {
  pendingName = "";
  pendingPhone = "";
  document.getElementById("paymentSection").style.display = "none";
  document.getElementById("formSection").style.display = "block";
}

function takeQueue(name, phone) {
  var counterRef = db.ref(ROOT + "/counters/A");

  counterRef
    .transaction(function (cur) {
      return (cur || 0) + 1;
    })
    .then(function (res) {
      if (!res.committed) {
        showToast("Gagal mengambil nomor, coba lagi.", "error");
        return;
      }
      var num = String(res.snapshot.val()).padStart(3, "0");
      var queueNumber = "A" + num;
      var now = new Date().toISOString();
      var entry = {
        id: queueNumber,
        name: name,
        phone: phone || "",
        service: currentServiceName,
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
  // Reset done state
  document.getElementById("ticketDoneBanner").style.display = "none";
  document.getElementById("ticketNote").style.display = "";
  document.getElementById("ticketActions").style.display = "";
  document.getElementById("ticketCancelBtn").style.display = "";
  // Phone row
  var phoneRow = document.getElementById("ticketPhoneRow");
  var phoneEl = document.getElementById("ticketPhone");
  if (entry.phone) {
    phoneEl.textContent = entry.phone;
    phoneRow.style.display = "";
  } else {
    phoneRow.style.display = "none";
  }
  document.getElementById("ticketSection").style.display = "flex";
  document.getElementById("ticketNumber").textContent = entry.id;
  document.getElementById("ticketService").textContent = entry.service;
  document.getElementById("ticketTime").textContent = formatTime(entry.takenAt);
  document.getElementById("ticketEstimate").textContent = estimateWait(wb);
}

function newQueue() {
  document.getElementById("ticketSection").style.display = "none";
  document.getElementById("formSection").style.display = "block";
  document.getElementById("patientName").value = "";
  document.getElementById("patientPhone").value = "";
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

// ===== PIN / Admin Auth =====
function openPinModal() {
  document.getElementById("pinInput").value = "";
  document.getElementById("pinError").textContent = "";
  document.getElementById("adminQRImage").src = "QRANTRI.jpg";
  document.getElementById("pinOverlay").classList.add("open");
  setTimeout(function () {
    document.getElementById("pinInput").focus();
  }, 100);
}

function closePinModal(e) {
  if (e && e.target !== document.getElementById("pinOverlay")) return;
  document.getElementById("pinOverlay").classList.remove("open");
}

function submitPin() {
  var entered = document.getElementById("pinInput").value;
  if (entered === ADMIN_PIN) {
    adminUnlocked = true;
    document.getElementById("pinOverlay").classList.remove("open");
    document.getElementById("adminLocked").style.display = "none";
    document.getElementById("adminUnlockedBar").style.display = "flex";
    showToast("Panel berhasil dibuka.", "success");
  } else {
    document.getElementById("pinError").textContent = "PIN salah, coba lagi.";
    document.getElementById("pinInput").value = "";
    document.getElementById("pinInput").focus();
  }
}

function lockAdmin() {
  adminUnlocked = false;
  document.getElementById("adminLocked").style.display = "flex";
  document.getElementById("adminUnlockedBar").style.display = "none";
}

// ===== Settings =====
function applySettings(s) {
  s = s || {};
  currentServiceName = s.serviceName || FIXED_SERVICE.name;
  // Default to local QRANTRI.jpg; admin can override or clear in settings
  currentPaymentQRUrl =
    s.paymentQRUrl !== undefined &&
    s.paymentQRUrl !== null &&
    s.paymentQRUrl !== ""
      ? s.paymentQRUrl
      : "QRANTRI.jpg";
  var el;
  el = document.getElementById("headerTitle");
  if (el) el.textContent = s.headerTitle || "";
  el = document.getElementById("headerSubtitle");
  if (el) el.textContent = s.headerSubtitle || "";
  el = document.getElementById("profileName");
  if (el) el.textContent = s.profileName || "";
  el = document.getElementById("profileTitle");
  if (el) el.textContent = s.profileTitle || "";
  if (s.pageTitle) document.title = s.pageTitle;
}

function openSettingsModal() {
  if (!adminUnlocked) {
    openPinModal();
    return;
  }
  settingsRef.once("value").then(function (snap) {
    var s = snap.val() || {};
    document.getElementById("setHeaderTitle").value =
      s.headerTitle || "Antrian Konsultasi QA";
    document.getElementById("setHeaderSubtitle").value =
      s.headerSubtitle || "Mas Ari \u2013 QA Lead";
    document.getElementById("setProfileName").value =
      s.profileName || "Mas Ari";
    document.getElementById("setProfileTitle").value =
      s.profileTitle || "QA Lead";
    document.getElementById("setServiceName").value =
      s.serviceName || currentServiceName;
    document.getElementById("setPaymentQR").value = s.paymentQRUrl || "";
    document.getElementById("settingsOverlay").classList.add("open");
  });
}

function closeSettingsModal(e) {
  if (e && e.target !== document.getElementById("settingsOverlay")) return;
  document.getElementById("settingsOverlay").classList.remove("open");
}

function saveSettings() {
  var s = {
    headerTitle:
      document.getElementById("setHeaderTitle").value.trim() ||
      "Antrian Konsultasi QA",
    headerSubtitle:
      document.getElementById("setHeaderSubtitle").value.trim() ||
      "Mas Ari \u2013 QA Lead",
    profileName:
      document.getElementById("setProfileName").value.trim() || "Mas Ari",
    profileTitle:
      document.getElementById("setProfileTitle").value.trim() || "QA Lead",
    serviceName:
      document.getElementById("setServiceName").value.trim() ||
      currentServiceName,
    paymentQRUrl: document.getElementById("setPaymentQR").value.trim(),
    pageTitle:
      document.getElementById("setHeaderTitle").value.trim() ||
      "Antrian Konsultasi QA",
  };
  settingsRef
    .set(s)
    .then(function () {
      applySettings(s);
      document.getElementById("settingsOverlay").classList.remove("open");
      showToast("Pengaturan berhasil disimpan.", "success");
    })
    .catch(function () {
      showToast("Gagal menyimpan pengaturan.", "error");
    });
}

// ===== Admin: Call Next =====
function callNext() {
  if (!adminUnlocked) {
    openPinModal();
    return;
  }
  if (!liveState) return;
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
  if (!next) {
    showToast("Tidak ada antrian yang menunggu.", "warning");
    return;
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
  if (!adminUnlocked) {
    openPinModal();
    return;
  }
  if (!liveState || !liveState.currentServing) {
    showToast("Tidak ada antrian yang sedang dilayani.", "warning");
    return;
  }
  showToast(
    "Memanggil ulang nomor " +
      liveState.currentServing.id +
      " – " +
      liveState.currentServing.name,
    "",
  );
  playBeep();
}

function finishCurrent() {
  if (!adminUnlocked) {
    openPinModal();
    return;
  }
  if (
    !liveState ||
    !liveState.currentServing ||
    !liveState.currentServing.fbKey
  ) {
    showToast("Tidak ada antrian yang sedang dilayani.", "warning");
    return;
  }
  var cs = liveState.currentServing;
  var updates = {};
  updates[ROOT + "/queues/" + cs.fbKey + "/status"] = "done";
  updates[ROOT + "/currentServing"] = null;
  db.ref()
    .update(updates)
    .then(function () {
      showToast(
        "Nomor " + cs.id + " – " + cs.name + " selesai dilayani.",
        "success",
      );
    })
    .catch(function () {
      showToast("Gagal menyelesaikan antrian.", "error");
    });
}

function resetQueue() {
  if (!adminUnlocked) {
    openPinModal();
    return;
  }
  if (!window.confirm("Reset semua antrian hari ini?")) return;
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
      '<tr class="empty-row"><td colspan="5">Menghubungkan ke server...</td></tr>';
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
  if (currentTab === "serving")
    rows = rows.filter(function (q) {
      return q.status === "serving";
    });
  if (currentTab === "done")
    rows = rows.filter(function (q) {
      return q.status === "done";
    });
  if (rows.length === 0) {
    tbody.innerHTML =
      '<tr class="empty-row"><td colspan="5">Tidak ada antrian</td></tr>';
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
      var phoneCell =
        adminUnlocked && q.phone
          ? '<a href="tel:' +
            escHtml(q.phone) +
            '" class="phone-link">' +
            escHtml(q.phone) +
            "</a>"
          : adminUnlocked
            ? '<span class="no-phone">–</span>'
            : q.phone
              ? '<span class="no-phone">••••</span>'
              : '<span class="no-phone">–</span>';
      return (
        '<tr><td class="ticket-num-cell">' +
        q.id +
        "</td><td>" +
        escHtml(q.name) +
        "</td><td>" +
        phoneCell +
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

  // Safety net: localStorage was marked done but ticket section still visible
  if (myTicket.status === "done") {
    saveMyTicket(null);
    document.getElementById("ticketSection").style.display = "none";
    document.getElementById("formSection").style.display = "block";
    document.getElementById("patientName").value = "";
    document.getElementById("patientPhone").value = "";
    return;
  }

  // Use fbKey for exact match — prevents stale ticket after reset/new A001 by someone else
  var entry = myTicket.fbKey
    ? (liveState.queues || {})[myTicket.fbKey]
    : Object.values(liveState.queues || {}).find(function (q) {
        return q.id === myTicket.id;
      });

  // Ticket removed (e.g. after reset) — clear display
  if (!entry) {
    saveMyTicket(null);
    document.getElementById("ticketSection").style.display = "none";
    document.getElementById("formSection").style.display = "block";
    document.getElementById("patientName").value = "";
    document.getElementById("patientPhone").value = "";
    return;
  }

  if (entry.status !== myTicket.status) {
    saveMyTicket(Object.assign({}, myTicket, { status: entry.status }));
    if (entry.status === "serving") {
      showToast(
        "Nomor " + entry.id + " \u2013 Anda sedang dipanggil!",
        "success",
      );
      playBeep();
      playBeep();
    }
    if (entry.status === "done") {
      showToast("Konsultasi Anda selesai. Terima kasih!", "success");
      saveMyTicket(null);
      // Show done state on ticket instead of hiding it
      document.getElementById("ticketNote").style.display = "none";
      document.getElementById("ticketActions").style.display = "none";
      document.getElementById("ticketDoneBanner").style.display = "block";
      return;
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
// Auto-unlock admin if URL contains valid ?adminKey=
(function () {
  try {
    var params = new URLSearchParams(window.location.search);
    if (params.get("adminKey") === ADMIN_PIN) {
      window.history.replaceState({}, "", window.location.pathname);
      adminUnlocked = true;
      document.getElementById("adminLocked").style.display = "none";
      document.getElementById("adminUnlockedBar").style.display = "flex";
      showToast("Panel admin dibuka via QR. 🔓", "success");
    }
  } catch (e) {
    /* URLSearchParams not supported in very old browsers */
  }
})();
document.getElementById("queueTableBody").innerHTML =
  '<tr class="empty-row"><td colspan="5">Menghubungkan ke server...</td></tr>';

// Load settings first, then queue data
settingsRef.once("value").then(function (snap) {
  applySettings(snap.val());
});
settingsRef.on("value", function (snap) {
  applySettings(snap.val());
});

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
        // Use fbKey for exact lookup; fall back to id-match for old tickets without fbKey
        var storedEntry = myTicket.fbKey
          ? (data.queues || {})[myTicket.fbKey]
          : Object.values(data.queues || {}).find(function (q) {
              return q.id === myTicket.id;
            });
        if (storedEntry && storedEntry.status !== "done") {
          showTicket(storedEntry);
          document.getElementById("formSection").style.display = "none";
        } else {
          saveMyTicket(null); // not found or already served — clear
        }
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
