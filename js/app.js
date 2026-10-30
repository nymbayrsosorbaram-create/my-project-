/* Хүүхдийн бүтээлийн дүгнэлт — үндсэн логик */
(() => {
  const $ = id => document.getElementById(id);
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const clone = o => JSON.parse(JSON.stringify(o));
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const today = () => new Date().toISOString().slice(0, 10);

  const state = {
    settings: { school: "", teacher: "", year: "", lastBackup: null },
    groups: [],
    children: [],
    activeGroupId: null,
    kidId: null,
    bank: null,
    reference: DEFAULT_REFERENCE,
    records: [],
    form: { id: null, images: [], ratings: {} },
    editGroupId: null
  };

  function toast(msg, ms = 2500) {
    const t = $("toast");
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(toast._t);
    toast._t = setTimeout(() => t.classList.remove("show"), ms);
  }

  function defaultBank() {
    return { version: BANK_VERSION, criteria: clone(DEFAULT_CRITERIA), summary: clone(DEFAULT_SUMMARY), chips: clone(DEFAULT_CHIPS) };
  }

  const activeGroup = () => state.groups.find(g => g.id === state.activeGroupId) || null;
  const groupById = id => state.groups.find(g => g.id === id) || null;
  const enabledCriteria = () => state.bank.criteria.filter(c => c.enabled !== false);
  const critsFor = act => enabledCriteria().filter(c => !c.acts || !c.acts.length || c.acts.includes(act));
  const scaleOf = c => SCALES[c.scale] || SCALES.skill;
  const fill = (tpl, name) => String(tpl || "").replaceAll("{name}", name);
  const kidsOf = groupId => state.children.filter(k => k.groupId === groupId).sort((a, b) => a.name.localeCompare(b.name, "mn"));
  const kidById = id => state.children.find(k => k.id === id) || null;
  const recordsOfKid = kid => state.records.filter(r => r.childId === kid.id).sort((a, b) => (a.date || "").localeCompare(b.date || "") || a.createdAt - b.createdAt);

  /* Төрсөн огнооноос тухайн өдрийн нас (он, сар) */
  function ageText(birth, on) {
    if (!birth) return "";
    const b = new Date(birth), d = on ? new Date(on) : new Date();
    if (isNaN(b) || isNaN(d)) return "";
    let m = (d.getFullYear() - b.getFullYear()) * 12 + d.getMonth() - b.getMonth();
    if (d.getDate() < b.getDate()) m--;
    if (m < 0) return "";
    return `${Math.floor(m / 12)} нас ${m % 12} сар`;
  }

  /* Шалгуур хангасан хувь: Хангасан = 1, Хэсэгчлэн = 0.5, Хангаагүй = 0 */
  function calcResult(ratings, crits) {
    const vals = crits.map(c => ratings[c.id]).filter(v => v > 0);
    if (!vals.length) return null;
    const pct = Math.round(vals.reduce((a, v) => a + (v === 3 ? 1 : v === 2 ? 0.5 : 0), 0) / vals.length * 1000) / 10;
    const band = RESULT_BANDS.findIndex(b => pct >= b.min);
    return { pct, band };
  }
  const resultLabel = res => res ? `${res.pct}% · ${RESULT_BANDS[res.band].name}` : "";

  function download(blob, filename) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }

  function safeName(s) {
    return String(s || "").replace(/[\\/:*?"<>|]+/g, "").trim().replace(/\s+/g, "_") || "buteel";
  }

  /* ---------- Хадгалах ---------- */
  const saveSettings = () => DB.setKV("settings", state.settings);
  const saveGroups = () => DB.setKV("groups", state.groups);
  const saveChildren = () => DB.setKV("children", state.children);
  const saveBank = () => DB.setKV("bank", state.bank);

  function newKid(groupId, name) {
    return { id: uid(), groupId, name: name.trim(), sex: "", birth: "", parent: "", phone: "", about: "", notes: [], createdAt: Date.now() };
  }

  async function ensureKid(groupId, name) {
    name = name.trim();
    let k = state.children.find(x => x.groupId === groupId && x.name === name);
    if (!k) {
      k = newKid(groupId, name);
      state.children.push(k);
      await saveChildren();
    }
    return k;
  }

  async function load() {
    state.settings = Object.assign(state.settings, (await DB.getKV("settings")) || {});
    state.groups = (await DB.getKV("groups")) || [];
    state.children = (await DB.getKV("children")) || [];
    state.activeGroupId = (await DB.getKV("activeGroup")) || (state.groups[0] && state.groups[0].id) || null;
    state.records = (await DB.getAll()) || [];

    const bank = await DB.getKV("bank");
    if (bank && bank.version === BANK_VERSION) state.bank = bank;
    else {
      state.bank = defaultBank();
      await saveBank();
      if (bank) state.migratedBank = true;
    }
    if ((await DB.getKV("refVersion")) === REF_VERSION) state.reference = (await DB.getKV("reference")) ?? DEFAULT_REFERENCE;
    else {
      state.reference = DEFAULT_REFERENCE;
      await DB.setKV("reference", DEFAULT_REFERENCE);
      await DB.setKV("refVersion", REF_VERSION);
    }

    // Өмнөх хувилбарт хүүхдийн нэрс бүлэг дотор хадгалагддаг байсныг хувийн хавтас болгоно
    let changed = false;
    for (const g of state.groups) {
      if (Array.isArray(g.children)) {
        for (const n of g.children) if (n && !state.children.some(k => k.groupId === g.id && k.name === n)) state.children.push(newKid(g.id, n));
        delete g.children;
        changed = true;
      }
    }
    for (const r of state.records) {
      if (r.childId || !r.child) continue;
      let k = state.children.find(x => x.groupId === r.groupId && x.name === r.child);
      if (!k) { k = newKid(r.groupId, r.child); state.children.push(k); }
      r.childId = k.id;
      await DB.put(r);
      changed = true;
    }
    if (changed) { await saveGroups(); await saveChildren(); }
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
  }

  /* ---------- Табууд ---------- */
  function showTab(name) {
    document.querySelectorAll("#tabs button").forEach(b => b.classList.toggle("active", b.dataset.tab === name));
    document.querySelectorAll(".tab").forEach(s => s.classList.toggle("active", s.id === "tab-" + name));
    if (name === "records") renderRecords();
    if (name === "backup") renderBackupInfo();
    if (name === "reference") renderReference();
    if (name === "children") renderKids();
    window.scrollTo(0, 0);
  }

  /* ---------- Толгой хэсэг: бүлэг сонгох ---------- */
  function renderGroupSelect() {
    const sel = $("activeGroup");
    sel.innerHTML = state.groups.length
      ? state.groups.map(g => `<option value="${g.id}">${esc(g.name)} (${AGE_GROUPS[g.ageKey].age})</option>`).join("")
      : `<option value="">— Бүлэг алга —</option>`;
    if (state.activeGroupId) sel.value = state.activeGroupId;
    $("noGroupNotice").hidden = state.groups.length > 0;
    $("schoolLabel").textContent = [state.settings.school, state.settings.year].filter(Boolean).join(" · ") || "СӨБ · Зураг, урлал";
    renderChildList();
    syncLevelToGroup();
    renderCriteria();
  }

  function renderChildList() {
    const g = activeGroup();
    $("childList").innerHTML = g ? kidsOf(g.id).map(k => `<option value="${esc(k.name)}">`).join("") : "";
  }

  function syncLevelToGroup() {
    const g = activeGroup();
    if (g && !state.form.id) $("fLevel").value = g.ageKey;
  }

  /* Форм дээрх хүүхдийн нэрээр хавтаснаас насыг бөглөнө */
  function fillAgeFromKid() {
    const g = activeGroup();
    const k = g && state.children.find(x => x.groupId === g.id && x.name === $("fChild").value.trim());
    if (k && k.birth) $("fAge").value = ageText(k.birth, $("fDate").value);
  }

  /* ---------- Шалгуур ---------- */
  function renderCriteria() {
    const lv = $("fLevel").value || "ahlah";
    const ag = AGE_GROUPS[lv];
    $("critHint").textContent = `· ${ag.level} (${ag.name}) · ${ACTIVITIES[$("fActivity").value]?.name || ""}`;
    $("criteria").innerHTML = critsFor($("fActivity").value).map(c => {
      const cur = state.form.ratings[c.id] || 0;
      const sc = scaleOf(c);
      const prog = c.program && c.program[lv];
      const sheet = c.sheet && c.sheet[lv];
      return `<div class="crit" data-id="${c.id}">
        <div class="crit-info">
          <b>${esc(c.name)}</b>
          <span class="domain">${esc(DOMAINS[c.domain] || "")}</span>
          ${c.comp ? `<span class="domain comp">${esc(COMPETENCIES[c.comp] || "")}</span>` : ""}
          ${prog ? `<div class="prog small">📘 ${esc(prog)}</div>` : ""}
          ${sheet ? `<div class="muted small">📋 Үнэлгээний хуудас (${ag.sheet}): ${esc(sheet)}</div>` : ""}
        </div>
        <div class="levels">
          ${[3, 2, 1].map(l => `<button class="lvbtn lv${l} ${cur === l ? "on" : ""}" data-lv="${l}" title="${esc(sc[l].desc)}">${sc[l].name}</button>`).join("")}
        </div>
      </div>`;
    }).join("");
    renderResultBox();
  }

  function renderResultBox() {
    const res = calcResult(state.form.ratings, critsFor($("fActivity").value));
    const box = $("resultBox");
    box.hidden = !res;
    if (!res) return;
    const b = RESULT_BANDS[res.band];
    box.className = "result-box lv" + b.tag;
    box.innerHTML = `<span class="pct">${res.pct}%</span>
      <span><b>${b.name}</b><br><small>${b.support} · шалгуур хангасан хувь (гарын авлага: ≥65 Хангалттай, 36–64 Дундаж, ≤35 Дунджаас доогуур)</small></span>`;
  }

  /* ---------- Дүгнэлт үүсгэх ---------- */
  function generateConclusion() {
    const lv = $("fLevel").value || "ahlah";
    const name = $("fChild").value.trim() || "Хүүхэд";
    const act = $("fActivity").value;
    const topic = $("fTopic").value.trim();
    const topicPart = topic ? `"${topic}" сэдвээр ` : "";
    const ratings = state.form.ratings;
    const crits = critsFor(act).filter(c => ratings[c.id] > 0);

    const intro = (ACTIVITIES[act]?.intro || "{name} {topic}бүтээл хийлээ.").replace("{topic}", topicPart);
    const body = [fill(intro, name)];
    let n = 0;
    crits.forEach(c => {
      const set = c.byActivity ? c.phrases[act] : c.phrases[lv];
      const p = set && set[ratings[c.id]];
      if (!p) return;
      // Нэрийг өгүүлбэр бүрт давтахгүйн тулд гурав тутмын өгүүлбэрт л үлдээнэ
      if (n++ % 3 !== 2 && p.startsWith("{name} ")) {
        const rest = p.slice(7);
        body.push(rest.charAt(0).toUpperCase() + rest.slice(1));
      } else body.push(fill(p, name));
    });

    const paras = [body.join(" ")];
    const S = state.bank.summary;
    const res = calcResult(ratings, crits);
    if (res) {
      let sum = fill(S[res.band], name).replace("{pct}", res.pct);
      const strong = [...new Set(crits.filter(c => ratings[c.id] === 3).map(c => COMPETENCIES[c.comp]).filter(Boolean))];
      if (strong.length && crits.some(c => ratings[c.id] < 3)) sum += " " + S.strengths.replace("{list}", strong.join(", ").toLowerCase());
      paras.push(sum);
    }

    if ($("optAdvice").checked && crits.length) {
      const low = crits.filter(c => ratings[c.id] === 1).concat(crits.filter(c => ratings[c.id] === 2));
      const advice = [...new Set(low.map(c => c.advice).filter(Boolean))].slice(0, 4);
      if (advice.length) paras.push("Зөвлөмж:\n" + advice.map(a => "• " + fill(a, name)).join("\n"));
      else if (S.allHigh) paras.push("Зөвлөмж: " + fill(S.allHigh, name));
    }

    if ($("optParents").checked) {
      const pool = (state.bank.chips["Эцэг эхэд"] || []).slice();
      const pick = [];
      while (pool.length && pick.length < 2) pick.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
      if (pick.length) paras.push("Эцэг эхэд:\n" + pick.map(a => "• " + fill(a, name)).join("\n"));
    }

    $("fConclusion").value = paras.join("\n\n");
    if (!crits.length) toast("Шалгуурын түвшнээ сонговол дүгнэлт илүү дэлгэрэнгүй гарна.");
  }

  function renderChips() {
    const chips = state.bank.chips;
    $("chips").innerHTML = Object.keys(chips).map(cat => `
      <details ${cat === "Магтаал" ? "open" : ""}>
        <summary>${esc(cat)}</summary>
        <div class="chip-row">${chips[cat].map(p => `<button class="chip" data-chip="${esc(p)}">${esc(p)}</button>`).join("")}</div>
      </details>`).join("");
  }

  function insertAtCursor(ta, text) {
    const start = ta.selectionStart ?? ta.value.length;
    const end = ta.selectionEnd ?? ta.value.length;
    const before = ta.value.slice(0, start);
    const sep = before && !/\s$/.test(before) ? " " : "";
    ta.value = before + sep + text + ta.value.slice(end);
    const pos = (before + sep + text).length;
    ta.focus();
    ta.setSelectionRange(pos, pos);
  }

  /* ---------- Зураг ---------- */
  function readImage(file) {
    return new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => {
        const img = new Image();
        img.onload = () => resolve(resizeImage(img, 1600));
        img.onerror = reject;
        img.src = fr.result;
      };
      fr.onerror = reject;
      fr.readAsDataURL(file);
    });
  }

  function resizeImage(img, max, rotate = 0) {
    let w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
    const k = Math.min(1, max / Math.max(w, h));
    w = Math.round(w * k); h = Math.round(h * k);
    const cv = document.createElement("canvas");
    const swap = rotate % 180 !== 0;
    cv.width = swap ? h : w; cv.height = swap ? w : h;
    const ctx = cv.getContext("2d");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, cv.width, cv.height);
    ctx.translate(cv.width / 2, cv.height / 2);
    ctx.rotate(rotate * Math.PI / 180);
    ctx.drawImage(img, -w / 2, -h / 2, w, h);
    return { src: cv.toDataURL("image/jpeg", 0.85), w: cv.width, h: cv.height };
  }

  async function addFiles(files) {
    const list = [...files].filter(f => f.type.startsWith("image/"));
    for (const f of list) {
      try { state.form.images.push(await readImage(f)); }
      catch { toast("Зургийг уншиж чадсангүй: " + f.name); }
    }
    renderThumbs();
  }

  function renderThumbs() {
    $("thumbs").innerHTML = state.form.images.map((im, i) => `
      <div class="thumb">
        <img src="${im.src}" alt="">
        <div class="thumb-actions">
          <button data-rot="${i}" title="Эргүүлэх">⟳</button>
          <button data-delimg="${i}" title="Устгах">✕</button>
        </div>
      </div>`).join("");
  }

  function rotateImage(i) {
    const im = state.form.images[i];
    const img = new Image();
    img.onload = () => { state.form.images[i] = resizeImage(img, 1600, 90); renderThumbs(); };
    img.src = im.src;
  }

  /* ---------- Форм ---------- */
  function resetForm() {
    state.form = { id: null, images: [], ratings: {} };
    $("fChild").value = "";
    $("fAge").value = "";
    $("fDate").value = today();
    $("fTopic").value = "";
    $("fAssess").value = "yavts";
    $("fConclusion").value = "";
    const g = activeGroup();
    $("fLevel").value = g ? g.ageKey : "ahlah";
    $("fTeacher").value = (g && g.teacher) || state.settings.teacher || "";
    $("editBadge").hidden = true;
    renderThumbs();
    renderCriteria();
  }

  function collectForm() {
    const g = activeGroup();
    const act = $("fActivity").value;
    const lv = $("fLevel").value;
    const crits = critsFor(act);
    const ratings = {};
    crits.forEach(c => { if (state.form.ratings[c.id] > 0) ratings[c.id] = state.form.ratings[c.id]; });
    const detail = crits.filter(c => ratings[c.id]).map(c => ({
      name: c.name,
      code: (c.program && c.program[lv]) || "",
      domain: DOMAINS[c.domain] || "",
      level: ratings[c.id],
      levelName: scaleOf(c)[ratings[c.id]].name
    }));
    const result = calcResult(ratings, crits);
    return {
      id: state.form.id || uid(),
      groupId: g ? g.id : null,
      groupName: g ? g.name : "",
      ageKey: lv,
      child: $("fChild").value.trim(),
      age: $("fAge").value.trim(),
      date: $("fDate").value,
      topic: $("fTopic").value.trim(),
      activity: act,
      assessType: $("fAssess").value,
      teacher: $("fTeacher").value.trim(),
      ratings,
      ratingDetail: detail,
      result,
      overall: result ? RESULT_BANDS[result.band].tag : 0,
      conclusion: $("fConclusion").value.trim(),
      images: state.form.images.slice(),
      school: state.settings.school || ""
    };
  }

  async function saveRecord() {
    const rec = collectForm();
    if (!rec.child) { toast("Хүүхдийн нэрийг оруулна уу."); $("fChild").focus(); return null; }
    if (!rec.groupId) { toast("Эхлээд бүлгээ үүсгэж, сонгоно уу."); return null; }
    const kid = await ensureKid(rec.groupId, rec.child);
    rec.childId = kid.id;
    const old = state.records.find(r => r.id === rec.id);
    rec.createdAt = old ? old.createdAt : Date.now();
    rec.updatedAt = Date.now();
    try {
      await DB.put(rec);
    } catch (e) {
      toast("Хадгалж чадсангүй: " + (e && e.message ? e.message : e), 5000);
      return null;
    }
    state.records = state.records.filter(r => r.id !== rec.id).concat(rec);
    state.form.id = rec.id;
    $("editBadge").hidden = false;
    renderChildList();
    toast(`✅ ${kid.name} хүүхдийн хавтсанд хадгалагдлаа`);
    return rec;
  }

  function loadRecordToForm(rec) {
    if (rec.groupId && state.groups.some(g => g.id === rec.groupId)) {
      state.activeGroupId = rec.groupId;
      DB.setKV("activeGroup", rec.groupId);
      $("activeGroup").value = rec.groupId;
      renderChildList();
    }
    state.form = { id: rec.id, images: (rec.images || []).slice(), ratings: { ...(rec.ratings || {}) } };
    $("fChild").value = rec.child || "";
    $("fAge").value = rec.age || "";
    $("fDate").value = rec.date || today();
    $("fTopic").value = rec.topic || "";
    $("fActivity").value = rec.activity || "zurag";
    $("fAssess").value = rec.assessType || "yavts";
    $("fLevel").value = rec.ageKey || "ahlah";
    $("fTeacher").value = rec.teacher || "";
    $("fConclusion").value = rec.conclusion || "";
    $("editBadge").hidden = false;
    renderThumbs();
    renderCriteria();
    showTab("write");
  }

  function startWorkForKid(kid) {
    if (state.activeGroupId !== kid.groupId && groupById(kid.groupId)) {
      state.activeGroupId = kid.groupId;
      DB.setKV("activeGroup", kid.groupId);
      renderGroupSelect();
    }
    resetForm();
    $("fChild").value = kid.name;
    fillAgeFromKid();
    showTab("write");
    $("fTopic").focus();
  }

  /* ---------- Бүтээлийн сан ---------- */
  function filteredRecords() {
    const q = $("rSearch").value.trim().toLowerCase();
    const act = $("rActivity").value;
    const from = $("rFrom").value, to = $("rTo").value;
    const all = $("rAllGroups").checked;
    return state.records
      .filter(r => all || r.groupId === state.activeGroupId)
      .filter(r => !act || r.activity === act)
      .filter(r => !from || (r.date || "") >= from)
      .filter(r => !to || (r.date || "") <= to)
      .filter(r => !q || [r.child, r.topic, r.groupName, r.conclusion].join(" ").toLowerCase().includes(q))
      .sort((a, b) => (b.date || "").localeCompare(a.date || "") || b.updatedAt - a.updatedAt);
  }

  function recTag(r) {
    if (r.result) return `<span class="lvtag lv${RESULT_BANDS[r.result.band].tag}">${esc(resultLabel(r.result))}</span>`;
    return r.overall ? `<span class="lvtag lv${r.overall}">${LEVELS[r.overall].name}</span>` : "";
  }

  function renderRecords() {
    const list = filteredRecords();
    $("rCount").textContent = `${list.length} бүтээл`;
    $("rSelectAll").checked = false;
    $("recordList").innerHTML = list.length ? list.map(r => `
      <div class="rec" data-id="${r.id}">
        <input type="checkbox" class="rsel" value="${r.id}">
        <div class="rec-img">${r.images && r.images[0] ? `<img src="${r.images[0].src}" alt="">` : "🎨"}</div>
        <div class="rec-body">
          <div><b>${esc(r.child)}</b> ${recTag(r)}</div>
          <div class="muted small">${esc(r.date || "")}${r.age ? " · " + esc(r.age) : ""} · ${esc(r.groupName)} · ${esc(ACTIVITIES[r.activity]?.name || "")}</div>
          <div class="small">${esc(r.topic || "")}</div>
        </div>
        <div class="rec-actions">
          <button class="btn small" data-act="edit">Засах</button>
          <button class="btn small" data-act="kid">Хавтас</button>
          <button class="btn small" data-act="word">Word</button>
          <button class="btn small" data-act="print">Хэвлэх</button>
          <button class="btn small danger" data-act="del">✕</button>
        </div>
      </div>`).join("") : `<div class="card muted center">Бүтээл олдсонгүй.</div>`;
  }

  const selectedRecords = () => {
    const ids = [...document.querySelectorAll(".rsel:checked")].map(c => c.value);
    return state.records.filter(r => ids.includes(r.id)).sort((a, b) => (a.child || "").localeCompare(b.child || "", "mn") || (a.date || "").localeCompare(b.date || ""));
  };

  async function deleteRecords(ids) {
    if (!ids.length) return;
    if (!confirm(`${ids.length} бүтээлийг устгах уу? Энэ үйлдлийг буцаах боломжгүй.`)) return;
    for (const id of ids) await DB.del(id);
    state.records = state.records.filter(r => !ids.includes(r.id));
    if (ids.includes(state.form.id)) resetForm();
    renderRecords();
    if ($("tab-children").classList.contains("active")) renderKids();
    toast("Устгагдлаа");
  }

  /* ---------- Хувийн хавтас ---------- */
  const AVATAR_COLORS = ["var(--sun)", "var(--bubble)", "var(--mint)", "var(--grape)", "var(--orange)", "var(--coral)"];
  function avatar(kid, big) {
    let h = 0;
    for (const ch of kid.name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    const emoji = kid.sex === "Эрэгтэй" ? "👦" : kid.sex === "Эмэгтэй" ? "👧" : "";
    return `<span class="avatar ${big ? "big" : ""}" style="background:${AVATAR_COLORS[h % AVATAR_COLORS.length]}">${emoji || esc(kid.name.charAt(0).toUpperCase())}</span>`;
  }

  function renderKids() {
    const g = activeGroup();
    const q = $("kSearch").value.trim().toLowerCase();
    const kids = g ? kidsOf(g.id).filter(k => !q || k.name.toLowerCase().includes(q)) : [];
    $("kidCount").textContent = g ? `· ${kidsOf(g.id).length} хүүхэд` : "";
    if (state.kidId && !kids.some(k => k.id === state.kidId) && !q) state.kidId = null;
    $("kidList").innerHTML = kids.length ? kids.map(k => {
      const n = state.records.filter(r => r.childId === k.id).length;
      return `<button class="kid ${k.id === state.kidId ? "on" : ""}" data-kid="${k.id}">
        ${avatar(k)}
        <span class="kid-name"><b>${esc(k.name)}</b><small>${esc(ageText(k.birth) || "Нас оруулаагүй")} · ${n} бүтээл</small></span>
      </button>`;
    }).join("") : `<p class="muted small">${g ? "Энэ бүлэгт хүүхэд алга. Доорх товчоор нэмнэ үү." : "Эхлээд бүлгээ үүсгэнэ үү."}</p>`;
    renderKidDetail();
  }

  function renderKidDetail() {
    const kid = kidById(state.kidId);
    const box = $("kidDetail");
    if (!kid) {
      box.innerHTML = `<div class="card empty">
        <div class="empty-art">📁</div>
        <h2>Хүүхдийн хувийн хавтас</h2>
        <p class="muted">Зүүн талаас хүүхдээ сонгоход тухайн хүүхдийн мэдээлэл, бүтээлүүд (цаг хугацааны дарааллаар), ажиглалт, ярилцлагын тэмдэглэл, ахицын график тус тусдаа харагдана.</p>
      </div>`;
      return;
    }
    const g = groupById(kid.groupId);
    const recs = recordsOfKid(kid);
    const last = recs.filter(r => r.result).slice(-1)[0];
    // Дахин зурахад бичиж буй тэмдэглэл алга болохгүй байх
    const draft = box.dataset.kid === kid.id && $("kNoteText") ? $("kNoteText").value : "";
    box.dataset.kid = kid.id;
    box.innerHTML = `
      <div class="card kid-head">
        ${avatar(kid, true)}
        <div class="kid-title">
          <h2>${esc(kid.name)}</h2>
          <div class="muted">${esc(ageText(kid.birth) || "Төрсөн огноо оруулаагүй")} · ${esc(g ? g.name : "Бүлэггүй")} · ${recs.length} бүтээл
            ${last ? ` · Сүүлийн үнэлгээ: <span class="lvtag lv${RESULT_BANDS[last.result.band].tag}">${esc(resultLabel(last.result))}</span>` : ""}</div>
        </div>
        <div class="row wrap gap kid-actions">
          <button class="btn primary" data-k="new">✏️ Шинэ бүтээл</button>
          <button class="btn" data-k="word">📄 Хавтас Word</button>
          <button class="btn" data-k="print">🖨 Хэвлэх</button>
          <button class="btn" data-k="json">💾 Тусад нь хадгалах</button>
          <button class="btn danger" data-k="del">🗑</button>
        </div>
      </div>

      <div class="grid2">
        <div class="card">
          <h2>Хүүхдийн мэдээлэл</h2>
          <div class="form-grid">
            <label class="span2">Нэр <input id="kName" value="${esc(kid.name)}"></label>
            <label>Хүйс
              <select id="kSex">
                ${["", "Эрэгтэй", "Эмэгтэй"].map(s => `<option ${kid.sex === s ? "selected" : ""} value="${s}">${s || "—"}</option>`).join("")}
              </select></label>
            <label>Төрсөн огноо <input id="kBirth" type="date" value="${esc(kid.birth)}"></label>
            <label>Эцэг/эхийн нэр <input id="kParent" value="${esc(kid.parent)}"></label>
            <label>Утас <input id="kPhone" value="${esc(kid.phone)}"></label>
            <label class="span2">Бүлэг
              <select id="kGroup">${state.groups.map(x => `<option value="${x.id}" ${x.id === kid.groupId ? "selected" : ""}>${esc(x.name)}</option>`).join("")}</select></label>
            <label class="span2">Онцлог, сонирхол, хэрэгцээ
              <textarea id="kAbout" rows="3" placeholder="ж: Өнгөт харандаагаар зурах дуртай, хайч хэрэглэхэд дэмжлэг хэрэгтэй">${esc(kid.about)}</textarea></label>
          </div>
          <button class="btn primary" data-k="save">Мэдээлэл хадгалах</button>
        </div>

        <div class="card">
          <h2>Ахицын байдал</h2>
          ${progressChart(recs)}
        </div>
      </div>

      <div class="card">
        <h2>Ажиглалт, ярилцлагын тэмдэглэл</h2>
        <div class="note-form">
          <input id="kNoteDate" type="date" value="${today()}">
          <select id="kNoteType">${Object.entries(NOTE_TYPES).map(([k, v]) => `<option value="${k}">${v}</option>`).join("")}</select>
          <textarea id="kNoteText" rows="2" placeholder="ж: Чөлөөт цагаар найзуудтайгаа хамтран шавраар амьтад барьж, үүрэг хуваарилан тоглов."></textarea>
          <button class="btn" data-k="note">➕ Тэмдэглэл нэмэх</button>
        </div>
        <div class="notes">
          ${(kid.notes || []).slice().sort((a, b) => (b.date || "").localeCompare(a.date || "")).map(n => `
            <div class="note">
              <div class="note-meta"><span class="badge">${esc(NOTE_TYPES[n.type] || n.type)}</span> <span class="muted small">${esc(n.date)}${kid.birth ? " · " + esc(ageText(kid.birth, n.date)) : ""}</span>
                <button class="icon-btn" data-delnote="${n.id}" title="Устгах">✕</button></div>
              <div>${esc(n.text).replace(/\n/g, "<br>")}</div>
            </div>`).join("") || `<p class="muted small">Тэмдэглэл алга.</p>`}
        </div>
      </div>

      <div class="card">
        <h2>Бүтээлүүд <small>цаг хугацааны дарааллаар</small></h2>
        <div class="works">
          ${recs.map(r => `
            <button class="work" data-rec="${r.id}" title="Засах">
              <span class="work-img">${r.images && r.images[0] ? `<img src="${r.images[0].src}" alt="">` : "🎨"}</span>
              <span class="work-meta">
                <b>${esc(r.topic || ACTIVITIES[r.activity]?.name || "Бүтээл")}</b>
                <small>${esc(r.date)}${r.age ? " · " + esc(r.age) : ""}</small>
                ${recTag(r)}
              </span>
            </button>`).join("") || `<p class="muted small">Одоогоор бүтээл алга. «✏️ Шинэ бүтээл» товчоор нэмнэ үү.</p>`}
        </div>
      </div>`;
    if (draft) $("kNoteText").value = draft;
  }

  function progressChart(recs) {
    const pts = recs.filter(r => r.result);
    if (!pts.length) return `<p class="muted small">Шалгуураар үнэлсэн бүтээл нэмэгдэхэд шалгуур хангасан хувийн ахиц энд харагдана.</p>`;
    const first = pts[0].result.pct, last = pts[pts.length - 1].result.pct;
    const diff = Math.round((last - first) * 10) / 10;
    return `<div class="chart">
        <div class="chart-lines"><span>100%</span><span>65%</span><span>36%</span><span>0%</span></div>
        <div class="bars">${pts.map(r => `
          <div class="bar-col" title="${esc(r.date)} · ${esc(r.topic || "")} · ${r.result.pct}%">
            <div class="bar lv${RESULT_BANDS[r.result.band].tag}" style="height:${Math.max(4, r.result.pct)}%"><span>${Math.round(r.result.pct)}</span></div>
            <small>${esc((r.date || "").slice(5))}</small>
          </div>`).join("")}</div>
      </div>
      <p class="small">${pts.length > 1 ? `Эхний үнэлгээнээс хойш <b>${diff >= 0 ? "+" : ""}${diff}%</b> ${diff > 0 ? "ахицтай 🌱" : diff < 0 ? "буурсан — анхаарах шаардлагатай" : "өөрчлөлтгүй"}.` : "Дараагийн бүтээлүүдтэй харьцуулж ахицыг харна."}</p>`;
  }

  async function saveKidInfo(kid) {
    const name = $("kName").value.trim();
    if (!name) { toast("Нэрийг оруулна уу."); return; }
    const oldName = kid.name, oldGroup = kid.groupId;
    Object.assign(kid, {
      name, sex: $("kSex").value, birth: $("kBirth").value, parent: $("kParent").value.trim(),
      phone: $("kPhone").value.trim(), about: $("kAbout").value.trim(), groupId: $("kGroup").value || kid.groupId
    });
    await saveChildren();
    if (oldName !== kid.name || oldGroup !== kid.groupId) {
      const g = groupById(kid.groupId);
      for (const r of state.records.filter(r => r.childId === kid.id)) {
        r.child = kid.name;
        if (g) { r.groupId = g.id; r.groupName = g.name; }
        await DB.put(r);
      }
    }
    renderChildList();
    renderKids();
    toast("Хадгалагдлаа");
  }

  async function deleteKid(kid) {
    const recs = state.records.filter(r => r.childId === kid.id);
    if (!confirm(`"${kid.name}" хүүхдийн хавтсыг устгах уу?${recs.length ? `\nТүүний ${recs.length} бүтээл мөн устна.` : ""}\nЭнэ үйлдлийг буцаах боломжгүй.`)) return;
    for (const r of recs) await DB.del(r.id);
    state.records = state.records.filter(r => r.childId !== kid.id);
    state.children = state.children.filter(k => k.id !== kid.id);
    await saveChildren();
    state.kidId = null;
    renderChildList();
    renderKids();
    toast("Устгагдлаа");
  }

  function exportKidJson(kid) {
    const g = groupById(kid.groupId);
    const data = {
      app: "buteel-dugnelt", version: 2, kind: "child", exportedAt: new Date().toISOString(),
      settings: { school: state.settings.school }, groups: g ? [g] : [], children: [kid],
      records: state.records.filter(r => r.childId === kid.id)
    };
    download(new Blob([JSON.stringify(data)], { type: "application/json" }), `${safeName(kid.name)}_havtas_${today()}.json`);
    toast(`💾 ${kid.name} хүүхдийн хавтас тусдаа файлд хадгалагдлаа`);
  }

  /* ---------- Word ---------- */
  function b64ToBytes(dataUrl) {
    const bin = atob(dataUrl.split(",")[1]);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  function fit(w, h, maxW, maxH) {
    const k = Math.min(maxW / w, maxH / h, 1);
    return { width: Math.round(w * k), height: Math.round(h * k) };
  }

  /* docx-ийн жижиг туслах функцууд */
  function docxKit() {
    const D = docx;
    const F = "Times New Roman";
    const run = (text, o = {}) => new D.TextRun({ text, font: F, size: 24, ...o });
    const p = (children, o = {}) => new D.Paragraph({ children: Array.isArray(children) ? children : [children], spacing: { after: 100 }, ...o });
    const border = { style: D.BorderStyle.SINGLE, size: 4, color: "999999" };
    const borders = { top: border, bottom: border, left: border, right: border };
    const cell = (text, o = {}) => new D.TableCell({
      borders,
      width: o.width ? { size: o.width, type: D.WidthType.PERCENTAGE } : undefined,
      shading: o.shade ? { fill: o.shade, type: D.ShadingType.CLEAR, color: "auto" } : undefined,
      columnSpan: o.span,
      margins: { top: 60, bottom: 60, left: 100, right: 100 },
      children: [p(run(String(text ?? ""), { bold: !!o.bold, size: o.size || 22 }), { spacing: { after: 0 } })]
    });
    const table = rows => new D.Table({ rows, width: { size: 100, type: D.WidthType.PERCENTAGE } });
    const row = cells => new D.TableRow({ children: cells });
    const infoTable = pairs => {
      const rows = [];
      for (let i = 0; i < pairs.length; i += 2) {
        const b = pairs[i + 1] || ["", ""];
        rows.push(row([
          cell(pairs[i][0], { bold: true, shade: "F2F2F2", width: 18 }), cell(pairs[i][1], { width: 32 }),
          cell(b[0], { bold: true, shade: "F2F2F2", width: 18 }), cell(b[1], { width: 32 })
        ]));
      }
      return table(rows);
    };
    return { D, run, p, cell, table, row, infoTable };
  }

  function recordToDocx(r, pageBreak) {
    const { D, run, p, cell, table, row, infoTable } = docxKit();
    const out = [];
    const school = r.school || state.settings.school;
    if (school) out.push(p(run(school, { size: 22, color: "555555" }), { alignment: D.AlignmentType.CENTER, pageBreakBefore: pageBreak }));
    out.push(p(run("ХҮҮХДИЙН БҮТЭЭЛИЙН ДҮГНЭЛТ", { bold: true, size: 30 }), {
      alignment: D.AlignmentType.CENTER, spacing: { after: 200 }, pageBreakBefore: pageBreak && !school
    }));

    const ag = AGE_GROUPS[r.ageKey];
    out.push(infoTable([
      ["Хүүхдийн нэр", r.child], ["Нас", r.age],
      ["Бүлэг", r.groupName], ["Огноо", r.date],
      ["Үйл ажиллагаа", ACTIVITIES[r.activity]?.name || ""], ["Сэдэв", r.topic],
      ["Үнэлгээ", ASSESS_TYPES[r.assessType] || ""], ["Хөтөлбөр", ag ? `Зураг, урлал · ${ag.level}` : ""]
    ]));
    out.push(p(run(""), { spacing: { after: 120 } }));

    const imgs = r.images || [];
    if (imgs.length) {
      const single = imgs.length === 1;
      for (let i = 0; i < imgs.length; i += single ? 1 : 2) {
        const pair = single ? [imgs[i]] : imgs.slice(i, i + 2);
        const children = [];
        pair.forEach((im, j) => {
          const size = single ? fit(im.w, im.h, 460, 420) : fit(im.w, im.h, 290, 300);
          if (j) children.push(run("   "));
          children.push(new D.ImageRun({ data: b64ToBytes(im.src), transformation: size }));
        });
        out.push(p(children, { alignment: D.AlignmentType.CENTER, spacing: { after: 160 } }));
      }
    }

    if (r.ratingDetail && r.ratingDetail.length) {
      out.push(p(run("Үнэлгээний шалгуур", { bold: true, size: 26 }), { spacing: { before: 120, after: 100 } }));
      const hasCode = r.ratingDetail.some(d => d.code);
      const head = hasCode
        ? [cell("Шалгуур", { bold: true, shade: "E8EEF7", width: 24 }), cell("Хөтөлбөрийн суралцахуйн үр дүн", { bold: true, shade: "E8EEF7", width: 42 }),
           cell("Хөгжлийн чиглэл", { bold: true, shade: "E8EEF7", width: 16 }), cell("Түвшин", { bold: true, shade: "E8EEF7", width: 18 })]
        : [cell("Шалгуур", { bold: true, shade: "E8EEF7", width: 45 }), cell("Хөгжлийн чиглэл", { bold: true, shade: "E8EEF7", width: 33 }),
           cell("Түвшин", { bold: true, shade: "E8EEF7", width: 22 })];
      const rows = [new D.TableRow({ tableHeader: true, children: head })];
      r.ratingDetail.forEach(d => {
        const lvName = d.levelName || LEVELS[d.level]?.name || "";
        rows.push(row(hasCode
          ? [cell(d.name), cell(d.code, { size: 20 }), cell(d.domain), cell(lvName)]
          : [cell(d.name), cell(d.domain), cell(lvName)]));
      });
      if (r.result) {
        const b = RESULT_BANDS[r.result.band];
        rows.push(row([cell(`Шалгуур хангасан: ${r.result.pct}% — «${b.name}» · ${b.support}`, { bold: true, shade: "FFF4D6", span: hasCode ? 4 : 3 })]));
      }
      out.push(table(rows));
    }

    out.push(p(run("Дүгнэлт", { bold: true, size: 26 }), { spacing: { before: 240, after: 100 } }));
    (r.conclusion || "").split("\n").forEach(line => {
      out.push(p(run(line), { alignment: D.AlignmentType.JUSTIFIED, spacing: { after: line.trim() ? 80 : 40, line: 300 } }));
    });

    out.push(p(run(""), { spacing: { after: 200 } }));
    out.push(p(run(`Багш: ............................ /${r.teacher || ""}/`), { alignment: D.AlignmentType.RIGHT }));
    return out;
  }

  function kidPortfolioDocx(kid) {
    const { D, run, p, cell, table, row, infoTable } = docxKit();
    const g = groupById(kid.groupId);
    const recs = recordsOfKid(kid);
    const out = [];
    if (state.settings.school) out.push(p(run(state.settings.school, { size: 22, color: "555555" }), { alignment: D.AlignmentType.CENTER }));
    out.push(p(run("ХҮҮХДИЙН ХУВИЙН ХАВТАС", { bold: true, size: 34 }), { alignment: D.AlignmentType.CENTER }));
    out.push(p(run("Зураг, урлал", { size: 24, color: "555555" }), { alignment: D.AlignmentType.CENTER, spacing: { after: 240 } }));
    out.push(infoTable([
      ["Хүүхдийн нэр", kid.name], ["Хүйс", kid.sex],
      ["Төрсөн огноо", kid.birth], ["Одоогийн нас", ageText(kid.birth)],
      ["Бүлэг", g ? `${g.name} (${AGE_GROUPS[g.ageKey].age})` : ""], ["Бүлгийн багш", (g && g.teacher) || state.settings.teacher],
      ["Эцэг/эхийн нэр", kid.parent], ["Утас", kid.phone]
    ]));
    if (kid.about) {
      out.push(p(run("Онцлог, сонирхол, хэрэгцээ", { bold: true, size: 26 }), { spacing: { before: 240, after: 80 } }));
      kid.about.split("\n").forEach(l => out.push(p(run(l))));
    }

    if (recs.length) {
      out.push(p(run("Бүтээлийн жагсаалт", { bold: true, size: 26 }), { spacing: { before: 240, after: 80 } }));
      const rows = [new D.TableRow({ tableHeader: true, children: [
        cell("№", { bold: true, shade: "E8EEF7", width: 6 }), cell("Огноо", { bold: true, shade: "E8EEF7", width: 15 }),
        cell("Нас", { bold: true, shade: "E8EEF7", width: 15 }), cell("Сэдэв", { bold: true, shade: "E8EEF7", width: 26 }),
        cell("Төрөл", { bold: true, shade: "E8EEF7", width: 18 }), cell("Үнэлгээ", { bold: true, shade: "E8EEF7", width: 20 })
      ] })];
      recs.forEach((r, i) => rows.push(row([
        cell(i + 1), cell(r.date), cell(r.age), cell(r.topic), cell(ACTIVITIES[r.activity]?.name || ""), cell(resultLabel(r.result))
      ])));
      out.push(table(rows));
    }

    if (kid.notes && kid.notes.length) {
      out.push(p(run("Ажиглалт, ярилцлагын тэмдэглэл", { bold: true, size: 26 }), { spacing: { before: 240, after: 80 } }));
      kid.notes.slice().sort((a, b) => (a.date || "").localeCompare(b.date || "")).forEach(n => {
        out.push(p([run(`${n.date}${kid.birth ? " (" + ageText(kid.birth, n.date) + ")" : ""} · ${NOTE_TYPES[n.type] || n.type}: `, { bold: true }), run(n.text)]));
      });
    }
    recs.forEach(r => out.push(...recordToDocx(r, true)));
    return out;
  }

  async function exportDocx(children, filename) {
    if (typeof docx === "undefined") { toast("Word сан ачаалагдсангүй."); return; }
    toast("Word файл бэлдэж байна…");
    const doc = new docx.Document({
      creator: state.settings.teacher || "Багш",
      title: "Хүүхдийн бүтээлийн дүгнэлт",
      sections: [{
        properties: { page: { size: { width: 11906, height: 16838 }, margin: { top: 1000, bottom: 1000, left: 1200, right: 1000 } } },
        children
      }]
    });
    download(await docx.Packer.toBlob(doc), filename);
    toast("📄 Word файл татагдлаа");
  }

  function exportWord(records, filename) {
    if (!records.length) { toast("Бүтээл сонгоогүй байна."); return; }
    const children = [];
    records.forEach((r, i) => children.push(...recordToDocx(r, i > 0)));
    return exportDocx(children, filename);
  }

  /* ---------- Хэвлэх ---------- */
  function recordToPrintHtml(r) {
    const ag = AGE_GROUPS[r.ageKey];
    const imgs = r.images || [];
    const school = r.school || state.settings.school;
    const hasCode = (r.ratingDetail || []).some(d => d.code);
    return `<div class="print-page">
      ${school ? `<div class="p-school">${esc(school)}</div>` : ""}
      <h1>ХҮҮХДИЙН БҮТЭЭЛИЙН ДҮГНЭЛТ</h1>
      <table class="p-info">
        <tr><th>Хүүхдийн нэр</th><td>${esc(r.child)}</td><th>Нас</th><td>${esc(r.age)}</td></tr>
        <tr><th>Бүлэг</th><td>${esc(r.groupName)}</td><th>Огноо</th><td>${esc(r.date)}</td></tr>
        <tr><th>Үйл ажиллагаа</th><td>${esc(ACTIVITIES[r.activity]?.name || "")}</td><th>Сэдэв</th><td>${esc(r.topic)}</td></tr>
        <tr><th>Үнэлгээ</th><td>${esc(ASSESS_TYPES[r.assessType] || "")}</td><th>Хөтөлбөр</th><td>${ag ? "Зураг, урлал · " + ag.level : ""}</td></tr>
      </table>
      ${imgs.length ? `<div class="p-imgs ${imgs.length === 1 ? "one" : ""}">${imgs.map(im => `<img src="${im.src}" alt="">`).join("")}</div>` : ""}
      ${r.ratingDetail && r.ratingDetail.length ? `<table class="p-rate">
        <tr><th>Шалгуур</th>${hasCode ? "<th>Хөтөлбөрийн суралцахуйн үр дүн</th>" : ""}<th>Хөгжлийн чиглэл</th><th>Түвшин</th></tr>
        ${r.ratingDetail.map(d => `<tr><td>${esc(d.name)}</td>${hasCode ? `<td class="p-code">${esc(d.code)}</td>` : ""}<td>${esc(d.domain)}</td><td>${esc(d.levelName || LEVELS[d.level]?.name || "")}</td></tr>`).join("")}
        ${r.result ? `<tr><td colspan="${hasCode ? 4 : 3}"><b>Шалгуур хангасан: ${r.result.pct}% — «${RESULT_BANDS[r.result.band].name}» · ${RESULT_BANDS[r.result.band].support}</b></td></tr>` : ""}
      </table>` : ""}
      <h2>Дүгнэлт</h2>
      <div class="p-text">${esc(r.conclusion).replace(/\n/g, "<br>")}</div>
      <div class="p-sign">Багш: ............................ /${esc(r.teacher)}/</div>
    </div>`;
  }

  function kidCoverPrintHtml(kid) {
    const g = groupById(kid.groupId);
    const recs = recordsOfKid(kid);
    return `<div class="print-page">
      ${state.settings.school ? `<div class="p-school">${esc(state.settings.school)}</div>` : ""}
      <h1>ХҮҮХДИЙН ХУВИЙН ХАВТАС</h1>
      <table class="p-info">
        <tr><th>Хүүхдийн нэр</th><td>${esc(kid.name)}</td><th>Хүйс</th><td>${esc(kid.sex)}</td></tr>
        <tr><th>Төрсөн огноо</th><td>${esc(kid.birth)}</td><th>Одоогийн нас</th><td>${esc(ageText(kid.birth))}</td></tr>
        <tr><th>Бүлэг</th><td>${esc(g ? g.name : "")}</td><th>Бүлгийн багш</th><td>${esc((g && g.teacher) || state.settings.teacher)}</td></tr>
        <tr><th>Эцэг/эхийн нэр</th><td>${esc(kid.parent)}</td><th>Утас</th><td>${esc(kid.phone)}</td></tr>
      </table>
      ${kid.about ? `<h2>Онцлог, сонирхол, хэрэгцээ</h2><div class="p-text">${esc(kid.about).replace(/\n/g, "<br>")}</div>` : ""}
      ${recs.length ? `<h2>Бүтээлийн жагсаалт</h2><table class="p-rate">
        <tr><th>№</th><th>Огноо</th><th>Нас</th><th>Сэдэв</th><th>Төрөл</th><th>Үнэлгээ</th></tr>
        ${recs.map((r, i) => `<tr><td>${i + 1}</td><td>${esc(r.date)}</td><td>${esc(r.age)}</td><td>${esc(r.topic)}</td><td>${esc(ACTIVITIES[r.activity]?.name || "")}</td><td>${esc(resultLabel(r.result))}</td></tr>`).join("")}
      </table>` : ""}
      ${kid.notes && kid.notes.length ? `<h2>Ажиглалт, ярилцлагын тэмдэглэл</h2>
        ${kid.notes.slice().sort((a, b) => (a.date || "").localeCompare(b.date || "")).map(n => `<p class="p-text"><b>${esc(n.date)} · ${esc(NOTE_TYPES[n.type] || n.type)}:</b> ${esc(n.text)}</p>`).join("")}` : ""}
    </div>`;
  }

  function printHtml(html) {
    const area = $("printArea");
    area.innerHTML = html;
    const imgs = [...area.querySelectorAll("img")];
    Promise.all(imgs.map(i => i.complete ? 0 : new Promise(r => { i.onload = i.onerror = r; })))
      .then(() => setTimeout(() => window.print(), 100));
  }

  function printRecords(records) {
    if (!records.length) { toast("Бүтээл сонгоогүй байна."); return; }
    printHtml(records.map(recordToPrintHtml).join(""));
  }

  /* ---------- Бүлэг ---------- */
  function renderGroups() {
    if (!$("gAge").options.length) $("gAge").innerHTML = AGE_KEYS.map(k => `<option value="${k}">${AGE_GROUPS[k].name} (${AGE_GROUPS[k].age})</option>`).join("");
    $("sSchool").value = state.settings.school || "";
    $("sTeacher").value = state.settings.teacher || "";
    $("sYear").value = state.settings.year || "";
    $("groupList").innerHTML = state.groups.map(g => {
      const n = state.records.filter(r => r.groupId === g.id).length;
      const kids = kidsOf(g.id);
      return `<div class="card group ${g.id === state.activeGroupId ? "active" : ""}" data-id="${g.id}">
        <div class="row wrap gap">
          <b>${esc(g.name)}</b>
          <span class="badge">${AGE_GROUPS[g.ageKey].name} · ${AGE_GROUPS[g.ageKey].age} · ${AGE_GROUPS[g.ageKey].level}</span>
          <span class="muted small">${kids.length} хүүхэд · ${n} бүтээл${g.teacher ? " · Багш: " + esc(g.teacher) : ""}</span>
          <span class="spacer"></span>
          <button class="btn small" data-gact="use">Сонгох</button>
          <button class="btn small" data-gact="edit">Засах</button>
          <button class="btn small danger" data-gact="del">Устгах</button>
        </div>
        <div class="muted small mt">${kids.map(k => esc(k.name)).join(", ") || "Хүүхэд нэмээгүй"}</div>
      </div>`;
    }).join("");
  }

  function resetGroupForm() {
    state.editGroupId = null;
    $("gName").value = "";
    $("gAge").value = "ahlah";
    $("gTeacher").value = state.settings.teacher || "";
    $("gChildren").value = "";
    $("gFormTitle").textContent = "Бүлэг нэмэх";
    $("btnCancelGroup").hidden = true;
  }

  async function saveGroup() {
    const name = $("gName").value.trim();
    if (!name) { toast("Бүлгийн нэрийг оруулна уу."); return; }
    const names = [...new Set($("gChildren").value.split("\n").map(s => s.trim()).filter(Boolean))];
    const data = { name, ageKey: $("gAge").value, teacher: $("gTeacher").value.trim() };
    let g = groupById(state.editGroupId);
    if (g) Object.assign(g, data);
    else { g = { id: uid(), ...data }; state.groups.push(g); }
    for (const n of names) if (!state.children.some(k => k.groupId === g.id && k.name === n)) state.children.push(newKid(g.id, n));
    await saveChildren();
    // Бүлгийн нэр өөрчлөгдвөл хадгалсан бүтээлүүдэд шинэчлэх
    for (const r of state.records.filter(r => r.groupId === g.id && r.groupName !== g.name)) {
      r.groupName = g.name;
      await DB.put(r);
    }
    if (!state.activeGroupId) { state.activeGroupId = g.id; DB.setKV("activeGroup", g.id); }
    await saveGroups();
    resetGroupForm();
    renderGroups();
    renderGroupSelect();
    if (!$("fTeacher").value) $("fTeacher").value = activeGroup()?.teacher || state.settings.teacher || "";
    toast("Бүлэг хадгалагдлаа");
  }

  /* ---------- Үгийн сан ---------- */
  function currentBankCrit() { return state.bank.criteria.find(c => c.id === $("bCrit").value); }

  function renderBankCritList(selectId) {
    $("bCrit").innerHTML = state.bank.criteria.map(c => `<option value="${c.id}">${esc(c.name)}${c.enabled === false ? " (идэвхгүй)" : ""}</option>`).join("");
    if (selectId) $("bCrit").value = selectId;
  }

  function renderBankEditor() {
    const c = currentBankCrit();
    if (!c) return;
    const ageKey = $("bVar").value;
    let actSel = $("bAct");
    if (!actSel) {
      actSel = document.createElement("select");
      actSel.id = "bAct";
      actSel.innerHTML = Object.keys(ACTIVITIES).map(k => `<option value="${k}">${ACTIVITIES[k].name}</option>`).join("");
      const lbl = document.createElement("label");
      lbl.id = "bActWrap";
      lbl.append("Төрөл ", actSel);
      $("bVarWrap").after(lbl);
      actSel.addEventListener("change", renderBankEditor);
    }
    $("bActWrap").hidden = !c.byActivity;
    const phraseKey = c.byActivity ? actSel.value : ageKey;
    const ph = (c.phrases && c.phrases[phraseKey]) || {};
    const sc = scaleOf(c);
    $("bL3").textContent = sc[3].name; $("bL2").textContent = sc[2].name; $("bL1").textContent = sc[1].name;
    $("bName").value = c.name;
    $("bDomain").value = c.domain;
    $("bComp").value = c.comp || "";
    $("bEnabled").checked = c.enabled !== false;
    $("bExpect").value = (c.program && c.program[ageKey]) || "";
    $("bSheet").value = (c.sheet && c.sheet[ageKey]) || "";
    $("bP3").value = ph[3] || "";
    $("bP2").value = ph[2] || "";
    $("bP1").value = ph[1] || "";
    $("bAdvice").value = c.advice || "";
  }

  async function saveBankCrit() {
    const c = currentBankCrit();
    if (!c) return;
    const ageKey = $("bVar").value;
    const phraseKey = c.byActivity ? $("bAct").value : ageKey;
    c.name = $("bName").value.trim() || c.name;
    c.domain = $("bDomain").value;
    c.comp = $("bComp").value;
    c.enabled = $("bEnabled").checked;
    c.program = c.program || {};
    c.program[ageKey] = $("bExpect").value.trim();
    c.sheet = c.sheet || {};
    c.sheet[ageKey] = $("bSheet").value.trim();
    c.phrases = c.phrases || {};
    c.phrases[phraseKey] = { 3: $("bP3").value.trim(), 2: $("bP2").value.trim(), 1: $("bP1").value.trim() };
    c.advice = $("bAdvice").value.trim();
    await saveBank();
    renderBankCritList(c.id);
    renderCriteria();
    toast("Шалгуур хадгалагдлаа");
  }

  function renderSummaryEditor() {
    const S = state.bank.summary;
    $("sum3").value = S[0]; $("sum2").value = S[1]; $("sum1").value = S[2];
    $("sumStr").value = S.strengths; $("sumAll").value = S.allHigh;
  }

  function renderChipEditor(cat) {
    const cats = Object.keys(state.bank.chips);
    $("chipCat").innerHTML = cats.map(c => `<option>${esc(c)}</option>`).join("");
    if (cat) $("chipCat").value = cat;
    $("chipText").value = (state.bank.chips[$("chipCat").value] || []).join("\n");
  }

  function renderBank() {
    $("bVar").innerHTML = AGE_KEYS.map(k => `<option value="${k}">${AGE_GROUPS[k].level} · ${AGE_GROUPS[k].name}</option>`).join("");
    const g = activeGroup();
    if (g) $("bVar").value = g.ageKey;
    $("bDomain").innerHTML = Object.keys(DOMAINS).map(k => `<option value="${k}">${DOMAINS[k]}</option>`).join("");
    $("bComp").innerHTML = `<option value="">—</option>` + Object.keys(COMPETENCIES).map(k => `<option value="${k}">${COMPETENCIES[k]}</option>`).join("");
    renderBankCritList();
    renderBankEditor();
    renderSummaryEditor();
    renderChipEditor();
  }

  /* ---------- Хөтөлбөр ---------- */
  function renderReference() {
    $("expectTable").innerHTML = `<table class="ref-table">
      <tr><th>Шалгуур</th>${AGE_KEYS.map(k => `<th>${AGE_GROUPS[k].level}<br><small>${AGE_GROUPS[k].name} · ${AGE_GROUPS[k].age}</small></th>`).join("")}</tr>
      ${enabledCriteria().map(c => `<tr><td><b>${esc(c.name)}</b><br><small class="muted">${esc(DOMAINS[c.domain] || "")}${c.comp ? " · " + esc(COMPETENCIES[c.comp]) : ""}</small></td>
        ${AGE_KEYS.map(k => `<td>${esc((c.program && c.program[k]) || "")}${c.sheet && c.sheet[k] ? `<div class="muted small mt">📋 ${AGE_GROUPS[k].sheet}: ${esc(c.sheet[k])}</div>` : ""}</td>`).join("")}</tr>`).join("")}
    </table>`;
    $("refText").value = state.reference;
  }

  /* ---------- Нөөцлөх ---------- */
  async function renderBackupInfo() {
    const lb = state.settings.lastBackup;
    $("lastBackup").textContent = lb ? "Сүүлд нөөцөлсөн: " + new Date(lb).toLocaleString("mn-MN") : "Одоогоор нөөц аваагүй байна.";
    let txt = `Нийт ${state.records.length} бүтээл, ${state.children.length} хүүхдийн хавтас, ${state.groups.length} бүлэг хадгалагдсан.`;
    if (navigator.storage && navigator.storage.estimate) {
      try {
        const e = await navigator.storage.estimate();
        txt += ` Ашигласан: ${(e.usage / 1048576).toFixed(1)} МБ.`;
      } catch { /* дэмжихгүй хөтөч */ }
    }
    $("storageInfo").textContent = txt;
  }

  async function exportBackup() {
    const data = {
      app: "buteel-dugnelt", version: 2, exportedAt: new Date().toISOString(),
      settings: state.settings, groups: state.groups, children: state.children, bank: state.bank,
      reference: state.reference, records: state.records
    };
    download(new Blob([JSON.stringify(data)], { type: "application/json" }), `buteel-nuuts-${today()}.json`);
    state.settings.lastBackup = Date.now();
    await saveSettings();
    renderBackupInfo();
    toast("💾 Нөөц файл татагдлаа");
  }

  async function importBackup(file) {
    let data;
    try { data = JSON.parse(await file.text()); } catch { toast("Файл буруу байна."); return; }
    if (!data || data.app !== "buteel-dugnelt") { toast("Энэ програмын нөөц файл биш байна."); return; }
    for (const g of data.groups || []) {
      const cur = groupById(g.id);
      if (!cur) {
        const { children, ...rest } = g;
        state.groups.push(rest);
        (children || []).forEach(n => { if (!state.children.some(k => k.groupId === g.id && k.name === n)) state.children.push(newKid(g.id, n)); });
      }
    }
    for (const k of data.children || []) {
      const cur = kidById(k.id);
      if (!cur) state.children.push(k);
      else {
        const ids = new Set((cur.notes || []).map(n => n.id));
        cur.notes = (cur.notes || []).concat((k.notes || []).filter(n => !ids.has(n.id)));
        for (const f of ["sex", "birth", "parent", "phone", "about"]) if (!cur[f] && k[f]) cur[f] = k[f];
      }
    }
    let added = 0;
    for (const r of data.records || []) {
      if (!r.childId && r.child) r.childId = (await ensureKid(r.groupId, r.child)).id;
      const cur = state.records.find(x => x.id === r.id);
      if (!cur || (r.updatedAt || 0) > (cur.updatedAt || 0)) {
        await DB.put(r);
        state.records = state.records.filter(x => x.id !== r.id).concat(r);
        added++;
      }
    }
    await saveGroups();
    await saveChildren();
    for (const k of ["school", "teacher", "year"]) if (!state.settings[k] && data.settings && data.settings[k]) state.settings[k] = data.settings[k];
    await saveSettings();
    if (data.bank && data.bank.version === BANK_VERSION && data.kind !== "child" && confirm("Нөөц файл дахь үгийн санг ашиглах уу? (Одоогийн үгийн сан солигдоно)")) {
      state.bank = data.bank;
      await saveBank();
      if (data.reference) { state.reference = data.reference; await DB.setKV("reference", data.reference); }
      renderBank();
      renderChips();
    }
    if (!state.activeGroupId && state.groups[0]) { state.activeGroupId = state.groups[0].id; DB.setKV("activeGroup", state.activeGroupId); }
    renderGroupSelect();
    renderGroups();
    renderBackupInfo();
    if ($("tab-children").classList.contains("active")) renderKids();
    toast(`Сэргээгдлээ: ${data.kind === "child" ? "1 хүүхдийн хавтас, " : ""}${added} бүтээл`, 4000);
  }

  /* ---------- Үйл явдал ---------- */
  function bind() {
    $("tabs").addEventListener("click", e => { const b = e.target.closest("button[data-tab]"); if (b) showTab(b.dataset.tab); });
    document.querySelectorAll("[data-goto]").forEach(b => b.addEventListener("click", () => showTab(b.dataset.goto)));

    $("activeGroup").addEventListener("change", e => {
      state.activeGroupId = e.target.value;
      state.kidId = null;
      DB.setKV("activeGroup", state.activeGroupId);
      renderChildList();
      syncLevelToGroup();
      renderCriteria();
      renderGroups();
      if ($("tab-records").classList.contains("active")) renderRecords();
      if ($("tab-children").classList.contains("active")) renderKids();
      const g = activeGroup();
      if (g && g.teacher && !state.form.id) $("fTeacher").value = g.teacher;
    });

    // Хүүхэд, огноо, төрөл, түвшин
    $("fChild").addEventListener("change", fillAgeFromKid);
    $("fDate").addEventListener("change", fillAgeFromKid);
    $("fActivity").addEventListener("change", renderCriteria);
    $("fLevel").addEventListener("change", renderCriteria);

    // Шалгуурын түвшин
    $("criteria").addEventListener("click", e => {
      const b = e.target.closest(".lvbtn");
      if (!b) return;
      const id = b.closest(".crit").dataset.id;
      const lv = +b.dataset.lv;
      state.form.ratings[id] = state.form.ratings[id] === lv ? 0 : lv;
      renderCriteria();
    });
    document.querySelectorAll("[data-setall]").forEach(b => b.addEventListener("click", () => {
      const lv = +b.dataset.setall;
      critsFor($("fActivity").value).forEach(c => { state.form.ratings[c.id] = lv; });
      renderCriteria();
    }));

    $("btnGenerate").addEventListener("click", () => {
      if ($("fConclusion").value.trim() && !confirm("Одоо байгаа дүгнэлтийг шинээр үүсгэсэн дүгнэлтээр солих уу?")) return;
      generateConclusion();
    });
    $("chips").addEventListener("click", e => {
      const b = e.target.closest(".chip");
      if (b) insertAtCursor($("fConclusion"), fill(b.dataset.chip, $("fChild").value.trim() || "Хүүхэд"));
    });

    // Зураг
    $("fileInput").addEventListener("change", e => { addFiles(e.target.files); e.target.value = ""; });
    $("camInput").addEventListener("change", e => { addFiles(e.target.files); e.target.value = ""; });
    const dz = $("dropzone");
    dz.addEventListener("dragover", e => { e.preventDefault(); dz.classList.add("over"); });
    dz.addEventListener("dragleave", () => dz.classList.remove("over"));
    dz.addEventListener("drop", e => { e.preventDefault(); dz.classList.remove("over"); addFiles(e.dataTransfer.files); });
    $("thumbs").addEventListener("click", e => {
      const r = e.target.closest("[data-rot]"), d = e.target.closest("[data-delimg]");
      if (r) rotateImage(+r.dataset.rot);
      if (d) { state.form.images.splice(+d.dataset.delimg, 1); renderThumbs(); }
    });
    document.addEventListener("paste", e => {
      if (!$("tab-write").classList.contains("active")) return;
      const files = [...(e.clipboardData?.files || [])];
      if (files.length) addFiles(files);
    });

    // Үйлдлүүд
    $("btnSave").addEventListener("click", saveRecord);
    $("btnNew").addEventListener("click", () => {
      if (($("fConclusion").value.trim() || state.form.images.length) && !state.form.id && !confirm("Хадгалаагүй өгөгдөл устна. Үргэлжлүүлэх үү?")) return;
      resetForm();
    });
    $("btnWordOne").addEventListener("click", async () => {
      const r = await saveRecord();
      if (r) exportWord([r], `${safeName(r.child)}_${r.date || ""}.docx`);
    });
    $("btnPrintOne").addEventListener("click", async () => {
      const r = await saveRecord();
      if (r) printRecords([r]);
    });

    // Хувийн хавтас
    $("kSearch").addEventListener("input", renderKids);
    $("kidList").addEventListener("click", e => {
      const b = e.target.closest("[data-kid]");
      if (!b) return;
      state.kidId = b.dataset.kid;
      renderKids();
      if (window.innerWidth < 860) $("kidDetail").scrollIntoView({ behavior: "smooth" });
    });
    $("btnAddKid").addEventListener("click", async () => {
      const g = activeGroup();
      if (!g) { toast("Эхлээд бүлгээ үүсгэнэ үү."); showTab("groups"); return; }
      const name = prompt("Хүүхдийн нэр:");
      if (!name || !name.trim()) return;
      const k = await ensureKid(g.id, name);
      state.kidId = k.id;
      renderChildList();
      renderKids();
      $("kBirth").focus();
    });
    $("kidDetail").addEventListener("click", async e => {
      const kid = kidById(state.kidId);
      if (!kid) return;
      const rec = e.target.closest("[data-rec]");
      if (rec) { const r = state.records.find(x => x.id === rec.dataset.rec); if (r) loadRecordToForm(r); return; }
      const dn = e.target.closest("[data-delnote]");
      if (dn) {
        if (!confirm("Тэмдэглэлийг устгах уу?")) return;
        kid.notes = kid.notes.filter(n => n.id !== dn.dataset.delnote);
        await saveChildren();
        renderKidDetail();
        return;
      }
      const b = e.target.closest("[data-k]");
      if (!b) return;
      const a = b.dataset.k;
      if (a === "new") startWorkForKid(kid);
      if (a === "save") saveKidInfo(kid);
      if (a === "del") deleteKid(kid);
      if (a === "json") exportKidJson(kid);
      if (a === "word") exportDocx(kidPortfolioDocx(kid), `${safeName(kid.name)}_huviin_havtas.docx`);
      if (a === "print") printHtml(kidCoverPrintHtml(kid) + recordsOfKid(kid).map(recordToPrintHtml).join(""));
      if (a === "note") {
        const text = $("kNoteText").value.trim();
        if (!text) { toast("Тэмдэглэлээ бичнэ үү."); $("kNoteText").focus(); return; }
        kid.notes = kid.notes || [];
        kid.notes.push({ id: uid(), date: $("kNoteDate").value || today(), type: $("kNoteType").value, text });
        await saveChildren();
        $("kNoteText").value = "";
        renderKidDetail();
        toast("Тэмдэглэл нэмэгдлээ");
      }
    });

    // Бүтээлийн сан
    ["rSearch", "rActivity", "rFrom", "rTo", "rAllGroups"].forEach(id => $(id).addEventListener("input", renderRecords));
    $("rSelectAll").addEventListener("change", e => document.querySelectorAll(".rsel").forEach(c => { c.checked = e.target.checked; }));
    $("recordList").addEventListener("click", e => {
      const b = e.target.closest("[data-act]");
      if (!b) return;
      const r = state.records.find(x => x.id === b.closest(".rec").dataset.id);
      if (!r) return;
      const a = b.dataset.act;
      if (a === "edit") loadRecordToForm(r);
      if (a === "kid") { state.kidId = r.childId; if (r.groupId && groupById(r.groupId)) { state.activeGroupId = r.groupId; renderGroupSelect(); } showTab("children"); }
      if (a === "word") exportWord([r], `${safeName(r.child)}_${r.date || ""}.docx`);
      if (a === "print") printRecords([r]);
      if (a === "del") deleteRecords([r.id]);
    });
    $("btnWordSel").addEventListener("click", () => exportWord(selectedRecords(), `buteel_dugnelt_${today()}.docx`));
    $("btnPrintSel").addEventListener("click", () => printRecords(selectedRecords()));
    $("btnDelSel").addEventListener("click", () => deleteRecords(selectedRecords().map(r => r.id)));

    // Бүлэг
    $("btnSaveSettings").addEventListener("click", async () => {
      state.settings.school = $("sSchool").value.trim();
      state.settings.teacher = $("sTeacher").value.trim();
      state.settings.year = $("sYear").value.trim();
      await saveSettings();
      renderGroupSelect();
      toast("Хадгалагдлаа");
    });
    $("btnSaveGroup").addEventListener("click", saveGroup);
    $("btnCancelGroup").addEventListener("click", resetGroupForm);
    $("groupList").addEventListener("click", async e => {
      const b = e.target.closest("[data-gact]");
      if (!b) return;
      const g = groupById(b.closest(".group").dataset.id);
      const a = b.dataset.gact;
      if (a === "use") {
        state.activeGroupId = g.id;
        state.kidId = null;
        DB.setKV("activeGroup", g.id);
        renderGroupSelect();
        renderGroups();
        toast(`"${g.name}" сонгогдлоо`);
      }
      if (a === "edit") {
        state.editGroupId = g.id;
        $("gName").value = g.name;
        $("gAge").value = g.ageKey;
        $("gTeacher").value = g.teacher || "";
        $("gChildren").value = kidsOf(g.id).map(k => k.name).join("\n");
        $("gFormTitle").textContent = "Бүлэг засах";
        $("btnCancelGroup").hidden = false;
        window.scrollTo(0, 0);
      }
      if (a === "del") {
        const n = state.records.filter(r => r.groupId === g.id).length;
        if (!confirm(`"${g.name}" бүлгийг устгах уу?${n ? ` (${n} бүтээл «Бүтээлийн сан»-д хадгалагдсан хэвээр үлдэнэ)` : ""}`)) return;
        state.groups = state.groups.filter(x => x.id !== g.id);
        if (state.activeGroupId === g.id) { state.activeGroupId = state.groups[0]?.id || null; DB.setKV("activeGroup", state.activeGroupId); }
        await saveGroups();
        renderGroups();
        renderGroupSelect();
      }
    });

    // Үгийн сан
    $("bCrit").addEventListener("change", renderBankEditor);
    $("bVar").addEventListener("change", renderBankEditor);
    $("btnSaveCrit").addEventListener("click", saveBankCrit);
    $("btnAddCrit").addEventListener("click", async () => {
      const name = prompt("Шинэ шалгуурын нэр:");
      if (!name) return;
      const c = { id: "c" + uid(), name: name.trim(), domain: "tanin", comp: "buteelch", program: {}, sheet: {}, phrases: {}, advice: "", enabled: true };
      state.bank.criteria.push(c);
      await saveBank();
      renderBankCritList(c.id);
      renderBankEditor();
      renderCriteria();
    });
    $("btnDelCrit").addEventListener("click", async () => {
      const c = currentBankCrit();
      if (!c || !confirm(`"${c.name}" шалгуурыг устгах уу?`)) return;
      state.bank.criteria = state.bank.criteria.filter(x => x.id !== c.id);
      delete state.form.ratings[c.id];
      await saveBank();
      renderBankCritList();
      renderBankEditor();
      renderCriteria();
    });
    $("btnSaveSummary").addEventListener("click", async () => {
      Object.assign(state.bank.summary, {
        0: $("sum3").value.trim(), 1: $("sum2").value.trim(), 2: $("sum1").value.trim(),
        strengths: $("sumStr").value.trim(), allHigh: $("sumAll").value.trim()
      });
      await saveBank();
      toast("Хадгалагдлаа");
    });
    $("chipCat").addEventListener("change", () => renderChipEditor($("chipCat").value));
    $("btnSaveChips").addEventListener("click", async () => {
      const cat = $("chipCat").value;
      state.bank.chips[cat] = $("chipText").value.split("\n").map(s => s.trim()).filter(Boolean);
      await saveBank();
      renderChips();
      toast("Хадгалагдлаа");
    });
    $("btnAddChipCat").addEventListener("click", async () => {
      const name = prompt("Шинэ ангиллын нэр:");
      if (!name || state.bank.chips[name.trim()]) return;
      state.bank.chips[name.trim()] = [];
      await saveBank();
      renderChipEditor(name.trim());
      renderChips();
    });
    $("btnExportBank").addEventListener("click", () => {
      download(new Blob([JSON.stringify({ app: "buteel-dugnelt-bank", bank: state.bank, reference: state.reference }, null, 2)], { type: "application/json" }), `ugiin-san-${today()}.json`);
    });
    $("importBank").addEventListener("change", async e => {
      const f = e.target.files[0];
      e.target.value = "";
      if (!f) return;
      try {
        const d = JSON.parse(await f.text());
        if (!d.bank || !d.bank.criteria) throw new Error();
        if (d.bank.version !== BANK_VERSION) { toast("Энэ үгийн сан хуучин хувилбарынх тул ашиглах боломжгүй."); return; }
        state.bank = d.bank;
        await saveBank();
        if (d.reference) { state.reference = d.reference; await DB.setKV("reference", d.reference); }
        renderBank(); renderChips(); renderCriteria();
        toast("Үгийн сан оруулагдлаа");
      } catch { toast("Үгийн сангийн файл буруу байна."); }
    });
    $("btnResetBank").addEventListener("click", async () => {
      if (!confirm("Үгийн санг анхны байдалд оруулах уу? Таны засварууд устна.")) return;
      state.bank = defaultBank();
      await saveBank();
      renderBank(); renderChips(); renderCriteria();
      toast("Анхны байдалд орлоо");
    });

    // Хөтөлбөр
    $("btnSaveRef").addEventListener("click", async () => {
      state.reference = $("refText").value;
      await DB.setKV("reference", state.reference);
      toast("Хадгалагдлаа");
    });

    // Нөөц
    $("btnBackup").addEventListener("click", exportBackup);
    $("importBackup").addEventListener("change", e => { const f = e.target.files[0]; e.target.value = ""; if (f) importBackup(f); });
    $("btnWordGroup").addEventListener("click", () => {
      const g = activeGroup();
      if (!g) { toast("Бүлэг сонгоно уу."); return; }
      const list = state.records.filter(r => r.groupId === g.id)
        .sort((a, b) => (a.child || "").localeCompare(b.child || "", "mn") || (a.date || "").localeCompare(b.date || ""));
      exportWord(list, `${safeName(g.name)}_tailan_${today()}.docx`);
    });
    $("btnWipe").addEventListener("click", async () => {
      if (!confirm("Бүх бүтээл, бүлэг, хүүхдийн хавтас, тохиргоог устгах уу? Эхлээд нөөц файл татсан эсэхээ шалгаарай.")) return;
      if (prompt('Баталгаажуулахын тулд "УСТГАХ" гэж бичнэ үү.') !== "УСТГАХ") return;
      await DB.clear();
      location.reload();
    });

    window.addEventListener("beforeunload", e => {
      if (!state.form.id && ($("fConclusion").value.trim() || state.form.images.length)) { e.preventDefault(); e.returnValue = ""; }
    });
  }

  async function init() {
    await load();
    const opts = obj => Object.keys(obj).map(k => `<option value="${k}">${typeof obj[k] === "string" ? obj[k] : obj[k].name}</option>`).join("");
    $("fActivity").innerHTML = opts(ACTIVITIES);
    $("fAssess").innerHTML = opts(ASSESS_TYPES);
    $("fLevel").innerHTML = AGE_KEYS.map(k => `<option value="${k}">${AGE_GROUPS[k].level} (${AGE_GROUPS[k].name})</option>`).join("");
    $("rActivity").innerHTML = `<option value="">Бүх төрөл</option>` + opts(ACTIVITIES);
    resetForm();
    renderGroupSelect();
    renderGroups();
    resetGroupForm();
    renderChips();
    renderBank();
    bind();
    if (!state.groups.length) showTab("groups");
    if (state.migratedBank) setTimeout(() => toast("📘 Үгийн сан 2025 оны хөтөлбөр, үнэлгээний гарын авлагын дагуу шинэчлэгдлээ.", 6000), 600);
    const lb = state.settings.lastBackup;
    if (state.records.length >= 5 && (!lb || Date.now() - lb > 7 * 864e5)) {
      setTimeout(() => toast("💾 7 хоногоос дээш нөөц аваагүй байна. \"Нөөцлөх\" цэснээс нөөц файл татаарай.", 6000), 7000);
    }
  }

  init().catch(err => {
    console.error(err);
    alert("Програм ачаалахад алдаа гарлаа: " + (err && err.message ? err.message : err));
  });
})();
