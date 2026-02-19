// DOM refs
const fileInput     = document.getElementById("file");
const dropZone      = document.getElementById("drop");
const downloadBtn   = document.getElementById("download");
const downloadLabel = document.getElementById("downloadLabel");
const clearBtn      = document.getElementById("clear");
const customBtn     = document.getElementById("customResize");
const widthInput    = document.getElementById("cw");
const heightInput   = document.getElementById("ch");
const cwGroup       = document.getElementById("cwGroup");
const chGroup       = document.getElementById("chGroup");
const statusText    = document.getElementById("statusText");
const statusDot     = document.getElementById("statusDot");
const statusBar     = document.getElementById("status");
const canvasEmpty   = document.getElementById("canvasEmpty");
const canvasBadge   = document.getElementById("canvasBadge");
const canvas        = document.getElementById("out");
const previewGrid   = document.getElementById("previewGrid");
const gridHeader    = document.getElementById("gridHeader");
const loadChoice    = document.getElementById("loadChoice");
const loadChoiceMsg = document.getElementById("loadChoiceMsg");
const choiceReplace = document.getElementById("choiceReplace");
const choiceAdd     = document.getElementById("choiceAdd");
const choiceCancel  = document.getElementById("choiceCancel");
const kbdHint       = document.getElementById("kbdHint");
const qualityHint   = document.getElementById("qualityHint");
const themeToggle   = document.getElementById("themeToggle");
const ctx           = canvas.getContext("2d");

const steps = [
  document.getElementById("step1"),
  document.getElementById("step2"),
  document.getElementById("step3"),
];

// App state
let images        = [];
let activeSize    = { w: 1200, h: 628 };
let activeQuality = 0.92;
let selectedIndex = 0;
let isExporting   = false;
let pendingFiles  = null;

const qualityHints = {
  "0.7":  "Smallest file size, some compression visible",
  "0.85": "Good balance of size and quality",
  "0.92": "Sharp output, larger file size",
};


// --- Helpers ---

const plural = (n) => n !== 1 ? "s" : "";

// Revokes all blob URLs in the grid to free memory
function revokeGrid() {
  previewGrid.querySelectorAll("a[data-objurl]").forEach(a => URL.revokeObjectURL(a.href));
}

// Resets the UI back to the empty/no-images state
function resetUI() {
  revokeGrid();
  images.forEach(item => item.bitmap.close());
  images = [];
  previewGrid.innerHTML = "";
  gridHeader.style.display = "none";
  loadChoice.style.display = "none";
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  canvasEmpty.classList.remove("hidden");
  canvasBadge.classList.remove("visible");
  downloadBtn.disabled = true;
  setStep(1);
}

