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

// نافذة العرض: نرسم الآيات المحيطة بالموضع فقط.
// رسم السورة كاملة كان يضع ٦١١٧ عنصرًا في الصفحة في البقرة وحدها،
// فيعيد المتصفح حساب تخطيط نص مضبوط لآلاف العناصر مع كل تغيير.
const WIN_BACK = 10, WIN_FWD = 22, WIN_EDGE = 8, WIN_STEP = 6, WIN_GROW = 25;
let winFrom = 1, winTo = 1;

// بدايات الأجزاء الثلاثين [سورة، آية]
const JUZ_STARTS = [
  [1,1],[2,142],[2,253],[3,93],[4,24],[4,148],[5,82],[6,111],[7,88],[8,41],
  [9,93],[11,6],[12,53],[15,1],[17,1],[18,75],[21,1],[23,1],[25,21],[27,56],
  [29,46],[33,31],[36,28],[39,32],[41,47],[46,1],[51,31],[58,1],[67,1],[78,1]
];

const $ = (id) => document.getElementById(id);

// مراجع العناصر الساخنة تُخزَّن مرة واحدة: البحث عنها بالمعرّف
// كان يتكرّر خمس عشرة مرة في كل ضغطة تنقّل.
const EL = {};
function cacheEls(){
  for(const id of ["pane","ayat","basmala","surahBand","locSurah","locMeta",
                   "trackFill","live","btnWordErr","btnAyahNote",
                   "btnPrevWord","btnPrevAyah","btnNextAyah"]) EL[id] = $(id);
}

// آخر ما كُتب فعلاً، حتى لا نعيد كتابة النص نفسه كل ضغطة
const shown = { loc:"", meta:"", pct:"", live:"", errLvl:-1, note:null };

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

