// این فانکشن webhook باته که تلگرام هر پیام جدید رو بهش می‌فرسته.
// - وقتی فایل ویدیویی می‌رسه: اونو (بدون برچسب "فوروارد شده") به چت رله کپی می‌کنه
//   و از فرستنده می‌پرسه چه اسمی برای لینکش بذاره.
// - وقتی جواب اسم می‌رسه (به‌صورت ریپلای به همون سوال): کپشن فایل کپی‌شده رو
//   با همون اسم آپدیت می‌کنه و لینک نهایی رو می‌فرسته.
// - فقط اکانت مجاز (ALLOWED_USER_ID) اجازه استفاده داره.

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.status(200).send("OK");
    return;
  }

  const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
  const RELAY_CHAT_ID = process.env.RELAY_CHAT_ID;
  const BASE_URL = process.env.PUBLIC_BASE_URL;
  const ALLOWED_USER_IDS = (process.env.ALLOWED_USER_ID || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const update = req.body;
  const message = update && update.message;

  if (!message) {
    res.status(200).json({ ok: true });
    return;
  }

  const chatId = message.chat.id;
  const fromId = String((message.from && message.from.id) || "");

  if (ALLOWED_USER_IDS.length > 0 && !ALLOWED_USER_IDS.includes(fromId)) {
    await sendMessage(BOT_TOKEN, chatId, "متاسفم، اجازه استفاده از این بات رو نداری.");
    res.status(200).json({ ok: true });
    return;
  }

  // حالت ۱: این پیام، جواب به سوال "چه اسمی بذارم؟" هست
  const replyText = message.reply_to_message && message.reply_to_message.text;
  const refMatch = replyText && /\[ref:(\d+)\]/.exec(replyText);

  if (refMatch && message.text) {
    const copiedId = parseInt(refMatch[1], 10);
    const slug = sanitizeSlug(message.text) || `f${copiedId}`;

    try {
      const edited = await editCaption(BOT_TOKEN, RELAY_CHAT_ID, copiedId, slug);
      if (!edited.ok) throw new Error(JSON.stringify(edited));

      const link = `${BASE_URL}/watch.html?id=${encodeURIComponent(slug)}`;
      await sendMessage(BOT_TOKEN, chatId, `لینک آماده شد:\n${link}`);
    } catch (err) {
      console.error(err);
      await sendMessage(BOT_TOKEN, chatId, "این اسم قابل استفاده نبود یا یه مشکلی پیش اومد. یه اسم دیگه (فقط حروف/عدد انگلیسی) امتحان کن، یا دوباره فیلم رو بفرست.");
    }

    res.status(200).json({ ok: true });
    return;
  }

  // حالت ۲: یه فایل جدید رسیده
  const hasFile = message.document || message.video || message.audio;

  if (!hasFile) {
    await sendMessage(BOT_TOKEN, chatId, "یه فایل ویدیویی یا فیلم برام بفرست تا لینک پخشش رو بدم.");
    res.status(200).json({ ok: true });
    return;
  }

  try {
    const copied = await copyMessage(BOT_TOKEN, RELAY_CHAT_ID, chatId, message.message_id);
    if (!copied.ok) throw new Error(JSON.stringify(copied));

    const copiedId = copied.result.message_id;
    await askForSlug(BOT_TOKEN, chatId, copiedId);
  } catch (err) {
    console.error(err);
    await sendMessage(BOT_TOKEN, chatId, "یه مشکلی پیش اومد. مطمئن شو اکانت رله یه بار /start رو به این بات زده. دوباره امتحان کن.");
  }

  res.status(200).json({ ok: true });
};

function sanitizeSlug(text) {
  return text
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9_-]/g, "")
    .slice(0, 40);
}

async function sendMessage(token, chatId, text) {
  const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text }),
  });
  return r.json();
}

async function askForSlug(token, chatId, copiedId) {
  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text: `چه اسمی (فقط حروف/عدد انگلیسی، بدون فاصله) برای لینک این فیلم بذارم؟\n[ref:${copiedId}]`,
      reply_markup: { force_reply: true },
    }),
  });
}

async function copyMessage(token, toChatId, fromChatId, messageId) {
  const r = await fetch(`https://api.telegram.org/bot${token}/copyMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: toChatId,
      from_chat_id: fromChatId,
      message_id: messageId,
    }),
  });
  return r.json();
}

async function editCaption(token, chatId, messageId, caption) {
  const r = await fetch(`https://api.telegram.org/bot${token}/editMessageCaption`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      message_id: messageId,
      caption,
    }),
  });
  return r.json();
}