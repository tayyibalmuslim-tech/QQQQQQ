// ============================================================
//  مصحف التنقل — حفظ القرآن بالتنقل الحر (كلمة / آية)
//  يعمل بدون إنترنت. المزامنة السحابية اختيارية.
// ============================================================

/* ------------------------------------------------------------------
   إعدادات Firebase
   مفاتيح Firebase عامة بطبيعتها وليست سرًّا. الحماية الحقيقية في
   Realtime Database Rules، ويجب أن تكون:
     { "rules": { "navApp": { "$uid": {
         ".read": "$uid === auth.uid", ".write": "$uid === auth.uid" } } } }
------------------------------------------------------------------ */
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

let auth = null, db = null, fbReady = false, currentUser = null;
let authMode = "login", fbFns = {};
let pendingPush = { pos: false, ann: false };

/* ------------------------------------------------------------------
   الحالة
------------------------------------------------------------------ */
const KEY = {
  pos:   "navq_position_v2",       // v2: أضفنا updatedAt لحل تعارض المزامنة
  posV1: "navq_position_v1",
  ann:   "navq_annotations_v3",    // v3: أضفنا updatedAt
  annV2: "navq_annotations_v2",
  theme: "navq_theme_v1",
  font:  "navq_fontsize_v1",
  mask:  "navq_mask_v1",
  swipe: "navq_swipe_v1",
  buzz:  "navq_buzz_v1"
};

let pos = { surah: 1, ayah: 1, w: 0, updatedAt: 0 };

// wordLevel["surah:ayah:w"] = 1..4   (١=هفوة … ٤=يحتاج تركيز)
// ayahNote["surah:ayah"]    = نص الملاحظة
let annotations = { wordLevel: {}, ayahNote: {}, updatedAt: 0 };

let renderedSurah = null;
let posTimer = null, annTimer = null;
let listSurah = 1;
let prefs = { mask: true, swipe: true, buzz: false };
let curWordEl = null, curAyahEl = null;

// فهرسة تُبنى وقت الرسم بدل البحث في كل ضغطة
let wordElByKey   = new Map();  // "ayah:w" -> element
let ayahElByNum   = new Map();  // ayah     -> element
let wordElsByAyah = new Map();  // ayah     -> [elements]
let wordsByAyah   = new Map();  // ayah     -> [strings]

const LVL = ["lvl-1","lvl-2","lvl-3","lvl-4"];

// بدايات الأجزاء الثلاثين [سورة، آية]
const JUZ_STARTS = [
  [1,1],[2,142],[2,253],[3,93],[4,24],[4,148],[5,82],[6,111],[7,88],[8,41],
  [9,93],[11,6],[12,53],[15,1],[17,1],[18,75],[21,1],[23,1],[25,21],[27,56],
  [29,46],[33,31],[36,28],[39,32],[41,47],[46,1],[51,31],[58,1],[67,1],[78,1]
];

const $ = (id) => document.getElementById(id);

/* ------------------------------------------------------------------
   تخزين محلي آمن
   في Safari بالتصفّح الخاص أو عند امتلاء التخزين يرمي localStorage
   استثناءً. بدون هذه الحماية كان أي ضغط على "الكلمة التالية" يوقف
   التطبيق بالكامل.
------------------------------------------------------------------ */
const store = {
  get(k){ try{ return localStorage.getItem(k); }catch(e){ return null; } },
  set(k,v){ try{ localStorage.setItem(k,v); return true; }catch(e){ return false; } }
};

/* ------------------------------------------------------------------
   نص المصحف
   تقسيم الكلمات يتم على المسافة العادية (U+0020) وحدها عمدًا.
   نص المصحف يحتوي في موضع واحد (البقرة ٧٢) مسافة رفيعة U+2009
   داخل الكلمة، وهي أداة طباعية لضبط موقع الهمزة وليست فاصل كلمات.
   لو قسّمنا بـ \s+ لانكسرت الكلمة نصفين وظهر نصفها الثاني
   كدائرة منقوطة لأنه يبدأ بعلامة تشكيل.
------------------------------------------------------------------ */
function tokenize(text){ return text.split(" ").filter(t => t.length); }

