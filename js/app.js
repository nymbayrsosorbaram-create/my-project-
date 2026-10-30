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
    activeGroupId: null,
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
    return { criteria: clone(DEFAULT_CRITERIA), summary: clone(DEFAULT_SUMMARY), chips: clone(DEFAULT_CHIPS) };
  }

  const activeGroup = () => state.groups.find(g => g.id === state.activeGroupId) || null;
  const enabledCriteria = () => state.bank.criteria.filter(c => c.enabled !== false);
  const fill = (tpl, name) => String(tpl || "").replaceAll("{name}", name);

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
  const saveBank = () => DB.setKV("bank", state.bank);

  async function load() {
    state.settings = Object.assign(state.settings, (await DB.getKV("settings")) || {});
    state.groups = (await DB.getKV("groups")) || [];
    state.activeGroupId = (await DB.getKV("activeGroup")) || (state.groups[0] && state.groups[0].id) || null;
    state.bank = (await DB.getKV("bank")) || defaultBank();
    state.reference = (await DB.getKV("reference")) ?? DEFAULT_REFERENCE;
    state.records = (await DB.getAll()) || [];
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
  }

  /* ---------- Табууд ---------- */
  function showTab(name) {
    document.querySelectorAll("#tabs button").forEach(b => b.classList.toggle("active", b.dataset.tab === name));
    document.querySelectorAll(".tab").forEach(s => s.classList.toggle("active", s.id === "tab-" + name));
    if (name === "records") renderRecords();
    if (name === "backup") renderBackupInfo();
    if (name === "reference") renderReference();
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
    $("schoolLabel").textContent = [state.settings.school, state.settings.year].filter(Boolean).join(" · ") || "СӨБ · Дүрслэх урлаг";
    renderChildList();
    renderCriteria();
  }

  function renderChildList() {
    const g = activeGroup();
    $("childList").innerHTML = g ? g.children.map(c => `<option value="${esc(c)}">`).join("") : "";
  }

  /* ---------- Шалгуур ---------- */
  function renderCriteria() {
    const g = activeGroup();
    const ageKey = g ? g.ageKey : "ahlah";
    $("critHint").textContent = g ? `· ${AGE_GROUPS[ageKey].name} (${AGE_GROUPS[ageKey].age})` : "";
    $("criteria").innerHTML = enabledCriteria().map(c => {
      const lv = state.form.ratings[c.id] || 0;
      return `<div class="crit" data-id="${c.id}">
        <div class="crit-info">
          <b>${esc(c.name)}</b> <span class="domain">${esc(DOMAINS[c.domain] || "")}</span>
          <div class="muted small">${esc((c.expect && c.expect[ageKey]) || "")}</div>
        </div>
        <div class="levels">
          ${[3, 2, 1].map(l => `<button class="lvbtn lv${l} ${lv === l ? "on" : ""}" data-lv="${l}" title="${esc(LEVELS[l].desc)}">${LEVELS[l].name}</button>`).join("")}
        </div>
      </div>`;
    }).join("");
  }

  function overallLevel(ratings) {
    const vals = Object.values(ratings || {}).filter(v => v > 0);
    if (!vals.length) return 0;
    const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
    return avg >= 2.5 ? 3 : avg >= 1.75 ? 2 : 1;
  }

  /* ---------- Дүгнэлт үүсгэх ---------- */
  function generateConclusion() {
    const g = activeGroup();
    const ageKey = g ? g.ageKey : "ahlah";
    const name = $("fChild").value.trim() || "Хүүхэд";
    const act = $("fActivity").value;
    const topic = $("fTopic").value.trim();
    const topicPart = topic ? `"${topic}" сэдвээр ` : "";
    const ratings = state.form.ratings;
    const crits = enabledCriteria().filter(c => ratings[c.id] > 0);

    const intro = (ACTIVITIES[act]?.intro || "{name} {topic}бүтээл хийлээ.").replace("{topic}", topicPart);
    const body = [fill(intro, name)];
    let n = 0;
    crits.forEach(c => {
      const set = c.byActivity ? c.phrases[act] : c.phrases[ageKey];
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
    const ov = overallLevel(ratings);
    if (ov) {
      let sum = fill(S[ov], name);
      // Тухайн чиглэлийн бүх шалгуур "Ахисан" бол давуу тал гэж үзнэ
      const domainKeys = [...new Set(crits.map(c => c.domain))];
      const strong = domainKeys
        .filter(d => crits.filter(c => c.domain === d).every(c => ratings[c.id] === 3))
        .map(d => DOMAINS[d]).filter(Boolean);
      if (strong.length && ov < 3) sum += " " + S.strengths.replace("{list}", strong.join(", ").toLowerCase());
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
    $("fConclusion").value = "";
    const g = activeGroup();
    $("fTeacher").value = (g && g.teacher) || state.settings.teacher || "";
    $("editBadge").hidden = true;
    renderThumbs();
    renderCriteria();
  }

  function collectForm() {
    const g = activeGroup();
    const ratings = { ...state.form.ratings };
    const detail = state.bank.criteria
      .filter(c => ratings[c.id] > 0)
      .map(c => ({ name: c.name, domain: DOMAINS[c.domain] || "", level: ratings[c.id] }));
    return {
      id: state.form.id || uid(),
      groupId: g ? g.id : null,
      groupName: g ? g.name : "",
      ageKey: g ? g.ageKey : "",
      child: $("fChild").value.trim(),
      age: $("fAge").value.trim(),
      date: $("fDate").value,
      topic: $("fTopic").value.trim(),
      activity: $("fActivity").value,
      teacher: $("fTeacher").value.trim(),
      ratings,
      ratingDetail: detail,
      overall: overallLevel(ratings),
      conclusion: $("fConclusion").value.trim(),
      images: state.form.images.slice(),
      school: state.settings.school || ""
    };
  }

  async function saveRecord() {
    const rec = collectForm();
    if (!rec.child) { toast("Хүүхдийн нэрийг оруулна уу."); $("fChild").focus(); return null; }
    if (!rec.groupId) { toast("Эхлээд бүлгээ үүсгэж, сонгоно уу."); return null; }
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

    const g = activeGroup();
    if (g && !g.children.includes(rec.child)) {
      g.children.push(rec.child);
      await saveGroups();
      renderChildList();
    }
    toast("✅ Хадгалагдлаа");
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
    $("fTeacher").value = rec.teacher || "";
    $("fConclusion").value = rec.conclusion || "";
    $("editBadge").hidden = false;
    renderThumbs();
    renderCriteria();
    showTab("write");
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

  function renderRecords() {
    const list = filteredRecords();
    $("rCount").textContent = `${list.length} бүтээл`;
    $("rSelectAll").checked = false;
    $("recordList").innerHTML = list.length ? list.map(r => `
      <div class="rec" data-id="${r.id}">
        <input type="checkbox" class="rsel" value="${r.id}">
        <div class="rec-img">${r.images && r.images[0] ? `<img src="${r.images[0].src}" alt="">` : "🎨"}</div>
        <div class="rec-body">
          <div><b>${esc(r.child)}</b> ${r.overall ? `<span class="lvtag lv${r.overall}">${LEVELS[r.overall].name}</span>` : ""}</div>
          <div class="muted small">${esc(r.date || "")} · ${esc(r.groupName)} · ${esc(ACTIVITIES[r.activity]?.name || "")}</div>
          <div class="small">${esc(r.topic || "")}</div>
        </div>
        <div class="rec-actions">
          <button class="btn small" data-act="edit">Засах</button>
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
    toast("Устгагдлаа");
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

  function recordToDocx(r, first) {
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
      margins: { top: 60, bottom: 60, left: 100, right: 100 },
      children: [p(run(text, { bold: !!o.bold, size: 22 }), { spacing: { after: 0 } })]
    });

    const out = [];
    const school = r.school || state.settings.school;
    if (school) out.push(p(run(school, { size: 22, color: "555555" }), { alignment: D.AlignmentType.CENTER, pageBreakBefore: !first }));
    out.push(p(run("ХҮҮХДИЙН БҮТЭЭЛИЙН ДҮГНЭЛТ", { bold: true, size: 30 }), {
      alignment: D.AlignmentType.CENTER, spacing: { after: 200 }, pageBreakBefore: !first && !school
    }));

    const ageG = AGE_GROUPS[r.ageKey];
    const info = [
      ["Хүүхдийн нэр", r.child], ["Нас", r.age],
      ["Бүлэг", r.groupName + (ageG ? ` (${ageG.age})` : "")], ["Огноо", r.date],
      ["Үйл ажиллагаа", ACTIVITIES[r.activity]?.name || ""], ["Сэдэв", r.topic]
    ];
    const rows = [];
    for (let i = 0; i < info.length; i += 2) {
      rows.push(new D.TableRow({ children: [
        cell(info[i][0], { bold: true, shade: "F2F2F2", width: 18 }), cell(info[i][1] || "", { width: 32 }),
        cell(info[i + 1][0], { bold: true, shade: "F2F2F2", width: 18 }), cell(info[i + 1][1] || "", { width: 32 })
      ] }));
    }
    out.push(new D.Table({ rows, width: { size: 100, type: D.WidthType.PERCENTAGE } }));
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
      const tr = [new D.TableRow({ tableHeader: true, children: [
        cell("Шалгуур", { bold: true, shade: "E8EEF7", width: 45 }),
        cell("Хөгжлийн чиглэл", { bold: true, shade: "E8EEF7", width: 33 }),
        cell("Түвшин", { bold: true, shade: "E8EEF7", width: 22 })
      ] })];
      r.ratingDetail.forEach(d => tr.push(new D.TableRow({ children: [
        cell(d.name), cell(d.domain), cell(LEVELS[d.level]?.name || "")
      ] })));
      out.push(new D.Table({ rows: tr, width: { size: 100, type: D.WidthType.PERCENTAGE } }));
    }

    out.push(p(run("Дүгнэлт", { bold: true, size: 26 }), { spacing: { before: 240, after: 100 } }));
    (r.conclusion || "").split("\n").forEach(line => {
      out.push(p(run(line), { alignment: D.AlignmentType.JUSTIFIED, spacing: { after: line.trim() ? 80 : 40, line: 300 } }));
    });

    out.push(p(run(""), { spacing: { after: 200 } }));
    out.push(p(run(`Багш: ............................ /${r.teacher || ""}/`), { alignment: D.AlignmentType.RIGHT }));
    return out;
  }

  async function exportWord(records, filename) {
    if (!records.length) { toast("Бүтээл сонгоогүй байна."); return; }
    if (typeof docx === "undefined") { toast("Word сан ачаалагдсангүй."); return; }
    toast("Word файл бэлдэж байна…");
    const children = [];
    records.forEach((r, i) => children.push(...recordToDocx(r, i === 0)));
    const doc = new docx.Document({
      creator: state.settings.teacher || "Багш",
      title: "Хүүхдийн бүтээлийн дүгнэлт",
      sections: [{
        properties: { page: { size: { width: 11906, height: 16838 }, margin: { top: 1000, bottom: 1000, left: 1200, right: 1000 } } },
        children
      }]
    });
    const blob = await docx.Packer.toBlob(doc);
    download(blob, filename);
    toast("📄 Word файл татагдлаа");
  }

  /* ---------- Хэвлэх ---------- */
  function recordToPrintHtml(r) {
    const ageG = AGE_GROUPS[r.ageKey];
    const imgs = r.images || [];
    const school = r.school || state.settings.school;
    return `<div class="print-page">
      ${school ? `<div class="p-school">${esc(school)}</div>` : ""}
      <h1>ХҮҮХДИЙН БҮТЭЭЛИЙН ДҮГНЭЛТ</h1>
      <table class="p-info">
        <tr><th>Хүүхдийн нэр</th><td>${esc(r.child)}</td><th>Нас</th><td>${esc(r.age)}</td></tr>
        <tr><th>Бүлэг</th><td>${esc(r.groupName)}${ageG ? ` (${ageG.age})` : ""}</td><th>Огноо</th><td>${esc(r.date)}</td></tr>
        <tr><th>Үйл ажиллагаа</th><td>${esc(ACTIVITIES[r.activity]?.name || "")}</td><th>Сэдэв</th><td>${esc(r.topic)}</td></tr>
      </table>
      ${imgs.length ? `<div class="p-imgs ${imgs.length === 1 ? "one" : ""}">${imgs.map(im => `<img src="${im.src}" alt="">`).join("")}</div>` : ""}
      ${r.ratingDetail && r.ratingDetail.length ? `<table class="p-rate">
        <tr><th>Шалгуур</th><th>Хөгжлийн чиглэл</th><th>Түвшин</th></tr>
        ${r.ratingDetail.map(d => `<tr><td>${esc(d.name)}</td><td>${esc(d.domain)}</td><td>${esc(LEVELS[d.level]?.name || "")}</td></tr>`).join("")}
      </table>` : ""}
      <h2>Дүгнэлт</h2>
      <div class="p-text">${esc(r.conclusion).replace(/\n/g, "<br>")}</div>
      <div class="p-sign">Багш: ............................ /${esc(r.teacher)}/</div>
    </div>`;
  }

  function printRecords(records) {
    if (!records.length) { toast("Бүтээл сонгоогүй байна."); return; }
    const area = $("printArea");
    area.innerHTML = records.map(recordToPrintHtml).join("");
    const imgs = [...area.querySelectorAll("img")];
    Promise.all(imgs.map(i => i.complete ? 0 : new Promise(r => { i.onload = i.onerror = r; })))
      .then(() => setTimeout(() => window.print(), 100));
  }

  /* ---------- Бүлэг ---------- */
  function renderGroups() {
    $("gAge").innerHTML = AGE_KEYS.map(k => `<option value="${k}">${AGE_GROUPS[k].name} (${AGE_GROUPS[k].age})</option>`).join("");
    $("sSchool").value = state.settings.school || "";
    $("sTeacher").value = state.settings.teacher || "";
    $("sYear").value = state.settings.year || "";
    $("groupList").innerHTML = state.groups.map(g => {
      const n = state.records.filter(r => r.groupId === g.id).length;
      return `<div class="card group ${g.id === state.activeGroupId ? "active" : ""}" data-id="${g.id}">
        <div class="row wrap gap">
          <b>${esc(g.name)}</b>
          <span class="badge">${AGE_GROUPS[g.ageKey].name} · ${AGE_GROUPS[g.ageKey].age}</span>
          <span class="muted small">${g.children.length} хүүхэд · ${n} бүтээл${g.teacher ? " · Багш: " + esc(g.teacher) : ""}</span>
          <span class="spacer"></span>
          <button class="btn small" data-gact="use">Сонгох</button>
          <button class="btn small" data-gact="edit">Засах</button>
          <button class="btn small danger" data-gact="del">Устгах</button>
        </div>
        <div class="muted small mt">${g.children.map(esc).join(", ") || "Хүүхэд нэмээгүй"}</div>
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
    const children = [...new Set($("gChildren").value.split("\n").map(s => s.trim()).filter(Boolean))];
    const data = { name, ageKey: $("gAge").value, teacher: $("gTeacher").value.trim(), children };
    let g = state.groups.find(x => x.id === state.editGroupId);
    if (g) Object.assign(g, data);
    else { g = { id: uid(), ...data }; state.groups.push(g); }
    // Бүлгийн нэр өөрчлөгдвөл хадгалсан бүтээлүүдэд шинэчлэх
    for (const r of state.records.filter(r => r.groupId === g.id && (r.groupName !== g.name || r.ageKey !== g.ageKey))) {
      r.groupName = g.name; r.ageKey = g.ageKey;
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
    $("bName").value = c.name;
    $("bDomain").value = c.domain;
    $("bEnabled").checked = c.enabled !== false;
    $("bExpect").value = (c.expect && c.expect[ageKey]) || "";
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
    c.enabled = $("bEnabled").checked;
    c.expect = c.expect || {};
    c.expect[ageKey] = $("bExpect").value.trim();
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
    $("sum3").value = S[3]; $("sum2").value = S[2]; $("sum1").value = S[1];
    $("sumStr").value = S.strengths; $("sumAll").value = S.allHigh;
  }

  function renderChipEditor(cat) {
    const cats = Object.keys(state.bank.chips);
    $("chipCat").innerHTML = cats.map(c => `<option>${esc(c)}</option>`).join("");
    if (cat) $("chipCat").value = cat;
    $("chipText").value = (state.bank.chips[$("chipCat").value] || []).join("\n");
  }

  function renderBank() {
    $("bVar").innerHTML = AGE_KEYS.map(k => `<option value="${k}">${AGE_GROUPS[k].name}</option>`).join("");
    const g = activeGroup();
    if (g) $("bVar").value = g.ageKey;
    $("bDomain").innerHTML = Object.keys(DOMAINS).map(k => `<option value="${k}">${DOMAINS[k]}</option>`).join("");
    renderBankCritList();
    renderBankEditor();
    renderSummaryEditor();
    renderChipEditor();
  }

  /* ---------- Хөтөлбөр ---------- */
  function renderReference() {
    $("expectTable").innerHTML = `<table class="ref-table">
      <tr><th>Шалгуур</th>${AGE_KEYS.map(k => `<th>${AGE_GROUPS[k].name}<br><small>${AGE_GROUPS[k].age}</small></th>`).join("")}</tr>
      ${enabledCriteria().map(c => `<tr><td><b>${esc(c.name)}</b><br><small class="muted">${esc(DOMAINS[c.domain] || "")}</small></td>
        ${AGE_KEYS.map(k => `<td>${esc((c.expect && c.expect[k]) || "")}</td>`).join("")}</tr>`).join("")}
    </table>`;
    $("refText").value = state.reference;
  }

  /* ---------- Нөөцлөх ---------- */
  async function renderBackupInfo() {
    const lb = state.settings.lastBackup;
    $("lastBackup").textContent = lb ? "Сүүлд нөөцөлсөн: " + new Date(lb).toLocaleString("mn-MN") : "Одоогоор нөөц аваагүй байна.";
    let txt = `Нийт ${state.records.length} бүтээл, ${state.groups.length} бүлэг хадгалагдсан.`;
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
      app: "buteel-dugnelt", version: 1, exportedAt: new Date().toISOString(),
      settings: state.settings, groups: state.groups, bank: state.bank,
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
    let added = 0;
    for (const r of data.records || []) {
      const cur = state.records.find(x => x.id === r.id);
      if (!cur || (r.updatedAt || 0) > (cur.updatedAt || 0)) {
        await DB.put(r);
        state.records = state.records.filter(x => x.id !== r.id).concat(r);
        added++;
      }
    }
    for (const g of data.groups || []) {
      const cur = state.groups.find(x => x.id === g.id);
      if (!cur) state.groups.push(g);
      else cur.children = [...new Set(cur.children.concat(g.children || []))];
    }
    await saveGroups();
    for (const k of ["school", "teacher", "year"]) if (!state.settings[k] && data.settings && data.settings[k]) state.settings[k] = data.settings[k];
    await saveSettings();
    if (data.bank && confirm("Нөөц файл дахь үгийн санг ашиглах уу? (Одоогийн үгийн сан солигдоно)")) {
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
    toast(`Сэргээгдлээ: ${added} бүтээл`, 4000);
  }

  /* ---------- Үйл явдал ---------- */
  function bind() {
    $("tabs").addEventListener("click", e => { const b = e.target.closest("button[data-tab]"); if (b) showTab(b.dataset.tab); });
    document.querySelectorAll("[data-goto]").forEach(b => b.addEventListener("click", () => showTab(b.dataset.goto)));

    $("activeGroup").addEventListener("change", e => {
      state.activeGroupId = e.target.value;
      DB.setKV("activeGroup", state.activeGroupId);
      renderChildList();
      renderCriteria();
      renderGroups();
      if ($("tab-records").classList.contains("active")) renderRecords();
      const g = activeGroup();
      if (g && g.teacher && !state.form.id) $("fTeacher").value = g.teacher;
    });

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
      enabledCriteria().forEach(c => { state.form.ratings[c.id] = lv; });
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
      const g = state.groups.find(x => x.id === b.closest(".group").dataset.id);
      const a = b.dataset.gact;
      if (a === "use") {
        state.activeGroupId = g.id;
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
        $("gChildren").value = g.children.join("\n");
        $("gFormTitle").textContent = "Бүлэг засах";
        $("btnCancelGroup").hidden = false;
        window.scrollTo(0, 0);
      }
      if (a === "del") {
        const n = state.records.filter(r => r.groupId === g.id).length;
        if (!confirm(`"${g.name}" бүлгийг устгах уу?${n ? ` (${n} бүтээл хадгалагдсан хэвээр үлдэнэ)` : ""}`)) return;
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
      const c = { id: "c" + uid(), name: name.trim(), domain: "buteelch", expect: {}, phrases: {}, advice: "", enabled: true };
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
        3: $("sum3").value.trim(), 2: $("sum2").value.trim(), 1: $("sum1").value.trim(),
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
      if (!confirm("Бүх бүтээл, бүлэг, тохиргоог устгах уу? Эхлээд нөөц файл татсан эсэхээ шалгаарай.")) return;
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
    $("fActivity").innerHTML = Object.keys(ACTIVITIES).map(k => `<option value="${k}">${ACTIVITIES[k].name}</option>`).join("");
    $("rActivity").innerHTML = `<option value="">Бүх төрөл</option>` + Object.keys(ACTIVITIES).map(k => `<option value="${k}">${ACTIVITIES[k].name}</option>`).join("");
    renderGroupSelect();
    renderGroups();
    resetGroupForm();
    renderChips();
    renderBank();
    resetForm();
    bind();
    if (!state.groups.length) showTab("groups");
    const lb = state.settings.lastBackup;
    if (state.records.length >= 5 && (!lb || Date.now() - lb > 7 * 864e5)) {
      setTimeout(() => toast("💾 7 хоногоос дээш нөөц аваагүй байна. \"Нөөцлөх\" цэснээс нөөц файл татаарай.", 6000), 800);
    }
  }

  init().catch(err => {
    console.error(err);
    alert("Програм ачаалахад алдаа гарлаа: " + (err && err.message ? err.message : err));
  });
})();
