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
const ANTRIAN_ROOT = "antrian";
const queueDefsRef = db.ref(ANTRIAN_ROOT + "/queueDefs");
const MY_TICKET_KEY = "myTicket_masAri";

// ── State ──────────────────────────────────────────────────
let allQueueDefs = {}; // { defId: { name, avatar, personName, ... } }
let activeDefId = null; // Firebase key of selected queue definition
let activeDataRef = null; // db.ref("antrian/queueData/<defId>")
let activeListener = null; // bound "value" callback — cleaned up on queue switch

let liveState = null;
let currentTab = "all";
let adminUnlocked = false;

let currentDef = {}; // mirror of allQueueDefs[activeDefId]
let currentPaymentQRUrl = "QRANTRI.jpg";
let currentPaymentAmount = 0;
let pendingName = "";
let pendingPhone = "";

// ── Utilities ──────────────────────────────────────────────
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
  var m = n * 10;
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

// ── Apply Queue Definition to DOM ──────────────────────────
function applyDef(def) {
  currentDef = def || {};
  currentPaymentAmount = Number(currentDef.paymentAmount) || 0;
  currentPaymentQRUrl = currentDef.paymentQRUrl || "QRANTRI.jpg";

  var labelText = "Panel " + (currentDef.name || "Admin");
  var el;
  el = document.getElementById("headerTitle");
  if (el) el.textContent = currentDef.headerTitle || currentDef.name || "";
  el = document.getElementById("headerSubtitle");
  if (el)
    el.textContent =
      currentDef.headerSubtitle ||
      (currentDef.personName || "") +
        (currentDef.personTitle ? " \u2013 " + currentDef.personTitle : "");
  el = document.getElementById("headerAvatar");
  if (el) el.textContent = currentDef.avatar || "\uD83C\uDFAB";
  el = document.getElementById("profileName");
  if (el) el.textContent = currentDef.personName || "";
  el = document.getElementById("profileTitle");
  if (el) el.textContent = currentDef.personTitle || "";
  el = document.getElementById("adminLabelLocked");
  if (el) el.textContent = labelText;
  el = document.getElementById("adminLabelUnlocked");
  if (el) el.textContent = labelText;
  if (currentDef.name) document.title = currentDef.name + " \u2013 Antrian";
}

// ── Queue Selection Screen ──────────────────────────────────
function renderQueueSelectScreen() {
  var container = document.getElementById("queueCards");
  if (!container) return;

  var defs = Object.entries(allQueueDefs)
    .filter(function (kv) {
      return kv[1] && kv[1].active !== false;
    })
    .sort(function (a, b) {
      return (a[1].order || 0) - (b[1].order || 0);
    });

  var html = defs
    .map(function (kv) {
      var id = kv[0],
        def = kv[1];
      var paymentBadge =
        Number(def.paymentAmount) > 0
          ? '<div class="queue-card-payment">Rp ' +
            Number(def.paymentAmount).toLocaleString("id-ID") +
            "</div>"
          : "";
      return (
        '<div class="queue-card" onclick="selectQueue(\'' +
        id +
        "')\">" +
        '<div class="queue-card-avatar">' +
        escHtml(def.avatar || "\uD83C\uDFAB") +
        "</div>" +
        '<div class="queue-card-name">' +
        escHtml(def.name || "Antrian") +
        "</div>" +
        (def.personName
          ? '<div class="queue-card-sub">' +
            escHtml(def.personName) +
            (def.personTitle ? " \u00B7 " + escHtml(def.personTitle) : "") +
            "</div>"
          : "") +
        paymentBadge +
        '<button class="btn btn-primary" style="margin-top:14px;width:100%">Ambil Antrian</button>' +
        "</div>"
      );
    })
    .join("");

  if (adminUnlocked) {
    html +=
      '<div class="queue-card queue-card-add" onclick="openAddQueueModal()">' +
      '<div class="queue-card-avatar">&#xFF0B;</div>' +
      '<div class="queue-card-name">Tambah Antrian</div>' +
      "</div>";
  }

  if (!html) {
    html =
      '<p class="queue-empty">Belum ada antrian tersedia.<br>Buka panel admin untuk menambahkan antrian.</p>';
  }

  container.innerHTML = html;
}

