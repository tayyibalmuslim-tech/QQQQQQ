// ============================================================
// مصحف التنقل - حفظ القرآن بالتنقل الحر (كلمة / آية) بدون كتابة
// ============================================================

// ---------- Firebase (اختياري، لمزامنة الموضع فقط بين الأجهزة) ----------
const firebaseConfig = {
  apiKey: "AIzaSyD8jxpVrvicStETloL8tk5s865dmNatIqE",
  authDomain: "mazen-productivity-bab1c.firebaseapp.com",
  databaseURL: "https://mazen-productivity-bab1c-default-rtdb.firebaseio.com",
  projectId: "mazen-productivity-bab1c",
  storageBucket: "mazen-productivity-bab1c.firebasestorage.app",
  messagingSenderId: "388570583199",
  appId: "1:388570583199:web:45e958a32585b0572252aa",
  measurementId: "G-LCMB1W8DW9"
};

let auth = null, db = null, fbReady = false, currentUser = null, authMode = "login", fbFns = {};

async function initFirebase(){
  try{
    const [{ initializeApp }, authMod, dbMod] = await Promise.all([
      import("https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js"),
      import("https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js"),
      import("https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js")
    ]);
    const fbApp = initializeApp(firebaseConfig);
    auth = authMod.getAuth(fbApp);
    db = dbMod.getDatabase(fbApp);
    fbFns = {
      createUserWithEmailAndPassword: authMod.createUserWithEmailAndPassword,
      signInWithEmailAndPassword: authMod.signInWithEmailAndPassword,
      onAuthStateChanged: authMod.onAuthStateChanged,
      signOut: authMod.signOut,
      ref: dbMod.ref, set: dbMod.set, get: dbMod.get
    };
    fbReady = true;
    fbFns.onAuthStateChanged(auth, (user) => {
      currentUser = user;
      setSyncDot(user ? "on" : "off");
      document.getElementById("userLine").textContent = user ? ("مسجّل الدخول: " + user.email) : "";
      if(user) loadCloudPosition(user.uid);
    });
  }catch(err){
    console.error("فشل تحميل Firebase:", err);
    setSyncDot("err");
  }
}

function setSyncDot(state){
  const dot = document.getElementById("syncDot");
  dot.className = "sync-dot" + (state === "on" ? " on" : state === "err" ? " err" : "");
}

// ---------- الموضع الحالي ----------
// pos = { surah, ayah, w } حيث w = فهرس الكلمة داخل الآية (يبدأ من صفر)
let pos = { surah: 1, ayah: 1, w: 0 };
let renderedSurah = null;
let saveTimer = null;

const POS_KEY = "navq_position_v1";
const THEME_KEY = "navq_theme_v1";
const FONT_KEY = "navq_fontsize_v1";

function tokenize(text){ return text.trim().split(/\s+/).filter(Boolean); }

function getSurahName(num){
  const s = QURAN_SURAHS_LIST.find(s => s.number === num);
  return s ? s.name : ("سورة " + num);
}
function getSurahTotalVerses(num){
  const s = QURAN_SURAHS_LIST.find(s => s.number === num);
  return s ? s.totalVerses : 0;
}
function getVerseText(surah, ayah){
  const verses = QURAN_VERSES_DATA[String(surah)];
  if(!verses) return null;
  const v = verses.find(v => v.number === ayah);
  return v ? v.text : null;
}
function toArabicDigits(num){
  const d = ["٠","١","٢","٣","٤","٥","٦","٧","٨","٩"];
  return String(num).split("").map(c => d[c] || c).join("");
}

