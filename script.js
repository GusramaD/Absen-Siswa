// ==========================================
// GLOBAL STATE & CONFIGURATION
// ==========================================
let studentsData = [];
let attendanceLogs = [];
let usersData = [];
let currentUser = null; // null = Guest
let selectedScanClass = null; // Storing currently chosen class for scanning

// URL Google Apps Script
const GOOGLE_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbxfaAg3kJEfEF4ucqnkzkA_iRnGzFEQWXRK3N2do_J-5jwSYz_GKFvy5yCjXD4GXEUz/exec';

// State Pemindai Kamera Direct API
let html5QrCode = null;
let isCameraActive = false;
let isProcessingScan = false;

// List Kelas Standar
const DEFAULT_CLASSES = ['Kelas I', 'Kelas II', 'Kelas III', 'Kelas IV', 'Kelas V', 'Kelas VI'];

// ==========================================
// HELPER FUNCTIONS
// ==========================================
function cleanDateStr(dStr, timestamp) {
  if (timestamp && typeof timestamp === 'string' && timestamp.includes(',')) {
    const tsDate = timestamp.split(',')[0].trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(tsDate)) {
      return tsDate;
    }
  }
  if (!dStr) return '';
  let str = String(dStr).trim();
  if (str.includes('T')) str = str.split('T')[0];
  if (str.includes(',')) str = str.split(',')[0].trim();
  return str;
}

function getTodayDateStr() {
  return new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Makassar' });
}

function isClassMatch(classA, classB) {
  if (!classA || !classB || classA === 'ALL' || classB === 'ALL') return true;
  return classA.trim().toLowerCase() === classB.trim().toLowerCase();
}

function getUniqueStudents(list) {
  const map = new Map();
  list.forEach(s => {
    if (s && s.id) {
      map.set(String(s.id).trim().toLowerCase(), s);
    }
  });
  return Array.from(map.values());
}

function getUniqueLogs(list) {
  const map = new Map();
  list.forEach(l => {
    if (l && l.studentId && l.status !== 'Tidak Hadir' && !String(l.timestamp).includes('--:--:--')) {
      const resolvedDate = cleanDateStr(l.dateStr, l.timestamp);
      const studentKey = String(l.studentId).trim().toLowerCase();
      const key = `${studentKey}_${resolvedDate}`;
      if (!map.has(key)) {
        map.set(key, { ...l, dateStr: resolvedDate });
      }
    }
  });
  return Array.from(map.values());
}

function sendToGoogleSheets(payload) {
  if (!GOOGLE_SCRIPT_URL) return;
  fetch(GOOGLE_SCRIPT_URL, {
    method: 'POST',
    mode: 'no-cors',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'data=' + encodeURIComponent(JSON.stringify(payload))
  }).catch(err => console.error('Gagal kirim ke Google Sheets:', err));
}

// ==========================================
// INITIALIZATION & LOCAL STORAGE
// ==========================================
window.addEventListener('DOMContentLoaded', () => {
  loadDataFromLocalStorage();
  updateAuthUI();
  updateAllViews();
  syncDataFromGoogleSheets();

  const barcodeInput = document.getElementById('barcodeInput');
  if (barcodeInput) {
    barcodeInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        const code = barcodeInput.value.trim();
        if (code) processBarcodeScan(code);
        barcodeInput.value = '';
      }
    });
  }
});

function loadDataFromLocalStorage() {
  const savedStudents = localStorage.getItem('sd1tiga_absensi_students');
  const savedLogs = localStorage.getItem('sd1tiga_absensi_logs');
  const savedUsers = localStorage.getItem('sd1tiga_users');
  const savedCurrentUser = localStorage.getItem('sd1tiga_current_user');

  if (savedStudents) studentsData = getUniqueStudents(JSON.parse(savedStudents));
  if (savedLogs) attendanceLogs = getUniqueLogs(JSON.parse(savedLogs));
  
  if (savedUsers) {
    usersData = JSON.parse(savedUsers);
  } else {
    usersData = [
      { id: 'u0', nama: 'Administrator Sekolah', username: 'admin', password: 'admin123', role: 'admin', assignedClass: 'ALL' }
    ];
    saveUsersToLocalStorage();
  }

  if (savedCurrentUser) currentUser = JSON.parse(savedCurrentUser);
}

function saveDataToLocalStorage() {
  studentsData = getUniqueStudents(studentsData);
  attendanceLogs = getUniqueLogs(attendanceLogs);
  localStorage.setItem('sd1tiga_absensi_students', JSON.stringify(studentsData));
  localStorage.setItem('sd1tiga_absensi_logs', JSON.stringify(attendanceLogs));
}

function saveUsersToLocalStorage() {
  localStorage.setItem('sd1tiga_users', JSON.stringify(usersData));
}

