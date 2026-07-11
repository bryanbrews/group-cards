import {
  api,
  qs,
  FONTS,
  COLORS,
  renderEntryTile,
  resizeImage,
  wireCopyButton,
  getMyEdits,
  addMyEdit,
  removeMyEdit,
  getMyName,
  saveMyName,
  bookletSheets,
} from "./common.js";

const cardId = qs("c");
const token = qs("t"); // optional on public cards

const pageError = document.getElementById("page-error");
const bookStage = document.getElementById("book-stage");
const bookEl = document.getElementById("book");
const prevBtn = document.getElementById("prev-btn");
const nextBtn = document.getElementById("next-btn");
const pageIndicator = document.getElementById("page-indicator");
const composerModal = document.getElementById("composer-modal");

const mobileQuery = window.matchMedia("(max-width: 700px)");

let card = null;
let entries = [];
let myEdits = getMyEdits(cardId);
let faces = []; // flat list of face elements in reading order
let sheets = []; // sheet elements
let pos = 0; // desktop: spread index (sheets flipped); mobile: face index

function showPageError(msg) {
  pageError.textContent = msg;
  pageError.classList.remove("hidden");
}

// ------------------------------------------------------ scrapbook pages

// Every inside page is a 2x2 grid of spots. Entries carry {page, slot};
// legacy V1 notes (kind === null) span their half of the page (slot 0
// covers 0+1, slot 2 covers 2+3). There is always exactly one blank page
// after the last page with content, so the book can keep growing.
function entriesByPage() {
  let maxPage = -1;
  for (const e of entries) maxPage = Math.max(maxPage, e.page ?? 0);
  const pages = Array.from({ length: maxPage + 2 }, () => [null, null, null, null]);
  for (const e of entries) {
    const p = e.page ?? 0;
    const s = e.slot ?? 0;
    if (pages[p] && s >= 0 && s <= 3 && !pages[p][s]) pages[p][s] = e;
  }
  return pages;
}

// Slots an entry covers on its page (mirrors the server's footprint).
function entryFootprint(e) {
  const slot = e.slot ?? 0;
  if (e.kind == null) return [slot, slot + 1]; // legacy half-page bundle
  const media = e.kind === "photo" || e.kind === "gif" || e.kind === "doodle";
  const size = media ? e.size ?? 1 : 1;
  if (size === 4) return [0, 1, 2, 3];
  if (size === 2) return [slot, slot + 1];
  return [slot];
}

// Which anchor slot each size would use for an item at {page, slot} —
// null when its footprint isn't free. Editing passes the entry to exclude
// itself and pin anchors to its own (immutable) slot.
function sizeOptionsFor(page, slot, editEntry = null) {
  const occupied = new Set();
  for (const e of entries) {
    if ((e.page ?? 0) !== page) continue;
    if (editEntry && e.id === editEntry.id) continue;
    for (const s of entryFootprint(e)) occupied.add(s);
  }
  const free = (spots) => spots.every((s) => !occupied.has(s));
  const halfAnchor = editEntry ? (slot === 0 || slot === 2 ? slot : null) : slot < 2 ? 0 : 2;
  const fullAnchor = editEntry ? (slot === 0 ? 0 : null) : 0;
  return {
    1: free([slot]) ? slot : null,
    2: halfAnchor != null && free([halfAnchor, halfAnchor + 1]) ? halfAnchor : null,
    4: fullAnchor != null && free([0, 1, 2, 3]) ? fullAnchor : null,
  };
}

// ------------------------------------------------------- build the book

function el(tag, className, parent) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (parent) parent.appendChild(node);
  return node;
}

function buildCoverFace() {
  const face = el("div", "face cover-face");
  const hasPhoto =
    card.cover_image && /^data:image\/(jpeg|png|webp);base64,/.test(card.cover_image);
  if (hasPhoto) {
    const img = el("img", "cover-photo", face);
    img.alt = "";
    img.src = card.cover_image;
  } else {
    face.classList.add("cover-plain");
  }
  const scrim = el("div", "cover-scrim", face);
  const h1 = el("h1", "", scrim);
  h1.textContent = card.title;
  if (card.recipient_name) {
    const forLine = el("div", "cover-for", scrim);
    forLine.textContent = `for ${card.recipient_name}`;
  }
  const hint = el("div", "cover-hint no-print", face);
  hint.textContent = "open me";
  return face;
}