function selectQueue(defId) {
  var def = allQueueDefs[defId];
  if (!def) return;

  // Detach previous real-time listener
  if (activeDataRef && activeListener) {
    activeDataRef.off("value", activeListener);
    activeListener = null;
  }

  activeDefId = defId;
  activeDataRef = db.ref(ANTRIAN_ROOT + "/queueData/" + defId);
  currentTab = "all";

  applyDef(def);

  // Show queue view
  document.getElementById("queueSelectSection").style.display = "none";
  document.getElementById("queueView").style.display = "block";
  document.getElementById("backBtn").style.display = "";

  // Reset UI state
  document.getElementById("ticketSection").style.display = "none";
  document.getElementById("paymentSection").style.display = "none";
  document.getElementById("formSection").style.display = "block";
  document.getElementById("patientName").value = "";
  document.getElementById("patientPhone").value = "";
  document.querySelectorAll(".tab").forEach(function (t) {
    t.classList.remove("active");
  });
  var allTab = document.querySelector(".tab[data-tab='all']");
  if (allTab) allTab.classList.add("active");
  document.getElementById("queueTableBody").innerHTML =
    '<tr class="empty-row"><td colspan="5">Menghubungkan ke server...</td></tr>';

  // Init queue data for today, then start listener
  activeDataRef
    .once("value")
    .then(function (snap) {
      var data = snap.val();
      if (!data || data.date !== getToday()) {
        activeDataRef.set({
          date: getToday(),
          counters: { A: 0 },
          currentServing: null,
          entries: {},
        });
        saveMyTicket(null);
      } else {
        // Restore existing ticket for this queue
        var myTicket = getMyTicket();
        if (myTicket && myTicket.queueDefId === activeDefId) {
          var storedEntry = myTicket.fbKey
            ? (data.entries || {})[myTicket.fbKey]
            : null;
          if (storedEntry && storedEntry.status !== "done") {
            showTicket(storedEntry);
            document.getElementById("formSection").style.display = "none";
          } else {
            saveMyTicket(null);
          }
        }
      }

      activeListener = function (snapshot) {
        renderAll(
          snapshot.val() || {
            date: getToday(),
            counters: { A: 0 },
            currentServing: null,
            entries: {},
          },
        );
      };
      activeDataRef.on("value", activeListener);
    })
    .catch(function () {
      showToast("Tidak dapat terhubung ke server.", "error");
    });
}

function backToQueueSelect() {
  if (activeDataRef && activeListener) {
    activeDataRef.off("value", activeListener);
    activeListener = null;
  }
  activeDefId = null;
  activeDataRef = null;
  liveState = null;

  document.getElementById("queueView").style.display = "none";
  document.getElementById("queueSelectSection").style.display = "block";
  document.getElementById("backBtn").style.display = "none";

  document.getElementById("headerTitle").textContent = "Pilih Antrian";
  document.getElementById("headerSubtitle").textContent =
    "Pilih layanan yang Anda butuhkan";
  document.getElementById("headerAvatar").textContent = "\uD83C\uDFAB";
  document.getElementById("adminLabelLocked").textContent = "Panel Admin";
  document.getElementById("adminLabelUnlocked").textContent = "Panel Admin";
  document.title = "Aplikasi Antrian";

  renderQueueSelectScreen();
}

// ── Queue Definition Management (Admin) ────────────────────
function openAddQueueModal() {
  if (!adminUnlocked) {
    openPinModal();
    return;
  }
  document.getElementById("settingsModalTitle").textContent =
    "Tambah Antrian Baru";
  document.getElementById("settingsDefId").value = "";
  document.getElementById("setQueueName").value = "";
  document.getElementById("setQueueAvatar").value = "\uD83C\uDFAB";
  document.getElementById("setHeaderTitle").value = "";
  document.getElementById("setHeaderSubtitle").value = "";
  document.getElementById("setProfileName").value = "";
  document.getElementById("setProfileTitle").value = "";
  document.getElementById("setServiceName").value = "";
  document.getElementById("setPaymentMerchant").value = "";
  document.getElementById("setPaymentAmount").value = "0";
  document.getElementById("setPaymentQR").value = "QRANTRI.jpg";
  document.getElementById("settingsDeleteBtn").style.display = "none";
  document.getElementById("settingsOverlay").classList.add("open");
}

