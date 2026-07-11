import {
  json,
  optionsResponse,
  getCardAndRole,
} from "../../lib/util.js";
import { validateEntryContent, footprint } from "../entries.js";

// Authorize an entry mutation: admin token (via ?t=) OR the entry's own
// edit_token supplied in the request body.
async function authorizeEntry(context, body) {
  const { card, role } = await getCardAndRole(context.env, context.params.id, context.request);
  if (!card) return { error: json({ error: "Card not found" }, 404) };

  const entry = await context.env.DB.prepare(
    "SELECT * FROM card_entries WHERE id = ? AND card_id = ?"
  )
    .bind(context.params.entryId, card.id)
    .first();
  if (!entry) return { error: json({ error: "Entry not found" }, 404) };

  const editToken = body && typeof body.edit_token === "string" ? body.edit_token : "";
  if (role !== "admin" && (!editToken || editToken !== entry.edit_token))
    return { error: json({ error: "Not allowed to change this entry" }, 403) };

  return { card, entry };
}

// PUT /api/card/:id/entries/:entryId — replace an entry's content.
export async function onRequestPut(context) {
  let body;
  try {
    body = await context.request.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const auth = await authorizeEntry(context, body);
  if (auth.error) return auth.error;

  // Content only — kind, page and slot are immutable (validate against the
  // entry's stored kind; legacy NULL keeps the old bundle rules).
  const validated = validateEntryContent(body, auth.entry.kind);
  if (validated.error) return json({ error: validated.error }, validated.status);
  const e = validated.entry;

  // Optional size change (media kinds only): the entry's own slot must
  // anchor the new size, and — when growing — the extra spots must be
  // free, excluding the entry itself. page/slot stay immutable.
  const oldSize = auth.entry.size ?? 1;
  const size = body.size ?? oldSize;
  if (![1, 2, 4].includes(size)) return json({ error: "Bad size" }, 400);
  const isMedia =
    auth.entry.kind === "photo" || auth.entry.kind === "gif" || auth.entry.kind === "doodle";
  if (size > 1 && !isMedia)
    return json({ error: "Only photos, GIFs and doodles can be bigger" }, 400);
  if (size === 2 && auth.entry.slot !== 0 && auth.entry.slot !== 2)
    return json({ error: "A half-page item must start its row (slot 0 or 2)" }, 400);
  if (size === 4 && auth.entry.slot !== 0)
    return json({ error: "A full-page item must sit at slot 0" }, 400);
  if (size > oldSize) {
    const { results: pageEntries } = await context.env.DB.prepare(
      "SELECT id, slot, kind, size FROM card_entries WHERE card_id = ? AND page = ?"
    )
      .bind(auth.card.id, auth.entry.page)
      .all();
    const occupied = new Set();
    for (const pe of pageEntries) {
      if (pe.id === auth.entry.id) continue;
      for (const s of footprint(pe.slot, pe.kind, pe.size)) occupied.add(s);
    }
    for (const s of footprint(auth.entry.slot, auth.entry.kind, size))
      if (occupied.has(s)) return json({ error: "slot_taken" }, 409);
  }

  await context.env.DB.prepare(
    `UPDATE card_entries
     SET author_name = ?, message = ?, font = ?, color = ?, media_type = ?, media_data = ?, gif_url = ?, size = ?
     WHERE id = ?`
  )
    .bind(
      e.author_name,
      e.message,
      e.font,
      e.color,
      e.media_type,
      e.media_data,
      e.gif_url,
      size === 1 ? null : size,
      auth.entry.id
    )
    .run();

  return json({ ok: true });
}

// DELETE /api/card/:id/entries/:entryId — remove an entry.
export async function onRequestDelete(context) {
  let body = null;
  try {
    body = await context.request.json();
  } catch {
    // body optional for admin deletes
  }

  const auth = await authorizeEntry(context, body);
  if (auth.error) return auth.error;

  await context.env.DB.prepare("DELETE FROM card_entries WHERE id = ?").bind(auth.entry.id).run();

  return json({ ok: true });
}

export async function onRequestOptions() {
  return optionsResponse();
}