// الكتابة على localStorage عملية متزامنة تُوقف الخيط الرئيسي.
// تنفيذها مع كل ضغطة كان يضاعف تكلفة التنقّل السريع، فأجّلناها.
let localPosTimer = null;
function persistPos(){
  pos.updatedAt = Date.now();
  clearTimeout(localPosTimer);
  localPosTimer = setTimeout(saveLocalPos, 250);
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
      render(pos.surah, pos.ayah);
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
    shown.errLvl = -1; shown.note = null;
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
function makeAyah(v, surahNum){
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

  // نعلّم الآية وقت إنشائها بدل إعادة فحص كل العلامات المسجّلة
  // في كل انزلاق — عددها ينمو مع الاستعمال وكان سيبطئ التسميع.
  const base = surahNum + ":" + v.number;
  for(let i = 0; i < els.length; i++){
    const lvl = annotations.wordLevel[base + ":" + i];
    if(lvl >= 1 && lvl <= 4) els[i].classList.add("lvl-" + lvl);
  }
  if(annotations.ayahNote[base]) ayahEl.classList.add("has-note");

  const no = document.createElement("span");
  no.className = "ayah-no";
  no.textContent = arDigits(v.number);
  ayahEl.appendChild(no);
  ayahEl.appendChild(document.createTextNode(" "));
  return ayahEl;
}

function dropAyah(n){
  const el = ayahElByNum.get(n);
  if(el && el.parentNode) el.parentNode.removeChild(el);
  ayahElByNum.delete(n);
  const words = wordsByAyah.get(n);
  if(words) for(let i = 0; i < words.length; i++) wordElByKey.delete(n + ":" + i);
  wordElsByAyah.delete(n);
  wordsByAyah.delete(n);
}

function moreButton(dir){
  const d = document.createElement("div");
  d.className = "more";
  d.dataset.edge = dir;
  const b = document.createElement("button");
  b.type = "button";
  b.dataset.more = dir;
  d.appendChild(b);
  return d;
}

let edgeBack = null, edgeFwd = null;
function updateEdges(total){
  const flow = EL.ayat;
  let back = edgeBack, fwd = edgeFwd;

  if(winFrom > 1){
    if(!back || !back.parentNode){ back = edgeBack = moreButton("back"); flow.insertBefore(back, flow.firstChild); }
    back.firstChild.textContent = `اعرض ما قبله · ${arDigits(winFrom - 1)} آية`;
  } else if(back){ back.remove(); edgeBack = null; }

  if(winTo < total){
    if(!fwd || !fwd.parentNode){ fwd = edgeFwd = moreButton("fwd"); flow.appendChild(fwd); }
    fwd.firstChild.textContent = `اعرض ما بعده · ${arDigits(total - winTo)} آية`;
  } else if(fwd){ fwd.remove(); edgeFwd = null; }
}

function buildWindow(surahNum, from, to){
  const verses = QURAN_VERSES_DATA[String(surahNum)];
  const flow = EL.ayat;
  flow.textContent = "";
  edgeBack = null; edgeFwd = null;
  wordElByKey = new Map(); ayahElByNum = new Map();
  wordElsByAyah = new Map(); wordsByAyah = new Map();
  curWordEl = null; curAyahEl = null;
  maskedAyah = null;

  $("surahBand").textContent = "سورة " + surahName(surahNum);

  if(!verses){
    flow.innerHTML = '<p class="pane-empty">نص هذه السورة غير متاح</p>';
    renderedSurah = surahNum; winFrom = 1; winTo = 1;
    $("basmala").hidden = true;
    return;
  }
  renderedSurah = surahNum;
  const total = verses.length;
  winFrom = Math.max(1, from); winTo = Math.min(total, to);

  const frag = document.createDocumentFragment();
  for(let n = winFrom; n <= winTo; n++) frag.appendChild(makeAyah(verses[n-1], surahNum));
  flow.appendChild(frag);

  updateEdges(total);
  updateBasmala();
  maskAll();
}

// البسملة عنوانٌ لكل السور عدا الفاتحة (هي آية فيها) والتوبة (بلا بسملة)،
// وتظهر فقط حين تكون بداية السورة داخل النافذة المعروضة
function updateBasmala(){
  const show = renderedSurah !== 1 && renderedSurah !== 9 && winFrom === 1;
  $("basmala").hidden = !show;
  if(show) $("basmala").textContent = basmalaText();
}

/* تنزلق النافذة بإضافة الناقص وحذف الخارج، بدل إعادة بنائها كاملة.
   إعادة البناء كل بضع آيات كانت تُحدث تهتيتة محسوسة أثناء التسميع.
   نثبّت الآية الحالية بصريًا حتى لا يقفز النص تحت عين القارئ. */
function slideWindow(from, to){
  const verses = QURAN_VERSES_DATA[String(renderedSurah)];
  if(!verses) return;
  const total = verses.length;
  from = Math.max(1, from); to = Math.min(total, to);
  if(from === winFrom && to === winTo) return;

  const pane = EL.pane, flow = EL.ayat;
  const anchor = ayahElByNum.get(pos.ayah);
  const before = anchor ? anchor.offsetTop : null;

  for(let n = winFrom; n < from; n++) dropAyah(n);
  for(let n = winTo;  n > to;   n--) dropAyah(n);

  if(to > winTo){
    const f = document.createDocumentFragment();
    for(let n = Math.max(winTo + 1, from); n <= to; n++) f.appendChild(makeAyah(verses[n-1], renderedSurah));
    const fwd = edgeFwd;
    if(fwd && fwd.parentNode) flow.insertBefore(f, fwd); else flow.appendChild(f);
  }
  if(from < winFrom){
    const f = document.createDocumentFragment();
    const stop = Math.min(winFrom - 1, to);
    for(let n = from; n <= stop; n++) f.appendChild(makeAyah(verses[n-1], renderedSurah));
    const first = ayahElByNum.get(Math.max(winFrom, from > winFrom ? from : winFrom));
    const ref = flow.querySelector(".ayah");
    if(ref) flow.insertBefore(f, ref); else flow.appendChild(f);
  }

  winFrom = from; winTo = to;
  updateEdges(total);
  updateBasmala();
  maskAll();

  const nowEl = ayahElByNum.get(pos.ayah);
  if(before !== null && nowEl && typeof nowEl.offsetTop === "number"){
    pane.scrollTop += (nowEl.offsetTop - before);
  }
}

function render(surahNum, center){
  const total = surahVerses(surahNum) || 1;
  const c = Math.min(Math.max(center || 1, 1), total);
  buildWindow(surahNum, c - WIN_BACK, c + WIN_FWD);
}

// يعيد true إن تغيّرت السورة (فيفقد الموضع السابق معناه لحساب الإخفاء)
function ensureWindow(){
  if(renderedSurah !== pos.surah){ render(pos.surah, pos.ayah); return true; }
  const total = surahVerses(pos.surah) || 1;
  if(pos.ayah < winFrom || pos.ayah > winTo){ render(pos.surah, pos.ayah); return true; }
  // ننزلق خطوة صغيرة ثابتة بدل قفزة كبيرة: كلفة الانزلاق تتناسب مع
  // عدد الآيات المضافة، فالقفزة الواحدة كانت تُحدث لحظة ثقل محسوسة.
  const nearStart = pos.ayah < winFrom + WIN_EDGE && winFrom > 1;
  const nearEnd   = pos.ayah > winTo - WIN_EDGE && winTo < total;
  if(nearEnd)        slideWindow(winFrom + WIN_STEP, winTo + WIN_STEP);
  else if(nearStart) slideWindow(winFrom - WIN_STEP, winTo - WIN_STEP);
  return false;
}

function extendWindow(dir){
  if(dir === "back") slideWindow(winFrom - WIN_GROW, winTo);
  else               slideWindow(winFrom, winTo + WIN_GROW);
  refresh(false);
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
  const lvl = annotations.wordLevel[pos.surah + ":" + pos.ayah + ":" + pos.w] || 0;
  if(lvl !== shown.errLvl){
    const b = EL.btnWordErr;
    b.classList.remove(...LVL);
    if(lvl >= 1 && lvl <= 4) b.classList.add("lvl-" + lvl);
    b.setAttribute("aria-label",
      lvl ? `درجة الخطأ على الكلمة الحالية: ${lvl} من 4` : "تسجيل خطأ على الكلمة الحالية");
    shown.errLvl = lvl;
  }
  const hasNote = !!annotations.ayahNote[pos.surah + ":" + pos.ayah];
  if(hasNote !== shown.note){
    const n = EL.btnAyahNote;
    n.classList.toggle("has-note", hasNote);
    n.setAttribute("aria-label", hasNote ? "تعديل ملاحظة هذه الآية" : "ملاحظة على الآية الحالية");
    shown.note = hasNote;
  }
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
  shown.errLvl = -1;
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
// الآيات التالية كاملةً تُعتَّم بكلاس على الآية نفسها (٢٨٦ عنصرًا في
// أكبر سورة)، ولا نعلّم كلمةً كلمة إلا داخل الآية الحالية وحدها.
// النسخة السابقة كانت تمرّ على ٦١١٧ كلمة في كل ضغطة تنقّل.
let maskedAyah = null, maskedW = 0;

function updateMask(prev){
  const sameSurah = prev && prev.surah === pos.surah;

  // مستوى الآية: نبدّل فقط الآيات الواقعة بين الموضع السابق والجديد.
  // الخطوة العادية للأمام تلمس آية واحدة، لا الـ ٢٨٦ كلها.
  if(!sameSurah || maskedAyah === null){
    ayahElByNum.forEach((el, num) => el.classList.toggle("fut", num > pos.ayah));
  } else if(maskedAyah !== pos.ayah){
    const lo = Math.min(maskedAyah, pos.ayah), hi = Math.max(maskedAyah, pos.ayah);
    for(let a = lo; a <= hi; a++){
      const el = ayahElByNum.get(a);
      if(el) el.classList.toggle("fut", a > pos.ayah);
    }
  }

  // مستوى الكلمة: لا نمسح علامات الآية السابقة إطلاقًا.
  // قاعدة التعتيم مقصورة في CSS على الآية الحالية، فالعلامات
  // المتبقّية على غيرها لا أثر لها، ومسحها كان يكلّف آلاف اللمسات.
  const cur = wordElsByAyah.get(pos.ayah);
  if(cur){
    if(sameSurah && maskedAyah === pos.ayah){
      // نفس الآية: الكلمات التي غيّرت حالتها هي ما بين الموضعين فقط
      const lo = Math.min(maskedW, pos.w), hi = Math.max(maskedW, pos.w);
      for(let i = lo; i <= hi && i < cur.length; i++)
        cur[i].classList.toggle("future", i > pos.w);
    } else {
      for(const e of cur) e.classList.toggle("future", +e.dataset.w > pos.w);
    }
  }

  maskedAyah = pos.ayah;
  maskedW = pos.w;
}

function maskAll(){ maskedAyah = null; updateMask(null); }

/* ------------------------------------------------------------------
   التظليل وتحديث الواجهة
------------------------------------------------------------------ */
function scrollIfNeeded(el){
  const pane = EL.pane;
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
  if(ensureWindow()) prev = null;

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

  // لا نكتب في الصفحة إلا ما تغيّر فعلاً
  const loc = "سورة " + surahName(pos.surah);
  if(loc !== shown.loc){ EL.locSurah.textContent = loc; shown.loc = loc; }

  const meta = `آية ${arDigits(pos.ayah)}/${arDigits(total)} · كلمة ${arDigits(pos.w+1)}/${arDigits(words.length)} · جزء ${arDigits(juzOf(pos.surah,pos.ayah))}`;
  if(meta !== shown.meta){ EL.locMeta.textContent = meta; shown.meta = meta; }

  const pct = ((pos.ayah / total) * 100).toFixed(1) + "%";
  if(pct !== shown.pct){ EL.trackFill.style.width = pct; shown.pct = pct; }

  const live = `${words[pos.w] || ""} — آية ${pos.ayah}، كلمة ${pos.w+1}`;
  if(live !== shown.live){ EL.live.textContent = live; shown.live = live; }

  updateMidButtons();

  EL.btnPrevAyah.disabled = (pos.surah === 1 && pos.ayah === 1);
  EL.btnNextAyah.disabled = (pos.surah === 114 && pos.ayah === surahVerses(114));
  EL.btnPrevWord.disabled = (pos.surah === 1 && pos.ayah === 1 && pos.w === 0);
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
// دمج الضغطات السريعة: الضغط المتكرّر بسرعة كان يكدّس عملية تحديث
// وسكرول ناعم لكل ضغطة فيتجمّد التطبيق. الآن كل الضغطات داخل إطار
// العرض الواحد تُنفَّذ مرة واحدة، ونحتفظ بأقدم موضع لحساب مدى الإخفاء.
let coalescedPrev = null, frameQueued = false;
function after(prev){
  if(coalescedPrev === null) coalescedPrev = prev;
  buzz();
  persistPos();
  if(frameQueued) return;
  // العلم يُرفع قبل الاستدعاء لا بعده: لو نفّذ المتصفح الدالة فورًا
  // لظلّ الحارس مرفوعًا إلى الأبد وتوقّف التحديث تمامًا.
  frameQueued = true;
  requestAnimationFrame(() => {
    frameQueued = false;
    const p = coalescedPrev; coalescedPrev = null;
    refresh(true, p);
  });
}

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
  persistAnn(); applyMarkers(); shown.note = null; updateMidButtons(); closePanel();
  toast(val ? "حُفظت الملاحظة" : "حُذفت الملاحظة");
}
function deleteNote(){
  delete annotations.ayahNote[pos.surah + ":" + pos.ayah];
  persistAnn(); applyMarkers(); shown.note = null; updateMidButtons(); closePanel();
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
  const pane = EL.pane;
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
    const more = e.target.closest("button[data-more]");
    if(more){ extendWindow(more.dataset.more); return; }
    const w = e.target.closest(".w");
    if(!w) return;
    jumpTo(pos.surah, +w.dataset.ayah, +w.dataset.w);
  });

  $("btnLocator").onclick = openJump;
  $("btnPanel").onclick = () => { renderAccount(); askStatus(); openPanel("panelSettings"); };
  $("btnDownload").onclick = startDownload;
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
      clearTimeout(localPosTimer);
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
let swActive = null, installPrompt = null, downloading = false;

function initServiceWorker(){
  if(!("serviceWorker" in navigator)){
    setDlState("متصفحك لا يدعم الحفظ على الجهاز", "جرّب من متصفح آخر مثل كروم أو سفاري.", 0);
    $("btnDownload").disabled = true;
    return;
  }
  navigator.serviceWorker.addEventListener("message", onSwMessage);
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js")
      .then(() => navigator.serviceWorker.ready)
      .then(reg => { swActive = reg.active || navigator.serviceWorker.controller; askStatus(); })
      .catch(err => {
        console.warn("تعذّر تسجيل خدمة العمل بدون إنترنت:", err);
        setDlState("تعذّر تفعيل الحفظ على الجهاز",
                   "يحتاج التطبيق أن يُفتح عبر https. جرّب إعادة تحميل الصفحة.", 0);
      });
  });
}