// One inside page: a 2x2 grid. Empty spots are dashed "+" buttons that
// open the composer; filled spots render the item (own items get controls).
// Spots covered by a legacy/half/full span aren't rendered at all.
function buildPageFace(slots, pageNo, totalPages) {
  const face = el("div", "face");
  const grid = el("div", "page-grid", face);
  let filled = 0;
  const covered = new Set();
  for (let s = 0; s < 4; s++) {
    if (covered.has(s)) continue;
    const entry = slots[s];
    if (entry) {
      const media = entry.kind === "photo" || entry.kind === "gif" || entry.kind === "doodle";
      const size = media ? entry.size ?? 1 : 1;
      const half = size === 2 && (s === 0 || s === 2);
      const full = size === 4 && s === 0;
      // Two text notes in the same row share one quadrant
      const neighbor = slots[s + 1];
      const isText = !media && size === 1;
      const neighborIsText = neighbor && neighbor.kind !== "photo" && neighbor.kind !== "gif" && neighbor.kind !== "doodle";
      const pair = isText && (s === 0 || s === 2) && neighborIsText;
      let cls = "spot spot-filled";
      if (media) cls += " spot-media";
      if (half) cls += " spot-half";
      if (full) cls += " spot-full";
      if (pair) cls += " spot-text-pair";
      const spot = el("div", cls, grid);
      spot.appendChild(withOwnControls(renderEntryTile(entry), entry));
      filled++;
      if (pair) {
        spot.appendChild(withOwnControls(renderEntryTile(neighbor), neighbor));
        filled++;
        covered.add(s + 1);
      }
      if (half) covered.add(s + 1);
      if (full) {
        covered.add(1);
        covered.add(2);
        covered.add(3);
      }
    } else {
      const btn = el("button", "spot spot-empty", grid);
      btn.type = "button";
      btn.setAttribute("aria-label", `Add something to page ${pageNo}`);
      btn.textContent = "+";
      const page = pageNo - 1;
      const slot = s;
      btn.addEventListener("click", () => openComposer({ page, slot }));
    }
  }
  if (!filled) face.classList.add("print-skip"); // don't print empty pages
  const num = el("div", "page-num", face);
  num.textContent = `${pageNo} / ${totalPages}`;
  return face;
}

// Corner edit/remove controls on items created on this device.
function withOwnControls(node, entry) {
  const mine = myEdits.find((m) => m.entryId === entry.id);
  if (!mine) return node;
  const controls = el("div", "item-controls no-print", node);
  if (entry.kind != null) {
    // legacy bundled notes are remove-only (no composer tab fits them)
    const editBtn = el("button", "item-btn", controls);
    editBtn.type = "button";
    editBtn.textContent = "\u270E";
    editBtn.setAttribute("aria-label", "Edit this");
    editBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      openComposer({ page: entry.page, slot: entry.slot, editEntry: entry, editToken: mine.editToken });
    });
  }
  const delBtn = el("button", "item-btn item-btn-danger", controls);
  delBtn.type = "button";
  delBtn.textContent = "\u2715";
  delBtn.setAttribute("aria-label", "Remove this");
  delBtn.addEventListener("click", async (e) => {
    e.stopPropagation();
    if (!confirm("Remove this from the card?")) return;
    try {
      await api(`/${encodeURIComponent(cardId)}/entries/${encodeURIComponent(entry.id)}`, {
        method: "DELETE",
        body: { edit_token: mine.editToken },
      });
    } catch (err) {
      if (err.status !== 404) {
        alert(err.message || "Couldn't remove it — try again.");
        return;
      }
    }
    removeMyEdit(cardId, entry.id);
    myEdits = getMyEdits(cardId);
    await refreshEntries();
  });
  return node;
}

function buildBlankFace() {
  const face = el("div", "face blank-face print-skip");
  const dot = el("div", "", face);
  dot.textContent = "\u2766";
  dot.style.opacity = "0.4";
  return face;
}

function buildColophonFace() {
  const face = el("div", "face colophon-face");
  const box = el("div", "colophon", face);
  const heart = el("div", "heart", box);
  heart.textContent = "\u2665";
  const line1 = el("p", "", box);
  const names = entries.map((e) => e.author_name).filter(Boolean);
  line1.textContent =
    names.length > 0
      ? `Signed with love by ${formatNames(names)}.`
      : "Signed with love.";
  const line2 = el("p", "", box);
  line2.textContent = "Made together, just for you.";
  return face;
}

function formatNames(names) {
  const unique = [...new Set(names)];
  if (unique.length === 1) return unique[0];
  if (unique.length === 2) return `${unique[0]} and ${unique[1]}`;
  return `${unique.slice(0, -1).join(", ")}, and ${unique[unique.length - 1]}`;
}