// ==========================================
// SYSTEM PILIHAN KELAS UNTUK PEMINDAI
// ==========================================
function renderClassSelectionGrid() {
  const container = document.getElementById('classSelectionGrid');
  if (!container) return;

  // Mengumpulkan kelas yang ada dari siswa + kelas standar
  const allClasses = [...new Set([...DEFAULT_CLASSES, ...studentsData.map(s => s.kelas)])].sort();

  container.innerHTML = allClasses.map(cls => {
    const studentCount = studentsData.filter(s => isClassMatch(s.kelas, cls)).length;
    return `
      <button onclick="selectClassForScan('${cls}')" class="glass-card bg-white hover:bg-sky-50 border-2 border-sky-200 hover:border-sky-500 rounded-2xl p-4 sm:p-5 text-center transition shadow-sm hover:shadow-md flex flex-col items-center group">
        <div class="w-10 h-10 rounded-xl bg-sky-100 text-sky-600 flex items-center justify-center font-bold text-lg mb-2 group-hover:scale-110 transition-transform">
          <i class="fa-solid fa-graduation-cap"></i>
        </div>
        <h3 class="text-sm sm:text-base font-extrabold text-slate-800 font-heading group-hover:text-sky-900">${cls}</h3>
        <span class="text-[11px] font-bold text-sky-600 mt-1">${studentCount} Siswa</span>
      </button>
    `;
  }).join('');
}

function selectClassForScan(className) {
  selectedScanClass = className;
  document.getElementById('activeClassNameBadge').textContent = className;
  
  document.getElementById('scanClassSelectionStep').classList.add('hidden');
  document.getElementById('scanActiveStep').classList.remove('hidden');

  const barcodeInput = document.getElementById('barcodeInput');
  if (barcodeInput) barcodeInput.focus();

  showToast(`Mode Pemindai untuk ${className} Aktif`, '📌');
}

function backToClassSelection() {
  if (isCameraActive) {
    toggleCameraScanner(); // Matikan kamera jika aktif
  }
  selectedScanClass = null;
  document.getElementById('scanActiveStep').classList.add('hidden');
  document.getElementById('scanClassSelectionStep').classList.remove('hidden');
  renderClassSelectionGrid();
}

// ==========================================
// AUTHENTICATION SYSTEM
// ==========================================
function updateAuthUI() {
  const authContainer = document.getElementById('authStatusContainer');
  const navAdminBtn = document.getElementById('navAdminBtn');

  if (currentUser) {
    const classBadge = currentUser.role === 'guru' ? `[${currentUser.assignedClass}]` : '[ADMIN]';
    authContainer.innerHTML = `
      <div class="flex items-center gap-1.5 sm:gap-2 bg-sky-50 px-2.5 sm:px-3 py-1 sm:py-1.5 rounded-xl border border-sky-200">
        <span class="text-xs font-bold text-sky-900 truncate max-w-[120px] sm:max-w-none">👤 ${currentUser.nama} ${classBadge}</span>
        <button onclick="handleLogout()" class="text-xs bg-rose-500 hover:bg-rose-600 text-white font-bold px-2 py-1 rounded-lg transition" title="Logout">
          <i class="fa-solid fa-right-from-bracket"></i>
        </button>
      </div>
    `;

    if (currentUser.role === 'admin') {
      navAdminBtn.classList.remove('hidden');
    } else {
      navAdminBtn.classList.add('hidden');
    }
  } else {
    authContainer.innerHTML = `
      <button onclick="openLoginModal()" class="bg-sky-100 hover:bg-sky-200 text-sky-800 font-bold px-3 py-1.5 sm:px-4 sm:py-2 rounded-xl text-xs sm:text-sm transition flex items-center gap-1.5 border border-sky-300">
        <i class="fa-solid fa-right-to-bracket"></i> Login
      </button>
    `;
    navAdminBtn.classList.add('hidden');
  }
}

function openLoginModal() {
  document.getElementById('loginModal').classList.remove('hidden');
}

function closeLoginModal() {
  document.getElementById('loginModal').classList.add('hidden');
}

function handleLoginSubmit(e) {
  e.preventDefault();
  const u = document.getElementById('loginUsername').value.trim();
  const p = document.getElementById('loginPassword').value.trim();

  const found = usersData.find(user => user.username === u && user.password === p);

  if (found) {
    currentUser = found;
    localStorage.setItem('sd1tiga_current_user', JSON.stringify(currentUser));
    updateAuthUI();
    closeLoginModal();
    showToast(`Selamat datang, ${currentUser.nama}!`, '🔑');
    
    if (currentUser.role === 'admin') {
      switchTab('admin');
    } else {
      switchTab('dashboard');
    }
  } else {
    showToast('❌ Username atau password salah!', '⚠️');
  }
}

function handleLogout() {
  currentUser = null;
  localStorage.removeItem('sd1tiga_current_user');
  updateAuthUI();
  switchTab('scan');
  showToast('Anda telah logout.', '👋');
}