const surahByNum = new Map(QURAN_SURAHS_LIST.map(s => [s.number, s]));
function surahName(n){ const s = surahByNum.get(n); return s ? s.name : ("سورة " + n); }
function surahVerses(n){ const s = surahByNum.get(n); return s ? s.totalVerses : 0; }
function verseText(surah, ayah){
  const list = QURAN_VERSES_DATA[String(surah)];
  if(!list) return null;
  const v = list.find(v => v.number === ayah);
  return v ? v.text : null;
}
function arDigits(n){ const d="٠١٢٣٤٥٦٧٨٩"; return String(n).replace(/\d/g, c => d[+c]); }
function juzOf(surah, ayah){
  let j = 1;
  for(let i = 0; i < JUZ_STARTS.length; i++){
    const [s,a] = JUZ_STARTS[i];
    if(surah > s || (surah === s && ayah >= a)) j = i + 1; else break;
  }
  return j;
}
function wordCountOf(surah, ayah){
  if(surah === renderedSurah){
    const arr = wordsByAyah.get(ayah);
    if(arr) return arr.length;
  }
  const t = verseText(surah, ayah);
  return t ? tokenize(t).length : 0;
}
// البسملة تُقرأ من بيانات المصحف نفسها — لا تُكتب يدويًا أبدًا،
// فالكتابة اليدوية تخطئ في السكون العثماني وترتيب الشدّة والحركة.
function basmalaText(){
  const t = verseText(1, 1);
  return t || "";
}

/* ------------------------------------------------------------------
   الحفظ: محليًا فورًا، وسحابيًا بعد مهلة قصيرة
------------------------------------------------------------------ */
function loadLocal(){
  const rawPos = store.get(KEY.pos) || store.get(KEY.posV1);
  if(rawPos){
    try{
      const p = JSON.parse(rawPos);
      if(p && p.surah && p.ayah)
        pos = { surah:p.surah, ayah:p.ayah, w:p.w||0, updatedAt:p.updatedAt||0 };
    }catch(e){}
  }
  const rawAnn = store.get(KEY.ann) || store.get(KEY.annV2);
  if(rawAnn){
    try{
      const a = JSON.parse(rawAnn);
      annotations = { wordLevel:a.wordLevel||{}, ayahNote:a.ayahNote||{}, updatedAt:a.updatedAt||0 };
    }catch(e){}
  }
}
function saveLocalPos(){ store.set(KEY.pos, JSON.stringify(pos)); }
function saveLocalAnn(){ store.set(KEY.ann, JSON.stringify(annotations)); }

function persistPos(){
  pos.updatedAt = Date.now();
  saveLocalPos();
  clearTimeout(posTimer);
  posTimer = setTimeout(() => push("position"), 800);
}
function persistAnn(){
  annotations.updatedAt = Date.now();
  saveLocalAnn();
  clearTimeout(annTimer);
  annTimer = setTimeout(() => push("annotations"), 800);
}

function push(what){
  if(!currentUser || !fbReady) return;
  if(!navigator.onLine){
    if(what === "position") pendingPush.pos = true; else pendingPush.ann = true;
    setSync("off", "بلا اتصال");
    return;
  }
  const payload = what === "position" ? pos : annotations;
  fbFns.set(fbFns.ref(db, `navApp/${currentUser.uid}/${what}`), payload)
    .then(() => {
      if(what === "position") pendingPush.pos = false; else pendingPush.ann = false;
      setSync("on", "متزامن");
    })
    .catch(err => {
      if(what === "position") pendingPush.pos = true; else pendingPush.ann = true;
      setSync("err", "تعذّرت المزامنة");
      warnOnce(what, "تعذّرت المزامنة: " + explainDbError(err));
    });
}

/* ------------------------------------------------------------------
   حل تعارض المزامنة
   الموضع: الأحدث يفوز.
   الأخطاء والملاحظات: دمج حقيقي وليس استبدالًا — الاستبدال كان
   يمسح ملاحظات سجّلتها على جهاز إن فتحت جهازًا آخر أقدم.
   عند تعارض درجة كلمة نأخذ الأعلى، وعند تعارض نص ملاحظة نأخذ
   نسخة الطرف الأحدث.
------------------------------------------------------------------ */
function mergeAnnotations(local, remote){
  const out = { wordLevel:{}, ayahNote:{}, updatedAt: Math.max(local.updatedAt||0, remote.updatedAt||0) };
  const remoteNewer = (remote.updatedAt||0) > (local.updatedAt||0);

  const wl = Object.assign({}, local.wordLevel);
  for(const k in remote.wordLevel){
    wl[k] = (k in wl) ? Math.max(wl[k], remote.wordLevel[k]) : remote.wordLevel[k];
  }
  out.wordLevel = wl;

  const an = Object.assign({}, local.ayahNote);
  for(const k in remote.ayahNote){
    if(!(k in an) || remoteNewer) an[k] = remote.ayahNote[k];
  }
  out.ayahNote = an;
  return out;
}