// ---------- تخزين محلي وسحابي ----------
function loadLocalPosition(){
  try{
    const raw = localStorage.getItem(POS_KEY);
    if(raw){
      const p = JSON.parse(raw);
      if(p && p.surah && p.ayah){ pos = { surah: p.surah, ayah: p.ayah, w: p.w || 0 }; }
    }
  }catch(e){ /* تجاهل */ }
}
function saveLocalPosition(){
  localStorage.setItem(POS_KEY, JSON.stringify(pos));
}
function saveToCloud(){
  if(currentUser && fbReady){
    fbFns.set(fbFns.ref(db, `navApp/${currentUser.uid}/position`), pos)
      .catch(err => showToast("تعذّرت المزامنة: " + err.message, true));
  }
}
function persistPosition(){
  saveLocalPosition();
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveToCloud, 700);
}
function loadCloudPosition(uid){
  fbFns.get(fbFns.ref(db, `navApp/${uid}/position`)).then(snap => {
    if(snap.exists()){
      const p = snap.val();
      if(p && p.surah && p.ayah){
        pos = { surah: p.surah, ayah: p.ayah, w: p.w || 0 };
        saveLocalPosition();
        renderSurah(pos.surah);
        highlightCurrent(true);
        showToast("تم استرجاع آخر موضع محفوظ ✓");
      }
    } else {
      saveToCloud();
    }
  }).catch(err => showToast("تعذّر تحميل موضعك المحفوظ: " + err.message, true));
}

// ---------- بناء قوائم الاختيار ----------
function populateSurahSelect(){
  const sel = document.getElementById("jumpSurah");
  sel.innerHTML = QURAN_SURAHS_LIST.map(s => `<option value="${s.number}">${s.number}. ${s.name}</option>`).join("");
  sel.value = String(pos.surah);
  sel.onchange = () => populateAyahSelect(Number(sel.value));
  populateAyahSelect(pos.surah);
}
function populateAyahSelect(surahNum){
  const sel = document.getElementById("jumpAyah");
  const total = getSurahTotalVerses(surahNum);
  let opts = "";
  for(let a = 1; a <= total; a++){ opts += `<option value="${a}">آية ${a}</option>`; }
  sel.innerHTML = opts;
  sel.value = String(surahNum === pos.surah ? pos.ayah : 1);
}

// ---------- رسم آيات السورة الحالية ----------
function renderSurah(surahNum){
  const verses = QURAN_VERSES_DATA[String(surahNum)];
  const flow = document.getElementById("ayahsFlow");
  flow.innerHTML = "";
  document.getElementById("surahHeading").textContent = `سورة ${getSurahName(surahNum)}`;

  if(!verses){
    flow.innerHTML = `<div style="text-align:center;color:var(--ink-soft);">نص هذه السورة غير متاح حاليًا</div>`;
    renderedSurah = surahNum;
    return;
  }

  verses.forEach(v => {
    const ayahSpan = document.createElement("span");
    ayahSpan.className = "ayah-block";
    ayahSpan.dataset.ayah = v.number;

    const words = tokenize(v.text);
    words.forEach((word, idx) => {
      const wSpan = document.createElement("span");
      wSpan.className = "w";
      wSpan.textContent = word;
      wSpan.dataset.ayah = v.number;
      wSpan.dataset.w = idx;
      wSpan.onclick = () => {
        pos = { surah: surahNum, ayah: v.number, w: idx };
        highlightCurrent(true);
        persistPosition();
      };
      ayahSpan.appendChild(wSpan);
      ayahSpan.appendChild(document.createTextNode(" "));
    });

    const badge = document.createElement("span");
    badge.className = "ayah-num-badge";
    badge.textContent = toArabicDigits(v.number);
    ayahSpan.appendChild(badge);
    ayahSpan.appendChild(document.createTextNode(" "));

    flow.appendChild(ayahSpan);
  });

  renderedSurah = surahNum;
}