// ==========================================
// TAB SWITCHING
// ==========================================
function switchTab(tabName) {
  if (tabName === 'dashboard' && !currentUser) {
    showToast('🔒 Silakan Login terlebih dahulu untuk melihat Laporan.');
    openLoginModal();
    return;
  }

  if (tabName === 'admin' && (!currentUser || currentUser.role !== 'admin')) {
    showToast('⛔ Hanya Administrator yang dapat mengakses Panel Admin!');
    return;
  }

  document.querySelectorAll('.tab-content').forEach(el => el.classList.add('hidden'));
  document.querySelectorAll('nav button').forEach(el => {
    el.classList.remove('bg-sky-600', 'text-white', 'shadow-sm');
    el.classList.add('text-slate-600');
  });

  if (tabName === 'scan') {
    document.getElementById('tabScan').classList.remove('hidden');
    document.getElementById('navScanBtn').classList.add('bg-sky-600', 'text-white', 'shadow-sm');
    renderClassSelectionGrid();
  } else if (tabName === 'dashboard') {
    document.getElementById('tabDashboard').classList.remove('hidden');
    document.getElementById('navDashboardBtn').classList.add('bg-sky-600', 'text-white', 'shadow-sm');
    syncDataFromGoogleSheets();
    renderDashboard();
  } else if (tabName === 'admin') {
    document.getElementById('tabAdmin').classList.remove('hidden');
    document.getElementById('navAdminBtn').classList.add('bg-sky-600', 'text-white', 'shadow-sm');
    renderStudentTable();
    renderUsersTable();
  }
}

// ==========================================
// PEMINDAI QR CODE & PENCATATAN ABSENSI
// ==========================================
function processBarcodeScan(barcodeCode) {
  if (isProcessingScan) return;
  isProcessingScan = true;

  const targetCode = String(barcodeCode).trim().toLowerCase();
  const student = studentsData.find(s => String(s.id).trim().toLowerCase() === targetCode);

  // 1. Validasi: Apakah Siswa Terdaftar?
  if (!student) {
    showToast(`❌ Kode "${barcodeCode}" tidak ditemukan!`, '⚠️');
    setTimeout(() => { isProcessingScan = false; }, 1800);
    return;
  }

  // 2. Validasi: APAKAH KELAS SISWA SESUAI DENGAN KELAS YANG DIPILIH?
  if (!selectedScanClass || !isClassMatch(student.kelas, selectedScanClass)) {
    showToast(`⛔ Gagal! ${student.nama} terdaftar di ${student.kelas}, bukan ${selectedScanClass || 'kelas yang dipilih'}!`, '⛔');
    setTimeout(() => { isProcessingScan = false; }, 2500);
    return;
  }

  // 3. Validasi: CEGAH ABSEN 2 KALI (PER HARI)
  const todayStr = getTodayDateStr();
  const existingLog = attendanceLogs.find(l => 
    cleanDateStr(l.dateStr, l.timestamp) === todayStr && 
    String(l.studentId).trim().toLowerCase() === targetCode &&
    l.status !== 'Tidak Hadir'
  );

  if (existingLog) {
    showToast(`⚠️ Absen ditolak! ${student.nama} sudah melakukan absensi hari ini (${existingLog.status})!`, '⚠️');
    setTimeout(() => { isProcessingScan = false; }, 2500);
    return;
  }

  // 4. Catat Absensi Pertama
  const now = new Date();
  const timeStrWita = now.toLocaleTimeString('id-ID', { timeZone: 'Asia/Makassar', hour12: false }).replace(/\./g, ':');
  const timeParts = timeStrWita.split(':');
  
  const hours = (timeParts[0] || '00').padStart(2, '0');
  const minutes = (timeParts[1] || '00').padStart(2, '0');
  const seconds = (timeParts[2] || '00').padStart(2, '0');

  const currentFullTime24 = `${hours}:${minutes}:${seconds}`;
  const finalStatus = document.getElementById('scanStatusMode').value || 'Hadir';

  const newLog = {
    id: 'log_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
    studentId: student.id,
    nama: student.nama,
    kelas: student.kelas,
    status: finalStatus,
    dateStr: todayStr,
    timestamp: `${todayStr}, ${currentFullTime24} WITA`
  };

  attendanceLogs.push(newLog);
  saveDataToLocalStorage();
  renderDashboard();

  sendToGoogleSheets(newLog);

  const resultCard = document.getElementById('lastScanResultCard');
  if (resultCard) {
    resultCard.classList.remove('hidden');
    document.getElementById('lastStudentName').textContent = student.nama;
    document.getElementById('lastStudentMeta').textContent = `${student.kelas} | Status: ${finalStatus}`;
    document.getElementById('lastStudentTime').textContent = `${currentFullTime24} WITA`;
  }

  confetti({ particleCount: 25, spread: 40, origin: { y: 0.8 } });
  showToast(`✅ Absensi ${student.nama} (${finalStatus}) berhasil dicatat!`, '🎉');

  setTimeout(() => { isProcessingScan = false; }, 2000);
}