function pullAll(uid){
  fbFns.get(fbFns.ref(db, `navApp/${uid}/position`)).then(snap => {
    const r = snap.exists() ? snap.val() : null;
    if(!r || !r.surah || !r.ayah){ push("position"); return; }
    const rAt = r.updatedAt || 0, lAt = pos.updatedAt || 0;
    if(rAt > lAt){
      pos = { surah:r.surah, ayah:r.ayah, w:r.w||0, updatedAt:rAt };
      saveLocalPos();
      render(pos.surah);
      refresh(true);
      toast("استُرجع موضعك من جهازك الآخر");
    } else if(lAt > rAt){
      push("position");
    }
    setSync("on", "متزامن");
  }).catch(err => {
    setSync("err", "تعذّرت المزامنة");
    warnOnce("pullPos", "تعذّر تحميل موضعك المحفوظ: " + explainDbError(err));
  });

  fbFns.get(fbFns.ref(db, `navApp/${uid}/annotations`)).then(snap => {
    if(!snap.exists()){ push("annotations"); return; }
    const r = snap.val() || {};
    const remote = { wordLevel:r.wordLevel||{}, ayahNote:r.ayahNote||{}, updatedAt:r.updatedAt||0 };
    const before = countAnn(annotations);
    annotations = mergeAnnotations(annotations, remote);
    saveLocalAnn();
    applyMarkers();
    updateMidButtons();
    const after = countAnn(annotations);
    if(after.words > before.words || after.notes > before.notes){
      toast("ضُمّت أخطاؤك وملاحظاتك من أجهزتك");
    }
    if(annotations.updatedAt > (remote.updatedAt||0)) push("annotations");
  }).catch(() => { /* خطأ الموضع يكفي، لا نكرّر التنبيه */ });
}

function countAnn(a){
  return { words: Object.keys(a.wordLevel).length, notes: Object.keys(a.ayahNote).length };
}

const warned = new Set();
function warnOnce(tag, msg){ if(warned.has(tag)) return; warned.add(tag); toast(msg, true); }
function explainDbError(err){
  const m = (err && err.message) || String(err);
  if(/permission[_ ]denied/i.test(m))
    return "قواعد صلاحيات Firebase لا تسمح بهذا المسار — راجع Rules في الكونسول";
  if(/network|offline|unavailable/i.test(m)) return "لا يوجد اتصال بالإنترنت";
  return m;
}

/* ------------------------------------------------------------------
   رسم السورة
   مستمع نقر واحد بالتفويض على الحاوية بدل دالة لكل كلمة —
   في البقرة وحدها هذا يوفّر أكثر من ٦٠٠٠ دالة في الذاكرة.
------------------------------------------------------------------ */
function render(surahNum){
  const verses = QURAN_VERSES_DATA[String(surahNum)];
  const flow = $("ayat");
  flow.textContent = "";
  wordElByKey = new Map(); ayahElByNum = new Map();
  wordElsByAyah = new Map(); wordsByAyah = new Map();
  curWordEl = null; curAyahEl = null;

  $("surahBand").textContent = "سورة " + surahName(surahNum);

  // البسملة عنوانٌ لكل السور عدا الفاتحة (هي آية فيها) والتوبة (بلا بسملة)
  const showBasmala = (surahNum !== 1 && surahNum !== 9);
  $("basmala").hidden = !showBasmala;
  if(showBasmala) $("basmala").textContent = basmalaText();

  if(!verses){
    flow.innerHTML = '<p class="pane-empty">نص هذه السورة غير متاح</p>';
    renderedSurah = surahNum;
    return;
  }

  const frag = document.createDocumentFragment();
  for(const v of verses){
    const ayahEl = document.createElement("span");
    ayahEl.className = "ayah";
    ayahEl.dataset.ayah = v.number;
    ayahElByNum.set(v.number, ayahEl);

    const words = tokenize(v.text);
    wordsByAyah.set(v.number, words);
    const els = [];

    words.forEach((word, i) => {
      const w = document.createElement("span");
      w.className = "w";
      w.textContent = word;
      w.dataset.ayah = v.number;
      w.dataset.w = i;
      ayahEl.appendChild(w);
      ayahEl.appendChild(document.createTextNode(" "));
      wordElByKey.set(v.number + ":" + i, w);
      els.push(w);
    });
    wordElsByAyah.set(v.number, els);

    const no = document.createElement("span");
    no.className = "ayah-no";
    no.textContent = arDigits(v.number);
    ayahEl.appendChild(no);
    ayahEl.appendChild(document.createTextNode(" "));
    frag.appendChild(ayahEl);
  }
  flow.appendChild(frag);
  renderedSurah = surahNum;
  maskAll();
  applyMarkers();
}

/* ------------------------------------------------------------------
   علامات الأخطاء والملاحظات على العناصر المرسومة
------------------------------------------------------------------ */
function applyMarkers(){
  wordElByKey.forEach(el => el.classList.remove(...LVL));
  ayahElByNum.forEach(el => el.classList.remove("has-note"));

  for(const key in annotations.wordLevel){
    const p = key.split(":");
    if(Number(p[0]) !== renderedSurah) continue;
    const el = wordElByKey.get(p[1] + ":" + p[2]);
    if(!el) continue;
    const lvl = annotations.wordLevel[key];
    if(lvl >= 1 && lvl <= 4) el.classList.add("lvl-" + lvl);
  }
  for(const key in annotations.ayahNote){
    const p = key.split(":");
    if(Number(p[0]) !== renderedSurah) continue;
    if(!annotations.ayahNote[key]) continue;
    const el = ayahElByNum.get(Number(p[1]));
    if(el) el.classList.add("has-note");
  }
}

