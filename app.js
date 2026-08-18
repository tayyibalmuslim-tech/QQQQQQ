// ============================================================
// حفظ القرآن - المنطق الرئيسي
// ============================================================

// ---------- Firebase Setup (تحميل اختياري، ما يوقفش باقي التطبيق لو فشل) ----------
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

let auth = null;
let db = null;
let fbReady = false;
let currentUser = null;
let authMode = "login";
let fbFns = {};

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
      const authBtn = document.getElementById("authBtn");
      const logoutBtn = document.getElementById("logoutBtn");
      const syncStatus = document.getElementById("syncStatus");

      if(user){
        authBtn.textContent = user.email;
        logoutBtn.style.display = "block";
        syncStatus.textContent = "متزامن ✓ — " + user.email;
        loadCloudData(user.uid);
      } else {
        authBtn.textContent = "دخول";
        logoutBtn.style.display = "none";
        syncStatus.textContent = "غير مسجّل دخول";
      }
    });
  }catch(err){
    console.error("فشل تحميل Firebase:", err);
    const syncStatus = document.getElementById("syncStatus");
    if(syncStatus) syncStatus.textContent = "المزامنة غير متاحة الآن";
    showToast("تعذّر الاتصال بخدمة المزامنة، التطبيق شغال بالبيانات المحلية", true);
  }
}

// ---------- App State ----------
// ranges[rangeId] = { id, startSurah, startAyah, endSurah, endAyah, createdAt }
// progress[verseKey] = { lastReviewDate, nextReviewDate, intervalDays, history: [] }
let ranges = [];
let progress = {};
let activeQuiz = null;

const LOCAL_RANGES_KEY = "quran_app_ranges_v1";
const LOCAL_PROGRESS_KEY = "quran_app_progress_v1";

function verseKey(surah, ayah){
  return `${surah}:${ayah}`;
}

function loadLocalData(){
  try{
    const rawRanges = localStorage.getItem(LOCAL_RANGES_KEY);
    ranges = rawRanges ? JSON.parse(rawRanges) : [];
  }catch(e){ ranges = []; }
  try{
    const rawProgress = localStorage.getItem(LOCAL_PROGRESS_KEY);
    progress = rawProgress ? JSON.parse(rawProgress) : {};
  }catch(e){ progress = {}; }
}
function saveLocalRanges(){ localStorage.setItem(LOCAL_RANGES_KEY, JSON.stringify(ranges)); }
function saveLocalProgress(){ localStorage.setItem(LOCAL_PROGRESS_KEY, JSON.stringify(progress)); }

function saveToCloud(){
  saveLocalRanges();
  saveLocalProgress();
  if(currentUser && fbReady){
    fbFns.set(fbFns.ref(db, `quranApp/${currentUser.uid}`), { ranges, progress })
      .catch(err => showToast("خطأ في المزامنة: " + err.message, true));
  }
}

function loadCloudData(uid){
  if(!fbReady) return;
  return fbFns.get(fbFns.ref(db, `quranApp/${uid}`)).then(snap => {
    if(snap.exists()){
      const cloud = snap.val();
      ranges = cloud.ranges || [];
      progress = cloud.progress || {};
      saveLocalRanges();
      saveLocalProgress();
    } else if(ranges.length > 0 || Object.keys(progress).length > 0){
      fbFns.set(fbFns.ref(db, `quranApp/${uid}`), { ranges, progress });
    }
    renderCurrentView();
  }).catch(err => {
    showToast("تعذّر تحميل بيانات المزامنة: " + err.message, true);
  });
}

// ---------- Navigation (History API) ----------
let currentTab = "ranges";
let currentRangeId = null;

function updateTabButtons(tab){
  document.querySelectorAll(".header-tabs button").forEach(b => b.classList.remove("active"));
  const btn = document.getElementById("nav-" + tab);
  if(btn) btn.classList.add("active");
}