// Kontrol Kamera Direct API
async function toggleCameraScanner() {
  const btn = document.getElementById('btnToggleCamera');
  const previewContainer = document.getElementById('cameraPreviewContainer');

  if (isCameraActive) {
    if (html5QrCode) {
      try {
        await html5QrCode.stop();
        html5QrCode.clear();
      } catch (err) {
        console.error("Gagal menghentikan kamera:", err);
      }
    }
    isCameraActive = false;
    if (previewContainer) previewContainer.classList.add('hidden');
    if (btn) btn.innerHTML = '<i class="fa-solid fa-camera"></i> Aktifkan Kamera HP / Laptop';
    showToast('Kamera dimatikan.', '📷');
  } else {
    if (!html5QrCode) {
      html5QrCode = new Html5Qrcode("reader");
    }

    const config = { 
      fps: 15, 
      qrbox: (viewfinderWidth, viewfinderHeight) => {
        const minEdge = Math.min(viewfinderWidth, viewfinderHeight);
        return {
          width: Math.floor(minEdge * 0.9),
          height: Math.floor(minEdge * 0.9)
        };
      },
      aspectRatio: 1.0,
      videoConstraints: {
        facingMode: "environment",
        width: { min: 640, ideal: 1280, max: 1920 },
        height: { min: 480, ideal: 720, max: 1080 }
      }
    };

    try {
      if (btn) btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Membuka Kamera...';
      if (previewContainer) previewContainer.classList.remove('hidden');

      await html5QrCode.start(
        { facingMode: "environment" },
        config,
        (decodedText) => {
          processBarcodeScan(decodedText);
        },
        (errorMessage) => {}
      );

      isCameraActive = true;
      if (btn) btn.innerHTML = '<i class="fa-solid fa-camera-rotate"></i> Matikan Kamera';
      showToast('Kamera berhasil diaktifkan.', '🎥');
    } catch (err) {
      console.error("Gagal membuka kamera:", err);
      isCameraActive = false;
      if (previewContainer) previewContainer.classList.add('hidden');
      if (btn) btn.innerHTML = '<i class="fa-solid fa-camera"></i> Aktifkan Kamera HP / Laptop';
      showToast('❌ Akses kamera ditolak.', '⚠️');
    }
  }
}

// ==========================================
// MODAL CETAK MASSAL QR CODE
// ==========================================
function openBulkQrModal() {
  populateBulkClassSelect();
  renderBulkQrCards();
  document.getElementById('bulkQrModal').classList.remove('hidden');
}

function closeBulkQrModal() {
  document.getElementById('bulkQrModal').classList.add('hidden');
}

function populateBulkClassSelect() {
  const select = document.getElementById('bulkClassFilter');
  if (!select) return;
  select.innerHTML = '<option value="ALL">🌟 Semua Kelas</option>';
  const classes = [...new Set(studentsData.map(s => s.kelas))].sort();
  classes.forEach(cls => {
    select.appendChild(new Option(`📚 ${cls}`, cls));
  });
}

function renderBulkQrCards() {
  const filter = document.getElementById('bulkClassFilter').value;
  const container = document.getElementById('bulkQrContainer');
  container.innerHTML = '';

  let filtered = filter === 'ALL' ? studentsData : studentsData.filter(s => isClassMatch(s.kelas, filter));

  if (filtered.length === 0) {
    container.innerHTML = '<div class="col-span-full text-center text-slate-400 p-8">Belum ada data siswa.</div>';
    return;
  }

  filtered.forEach(student => {
    const card = document.createElement('div');
    card.className = 'qr-card-print glass-card rounded-2xl p-4 border-2 border-sky-200 bg-white shadow-sm flex flex-col items-center text-center relative';
    const qrDivId = `bulk_qr_${student.id.replace(/[^a-zA-Z0-9]/g, '_')}`;

    card.innerHTML = `
      <div class="text-[10px] font-extrabold text-sky-800 uppercase tracking-widest mb-1">SD NEGERI 1 TIGA</div>
      <h4 class="text-sm font-extrabold text-slate-800 leading-tight mb-0.5">${student.nama}</h4>
      <p class="text-xs font-bold text-sky-600 mb-2">${student.kelas} | ID: ${student.id}</p>
      <div class="bg-white p-2 rounded-xl border border-slate-200 shadow-inner flex justify-center items-center">
        <div id="${qrDivId}"></div>
      </div>
    `;

    container.appendChild(card);

    setTimeout(() => {
      const el = document.getElementById(qrDivId);
      if (el && el.children.length === 0) {
        new QRCode(el, {
          text: String(student.id),
          width: 120,
          height: 120,
          colorDark: "#000000",
          colorLight: "#ffffff",
          correctLevel: QRCode.CorrectLevel.H
        });
      }
    }, 50);
  });
}

// ==========================================
// GENERATOR QR CODE SISWA TUNGGAL
// ==========================================
function openBarcodeModal(studentId) {
  const student = studentsData.find(s => String(s.id).trim().toLowerCase() === String(studentId).trim().toLowerCase());
  if (!student) return;

  document.getElementById('barcodeStudentName').textContent = student.nama;
  document.getElementById('barcodeStudentClass').textContent = student.kelas;

  const container = document.getElementById('studentBarcodeCanvas');
  container.innerHTML = '';

  new QRCode(container, {
    text: String(student.id),
    width: 160,
    height: 160,
    colorDark: "#000000",
    colorLight: "#ffffff",
    correctLevel: QRCode.CorrectLevel.H
  });

  document.getElementById('barcodeModal').classList.remove('hidden');
}

function closeBarcodeModal() {
  document.getElementById('barcodeModal').classList.add('hidden');
}