function buildBook() {
  const pages = entriesByPage();
  faces = [buildCoverFace()];
  pages.forEach((slots, i) => faces.push(buildPageFace(slots, i + 1, pages.length)));
  // colophon must land on the back of the last sheet (even total face count)
  if ((faces.length + 1) % 2 !== 0) faces.push(buildBlankFace());
  faces.push(buildColophonFace());

  bookEl.replaceChildren();
  sheets = [];
  for (let i = 0; i < faces.length; i += 2) {
    const sheet = el("div", "sheet", bookEl);
    faces[i].classList.add("front");
    sheet.appendChild(faces[i]);
    faces[i + 1].classList.add("back");
    sheet.appendChild(faces[i + 1]);
    sheets.push(sheet);
  }
  // rebuilds happen after adding/removing — stay near where the reader was
  pos = Math.min(pos, isMobile() ? faces.length - 1 : sheets.length);
  render();
}

// ------------------------------------------------------------ rendering

function isMobile() {
  return mobileQuery.matches;
}

function render() {
  if (isMobile()) renderMobile();
  else renderDesktop();
}

function renderDesktop() {
  // pos = number of flipped sheets, 0..sheets.length
  sheets.forEach((sheet, i) => {
    sheet.classList.toggle("flipped", i < pos);
    sheet.style.zIndex = i < pos ? i + 1 : sheets.length - i;
  });
  faces.forEach((f) => f.classList.remove("mobile-current", "mobile-passed"));
  prevBtn.disabled = pos === 0;
  nextBtn.disabled = pos === sheets.length;
  if (pos === 0) pageIndicator.textContent = "Cover";
  else if (pos === sheets.length) pageIndicator.textContent = "The end \u2665";
  else pageIndicator.textContent = `Spread ${pos} of ${sheets.length - 1}`;
}

function renderMobile() {
  // pos = face index, 0..faces.length-1
  faces.forEach((f, i) => {
    f.classList.toggle("mobile-current", i === pos);
    f.classList.toggle("mobile-passed", i < pos);
  });
  sheets.forEach((sheet) => {
    sheet.classList.remove("flipped");
    sheet.style.zIndex = "auto";
  });
  prevBtn.disabled = pos === 0;
  nextBtn.disabled = pos === faces.length - 1;
  pageIndicator.textContent = pos === 0 ? "Cover" : `Page ${pos} of ${faces.length - 1}`;
}

function go(delta) {
  const max = isMobile() ? faces.length - 1 : sheets.length;
  pos = Math.min(max, Math.max(0, pos + delta));
  render();
}

prevBtn.addEventListener("click", () => go(-1));
nextBtn.addEventListener("click", () => go(1));

document.addEventListener("keydown", (e) => {
  // Don't hijack arrow keys while typing or while the composer is open.
  if (e.target.closest("input, textarea")) return;
  if (!composerModal.classList.contains("hidden")) return;
  if (e.key === "ArrowRight") go(1);
  if (e.key === "ArrowLeft") go(-1);
});

// swipe (mobile) / drag (desktop)
let touchStartX = null;
bookEl.addEventListener("pointerdown", (e) => {
  touchStartX = e.clientX;
});
bookEl.addEventListener("pointerup", (e) => {
  if (touchStartX === null) return;
  const dx = e.clientX - touchStartX;
  touchStartX = null;
  if (Math.abs(dx) > 40) go(dx < 0 ? 1 : -1);
});

mobileQuery.addEventListener("change", () => {
  // Keep roughly the same place when the layout mode changes.
  pos = isMobile() ? Math.min(pos * 2, faces.length - 1) : Math.floor(pos / 2);
  render();
});

document.getElementById("print-btn").addEventListener("click", () => window.print());

// ---- foldable booklet printing ----

const bookletModal = document.getElementById("booklet-modal");
document.getElementById("booklet-btn").addEventListener("click", () => {
  bookletModal.classList.remove("hidden");
});
document.getElementById("booklet-cancel").addEventListener("click", () => {
  bookletModal.classList.add("hidden");
});
document.getElementById("booklet-print").addEventListener("click", () => {
  bookletModal.classList.add("hidden");
  printBooklet();
});

// Clone the book's faces (reading order, padded to a multiple of 4 with
// blank faces just before the colophon so it stays the back cover) into a
// hidden container in imposed order, print landscape, then clean up.
function printBooklet() {
  const order = faces.slice();
  const pad = (4 - (order.length % 4)) % 4;
  for (let i = 0; i < pad; i++) {
    order.splice(order.length - 1, 0, el("div", "face blank-face"));
  }

  const container = el("div", "", document.body);
  container.id = "booklet-pages";
  for (const sheet of bookletSheets(order.length)) {
    addBookletSheet(container, order, sheet.front);
    addBookletSheet(container, order, sheet.back);
  }

  const pageStyle = document.createElement("style");
  pageStyle.textContent = "@page { size: landscape; margin: 0.4cm; }";
  document.head.appendChild(pageStyle);
  document.body.classList.add("booklet-mode");

  window.addEventListener(
    "afterprint",
    () => {
      container.remove();
      pageStyle.remove();
      document.body.classList.remove("booklet-mode");
    },
    { once: true }
  );
  window.print();
}

