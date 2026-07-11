// Shared helpers for the group card app.
// SECURITY: user-provided text must only ever reach the DOM via textContent,
// and user-provided images only via img.src. Never innerHTML.

export const FONTS = [
  { id: "caveat", label: "Caveat", css: "'Caveat', cursive" },
  { id: "shadows", label: "Shadows Into Light", css: "'Shadows Into Light', cursive" },
  { id: "homemade", label: "Homemade Apple", css: "'Homemade Apple', cursive" },
  { id: "kalam", label: "Kalam", css: "'Kalam', cursive" },
];

export const COLORS = [
  { id: "ink", label: "Ink", hex: "#3a3226" },
  { id: "sea", label: "Sea", hex: "#1e6a7a" },
  { id: "plum", label: "Plum", hex: "#7a3b78" },
  { id: "forest", label: "Forest", hex: "#3d6b35" },
  { id: "brick", label: "Brick", hex: "#a84a32" },
];

const FONT_IDS = new Set(FONTS.map((f) => f.id));
const COLOR_IDS = new Set(COLORS.map((c) => c.id));

// ---------------------------------------------------------------- API

export async function api(path, { method = "GET", body, token } = {}) {
  const url = new URL("/api/card" + path, location.origin);
  if (token) url.searchParams.set("t", token);
  const res = await fetch(url, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try {
    data = await res.json();
  } catch {
    // non-JSON error page
  }
  if (!res.ok) {
    const message = (data && data.error) || `Request failed (${res.status})`;
    const err = new Error(message);
    err.status = res.status;
    throw err;
  }
  return data;
}

export function qs(name) {
  return new URLSearchParams(location.search).get(name) || "";
}

// ------------------------------------------------------------- rendering

function el(tag, className, parent) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (parent) parent.appendChild(node);
  return node;
}

// Render one contributor entry as a tile that fills its spot edge-to-edge.
// Used identically by the flip book, print, and the composer preview, so
// what contributors see is what the recipient gets.
// SECURITY: name/message via textContent only; images via img.src after
// the data-URL regex or an https check.
export function renderEntryTile(entry) {
  if (entry.media_type === "gif" && entry.gif_url) {
    try {
      const u = new URL(entry.gif_url);
      if (u.protocol === "https:") return mediaTile(u.href, "GIF", false, entry);
    } catch {
      // invalid URL — fall through to the text tile
    }
  } else if (
    (entry.media_type === "photo" || entry.media_type === "doodle") &&
    entry.media_data &&
    /^data:image\/(jpeg|png|webp);base64,/.test(entry.media_data)
  ) {
    return mediaTile(
      entry.media_data,
      entry.media_type === "doodle" ? "Doodle" : "Photo",
      entry.media_type === "doodle",
      entry
    );
  }

  // Flat handwritten tile: text notes and legacy kind-NULL notes.
  const font = FONT_IDS.has(entry.font) ? entry.font : "caveat";
  const color = COLOR_IDS.has(entry.color) ? entry.color : "ink";
  const tile = el("article", `entry-note font-${font} ink-${color}`);
  const msg = el("div", "note-message", tile);
  msg.textContent = entry.message || "";
  const author = el("div", "note-author", tile);
  author.textContent = entry.author_name ? `— ${entry.author_name}` : "";
  return tile;
}

function mediaTile(src, alt, isDoodle, entry) {
  const fig = el("figure", "entry-media" + (isDoodle ? " entry-doodle" : ""));
  const img = el("img", "", fig);
  img.loading = "lazy";
  img.alt = alt;
  img.src = src;
  const scrim = el("figcaption", "media-scrim", fig);
  if (entry.message) {
    const msg = el("div", "media-msg", scrim);
    msg.textContent = entry.message;
  }
  const name = el("div", "media-name", scrim);
  name.textContent = entry.author_name ? `— ${entry.author_name}` : "";
  return fig;
}

// -------------------------------------------------------- booklet order

// Foldable-booklet imposition. Faces are numbered 1..n in reading order
// (n must be a multiple of 4). Sheet k (0-based) prints faces
// [n-2k, 1+2k] on its front and [2+2k, n-1-2k] on its back. Print
// double-sided flipped on the short edge, fold the stack in half, and
// the faces come out in reading order.
export function bookletSheets(n) {
  if (!Number.isInteger(n) || n <= 0 || n % 4 !== 0) {
    throw new Error("face count must be a positive multiple of 4");
  }
  const sheets = [];
  for (let k = 0; k < n / 4; k++) {
    sheets.push({ front: [n - 2 * k, 1 + 2 * k], back: [2 + 2 * k, n - 1 - 2 * k] });
  }
  return sheets;
}

// ------------------------------------------------------------ image resize

