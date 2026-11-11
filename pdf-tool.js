/* Local PDF Splitter & Compressor — all processing in-browser via pdf-lib + pdf.js. */
(function () {
"use strict";
var degrees = window.PDFLib.degrees;

/* pdf.js worker must be same-origin with the iframe; src/ files resolve to the
   top-level origin, so load the worker code and expose it via a Blob URL. */
var workerReady = (async function () {
  var urls = ["vendor/pdf.worker.min.js", "src/vendor/pdf.worker.min.js"];
  for (var i = 0; i < urls.length; i++) {
    try {
      var r = await fetch(urls[i]);
      if (!r.ok) continue;
      var t = await r.text();
      if (!t || t.length < 1000) continue;
      pdfjsLib.GlobalWorkerOptions.workerSrc = URL.createObjectURL(new Blob([t], { type: "text/javascript" }));
      return;
    } catch (e) {}
  }
  try { pdfjsLib.GlobalWorkerOptions.workerSrc = "vendor/pdf.worker.min.js"; } catch (e) {}
})();

/* ---------------- utils ---------------- */
function el(id) { return document.getElementById(id); }
function esc(s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
function fmtSize(n) {
  if (n < 1024) return n + " B";
  if (n < 1048576) return (n / 1024).toFixed(1) + " KB";
  return (n / 1048576).toFixed(2) + " MB";
}
function errBox(box, msg) { box.innerHTML = '<div class="err">' + esc(msg) + "</div>"; }
function progress(id, frac, txt) {
  var c = el(id);
  c.hidden = false;
  c.querySelector(".bar").style.width = Math.round(frac * 100) + "%";
  c.querySelector(".ptxt").textContent = txt || "";
  if (frac >= 1) setTimeout(function () { c.hidden = true; }, 800);
}
function baseName(n) { return (n || "document").replace(/\.pdf$/i, "") || "document"; }
function blobOf(u8, mime) { return new Blob([u8], { type: mime || "application/pdf" }); }
function canvasBlob(c, type, q) {
  return new Promise(function (res, rej) { c.toBlob(function (b) { b ? res(b) : rej(new Error("image encode failed")); }, type, q); });
}
function yieldUI() { return new Promise(function (r) { setTimeout(r, 0); }); }
async function readBytes(f) { return new Uint8Array(await f.arrayBuffer()); }

/* Show download links (+preview for viewable files). Auto-downloads the first file. */
function emitResult(box, statHtml, files, opts) {
  opts = opts || {};
  var html = '<div class="stat">' + statHtml + "</div>";
  files.forEach(function (f, i) {
    var url = URL.createObjectURL(blobOf(f.data, f.mime));
    f._url = url;
    html += '<a class="dl" href="' + url + '" download="' + esc(f.name) + '">Download ' + esc(f.name) + "</a>";
    if (opts.preview !== false && (f.mime === "application/pdf" || f.mime === "image/png" || f.mime === "image/jpeg" || f.mime === "text/plain"))
      html += '<button type="button" class="pv" data-u="' + url + '">Preview</button>';
  });
  box.innerHTML = html;
  box.querySelectorAll(".pv").forEach(function (b) {
    b.addEventListener("click", function () { window.open(b.getAttribute("data-u"), "_blank"); });
  });
  if (opts.auto !== false && files.length) {
    var a = box.querySelector(".dl");
    if (a) a.click();
  }
}

/* ---------------- settings (remembered on this device) ---------------- */
var SET_KEY = "pdfToolV1";
function saveSettings() {
  try {
    var s = {};
    document.querySelectorAll("[data-s]").forEach(function (n) {
      if (n.type === "checkbox") s[n.id] = n.checked;
      else if (n.type === "radio") { if (n.checked) s[n.name] = n.value; }
      else s[n.id] = n.value;
    });
    localStorage.setItem(SET_KEY, JSON.stringify(s));
  } catch (e) {}
}
function loadSettings() {
  var s = {};
  try { s = JSON.parse(localStorage.getItem(SET_KEY) || "{}"); } catch (e) {}
  Object.keys(s).forEach(function (k) {
    var n = document.getElementById(k);
    if (n && n.type !== "radio") {
      if (n.type === "checkbox") n.checked = !!s[k];
      else n.value = s[k];
    }
  });
  Object.keys(s).forEach(function (k) {
    if (/^(splitMode|compEngine)$/.test(k)) return;
  });
  ["splitMode", "compEngine"].forEach(function (name) {
    if (s[name]) {
      var r = document.querySelector('input[name="' + name + '"][value="' + s[name] + '"]');
      if (r) r.checked = true;
    }
  });
}
document.addEventListener("change", function (e) {
  if (e.target && e.target.getAttribute && e.target.getAttribute("data-s") !== null &&
      (e.target.hasAttribute("data-s") || e.target.name === "splitMode" || e.target.name === "compEngine")) saveSettings();
});

/* ---------------- tabs ---------------- */
var activeTab = "split";
document.querySelectorAll(".tab").forEach(function (t) {
  t.addEventListener("click", function () {
    document.querySelectorAll(".tab").forEach(function (x) { x.classList.remove("active"); });
    t.classList.add("active");
    activeTab = t.dataset.tab;
    ["split", "compress", "merge", "export"].forEach(function (k) { el("panel-" + k).hidden = (k !== activeTab); });
    ensurePanel(activeTab);
  });
});
document.querySelectorAll("[data-goto]").forEach(function (c) {
  c.addEventListener("click", function () {
    document.querySelector('.tab[data-tab="' + c.getAttribute("data-goto") + '"]').click();
    document.getElementById("toolSection").scrollIntoView({ behavior: "smooth", block: "start" });
  });
});

/* ---------------- scroll reveal (fade + rise cascade on scroll) ---------------- */
(function scrollReveal() {
  var els = Array.prototype.slice.call(document.querySelectorAll(".rv"));
  if (!els.length) return;
  function revealOne(e) {
    if (e.classList.contains("in")) return;
    e.classList.add("in");
    var delay = 0;
    try {
      var first = (window.getComputedStyle(e).transitionDelay || "").split(",")[0].trim();
      if (first.slice(-2) === "ms") delay = parseFloat(first);
      else if (first.slice(-1) === "s") delay = parseFloat(first) * 1000;
    } catch (err) { /* keep 0 */ }
    if (isNaN(delay)) delay = 0;
    setTimeout(function () { e.classList.remove("rv"); }, delay + 900);
  }
  if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    els.forEach(revealOne);
    return;
  }
  var timer = null;
  function inView(e) {
    var r = e.getBoundingClientRect();
    return r.top < window.innerHeight * 0.9 && r.bottom > -50;
  }
  function sweep() {
    var rest = 0;
    els.forEach(function (e) {
      if (e.classList.contains("in")) return;
      if (inView(e)) revealOne(e); else rest++;
    });
    if (!rest && timer) { clearInterval(timer); timer = null; }
  }
  timer = setInterval(sweep, 150);
  window.addEventListener("scroll", sweep, { passive: true });
  window.addEventListener("resize", sweep);
  window.addEventListener("pointerdown", sweep, { passive: true });
  window.addEventListener("keydown", sweep);
  window.addEventListener("focus", sweep);
  window.addEventListener("load", sweep);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(sweep);
  sweep();
})();

/* ---------------- slider spotlight: one gentle auto-nudge on first view ---------------- */
(function sliderNudge() {
  var view = document.getElementById("cmpView");
  var handle = document.getElementById("cmpHandle");
  if (!view || !handle) return;
  if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  var cancelled = false, played = false;
  view.addEventListener("pointerdown", function () { cancelled = true; }, { once: true });
  function inView() {
    var r = view.getBoundingClientRect();
    return r.top < window.innerHeight * 0.85 && r.bottom > 0;
  }
  function setSplit(v) {
    view.style.setProperty("--split", v + "%");
    handle.setAttribute("aria-valuenow", String(Math.round(v)));
  }
  var iv = setInterval(function () {
    if (played || cancelled) { clearInterval(iv); return; }
    if (!inView()) return;
    played = true; clearInterval(iv);
    var t0 = null;
    function frame(t) {
      if (cancelled) return; // user grabbed it — leave the position their drag set
      if (t0 === null) t0 = t;
      var p = (t - t0) / 1400;
      if (p >= 1) { setSplit(50); return; }
      setSplit(50 - Math.sin(p * Math.PI) * 16);
      if (window.requestAnimationFrame) window.requestAnimationFrame(frame);
      else setTimeout(function () { frame(Date.now()); }, 16);
    }
    if (window.requestAnimationFrame) window.requestAnimationFrame(frame);
    else frame(Date.now());
  }, 300);
})();

/* ---------------- shared file store ---------------- */
var store = null;            // {name, bytes, count, password}
var storeRev = 0;
var panelRev = { split: -1, compress: -1, export: -1 };
var pendingFile = null;      // {name, bytes} awaiting password

function libOpts() { return (store && store.password) ? { password: store.password } : {}; }
function pdfjsOpts(bytes) {
  return { data: bytes.slice(), password: (store && store.password) ? store.password : undefined };
}
async function pdfjsCount(bytes) {
  await workerReady;
  var doc = await pdfjsLib.getDocument(pdfjsOpts(bytes)).promise;
  var n = doc.numPages;
  await doc.destroy();
  return n;
}
function isPwdErr(e) {
  if (!e) return false;
  if (e.name === "PasswordException") return true;
  return /password|encrypt|decrypt/i.test(e.message || "");
}

async function loadIntoStore(file) {
  if (!file) return;
  var bytes;
  try { bytes = await readBytes(file); }
  catch (e) { console.error(e); return; }
  if (file.size > 104857600) {
    errBox(el({ split: "splitResult", compress: "compResult", export: "expResult", merge: "mergeResult" }[activeTab] || "splitResult"),
      "“" + file.name + "” is over the 100 MB limit. Compress it elsewhere first, or work with a smaller file.");
    return;
  }
  pendingFile = null;
  el("pwdArea").hidden = true;
  el("pwdErr").textContent = "";
  el("pwdInput").value = "";
  try {
    var keepPwd = store && store.password;
    var n = await (async function () {
      await workerReady;
      var save = store ? store.password : "";
      if (store) store.password = "";
      try {
        var d = await pdfjsLib.getDocument({ data: bytes.slice() }).promise;
        var c = d.numPages;
        await d.destroy();
        return c;
      } finally { if (store) store.password = save; }
    })();
    store = { name: file.name, bytes: bytes, count: n, password: "" };
    if (keepPwd) store.password = keepPwd;
    // verify stored password still works if kept (cheap: trust it; ops will surface issues)
    storeRev++;
    paintFileBar();
    ensurePanel(activeTab);
    refreshCompare();
  } catch (e) {
    if (isPwdErr(e)) {
      pendingFile = { name: file.name, bytes: bytes };
      paintFileBar();
      el("pwdArea").hidden = false;
      el("pwdInput").focus();
    } else {
      console.error(e);
      emitResult(el(activeTab === "merge" ? "mergeResult" : activeTab === "compress" ? "compResult" : activeTab === "export" ? "expResult" : "splitResult"),
        "", []);
      errBox(el(activeTab === "merge" ? "mergeResult" : activeTab === "compress" ? "compResult" : activeTab === "export" ? "expResult" : "splitResult"),
        "Could not read that PDF. It may be corrupted.");
    }
  }
}
async function unlockPending() {
  if (!pendingFile) return;
  var pwd = el("pwdInput").value;
  try {
    await workerReady;
    var d = await pdfjsLib.getDocument({ data: pendingFile.bytes.slice(), password: pwd || undefined }).promise;
    var c = d.numPages;
    await d.destroy();
    store = { name: pendingFile.name, bytes: pendingFile.bytes, count: c, password: pwd };
    pendingFile = null;
    el("pwdArea").hidden = true;
    el("pwdErr").textContent = "";
    storeRev++;
    paintFileBar();
    ensurePanel(activeTab);
    refreshCompare();
  } catch (e) {
    console.error(e);
    el("pwdErr").textContent = isPwdErr(e) ? "Wrong password — try again." : "Could not read that PDF.";
  }
}
el("unlockBtn").addEventListener("click", unlockPending);
el("pwdInput").addEventListener("keydown", function (e) { if (e.key === "Enter") unlockPending(); });

function paintFileBar() {
  var bar = el("fileBar");
  if (!store && !pendingFile) { bar.hidden = true; return; }
  bar.hidden = false;
  var n = store ? store.name : pendingFile.name;
  el("fbName").textContent = n;
  el("fbMeta").textContent = store ? "— " + fmtSize(store.bytes.length) + " — " + store.count + " pages" : "— locked";
  el("fbLock").hidden = !(store && store.password);
}
var tabInput = { split: "splitFile", compress: "compFile", merge: "mergeFiles", export: "expFile" };
el("replaceBtn").addEventListener("click", function () { el(tabInput[activeTab]).click(); });

function bindInput(inputId, fn) {
  el(inputId).addEventListener("change", function () {
    var files = [...el(inputId).files];
    el(inputId).value = "";
    if (files.length) fn(files);
  });
}
bindInput("splitFile", function (f) { loadIntoStore(f[0]); });
bindInput("compFile", function (f) { loadIntoStore(f[0]); });
bindInput("expFile", function (f) { loadIntoStore(f[0]); });
bindInput("mergeFiles", function (f) { addToMerge(f); });
bindInput("heroFile", function (f) { heroRoute(f); });

function showHeroErr(m) { var h = el("heroErr"); if (h) { h.hidden = false; h.textContent = m; } }
function hideHeroErr() { var h = el("heroErr"); if (h) { h.hidden = true; h.textContent = ""; } }
function heroRoute(files) {
  hideHeroErr();
  var pdfs = files.filter(function (f) { return /\.pdf$/i.test(f.name) || f.type === "application/pdf"; });
  if (!pdfs.length) { showHeroErr("Only PDF files, please — drop a .pdf to begin."); return; }
  var big = pdfs.filter(function (f) { return f.size > 104857600; });
  if (big.length) { showHeroErr("“" + big[0].name + "” is over the 100 MB limit. Please use a smaller file."); return; }
  if (pdfs.length > 1 || activeTab === "merge") {
    if (activeTab !== "merge") document.querySelector('.tab[data-tab="merge"]').click();
    addToMerge(pdfs);
  } else loadIntoStore(pdfs[0]);
  setTimeout(function () {
    var t = document.getElementById("toolSection");
    if (t) t.scrollIntoView({ behavior: "smooth", block: "start" });
  }, 200);
}

/* window-level drag & drop → routes by active tab */
var dragDepth = 0;
function visibleDrop() { return el("panel-" + activeTab).querySelector(".drop"); }
window.addEventListener("dragenter", function (e) { e.preventDefault(); dragDepth++; var d = visibleDrop(); if (d) d.classList.add("over"); var h = el("heroDrop"); if (h) h.classList.add("over"); });
window.addEventListener("dragleave", function (e) { e.preventDefault(); if (--dragDepth <= 0) { dragDepth = 0; document.querySelectorAll(".drop.over").forEach(function (d) { d.classList.remove("over"); }); } });
window.addEventListener("dragover", function (e) { e.preventDefault(); });
window.addEventListener("drop", function (e) {
  e.preventDefault(); dragDepth = 0;
  document.querySelectorAll(".drop.over").forEach(function (d) { d.classList.remove("over"); });
  var fs = e.dataTransfer && e.dataTransfer.files;
  if (!fs || !fs.length) return;
  if (activeTab === "merge") addToMerge([...fs]);
  else loadIntoStore(fs[0]);
});

function ensurePanel(tab) {
  if (tab === "merge" || !store) return;
  if (panelRev[tab] === storeRev) return;
  panelRev[tab] = storeRev;
  if (tab === "split") initSplit();
  else if (tab === "compress") initCompress();
  else if (tab === "export") initExport();
}

/* ---------------- range parser (1-based positions in current order) ---------------- */
function parseRanges(str, len) {
  var groups = [];
  var toks = str.split(/[,;\s]+/).filter(Boolean);
  if (!toks.length) return null;
  for (var t of toks) {
    var low = t.toLowerCase(), idx = [];
    if (low === "odd") { for (var i = 0; i < len; i += 2) idx.push(i); }
    else if (low === "even") { for (var k = 1; k < len; k += 2) idx.push(k); }
    else {
      var m = low.match(/^(\d*)-(\d*)$/);
      if (m && (m[1] || m[2])) {
        var a = m[1] ? parseInt(m[1], 10) : 1;
        var b = m[2] ? parseInt(m[2], 10) : len;
        if (a < 1 || b < 1 || a > len || b > len || a > b) throw new Error('Bad range "' + t + '" (document has ' + len + " pages in current order).");
        for (var p = a; p <= b; p++) idx.push(p - 1);
      } else if (/^\d+$/.test(low)) {
        var nn = parseInt(low, 10);
        if (nn < 1 || nn > len) throw new Error('Page "' + t + '" out of range (1–' + len + ").");
        idx.push(nn - 1);
      } else throw new Error('Could not understand "' + t + '". Use e.g. 1-3, 5, 8-');
    }
    groups.push(idx);
  }
  return groups;
}

/* ================= SPLIT & EDIT ================= */
var splitState = null;
var MAX_THUMBS = 300;
var dragPos = -1;

function totalRot(idx) { return ((splitState.origRot[idx] || 0) + (splitState.rot[idx] || 0)) % 360; }

async function initSplit() {
  if (splitState && splitState.doc) { try { await splitState.doc.destroy(); } catch (e) {} }
  splitState = { order: [], rot: {}, selected: new Set(), origRot: [], cache: new Map(), doc: null };
  for (var i = 0; i < store.count; i++) { splitState.order.push(i); splitState.selected.add(i); }
  el("splitRanges").value = "";
  el("splitWork").hidden = false;
  el("splitGrid").innerHTML = "";
  el("splitResult").innerHTML = "";
  if (store.count <= MAX_THUMBS) {
    el("splitThumbStatus").textContent = "Loading thumbnails…";
    try {
      await workerReady;
      splitState.doc = await pdfjsLib.getDocument(pdfjsOpts(store.bytes)).promise;
      for (var p = 1; p <= store.count; p++) {
        var pg = await splitState.doc.getPage(p);
        splitState.origRot[p - 1] = pg.rotate || 0;
        pg.cleanup();
      }
      await renderAllThumbs();
      el("splitThumbStatus").textContent = store.count + " pages — click to select, drag to reorder.";
    } catch (e) {
      console.error(e);
      errBox(el("splitResult"), "Could not render this PDF (it may use unsupported features). Range-based splitting below still works.");
      el("splitThumbStatus").textContent = "";
    }
  } else {
    el("splitThumbStatus").textContent = "Large document (" + store.count + " pages): thumbnails off — type ranges, then “Select ranges”. All pages selected.";
    for (var k = 0; k < store.count; k++) splitState.origRot[k] = 0;
  }
}

async function renderPageImage(idx) {
  var key = idx + ":" + totalRot(idx);
  if (splitState.cache.has(key)) return splitState.cache.get(key);
  var page = await splitState.doc.getPage(idx + 1);
  var vp0 = page.getViewport({ scale: 1 });
  var scale = 132 / vp0.width;
  var vp = page.getViewport({ scale: scale, rotation: totalRot(idx) });
  var cv = document.createElement("canvas");
  cv.width = Math.ceil(vp.width); cv.height = Math.ceil(vp.height);
  await page.render({ canvasContext: cv.getContext("2d"), viewport: vp }).promise;
  page.cleanup();
  var url = cv.toDataURL("image/jpeg", 0.72);
  splitState.cache.set(key, url);
  if (splitState.cache.size > 900) splitState.cache.delete(splitState.cache.keys().next().value);
  return url;
}

function buildThumb(pos) {
  var idx = splitState.order[pos];
  var d = document.createElement("div");
  d.className = "thumb" + (splitState.selected.has(idx) ? " sel" : "");
  d.draggable = true;
  d.dataset.pos = pos;
  var img = document.createElement("img");
  img.alt = "page " + (pos + 1);
  img.src = splitState.cache.get(idx + ":" + totalRot(idx)) || "";
  d.appendChild(img);
  var bar = document.createElement("div");
  bar.className = "pg";
  var sp = document.createElement("span"); sp.textContent = "p. " + (pos + 1);
  var cb = document.createElement("input");
  cb.type = "checkbox"; cb.checked = splitState.selected.has(idx);
  cb.addEventListener("click", function (ev) { ev.stopPropagation(); setThumb(pos, cb.checked); });
  bar.appendChild(sp); bar.appendChild(cb);
  d.appendChild(bar);
  d.addEventListener("click", function () { cb.checked = !cb.checked; setThumb(pos, cb.checked); });
  d.addEventListener("dragstart", function (ev) { dragPos = pos; d.classList.add("dragging"); try { ev.dataTransfer.setData("text/plain", String(pos)); } catch (e) {} });
  d.addEventListener("dragend", function () { d.classList.remove("dragging"); });
  d.addEventListener("dragover", function (ev) { ev.preventDefault(); d.classList.add("dragover"); });
  d.addEventListener("dragleave", function () { d.classList.remove("dragover"); });
  d.addEventListener("drop", function (ev) {
    ev.preventDefault(); d.classList.remove("dragover");
    var from = dragPos;
    if (from < 0 || from === pos) return;
    var moved = splitState.order.splice(from, 1)[0];
    splitState.order.splice(pos, 0, moved);
    dragPos = -1;
    rebuildGridFromCache();
  });
  return d;
}

function rebuildGridFromCache() {
  if (!splitState.doc) return; // range-only mode (large doc): no thumbnails to rebuild
  var grid = el("splitGrid");
  grid.innerHTML = "";
  for (var pos = 0; pos < splitState.order.length; pos++) grid.appendChild(buildThumb(pos));
}

async function renderAllThumbs() {
  var grid = el("splitGrid");
  grid.innerHTML = "";
  for (var pos = 0; pos < splitState.order.length; pos++) {
    await renderPageImage(splitState.order[pos]);
    grid.appendChild(buildThumb(pos));
    if (pos % 10 === 0) { el("splitThumbStatus").textContent = "Loading thumbnails… " + (pos + 1) + "/" + splitState.order.length; await yieldUI(); }
  }
}

function setThumb(pos, on) {
  var idx = splitState.order[pos];
  if (on) splitState.selected.add(idx); else splitState.selected.delete(idx);
  var d = el("splitGrid").children[pos];
  if (d) { d.classList.toggle("sel", on); var cb = d.querySelector("input"); if (cb) cb.checked = on; }
}
function paintSelection() {
  var kids = el("splitGrid").children;
  for (var pos = 0; pos < splitState.order.length; pos++) {
    var on = splitState.selected.has(splitState.order[pos]);
    if (kids[pos]) { kids[pos].classList.toggle("sel", on); var cb = kids[pos].querySelector("input"); if (cb) cb.checked = on; }
  }
}
function selectPositions(list) {
  splitState.selected.clear();
  list.forEach(function (pos) { splitState.selected.add(splitState.order[pos]); });
  paintSelection();
}
el("splitAll").addEventListener("click", function () {
  if (!splitState) return;
  splitState.selected = new Set(splitState.order);
  el("splitRanges").value = "";
  paintSelection();
});
el("splitNone").addEventListener("click", function () { if (splitState) { splitState.selected.clear(); paintSelection(); } });
el("splitOdd").addEventListener("click", function () {
  if (!splitState) return;
  splitState.selected.clear();
  for (var i = 0; i < splitState.order.length; i += 2) splitState.selected.add(splitState.order[i]);
  el("splitRanges").value = "odd"; paintSelection();
});
el("splitEven").addEventListener("click", function () {
  if (!splitState) return;
  splitState.selected.clear();
  for (var i = 1; i < splitState.order.length; i += 2) splitState.selected.add(splitState.order[i]);
  el("splitRanges").value = "even"; paintSelection();
});
el("splitInvert").addEventListener("click", function () {
  if (!splitState) return;
  var n = new Set();
  splitState.order.forEach(function (idx) { if (!splitState.selected.has(idx)) n.add(idx); });
  splitState.selected = n; paintSelection();
});
el("splitSelectRanges").addEventListener("click", function () {
  if (!splitState) return;
  try {
    var g = parseRanges(el("splitRanges").value.trim(), splitState.order.length);
    if (!g) throw new Error("Type at least one range first (e.g. 1-3, 5).");
    selectPositions([...new Set(g.flat())].sort(function (a, b) { return a - b; }));
  } catch (e) { errBox(el("splitResult"), e.message); }
});

async function rotateSelected(dir) {
  if (!splitState) return;
  var box = el("splitResult"); box.innerHTML = "";
  var targets = [...splitState.selected];
  if (!targets.length) { errBox(box, "Select pages first (or click All)."); return; }
  targets.forEach(function (idx) { splitState.rot[idx] = (((splitState.rot[idx] || 0) + dir) % 360 + 360) % 360; });
  if (splitState.doc) {
    for (var s = 0; s < targets.length; s++) {
      var pos = splitState.order.indexOf(targets[s]);
      if (pos >= 0 && el("splitGrid").children[pos]) {
        try {
          var url = await renderPageImage(targets[s]);
          el("splitGrid").children[pos].querySelector("img").src = url;
        } catch (e) { console.error(e); }
      }
      if (s % 5 === 0) await yieldUI();
    }
  } else paintSelection();
}
el("rotLeft").addEventListener("click", function () { rotateSelected(-90); });
el("rotRight").addEventListener("click", function () { rotateSelected(90); });
el("rotReset").addEventListener("click", async function () {
  if (!splitState || !splitState.doc) return;
  splitState.rot = {};
  if (splitState.doc) {
    for (var pos = 0; pos < splitState.order.length; pos++) {
      try {
        var url = await renderPageImage(splitState.order[pos]);
        if (el("splitGrid").children[pos]) el("splitGrid").children[pos].querySelector("img").src = url;
      } catch (e) { console.error(e); }
      if (pos % 10 === 0) await yieldUI();
    }
  }
});
el("deleteSel").addEventListener("click", function () {
  if (!splitState) return;
  if (!splitState.selected.size) { errBox(el("splitResult"), "Select pages first (or click All)."); return; }
  splitState.order = splitState.order.filter(function (idx) { return !splitState.selected.has(idx); });
  splitState.selected.clear();
  rebuildGridFromCache();
  el("splitThumbStatus").textContent = splitState.order.length + " pages left — click to select, drag to reorder.";
});

/* Apply a user rotation delta if one exists; otherwise leave the page's
   original /Rotate untouched (important for docs whose true rotation is unknown). */
function applyRot(p, idx) {
  var d = splitState ? (splitState.rot[idx] || 0) : 0;
  if (d) p.setRotation(degrees((((splitState.origRot[idx] || 0) + d) % 360 + 360) % 360));
}

/* Build PDF bytes from original page indices (in given order), applying rotations. */
async function buildPdfBytes(idxs, src, strip) {
  var out = await window.PDFLib.PDFDocument.create();
  if (idxs.length) {
    var pages = await out.copyPages(src, idxs);
    pages.forEach(function (p, k) {
      applyRot(p, idxs[k]);
      out.addPage(p);
    });
  }
  return await out.save({ useObjectStreams: true });
}
async function loadSrcDoc() { return await window.PDFLib.PDFDocument.load(store.bytes.slice(), libOpts()); }

el("saveEdited").addEventListener("click", async function () {
  if (!splitState) return;
  var box = el("splitResult"); box.innerHTML = "";
  try {
    if (!splitState.order.length) throw new Error("Nothing left to save — all pages were deleted.");
    progress("splitProgress", 0.4, "Saving…");
    var src = await loadSrcDoc();
    var out = await buildPdfBytes(splitState.order, src);
    progress("splitProgress", 1, "Done");
    emitResult(box, "Saved edited PDF: <b>" + splitState.order.length + " pages</b> (" + fmtSize(out.length) + ").",
      [{ name: baseName(store.name) + "-edited.pdf", data: out, mime: "application/pdf" }]);
  } catch (e) { console.error(e); errBox(box, isPwdErr(e) ? "This file needs a password — unlock it above first." : (e.message || "Save failed.")); }
});

el("splitGo").addEventListener("click", async function () {
  if (!splitState) return;
  var box = el("splitResult"); box.innerHTML = "";
  var mode = document.querySelector('input[name="splitMode"]:checked').value;
  var base = baseName(store.name);
  try {
    var src = await loadSrcDoc();
    var len = splitState.order.length;
    if (!len) throw new Error("Nothing left to split — all pages were deleted.");
    if (mode === "single") {
      var rtxt = el("splitRanges").value.trim();
      var posList;
      if (rtxt) {
        var g = parseRanges(rtxt, len);
        posList = [...new Set(g.flat())].sort(function (a, b) { return a - b; });
        selectPositions(posList);
      } else {
        posList = [];
        splitState.order.forEach(function (idx, p) { if (splitState.selected.has(idx)) posList.push(p); });
      }
      if (!posList.length) throw new Error("No pages selected.");
      var idxs = posList.map(function (p) { return splitState.order[p]; });
      progress("splitProgress", 0.4, "Extracting " + idxs.length + " pages…");
      var out = await buildPdfBytes(idxs, src);
      progress("splitProgress", 1, "Done");
      emitResult(box, "Saved <b>" + idxs.length + " pages</b> (" + fmtSize(out.length) + ").",
        [{ name: base + "-pages-" + idxs.length + "p.pdf", data: out, mime: "application/pdf" }]);
    } else if (mode === "ranges") {
      var rtxt2 = el("splitRanges").value.trim();
      if (!rtxt2) throw new Error("Type at least one range first (e.g. 1-3, 5, 8-).");
      var groups = parseRanges(rtxt2, len).filter(function (g) { return g.length; });
      if (!groups.length) throw new Error("No pages selected.");
      var zip = new JSZip();
      for (var gi = 0; gi < groups.length; gi++) {
        progress("splitProgress", gi / groups.length, "Range " + (gi + 1) + "/" + groups.length + "…");
        var gi2 = groups[gi].map(function (p) { return splitState.order[p]; });
        zip.file(base + "-p" + (groups[gi][0] + 1) + (groups[gi].length > 1 ? "-" + (groups[gi][groups[gi].length - 1] + 1) : "") + ".pdf",
          await buildPdfBytes(gi2, src));
        await yieldUI();
      }
      progress("splitProgress", 0.95, "Zipping…");
      var z = await zip.generateAsync({ type: "uint8array" });
      progress("splitProgress", 1, "Done");
      emitResult(box, "Split into <b>" + groups.length + " PDFs</b> (ZIP, " + fmtSize(z.length) + ").",
        [{ name: base + "-split.zip", data: z, mime: "application/zip" }], { preview: false });
    } else if (mode === "burst") {
      if (len > 500) throw new Error("Burst mode is capped at 500 pages (this file has " + len + "). Use ranges instead.");
      var zip2 = new JSZip();
      for (var i = 0; i < len; i++) {
        progress("splitProgress", i / len, "Page " + (i + 1) + "/" + len + "…");
        zip2.file(base + "-p" + (i + 1) + ".pdf", await buildPdfBytes([splitState.order[i]], src));
        if (i % 10 === 0) await yieldUI();
      }
      var z2 = await zip2.generateAsync({ type: "uint8array" });
      progress("splitProgress", 1, "Done");
      emitResult(box, "Burst into <b>" + len + " PDFs</b> (ZIP, " + fmtSize(z2.length) + ").",
        [{ name: base + "-burst.zip", data: z2, mime: "application/zip" }], { preview: false });
    } else if (mode === "oddeven") {
      var odd = [], even = [];
      splitState.order.forEach(function (idx, p) { (p % 2 === 0 ? odd : even).push(idx); });
      progress("splitProgress", 0.3, "Splitting odd/even…");
      var zip3 = new JSZip();
      zip3.file(base + "-odd.pdf", await buildPdfBytes(odd, src));
      if (even.length) zip3.file(base + "-even.pdf", await buildPdfBytes(even, src));
      var z3 = await zip3.generateAsync({ type: "uint8array" });
      progress("splitProgress", 1, "Done");
      emitResult(box, "Saved <b>odd (" + odd.length + "p) + even (" + even.length + "p)</b> (ZIP, " + fmtSize(z3.length) + ").",
        [{ name: base + "-odd-even.zip", data: z3, mime: "application/zip" }], { preview: false });
    } else { /* size */
      var targetMB = parseFloat(el("splitSizeMB").value) || 10;
      if (targetMB < 1) throw new Error("Minimum chunk size is 1 MB.");
      var target = Math.floor(targetMB * 1048576);
      var chunks = [], cur = [];
      var oversized = 0;
      for (var s = 0; s < len; s++) {
        progress("splitProgress", s / len, "Measuring page " + (s + 1) + "/" + len + "…");
        var trial = cur.concat([splitState.order[s]]);
        var tb = await buildPdfBytes(trial, src);
        if (tb.length <= target || !cur.length) { cur = trial; if (!cur.length || (cur.length === 1 && tb.length > target)) oversized += (cur.length === 1 && tb.length > target) ? 1 : 0; }
        else { chunks.push(cur); cur = [splitState.order[s]]; }
        await yieldUI();
      }
      if (cur.length) chunks.push(cur);
      progress("splitProgress", 0.92, "Zipping…");
      if (chunks.length === 1) {
        var one = await buildPdfBytes(chunks[0], src);
        progress("splitProgress", 1, "Done");
        emitResult(box, "Whole file already fits in <b>" + targetMB + " MB</b> (" + fmtSize(one.length) + ").",
          [{ name: base + "-under" + targetMB + "mb.pdf", data: one, mime: "application/pdf" }]);
      } else {
        var zip4 = new JSZip();
        for (var c = 0; c < chunks.length; c++)
          zip4.file(base + "-part" + (c + 1) + "of" + chunks.length + ".pdf", await buildPdfBytes(chunks[c], src));
        var z4 = await zip4.generateAsync({ type: "uint8array" });
        progress("splitProgress", 1, "Done");
        var warn = oversized ? " (" + oversized + " page(s) exceed " + targetMB + " MB alone and were kept whole)" : "";
        emitResult(box, "Split into <b>" + chunks.length + " chunks ≤ " + targetMB + " MB</b> (ZIP, " + fmtSize(z4.length) + ")." + warn,
          [{ name: base + "-chunks.zip", data: z4, mime: "application/zip" }], { preview: false });
      }
    }
  } catch (e) {
    console.error(e);
    errBox(box, isPwdErr(e) ? "This file needs a password — unlock it above first." : (e.message || "Split failed."));
  }
});

/* ================= COMPRESS ================= */
function initCompress() {
  el("compWork").hidden = false;
  el("compResult").innerHTML = "";
  syncRasterOpts();
}
function syncRasterOpts() {
  el("rasterOpts").hidden = document.querySelector('input[name="compEngine"]:checked').value !== "raster";
}
document.querySelectorAll('input[name="compEngine"]').forEach(function (r) { r.addEventListener("change", syncRasterOpts); });
el("compPreset").addEventListener("change", function () {
  var v = el("compPreset").value, d = el("compDpi"), q = el("compQ");
  if (v === "small") { d.value = "100"; q.value = 60; }
  else if (v === "balanced") { d.value = "150"; q.value = 70; }
  else if (v === "quality") { d.value = "200"; q.value = 85; }
  el("compQVal").textContent = q.value;
});
["compDpi", "compQ"].forEach(function (id) {
  el(id).addEventListener("input", function () { el("compPreset").value = "custom"; el("compQVal").textContent = el("compQ").value; });
});
el("compQ").addEventListener("input", function () { el("compQVal").textContent = el("compQ").value; });

function clearMeta(doc) {
  try {
    doc.setTitle(""); doc.setAuthor(""); doc.setSubject("");
    doc.setKeywords([]); doc.setProducer(""); doc.setCreator("");
  } catch (e) {}
}
async function rebuildBytes(strip) {
  var src = await window.PDFLib.PDFDocument.load(store.bytes.slice(), libOpts());
  if (strip) clearMeta(src);
  return await src.save({ useObjectStreams: true });
}
async function rasterBytes(dpi, q, gray, strip, onp) {
  await workerReady;
  var doc = await pdfjsLib.getDocument(pdfjsOpts(store.bytes)).promise;
  var n = doc.numPages;
  var pdf = await window.PDFLib.PDFDocument.create();
  if (strip) clearMeta(pdf);
  var scale = dpi / 72;
  for (var i = 1; i <= n; i++) {
    if (onp) onp(i, n);
    var page = await doc.getPage(i);
    var vp = page.getViewport({ scale: scale });
    var cv = document.createElement("canvas");
    cv.width = Math.ceil(vp.width); cv.height = Math.ceil(vp.height);
    var ctx = cv.getContext("2d");
    ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, cv.width, cv.height);
    await page.render({ canvasContext: ctx, viewport: vp }).promise;
    page.cleanup();
    if (gray) {
      var id = ctx.getImageData(0, 0, cv.width, cv.height), dd = id.data;
      for (var pxi = 0; pxi < dd.length; pxi += 4) {
        var lum = (dd[pxi] * 0.299 + dd[pxi + 1] * 0.587 + dd[pxi + 2] * 0.114) | 0;
        dd[pxi] = dd[pxi + 1] = dd[pxi + 2] = lum;
      }
      ctx.putImageData(id, 0, 0);
    }
    var blob = await canvasBlob(cv, "image/jpeg", q);
    var jpg = await pdf.embedJpg(new Uint8Array(await blob.arrayBuffer()));
    var pg = pdf.addPage([cv.width * 72 / dpi, cv.height * 72 / dpi]);
    pg.drawImage(jpg, { x: 0, y: 0, width: pg.getWidth(), height: pg.getHeight() });
    cv.width = cv.height = 0;
    await yieldUI();
  }
  await doc.destroy();
  return await pdf.save({ useObjectStreams: true });
}
function compNote(before, after, engine) {
  var pct = before ? Math.round((1 - after / before) * 100) : 0;
  if (pct >= 0) return "Saved <b>" + pct + "%</b>.";
  return "Result is <b>" + Math.abs(pct) + "% larger</b> — " + (engine === "raster"
    ? "this file is already tightly packed; try a lower resolution / quality, or “Lossless rebuild”."
    : "this file is already well optimized; try “Recompress pages” instead.");
}
el("compGo").addEventListener("click", async function () {
  if (!store) return;
  var box = el("compResult"); box.innerHTML = "";
  var engine = document.querySelector('input[name="compEngine"]:checked').value;
  var base = baseName(store.name);
  try {
    var before = store.bytes.length, out;
    if (engine === "rebuild") {
      progress("compProgress", 0.3, "Rebuilding…");
      out = await rebuildBytes(el("compStrip").checked);
      progress("compProgress", 1, "Done");
      emitResult(box, fmtSize(before) + " → <b>" + fmtSize(out.length) + "</b>. " + compNote(before, out.length, "rebuild"),
        [{ name: base + "-optimized.pdf", data: out, mime: "application/pdf" }]);
    } else {
      var dpi = parseInt(el("compDpi").value, 10), q = parseInt(el("compQ").value, 10) / 100;
      var gray = el("compGray").checked;
      out = await rasterBytes(dpi, q, gray, el("compStrip").checked, function (i, n) { progress("compProgress", (i - 1) / n, "Page " + i + "/" + n + "…"); });
      progress("compProgress", 1, "Done");
      emitResult(box, fmtSize(before) + " → <b>" + fmtSize(out.length) + "</b>. " + compNote(before, out.length, "raster") +
        '<div class="hint">Pages are now images — text can’t be selected or searched. Keep your original if that matters.</div>',
        [{ name: base + "-compressed.pdf", data: out, mime: "application/pdf" }]);
    }
  } catch (e) {
    console.error(e);
    errBox(box, isPwdErr(e) ? "This file needs a password — unlock it in Split first." : ((e && e.message) || "Compression failed."));
  }
});
el("compCompare").addEventListener("click", async function () {
  if (!store) return;
  var box = el("compResult"); box.innerHTML = "";
  var base = baseName(store.name);
  var strip = el("compStrip").checked;
  var before = store.bytes.length;
  var rows = [];
  try {
    progress("compProgress", 0.05, "Lossless…");
    rows.push({ label: "Lossless rebuild", set: "—", bytes: await rebuildBytes(strip) });
    var presets = [["Smallest", 100, 0.6], ["Balanced", 150, 0.7], ["High quality", 200, 0.85]];
    for (var i = 0; i < presets.length; i++) {
      var pr = presets[i];
      var b = await rasterBytes(pr[1], pr[2], false, strip, function (p, n) {
        progress("compProgress", (i + p / n) / (presets.length + 1), pr[0] + " " + p + "/" + n + "…");
      });
      rows.push({ label: "Recompress", set: pr[1] + " dpi, q" + Math.round(pr[2] * 100), bytes: b });
    }
    progress("compProgress", 1, "Done");
    var best = 0;
    rows.forEach(function (r, i) { if (r.bytes.length < rows[best].bytes.length) best = i; });
    var html = '<div class="stat">Original: <b>' + fmtSize(before) + "</b>. Best: <b>" + esc(rows[best].label + " (" + rows[best].set + ")") +
      "</b> → " + fmtSize(rows[best].bytes.length) + ".</div>";
    html += '<table class="cmp"><tr><th>Method</th><th>Settings</th><th>Size</th><th>Saved</th><th></th></tr>';
    rows.forEach(function (r, i) {
      var url = URL.createObjectURL(blobOf(r.bytes));
      r._url = url;
      var pct = Math.round((1 - r.bytes.length / before) * 100);
      html += "<tr><td" + (i === best ? ' class="best"' : "") + ">" + esc(r.label) + (i === best ? " ★" : "") + "</td><td>" +
        esc(r.set) + "</td><td>" + fmtSize(r.bytes.length) + "</td><td>" + pct + "%</td>" +
        '<td><a class="dl" style="padding:5px 10px" href="' + url + '" download="' + esc(base + "-compressed.pdf") + '">Get</a> ' +
        '<button type="button" class="pv" style="padding:5px 10px" data-u="' + url + '">Preview</button></td></tr>';
    });
    box.innerHTML = html + '<div class="hint">Pages from “Recompress” rows are images — text can’t be selected or searched.</div>';
    box.querySelectorAll(".pv").forEach(function (b) {
      b.addEventListener("click", function () { window.open(b.getAttribute("data-u"), "_blank"); });
    });
  } catch (e) {
    console.error(e);
    errBox(box, isPwdErr(e) ? "This file needs a password — unlock it in Split first." : ((e && e.message) || "Comparison failed."));
  }
});

/* ================= MERGE ================= */
var mergeState = []; // [{name, bytes, count, locked}]
async function addToMerge(files) {
  var box = el("mergeResult"); box.innerHTML = "";
  var list = files.filter(function (f) { return /\.pdf$/i.test(f.name) || f.type === "application/pdf"; });
  if (!list.length) { errBox(box, "No PDF files in that drop."); return; }
  var skippedBig = [];
  for (var f of list) {
    if (f.size > 104857600) { skippedBig.push(f.name); continue; }
    try {
      var bytes = await readBytes(f);
      var count = await pdfjsCount(bytes);
      mergeState.push({ name: f.name, bytes: bytes, count: count, locked: false });
    } catch (e) {
      if (isPwdErr(e)) mergeState.push({ name: f.name, bytes: bytes, count: 0, locked: true });
      else { console.error(e); errBox(box, "Skipped “" + f.name + "” — unreadable file."); }
    }
  }
  paintMerge();
  if (typeof skippedBig !== "undefined" && skippedBig.length)
    el("mergeResult").innerHTML += '<div class="hint">Skipped over-100 MB files: ' + skippedBig.map(esc).join(", ") + ".</div>";
}
function paintMerge() {
  var ul = el("mergeList"); ul.innerHTML = "";
  mergeState.forEach(function (m, i) {
    var li = document.createElement("li");
    var nm = document.createElement("span"); nm.className = "nm";
    nm.textContent = (i + 1) + ". " + m.name + (m.locked ? " (🔒 locked)" : " (" + m.count + "p, " + fmtSize(m.bytes.length) + ")");
    li.appendChild(nm);
    function btn(t, fn) { var b = document.createElement("button"); b.type = "button"; b.textContent = t; b.addEventListener("click", fn); li.appendChild(b); }
    btn("↑", function () { if (i > 0) { mergeState.splice(i - 1, 0, mergeState.splice(i, 1)[0]); paintMerge(); } });
    btn("↓", function () { if (i < mergeState.length - 1) { mergeState.splice(i + 1, 0, mergeState.splice(i, 1)[0]); paintMerge(); } });
    btn("✕", function () { mergeState.splice(i, 1); paintMerge(); });
    ul.appendChild(li);
  });
  el("mergeGo").disabled = mergeState.length < 1;
}
el("mergeGo").addEventListener("click", async function () {
  var box = el("mergeResult"); box.innerHTML = "";
  if (!mergeState.length) return;
  try {
    var out = await window.PDFLib.PDFDocument.create();
    var total = 0, skipped = [];
    for (var i = 0; i < mergeState.length; i++) {
      progress("mergeProgress", i / mergeState.length, "Adding " + mergeState[i].name + "…");
      var m = mergeState[i], src = null;
      try { src = await window.PDFLib.PDFDocument.load(m.bytes.slice()); }
      catch (e) {
        if (isPwdErr(e) && store && store.password) {
          try { src = await window.PDFLib.PDFDocument.load(m.bytes.slice(), { password: store.password }); }
          catch (e2) { /* fall through */ }
        }
        if (!src) { skipped.push(m.name); continue; }
      }
      var pages = await out.copyPages(src, src.getPageIndices());
      pages.forEach(function (p) { out.addPage(p); });
      total += pages.length;
      await yieldUI();
    }
    if (!total) throw new Error("Nothing to merge — all files were locked or unreadable.");
    var bytes = await out.save({ useObjectStreams: true });
    progress("mergeProgress", 1, "Done");
    var stat = "Merged <b>" + (mergeState.length - skipped.length) + " files, " + total + " pages</b> (" + fmtSize(bytes.length) + ").";
    if (skipped.length) stat += ' Skipped locked: ' + skipped.map(esc).join(", ") + ".";
    emitResult(box, stat, [{ name: baseName(mergeState[0].name) + "-merged.pdf", data: bytes, mime: "application/pdf" }]);
  } catch (e) { console.error(e); errBox(box, "Merge failed: " + (e.message || e)); }
});

/* ================= EXPORT ================= */
function initExport() {
  el("expWork").hidden = false;
  el("expResult").innerHTML = "";
  loadMeta();
}
el("expFormat").addEventListener("change", function () {
  el("expJpegOpts").style.display = el("expFormat").value === "png" ? "none" : "";
});
el("expQ").addEventListener("input", function () { el("expQVal").textContent = el("expQ").value; });

function expPositions() {
  var len = splitState && panelRev.split === storeRev ? splitState.order.length : store.count;
  var order = splitState && panelRev.split === storeRev ? splitState.order : null;
  var rtxt = el("expRange").value.trim();
  var pos = [];
  if (rtxt) parseRanges(rtxt, len).flat().forEach(function (p) { if (pos.indexOf(p) < 0) pos.push(p); });
  else for (var i = 0; i < len; i++) pos.push(i);
  pos.sort(function (a, b) { return a - b; });
  return { pos: pos, at: function (p) { return order ? order[p] : p; } };
}

el("expImagesGo").addEventListener("click", async function () {
  if (!store) return;
  var box = el("expResult"); box.innerHTML = "";
  try {
    var fmt = el("expFormat").value;
    var dpi = parseInt(el("expDpi").value, 10);
    var q = parseInt(el("expQ").value, 10) / 100;
    var gray = el("expGray").checked;
    var sel = expPositions();
    if (!sel.pos.length) throw new Error("No pages selected.");
    await workerReady;
    var doc = await pdfjsLib.getDocument(pdfjsOpts(store.bytes)).promise;
    var files = [];
    var base = baseName(store.name);
    var scale = dpi / 72;
    for (var k = 0; k < sel.pos.length; k++) {
      progress("expProgress", k / sel.pos.length, "Page " + (k + 1) + "/" + sel.pos.length + "…");
      var origIdx = sel.at(sel.pos[k]);
      var rotDeg = (splitState && panelRev.split === storeRev) ? totalRot(origIdx) : 0;
      var page = await doc.getPage(origIdx + 1);
      var vp = page.getViewport({ scale: scale, rotation: rotDeg });
      var cv = document.createElement("canvas");
      cv.width = Math.ceil(vp.width); cv.height = Math.ceil(vp.height);
      var ctx = cv.getContext("2d");
      ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, cv.width, cv.height);
      await page.render({ canvasContext: ctx, viewport: vp }).promise;
      page.cleanup();
      if (gray) {
        var id = ctx.getImageData(0, 0, cv.width, cv.height), dd = id.data;
        for (var pxi = 0; pxi < dd.length; pxi += 4) {
          var lum = (dd[pxi] * 0.299 + dd[pxi + 1] * 0.587 + dd[pxi + 2] * 0.114) | 0;
          dd[pxi] = dd[pxi + 1] = dd[pxi + 2] = lum;
        }
        ctx.putImageData(id, 0, 0);
      }
      var mime = fmt === "png" ? "image/png" : "image/jpeg";
      var blob = fmt === "png" ? await new Promise(function (res, rej) { cv.toBlob(function (b) { b ? res(b) : rej(new Error("encode failed")); }, mime); })
        : await canvasBlob(cv, mime, q);
      files.push({ name: base + "-p" + (sel.pos[k] + 1) + (fmt === "png" ? ".png" : ".jpg"), data: new Uint8Array(await blob.arrayBuffer()), mime: mime });
      cv.width = cv.height = 0;
      await yieldUI();
    }
    await doc.destroy();
    progress("expProgress", 0.95, "Packing…");
    if (files.length === 1) {
      progress("expProgress", 1, "Done");
      emitResult(box, "Exported <b>1 page</b> (" + fmtSize(files[0].data.length) + ").", files);
    } else {
      var zip = new JSZip();
      files.forEach(function (f) { zip.file(f.name, f.data); });
      var z = await zip.generateAsync({ type: "uint8array" });
      progress("expProgress", 1, "Done");
      emitResult(box, "Exported <b>" + files.length + " pages</b> (ZIP, " + fmtSize(z.length) + ").",
        [{ name: base + "-images.zip", data: z, mime: "application/zip" }], { preview: false });
    }
  } catch (e) {
    console.error(e);
    errBox(box, isPwdErr(e) ? "This file needs a password — unlock it in Split first." : (e.message || "Export failed."));
  }
});