function updateMidButtons(){
  const errBtn = $("btnWordErr");
  errBtn.classList.remove(...LVL);
  const lvl = annotations.wordLevel[pos.surah + ":" + pos.ayah + ":" + pos.w];
  if(lvl >= 1 && lvl <= 4) errBtn.classList.add("lvl-" + lvl);
  errBtn.setAttribute("aria-label",
    lvl ? `درجة الخطأ على الكلمة الحالية: ${lvl} من 4` : "تسجيل خطأ على الكلمة الحالية");

  const noteBtn = $("btnAyahNote");
  const hasNote = !!annotations.ayahNote[pos.surah + ":" + pos.ayah];
  noteBtn.classList.toggle("has-note", hasNote);
  noteBtn.setAttribute("aria-label", hasNote ? "تعديل ملاحظة هذه الآية" : "ملاحظة على الآية الحالية");
}

// أخضر ← أصفر ← برتقالي ← أحمر ← يُمسح
function markWordError(){
  const key = pos.surah + ":" + pos.ayah + ":" + pos.w;
  const cur = annotations.wordLevel[key] || 0;
  const next = cur >= 4 ? 0 : cur + 1;
  if(next === 0) delete annotations.wordLevel[key];
  else annotations.wordLevel[key] = next;
  persistAnn();
  applyMarkers();
  updateMidButtons();
  buzz();
}

/* ------------------------------------------------------------------
   الإخفاء
   إصلاح بق: النسخة السابقة كانت تحدّث الآية الحالية والسابقة فقط،
   فعند القفز للخلف (من آية ٢٠٠ إلى ٥) تبقى الآيات بينهما ظاهرة
   رغم أنها صارت "قادمة". الآن: تحديث موضعي للخطوة الواحدة،
   وفحص كامل لأي قفزة أكبر.
------------------------------------------------------------------ */
function markFuture(el){
  const a = +el.dataset.ayah, w = +el.dataset.w;
  el.classList.toggle("future", a > pos.ayah || (a === pos.ayah && w > pos.w));
}
function maskAll(){ wordElByKey.forEach(markFuture); }
function updateMask(prev){
  const same = prev && prev.surah === pos.surah;
  const step = same ? Math.abs(pos.ayah - prev.ayah) : Infinity;
  if(step <= 1){
    new Set([pos.ayah, prev.ayah]).forEach(a =>
      (wordElsByAyah.get(a) || []).forEach(markFuture));
  } else {
    maskAll();
  }
}

/* ------------------------------------------------------------------
   التظليل وتحديث الواجهة
------------------------------------------------------------------ */
function scrollIfNeeded(el){
  const pane = $("pane");
  const p = pane.getBoundingClientRect();
  const e = el.getBoundingClientRect();
  const pCenter = p.top + p.height / 2;
  const eCenter = e.top + e.height / 2;
  if(Math.abs(eCenter - pCenter) > p.height * 0.22){
    const target = Math.max(0, pane.scrollTop + (e.top - p.top) - p.height/2 + e.height/2);
    if(typeof pane.scrollTo === "function") pane.scrollTo({ top: target, behavior: "smooth" });
    else pane.scrollTop = target;
  }
}

function refresh(scroll, prev){
  if(renderedSurah !== pos.surah){ render(pos.surah); prev = null; }

  if(curWordEl) curWordEl.classList.remove("is-current");
  updateMask(prev);

  const wordEl = wordElByKey.get(pos.ayah + ":" + pos.w);
  const ayahEl = ayahElByNum.get(pos.ayah);

  if(ayahEl !== curAyahEl){
    if(curAyahEl) curAyahEl.classList.remove("is-current");
    if(ayahEl) ayahEl.classList.add("is-current");
    curAyahEl = ayahEl || null;
  }
  if(wordEl) wordEl.classList.add("is-current");
  curWordEl = wordEl || null;
  if(wordEl && scroll) scrollIfNeeded(wordEl);

  const words = wordsByAyah.get(pos.ayah) || tokenize(verseText(pos.surah, pos.ayah) || "");
  const total = surahVerses(pos.surah) || 1;

  $("locSurah").textContent = "سورة " + surahName(pos.surah);
  $("locMeta").textContent  =
    `آية ${arDigits(pos.ayah)}/${arDigits(total)} · كلمة ${arDigits(pos.w+1)}/${arDigits(words.length)} · جزء ${arDigits(juzOf(pos.surah,pos.ayah))}`;
  $("trackFill").style.width = ((pos.ayah / total) * 100).toFixed(1) + "%";
  $("live").textContent = `${words[pos.w] || ""} — آية ${pos.ayah}، كلمة ${pos.w+1} من ${words.length}`;

  updateMidButtons();

  $("btnPrevAyah").disabled = (pos.surah === 1 && pos.ayah === 1);
  $("btnNextAyah").disabled = (pos.surah === 114 && pos.ayah === surahVerses(114));
  $("btnPrevWord").disabled = (pos.surah === 1 && pos.ayah === 1 && pos.w === 0);
}