function cleanName(name) {
  return name
    .replace(/\.[^.]+$/, "")
    .replace(/[^\w\-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "") || "image";
}

function clamp(v, min, max) { return Math.min(max, Math.max(min, v)); }

function setActivePreset(btn) {
  document.querySelectorAll(".seg-btn").forEach(b => b.classList.remove("active"));
  if (btn) btn.classList.add("active");
}

function clearInputError() {
  cwGroup.classList.remove("error");
  chGroup.classList.remove("error");
}


// --- Preferences ---

function savePrefs() {
  try {
    localStorage.setItem("resizer-size",    JSON.stringify(activeSize));
    localStorage.setItem("resizer-quality", String(activeQuality));
  } catch {}
}

function loadPrefs() {
  try {
    const size = JSON.parse(localStorage.getItem("resizer-size"));
    if (size?.w && size?.h) activeSize = size;

    const q = parseFloat(localStorage.getItem("resizer-quality"));
    if (!isNaN(q)) activeQuality = q;
  } catch {}
}


// --- Step indicator ---

function setStep(step) {
  steps.forEach((el, i) => {
    el.classList.remove("active", "done");
    if (i + 1 < step)  el.classList.add("done");
    if (i + 1 === step) el.classList.add("active");
  });
}


// --- Status bar ---

function setStatus(msg, state = "idle") {
  statusText.textContent = msg;
  statusDot.className = "status-dot" + (state !== "idle" ? ` ${state}` : "");
  statusBar.classList.remove("flash");
  void statusBar.offsetWidth; // re-trigger animation
  statusBar.classList.add("flash");
}


// --- Canvas drawing ---

// Center-crops the bitmap to exactly w×h — always fills without letterboxing
function drawCentered(bitmap, w, h, targetCtx, targetCanvas) {
  const scale = Math.max(w / bitmap.width, h / bitmap.height);
  const cropW = Math.round(w / scale);
  const cropH = Math.round(h / scale);
  const sx    = Math.floor((bitmap.width  - cropW) / 2);
  const sy    = Math.floor((bitmap.height - cropH) / 2);

  targetCanvas.width  = w;
  targetCanvas.height = h;

  targetCtx.fillStyle = "#000";
  targetCtx.fillRect(0, 0, w, h);
  targetCtx.imageSmoothingEnabled = true;
  targetCtx.imageSmoothingQuality = "high";
  targetCtx.drawImage(bitmap, sx, sy, cropW, cropH, 0, 0, w, h);
}

async function bitmapToObjectURL(bitmap, w, h, quality) {
  const off = document.createElement("canvas");
  drawCentered(bitmap, w, h, off.getContext("2d"), off);
  const blob = await new Promise(r => off.toBlob(r, "image/jpeg", quality));
  return blob ? URL.createObjectURL(blob) : null;
}


// --- Preview ---

async function updatePreview() {
  if (!images.length) return;

  setStatus("Rendering…", "busy");
  canvas.style.opacity = "0.5";
  await new Promise(r => setTimeout(r, 60));

  drawCentered(images[selectedIndex].bitmap, activeSize.w, activeSize.h, ctx, canvas);
  canvas.style.opacity = "1";
  canvasEmpty.classList.add("hidden");
  canvasBadge.textContent = `${activeSize.w} × ${activeSize.h}`;
  canvasBadge.classList.add("visible");

  await renderGrid();
  downloadBtn.disabled = false;
  setStep(3);
  setStatus(`${activeSize.w} × ${activeSize.h}  ·  ${images.length} image${plural(images.length)}`, "active");
}


// --- Thumbnail grid ---

const svgDownload = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>`;
const svgCheck    = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`;

async function renderGrid() {
  revokeGrid();
  previewGrid.innerHTML = "";

  if (!images.length) { gridHeader.style.display = "none"; return; }
  gridHeader.style.display = "flex";

  const { w, h } = activeSize;

  for (let i = 0; i < images.length; i++) {
    const item = images[i];
    const wrap = document.createElement("div");
    wrap.className = "preview-item" + (i === selectedIndex ? " selected" : "");

    const removeBtn = document.createElement("button");
    removeBtn.className   = "card-remove";
    removeBtn.title       = "Remove this image";
    removeBtn.textContent = "×";
    removeBtn.addEventListener("click", e => { e.stopPropagation(); removeImage(i); });

    const thumbWrap = document.createElement("div");
    thumbWrap.className = "thumb-wrap";

    const thumb  = document.createElement("canvas");
    const scale  = 160 / w;
    thumb.width  = Math.round(w * scale);
    thumb.height = Math.round(h * scale);
    drawCentered(item.bitmap, w, h, thumb.getContext("2d"), thumb);

    const overlay = document.createElement("div");
    overlay.className   = "thumb-overlay";
    overlay.textContent = "Click to preview";

    thumbWrap.append(thumb, overlay);
    thumbWrap.addEventListener("click", () => { selectedIndex = i; updatePreview(); });

    const info   = document.createElement("div");
    info.className = "card-info";

    const nameEl = document.createElement("div");
    nameEl.className   = "filename";
    nameEl.textContent = item.name;

    const dimsEl = document.createElement("div");
    dimsEl.className   = "src-dims";
    dimsEl.textContent = `${item.bitmap.width} × ${item.bitmap.height}`;

    info.append(nameEl, dimsEl);

    const url   = await bitmapToObjectURL(item.bitmap, w, h, activeQuality);
    const dlBtn = document.createElement("a");
    dlBtn.className      = "card-dl-btn";
    dlBtn.href           = url;
    dlBtn.download       = cleanName(item.name) + ".jpg";
    dlBtn.dataset.objurl = "1";
    dlBtn.innerHTML      = svgDownload + " Save";

    dlBtn.addEventListener("click", () => {
      setTimeout(() => {
        dlBtn.innerHTML = svgCheck + " Saved!";
        dlBtn.classList.add("saved");
        setTimeout(() => {
          dlBtn.innerHTML = svgDownload + " Save";
          dlBtn.classList.remove("saved");
        }, 3000);
      }, 200);
    });

    wrap.append(removeBtn, thumbWrap, info, dlBtn);
    previewGrid.appendChild(wrap);
  }
}


// --- Remove a single image ---

function removeImage(index) {
  images[index].bitmap.close();
  images.splice(index, 1);

  if (!images.length) {
    resetUI();
    setStatus("All images removed. Load more to continue.");
    return;
  }

  if (selectedIndex >= images.length) selectedIndex = images.length - 1;
  updatePreview();
}


// --- Loading files ---

// If images are already loaded, ask whether to replace or add rather than silently stacking
function handleFileInput(fileList) {
  const files = [...fileList].filter(f => f.type.startsWith("image/"));
  if (!files.length) { setStatus("No valid images found."); return; }

  if (images.length > 0) {
    pendingFiles = files;
    loadChoiceMsg.textContent = `You already have ${images.length} image${plural(images.length)} loaded. Replace or add?`;
    loadChoice.style.display = "flex";
    return;
  }

  processFiles(files, false);
}

function processFiles(files, addToExisting) {
  loadChoice.style.display = "none";

  if (!addToExisting) {
    revokeGrid();
    images.forEach(item => item.bitmap.close());
    images = [];
  }

  loadImages(files);
}

async function loadImages(files) {
  setStep(2);
  setStatus(`Loading ${files.length} image${plural(files.length)}…`, "busy");

  for (const file of files) {
    try {
      const bitmap = await createImageBitmap(file);
      images.push({ bitmap, name: file.name });
    } catch {
      console.warn("Skipped unreadable file:", file.name);
    }
  }

  await updatePreview();
}


// --- Download all ---

function downloadAll() {
  if (!images.length || isExporting) return;

  isExporting = true;
  downloadBtn.disabled = true;
  downloadLabel.textContent = "Downloading…";

  const links = [...previewGrid.querySelectorAll("a.card-dl-btn")];
  links.forEach(a => a.click());

  setTimeout(() => {
    isExporting = false;
    downloadBtn.disabled = false;
    downloadLabel.textContent = "Download All";
    setStatus(`Done · ${images.length} image${plural(images.length)} exported`, "active");
  }, links.length * 300 + 500);
}


// --- Size ---

function applySizeChange(w, h) {
  activeSize = { w, h };
  savePrefs();
  canvasBadge.textContent = `${w} × ${h}`;
  canvasBadge.classList.add("visible");
  if (images.length) {
    updatePreview();
  } else {
    setStep(1);
    setStatus(`Size set to ${w} × ${h}. Now load your images.`);
  }
}


// --- Event listeners ---

document.querySelectorAll("[data-size]").forEach(btn => {
  btn.addEventListener("click", () => {
    const [w, h] = btn.dataset.size.split("x").map(Number);
    setActivePreset(btn);
    clearInputError();
    applySizeChange(w, h);
  });
});

customBtn.addEventListener("click", () => {
  const w = clamp(parseInt(widthInput.value)  || 0, 32, 20000);
  const h = clamp(parseInt(heightInput.value) || 0, 32, 20000);
  const wEmpty = !parseInt(widthInput.value);
  const hEmpty = !parseInt(heightInput.value);

  cwGroup.classList.toggle("error", wEmpty);
  chGroup.classList.toggle("error", hEmpty);
  if (wEmpty || hEmpty) { setStatus("Enter a value in the highlighted field."); return; }

  clearInputError();
  setActivePreset(null);
  applySizeChange(w, h);
});

[widthInput, heightInput].forEach(el => {
  el.addEventListener("keydown", e => { if (e.key === "Enter") customBtn.click(); });
  el.addEventListener("input",   () => el.closest(".input-group").classList.remove("error"));
});

document.querySelectorAll(".quality-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".quality-btn").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    activeQuality = parseFloat(btn.dataset.quality);
    qualityHint.textContent = qualityHints[btn.dataset.quality];
    savePrefs();
    if (images.length) updatePreview();
  });
});