function handleAddSingleStudent(e) {
  e.preventDefault();
  if (!currentUser || currentUser.role !== 'admin') {
    showToast('⛔ Hanya Administrator yang dapat menambahkan siswa.');
    return;
  }

  const id = document.getElementById('manualIdSiswa').value.trim();
  const nama = document.getElementById('manualNamaSiswa').value.trim();
  const kelas = document.getElementById('manualKelasSiswa').value;

  if (studentsData.some(s => String(s.id).trim().toLowerCase() === id.toLowerCase())) {
    showToast('⚠️ ID/NIS Siswa sudah terdaftar!');
    return;
  }

  const newStudentPayload = { action: 'ADD_STUDENT', id, nama, kelas };

  studentsData.push({ id, nama, kelas });
  saveDataToLocalStorage();
  updateAllViews();

  sendToGoogleSheets(newStudentPayload);

  e.target.reset();
  showToast(`✅ Siswa "${nama}" berhasil ditambahkan!`, '👤');
}

function deleteSingleStudent(studentId) {
  if (!currentUser || currentUser.role !== 'admin') {
    showToast('⛔ Hanya Administrator yang dapat menghapus siswa.');
    return;
  }

  if (confirm('Apakah Anda yakin ingin menghapus siswa ini?')) {
    studentsData = studentsData.filter(s => String(s.id).trim().toLowerCase() !== String(studentId).trim().toLowerCase());
    saveDataToLocalStorage();
    updateAllViews();

    sendToGoogleSheets({ action: 'DELETE_STUDENT', id: studentId });

    showToast('🗑️ Data siswa berhasil dihapus.');
  }
}

function renderStudentTable() {
  studentsData = getUniqueStudents(studentsData);
  const filter = document.getElementById('teacherClassFilter').value;
  const tbody = document.getElementById('studentTableBody');

  let filtered = filter === 'ALL' ? studentsData : studentsData.filter(s => isClassMatch(s.kelas, filter));
  document.getElementById('totalStudentsBadge').textContent = filtered.length;

  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5" class="p-6 text-center text-slate-400">Belum ada data siswa.</td></tr>`;
    return;
  }

  tbody.innerHTML = filtered.map(s => `
    <tr class="hover:bg-sky-50/50">
      <td class="p-2.5 sm:p-3 font-mono font-bold text-sky-900">${s.id}</td>
      <td class="p-2.5 sm:p-3 font-semibold text-slate-800">${s.nama}</td>
      <td class="p-2.5 sm:p-3"><span class="bg-sky-50 text-sky-700 px-2 py-0.5 rounded-lg text-xs font-bold">${s.kelas}</span></td>
      <td class="p-2.5 sm:p-3 text-center">
        <button onclick="openBarcodeModal('${s.id}')" class="text-xs bg-sky-100 hover:bg-sky-200 text-sky-800 font-bold px-3 py-1 rounded-lg transition flex items-center gap-1 mx-auto">
          <i class="fa-solid fa-qrcode"></i> Lihat QR Code
        </button>
      </td>
      <td class="p-2.5 sm:p-3 text-center">
        <button onclick="deleteSingleStudent('${s.id}')" class="text-xs bg-rose-100 hover:bg-rose-200 text-rose-700 font-bold px-2 py-1 rounded-lg transition">
          <i class="fa-solid fa-trash"></i> Hapus
        </button>
      </td>
    </tr>
  `).join('');
}

// ==========================================
// KELOLA AKUN GURU & ADMIN
// ==========================================
function toggleClassAssignmentInput() {
  const role = document.getElementById('newRole').value;
  const group = document.getElementById('classAssignmentGroup');
  if (role === 'guru') {
    group.classList.remove('hidden');
  } else {
    group.classList.add('hidden');
  }
}

function handleCreateUser(e) {
  e.preventDefault();
  const nama = document.getElementById('newNama').value.trim();
  const username = document.getElementById('newUsername').value.trim();
  const password = document.getElementById('newPassword').value.trim();
  const role = document.getElementById('newRole').value;
  const assignedClass = role === 'guru' ? document.getElementById('newAssignedClass').value : 'ALL';

  if (usersData.some(u => u.username === username)) {
    showToast('⚠️ Username telah digunakan.');
    return;
  }

  const newUserPayload = {
    action: 'ADD_USER',
    id: 'u_' + Date.now(),
    nama, username, password, role, assignedClass
  };

  usersData.push(newUserPayload);
  saveUsersToLocalStorage();
  renderUsersTable();

  sendToGoogleSheets(newUserPayload);

  e.target.reset();
  showToast('✅ Akun baru berhasil ditambahkan!');
}

function deleteUser(id) {
  if (confirm('Hapus akun pengguna ini?')) {
    usersData = usersData.filter(u => u.id !== id);
    saveUsersToLocalStorage();
    renderUsersTable();
    showToast('Akun telah dihapus.');
  }
}

function renderUsersTable() {
  const tbody = document.getElementById('usersTableBody');
  tbody.innerHTML = usersData.map(u => `
    <tr class="hover:bg-slate-50">
      <td class="p-2.5 sm:p-3 font-semibold text-slate-800">${u.nama}</td>
      <td class="p-2.5 sm:p-3 font-mono text-xs">${u.username}</td>
      <td class="p-2.5 sm:p-3">
        <span class="px-2 py-0.5 rounded-full text-xs font-bold ${u.role === 'admin' ? 'bg-amber-100 text-amber-800' : 'bg-sky-100 text-sky-800'}">
          ${u.role.toUpperCase()}
        </span>
      </td>
      <td class="p-2.5 sm:p-3 font-bold text-xs text-slate-700">${u.assignedClass || 'Semua Kelas'}</td>
      <td class="p-2.5 sm:p-3 text-center">
        ${u.username === 'admin' ? '<span class="text-xs text-slate-400">Utama</span>' : `
          <button onclick="deleteUser('${u.id}')" class="text-xs bg-rose-100 hover:bg-rose-200 text-rose-700 font-bold px-2 py-1 rounded-lg">
            Hapus
          </button>
        `}
      </td>
    </tr>
  `).join('');
}