function addBookletSheet(container, order, pair) {
  const sheet = el("div", "booklet-sheet", container);
  for (const faceNo of pair) {
    const cell = el("div", "booklet-face", sheet);
    const clone = order[faceNo - 1].cloneNode(true);
    // Faces keep ALL physical pages in a booklet (even screen-blank ones),
    // and screen/positioning classes don't apply inside the sheet.
    clone.classList.remove("front", "back", "mobile-current", "mobile-passed", "print-skip");
    cell.appendChild(clone);
  }
}

async function refreshEntries() {
  try {
    const data = await api(`/${encodeURIComponent(cardId)}/entries`, { token });
    entries = data.entries || [];
  } catch {
    // keep whatever we had
  }
  buildBook();
  if (card.role === "admin") renderAdminEntries();
}

// ------------------------------------------------------------- composer

const composerHeading = document.getElementById("composer-heading");
const composerName = document.getElementById("composer-name");
const composerMessage = document.getElementById("composer-message");
const composerError = document.getElementById("composer-error");
const composerSave = document.getElementById("composer-save");
const fontRow = document.getElementById("font-row");
const colorRow = document.getElementById("color-row");
const textPreview = document.getElementById("text-preview");
const tabsWrap = document.getElementById("composer-tabs");
const panes = {
  text: document.getElementById("pane-text"),
  photo: document.getElementById("pane-photo"),
  gif: document.getElementById("pane-gif"),
  doodle: document.getElementById("pane-doodle"),
};

// Composer state survives close/reopen, so a 409 ("someone took that
// spot") never loses anyone's work; it resets only after a successful save.
const cState = {
  kind: "text",
  font: FONTS[0].id,
  color: COLORS[0].id,
  media_data: null, // photo pane
  gif_url: null,
  size: 1, // 1|2|4 — media kinds only; re-derived per open
};
let composer = null; // { page, slot, editEntry, editToken } while open

function showComposerError(msg) {
  composerError.textContent = msg;
  composerError.classList.toggle("hidden", !msg);
}

function setKind(kind) {
  cState.kind = kind;
  tabsWrap.querySelectorAll(".chip").forEach((c) => c.classList.toggle("active", c.dataset.kind === kind));
  for (const [k, pane] of Object.entries(panes)) pane.classList.toggle("hidden", k !== kind);
  sizeField.classList.toggle("hidden", !(kind === "photo" || kind === "gif" || kind === "doodle"));
  if (kind === "doodle") repaintDoodle();
  if (kind === "text") renderTextPreview();
  if (kind === "gif" && gifSearchAvailable && !gifSearchedOnce) {
    gifSearchedOnce = true;
    searchGifs("congratulations");
  }
}

tabsWrap.querySelectorAll(".chip").forEach((chip) => {
  chip.addEventListener("click", () => setKind(chip.dataset.kind));
});

const sizeField = document.getElementById("size-field");
const sizeRow = document.getElementById("size-row");

function syncSizeUI() {
  sizeRow.querySelectorAll(".chip").forEach((c) => {
    c.classList.toggle("active", Number(c.dataset.size) === cState.size);
  });
}

sizeRow.querySelectorAll(".chip").forEach((chip) => {
  chip.addEventListener("click", () => {
    if (chip.disabled) return;
    cState.size = Number(chip.dataset.size);
    syncSizeUI();
  });
});

function openComposer({ page, slot, editEntry = null, editToken = null }) {
  composer = { page, slot, editEntry, editToken };
  showComposerError("");
  if (!composerName.value) composerName.value = getMyName();
  tabsWrap.classList.toggle("hidden", !!editEntry); // kind is immutable on edit

  // Size availability for this spot (or this entry's own slot when editing).
  const opts = sizeOptionsFor(page, slot, editEntry);
  composer.sizeAnchors = opts;
  cState.size = editEntry ? editEntry.size ?? 1 : 1;
  if (opts[cState.size] == null) cState.size = 1; // anchors can be 0 — never truthiness-check them
  sizeRow.querySelectorAll(".chip").forEach((c) => {
    const s = Number(c.dataset.size);
    c.disabled = opts[s] == null;
    c.title = opts[s] == null ? "Not enough room on this page" : "";
  });
  syncSizeUI();

  if (editEntry) {
    composerHeading.textContent = "Edit yours";
    composerSave.textContent = "Save changes";
    composerName.value = editEntry.author_name || composerName.value;
    if (editEntry.kind === "text") {
      composerMessage.value = editEntry.message || "";
      if (FONTS.some((f) => f.id === editEntry.font)) cState.font = editEntry.font;
      if (COLORS.some((c) => c.id === editEntry.color)) cState.color = editEntry.color;
      syncFontColorUI();
    } else if (editEntry.kind === "photo") {
      setPhoto(editEntry.media_data || null);
    } else if (editEntry.kind === "gif") {
      setGif(editEntry.gif_url || null);
    } else if (editEntry.kind === "doodle") {
      strokes = []; // fresh canvas; saving without drawing keeps the old doodle
    }
    setKind(editEntry.kind);
  } else {
    composerHeading.textContent = `Add to page ${page + 1}`;
    composerSave.textContent = "Put it on the page";
    setKind(cState.kind);
  }
  composerModal.classList.remove("hidden");
}