function askStatus(){
  const t = swActive || navigator.serviceWorker.controller;
  if(t) t.postMessage({ type: "STATUS" });
}

function onSwMessage(e){
  const d = e.data || {};
  if(d.type === "STATUS_RESULT"){
    const pct = d.total ? Math.round(d.have / d.total * 100) : 0;
    if(d.have >= d.total){
      setDlState("جاهز للعمل بدون إنترنت",
                 "المصحف والخط وكل ملفات التطبيق محفوظة على جهازك.", 100);
      $("btnDownload").textContent = "إعادة التحميل";
    } else if(d.have > 0){
      setDlState("محفوظ جزئيًا",
                 `${arDigits(d.have)} من ${arDigits(d.total)} ملفات. اضغط التحميل لإكمالها.`, pct);
    } else {
      setDlState("غير محفوظ بعد",
                 "اضغط «تحميل على الجهاز» ليعمل التطبيق بلا اتصال.", 0);
    }
  }
  else if(d.type === "PRECACHE_PROGRESS"){
    const pct = Math.round(d.done / d.total * 100);
    setDlState("جارٍ التحميل…", `${arDigits(d.done)} من ${arDigits(d.total)} ملفات`, pct);
  }
  else if(d.type === "PRECACHE_DONE"){
    downloading = false;
    $("btnDownload").disabled = false;
    if(d.failed){
      setDlState("اكتمل التحميل جزئيًا",
                 `تعذّر تحميل ${arDigits(d.failed)} ملف. تأكد من الاتصال وأعد المحاولة.`, 0);
      toast("تعذّر تحميل بعض الملفات — أعد المحاولة", true);
    } else {
      toast("جاهز للعمل بدون إنترنت");
    }
    askStatus();
  }
}

