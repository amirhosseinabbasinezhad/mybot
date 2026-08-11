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

    // ===== منوی اصلی: افزودن فیلم =====
    if (data === 'add_movie') {
      const db = await getDb();
      
      // پاک کردن pending های قبلی
      await db.collection("pending_movies").deleteMany({ userId: fromId });
      
      // ایجاد pending جدید
      await db.collection("pending_movies").insertOne({
        userId: fromId,
        status: 'waiting_for_movie_name',
        createdAt: new Date(),
      });

      await sendMessage(BOT_TOKEN, chatId, '🎬 اسم فیلم رو وارد کن:');
      
      res.status(200).json({ ok: true });
      return;
    }

    // ===== منوی اصلی: افزودن متن =====
    if (data === 'add_text') {
      await sendMessage(BOT_TOKEN, chatId, '📝 متن مورد نظر رو تایپ کن:');
      res.status(200).json({ ok: true });
      return;
    }

    // ===== کیفیت‌ها: همه رو فرستادم =====
    if (data === 'qualities_done') {
      const db = await getDb();
      const pendingMovie = await db.collection("pending_movies").findOne({
        userId: fromId,
        status: 'waiting_for_qualities'
      });

      if (pendingMovie) {
        const qualities = pendingMovie.qualities || {};
        const qualityOrder = ['360p', '480p', '720p', '1080p'];
        let bestQuality = null;
        let bestQualityData = null;

        for (const q of qualityOrder) {
          if (qualities[q]) {
            bestQuality = q;
            bestQualityData = qualities[q];
            break;
          }
        }

        // ساخت لینک برای هر کیفیت
        let linksText = '';
        for (const q of qualityOrder) {
          if (qualities[q]) {
            const link = `${BASE_URL}/watch.html?id=${encodeURIComponent(pendingMovie.movieName)}&quality=${q}`;
            linksText += `\n🎬 ${q}: ${link}`;
          }
        }

        await db.collection("movies").insertOne({
          name: pendingMovie.movieName,
          channelUsername: CHANNEL_USERNAME,
          posterMessageId: pendingMovie.posterMessageId,
          qualities: qualities,
          bestQuality: bestQuality,
          bestQualityMessageId: bestQualityData?.messageId || pendingMovie.messageId,
          createdAt: new Date(),
          userId: fromId,
        });

        await db.collection("pending_movies").deleteOne({ _id: pendingMovie._id });

        await sendMessage(BOT_TOKEN, chatId, 
          `✅ فیلم با کیفیت‌های مختلف ذخیره شد!\n\n` +
          `🎬 ${pendingMovie.movieName}\n` +
          `📺 بهترین کیفیت موجود: ${bestQuality || 'نامشخص'}\n` +
          `🔗 لینک‌ها:\n${linksText}`
        );
      }

      res.status(200).json({ ok: true });
      return;
    }

    // ===== کیفیت‌ها: رد کردن =====
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

    // ===== متون =====
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
      await sendMessage(BOT_TOKEN, chatId, `✅ متن با موفقیت اضافه شد:\n\n"${tempDoc.text}"`);

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
  // 📝 اگر پیام متنی بود (افزودن متن)
  // ============================================================
  if (message.text && !message.reply_to_message && !hasFile && !hasPhoto) {
    const text = message.text.trim();
    
    if (text.length < 2 || text.startsWith('/')) {
      res.status(200).json({ ok: true });
      return;
    }

    const db = await getDb();
    
    // چک کن آیا کاربر در حالت waiting_for_text هست
    const pendingText = await db.collection("pending_texts").findOne({
      userId: fromId,
      status: 'waiting_for_text'
    });

    if (pendingText) {
      // ذخیره متن
      await db.collection("texts").insertOne({
        text: text,
        createdAt: new Date(),
        updatedAt: new Date(),
        userId: fromId,
      });
      
      await db.collection("pending_texts").deleteOne({ _id: pendingText._id });
      
      await sendMessage(BOT_TOKEN, chatId, `✅ متن با موفقیت اضافه شد:\n\n"${text}"`);
      res.status(200).json({ ok: true });
      return;
    }

    // منوی اصلی
    const mainKeyboard = {
      inline_keyboard: [
        [
          { text: '🎬 افزودن فیلم', callback_data: 'add_movie' },
          { text: '📝 افزودن متن', callback_data: 'add_text' }
        ]
      ]
    };

    await sendMessage(BOT_TOKEN, chatId, 
      `👋 سلام! چه کاری می‌خواهید انجام دهید؟`,
      mainKeyboard
    );

    res.status(200).json({ ok: true });
    return;
  }

  // ============================================================
  // 🎬 مدیریت فیلم (اسم فیلم)
  // ============================================================
  if (message.text && !message.reply_to_message) {
    const db = await getDb();
    
    const pendingMovie = await db.collection("pending_movies").findOne({
      userId: fromId,
      status: 'waiting_for_movie_name'
    });

    if (pendingMovie) {
      const slug = sanitizeSlug(message.text) || `f${Date.now()}`;
      
      await db.collection("pending_movies").updateOne(
        { _id: pendingMovie._id },
        { 
          $set: { 
            movieName: slug,
            status: 'waiting_for_poster' 
          } 
        }
      );

      await sendMessage(BOT_TOKEN, chatId, 
        `✅ اسم فیلم ثبت شد: "${slug}"\n\n` +
        `🖼️ حالا پوستر فیلم رو بفرست (یه عکس).`
      );

      res.status(200).json({ ok: true });
      return;
    }
  }

  // ============================================================
  // 🖼️ دریافت پوستر
  // ============================================================
  if (hasPhoto) {
    const db = await getDb();
    const pendingMovie = await db.collection("pending_movies").findOne({
      userId: fromId,
      status: 'waiting_for_poster'
    });

    if (pendingMovie) {
      try {
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
              status: 'waiting_for_qualities',
              qualities: {}
            } 
          }
        );

        // کیفیت‌هایی که باید بفرستد
        const qualityList = ['360p', '480p', '720p', '1080p'];
        let qualityText = '';
        for (let i = 0; i < qualityList.length; i++) {
          qualityText += `\n${i + 1}. ${qualityList[i]}`;
        }

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
          `📤 حالا فیلم رو با کیفیت‌های مختلف به ترتیب زیر بفرست:\n` +
          `${qualityText}\n\n` +
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

        // تشخیص کیفیت بر اساس ترتیب ارسال
        const qualities = pendingMovie.qualities || {};
        const qualityOrder = ['360p', '480p', '720p', '1080p'];
        let assignedQuality = null;

        for (const q of qualityOrder) {
          if (!qualities[q]) {
            assignedQuality = q;
            break;
          }
        }

        if (!assignedQuality) {
          // اگر همه کیفیت‌ها پر شده، به عنوان 1080p ذخیره کن
          assignedQuality = '1080p';
        }

        qualities[assignedQuality] = {
          messageId: fileMessageId,
          fileSize: fileSize,
          createdAt: new Date()
        };

        await db.collection("pending_movies").updateOne(
          { _id: pendingMovie._id },
          { $set: { qualities: qualities } }
        );

        // محاسبه تعداد کیفیت‌های ارسال شده
        const sentCount = Object.keys(qualities).length;
        const totalCount = qualityOrder.length;

        await sendMessage(BOT_TOKEN, chatId, 
          `✅ فیلم با کیفیت ${assignedQuality} دریافت شد!\n` +
          `حجم: ${(fileSize / 1024 / 1024).toFixed(1)} MB\n` +
          `(${sentCount}/${totalCount} کیفیت ارسال شد)\n\n` +
          `کیفیت‌های بعدی رو هم بفرست (اگه داری).\n` +
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
  // 🎬 فایل جدید (وقتی در حالت عادی فرستاده شد)
  // ============================================================
  if (!hasFile) {
    // منوی اصلی
    const mainKeyboard = {
      inline_keyboard: [
        [
          { text: '🎬 افزودن فیلم', callback_data: 'add_movie' },
          { text: '📝 افزودن متن', callback_data: 'add_text' }
        ]
      ]
    };

    await sendMessage(BOT_TOKEN, chatId, 
      `👋 سلام! چه کاری می‌خواهید انجام دهید؟`,
      mainKeyboard
    );
    
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
    
    // ذخیره در pending برای اسم فیلم
    const db = await getDb();
    await db.collection("pending_movies").deleteMany({ userId: fromId });
    await db.collection("pending_movies").insertOne({
      userId: fromId,
      messageId: channelMessageId,
      status: 'waiting_for_movie_name',
      createdAt: new Date(),
    });

    await sendMessage(BOT_TOKEN, chatId, '🎬 اسم این فیلم رو وارد کن:');
    
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