function closeComposer() {
  composerModal.classList.add("hidden");
  composer = null;
}
document.getElementById("composer-cancel").addEventListener("click", closeComposer);

function resetComposer() {
  composerMessage.value = "";
  setPhoto(null);
  setGif(null);
  strokes = [];
  cState.kind = "text";
  cState.size = 1;
}

// ---- Text pane ----

function buildFontChips() {
  for (const font of FONTS) {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = `chip font-chip-${font.id}` + (cState.font === font.id ? " active" : "");
    chip.textContent = font.label;
    chip.addEventListener("click", () => {
      cState.font = font.id;
      syncFontColorUI();
      renderTextPreview();
    });
    fontRow.appendChild(chip);
  }
}

function buildColorSwatches() {
  for (const color of COLORS) {
    const sw = document.createElement("button");
    sw.type = "button";
    sw.className = "swatch" + (cState.color === color.id ? " active" : "");
    sw.style.background = color.hex;
    sw.setAttribute("aria-label", `${color.label} ink`);
    sw.addEventListener("click", () => {
      cState.color = color.id;
      syncFontColorUI();
      renderTextPreview();
    });
    colorRow.appendChild(sw);
  }
}

function syncFontColorUI() {
  fontRow.querySelectorAll(".chip").forEach((c, i) => c.classList.toggle("active", FONTS[i].id === cState.font));
  colorRow.querySelectorAll(".swatch").forEach((s, i) => s.classList.toggle("active", COLORS[i].id === cState.color));
}

function renderTextPreview() {
  textPreview.replaceChildren(
    renderEntryTile({
      id: "preview",
      author_name: composerName.value.trim() || "Your name",
      message: composerMessage.value || "Your message will appear here as you type\u2026",
      font: cState.font,
      color: cState.color,
    })
  );
}

// Photo/GIF previews go through the same renderer as the book, so the
// composer shows exactly the tile that will land on the page.
function renderMediaPreviews() {
  const author_name = composerName.value.trim() || "Your name";
  photoPreviewTile.replaceChildren();
  gifPreviewTile.replaceChildren();
  if (cState.media_data) {
    photoPreviewTile.appendChild(
      renderEntryTile({ media_type: "photo", media_data: cState.media_data, author_name })
    );
  }
  if (cState.gif_url) {
    gifPreviewTile.appendChild(
      renderEntryTile({ media_type: "gif", gif_url: cState.gif_url, author_name })
    );
  }
}

composerName.addEventListener("input", () => {
  renderTextPreview();
  renderMediaPreviews();
});
composerMessage.addEventListener("input", renderTextPreview);

// ---- Photo pane ----

const photoInput = document.getElementById("photo-input");
const photoPick = document.getElementById("photo-pick");
const photoPreview = document.getElementById("photo-preview");
const photoPreviewTile = document.getElementById("photo-preview-tile");

function setPhoto(dataUrl) {
  if (dataUrl && !/^data:image\/(jpeg|png|webp);base64,/.test(dataUrl)) dataUrl = null;
  cState.media_data = dataUrl;
  photoPreview.classList.toggle("hidden", !dataUrl);
  renderMediaPreviews();
}

photoPick.addEventListener("click", () => photoInput.click());
photoInput.addEventListener("change", async () => {
  const file = photoInput.files && photoInput.files[0];
  if (!file) return;
  showComposerError("");
  photoPick.textContent = "Shrinking\u2026";
  try {
    setPhoto(await resizeImage(file));
  } catch (err) {
    showComposerError(err.message || "Couldn't read that photo — try another one.");
  }
  photoPick.textContent = "Choose a photo";
  photoInput.value = "";
});
document.getElementById("photo-remove").addEventListener("click", () => setPhoto(null));

// ---- GIF pane: Giphy search with paste-a-link fallback ----