// ==========================================
// RENDER LAPORAN ABSENSI
// ==========================================
function renderDashboard() {
  studentsData = getUniqueStudents(studentsData);
  attendanceLogs = getUniqueLogs(attendanceLogs);
  saveDataToLocalStorage();

  const classFilterEl = document.getElementById('dashboardClassFilter');
  const dateFilterEl = document.getElementById('dashboardDateFilter');
  const subtextEl = document.getElementById('dashboardRoleSubtext');

  const btnClearResponsesAdmin = document.getElementById('btnClearResponsesAdmin');
  const thActionAdmin = document.getElementById('thActionAdmin');

  let selectedClass = classFilterEl.value;
  const selectedDate = dateFilterEl.value;

  if (currentUser && currentUser.role === 'guru') {
    selectedClass = currentUser.assignedClass;
    classFilterEl.value = selectedClass;
    classFilterEl.disabled = true;
    subtextEl.textContent = `Laporan khusus untuk ${currentUser.assignedClass} (${currentUser.nama}).`;

    if (btnClearResponsesAdmin) btnClearResponsesAdmin.classList.add('hidden');
    if (thActionAdmin) thActionAdmin.classList.add('hidden');
  } else {
    classFilterEl.disabled = false;
    subtextEl.textContent = `Pantau kehadiran harian siswa SD Negeri 1 Tiga`;

    if (currentUser && currentUser.role === 'admin') {
      if (btnClearResponsesAdmin) btnClearResponsesAdmin.classList.remove('hidden');
      if (thActionAdmin) thActionAdmin.classList.remove('hidden');
    } else {
      if (btnClearResponsesAdmin) btnClearResponsesAdmin.classList.add('hidden');
      if (thActionAdmin) thActionAdmin.classList.add('hidden');
    }
  }

  const todayStr = getTodayDateStr();
  const targetDate = (selectedDate === 'ALL') ? todayStr : selectedDate;

  let displayLogs = [];

  if (selectedDate === 'ALL') {
    const pastLogs = attendanceLogs.filter(l => cleanDateStr(l.dateStr, l.timestamp) !== todayStr);
    displayLogs.push(...pastLogs);
  }

  const uniqueStudentsList = getUniqueStudents(studentsData);
  uniqueStudentsList.forEach(student => {
    const studentKey = String(student.id).trim().toLowerCase();
    
    const realLog = attendanceLogs.find(l => 
      cleanDateStr(l.dateStr, l.timestamp) === targetDate && 
      String(l.studentId).trim().toLowerCase() === studentKey
    );

    if (realLog) {
      displayLogs.push(realLog);
    } else {
      displayLogs.push({
        id: 'virtual_' + student.id + '_' + targetDate,
        studentId: student.id,
        nama: student.nama,
        kelas: student.kelas,
        status: 'Tidak Hadir',
        dateStr: targetDate,
        timestamp: `${targetDate}, --:--:-- WITA`
      });
    }
  });

  if (selectedClass !== 'ALL') {
    displayLogs = displayLogs.filter(l => isClassMatch(l.kelas, selectedClass));
  }

  const finalDisplayLogs = [];
  const seenKeys = new Set();
  displayLogs.forEach(l => {
    const sDate = cleanDateStr(l.dateStr, l.timestamp);
    const key = `${String(l.studentId).trim().toLowerCase()}_${sDate}`;
    if (!seenKeys.has(key)) {
      seenKeys.add(key);
      finalDisplayLogs.push(l);
    }
  });

  document.getElementById('statTotalHadir').textContent = finalDisplayLogs.filter(l => l.status === 'Hadir').length;
  document.getElementById('statTotalIzin').textContent = finalDisplayLogs.filter(l => l.status === 'Izin' || l.status === 'Sakit').length;
  document.getElementById('statTotalTidakHadir').textContent = finalDisplayLogs.filter(l => l.status === 'Tidak Hadir').length;

  const tbody = document.getElementById('responseTableBody');
  const isAdmin = currentUser && currentUser.role === 'admin';

  if (finalDisplayLogs.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" class="p-6 text-center text-slate-400">Belum ada catatan absensi terfilter.</td></tr>`;
    return;
  }

  tbody.innerHTML = finalDisplayLogs.slice().reverse().map(l => `
    <tr class="hover:bg-slate-50">
      <td class="p-2.5 sm:p-3 font-mono text-slate-600 text-xs font-bold">${l.timestamp}</td>
      <td class="p-2.5 sm:p-3 font-mono font-bold text-sky-900">${l.studentId}</td>
      <td class="p-2.5 sm:p-3 font-semibold text-slate-800">${l.nama}</td>
      <td class="p-2.5 sm:p-3"><span class="bg-sky-50 text-sky-700 px-2 py-0.5 rounded-lg text-xs font-bold">${l.kelas}</span></td>
      <td class="p-2.5 sm:p-3 font-bold">
        <span class="px-2.5 py-1 rounded-full text-xs ${
          l.status === 'Hadir' ? 'bg-emerald-100 text-emerald-800' :
          l.status === 'Tidak Hadir' ? 'bg-rose-100 text-rose-800' : 'bg-sky-100 text-sky-800'
        }">${l.status}</span>
      </td>
      ${isAdmin ? `
        <td class="p-2.5 sm:p-3 text-center">
          ${l.id.startsWith('virtual_') ? '<span class="text-xs text-slate-400">Belum Scan</span>' : `
            <button onclick="deleteSingleLog('${l.id}')" class="text-xs bg-rose-100 hover:bg-rose-200 text-rose-700 font-bold px-2 py-1 rounded-lg">
              Hapus
            </button>
          `}
        </td>
      ` : ''}
    </tr>
  `).join('');
}