/* ------------------------------------------------------------------
   التنقل
------------------------------------------------------------------ */
function buzz(){ if(prefs.buzz && navigator.vibrate){ try{ navigator.vibrate(8); }catch(e){} } }
function snapshot(){ return { surah: pos.surah, ayah: pos.ayah, w: pos.w }; }

function stepAyah(dir){
  let { surah, ayah } = pos;
  ayah += dir;
  if(ayah < 1){
    if(surah <= 1) return false;
    surah--; ayah = surahVerses(surah);
  } else if(ayah > surahVerses(surah)){
    if(surah >= 114) return false;
    surah++; ayah = 1;
  }
  pos.surah = surah; pos.ayah = ayah;
  return true;
}
function nextWord(){
  const prev = snapshot();
  if(pos.w < wordCountOf(pos.surah, pos.ayah) - 1) pos.w++;
  else { if(!stepAyah(1)){ toast("ختمت المصحف، تقبّل الله منك"); return; } pos.w = 0; }
  after(prev);
}
function prevWord(){
  const prev = snapshot();
  if(pos.w > 0) pos.w--;
  else { if(!stepAyah(-1)){ toast("أنت عند أول المصحف"); return; } pos.w = Math.max(0, wordCountOf(pos.surah,pos.ayah)-1); }
  after(prev);
}
function nextAyah(){
  const prev = snapshot();
  if(!stepAyah(1)){ toast("ختمت المصحف، تقبّل الله منك"); return; }
  pos.w = 0; after(prev);
}
function prevAyah(){
  const prev = snapshot();
  if(!stepAyah(-1)){ toast("أنت عند أول المصحف"); return; }
  pos.w = 0; after(prev);
}
function jumpTo(surah, ayah, w){
  const prev = snapshot();
  pos.surah = surah; pos.ayah = ayah; pos.w = w || 0;
  after(prev);
}
function after(prev){ refresh(true, prev); persistPos(); buzz(); }

/* ------------------------------------------------------------------
   التفضيلات
------------------------------------------------------------------ */
function applyTheme(v){
  document.documentElement.setAttribute("data-theme", v);
  store.set(KEY.theme, v);
  syncSeg("segTheme","theme",v);
  const m = document.querySelector('meta[name="theme-color"]');
  if(m) m.setAttribute("content", v === "dark" ? "#0E1A16" : "#12352E");
}
function applyFont(v){
  document.documentElement.setAttribute("data-fontsize", v);
  store.set(KEY.font, v);
  syncSeg("segFont","size",v);
}
function syncSeg(id, attr, value){
  $(id).querySelectorAll("button").forEach(b =>
    b.setAttribute("aria-pressed", String(b.dataset[attr] === value)));
}
function applyMask(on){
  prefs.mask = on;
  document.body.classList.toggle("mask-on", on);
  $("swMask").setAttribute("aria-checked", String(on));
  store.set(KEY.mask, on ? "1" : "0");
}
function applySwipe(on){
  prefs.swipe = on;
  $("swSwipe").setAttribute("aria-checked", String(on));
  store.set(KEY.swipe, on ? "1" : "0");
}
function applyBuzz(on){
  prefs.buzz = on;
  $("swBuzz").setAttribute("aria-checked", String(on));
  store.set(KEY.buzz, on ? "1" : "0");
}
function loadPrefs(){
  applyTheme(store.get(KEY.theme) || "light");
  applyFont(store.get(KEY.font) || "md");
  applyMask(store.get(KEY.mask) !== "0");
  applySwipe(store.get(KEY.swipe) !== "0");
  applyBuzz(store.get(KEY.buzz) === "1");
}

/* ------------------------------------------------------------------
   اللوحات السفلية
------------------------------------------------------------------ */
let openPanelEl = null;
function openPanel(id){
  closePanel();
  const el = $(id);
  el.hidden = false;
  requestAnimationFrame(() => el.classList.add("open"));
  $("scrim").classList.add("open");
  openPanelEl = el;
}
function closePanel(){
  if(!openPanelEl) return;
  const el = openPanelEl;
  el.classList.remove("open");
  $("scrim").classList.remove("open");
  openPanelEl = null;
  setTimeout(() => { if(!el.classList.contains("open")) el.hidden = true; }, 280);
}