const gifQuery = document.getElementById("gif-query");
const gifSearchBtn = document.getElementById("gif-search-btn");
const gifGrid = document.getElementById("gif-grid");
const gifUrlInput = document.getElementById("gif-url-input");
const gifPreview = document.getElementById("gif-preview");
const gifPreviewTile = document.getElementById("gif-preview-tile");
let gifSearchAvailable = true;
let gifSearchedOnce = false;

function setGif(url) {
  cState.gif_url = url;
  gifPreview.classList.toggle("hidden", !url);
  renderMediaPreviews();
}
document.getElementById("gif-remove").addEventListener("click", () => setGif(null));

gifSearchBtn.addEventListener("click", () => searchGifs(gifQuery.value.trim()));
gifQuery.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    searchGifs(gifQuery.value.trim());
  }
});

async function searchGifs(q) {
  if (!q) return;
  gifGrid.replaceChildren();
  const status = document.createElement("p");
  status.className = "hint";
  status.textContent = "Searching\u2026";
  gifGrid.appendChild(status);
  try {
    const data = await api(`/giphy?q=${encodeURIComponent(q)}`);
    gifGrid.replaceChildren();
    for (const gif of data.results || []) {
      if (typeof gif.url !== "string" || !gif.url.startsWith("https://")) continue;
      const btn = document.createElement("button");
      btn.type = "button";
      const img = document.createElement("img");
      img.loading = "lazy";
      img.alt = gif.description || "GIF";
      img.src = gif.preview && gif.preview.startsWith("https://") ? gif.preview : gif.url;
      btn.appendChild(img);
      btn.addEventListener("click", () => {
        gifGrid.querySelectorAll("button").forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        setGif(gif.url);
      });
      gifGrid.appendChild(btn);
    }
    if (!gifGrid.childElementCount) {
      status.textContent = "No GIFs found — try another word?";
      gifGrid.appendChild(status);
    }
  } catch (err) {
    gifSearchAvailable = err.status !== 501;
    gifGrid.replaceChildren();
    const note = document.createElement("p");
    note.className = "hint";
    note.textContent =
      err.status === 501
        ? "GIF search isn't set up here — paste a GIF link below instead."
        : "GIF search hiccuped — try again, or paste a GIF link below.";
    gifGrid.appendChild(note);
  }
}

gifUrlInput.addEventListener("change", () => {
  const raw = gifUrlInput.value.trim();
  if (!raw) return;
  let url;
  try {
    url = new URL(raw);
  } catch {
    showComposerError("That doesn't look like a link — copy the GIF's address and paste the whole thing.");
    return;
  }
  const host = url.hostname.toLowerCase();
  const allowed =
    url.protocol === "https:" &&
    (host === "tenor.com" || host.endsWith(".tenor.com") || host.endsWith(".giphy.com"));
  if (!allowed) {
    showComposerError("GIF links need to come from Giphy or Tenor (https). Right-click a GIF and choose \u201CCopy image address\u201D.");
    return;
  }
  showComposerError("");
  setGif(url.href);
});

// ---- Doodle pane ----

const canvas = document.getElementById("doodle-canvas");
const ctx = canvas.getContext("2d");
let strokes = []; // each: {color, width, points: [{x,y}...]}
let currentStroke = null;
let doodleColor = COLORS[0].hex;
let doodleWidth = 3;

function repaintDoodle() {
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (const s of strokes.concat(currentStroke ? [currentStroke] : [])) {
    ctx.strokeStyle = s.color;
    ctx.lineWidth = s.width;
    ctx.beginPath();
    s.points.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
    if (s.points.length === 1) ctx.lineTo(s.points[0].x + 0.1, s.points[0].y + 0.1);
    ctx.stroke();
  }
}

function canvasPoint(e) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: ((e.clientX - rect.left) / rect.width) * canvas.width,
    y: ((e.clientY - rect.top) / rect.height) * canvas.height,
  };
}

canvas.addEventListener("pointerdown", (e) => {
  e.preventDefault();
  canvas.setPointerCapture(e.pointerId);
  currentStroke = { color: doodleColor, width: doodleWidth, points: [canvasPoint(e)] };
  repaintDoodle();
});
canvas.addEventListener("pointermove", (e) => {
  if (!currentStroke) return;
  currentStroke.points.push(canvasPoint(e));
  repaintDoodle();
});
canvas.addEventListener("pointerup", () => {
  if (currentStroke) strokes.push(currentStroke);
  currentStroke = null;
});

