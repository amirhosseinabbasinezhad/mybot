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
  // 📞 مدیریت Callback (دکمه‌های شیشه‌ای)
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

    // ===== شروع فرآیند افزودن فیلم =====
    if (data === 'new_movie') {
      const db = await getDb();
      
      // پاک کردن pending قبلی
      await db.collection("pending_movies").deleteMany({ userId: fromId });
      
      await sendMessage(BOT_TOKEN, chatId, 
        `🎬 لطفاً اسم فیلم را وارد کنید:\n\n` +
        `(فقط حروف و اعداد انگلیسی، بدون فاصله)\n` +
        `مثال: TheGodfather`
      );
      
      res.status(200).json({ ok: true });
      return;
    }

    // ===== شروع فرآیند افزودن متن =====
    if (data === 'new_text') {
      await sendMessage(BOT_TOKEN, chatId, 
        `📝 لطفاً متن مورد نظر را تایپ کنید:`
      );
      
      res.status(200).json({ ok: true });
      return;
    }

    // ===== ادامه بعد از اسم فیلم =====
    if (data === 'movie_name_done') {
      const db = await getDb();
      const pendingMovie = await db.collection("pending_movies").findOne({
        userId: fromId,
        status: 'waiting_for_name'
      });

      if (!pendingMovie || !pendingMovie.movieName) {
        await sendMessage(BOT_TOKEN, chatId, '❌ مشکلی پیش اومد. دوباره از /start استفاده کن.');
        res.status(200).json({ ok: true });
        return;
      }

      await db.collection("pending_movies").updateOne(
        { _id: pendingMovie._id },
        { $set: { status: 'waiting_for_poster' } }
      );

      await sendMessage(BOT_TOKEN, chatId, 
        `✅ اسم فیلم ثبت شد: "${pendingMovie.movieName}"\n\n` +
        `🖼️ حالا پوستر فیلم رو بفرست (یه عکس).`
      );
      
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
        
        // مرتب‌سازی کیفیت‌ها بر اساس ترتیب
        const qualityOrder = ['360p', '480p', '720p', '1080p'];
        const sortedQualities = {};
        let bestQuality = null;
        let bestQualityData = null;

        for (const q of qualityOrder) {
          if (qualities[q]) {
            sortedQualities[q] = qualities[q];
            if (!bestQuality) {
              bestQuality = q;
              bestQualityData = qualities[q];
            }
          }
        }

        // ذخیره نهایی
        await db.collection("movies").insertOne({
          name: pendingMovie.movieName,
          channelUsername: CHANNEL_USERNAME,
          posterMessageId: pendingMovie.posterMessageId,
          qualities: sortedQualities,
          bestQuality: bestQuality,
          bestQualityMessageId: bestQualityData?.messageId || pendingMovie.messageId,
          createdAt: new Date(),
          userId: fromId,
        });

        await db.collection("pending_movies").deleteOne({ _id: pendingMovie._id });

        const link = `${BASE_URL}/watch.html?id=${encodeURIComponent(pendingMovie.movieName)}`;
        
        // نمایش کیفیت‌های ذخیره شده
        let qualityText = '';
        for (const q of qualityOrder) {
          if (sortedQualities[q]) {
            const size = (sortedQualities[q].fileSize / 1024 / 1024).toFixed(1);
            qualityText += `\n- ${q} (${size} MB)`;
          }
        }

        await sendMessage(BOT_TOKEN, chatId, 
          `✅ فیلم "${pendingMovie.movieName}" با موفقیت ذخیره شد!\n\n` +
          `📺 کیفیت‌های موجود:${qualityText}\n` +
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
  const text = message.text || "";

  if (ALLOWED_USER_IDS.length > 0 && !ALLOWED_USER_IDS.includes(fromId)) {
    await sendMessage(BOT_TOKEN, chatId, "متاسفم، اجازه استفاده از این بات رو نداری.");
    res.status(200).json({ ok: true });
    return;
  }

  // ============================================================
  // 📋 دستورات اصلی (منو)
  // ============================================================
  
  // ===== /start =====
  if (text === '/start') {
    const keyboard = {
      inline_keyboard: [
        [
          { text: '🎬 افزودن فیلم', callback_data: 'new_movie' },
          { text: '📝 افزودن متن', callback_data: 'new_text' }
        ]
      ]
    };

    await sendMessage(BOT_TOKEN, chatId, 
      `🎥 به ربات فیلم‌پروکسی خوش آمدید!\n\n` +
      `لطفاً یکی از گزینه‌های زیر را انتخاب کنید:`,
      keyboard
    );

    res.status(200).json({ ok: true });
    return;
  }

  // ===== /new_movie =====
  if (text === '/new_movie') {
    const db = await getDb();
    await db.collection("pending_movies").deleteMany({ userId: fromId });
    
    await sendMessage(BOT_TOKEN, chatId, 
      `🎬 لطفاً اسم فیلم را وارد کنید:\n\n` +
      `(فقط حروف و اعداد انگلیسی، بدون فاصله)\n` +
      `مثال: TheGodfather`
    );
    
    res.status(200).json({ ok: true });
    return;
  }

  // ===== /new_text =====
  if (text === '/new_text') {
    await sendMessage(BOT_TOKEN, chatId, 
      `📝 لطفاً متن مورد نظر را تایپ کنید:`
    );
    
    res.status(200).json({ ok: true });
    return;
  }

  // ============================================================
  // 📝 دریافت اسم فیلم
  // ============================================================
  if (text && !text.startsWith('/')) {
    const db = await getDb();
    const pendingMovie = await db.collection("pending_movies").findOne({
      userId: fromId,
      status: 'waiting_for_name'
    });

    if (pendingMovie) {
      // اگر در حالت waiting_for_name هستیم
      const slug = sanitizeSlug(text);
      if (!slug || slug.length < 2) {
        await sendMessage(BOT_TOKEN, chatId, 
          '❌ اسم فیلم معتبر نیست.\n' +
          'لطفاً فقط از حروف و اعداد انگلیسی استفاده کنید.\n' +
          'مثال: TheGodfather'
        );
        res.status(200).json({ ok: true });
        return;
      }

      await db.collection("pending_movies").updateOne(
        { _id: pendingMovie._id },
        { $set: { movieName: slug, status: 'waiting_for_poster' } }
      );

      const keyboard = {
        inline_keyboard: [
          [
            { text: '✅ ادامه', callback_data: 'movie_name_done' }
          ]
        ]
      };

      await sendMessage(BOT_TOKEN, chatId, 
        `✅ اسم فیلم ثبت شد: "${slug}"\n\n` +
        `🖼️ حالا پوستر فیلم رو بفرست (یه عکس).`,
        keyboard
      );
      
      res.status(200).json({ ok: true });
      return;
    }

    // ============================================================
    // 🖼️ دریافت پوستر
    // ============================================================
    if (hasPhoto) {
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

          const qualityKeyboard = {
            inline_keyboard: [
              [
                { text: '✅ همه کیفیت‌ها رو فرستادم', callback_data: 'qualities_done' }
              ]
            ]
          };

          await sendMessage(BOT_TOKEN, chatId, 
            `✅ پوستر ذخیره شد!\n\n` +
            `📤 حالا فیلم رو با کیفیت‌های مختلف به من بفرست.\n\n` +
            `ترتیب ارسال کیفیت‌ها:\n` +
            `1️⃣ فیلم 360p\n` +
            `2️⃣ فیلم 480p\n` +
            `3️⃣ فیلم 720p\n` +
            `4️⃣ فیلم 1080p\n\n` +
            `هر کیفیت رو به عنوان یک پیام جداگانه بفرست.\n` +
            `بعد از فرستادن همه کیفیت‌ها، دکمه پایین رو بزن.`,
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

          // تشخیص کیفیت بر اساس ترتیب
          const existingQualities = pendingMovie.qualities || {};
          const qualityOrder = ['360p', '480p', '720p', '1080p'];
          let assignedQuality = null;

          for (const q of qualityOrder) {
            if (!existingQualities[q]) {
              assignedQuality = q;
              break;
            }
          }

          if (!assignedQuality) {
            await sendMessage(BOT_TOKEN, chatId, 
              '❌ همه کیفیت‌ها قبلاً ارسال شده‌اند.\n' +
              'اگر فیلم بیشتری دارید، دکمه "همه کیفیت‌ها رو فرستادم" رو بزنید.'
            );
            res.status(200).json({ ok: true });
            return;
          }

          const qualityField = `qualities.${assignedQuality}`;
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

          // بررسی اینکه آیا همه کیفیت‌ها کامل شده
          const updatedPending = await db.collection("pending_movies").findOne({ _id: pendingMovie._id });
          const currentQualities = updatedPending.qualities || {};
          const completedCount = Object.keys(currentQualities).length;

          await sendMessage(BOT_TOKEN, chatId, 
            `✅ فیلم با کیفیت ${assignedQuality} دریافت شد!\n` +
            `حجم: ${(fileSize / 1024 / 1024).toFixed(1)} MB\n\n` +
            `📊 کیفیت‌های ارسال شده: ${completedCount} از 4\n` +
            `${completedCount < 4 ? 'کیفیت‌های بعدی رو بفرست.' : 'همه کیفیت‌ها کامل شد!'}`
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
    // 📝 پیام متنی برای افزودن به لیست متن‌ها
    // ============================================================
    if (text && !text.startsWith('/') && text.length > 2) {
      const db = await getDb();
      
      // چک کردن اینکه آیا کاربر در حال افزودن متن است
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

      await sendMessage(BOT_TOKEN, chatId, 
        `📝 آیا می‌خواهید این متن را به لیست متن‌ها اضافه کنید؟\n\n"${previewText}"`,
        keyboard
      );

      res.status(200).json({ ok: true });
      return;
    }
  }

  // ============================================================
  // 📁 اگر هیچکدام از حالت‌ها نبود
  // ============================================================
  await sendMessage(BOT_TOKEN, chatId, 
    `❓ دستور نامعتبر.\n\n` +
    `لطفاً از دستور /start استفاده کنید.`
  );

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