choiceReplace.addEventListener("click", () => {
  if (pendingFiles) { processFiles(pendingFiles, false); pendingFiles = null; }
});
choiceAdd.addEventListener("click", () => {
  if (pendingFiles) { processFiles(pendingFiles, true); pendingFiles = null; }
});
choiceCancel.addEventListener("click", () => {
  pendingFiles = null;
  loadChoice.style.display = "none";
  fileInput.value = "";
});

clearBtn.addEventListener("click", () => {
  resetUI();
  setStatus("Cleared. Load new images when ready.");
});

fileInput.addEventListener("change", e => {
  if (e.target.files?.length) handleFileInput(e.target.files);
  fileInput.value = "";
});

dropZone.addEventListener("click",    () => fileInput.click());
dropZone.addEventListener("dragover",  e => { e.preventDefault(); dropZone.classList.add("drag"); });
dropZone.addEventListener("dragleave", ()  => dropZone.classList.remove("drag"));
dropZone.addEventListener("drop", e => {
  e.preventDefault();
  dropZone.classList.remove("drag");
  if (e.dataTransfer?.files?.length) handleFileInput(e.dataTransfer.files);
});

downloadBtn.addEventListener("click", downloadAll);

const isMac = navigator.platform.toUpperCase().includes("MAC");
kbdHint.textContent = isMac ? "⌘⇧D" : "Ctrl+Shift+D";