function setDlState(title, hint, pct){
  $("dlState").textContent = title;
  $("dlHint").textContent = hint;
  $("dlFill").style.width = pct + "%";
}

function startDownload(){
  if(downloading) return;
  const t = swActive || navigator.serviceWorker.controller;
  if(!t){
    toast("خدمة الحفظ لم تجهز بعد — أعد تحميل الصفحة", true);
    return;
  }
  if(!navigator.onLine){
    toast("تحتاج اتصالًا بالإنترنت مرة واحدة لتحميل المصحف", true);
    return;
  }
  downloading = true;
  $("btnDownload").disabled = true;
  setDlState("جارٍ التحميل…", "لا تغلق الصفحة", 2);
  t.postMessage({ type: "PRECACHE" });
}

// زر التثبيت على الشاشة الرئيسية — يظهر فقط حين يتيحه المتصفح
function initInstall(){
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    installPrompt = e;
    $("btnInstall").hidden = false;
  });
  window.addEventListener("appinstalled", () => {
    installPrompt = null;
    $("btnInstall").hidden = true;
    toast("تم تثبيت التطبيق");
  });
  $("btnInstall").onclick = async () => {
    if(!installPrompt) return;
    installPrompt.prompt();
    try{ await installPrompt.userChoice; }catch(e){}
    installPrompt = null;
    $("btnInstall").hidden = true;
  };
}

/* ------------------------------------------------------------------
   الإقلاع
------------------------------------------------------------------ */
cacheEls();
loadPrefs();
loadLocal();
wire();
initSwipe();
render(pos.surah, pos.ayah);
refresh(false);
renderAccount();
initServiceWorker();
initInstall();
initFirebase();
