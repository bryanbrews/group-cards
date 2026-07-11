import {
  json,
  optionsResponse,
  getCardAndRole,
  cleanText,
  isValidImageData,
  LIMITS,
} from "./lib/util.js";

// GET /api/card/:id?t=TOKEN — card metadata.
// - share role: meta only (never tokens)
// - admin role: meta + tokens (so the admin page can re-show links)
export async function onRequestGet(context) {
  const { card, role } = await getCardAndRole(context.env, context.params.id, context.request);
  if (!card) return json({ error: "Card not found" }, 404);
  if (!role) return json({ error: "This card is private — you need its link" }, 403);

  const meta = {
    id: card.id,
    title: card.title,
    recipient_name: card.recipient_name,
    cover_image: card.cover_image,
    is_private: card.is_private ? 1 : 0,
    created_at: card.created_at,
    role,
  };

  if (role === "admin") {
    meta.admin_token = card.admin_token;
    meta.sign_token = card.sign_token;
    meta.view_token = card.view_token;
    const row = await context.env.DB.prepare(
      "SELECT COUNT(*) AS n FROM card_entries WHERE card_id = ?"
    )
      .bind(card.id)
      .first();
    meta.entry_count = row ? row.n : 0;
  }

  return json(meta);
}

// PATCH /api/card/:id?t=ADMIN — update title / recipient / cover / privacy.
export async function onRequestPatch(context) {
  const { card, role } = await getCardAndRole(context.env, context.params.id, context.request);
  if (!card) return json({ error: "Card not found" }, 404);
  if (role !== "admin") return json({ error: "Admin token required" }, 403);

  let body;
  try {
    body = await context.request.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const updates = [];
  const values = [];

  if (body.title !== undefined) {
    const title = cleanText(body.title, LIMITS.NAME);
    if (!title) return json({ error: "Title is required (max 120 chars)" }, 400);
    updates.push("title = ?");
    values.push(title);
  }
  if (body.recipient_name !== undefined) {
    const name = cleanText(body.recipient_name, LIMITS.NAME);
    if (name === null) return json({ error: "Recipient name too long" }, 400);
    updates.push("recipient_name = ?");
    values.push(name);
  }
  if (body.cover_image !== undefined) {
    if (body.cover_image === null || body.cover_image === "") {
      updates.push("cover_image = NULL");
    } else {
      if (typeof body.cover_image === "string" && body.cover_image.length > LIMITS.IMAGE_CHARS)
        return json({ error: "Cover image too large" }, 413);
      if (!isValidImageData(body.cover_image))
        return json({ error: "Cover image must be a jpeg/png/webp data URL" }, 400);
      updates.push("cover_image = ?");
      values.push(body.cover_image);
    }
  }
  if (body.is_private !== undefined) {
    if (body.is_private !== 0 && body.is_private !== 1)
      return json({ error: "is_private must be 0 or 1" }, 400);
    updates.push("is_private = ?");
    values.push(body.is_private);
  }

  if (updates.length === 0) return json({ error: "Nothing to update" }, 400);

  await context.env.DB.prepare(`UPDATE cards SET ${updates.join(", ")} WHERE id = ?`)
    .bind(...values, card.id)
    .run();

  return json({ ok: true });
}

// DELETE /api/card/:id?t=ADMIN — delete card and all entries.
export async function onRequestDelete(context) {
  const { card, role } = await getCardAndRole(context.env, context.params.id, context.request);
  if (!card) return json({ error: "Card not found" }, 404);
  if (role !== "admin") return json({ error: "Admin token required" }, 403);

  await context.env.DB.prepare("DELETE FROM card_entries WHERE card_id = ?").bind(card.id).run();
  await context.env.DB.prepare("DELETE FROM cards WHERE id = ?").bind(card.id).run();

  return json({ ok: true });
}

export async function onRequestOptions() {
  return optionsResponse();
}
