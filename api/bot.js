const { getDb } = require("../lib/db");

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.status(200).send("OK");
    return;
  }

  const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
  const CHANNEL_USERNAME = process.env.CHANNEL_USERNAME; // فقط یوزرنیم
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

  // بررسی دسترسی
  if (ALLOWED_USER_IDS.length > 0 && !ALLOWED_USER_IDS.includes(fromId)) {
    await sendMessage(BOT_TOKEN, chatId, "متاسفم، اجازه استفاده از این بات رو نداری.");
    res.status(200).json({ ok: true });
    return;
  }

  // حالت ۱: پاسخ به سوال "اسم فیلم چیه؟"
  const replyText = message.reply_to_message && message.reply_to_message.text;
  const refMatch = replyText && /\[ref:(\d+)\]/.exec(replyText);

  if (refMatch && message.text) {
    const channelMessageId = parseInt(refMatch[1], 10);
    const slug = sanitizeSlug(message.text) || `f${channelMessageId}`;

    try {
      const db = await getDb();
      await db.collection("movies").updateOne(
        { name: slug },
        {
          $set: { 
            name: slug, 
            channelUsername: CHANNEL_USERNAME, // ذخیره یوزرنیم
            messageId: channelMessageId, 
            updatedAt: new Date() 
          },
          $setOnInsert: { createdAt: new Date() },
        },
        { upsert: true }
      );

      const link = `${BASE_URL}/watch.html?id=${encodeURIComponent(slug)}`;
      await sendMessage(
        BOT_TOKEN,
        chatId,
        `✅ لینک آماده شد:\n${link}\n\n📋 لیست همه فیلم‌ها:\n${BASE_URL}/movies.html`
      );
    } catch (err) {
      console.error(err);
      await sendMessage(BOT_TOKEN, chatId, "❌ یه مشکلی پیش اومد، دوباره امتحان کن.");
    }

    res.status(200).json({ ok: true });
    return;
  }

  // حالت ۲: فایل جدید
  const hasFile = message.document || message.video || message.audio;

  if (!hasFile) {
    await sendMessage(BOT_TOKEN, chatId, "📁 یه فایل ویدیویی یا فیلم برام بفرست.");
    res.status(200).json({ ok: true });
    return;
  }

  try {
    console.log("[bot] Forwarding to channel:", CHANNEL_USERNAME);
    
    // ارسال به کانال با یوزرنیم
    const forward = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/forwardMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: CHANNEL_USERNAME, // ← فقط یوزرنیم
        from_chat_id: chatId,
        message_id: message.message_id,
      }),
    });
    
    const result = await forward.json();
    
    if (!result.ok) {
      throw new Error(result.description || "Unknown error");
    }

    const channelMessageId = result.result.message_id;
    console.log("[bot] ✅ Message forwarded. ID:", channelMessageId);
    
    await askForSlug(BOT_TOKEN, chatId, channelMessageId);
  } catch (err) {
    console.error("[bot] ❌ Error:", err);
    await sendMessage(BOT_TOKEN, chatId, "❌ خطا در ارسال به کانال. مطمئن شوید بات به کانال اضافه شده است.");
  }

  res.status(200).json({ ok: true });
};

function sanitizeSlug(text) {
  return text
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[\/\\?%*:|"'<>#&=]+/g, "")
    .replace(/[a-zA-Z]/g, (c) => c.toLowerCase())
    .slice(0, 60);
}

async function sendMessage(token, chatId, text) {
  const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text }),
  });
  return r.json();
}

async function askForSlug(token, chatId, channelMessageId) {
  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text: `🎬 اسم این فیلم چی باشه؟ (فقط حروف/عدد انگلیسی، بدون فاصله)\n[ref:${channelMessageId}]`,
      reply_markup: { force_reply: true },
    }),
  });
}