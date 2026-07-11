import {
  json,
  optionsResponse,
  getCardAndRole,
  randomId,
  randomToken,
  cleanText,
  isValidImageData,
  isAllowedGifUrl,
  FONTS,
  COLORS,
  LIMITS,
} from "../lib/util.js";

export const KINDS = ["text", "photo", "gif", "doodle"];

// Slots an entry covers: legacy V1 notes (kind NULL) span their half of
// the page; sized media span their row (2) or the whole page (4).
export function footprint(slot, kind, size) {
  if (kind == null) return [slot, slot + 1];
  if (size === 4) return [0, 1, 2, 3];
  if (size === 2) return [slot, slot + 1];
  return [slot];
}

// GET /api/card/:id/entries?t=TOKEN — list entries (share/admin).
// edit_token is never included, so readers can't modify other people's items.
export async function onRequestGet(context) {
  const { card, role } = await getCardAndRole(context.env, context.params.id, context.request);
  if (!card) return json({ error: "Card not found" }, 404);
  if (!role) return json({ error: "This card is private — you need its link" }, 403);

  const { results } = await context.env.DB.prepare(
    `SELECT id, author_name, message, font, color, media_type, media_data, gif_url,
            kind, page, slot, size, position, created_at
     FROM card_entries WHERE card_id = ? ORDER BY page, slot, position, created_at`
  )
    .bind(card.id)
    .all();

  return json({ entries: results });
}