/* ------------------------------------------------------------------
   لوحة الانتقال
------------------------------------------------------------------ */
function buildSurahList(filter){
  const box = $("surahList");
  const q = (filter || "").trim();
  const items = QURAN_SURAHS_LIST.filter(s =>
    !q || s.name.includes(q) || String(s.number).startsWith(q));
  box.textContent = "";
  if(!items.length){
    box.innerHTML = '<p class="note" style="padding:14px;text-align:center">لا توجد سورة بهذا الاسم</p>';
    return;
  }
  const frag = document.createDocumentFragment();
  for(const s of items){
    const b = document.createElement("button");
    b.type = "button";
    b.setAttribute("role","option");
    b.setAttribute("aria-selected", String(s.number === listSurah));
    b.dataset.surah = s.number;
    b.innerHTML = `<span class="n">${arDigits(s.number)}</span><span>${s.name}</span>` +
                  `<span class="vc">${arDigits(s.totalVerses)} آية</span>`;
    frag.appendChild(b);
  }
  box.appendChild(frag);
  const sel = box.querySelector('[aria-selected="true"]');
  if(sel && typeof sel.scrollIntoView === "function") sel.scrollIntoView({ block:"nearest" });
}
function buildAyahPick(surahNum){
  const sel = $("ayahPick");
  const total = surahVerses(surahNum);
  const frag = document.createDocumentFragment();
  for(let a = 1; a <= total; a++){
    const o = document.createElement("option");
    o.value = a; o.textContent = "آية " + arDigits(a);
    frag.appendChild(o);
  }
  sel.textContent = ""; sel.appendChild(frag);
  sel.value = String(surahNum === pos.surah ? pos.ayah : 1);
}
function openJump(){
  listSurah = pos.surah;
  $("surahSearch").value = "";
  buildSurahList("");
  buildAyahPick(listSurah);
  openPanel("panelJump");
}

/* ------------------------------------------------------------------
   لوحة الملاحظة
   بديل window.prompt: يعرض نص الآية أثناء الكتابة، ويسمح بأسطر
   متعددة، ولا يُقصّ على الموبايل.
------------------------------------------------------------------ */
function openNote(){
  const key = pos.surah + ":" + pos.ayah;
  $("noteWhere").textContent = `سورة ${surahName(pos.surah)} — آية ${arDigits(pos.ayah)}`;
  $("noteAyah").textContent = verseText(pos.surah, pos.ayah) || "";
  $("noteText").value = annotations.ayahNote[key] || "";
  $("btnDeleteNote").hidden = !annotations.ayahNote[key];
  openPanel("panelNote");
  setTimeout(() => $("noteText").focus(), 320);
}
function saveNote(){
  const key = pos.surah + ":" + pos.ayah;
  const val = $("noteText").value.trim();
  if(val) annotations.ayahNote[key] = val;
  else delete annotations.ayahNote[key];
  persistAnn(); applyMarkers(); updateMidButtons(); closePanel();
  toast(val ? "حُفظت الملاحظة" : "حُذفت الملاحظة");
}
function deleteNote(){
  delete annotations.ayahNote[pos.surah + ":" + pos.ayah];
  persistAnn(); applyMarkers(); updateMidButtons(); closePanel();
  toast("حُذفت الملاحظة");
}

/* ------------------------------------------------------------------
   الحساب والمزامنة
------------------------------------------------------------------ */
function setSync(state, text){ $("sync").dataset.state = state; $("syncText").textContent = text; }

function renderAccount(){
  const box = $("acctBox");
  $("offlineNote").hidden = navigator.onLine;
  const c = countAnn(annotations);
  $("annStats").textContent =
    `عندك ${arDigits(c.words)} كلمة معلّمة و${arDigits(c.notes)} ملاحظة.`;

  if(currentUser){
    box.innerHTML =
      `<div class="acct">
         <div class="who">${currentUser.email}</div>
         <div class="when">موضعك وأخطاؤك وملاحظاتك تُحفظ تلقائيًا وتظهر على أي جهاز تدخل منه.</div>
       </div>
       <button class="btn btn-line" id="btnSignOut">تسجيل الخروج</button>`;
    $("btnSignOut").onclick = doSignOut;
  } else {
    box.innerHTML =
      `<p class="note" style="margin:0 0 10px">
         كل شيء محفوظ على هذا الجهاز. سجّل الدخول لمتابعة نفس التقدّم على الموبايل والكمبيوتر.
       </p>
       <button class="btn btn-main" id="btnOpenAuth">تسجيل الدخول أو إنشاء حساب</button>`;
    $("btnOpenAuth").onclick = () => openPanel("panelAuth");
  }
}

function doSignOut(){
  if(!fbReady) return;
  fbFns.signOut(auth).then(() => {
    toast("تم تسجيل الخروج. كل شيء ما زال محفوظًا على هذا الجهاز.");
    renderAccount();
  }).catch(err => toast("تعذّر تسجيل الخروج: " + explainDbError(err), true));
}