// ---------- تحديث التظليل وصندوق الكلمة الحالية ----------
function highlightCurrent(scroll){
  if(renderedSurah !== pos.surah) renderSurah(pos.surah);

  document.querySelectorAll(".w.cur-word").forEach(el => el.classList.remove("cur-word"));
  document.querySelectorAll(".ayah-block.cur-ayah").forEach(el => el.classList.remove("cur-ayah"));

  const wordEl = document.querySelector(`.w[data-ayah="${pos.ayah}"][data-w="${pos.w}"]`);
  const ayahEl = document.querySelector(`.ayah-block[data-ayah="${pos.ayah}"]`);
  if(wordEl) wordEl.classList.add("cur-word");
  if(ayahEl) ayahEl.classList.add("cur-ayah");
  if(wordEl && scroll){
    wordEl.scrollIntoView({ block: "center", behavior: "smooth" });
  }

  const text = getVerseText(pos.surah, pos.ayah);
  const words = text ? tokenize(text) : [];
  document.getElementById("currentWordDisplay").textContent = words[pos.w] || "—";
  document.getElementById("positionIndicator").textContent =
    `سورة ${getSurahName(pos.surah)} — آية ${pos.ayah} — الكلمة ${pos.w + 1} من ${words.length}`;

  document.getElementById("jumpSurah").value = String(pos.surah);
  populateAyahSelect(pos.surah);
  document.getElementById("jumpAyah").value = String(pos.ayah);

  document.getElementById("btnPrevAyah").disabled = (pos.surah === 1 && pos.ayah === 1);
  document.getElementById("btnNextAyah").disabled = (pos.surah === 114 && pos.ayah === getSurahTotalVerses(114));
  document.getElementById("btnPrevWord").disabled = (pos.surah === 1 && pos.ayah === 1 && pos.w === 0);
}

// ---------- التنقل ----------
function wordCountOf(surah, ayah){
  const t = getVerseText(surah, ayah);
  return t ? tokenize(t).length : 0;
}

function goNextWord(){
  const total = wordCountOf(pos.surah, pos.ayah);
  if(pos.w < total - 1){
    pos.w++;
  } else {
    if(!moveAyah(1)) { showToast("وصلت لنهاية القرآن، بارك الله فيك 🌙"); return; }
    pos.w = 0;
  }
  highlightCurrent(true);
  persistPosition();
}
function goPrevWord(){
  if(pos.w > 0){
    pos.w--;
  } else {
    if(!moveAyah(-1)) { showToast("أنت في بداية القرآن"); return; }
    pos.w = Math.max(0, wordCountOf(pos.surah, pos.ayah) - 1);
  }
  highlightCurrent(true);
  persistPosition();
}
function goNextAyah(){
  if(!moveAyah(1)){ showToast("وصلت لنهاية القرآن، بارك الله فيك 🌙"); return; }
  pos.w = 0;
  highlightCurrent(true);
  persistPosition();
}
function goPrevAyah(){
  if(!moveAyah(-1)){ showToast("أنت في بداية القرآن"); return; }
  pos.w = 0;
  highlightCurrent(true);
  persistPosition();
}

// ينقّل رقم السورة/الآية خطوة واحدة (١ للأمام، -١ للخلف). يرجع false لو وصلنا لحد المصحف
function moveAyah(direction){
  let { surah, ayah } = pos;
  ayah += direction;
  if(ayah < 1){
    if(surah <= 1) return false;
    surah -= 1;
    ayah = getSurahTotalVerses(surah);
  } else if(ayah > getSurahTotalVerses(surah)){
    if(surah >= 114) return false;
    surah += 1;
    ayah = 1;
  }
  pos.surah = surah; pos.ayah = ayah;
  return true;
}

function doJump(){
  const s = Number(document.getElementById("jumpSurah").value);
  const a = Number(document.getElementById("jumpAyah").value);
  pos = { surah: s, ayah: a, w: 0 };
  highlightCurrent(true);
  persistPosition();
}

// ---------- المظهر ----------
function toggleTheme(){
  const html = document.documentElement;
  const next = html.getAttribute("data-theme") === "dark" ? "light" : "dark";
  html.setAttribute("data-theme", next);
  localStorage.setItem(THEME_KEY, next);
}
function cycleFontSize(){
  const order = ["sm", "md", "lg", "xl"];
  const html = document.documentElement;
  const cur = html.getAttribute("data-fontsize") || "md";
  const next = order[(order.indexOf(cur) + 1) % order.length];
  html.setAttribute("data-fontsize", next);
  localStorage.setItem(FONT_KEY, next);
}
function applySavedPrefs(){
  const theme = localStorage.getItem(THEME_KEY);
  if(theme) document.documentElement.setAttribute("data-theme", theme);
  const fs = localStorage.getItem(FONT_KEY);
  if(fs) document.documentElement.setAttribute("data-fontsize", fs);
}