function deleteSingleLog(logId) {
  if (!currentUser || currentUser.role !== 'admin') {
    showToast('⛔ Hanya Admin yang dapat menghapus data absensi.');
    return;
  }

  if (confirm('Hapus catatan absensi ini?')) {
    attendanceLogs = attendanceLogs.filter(l => l.id !== logId);
    saveDataToLocalStorage();
    renderDashboard();

    sendToGoogleSheets({ action: 'DELETE_LOG', id: logId });

    showToast('Log absensi berhasil dihapus.');
  }
}

function deleteAllResponsesForFilter() {
  if (!currentUser || currentUser.role !== 'admin') {
    showToast('⛔ Hanya Admin yang dapat menghapus data.');
    return;
  }

  const classFilter = document.getElementById('dashboardClassFilter').value;
  const dateFilter = document.getElementById('dashboardDateFilter').value;

  const toDelete = attendanceLogs.filter(l => {
    const matchClass = (classFilter === 'ALL') || isClassMatch(l.kelas, classFilter);
    const matchDate = (dateFilter === 'ALL') || (cleanDateStr(l.dateStr, l.timestamp) === dateFilter);
    return matchClass && matchDate;
  });

  if (toDelete.length === 0) {
    showToast('⚠️ Tidak ada catatan absensi terfilter.');
    return;
  }

  if (confirm(`Hapus ${toDelete.length} data absensi terfilter?`)) {
    const idsToDelete = toDelete.map(l => l.id);
    attendanceLogs = attendanceLogs.filter(l => !idsToDelete.includes(l.id));

    saveDataToLocalStorage();
    renderDashboard();

    showToast(`🗑️ ${toDelete.length} log absensi terfilter berhasil dihapus.`);
  }
}

// ==========================================
// KONTROL RESET DATA
// ==========================================
function clearAllData() {
  if (!currentUser || currentUser.role !== 'admin') {
    showToast('⛔ Hanya Admin yang dapat melakukan reset.');
    return;
  }

  if (confirm('Hapus seluruh data siswa dan catatan absensi?')) {
    studentsData = [];
    attendanceLogs = [];

    localStorage.setItem('sd1tiga_absensi_students', JSON.stringify([]));
    localStorage.setItem('sd1tiga_absensi_logs', JSON.stringify([]));
    localStorage.setItem('sd1tiga_is_reset', 'true');

    updateAllViews();

    sendToGoogleSheets({ action: 'RESET_ALL_DATA' });

    showToast('Seluruh data dibersihkan.', '🗑️');
  }
}

// ==========================================
// EXPORTS & HELPERS
// ==========================================
function updateAllViews() {
  populateClassSelects();
  populateDateSelects();
  renderClassSelectionGrid();
  renderStudentTable();
  renderDashboard();
}

function populateClassSelects() {
  const teacherFilter = document.getElementById('teacherClassFilter');
  const dashClassFilter = document.getElementById('dashboardClassFilter');

  if (teacherFilter) teacherFilter.innerHTML = '<option value="ALL">Semua Kelas</option>';
  if (dashClassFilter) dashClassFilter.innerHTML = '<option value="ALL">🌟 Semua Kelas</option>';

  const classes = [...new Set([...DEFAULT_CLASSES, ...studentsData.map(s => s.kelas)])].sort();
  classes.forEach(cls => {
    if (teacherFilter) teacherFilter.appendChild(new Option(cls, cls));
    if (dashClassFilter) dashClassFilter.appendChild(new Option(`📚 ${cls}`, cls));
  });
}

function populateDateSelects() {
  const dashDateFilter = document.getElementById('dashboardDateFilter');
  if (!dashDateFilter) return;
  
  dashDateFilter.innerHTML = '<option value="ALL">📅 Semua Tanggal</option>';
  
  const todayStr = getTodayDateStr();
  const datesSet = new Set(attendanceLogs.map(l => cleanDateStr(l.dateStr, l.timestamp)));
  datesSet.add(todayStr);

  const dates = [...datesSet].filter(Boolean).sort().reverse();
  dates.forEach(dStr => dashDateFilter.appendChild(new Option(`🗓️ ${dStr}`, dStr)));
}