el("expTextGo").addEventListener("click", async function () {
  if (!store) return;
  var box = el("expResult"); box.innerHTML = "";
  try {
    var sel = expPositions();
    if (!sel.pos.length) throw new Error("No pages selected.");
    await workerReady;
    var doc = await pdfjsLib.getDocument(pdfjsOpts(store.bytes)).promise;
    var parts = [];
    for (var k = 0; k < sel.pos.length; k++) {
      progress("expProgress", k / sel.pos.length, "Page " + (k + 1) + "/" + sel.pos.length + "…");
      var page = await doc.getPage(sel.at(sel.pos[k]) + 1);
      var tc = await page.getTextContent();
      parts.push("===== Page " + (sel.pos[k] + 1) + " =====\n\n" + tc.items.map(function (it) { return it.str; }).join(" "));
      page.cleanup();
      if (k % 5 === 0) await yieldUI();
    }
    await doc.destroy();
    progress("expProgress", 1, "Done");
    var txt = new TextEncoder().encode(parts.join("\n\n"));
    emitResult(box, "Extracted text from <b>" + sel.pos.length + " pages</b> (" + fmtSize(txt.length) + ").",
      [{ name: baseName(store.name) + ".txt", data: txt, mime: "text/plain" }]);
  } catch (e) {
    console.error(e);
    errBox(box, isPwdErr(e) ? "This file needs a password — unlock it in Split first." : (e.message || "Text extraction failed (scanned pages contain no text — use Export images instead)."));
  }
});

