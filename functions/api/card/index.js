import {
  json,
  optionsResponse,
  randomId,
  randomToken,
  cleanText,
  isValidImageData,
  LIMITS,
} from "./lib/util.js";

// GET /api/card — public gallery list.
// Only public cards, and never tokens or full covers (cover_thumb is small).
export async function onRequestGet(context) {
  const { results } = await context.env.DB.prepare(
    `SELECT c.id, c.title, c.recipient_name, c.cover_thumb, c.created_at,
            (SELECT COUNT(*) FROM card_entries e WHERE e.card_id = c.id) AS entry_count
     FROM cards c
     WHERE c.is_private = 0
     ORDER BY c.created_at DESC`
  ).all();
  return json({ cards: results });
}

// POST /api/card — create a card.
// This is the ONLY response that ever contains all three tokens.
export async function onRequestPost(context) {
  let body;
  try {
    body = await context.request.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const title = cleanText(body.title, LIMITS.NAME);
  if (!title) return json({ error: "Title is required (max 120 chars)" }, 400);

  const recipientName = cleanText(body.recipient_name ?? "", LIMITS.NAME);
  if (recipientName === null)
    return json({ error: "Recipient name too long (max 120 chars)" }, 400);

  let coverImage = null;
  if (body.cover_image != null && body.cover_image !== "") {
    if (typeof body.cover_image === "string" && body.cover_image.length > LIMITS.IMAGE_CHARS)
      return json({ error: "Cover image too large" }, 413);
    if (!isValidImageData(body.cover_image))
      return json({ error: "Cover image must be a jpeg/png/webp data URL" }, 400);
    coverImage = body.cover_image;
  }

  let coverThumb = null;
  if (body.cover_thumb != null && body.cover_thumb !== "") {
    if (typeof body.cover_thumb === "string" && body.cover_thumb.length > LIMITS.THUMB_CHARS)
      return json({ error: "Cover thumbnail too large" }, 413);
    if (!isValidImageData(body.cover_thumb))
      return json({ error: "Cover thumbnail must be a jpeg/png/webp data URL" }, 400);
    coverThumb = body.cover_thumb;
  }

  const isPrivate = body.is_private ? 1 : 0;

  const id = randomId();
  const adminToken = randomToken();
  const signToken = randomToken();
  const viewToken = randomToken();

  try {
    await context.env.DB.prepare(
      `INSERT INTO cards (id, admin_token, sign_token, view_token, title, recipient_name, cover_image, cover_thumb, is_private, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(id, adminToken, signToken, viewToken, title, recipientName, coverImage, coverThumb, isPrivate, Date.now())
      .run();
  } catch (err) {
    return json({ error: "Could not create card: " + String(err).substring(0, 160) }, 500);
  }

  return json(
    {
      id,
      admin_token: adminToken,
      sign_token: signToken,
      view_token: viewToken,
      title,
      recipient_name: recipientName,
    },
    201
  );
}

export async function onRequestOptions() {
  return optionsResponse();
}