function handleExcelUpload(e) {
  if (!currentUser || currentUser.role !== 'admin') {
    showToast('⛔ Hanya Administrator yang dapat mengunggah berkas.');
    return;
  }

  const file = e.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = function(evt) {
    try {
      const data = new Uint8Array(evt.target.result);
      const workbook = XLSX.read(data, { type: 'array' });
      const json = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]]);

      const newStudents = [];
      json.forEach((row) => {
        const keys = Object.keys(row);
        const id = row[keys.find(k => k.toLowerCase().includes('id') || k.toLowerCase().includes('nis')) || keys[0]];
        const nama = row[keys.find(k => k.toLowerCase().includes('nama')) || keys[1]];
        const kelas = row[keys.find(k => k.toLowerCase().includes('kelas')) || keys[2]] || 'Kelas I';

        if (id && nama) {
          newStudents.push({ id: String(id).trim(), nama: String(nama).trim(), kelas: String(kelas).trim() });
        }
      });

      if (newStudents.length > 0) {
        studentsData = getUniqueStudents([...studentsData, ...newStudents]);
        saveDataToLocalStorage();
        updateAllViews();

        sendToGoogleSheets({ action: 'ADD_BULK_STUDENTS', students: studentsData });

        showToast(`✅ Berhasil menambahkan siswa baru! Total siswa kini: ${studentsData.length}`, '🎉');
      }
    } catch (err) {
      showToast('❌ Gagal membaca file Excel.');
    }
  };
  reader.readAsArrayBuffer(file);
}

function downloadExcelTemplate() {
  const templateData = [
    { "ID / NIS": "1001", "Nama Siswa": "Ahmad Dahlan", "Kelas": "Kelas I" },
    { "ID / NIS": "1002", "Nama Siswa": "Siti Nurhaliza", "Kelas": "Kelas I" },
    { "ID / NIS": "1003", "Nama Siswa": "Bambang Pamungkas", "Kelas": "Kelas IV" }
  ];
  const ws = XLSX.utils.json_to_sheet(templateData);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Daftar Siswa");
  XLSX.writeFile(wb, "Template_Absensi_Siswa_SDN1Tiga.xlsx");
}

function exportResponsesToExcel() {
  if (studentsData.length === 0) {
    showToast('⚠️ Tidak ada data untuk diunduh.');
    return;
  }

  const todayStr = getTodayDateStr();
  const selectedDate = document.getElementById('dashboardDateFilter').value;
  const targetDate = selectedDate === 'ALL' ? todayStr : selectedDate;

  const exportData = studentsData.map(s => {
    const log = attendanceLogs.find(l => String(l.studentId).trim().toLowerCase() === String(s.id).trim().toLowerCase() && cleanDateStr(l.dateStr, l.timestamp) === targetDate);
    return {
      "Tanggal": targetDate,
      "Waktu Detail (WITA)": log ? log.timestamp : `${targetDate}, --:--:-- WITA`,
      "ID / NIS Siswa": s.id,
      "Nama Siswa": s.nama,
      "Kelas": s.kelas,
      "Status Kehadiran": log ? log.status : "Tidak Hadir"
    };
  });

  const ws = XLSX.utils.json_to_sheet(exportData);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Laporan Absensi");
  XLSX.writeFile(wb, `Laporan_Absensi_SDN1Tiga_${targetDate}.xlsx`);
}

function showToast(message, icon = '✨') {
  const toast = document.getElementById('toast');
  document.getElementById('toastIcon').textContent = icon;
  document.getElementById('toastMessage').textContent = message;
  toast.classList.remove('translate-y-24', 'opacity-0');
  toast.classList.add('translate-y-0', 'opacity-100');
  setTimeout(() => {
    toast.classList.remove('translate-y-0', 'opacity-100');
    toast.classList.add('translate-y-24', 'opacity-0');
  }, 2500);
}

// ==========================================
// SMART MERGE SYNC (GOOGLE SHEETS)
// ==========================================
async function syncDataFromGoogleSheets() {
  if (!GOOGLE_SCRIPT_URL) return;

  if (localStorage.getItem('sd1tiga_is_reset') === 'true') {
    localStorage.removeItem('sd1tiga_is_reset');
    return;
  }

  try {
    const res = await fetch(GOOGLE_SCRIPT_URL);
    const cloudData = await res.json();

    if (Array.isArray(cloudData.logs)) {
      const cleanCloudLogs = cloudData.logs.filter(l => l.status !== 'Tidak Hadir' && !String(l.timestamp).includes('--:--:--'));
      attendanceLogs = getUniqueLogs([...attendanceLogs, ...cleanCloudLogs]);
    }

    if (Array.isArray(cloudData.students) && cloudData.students.length > 0) {
      studentsData = getUniqueStudents([...studentsData, ...cloudData.students]);
    }

    if (Array.isArray(cloudData.users) && cloudData.users.length > 0) {
      const userMap = new Map();
      usersData.forEach(u => userMap.set(u.id, u));
      cloudData.users.forEach(u => userMap.set(u.id, u));
      usersData = Array.from(userMap.values());
    }

    saveDataToLocalStorage();
    saveUsersToLocalStorage();
    updateAllViews();
    if (currentUser && currentUser.role === 'admin') renderUsersTable();

  } catch (err) {
    console.log('Mode Offline / Menggunakan LocalStorage');
  }
}