function openSettingsModal() {
  if (!adminUnlocked) {
    openPinModal();
    return;
  }
  if (!activeDefId) {
    openAddQueueModal();
    return;
  }
  var def = allQueueDefs[activeDefId] || {};
  document.getElementById("settingsModalTitle").textContent = "Edit Antrian";
  document.getElementById("settingsDefId").value = activeDefId;
  document.getElementById("setQueueName").value = def.name || "";
  document.getElementById("setQueueAvatar").value =
    def.avatar || "\uD83C\uDFAB";
  document.getElementById("setHeaderTitle").value =
    def.headerTitle || def.name || "";
  document.getElementById("setHeaderSubtitle").value = def.headerSubtitle || "";
  document.getElementById("setProfileName").value = def.personName || "";
  document.getElementById("setProfileTitle").value = def.personTitle || "";
  document.getElementById("setServiceName").value = def.serviceName || "";
  document.getElementById("setPaymentMerchant").value =
    def.paymentMerchant || "";
  document.getElementById("setPaymentAmount").value = def.paymentAmount || 0;
  document.getElementById("setPaymentQR").value =
    def.paymentQRUrl || "QRANTRI.jpg";
  document.getElementById("settingsDeleteBtn").style.display = "";
  document.getElementById("settingsOverlay").classList.add("open");
}

function closeSettingsModal(e) {
  if (e && e.target !== document.getElementById("settingsOverlay")) return;
  document.getElementById("settingsOverlay").classList.remove("open");
}

function saveSettings() {
  var defId = document.getElementById("settingsDefId").value;
  var name =
    document.getElementById("setQueueName").value.trim() || "Antrian Baru";
  var def = {
    name: name,
    avatar:
      document.getElementById("setQueueAvatar").value.trim() || "\uD83C\uDFAB",
    headerTitle: document.getElementById("setHeaderTitle").value.trim() || name,
    headerSubtitle:
      document.getElementById("setHeaderSubtitle").value.trim() || "",
    personName: document.getElementById("setProfileName").value.trim() || "",
    personTitle: document.getElementById("setProfileTitle").value.trim() || "",
    serviceName: document.getElementById("setServiceName").value.trim() || name,
    paymentMerchant:
      document.getElementById("setPaymentMerchant").value.trim() || "",
    paymentAmount:
      parseInt(document.getElementById("setPaymentAmount").value, 10) || 0,
    paymentQRUrl:
      document.getElementById("setPaymentQR").value.trim() || "QRANTRI.jpg",
    active: true,
    order: 0,
  };

  var ref = defId ? queueDefsRef.child(defId) : queueDefsRef.push();
  ref
    .set(def)
    .then(function () {
      document.getElementById("settingsOverlay").classList.remove("open");
      showToast("Antrian berhasil disimpan.", "success");
      if (!defId) {
        // Auto-select newly created queue
        selectQueue(ref.key);
      } else if (defId === activeDefId) {
        applyDef(def);
      }
    })
    .catch(function () {
      showToast("Gagal menyimpan pengaturan.", "error");
    });
}

function deleteQueueDef() {
  var defId = document.getElementById("settingsDefId").value;
  if (!defId) return;
  if (
    !window.confirm(
      "Hapus antrian ini? Data tiket yang ada tidak ikut terhapus.",
    )
  )
    return;
  queueDefsRef
    .child(defId)
    .remove()
    .then(function () {
      document.getElementById("settingsOverlay").classList.remove("open");
      showToast("Antrian dihapus.", "warning");
      if (activeDefId === defId) backToQueueSelect();
    })
    .catch(function () {
      showToast("Gagal menghapus antrian.", "error");
    });
}

// ── Phone Validation ───────────────────────────────────────
function isValidPhone(p) {
  if (!p) return true;
  return /^(\+62|62|0)[0-9][\d\s\-]{6,13}$/.test(p);
}