async function loadMeta() {
  var box = el("expResult");
  try {
    var src = await window.PDFLib.PDFDocument.load(store.bytes.slice(), libOpts());
    el("mTitle").value = src.getTitle() || "";
    el("mAuthor").value = src.getAuthor() || "";
    el("mSubject").value = src.getSubject() || "";
    try { el("mKeywords").value = src.getKeywords() || ""; } catch (e) { el("mKeywords").value = ""; }
    el("mProducer").value = src.getProducer() || "";
    el("mCreator").value = src.getCreator() || "";
  } catch (e) {
    console.error(e);
    errBox(box, isPwdErr(e) ? "This file needs a password — unlock it in Split first." : "Could not read metadata.");
  }
}
el("metaSave").addEventListener("click", async function () {
  if (!store) return;
  var box = el("expResult"); box.innerHTML = "";
  try {
    var src = await window.PDFLib.PDFDocument.load(store.bytes.slice(), libOpts());
    var idxs = (splitState && panelRev.split === storeRev) ? splitState.order.slice() : src.getPageIndices();
    var out = await window.PDFLib.PDFDocument.create();
    if (idxs.length) {
      var pages = await out.copyPages(src, idxs);
      pages.forEach(function (p, k) {
        applyRot(p, idxs[k]);
        out.addPage(p);
      });
    }
    out.setTitle(el("mTitle").value); out.setAuthor(el("mAuthor").value);
    out.setSubject(el("mSubject").value);
    out.setKeywords(el("mKeywords").value.split(/[\s,;]+/).filter(Boolean));
    out.setProducer(el("mProducer").value); out.setCreator(el("mCreator").value);
    var bytes = await out.save({ useObjectStreams: true });
    emitResult(box, "Metadata saved (" + fmtSize(bytes.length) + ").",
      [{ name: baseName(store.name) + "-meta.pdf", data: bytes, mime: "application/pdf" }]);
  } catch (e) {
    console.error(e);
    errBox(box, isPwdErr(e) ? "This file needs a password — unlock it in Split first." : (e.message || "Save failed."));
  }
});