const doodleColors = document.getElementById("doodle-colors");
for (const color of COLORS) {
  const sw = document.createElement("button");
  sw.type = "button";
  sw.className = "swatch" + (color.hex === doodleColor ? " active" : "");
  sw.style.background = color.hex;
  sw.setAttribute("aria-label", `${color.label} pen`);
  sw.addEventListener("click", () => {
    doodleColor = color.hex;
    doodleColors.querySelectorAll(".swatch").forEach((s) => s.classList.remove("active"));
    sw.classList.add("active");
  });
  doodleColors.appendChild(sw);
}

const strokeThin = document.getElementById("stroke-thin");
const strokeThick = document.getElementById("stroke-thick");
strokeThin.classList.add("active");
strokeThin.addEventListener("click", () => {
  doodleWidth = 3;
  strokeThin.classList.add("active");
  strokeThick.classList.remove("active");
});
strokeThick.addEventListener("click", () => {
  doodleWidth = 9;
  strokeThick.classList.add("active");
  strokeThin.classList.remove("active");
});

document.getElementById("doodle-undo").addEventListener("click", () => {
  strokes.pop();
  repaintDoodle();
});
document.getElementById("doodle-clear").addEventListener("click", () => {
  strokes = [];
  repaintDoodle();
});

// ---- Save ----

composerSave.addEventListener("click", async () => {
  if (!composer) return;
  showComposerError("");
  const name = composerName.value.trim();
  if (!name) {
    showComposerError("Add your name so they know who this is from.");
    composerName.focus();
    return;
  }

  const kind = composer.editEntry ? composer.editEntry.kind : cState.kind;
  const body = {
    author_name: name,
    kind,
    page: composer.page,
    slot: composer.slot,
    message: "",
    font: cState.font,
    color: cState.color,
    media_data: null,
    gif_url: null,
  };

  if (kind === "photo" || kind === "gif" || kind === "doodle") {
    body.size = cState.size;
    // Placing bigger items anchors them: half → its row start, full → slot 0.
    if (!composer.editEntry && composer.sizeAnchors)
      body.slot = composer.sizeAnchors[cState.size] ?? composer.slot;
  }

  if (kind === "text") {
    body.message = composerMessage.value.trim();
    if (!body.message) {
      showComposerError("Write a little something first.");
      composerMessage.focus();
      return;
    }
  } else if (kind === "photo") {
    if (!cState.media_data) {
      showComposerError("Choose a photo first.");
      photoPick.focus();
      return;
    }
    body.media_data = cState.media_data;
  } else if (kind === "doodle") {
    if (strokes.length) {
      repaintDoodle();
      body.media_data = canvas.toDataURL("image/png");
    } else {
      // editing without drawing keeps the old doodle
      body.media_data = (composer.editEntry && composer.editEntry.media_data) || null;
    }
    if (!body.media_data) {
      showComposerError("Draw something first.");
      return;
    }
  } else if (kind === "gif") {
    if (!cState.gif_url) {
      showComposerError("Pick a GIF or paste a link first.");
      return;
    }
    body.gif_url = cState.gif_url;
  }

  composerSave.disabled = true;
  composerSave.textContent = "Saving\u2026";
  try {
    if (composer.editEntry) {
      await api(`/${encodeURIComponent(cardId)}/entries/${encodeURIComponent(composer.editEntry.id)}`, {
        method: "PUT",
        body: { ...body, edit_token: composer.editToken },
      });
    } else {
      const res = await api(`/${encodeURIComponent(cardId)}/entries`, { method: "POST", body, token });
      addMyEdit(cardId, { entryId: res.id, editToken: res.edit_token });
      myEdits = getMyEdits(cardId);
    }
    saveMyName(name);
    resetComposer();
    closeComposer();
    await refreshEntries();
  } catch (err) {
    if (err.status === 409) {
      showComposerError("Someone just took that spot! Close this and tap another spot — everything you made is kept.");
      refreshEntries(); // the book behind the modal catches up
    } else {
      showComposerError(err.message || "Something went wrong — try again.");
    }
  }
  composerSave.disabled = false;
  composerSave.textContent = composer && composer.editEntry ? "Save changes" : "Put it on the page";
});

// ---------------------------------------------------------------- admin