// POST /api/card/:id/entries?t=TOKEN — put an item in a spot (share/admin).
// Body: { author_name, kind, page, slot, ...kind-specific fields }.
// Returns { id, edit_token }; the edit_token is only ever returned here.
export async function onRequestPost(context) {
  const { card, role } = await getCardAndRole(context.env, context.params.id, context.request);
  if (!card) return json({ error: "Card not found" }, 404);
  if (!role) return json({ error: "This card is private — you need its link" }, 403);

  let body;
  try {
    body = await context.request.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  if (!KINDS.includes(body.kind)) return json({ error: "Unknown kind" }, 400);
  const { page, slot } = body;
  if (!Number.isInteger(page) || page < 0) return json({ error: "Bad page" }, 400);
  if (!Number.isInteger(slot) || slot < 0 || slot > 3) return json({ error: "Bad slot" }, 400);

  // Optional size: 1 quarter (default), 2 half row, 4 full page — media only.
  const size = body.size ?? 1;
  if (![1, 2, 4].includes(size)) return json({ error: "Bad size" }, 400);
  if (size > 1 && body.kind === "text")
    return json({ error: "Only photos, GIFs and doodles can be bigger" }, 400);
  if (size === 2 && slot !== 0 && slot !== 2)
    return json({ error: "A half-page item must start its row (slot 0 or 2)" }, 400);
  if (size === 4 && slot !== 0)
    return json({ error: "A full-page item must sit at slot 0" }, 400);

  const validated = validateEntryContent(body, body.kind);
  if (validated.error) return json({ error: validated.error }, validated.status);
  const e = validated.entry;

  const countRow = await context.env.DB.prepare(
    "SELECT COUNT(*) AS n FROM card_entries WHERE card_id = ?"
  )
    .bind(card.id)
    .first();
  if (countRow && countRow.n >= LIMITS.ENTRIES_PER_CARD)
    return json({ error: "This card is full (100 entries max)" }, 409);

  // Only the current pages plus the one trailing blank page are addressable.
  const maxRow = await context.env.DB.prepare(
    "SELECT COALESCE(MAX(page), -1) AS p FROM card_entries WHERE card_id = ?"
  )
    .bind(card.id)
    .first();
  if (page > maxRow.p + 1) return json({ error: "That page isn't in the book yet" }, 400);

  // Slot occupancy by footprint: legacy V1 notes (kind NULL) span their
  // half of the page; sized media span their row or the whole page.
  const { results: pageEntries } = await context.env.DB.prepare(
    "SELECT slot, kind, size FROM card_entries WHERE card_id = ? AND page = ?"
  )
    .bind(card.id, page)
    .all();
  const occupied = new Set();
  for (const pe of pageEntries)
    for (const s of footprint(pe.slot, pe.kind, pe.size)) occupied.add(s);
  for (const s of footprint(slot, body.kind, size))
    if (occupied.has(s)) return json({ error: "slot_taken" }, 409);

  const id = randomId();
  const editToken = randomToken();

  try {
    await context.env.DB.prepare(
      `INSERT INTO card_entries
         (id, card_id, author_name, message, font, color, media_type, media_data, gif_url,
          edit_token, position, kind, page, slot, size, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        id,
        card.id,
        e.author_name,
        e.message,
        e.font,
        e.color,
        e.media_type,
        e.media_data,
        e.gif_url,
        editToken,
        0,
        body.kind,
        page,
        slot,
        size === 1 ? null : size,
        Date.now()
      )
      .run();
  } catch (err) {
    // Unique index (card_id, page, slot) is the race backstop.
    if (String(err && err.message).includes("UNIQUE")) return json({ error: "slot_taken" }, 409);
    throw err;
  }

  return json({ id, edit_token: editToken }, 201);
}

// Validate content for a given kind (create and update share this).
// kind == null means a legacy V1 bundled note (message and/or one media),
// which can still be edited by its author.
// Returns { entry } or { error, status }.
export function validateEntryContent(body, kind) {
  const authorName = cleanText(body.author_name, LIMITS.NAME);
  if (!authorName) return { error: "Your name is required (max 120 chars)", status: 400 };

  const entry = {
    author_name: authorName,
    message: "",
    font: FONTS[0],
    color: COLORS[0],
    media_type: null,
    media_data: null,
    gif_url: null,
  };

  // Text styling applies to text items and legacy notes.
  if (kind === "text" || kind == null) {
    if (typeof body.message === "string" && body.message.length > LIMITS.MESSAGE)
      return { error: "Message too long (max 5000 chars)", status: 400 };
    entry.message = typeof body.message === "string" ? body.message.trim() : "";
    const font = body.font ?? FONTS[0];
    if (!FONTS.includes(font)) return { error: "Unknown font", status: 400 };
    const color = body.color ?? COLORS[0];
    if (!COLORS.includes(color)) return { error: "Unknown ink color", status: 400 };
    entry.font = font;
    entry.color = color;
  }

  if (kind === "text") {
    if (!entry.message) return { error: "Write a message", status: 400 };
  } else if (kind === "photo" || kind === "doodle") {
    if (typeof body.media_data === "string" && body.media_data.length > LIMITS.IMAGE_CHARS)
      return { error: "Image too large", status: 413 };
    if (!isValidImageData(body.media_data))
      return { error: "Image must be a jpeg/png/webp data URL", status: 400 };
    entry.media_data = body.media_data;
    entry.media_type = kind;
  } else if (kind === "gif") {
    if (!isAllowedGifUrl(body.gif_url))
      return { error: "GIF must be an https URL from Tenor or Giphy", status: 400 };
    entry.gif_url = body.gif_url;
    entry.media_type = "gif";
  } else if (kind == null) {
    // Legacy V1 bundle rules.
    const mediaType = body.media_type ?? null;
    if (mediaType === "photo" || mediaType === "doodle") {
      if (typeof body.media_data === "string" && body.media_data.length > LIMITS.IMAGE_CHARS)
        return { error: "Image too large", status: 413 };
      if (!isValidImageData(body.media_data))
        return { error: "Image must be a jpeg/png/webp data URL", status: 400 };
      entry.media_data = body.media_data;
      entry.media_type = mediaType;
    } else if (mediaType === "gif") {
      if (!isAllowedGifUrl(body.gif_url))
        return { error: "GIF must be an https URL from Tenor or Giphy", status: 400 };
      entry.gif_url = body.gif_url;
      entry.media_type = "gif";
    } else if (mediaType != null) {
      return { error: "Unknown media type", status: 400 };
    }
    if (!entry.message && !entry.media_type)
      return { error: "Add a message, photo, GIF, or doodle", status: 400 };
  }

  return { entry };
}

export async function onRequestOptions() {
  return optionsResponse();
}