/* ================= COMPARE (before/after slider) ================= */
var CMP_MOCK = "img/compare-sample-v3.jpg";
function initCompare() {
  var view = el("cmpView"), handle = el("cmpHandle");
  if (!view || !handle) return;
  el("cmpOrigImg").src = CMP_MOCK;
  el("cmpCompImg").src = CMP_MOCK;
  var pos = 50;
  function setP(p) {
    pos = Math.max(6, Math.min(94, p));
    view.style.setProperty("--split", pos + "%");
    handle.setAttribute("aria-valuenow", Math.round(pos));
  }
  function xToPos(clientX) {
    var r = view.getBoundingClientRect();
    return ((clientX - r.left) / r.width) * 100;
  }
  var dragging = false;
  handle.addEventListener("pointerdown", function (e) {
    dragging = true;
    try { handle.setPointerCapture(e.pointerId); } catch (err) {}
    if (e.cancelable) e.preventDefault();
  });
  handle.addEventListener("pointermove", function (e) { if (dragging) setP(xToPos(e.clientX)); });
  ["pointerup", "pointercancel"].forEach(function (ev) {
    handle.addEventListener(ev, function () { dragging = false; });
  });
  view.addEventListener("pointerdown", function (e) {
    if (e.target === handle || handle.contains(e.target)) return;
    setP(xToPos(e.clientX));
    dragging = true;
    try { handle.setPointerCapture(e.pointerId); } catch (err) {}
  });
  view.addEventListener("pointermove", function (e) { if (dragging && e.pressure) setP(xToPos(e.clientX)); });
  ["pointerup", "pointercancel"].forEach(function (ev) {
    view.addEventListener(ev, function () { dragging = false; });
  });
  handle.addEventListener("keydown", function (e) {
    if (e.key === "ArrowLeft") { setP(pos - 6); e.preventDefault(); }
    else if (e.key === "ArrowRight") { setP(pos + 6); e.preventDefault(); }
    else if (e.key === "Home") { setP(6); e.preventDefault(); }
    else if (e.key === "End") { setP(94); e.preventDefault(); }
  });
  setP(50);
}
var cmpToken = 0;
async function refreshCompare() {
  var view = el("cmpView");
  if (!view || !store) return;
  var my = ++cmpToken;
  try {
    var firstIdx = (splitState && splitState.order && splitState.order.length) ? splitState.order[0] : 0;
    await workerReady;
    var doc = await pdfjsLib.getDocument(pdfjsOpts(store.bytes)).promise;
    if (my !== cmpToken) { try { await doc.destroy(); } catch (e) {} return; }
    var page = await doc.getPage(firstIdx + 1);
    var w0 = page.getViewport({ scale: 1 }).width;
    var DW = 880;
    var vp = page.getViewport({ scale: DW / w0 });
    var cv = document.createElement("canvas");
    cv.width = Math.ceil(vp.width); cv.height = Math.ceil(vp.height);
    var ctx = cv.getContext("2d");
    ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, cv.width, cv.height);
    await page.render({ canvasContext: ctx, viewport: vp }).promise;
    page.cleanup();
    if (my !== cmpToken) { try { await doc.destroy(); } catch (e) {} return; }
    var origURL = cv.toDataURL("image/jpeg", 0.88);
    var src = await window.PDFLib.PDFDocument.load(store.bytes.slice(), libOpts());
    var origBytes = await buildPdfBytes([firstIdx], src);
    var scale = 150 / 72;
    var page2 = await doc.getPage(firstIdx + 1);
    var vp2 = page2.getViewport({ scale: scale });
    var cv2 = document.createElement("canvas");
    cv2.width = Math.ceil(vp2.width); cv2.height = Math.ceil(vp2.height);
    var ctx2 = cv2.getContext("2d");
    ctx2.fillStyle = "#fff"; ctx2.fillRect(0, 0, cv2.width, cv2.height);
    await page2.render({ canvasContext: ctx2, viewport: vp2 }).promise;
    page2.cleanup();
    await doc.destroy();
    if (my !== cmpToken) return;
    var compURL = cv2.toDataURL("image/jpeg", 0.88);
    var blob = await new Promise(function (res, rej) { cv2.toBlob(function (b) { b ? res(b) : rej(new Error("encode failed")); }, "image/jpeg", 0.7); });
    var pdf = await window.PDFLib.PDFDocument.create();
    var jpg = await pdf.embedJpg(new Uint8Array(await blob.arrayBuffer()));
    var pg = pdf.addPage([cv2.width * 72 / 150, cv2.height * 72 / 150]);
    pg.drawImage(jpg, { x: 0, y: 0, width: pg.getWidth(), height: pg.getHeight() });
    var compBytes = await pdf.save({ useObjectStreams: true });
    if (my !== cmpToken || !store) return;
    el("cmpOrigImg").src = origURL;
    el("cmpCompImg").src = compURL;
    el("cmpSize").textContent = fmtSize(origBytes.length) + " → " + fmtSize(compBytes.length);
    var pct = Math.round((1 - compBytes.length / origBytes.length) * 100);
    var badge = el("cmpBadge");
    if (pct >= 0) { badge.textContent = pct + "% smaller"; badge.classList.remove("bigger"); }
    else { badge.textContent = Math.abs(pct) + "% larger"; badge.classList.add("bigger"); }
    el("cmpMode").textContent = "Your file · page 1";
    cv.width = cv.height = 0; cv2.width = cv2.height = 0;
  } catch (e) { console.error(e); /* keep mock content */ }
}

/* ---------------- boot ---------------- */
loadSettings();
syncRasterOpts();
initCompare();
el("expJpegOpts").style.display = el("expFormat").value === "png" ? "none" : "";
paintFileBar();

})();