function applyState(state, push){
  currentTab = (state.view === "review") ? "review" : "ranges";
  updateTabButtons(currentTab);

  if(state.view === "ranges"){
    showView("view-ranges");
    renderRangesList();
  } else if(state.view === "range-content"){
    currentRangeId = state.rangeId;
    const range = ranges.find(r => r.id === currentRangeId);
    if(!range){ applyState({view:"ranges"}, false); return; }
    document.getElementById("crumbRange").textContent = rangeLabel(range);
    document.getElementById("rangeContentTitle").textContent = rangeLabel(range);
    renderAyahs(range);
    showView("view-range-content");
  } else if(state.view === "review"){
    showView("view-review");
    renderReviewTab();
  } else if(state.view === "auth"){
    showView("view-auth");
  }

  if(push){
    history.pushState(state, "", "#" + stateToHash(state));
  }
}

function stateToHash(state){
  if(state.view === "ranges") return "ranges";
  if(state.view === "range-content") return "range/" + state.rangeId;
  if(state.view === "review") return "review";
  if(state.view === "auth") return "auth";
  return "ranges";
}

function hashToState(hash){
  const parts = hash.replace(/^#/, "").split("/");
  if(parts[0] === "range" && parts[1] !== undefined) return { view: "range-content", rangeId: parts[1] };
  if(parts[0] === "review") return { view: "review" };
  if(parts[0] === "auth") return { view: "auth" };
  return { view: "ranges" };
}

window.addEventListener("popstate", (e) => {
  const state = e.state || hashToState(location.hash);
  applyState(state, false);
});

function switchTab(tab){
  if(tab === "ranges") applyState({ view: "ranges" }, true);
  else if(tab === "review") applyState({ view: "review" }, true);
}

function showView(id){
  document.querySelectorAll(".view").forEach(v => v.classList.remove("active"));
  document.getElementById(id).classList.add("active");
}

function goToRanges(){ applyState({ view: "ranges" }, true); }
function showAuthView(){ applyState({ view: "auth" }, true); }

function renderCurrentView(){
  const state = hashToState(location.hash);
  applyState(state, false);
  updateReviewBadge();
}

// ---------- Ranges ----------
function rangeLabel(range){
  const sName = getSurahName(range.startSurah);
  const eName = getSurahName(range.endSurah);
  if(range.startSurah === range.endSurah){
    return `${sName} (${range.startAyah}-${range.endAyah})`;
  }
  return `${sName}:${range.startAyah} → ${eName}:${range.endAyah}`;
}

function populateSurahSelects(){
  const startSel = document.getElementById("startSurah");
  const endSel = document.getElementById("endSurah");
  const options = QURAN_SURAHS_LIST.map(s => `<option value="${s.number}">${s.number}. ${s.name}</option>`).join("");
  startSel.innerHTML = options;
  endSel.innerHTML = options;
  // افتراضياً سورة القمر (٥٤) كتجربة أولى
  startSel.value = "54";
  endSel.value = "54";
  document.getElementById("startAyah").value = 1;
  document.getElementById("endAyah").value = getSurahTotalVerses(54);
}

function createRange(){
  const startSurah = Number(document.getElementById("startSurah").value);
  const startAyah = Number(document.getElementById("startAyah").value);
  const endSurah = Number(document.getElementById("endSurah").value);
  const endAyah = Number(document.getElementById("endAyah").value);

  if(!startSurah || !startAyah || !endSurah || !endAyah){
    showToast("من فضلك املأ كل الحقول", true);
    return;
  }
  if(endSurah < startSurah || (endSurah === startSurah && endAyah < startAyah)){
    showToast("نهاية النطاق لازم تكون بعد بدايته", true);
    return;
  }
  const startMax = getSurahTotalVerses(startSurah);
  const endMax = getSurahTotalVerses(endSurah);
  if(startAyah < 1 || startAyah > startMax){
    showToast(`سورة ${getSurahName(startSurah)} فيها ${startMax} آية بس`, true);
    return;
  }
  if(endAyah < 1 || endAyah > endMax){
    showToast(`سورة ${getSurahName(endSurah)} فيها ${endMax} آية بس`, true);
    return;
  }

  // التأكد إن النص متاح فعلاً لكل سور النطاق (حالياً القرآن مضاف تدريجياً)
  for(let s = startSurah; s <= endSurah; s++){
    if(!QURAN_VERSES_DATA[String(s)]){
      showToast(`نص سورة ${getSurahName(s)} مش متاح في التطبيق لسه`, true);
      return;
    }
  }

  const newRange = {
    id: "r" + Date.now(),
    startSurah, startAyah, endSurah, endAyah,
    createdAt: todayStr()
  };
  ranges.push(newRange);
  saveToCloud();
  showToast("تم إنشاء النطاق ✓");
  renderRangesList();
}

function deleteRange(rangeId, event){
  if(event) event.stopPropagation();
  ranges = ranges.filter(r => r.id !== rangeId);
  saveToCloud();
  renderRangesList();
  showToast("تم حذف النطاق");
}

function renderRangesList(){
  const wrap = document.getElementById("rangesList");
  wrap.innerHTML = "";

  if(ranges.length === 0){
    wrap.innerHTML = `
      <div class="empty-state">
        <div class="emoji">📖</div>
        <div>لسه مفيش نطاقات تسميع، أنشئ أول نطاق من الفورم فوق</div>
      </div>
    `;
    return;
  }

  ranges.forEach(range => {
    const verses = getVersesInRange(range.startSurah, range.startAyah, range.endSurah, range.endAyah);
    const dueCount = verses.filter(v => isDue(verseKey(v.surah, v.ayah))).length;

    const el = document.createElement("div");
    el.className = "card-item";
    el.onclick = () => openRange(range.id);
    el.innerHTML = `
      <div class="row-main">
        <div class="num-badge">📖</div>
        <div>
          <div class="title">${rangeLabel(range)}</div>
          <div class="meta">${verses.length} آية${dueCount > 0 ? ` · <span style="color:var(--red-err);font-weight:700;">${dueCount} مستحقة للمراجعة</span>` : ""}</div>
        </div>
      </div>
      <div class="row-actions">
        <button class="btn btn-outline btn-sm" onclick="window.deleteRange('${range.id}', event)">حذف</button>
        <span class="chev">‹</span>
      </div>
    `;
    wrap.appendChild(el);
  });
}

function openRange(rangeId){
  applyState({ view: "range-content", rangeId }, true);
}

function toggleAyahText(btn, safeKey){
  document.getElementById("ayahText-" + safeKey).classList.toggle("shown");
}

function renderAyahs(range){
  const wrap = document.getElementById("ayahsContainer");
  wrap.innerHTML = "";
  const verses = getVersesInRange(range.startSurah, range.startAyah, range.endSurah, range.endAyah);

  const quizAllBox = document.getElementById("rangeQuizAllBox");
  if(quizAllBox){
    if(verses.length > 1){
      quizAllBox.innerHTML = `
        <button class="btn btn-primary" style="width:100%;margin-bottom:14px;"
          onclick="window.openQuizRange(${range.startSurah}, ${range.startAyah}, ${range.endSurah}, ${range.endAyah})">
          تسميع الفقرة كاملة (كقطعة واحدة) ✍️📖
        </button>`;
    } else {
      quizAllBox.innerHTML = "";
    }
  }

  verses.forEach(v => {
    const key = verseKey(v.surah, v.ayah);
    const safeKey = key.replace(/[^a-zA-Z0-9]/g,'_');
    const text = getVerseText(v.surah, v.ayah);
    const prog = progress[key];
    const due = isDue(key);

    const card = document.createElement("div");
    card.className = "ayah-card";
    card.innerHTML = `
      <div class="ah">
        <div class="nums">
          <span class="num-pill">${getSurahName(v.surah)} <b>${v.ayah}</b></span>
        </div>
        ${due ? `<span class="num-pill" style="background:#F5E1DD;color:var(--red-err);font-weight:700;">مستحقة للمراجعة</span>` : ""}
      </div>
      <div class="quran-text" id="ayahText-${safeKey}">${text}</div>
      <div class="ah-actions">
        <button class="btn btn-outline btn-sm" onclick="window.toggleAyahText(this,'${safeKey}')">إظهار / إخفاء الآية</button>
        <button class="btn btn-primary btn-sm" onclick="window.openQuiz(${v.surah}, ${v.ayah})">تسميع (كتابة) ✍️</button>
      </div>
      ${prog ? `<div class="meta" style="margin-top:10px;font-size:0.76rem;color:var(--ink-soft);">
          آخر مراجعة: ${prog.lastReviewDate || "—"} · المراجعة القادمة: ${prog.nextReviewDate || "—"}
        </div>` : ""}
    `;
    wrap.appendChild(card);
  });
}

// ---------- Arabic text normalization for comparison ----------
function stripDiacritics(text){
  return text
    .replace(/[\u064B-\u065F\u0670\u06D6-\u06ED\u08F0-\u08FF]/g, "")
    .replace(/ـ/g, "")
    .replace(/[،.,؛:؟!"'«»()"]/g, "")
    .replace(/[إأآاٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/ؤ/g, "و")
    .replace(/ئ/g, "ي")
    .replace(/[\u06DD\u06DE\u08E2۞]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
function normalizeForCompare(text){ return stripDiacritics(text).toLowerCase(); }
function tokenize(text){ return text.split(/\s+/).filter(Boolean); }

// ---------- LCS-based word alignment ----------
function lcsAlign(origWords, origNorm, userNorm){
  const n = origNorm.length, m = userNorm.length;
  const dp = Array.from({length: n+1}, () => new Uint16Array(m+1));
  for(let i = n-1; i >= 0; i--){
    for(let j = m-1; j >= 0; j--){
      if(origNorm[i] === userNorm[j]) dp[i][j] = dp[i+1][j+1] + 1;
      else dp[i][j] = Math.max(dp[i+1][j], dp[i][j+1]);
    }
  }
  const ops = [];
  let i = 0, j = 0;
  while(i < n && j < m){
    if(origNorm[i] === userNorm[j]){ ops.push({ type: "match", origIdx: i, userIdx: j }); i++; j++; }
    else if(dp[i+1][j] >= dp[i][j+1]){ ops.push({ type: "missing", origIdx: i }); i++; }
    else { ops.push({ type: "extra", userIdx: j }); j++; }
  }
  while(i < n){ ops.push({ type: "missing", origIdx: i }); i++; }
  while(j < m){ ops.push({ type: "extra", userIdx: j }); j++; }
  return ops;
}

// ---------- Quiz (تسميع) ----------
function openQuiz(surah, ayah){
  const key = verseKey(surah, ayah);
  const text = getVerseText(surah, ayah);
  if(!text){ showToast("نص هذه الآية غير متاح", true); return; }

  activeQuiz = { key, surah, ayah, text, isRange: false, revealedWordsCount: 0 };

  document.getElementById("quizTitle").textContent = `تسميع ${getSurahName(surah)} - آية ${ayah}`;
  document.getElementById("quizInput").value = "";
  document.getElementById("hintBox").className = "hint-box";
  document.getElementById("hintBox").textContent = "";
  document.getElementById("compareResult").innerHTML = "";
  document.getElementById("liveCheckBox").innerHTML = "";
  document.getElementById("selfRateBox").className = "self-rate";
  document.getElementById("manualReviewDate").value = "";
  document.getElementById("quizModal").classList.add("active");
}

// تسميع نطاق كامل (أكتر من آية) كقطعة واحدة متصلة، بدون تقسيم على حدود الآيات
function openQuizRange(startSurah, startAyah, endSurah, endAyah){
  const verses = getVersesInRange(startSurah, startAyah, endSurah, endAyah);
  const texts = verses.map(v => getVerseText(v.surah, v.ayah)).filter(Boolean);
  if(texts.length === 0){ showToast("نص هذا النطاق غير متاح", true); return; }

  // دمج كل الآيات في كتلة نصية واحدة متصلة (بدون أي فاصل يشير لحدود الآيات)
  const fullText = texts.join(" ");
  // مفتاح مركّب لتتبّع تقدّم الفقرة ككل في نظام المراجعة المتباعدة
  const key = "range_" + verseKey(startSurah, startAyah) + "_to_" + verseKey(endSurah, endAyah);

  activeQuiz = { key, surah: startSurah, ayah: startAyah, text: fullText, isRange: true, revealedWordsCount: 0 };

  const title = (startSurah === endSurah)
    ? `تسميع ${getSurahName(startSurah)} - من آية ${startAyah} إلى ${endAyah} (كقطعة واحدة)`
    : `تسميع من ${getSurahName(startSurah)}:${startAyah} إلى ${getSurahName(endSurah)}:${endAyah} (كقطعة واحدة)`;

  document.getElementById("quizTitle").textContent = title;
  document.getElementById("quizInput").value = "";
  document.getElementById("hintBox").className = "hint-box";
  document.getElementById("hintBox").textContent = "";
  document.getElementById("compareResult").innerHTML = "";
  document.getElementById("liveCheckBox").innerHTML = "";
  document.getElementById("selfRateBox").className = "self-rate";
  document.getElementById("manualReviewDate").value = "";
  document.getElementById("quizModal").classList.add("active");
}

function closeQuizModal(){
  document.getElementById("quizModal").classList.remove("active");
  document.getElementById("liveCheckBox").innerHTML = "";
  activeQuiz = null;
}

function showNextWordHint(){
  if(!activeQuiz) return;
  const words = tokenize(activeQuiz.text);
  activeQuiz.revealedWordsCount = Math.min(activeQuiz.revealedWordsCount + 1, words.length);
  const revealed = words.slice(0, activeQuiz.revealedWordsCount).join(" ");
  const box = document.getElementById("hintBox");
  box.className = "hint-box shown";
  box.innerHTML = `<b>البداية:</b> ${revealed} ...`;
}

// ---------- تصحيح فوري كلمة بكلمة (عند الضغط على مسافة) ----------
function liveCheckWords(){
  if(!activeQuiz) return;
  const box = document.getElementById("liveCheckBox");
  const raw = document.getElementById("quizInput").value;

  // الكلمات المكتملة فقط (اللي بعدها مسافة) — آخر كلمة لسه بتتكتب بنتجاهلها
  const endsWithSpace = /\s$/.test(raw);
  const completedRaw = endsWithSpace ? raw.trim() : raw.slice(0, raw.length - lastWordLength(raw)).trim();

  const originalWords = tokenize(activeQuiz.text);
  const originalNorm = originalWords.map(normalizeForCompare);
  const userCompletedWords = tokenize(completedRaw);

  if(userCompletedWords.length === 0){ box.innerHTML = ""; return; }

  let html = [];
  for(let idx = 0; idx < userCompletedWords.length; idx++){
    const uWord = userCompletedWords[idx];
    const uNorm = normalizeForCompare(uWord);
    if(idx >= originalWords.length){
      html.push(`<span class="word-extra">${uWord}</span>`); // كلمة زيادة عن حد الفقرة (مفيش أصل نقارنها بيه، فبتفضل زي ما كتبتها)
      continue;
    }
    const isMatch = uNorm === originalNorm[idx];
    // المقارنة بتتم على النص من غير تشكيل (uNorm مقابل originalNorm)
    // لكن العرض دايماً بالكلمة الأصلية المشكّلة من القرآن (originalWords) لو الكلمة صح
    // ولو غلط، نورّي كلمة المستخدم زي ما كتبها عشان يشوف غلطه بالظبط
    const displayWord = isMatch ? originalWords[idx] : uWord;
    html.push(`<span class="${isMatch ? 'word-ok' : 'word-wrong'}">${displayWord}</span>`);
  }
  box.innerHTML = html.join(" ");
}

function lastWordLength(raw){
  const m = raw.match(/(\S+)$/);
  return m ? m[1].length : 0;
}

function handleQuizInputKey(e){
  if(e.key === " " || e.key === "Spacebar"){
    // نأجل التنفيذ خطوة وحدة عشان المسافة تتسجل في value الأول
    setTimeout(liveCheckWords, 0);
  }
}

function checkQuizAnswer(){
  if(!activeQuiz) return;
  const userText = document.getElementById("quizInput").value.trim();
  if(!userText){ showToast("اكتب الآية الأول قبل التحقق", true); return; }

  const originalWords = tokenize(activeQuiz.text);
  const userWords = tokenize(userText);
  const originalNorm = originalWords.map(normalizeForCompare);
  const userNorm = userWords.map(normalizeForCompare);

  const ops = lcsAlign(originalWords, originalNorm, userNorm);
  let correctCount = 0;
  let htmlParts = [];
  ops.forEach(op => {
    if(op.type === "match"){ htmlParts.push(`<span class="word-ok">${originalWords[op.origIdx]}</span>`); correctCount++; }
    else if(op.type === "missing"){ htmlParts.push(`<span class="word-missing">${originalWords[op.origIdx]}</span>`); }
    else if(op.type === "extra"){ htmlParts.push(`<span class="word-extra">${userWords[op.userIdx]}</span>`); }
  });

  const percentage = originalWords.length > 0 ? Math.round((correctCount / originalWords.length) * 100) : 0;
  const resultBox = document.getElementById("compareResult");
  resultBox.innerHTML = `
    <div class="compare-output">${htmlParts.join(" ")}</div>
    <div class="compare-percentage">
      نسبة الصحة: <b style="color:${percentage >= 80 ? 'var(--green-ok)' : 'var(--red-err)'}">${percentage}%</b>
      (${correctCount} من ${originalWords.length} كلمة)
    </div>
    <div class="compare-legend">
      <span class="word-ok">أخضر = صحيح</span> ·
      <span class="word-missing">أحمر باهت = ناقص من كلامك</span> ·
      <span class="word-extra">مشطوب = كتبته زيادة أو غلط</span>
    </div>
  `;
  document.getElementById("selfRateBox").className = "self-rate shown";
}

// ---------- Spaced Repetition ----------
const BASE_INTERVAL_DAYS = 1;
const RATING_DELTA = { excellent: 10, good: 5, medium: 2, bad: -2 };

function todayStr(){ return new Date().toISOString().slice(0,10); }
function addDays(dateStr, days){
  const d = new Date(dateStr + "T00:00:00");
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0,10);
}
function isDue(key){
  const p = progress[key];
  if(!p || !p.nextReviewDate) return false;
  return p.nextReviewDate <= todayStr();
}
function daysDiff(a, b){
  const d1 = new Date(a + "T00:00:00");
  const d2 = new Date(b + "T00:00:00");
  return Math.round((d2 - d1) / (1000*60*60*24));
}

function recordReview(key, reviewDate, rating){
  const p = progress[key] || { history: [] };
  const prevInterval = p.intervalDays || 0;
  let newInterval;
  if(rating === "manual"){
    newInterval = prevInterval > 0 ? prevInterval : BASE_INTERVAL_DAYS;
  } else {
    const base = prevInterval > 0 ? prevInterval : BASE_INTERVAL_DAYS;
    newInterval = Math.max(1, base + RATING_DELTA[rating]);
  }
  p.lastReviewDate = reviewDate;
  p.intervalDays = newInterval;
  p.nextReviewDate = addDays(reviewDate, newInterval);
  p.history = p.history || [];
  p.history.push({ date: reviewDate, rating });
  progress[key] = p;
  saveToCloud();
}

function submitSelfRating(rating){
  if(!activeQuiz) return;
  recordReview(activeQuiz.key, todayStr(), rating);
  showToast("تم تسجيل المراجعة ✓ — المراجعة القادمة بعد " + progress[activeQuiz.key].intervalDays + " يوم");
  closeQuizModal();
  refreshAfterProgress();
}

function submitManualDate(){
  if(!activeQuiz) return;
  const dateVal = document.getElementById("manualReviewDate").value;
  if(!dateVal){ showToast("اختر تاريخ أولاً", true); return; }
  recordReview(activeQuiz.key, dateVal, "manual");
  showToast("تم تسجيل تاريخ المراجعة اليدوي ✓");
  closeQuizModal();
  refreshAfterProgress();
}

function refreshAfterProgress(){
  if(document.getElementById("view-review").classList.contains("active")){
    renderReviewTab();
  }
  if(document.getElementById("view-range-content").classList.contains("active") && currentRangeId){
    const range = ranges.find(r => r.id === currentRangeId);
    if(range) renderAyahs(range);
  }
  if(document.getElementById("view-ranges").classList.contains("active")){
    renderRangesList();
  }
  updateReviewBadge();
}

// ---------- Review Tab ----------
function getAllDueVerses(){
  const results = [];
  ranges.forEach(range => {
    const verses = getVersesInRange(range.startSurah, range.startAyah, range.endSurah, range.endAyah);
    verses.forEach(v => {
      const key = verseKey(v.surah, v.ayah);
      const p = progress[key];
      if(p && p.nextReviewDate && p.nextReviewDate <= todayStr()){
        results.push({
          key, range, surah: v.surah, ayah: v.ayah,
          nextReviewDate: p.nextReviewDate,
          overdueDays: daysDiff(p.nextReviewDate, todayStr())
        });
      }
    });
  });
  results.sort((a,b) => b.overdueDays - a.overdueDays);
  return results;
}

function renderReviewTab(){
  const due = getAllDueVerses();
  const overdueOnly = due.filter(d => d.overdueDays > 0);
  const todayOnly = due.filter(d => d.overdueDays === 0);

  const summary = document.getElementById("reviewSummary");
  summary.innerHTML = `
    <div class="stat-box overdue"><div class="num">${overdueOnly.length}</div><div class="lbl">متأخرة</div></div>
    <div class="stat-box"><div class="num">${todayOnly.length}</div><div class="lbl">مستحقة اليوم</div></div>
    <div class="stat-box"><div class="num">${due.length}</div><div class="lbl">الإجمالي</div></div>
  `;

  const list = document.getElementById("reviewList");
  list.innerHTML = "";
  if(due.length === 0){
    list.innerHTML = `<div class="empty-state"><div class="emoji">✅</div><div>مافيش آيات مستحقة للمراجعة دلوقتي، تبارك الله عليك</div></div>`;
    return;
  }

  due.forEach(item => {
    const el = document.createElement("div");
    el.className = "review-item " + (item.overdueDays > 0 ? "overdue" : "today");
    const tagText = item.overdueDays > 0 ? `متأخر ${item.overdueDays} يوم` : "مستحق اليوم";
    el.innerHTML = `
      <div class="info">
        <div class="title">${getSurahName(item.surah)} — آية ${item.ayah}</div>
        <div class="sub">النطاق: ${rangeLabel(item.range)}</div>
      </div>
      <span class="due-tag">${tagText}</span>
    `;
    el.onclick = () => openQuiz(item.surah, item.ayah);
    list.appendChild(el);
  });
}

function updateReviewBadge(){
  const due = getAllDueVerses();
  const badge = document.getElementById("reviewBadge");
  if(due.length > 0){
    badge.style.display = "flex";
    badge.textContent = due.length > 99 ? "99+" : due.length;
  } else {
    badge.style.display = "none";
  }
}

// ---------- Auth ----------
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
  msgEl.textContent = "";
  if(!fbReady){
    msgEl.className = "auth-msg err";
    msgEl.textContent = "خدمة المزامنة غير متاحة الآن، حاول تاني بعد قليل";
    return;
  }
  const email = document.getElementById("authEmail").value.trim();
  const password = document.getElementById("authPassword").value;
  if(!email || !password){
    msgEl.className = "auth-msg err";
    msgEl.textContent = "من فضلك اكتب البريد وكلمة المرور";
    return;
  }
  const action = authMode === "login"
    ? fbFns.signInWithEmailAndPassword(auth, email, password)
    : fbFns.createUserWithEmailAndPassword(auth, email, password);
  action
    .then(() => {
      msgEl.className = "auth-msg ok";
      msgEl.textContent = authMode === "login" ? "تم تسجيل الدخول ✓" : "تم إنشاء الحساب ✓";
      setTimeout(() => goToRanges(), 700);
    })
    .catch(err => {
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
    "auth/weak-password": "كلمة المرور ضعيفة، لازم تكون ٦ أحرف على الأقل",
    "auth/too-many-requests": "محاولات كتير، حاول بعد شوية"
  };
  return map[code] || ("حصل خطأ: " + code);
}

function doLogout(){
  if(!fbReady) return;
  fbFns.signOut(auth).then(() => { showToast("تم تسجيل الخروج"); goToRanges(); });
}

// ---------- Init ----------
loadLocalData();
populateSurahSelects();
const initialState = location.hash ? hashToState(location.hash) : { view: "ranges" };
history.replaceState(initialState, "", "#" + stateToHash(initialState));
applyState(initialState, false);
updateReviewBadge();
initFirebase();

// جعل الدوال متاحة من onclick (لأن الملف module)
window.switchTab = switchTab;
window.goToRanges = goToRanges;
window.showAuthView = showAuthView;
window.createRange = createRange;
window.deleteRange = deleteRange;
window.openRange = openRange;
window.toggleAyahText = toggleAyahText;
window.openQuiz = openQuiz;
window.openQuizRange = openQuizRange;
window.closeQuizModal = closeQuizModal;
window.showNextWordHint = showNextWordHint;
window.checkQuizAnswer = checkQuizAnswer;
window.handleQuizInputKey = handleQuizInputKey;
window.submitSelfRating = submitSelfRating;
window.submitManualDate = submitManualDate;
window.switchAuthTab = switchAuthTab;
window.submitAuth = submitAuth;
window.doLogout = doLogout;
function showToast(msg, isErr){
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.className = "toast show" + (isErr ? " err" : "");
  setTimeout(() => { t.className = "toast" + (isErr ? " err" : ""); }, 2800);
}

// ---------- Quran Data Helpers ----------
function getSurahName(num){
  const s = QURAN_SURAHS_LIST.find(s => s.number === num);
  return s ? s.name : ("سورة " + num);
}

function getVerseText(surah, ayah){
  const surahVerses = QURAN_VERSES_DATA[String(surah)];
  if(!surahVerses) return null;
  const v = surahVerses.find(v => v.number === ayah);
  return v ? v.text : null;
}

function getSurahTotalVerses(num){
  const s = QURAN_SURAHS_LIST.find(s => s.number === num);
  return s ? s.totalVerses : 0;
}

// إرجاع كل الآيات (سورة، رقم) بين نقطتي البداية والنهاية بترتيب المصحف
function getVersesInRange(startSurah, startAyah, endSurah, endAyah){
  const result = [];
  for(let s = startSurah; s <= endSurah; s++){
    const total = getSurahTotalVerses(s);
    const from = (s === startSurah) ? startAyah : 1;
    const to = (s === endSurah) ? endAyah : total;
    for(let a = from; a <= to; a++){
      result.push({ surah: s, ayah: a });
    }
  }
  return result;
}
