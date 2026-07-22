const { getDb } = require("../lib/db");

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.status(200).send("OK");
    return;
  }

  const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
  const CHANNEL_USERNAME = process.env.CHANNEL_USERNAME;
  const BASE_URL = process.env.PUBLIC_BASE_URL;
  const ALLOWED_USER_IDS = (process.env.ALLOWED_USER_ID || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const update = req.body;
  const message = update && update.message;
  const callback = update && update.callback_query;

  // ============================================================
  // 📞 مدیریت Callback (پاسخ به دکمه‌های شیشه‌ای)
  // ⚠️ این بخش باید اول بررسی بشه!
  // ============================================================
  if (callback) {
    const data = callback.data;
    const chatId = callback.message.chat.id;
    const fromId = String((callback.from && callback.from.id) || "");

    if (ALLOWED_USER_IDS.length > 0 && !ALLOWED_USER_IDS.includes(fromId)) {
      await sendMessage(BOT_TOKEN, chatId, "متاسفم، اجازه استفاده از این بات رو نداری.");
      res.status(200).json({ ok: true });
      return;
    }

    if (data === 'ignore') {
      await sendMessage(BOT_TOKEN, chatId, '❌ متن اضافه نشد.');
      res.status(200).json({ ok: true });
      return;
    }

    if (data.startsWith('addtext_')) {
      const text = data.replace('addtext_', '');
      
      try {
        const db = await getDb();
        await db.collection("texts").insertOne({
          text: text,
          createdAt: new Date(),
          updatedAt: new Date(),
        });
        await sendMessage(BOT_TOKEN, chatId, `✅ متن با موفقیت به لیست اضافه شد:\n\n"${text}"`);
      } catch (err) {
        console.error(err);
        await sendMessage(BOT_TOKEN, chatId, '❌ خطا در افزودن متن');
      }

      res.status(200).json({ ok: true });
      return;
    }
  }

  // ============================================================
  // 📥 بررسی پیام
  // ============================================================
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

  // ============================================================
  // 📝 مدیریت متن از طریق تلگرام (دستور /addtext)
  // ============================================================
  if (message.text && message.text.startsWith('/addtext')) {
    const text = message.text.replace('/addtext', '').trim();
    
    if (!text) {
      await sendMessage(BOT_TOKEN, chatId, '❌ لطفاً بعد از /addtext متن را وارد کنید.\nمثال: /addtext سلام دنیا');
      res.status(200).json({ ok: true });
      return;
    }

    try {
      const db = await getDb();
      await db.collection("texts").insertOne({
        text: text,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      await sendMessage(BOT_TOKEN, chatId, `✅ متن با موفقیت اضافه شد:\n\n"${text}"`);
    } catch (err) {
      console.error(err);
      await sendMessage(BOT_TOKEN, chatId, '❌ خطا در افزودن متن');
    }

    res.status(200).json({ ok: true });
    return;
  }

  // ============================================================
  // 🎬 حالت ۱: پاسخ به سوال "اسم فیلم چیه؟"
  // ============================================================
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
            channelUsername: CHANNEL_USERNAME,
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

  // ============================================================
  // 📝 اگر پیام متنی معمولی بود و فیلم نبود
  // ============================================================
  const hasFile = message.document || message.video || message.audio;

  if (message.text && !message.reply_to_message && !hasFile) {
    const text = message.text.trim();
    
    if (text.length < 2) {
      res.status(200).json({ ok: true });
      return;
    }

    const keyboard = {
      inline_keyboard: [
        [
          { text: '✅ بله، به لیست متن‌ها اضافه کن', callback_data: `addtext_${text}` },
          { text: '❌ نه، فقط چت', callback_data: 'ignore' }
        ]
      ]
    };

    await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: `📝 آیا می‌خواهید این متن را به لیست متن‌ها اضافه کنید؟\n\n"${text}"`,
        reply_markup: keyboard,
      }),
    });

    res.status(200).json({ ok: true });
    return;
  }

  // ============================================================
  // 🎬 حالت ۲: فایل جدید (فیلم)
  // ============================================================
  if (!hasFile) {
    await sendMessage(BOT_TOKEN, chatId, "📁 یه فایل ویدیویی یا فیلم برام بفرست.");
    res.status(200).json({ ok: true });
    return;
  }

  try {
    console.log("[bot] Forwarding to channel:", CHANNEL_USERNAME);
    
    const forward = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/forwardMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: CHANNEL_USERNAME,
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

// ============================================================
// 🛠 توابع کمکی
// ============================================================

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