function setAuthMode(mode){
  authMode = mode;
  $("tabLogin").setAttribute("aria-selected", String(mode === "login"));
  $("tabSignup").setAttribute("aria-selected", String(mode === "signup"));
  $("btnAuth").textContent = mode === "login" ? "تسجيل الدخول" : "إنشاء الحساب";
  $("authPassword").setAttribute("autocomplete", mode === "login" ? "current-password" : "new-password");
  $("authMsg").textContent = ""; $("authMsg").className = "note";
}

function submitAuth(){
  const msg = $("authMsg");
  msg.className = "note";
  if(!navigator.onLine){
    msg.className = "note bad";
    msg.textContent = "تحتاج اتصالًا بالإنترنت لتسجيل الدخول. التطبيق نفسه يعمل بدونه.";
    return;
  }
  if(!fbReady){
    msg.className = "note bad";
    msg.textContent = "خدمة المزامنة لم تُحمّل بعد. حاول بعد لحظات.";
    return;
  }
  const email = $("authEmail").value.trim(), pass = $("authPassword").value;
  if(!email || !pass){
    msg.className = "note bad"; msg.textContent = "اكتب البريد وكلمة المرور."; return;
  }
  $("btnAuth").disabled = true;
  const run = authMode === "login"
    ? fbFns.signInWithEmailAndPassword(auth, email, pass)
    : fbFns.createUserWithEmailAndPassword(auth, email, pass);
  run.then(() => {
    msg.className = "note good";
    msg.textContent = authMode === "login" ? "تم تسجيل الدخول" : "تم إنشاء الحساب";
    $("authPassword").value = "";
    setTimeout(() => { closePanel(); renderAccount(); }, 600);
  }).catch(err => {
    msg.className = "note bad"; msg.textContent = authError(err.code);
  }).finally(() => { $("btnAuth").disabled = false; });
}

function authError(code){
  const map = {
    "auth/invalid-email":          "البريد الإلكتروني غير صحيح.",
    "auth/user-not-found":         "لا يوجد حساب بهذا البريد. أنشئ حسابًا جديدًا.",
    "auth/wrong-password":         "كلمة المرور غير صحيحة.",
    "auth/invalid-credential":     "البريد أو كلمة المرور غير صحيحة.",
    "auth/email-already-in-use":   "هذا البريد مسجّل من قبل. سجّل الدخول بدل إنشاء حساب.",
    "auth/weak-password":          "كلمة المرور قصيرة — ستة أحرف على الأقل.",
    "auth/too-many-requests":      "محاولات كثيرة. انتظر دقائق ثم أعد المحاولة.",
    "auth/network-request-failed": "تعذّر الاتصال بالشبكة."
  };
  return map[code] || ("حدث خطأ: " + code);
}

async function initFirebase(){
  if(!navigator.onLine){ setSync("off","بلا اتصال"); return; }
  try{
    const [{ initializeApp }, a, d] = await Promise.all([
      import("https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js"),
      import("https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js"),
      import("https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js")
    ]);
    const app = initializeApp(firebaseConfig);
    auth = a.getAuth(app); db = d.getDatabase(app);
    fbFns = {
      createUserWithEmailAndPassword: a.createUserWithEmailAndPassword,
      signInWithEmailAndPassword: a.signInWithEmailAndPassword,
      onAuthStateChanged: a.onAuthStateChanged,
      signOut: a.signOut,
      ref: d.ref, set: d.set, get: d.get
    };
    fbReady = true;
    fbFns.onAuthStateChanged(auth, (user) => {
      currentUser = user;
      setSync(user ? "on" : "off", user ? "متزامن" : "محلي");
      renderAccount();
      if(user) pullAll(user.uid);
    });
  }catch(err){
    // فشل تحميل Firebase لا يمنع التطبيق من العمل — المزامنة وحدها تتعطّل
    console.warn("تعذّر تحميل خدمة المزامنة:", err);
    setSync("off","محلي");
  }
}

/* ------------------------------------------------------------------
   التنبيهات
   إصلاح بق: النسخة السابقة لم تكن تلغي المؤقّت السابق، فكانت
   الرسالة الجديدة تختفي مبكرًا بتوقيت الرسالة التي قبلها.
------------------------------------------------------------------ */
let toastTimer = null;
function toast(msg, bad){
  const t = $("toast");
  t.textContent = msg;
  t.className = "toast show" + (bad ? " bad" : "");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.className = "toast" + (bad ? " bad" : ""); }, 2800);
}

/* ------------------------------------------------------------------
   السحب على نص المصحف
------------------------------------------------------------------ */
function initSwipe(){
  const pane = $("pane");
  let x0=0, y0=0, live=false;
  pane.addEventListener("touchstart", (e) => {
    if(!prefs.swipe || e.touches.length !== 1){ live=false; return; }
    x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; live = true;
  }, { passive:true });
  pane.addEventListener("touchend", (e) => {
    if(!live) return;
    live = false;
    const t = e.changedTouches[0];
    const dx = t.clientX - x0, dy = t.clientY - y0;
    if(Math.abs(dx) < 55 || Math.abs(dx) < Math.abs(dy) * 1.6) return;
    if(dx < 0) nextWord(); else prevWord();   // في RTL: لليسار يتقدّم
  }, { passive:true });
}