// ── Take Queue ─────────────────────────────────────────────
async function requestQueue() {
  var name = document.getElementById("patientName").value.trim() || "Tamu";
  var phone = document.getElementById("patientPhone").value.trim();
  if (phone && !isValidPhone(phone)) {
    showToast("Nomor HP tidak valid. Contoh: 0812-3456-7890", "error");
    document.getElementById("patientPhone").focus();
    return;
  }
  if (currentPaymentAmount > 0) {
    pendingName = name;
    pendingPhone = phone;
    var qrImg = document.getElementById("paymentQRImage");
    var qrLoading = document.getElementById("paymentQRLoading");
    qrImg.style.display = "none";
    qrImg.src = "";
    qrLoading.style.display = "flex";
    document.getElementById("paymentAmountDisplay").textContent =
      "Rp " + currentPaymentAmount.toLocaleString("id-ID");
    document.getElementById("formSection").style.display = "none";
    document.getElementById("paymentSection").style.display = "flex";
    try {
      var resp = await fetch("/api/create-payment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          gross_amount: currentPaymentAmount,
          customer_name: name,
          customer_phone: phone,
        }),
      });
      var data = await resp.json();
      if (!resp.ok) throw new Error(data.error || "API error " + resp.status);
      var qrSrc = data.qr_string
        ? "https://api.qrserver.com/v1/create-qr-code/?size=260x260&margin=10&data=" +
          encodeURIComponent(data.qr_string)
        : data.qr_url || null;
      if (qrSrc) {
        qrImg.src = qrSrc;
        qrImg.style.display = "";
        qrLoading.style.display = "none";
      } else {
        throw new Error(data.error || "No QR returned");
      }
    } catch (e) {
      qrImg.src = currentPaymentQRUrl;
      qrImg.style.display = "";
      qrLoading.style.display = "none";
      showToast("Dynamic QR gagal: " + e.message, "error");
    }
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
  if (!activeDataRef || !activeDefId) {
    showToast("Pilih antrian terlebih dahulu.", "error");
    return;
  }
  var counterRef = activeDataRef.child("counters/A");
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
        service: currentDef.serviceName || currentDef.name || "",
        takenAt: now,
        status: "waiting",
      };
      var newRef = activeDataRef.child("entries").push(entry);
      saveMyTicket(
        Object.assign({}, entry, {
          fbKey: newRef.key,
          queueDefId: activeDefId,
        }),
      );
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
  var entries = liveState ? Object.values(liveState.entries || {}) : [];
  var wb = entries.filter(function (q) {
    return q.status === "waiting" && q.takenAt < entry.takenAt;
  }).length;

  document.getElementById("ticketDoneBanner").style.display = "none";
  document.getElementById("ticketNote").style.display = "";
  document.getElementById("ticketActions").style.display = "";
  document.getElementById("ticketCancelBtn").style.display = "";

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
  if (!myTicket || !activeDataRef) return;
  activeDataRef
    .child("entries/" + myTicket.fbKey)
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

// ── Admin Auth ─────────────────────────────────────────────
function openPinModal() {
  document.getElementById("pinInput").value = "";
  document.getElementById("pinError").textContent = "";
  document.getElementById("adminQRImage").src =
    currentPaymentQRUrl || "QRANTRI.jpg";
  document.getElementById("adminPayAmount").textContent =
    "Rp " + (currentPaymentAmount || 0).toLocaleString("id-ID");
  document.getElementById("pinOverlay").classList.add("open");
  setTimeout(function () {
    document.getElementById("pinInput").focus();
  }, 100);
}

function closePinModal(e) {
  if (e && e.target !== document.getElementById("pinOverlay")) return;
  document.getElementById("pinOverlay").classList.remove("open");
}

async function submitPin() {
  var entered = document.getElementById("pinInput").value;
  var errEl = document.getElementById("pinError");
  errEl.textContent = "";
  try {
    var resp = await fetch("/api/verify-pin", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pin: entered }),
    });
    var data = await resp.json();
    if (data.ok) {
      adminUnlocked = true;
      document.getElementById("pinOverlay").classList.remove("open");
      document.getElementById("adminLocked").style.display = "none";
      document.getElementById("adminUnlockedBar").style.display = "flex";
      showToast("Panel berhasil dibuka.", "success");
      if (!activeDefId) renderQueueSelectScreen();
    } else if (resp.status === 500) {
      errEl.textContent =
        "Server belum dikonfigurasi \u2013 tambahkan ADMIN_PIN di Vercel lalu redeploy.";
    } else {
      errEl.textContent = "PIN salah, coba lagi.";
      document.getElementById("pinInput").value = "";
      document.getElementById("pinInput").focus();
    }
  } catch (e) {
    errEl.textContent = "Gagal terhubung ke server, coba lagi.";
  }
}

function lockAdmin() {
  adminUnlocked = false;
  document.getElementById("adminLocked").style.display = "flex";
  document.getElementById("adminUnlockedBar").style.display = "none";
  if (!activeDefId) renderQueueSelectScreen();
}