function setupAdmin() {
  const adminBar = document.getElementById("admin-bar");
  const adminPanel = document.getElementById("admin-panel");
  const adminError = document.getElementById("admin-error");
  adminBar.classList.remove("hidden");

  document.getElementById("admin-toggle").addEventListener("click", () => {
    adminPanel.classList.toggle("hidden");
  });

  const titleInput = document.getElementById("admin-title");
  const recipientInput = document.getElementById("admin-recipient");
  titleInput.value = card.title;
  recipientInput.value = card.recipient_name;

  // Strip the last path segment; extensionless links (Pages pretty URLs).
  // The share link carries the sign_token so it keeps working when private.
  const base = location.origin + location.pathname.replace(/[^/]*$/, "");
  const links = {
    share: `${base}view?c=${card.id}&t=${card.sign_token}`,
    admin: `${base}view?c=${card.id}&t=${card.admin_token}`,
  };
  document.getElementById("admin-share-url").textContent = links.share;
  document.getElementById("admin-admin-url").textContent = links.admin;
  wireCopyButton(document.getElementById("admin-copy-share"), links.share);
  wireCopyButton(document.getElementById("admin-copy-admin"), links.admin);

  document.getElementById("admin-save").addEventListener("click", async () => {
    adminError.classList.add("hidden");
    try {
      await api(`/${encodeURIComponent(cardId)}`, {
        method: "PATCH",
        token,
        body: { title: titleInput.value.trim(), recipient_name: recipientInput.value.trim() },
      });
      card.title = titleInput.value.trim();
      card.recipient_name = recipientInput.value.trim();
      buildBook();
    } catch (err) {
      adminError.textContent = err.message || "Couldn't save — try again.";
      adminError.classList.remove("hidden");
    }
  });

  const privateInput = document.getElementById("admin-private");
  privateInput.checked = !!card.is_private;
  privateInput.addEventListener("change", async () => {
    adminError.classList.add("hidden");
    const want = privateInput.checked ? 1 : 0;
    try {
      await api(`/${encodeURIComponent(cardId)}`, {
        method: "PATCH",
        token,
        body: { is_private: want },
      });
      card.is_private = want;
    } catch (err) {
      privateInput.checked = !!card.is_private; // revert
      adminError.textContent = err.message || "Couldn't change privacy — try again.";
      adminError.classList.remove("hidden");
    }
  });

  renderAdminEntries();

  document.getElementById("admin-delete-card").addEventListener("click", async () => {
    if (!confirm("Delete this card and everything on it? This can't be undone.")) return;
    if (!confirm("Really sure? Its links will stop working immediately.")) return;
    try {
      await api(`/${encodeURIComponent(cardId)}`, { method: "DELETE", token });
      document.body.innerHTML = "";
      const msg = document.createElement("p");
      msg.style.cssText = "text-align:center;padding:80px 20px;font-family:sans-serif;";
      msg.textContent = "The card has been deleted.";
      document.body.appendChild(msg);
    } catch (err) {
      alert(err.message || "Couldn't delete the card.");
    }
  });
}

function renderAdminEntries() {
  const wrap = document.getElementById("admin-entries");
  wrap.replaceChildren();
  if (!entries.length) {
    const p = document.createElement("p");
    p.className = "hint";
    p.textContent = "Nothing on the card yet.";
    wrap.appendChild(p);
    return;
  }
  for (const entry of entries) {
    const row = document.createElement("div");
    row.className = "admin-entry-row";
    const who = document.createElement("span");
    who.className = "who";
    who.textContent = entry.author_name;
    const what = document.createElement("span");
    what.className = "what";
    what.textContent =
      `[${entry.kind || "note"} \u00B7 p${(entry.page ?? 0) + 1}] ` + (entry.message || "");
    const del = document.createElement("button");
    del.className = "btn btn-danger btn-small";
    del.textContent = "Remove";
    del.addEventListener("click", async () => {
      if (!confirm(`Remove this item from ${entry.author_name}?`)) return;
      try {
        await api(`/${encodeURIComponent(cardId)}/entries/${encodeURIComponent(entry.id)}`, {
          method: "DELETE",
          token,
        });
        entries = entries.filter((e) => e.id !== entry.id);
        renderAdminEntries();
        buildBook();
      } catch (err) {
        alert(err.message || "Couldn't remove that.");
      }
    });
    row.append(who, what, del);
    wrap.appendChild(row);
  }
}

// ----------------------------------------------------------------- boot

async function boot() {
  if (!cardId) {
    showPageError("This card link is incomplete — ask whoever sent it to copy it again.");
    return;
  }
  try {
    card = await api(`/${encodeURIComponent(cardId)}`, { token });
  } catch (err) {
    showPageError(
      err.status === 404
        ? "This card doesn't exist any more."
        : err.status === 403
          ? "This card is private — you need its link to open it."
          : "Couldn't open this card — try refreshing in a moment."
    );
    return;
  }

  document.title = card.title;

  try {
    const data = await api(`/${encodeURIComponent(cardId)}/entries`, { token });
    entries = data.entries || [];
  } catch {
    entries = [];
  }

  buildFontChips();
  buildColorSwatches();
  composerName.value = getMyName();

  if (card.role === "admin") setupAdmin();

  buildBook();
  bookStage.classList.remove("hidden");
}

boot();