// Resize an image file to a compact data URL.
// EXIF-aware via createImageBitmap where supported; falls back to <img>.
// Pass {maxDim: 320, quality: 0.7, maxChars: 80_000} for gallery thumbnails.
export async function resizeImage(file, { maxDim = 1280, quality = 0.82, maxChars = 900_000 } = {}) {
  const source = await loadImageSource(file);
  let dataUrl = await drawToDataUrl(source, maxDim, quality);
  if (dataUrl.length > maxChars) {
    dataUrl = await drawToDataUrl(source, Math.round(maxDim * 0.8), 0.7);
  }
  if (source.close) source.close();
  if (dataUrl.length > maxChars) {
    throw new Error("That image is too detailed to shrink down — try a smaller photo or a screenshot of it.");
  }
  return dataUrl;
}

async function loadImageSource(file) {
  if ("createImageBitmap" in window) {
    try {
      return await createImageBitmap(file, { imageOrientation: "from-image" });
    } catch {
      // fall through to <img> path (e.g. unsupported format options)
    }
  }
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("That file doesn't look like an image we can read."));
    };
    img.src = url;
  });
}

function drawToDataUrl(source, maxDim, quality) {
  const w = source.width || source.naturalWidth;
  const h = source.height || source.naturalHeight;
  const scale = Math.min(1, maxDim / Math.max(w, h));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(w * scale));
  canvas.height = Math.max(1, Math.round(h * scale));
  const ctx = canvas.getContext("2d");
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          // Safari fallback: jpeg via toDataURL
          resolve(canvas.toDataURL("image/jpeg", quality));
          return;
        }
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.readAsDataURL(blob);
      },
      "image/webp",
      quality
    );
  }).then((dataUrl) => {
    // Browsers without webp encoding return image/png from toBlob('image/webp');
    // detect and re-encode as jpeg, which compresses photos far better.
    if (dataUrl.startsWith("data:image/webp")) return dataUrl;
    return canvas.toDataURL("image/jpeg", quality);
  });
}

// -------------------------------------------------------------- clipboard

export function wireCopyButton(button, getText) {
  button.addEventListener("click", async () => {
    const text = typeof getText === "function" ? getText() : getText;
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
    }
    const original = button.textContent;
    button.textContent = "Copied!";
    button.classList.add("copied");
    setTimeout(() => {
      button.textContent = original;
      button.classList.remove("copied");
    }, 1600);
  });
}

// ------------------------------------------------- local edit-token store
// The entries API never returns edit_tokens, so to let people edit/remove
// their own items we keep a per-card LIST of {entryId, editToken} on this
// device. (V1 stored a single object per card — wrapped into a list on read.)

const EDITS_KEY = "card-edits";

export function getMyEdits(cardId) {
  try {
    const store = JSON.parse(localStorage.getItem(EDITS_KEY) || "{}");
    const v = store[cardId];
    if (!v) return [];
    return Array.isArray(v) ? v : [{ entryId: v.entryId, editToken: v.editToken }];
  } catch {
    return [];
  }
}

export function addMyEdit(cardId, record) {
  try {
    const store = JSON.parse(localStorage.getItem(EDITS_KEY) || "{}");
    const list = getMyEdits(cardId).filter((r) => r.entryId !== record.entryId);
    list.push({ entryId: record.entryId, editToken: record.editToken });
    store[cardId] = list;
    localStorage.setItem(EDITS_KEY, JSON.stringify(store));
  } catch {
    // private mode / quota — editing just won't persist on this device
  }
}

export function removeMyEdit(cardId, entryId) {
  try {
    const store = JSON.parse(localStorage.getItem(EDITS_KEY) || "{}");
    store[cardId] = getMyEdits(cardId).filter((r) => r.entryId !== entryId);
    localStorage.setItem(EDITS_KEY, JSON.stringify(store));
  } catch {
    // ignore
  }
}

// ------------------------------------------------------- remembered name
// "Your name" in the composer, prefilled across cards on this device.

const NAME_KEY = "cards-name";

export function getMyName() {
  try {
    return localStorage.getItem(NAME_KEY) || "";
  } catch {
    return "";
  }
}

export function saveMyName(name) {
  try {
    localStorage.setItem(NAME_KEY, name);
  } catch {
    // ignore
  }
}

// ---------------------------------------------- local created-cards store
// Cards made on this device — [{id, adminToken, title}] — so the gallery can
// show a "Your cards" section (including private ones) with admin access.

const CREATED_KEY = "cards-created";

export function getMyCards() {
  try {
    const list = JSON.parse(localStorage.getItem(CREATED_KEY) || "[]");
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

export function saveMyCard(record) {
  try {
    const list = getMyCards().filter((c) => c.id !== record.id);
    list.unshift(record);
    localStorage.setItem(CREATED_KEY, JSON.stringify(list));
  } catch {
    // private mode / quota — the gallery just won't remember this card
  }
}

export function removeMyCard(cardId) {
  try {
    localStorage.setItem(CREATED_KEY, JSON.stringify(getMyCards().filter((c) => c.id !== cardId)));
  } catch {
    // ignore
  }
}