// ---------- المزامنة (تسجيل الدخول) ----------
function openAuth(){ document.getElementById("authOverlay").classList.add("active"); }
function closeAuth(){ document.getElementById("authOverlay").classList.remove("active"); }
function switchAuthTab(mode){
  authMode = mode;
  document.getElementById("tabLogin").classList.toggle("active", mode === "login");
  document.getElementById("tabSignup").classList.toggle("active", mode === "signup");
  document.getElementById("authSubmitBtn").textContent = mode === "login" ? "تسجيل الدخول" : "إنشاء الحساب";
  document.getElementById("authMsg").textContent = "";
}
function submitAuth(){
  const msgEl = document.getElementById("authMsg");
  msgEl.className = "auth-msg";
  if(!fbReady){ msgEl.className = "auth-msg err"; msgEl.textContent = "خدمة المزامنة غير متاحة الآن"; return; }
  const email = document.getElementById("authEmail").value.trim();
  const password = document.getElementById("authPassword").value;
  if(!email || !password){ msgEl.className = "auth-msg err"; msgEl.textContent = "اكتب البريد وكلمة المرور"; return; }
  const action = authMode === "login"
    ? fbFns.signInWithEmailAndPassword(auth, email, password)
    : fbFns.createUserWithEmailAndPassword(auth, email, password);
  action.then(() => {
    msgEl.className = "auth-msg ok";
    msgEl.textContent = authMode === "login" ? "تم تسجيل الدخول ✓" : "تم إنشاء الحساب ✓";
    setTimeout(closeAuth, 700);
  }).catch(err => {
    msgEl.className = "auth-msg err";
    msgEl.textContent = translateAuthError(err.code);
  });
}
function translateAuthError(code){
  const map = {
    "auth/invalid-email": "البريد الإلكتروني غير صحيح",
    "auth/user-not-found": "لا يوجد حساب بهذا البريد",
    "auth/wrong-password": "كلمة المرور غير صحيحة",
    "auth/invalid-credential": "بيانات الدخول غير صحيحة",
    "auth/email-already-in-use": "هذا البريد مسجّل من قبل، سجّل دخول بدل إنشاء حساب",
    "auth/weak-password": "كلمة المرور ضعيفة، لازم ٦ أحرف على الأقل",
    "auth/too-many-requests": "محاولات كتير، حاول بعد شوية"
  };
  return map[code] || ("حصل خطأ: " + code);
}

// ---------- أدوات عامة ----------
function showToast(msg, isErr){
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.className = "toast show" + (isErr ? " err" : "");
  setTimeout(() => { t.className = "toast" + (isErr ? " err" : ""); }, 2400);
}

// ---------- اختصارات لوحة المفاتيح (للاستخدام على الكمبيوتر) ----------
window.addEventListener("keydown", (e) => {
  if(document.getElementById("authOverlay").classList.contains("active")) return;
  if(e.key === "ArrowLeft"){ e.preventDefault(); goNextWord(); }
  else if(e.key === "ArrowRight"){ e.preventDefault(); goPrevWord(); }
  else if(e.key === "ArrowUp"){ e.preventDefault(); goPrevAyah(); }
  else if(e.key === "ArrowDown"){ e.preventDefault(); goNextAyah(); }
});

// ---------- التهيئة ----------
applySavedPrefs();
loadLocalPosition();
populateSurahSelect();
renderSurah(pos.surah);
highlightCurrent(false);
initFirebase();

// إتاحة الدوال لأحداث onclick في الـ HTML (لأن الملف module)
window.doJump = doJump;
window.goNextWord = goNextWord;
window.goPrevWord = goPrevWord;
window.goNextAyah = goNextAyah;
window.goPrevAyah = goPrevAyah;
window.toggleTheme = toggleTheme;
window.cycleFontSize = cycleFontSize;
window.openAuth = openAuth;
window.closeAuth = closeAuth;
window.switchAuthTab = switchAuthTab;
window.submitAuth = submitAuth;