// ── Admin Actions ──────────────────────────────────────────
function callNext() {
  if (!adminUnlocked) {
    openPinModal();
    return;
  }
  if (!liveState || !activeDataRef) return;

  var entries = Object.entries(liveState.entries || {})
    .map(function (kv) {
      return Object.assign({}, kv[1], { fbKey: kv[0] });
    })
    .sort(function (a, b) {
      return a.takenAt.localeCompare(b.takenAt);
    });

  var next = entries.find(function (q) {
    return q.status === "waiting";
  });
  var base = ANTRIAN_ROOT + "/queueData/" + activeDefId;
  var updates = {};

  if (liveState.currentServing && liveState.currentServing.fbKey) {
    updates[base + "/entries/" + liveState.currentServing.fbKey + "/status"] =
      "done";
  }
  if (!next) {
    showToast("Tidak ada antrian yang menunggu.", "warning");
    return;
  }
  updates[base + "/entries/" + next.fbKey + "/status"] = "serving";
  updates[base + "/currentServing"] = Object.assign({}, next, {
    status: "serving",
  });

  db.ref()
    .update(updates)
    .then(function () {
      showToast(
        "Memanggil nomor " + next.id + " \u2013 " + next.name,
        "success",
      );
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
      " \u2013 " +
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
  var base = ANTRIAN_ROOT + "/queueData/" + activeDefId;
  var updates = {};
  updates[base + "/entries/" + cs.fbKey + "/status"] = "done";
  updates[base + "/currentServing"] = null;
  db.ref()
    .update(updates)
    .then(function () {
      showToast(
        "Nomor " + cs.id + " \u2013 " + cs.name + " selesai dilayani.",
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
  if (!activeDataRef) {
    showToast("Pilih antrian terlebih dahulu.", "warning");
    return;
  }
  if (!window.confirm("Reset semua antrian hari ini?")) return;
  activeDataRef
    .set({
      date: getToday(),
      counters: { A: 0 },
      currentServing: null,
      entries: {},
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

// ── Tabs ───────────────────────────────────────────────────
function switchTab(el, tab) {
  document.querySelectorAll(".tab").forEach(function (t) {
    t.classList.remove("active");
  });
  el.classList.add("active");
  currentTab = tab;
  renderQueueTable();
}

// ── Render ─────────────────────────────────────────────────
function renderAll(data) {
  liveState = data;
  renderStatusPanel();
  renderQueueTable();
  checkMyTicketStatus();
}

function renderStatusPanel() {
  var serving =
    liveState && liveState.currentServing ? liveState.currentServing.id : "-";
  var entries = Object.values((liveState && liveState.entries) || {});
  document.getElementById("currentNumber").textContent = serving;
  document.getElementById("waitingCount").textContent = entries.filter(
    function (q) {
      return q.status === "waiting";
    },
  ).length;
  document.getElementById("totalCount").textContent = entries.length;
}

function renderQueueTable() {
  var tbody = document.getElementById("queueTableBody");
  if (!liveState) {
    tbody.innerHTML =
      '<tr class="empty-row"><td colspan="5">Menghubungkan ke server...</td></tr>';
    return;
  }
  var rows = Object.entries(liveState.entries || {})
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
            ? '<span class="no-phone">\u2013</span>'
            : q.phone
              ? '<span class="no-phone">\u2022\u2022\u2022\u2022</span>'
              : '<span class="no-phone">\u2013</span>';
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
  if (myTicket.queueDefId !== activeDefId) return;

  if (myTicket.status === "done") {
    saveMyTicket(null);
    document.getElementById("ticketSection").style.display = "none";
    document.getElementById("formSection").style.display = "block";
    document.getElementById("patientName").value = "";
    document.getElementById("patientPhone").value = "";
    return;
  }

  var entry = myTicket.fbKey ? (liveState.entries || {})[myTicket.fbKey] : null;

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
      document.getElementById("ticketNote").style.display = "none";
      document.getElementById("ticketActions").style.display = "none";
      document.getElementById("ticketDoneBanner").style.display = "block";
      return;
    }
  }

  if (document.getElementById("ticketSection").style.display !== "none") {
    var entries = Object.values(liveState.entries || {});
    var wb = entries.filter(function (q) {
      return q.status === "waiting" && q.takenAt < entry.takenAt;
    }).length;
    document.getElementById("ticketEstimate").textContent = estimateWait(wb);
  }
}

// ── Bootstrap ──────────────────────────────────────────────
// Auto-unlock via ?adminKey= URL param
(async function () {
  try {
    var params = new URLSearchParams(window.location.search);
    var key = params.get("adminKey");
    if (!key) return;
    var resp = await fetch("/api/verify-pin", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pin: key }),
    });
    var data = await resp.json();
    if (data.ok) {
      window.history.replaceState({}, "", window.location.pathname);
      adminUnlocked = true;
      document.getElementById("adminLocked").style.display = "none";
      document.getElementById("adminUnlockedBar").style.display = "flex";
      showToast("Panel admin dibuka via QR. \uD83D\uDD13", "success");
    }
  } catch (e) {
    /* ignore */
  }
})();

// Load all queue definitions — drives the selection screen
queueDefsRef.on("value", function (snap) {
  allQueueDefs = snap.val() || {};
  if (!activeDefId) {
    renderQueueSelectScreen();
  }
});