/* ------------------------------------------------------------------
   ربط الأحداث
------------------------------------------------------------------ */
function wire(){
  $("btnNextWord").onclick = nextWord;
  $("btnPrevWord").onclick = prevWord;
  $("btnNextAyah").onclick = nextAyah;
  $("btnPrevAyah").onclick = prevAyah;
  $("btnWordErr").onclick  = markWordError;
  $("btnAyahNote").onclick = openNote;
  $("btnSaveNote").onclick = saveNote;
  $("btnDeleteNote").onclick = deleteNote;

  $("ayat").addEventListener("click", (e) => {
    const w = e.target.closest(".w");
    if(!w) return;
    jumpTo(pos.surah, +w.dataset.ayah, +w.dataset.w);
  });

  $("btnLocator").onclick = openJump;
  $("btnPanel").onclick = () => { renderAccount(); openPanel("panelSettings"); };
  $("scrim").onclick = closePanel;
  document.querySelectorAll("[data-close]").forEach(b => b.onclick = closePanel);

  $("surahSearch").addEventListener("input", e => buildSurahList(e.target.value));
  $("surahList").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-surah]");
    if(!b) return;
    listSurah = +b.dataset.surah;
    $("surahList").querySelectorAll("button").forEach(x =>
      x.setAttribute("aria-selected", String(+x.dataset.surah === listSurah)));
    buildAyahPick(listSurah);
  });
  $("btnGo").onclick = () => { const a = +$("ayahPick").value || 1; closePanel(); jumpTo(listSurah, a, 0); };

  $("segFont").addEventListener("click", e => {
    const b = e.target.closest("button[data-size]"); if(b) applyFont(b.dataset.size);
  });
  $("segTheme").addEventListener("click", e => {
    const b = e.target.closest("button[data-theme]"); if(b) applyTheme(b.dataset.theme);
  });
  $("swMask").onclick  = () => { applyMask(!prefs.mask); maskAll(); };
  $("swSwipe").onclick = () => applySwipe(!prefs.swipe);
  $("swBuzz").onclick  = () => { applyBuzz(!prefs.buzz); buzz(); };

  $("tabLogin").onclick  = () => setAuthMode("login");
  $("tabSignup").onclick = () => setAuthMode("signup");
  $("btnAuth").onclick   = submitAuth;
  $("authPassword").addEventListener("keydown", e => { if(e.key === "Enter") submitAuth(); });

  window.addEventListener("keydown", (e) => {
    if(openPanelEl){ if(e.key === "Escape") closePanel(); return; }
    const tag = (e.target.tagName || "").toLowerCase();
    if(tag === "input" || tag === "select" || tag === "textarea") return;
    switch(e.key){
      case "ArrowLeft":  e.preventDefault(); nextWord(); break;
      case "ArrowRight": e.preventDefault(); prevWord(); break;
      case "ArrowDown":  e.preventDefault(); nextAyah(); break;
      case "ArrowUp":    e.preventDefault(); prevAyah(); break;
      case " ":          e.preventDefault(); nextWord(); break;
      case "x": case "X": markWordError(); break;
      case "n": case "N": openNote(); break;
      case "m": case "M": applyMask(!prefs.mask); maskAll(); break;
    }
  });

  window.addEventListener("online", () => {
    $("offlineNote").hidden = true;
    if(!fbReady) initFirebase();
    else {
      if(pendingPush.pos) push("position");
      if(pendingPush.ann) push("annotations");
      if(currentUser && !pendingPush.pos && !pendingPush.ann) setSync("on","متزامن");
    }
  });
  window.addEventListener("offline", () => {
    $("offlineNote").hidden = false;
    setSync("off","بلا اتصال");
  });

  document.addEventListener("visibilitychange", () => {
    if(document.visibilityState === "hidden"){
      saveLocalPos(); saveLocalAnn();
      if(currentUser && navigator.onLine){
        clearTimeout(posTimer); clearTimeout(annTimer);
        push("position"); push("annotations");
      }
    }
  });
}

/* ------------------------------------------------------------------
   العمل بدون إنترنت
------------------------------------------------------------------ */
function initServiceWorker(){
  if(!("serviceWorker" in navigator)) return;
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js")
      .catch(err => console.warn("تعذّر تسجيل خدمة العمل بدون إنترنت:", err));
  });
}

/* ------------------------------------------------------------------
   الإقلاع
------------------------------------------------------------------ */
loadPrefs();
loadLocal();
wire();
initSwipe();
render(pos.surah);
refresh(false);
renderAccount();
initServiceWorker();
initFirebase();
