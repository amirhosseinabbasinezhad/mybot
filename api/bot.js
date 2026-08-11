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

  console.log("[bot] 📩 دریافت شد");

  // ============================================================
  // 📞 مدیریت Callback
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

    // ===== دکمه "ادامه" برای ارسال پوستر =====
    if (data === 'continue_to_poster') {
      const db = await getDb();
      const pendingMovie = await db.collection("pending_movies").findOne({
        userId: fromId,
        status: 'waiting_for_poster'
      });

      if (!pendingMovie) {
        await sendMessage(BOT_TOKEN, chatId, '❌ مشکلی پیش اومد. دوباره فیلم رو بفرست.');
        res.status(200).json({ ok: true });
        return;
      }

      await sendMessage(BOT_TOKEN, chatId, 
        '🖼️ حالا پوستر فیلم رو بفرست (یه عکس).\n\nاگر پوستر نداری، دکمه "رد شدن" رو بزن.'
      );
      
      res.status(200).json({ ok: true });
      return;
    }

    // ===== دکمه "رد شدن" برای پوستر =====
    if (data === 'skip_poster') {
      const db = await getDb();
      const pendingMovie = await db.collection("pending_movies").findOneAndDelete({
        userId: fromId,
        status: 'waiting_for_poster'
      });

      if (pendingMovie && pendingMovie.value) {
        const movie = pendingMovie.value;
        await db.collection("movies").insertOne({
          name: movie.movieName,
          messageId: movie.messageId,
          channelUsername: CHANNEL_USERNAME,
          posterMessageId: null,
          description: null,
          qualities: {},
          bestQuality: null,
          bestQualityMessageId: movie.messageId,
          createdAt: new Date(),
          userId: fromId,
        });

        const link = `${BASE_URL}/watch.html?id=${encodeURIComponent(movie.movieName)}`;
        await sendMessage(BOT_TOKEN, chatId, 
          `✅ فیلم بدون پوستر ذخیره شد!\n\n🎬 ${movie.movieName}\n🔗 لینک: ${link}`
        );
      }

      res.status(200).json({ ok: true });
      return;
    }

    // ===== تکمیل فرآیند کیفیت‌ها =====
    if (data === 'qualities_done') {
      const db = await getDb();
      const pendingMovie = await db.collection("pending_movies").findOne({
        userId: fromId,
        status: 'waiting_for_qualities'
      });

      if (pendingMovie) {
        const qualities = pendingMovie.qualities || {};
        const qualityOrder = ['1080p', '720p', '480p'];
        let bestQuality = null;
        let bestQualityData = null;

        for (const q of qualityOrder) {
          if (qualities[q]) {
            bestQuality = q;
            bestQualityData = qualities[q];
            break;
          }
        }

        await db.collection("movies").insertOne({
          name: pendingMovie.movieName,
          channelUsername: CHANNEL_USERNAME,
          posterMessageId: pendingMovie.posterMessageId,
          description: pendingMovie.description || "",
          qualities: qualities,
          bestQuality: bestQuality,
          bestQualityMessageId: bestQualityData?.messageId || pendingMovie.messageId,
          createdAt: new Date(),
          userId: fromId,
        });

        await db.collection("pending_movies").deleteOne({ _id: pendingMovie._id });

        const link = `${BASE_URL}/watch.html?id=${encodeURIComponent(pendingMovie.movieName)}`;
        await sendMessage(BOT_TOKEN, chatId, 
          `✅ فیلم با کیفیت‌های مختلف ذخیره شد!\n\n` +
          `🎬 ${pendingMovie.movieName}\n` +
          `📺 بهترین کیفیت موجود: ${bestQuality || 'نامشخص'}\n` +
          `🔗 لینک: ${link}`
        );
      }

      res.status(200).json({ ok: true });
      return;
    }

    if (data === 'skip_qualities') {
      const db = await getDb();
      const pendingMovie = await db.collection("pending_movies").findOne({
        userId: fromId,
        status: 'waiting_for_qualities'
      });

      if (pendingMovie) {
        await db.collection("movies").insertOne({
          name: pendingMovie.movieName,
          channelUsername: CHANNEL_USERNAME,
          posterMessageId: pendingMovie.posterMessageId,
          description: pendingMovie.description || "",
          qualities: {},
          bestQuality: null,
          bestQualityMessageId: pendingMovie.messageId,
          createdAt: new Date(),
          userId: fromId,
        });

        await db.collection("pending_movies").deleteOne({ _id: pendingMovie._id });

        const link = `${BASE_URL}/watch.html?id=${encodeURIComponent(pendingMovie.movieName)}`;
        await sendMessage(BOT_TOKEN, chatId, 
          `✅ فیلم بدون کیفیت‌های اضافی ذخیره شد!\n\n` +
          `🎬 ${pendingMovie.movieName}\n` +
          `🔗 لینک: ${link}`
        );
      }

      res.status(200).json({ ok: true });
      return;
    }

    // ===== مدیریت متون =====
    if (data.startsWith('addtext_')) {
      const tempId = data.replace('addtext_', '');
      const db = await getDb();
      
      const tempDoc = await db.collection("temp_texts").findOne({ 
        tempId: tempId,
        expiresAt: { $gt: new Date() }
      });

      if (!tempDoc) {
        await sendMessage(BOT_TOKEN, chatId, '❌ لینک منقضی شده است.');
        res.status(200).json({ ok: true });
        return;
      }

      await db.collection("texts").insertOne({
        text: tempDoc.text,
        createdAt: new Date(),
        updatedAt: new Date(),
        userId: fromId,
      });

      await db.collection("temp_texts").deleteOne({ tempId: tempId });
      await sendMessage(BOT_TOKEN, chatId, `✅ متن با موفقیت اضافه شد.`);

      res.status(200).json({ ok: true });
      return;
    }

    if (data === 'ignore') {
      await sendMessage(BOT_TOKEN, chatId, '❌ متن اضافه نشد.');
      res.status(200).json({ ok: true });
      return;
    }
  }

  if (!message) {
    res.status(200).json({ ok: true });
    return;
  }

  const chatId = message.chat.id;
  const fromId = String((message.from && message.from.id) || "");
  const hasFile = message.document || message.video || message.audio;
  const hasPhoto = message.photo && message.photo.length > 0;

  if (ALLOWED_USER_IDS.length > 0 && !ALLOWED_USER_IDS.includes(fromId)) {
    await sendMessage(BOT_TOKEN, chatId, "متاسفم، اجازه استفاده از این بات رو نداری.");
    res.status(200).json({ ok: true });
    return;
  }

  // ============================================================
  // 📝 دستور /addtext
  // ============================================================
  if (message.text && message.text.startsWith('/addtext')) {
    const text = message.text.replace('/addtext', '').trim();
    
    if (!text) {
      await sendMessage(BOT_TOKEN, chatId, '❌ لطفاً بعد از /addtext متن را وارد کنید.');
      res.status(200).json({ ok: true });
      return;
    }

    try {
      const db = await getDb();
      await db.collection("texts").insertOne({
        text: text,
        createdAt: new Date(),
        updatedAt: new Date(),
        userId: fromId,
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
  // 🎬 پاسخ به سوال "اسم فیلم چیه؟"
  // ============================================================
  const replyText = message.reply_to_message && message.reply_to_message.text;
  const refMatch = replyText && /\[ref:(\d+)\]/.exec(replyText);

  if (refMatch && message.text) {
    const channelMessageId = parseInt(refMatch[1], 10);
    const slug = sanitizeSlug(message.text) || `f${channelMessageId}`;

    const db = await getDb();

    await db.collection("pending_movies").insertOne({
      userId: fromId,
      movieName: slug,
      messageId: channelMessageId,
      status: 'waiting_for_poster',
      createdAt: new Date(),
    });

    const keyboard = {
      inline_keyboard: [
        [
          { text: '🖼️ ارسال پوستر', callback_data: 'continue_to_poster' },
          { text: '⏭️ رد شدن', callback_data: 'skip_poster' }
        ]
      ]
    };

    await sendMessage(BOT_TOKEN, chatId, 
      `✅ اسم فیلم ثبت شد: "${slug}"\n\n` +
      `حالا می‌تونی پوستر فیلم رو بفرستی (یه عکس).\n` +
      `یا اگر پوستر نداری، دکمه "رد شدن" رو بزن.`,
      keyboard
    );

    res.status(200).json({ ok: true });
    return;
  }

  // ============================================================
  // 🖼️ دریافت پوستر (عکس)
  // ============================================================
  if (hasPhoto) {
    const db = await getDb();
    const pendingMovie = await db.collection("pending_movies").findOne({
      userId: fromId,
      status: 'waiting_for_poster'
    });

    if (pendingMovie) {
      try {
        const caption = message.caption || "";

        const forwardPhoto = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/forwardMessage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: CHANNEL_USERNAME,
            from_chat_id: chatId,
            message_id: message.message_id,
          }),
        });

        const photoResult = await forwardPhoto.json();

        if (!photoResult.ok) {
          throw new Error(photoResult.description || "خطا در ارسال پوستر");
        }

        const posterMessageId = photoResult.result.message_id;

        await db.collection("pending_movies").updateOne(
          { _id: pendingMovie._id },
          { 
            $set: { 
              posterMessageId: posterMessageId,
              description: caption || "",
              status: 'waiting_for_qualities' 
            } 
          }
        );

        const qualityKeyboard = {
          inline_keyboard: [
            [
              { text: '✅ همه کیفیت‌ها رو فرستادم', callback_data: 'qualities_done' },
              { text: '⏭️ فقط همین کیفیت', callback_data: 'skip_qualities' }
            ]
          ]
        };

        await sendMessage(BOT_TOKEN, chatId, 
          `✅ پوستر ذخیره شد!\n\n` +
          `📤 حالا فیلم رو با کیفیت‌های مختلف به من بفرست.\n` +
          `مثلاً:\n` +
          `- فیلم با کیفیت 480p\n` +
          `- فیلم با کیفیت 720p\n` +
          `- فیلم با کیفیت 1080p\n\n` +
          `هر کیفیت رو به عنوان یک پیام جداگانه بفرست.\n` +
          `بعد از فرستادن همه کیفیت‌ها، دکمه "همه کیفیت‌ها رو فرستادم" رو بزن.`,
          qualityKeyboard
        );

      } catch (err) {
        console.error("[bot] ❌ Error saving poster:", err);
        await sendMessage(BOT_TOKEN, chatId, '❌ خطا در ذخیره پوستر. دوباره تلاش کن.');
      }

      res.status(200).json({ ok: true });
      return;
    }
  }

  // ============================================================
  // 📤 دریافت فیلم با کیفیت‌های مختلف
  // ============================================================
  if (hasFile) {
    const db = await getDb();
    const pendingMovie = await db.collection("pending_movies").findOne({
      userId: fromId,
      status: 'waiting_for_qualities'
    });

    if (pendingMovie) {
      try {
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
          throw new Error(result.description || "خطا در ارسال فیلم");
        }

        const fileMessageId = result.result.message_id;
        const fileSize = message.document?.file_size || message.video?.file_size || 0;

        let quality = 'unknown';
        if (fileSize < 100 * 1024 * 1024) quality = '480p';
        else if (fileSize < 300 * 1024 * 1024) quality = '720p';
        else quality = '1080p';

        const qualityField = `qualities.${quality}`;
        await db.collection("pending_movies").updateOne(
          { _id: pendingMovie._id },
          { 
            $set: { 
              [qualityField]: {
                messageId: fileMessageId,
                fileSize: fileSize,
                createdAt: new Date()
              }
            } 
          }
        );

        await sendMessage(BOT_TOKEN, chatId, 
          `✅ فیلم با کیفیت ${quality} دریافت شد!\n` +
          `حجم: ${(fileSize / 1024 / 1024).toFixed(1)} MB\n\n` +
          `کیفیت‌های دیگه رو هم بفرست (اگه داری).\n` +
          `وقتی همه کیفیت‌ها رو فرستادی، دکمه پایین رو بزن.`
        );

      } catch (err) {
        console.error("[bot] ❌ Error saving quality:", err);
        await sendMessage(BOT_TOKEN, chatId, '❌ خطا در ذخیره فیلم. دوباره تلاش کن.');
      }

      res.status(200).json({ ok: true });
      return;
    }
  }

  // ============================================================
  // 📝 پیام متنی (برای لیست متن‌ها)
  // ============================================================
  if (message.text && !message.reply_to_message && !hasFile && !hasPhoto) {
    const text = message.text.trim();
    
    if (text.length < 2 || text.startsWith('/')) {
      res.status(200).json({ ok: true });
      return;
    }

    try {
      const db = await getDb();
      const tempId = Date.now().toString(36) + Math.random().toString(36).substr(2, 6);
      
      await db.collection("temp_texts").insertOne({
        tempId: tempId,
        text: text,
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 5 * 60 * 1000),
      });

      const keyboard = {
        inline_keyboard: [
          [
            { text: '✅ بله، اضافه کن', callback_data: `addtext_${tempId}` },
            { text: '❌ نه، فقط چت', callback_data: 'ignore' }
          ]
        ]
      };

      const previewText = text.length > 50 ? text.substring(0, 50) + '...' : text;

      await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          text: `📝 آیا می‌خواهید این متن را به لیست متن‌ها اضافه کنید؟\n\n"${previewText}"`,
          reply_markup: keyboard,
        }),
      });

    } catch (err) {
      console.error("[bot] ❌ Error:", err);
    }

    res.status(200).json({ ok: true });
    return;
  }

  // ============================================================
  // 🎬 فایل جدید (فیلم - وقتی در حالت عادی فرستاده شد)
  // ============================================================
  if (!hasFile) {
    await sendMessage(BOT_TOKEN, chatId, "📁 یه فایل ویدیویی یا فیلم برام بفرست.");
    res.status(200).json({ ok: true });
    return;
  }

  try {
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
    await sendMessage(BOT_TOKEN, chatId, "❌ خطا در ارسال به کانال.");
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

async function sendMessage(token, chatId, text, keyboard = null) {
  const payload = { chat_id: chatId, text };
  if (keyboard) payload.reply_markup = keyboard;
  
  const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
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