document.addEventListener("keydown", e => {
  const mod = isMac ? e.metaKey : e.ctrlKey;
  if (mod && e.shiftKey && e.key.toLowerCase() === "d") {
    e.preventDefault();
    downloadAll();
  }
});

function applyTheme(light) {
  document.body.classList.toggle("light", light);
  try { localStorage.setItem("resizer-theme", light ? "light" : "dark"); } catch {}
}

themeToggle.addEventListener("click", () => applyTheme(!document.body.classList.contains("light")));


// --- Init ---

loadPrefs();

try {
  if (localStorage.getItem("resizer-theme") === "light") applyTheme(true);
} catch {}

document.querySelectorAll(".quality-btn").forEach(btn => {
  const match = parseFloat(btn.dataset.quality) === activeQuality;
  btn.classList.toggle("active", match);
  if (match) qualityHint.textContent = qualityHints[btn.dataset.quality];
});

let presetRestored = false;
document.querySelectorAll("[data-size]").forEach(btn => {
  const [w, h] = btn.dataset.size.split("x").map(Number);
  if (w === activeSize.w && h === activeSize.h) {
    setActivePreset(btn);
    presetRestored = true;
  }
});
if (!presetRestored) {
  setActivePreset(null);
  widthInput.value  = activeSize.w;
  heightInput.value = activeSize.h;
}

canvasBadge.textContent = `${activeSize.w} × ${activeSize.h}`;
setStep(1);
setStatus("Choose a size, then load your images.");
downloadBtn.disabled = true;
