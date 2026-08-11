const { getDb } = require("../lib/db");

// ============================================================
// 📦 وضعیت‌های کاربر
// ============================================================

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
  if (callback) console.log("[bot] 📞 Callback:", callback.data);

  // ============================================================
  // 📞 مدیریت Callback (دکمه‌های شیشه‌ای)
  // ============================================================
  if (callback) {
    const data = callback.data;
    const chatId = callback.message.chat.id;
    const fromId = String((callback.from && callback.from.id) || "");
    const messageId = callback.message.message_id;

    if (ALLOWED_USER_IDS.length > 0 && !ALLOWED_USER_IDS.includes(fromId)) {
      await sendMessage(BOT_TOKEN, chatId, "متاسفم، اجازه استفاده از این بات رو نداری.");
      res.status(200).json({ ok: true });
      return;
    }

    const db = await getDb();

    // ===== دکمه /start از منو =====
    if (data === 'start_menu') {
      const keyboard = {
        inline_keyboard: [
          [
            { text: '🎬 افزودن فیلم', callback_data: 'start_new_movie' },
            { text: '📝 افزودن متن', callback_data: 'start_new_text' }
          ]
        ]
      };

      await sendMessage(BOT_TOKEN, chatId, 
        `🎬 به ربات فیلم‌پروکسی خوش آمدید!\n\n` +
        `لطفاً یکی از گزینه‌های زیر رو انتخاب کنید:`,
        keyboard
      );

      res.status(200).json({ ok: true });
      return;
    }

    // ===== دکمه "افزودن فیلم" =====
    if (data === 'start_new_movie') {
      await db.collection("pending_movies").deleteMany({ userId: fromId });

      await db.collection("pending_movies").insertOne({
        userId: fromId,
        status: 'waiting_for_movie_name',
        createdAt: new Date(),
      });

      await sendMessage(BOT_TOKEN, chatId, 
        `🎬 اسم فیلم رو وارد کنید.\n\n` +
        `(فقط حروف انگلیسی و اعداد، بدون فاصله - به جای فاصله از - استفاده کنید)\n` +
        `مثال: The-Last-Dance`
      );

      res.status(200).json({ ok: true });
      return;
    }

    // ===== دکمه "افزودن متن" =====
    if (data === 'start_new_text') {
      await sendMessage(BOT_TOKEN, chatId, 
        `📝 متن مورد نظر رو تایپ کنید.\n\n` +
        `(متن می‌تونه فارسی یا انگلیسی باشه)`
      );

      res.status(200).json({ ok: true });
      return;
    }

    // ===== دکمه "همه قسمت‌ها رو فرستادم" =====
    if (data === 'all_qualities_sent') {
      const pending = await db.collection("pending_movies").findOne({
        userId: fromId,
        status: 'waiting_for_quality'
      });

      if (!pending) {
        await sendMessage(BOT_TOKEN, chatId, '❌ مشکلی پیش اومد. دوباره تلاش کن.');
        res.status(200).json({ ok: true });
        return;
      }

      const qualities = ['360', '480', '720', '1080'];
      const allExist = qualities.every(q => pending.qualities && pending.qualities[q]);

      if (!allExist) {
        const missing = qualities.filter(q => !pending.qualities || !pending.qualities[q]);
        await sendMessage(BOT_TOKEN, chatId, `❌ هنوز همه کیفیت‌ها رو نفرستادی!\nکیفیت‌های باقی‌مانده: ${missing.join(', ')}`);
        res.status(200).json({ ok: true });
        return;
      }

      await db.collection("movies").insertOne({
        name: pending.movieName,
        channelUsername: CHANNEL_USERNAME,
        posterMessageId: pending.posterMessageId,
        qualities: pending.qualities,
        createdAt: new Date(),
        userId: fromId,
      });

      await db.collection("pending_movies").deleteOne({ _id: pending._id });

      const link = `${BASE_URL}/watch.html?id=${encodeURIComponent(pending.movieName)}`;
      await sendMessage(BOT_TOKEN, chatId, 
        `✅ فیلم با موفقیت ذخیره شد!\n\n` +
        `🎬 ${pending.movieName}\n` +
        `📺 کیفیت‌ها: 360p, 480p, 720p, 1080p\n` +
        `🔗 لینک: ${link}`
      );

      res.status(200).json({ ok: true });
      return;
    }

    // ===== دکمه‌های کیفیت =====
    if (data.startsWith('quality_')) {
      const quality = data.replace('quality_', '');
      const qualityMap = {
        '360': 'کیفیت ۳۶۰',
        '480': 'کیفیت ۴۸۰',
        '720': 'کیفیت ۷۲۰',
        '1080': 'کیفیت ۱۰۸۰'
      };

      const pending = await db.collection("pending_movies").findOne({
        userId: fromId,
        status: 'waiting_for_quality'
      });

      if (!pending) {
        await sendMessage(BOT_TOKEN, chatId, '❌ مشکلی پیش اومد. دوباره تلاش کن.');
        res.status(200).json({ ok: true });
        return;
      }

      if (!pending.qualities) pending.qualities = {};

      if (pending.qualities[quality]) {
        await sendMessage(BOT_TOKEN, chatId, `⏳ ${qualityMap[quality]} قبلاً ارسال شده. کیفیت بعدی رو بفرست.`);
        res.status(200).json({ ok: true });
        return;
      }

      await db.collection("pending_movies").updateOne(
        { _id: pending._id },
        { $set: { currentQuality: quality } }
      );

      await sendMessage(BOT_TOKEN, chatId, 
        `📤 لطفاً فایل ${qualityMap[quality]} رو بفرست.\n\n` +
        `(فایل ویدیویی با کیفیت ${quality}p)`
      );

      res.status(200).json({ ok: true });
      return;
    }

    res.status(200).json({ ok: true });
    return;
  }

  // ============================================================
  // 📥 مدیریت پیام‌ها
  // ============================================================
  if (!message) {
    res.status(200).json({ ok: true });
    return;
  }

  const chatId = message.chat.id;
  const fromId = String((message.from && message.from.id) || "");
  const hasFile = message.document || message.video || message.audio;
  const hasPhoto = message.photo && message.photo.length > 0;
  const text = message.text || "";

  console.log("[bot] 📝 از:", fromId, "متن:", text, "فایل:", !!hasFile, "عکس:", !!hasPhoto);

  if (ALLOWED_USER_IDS.length > 0 && !ALLOWED_USER_IDS.includes(fromId)) {
    await sendMessage(BOT_TOKEN, chatId, "متاسفم، اجازه استفاده از این بات رو نداری.");
    res.status(200).json({ ok: true });
    return;
  }

  const db = await getDb();

  // ============================================================
  // 🏠 دستور /start
  // ============================================================
  if (text === '/start') {
    const keyboard = {
      inline_keyboard: [
        [
          { text: '🎬 افزودن فیلم', callback_data: 'start_new_movie' },
          { text: '📝 افزودن متن', callback_data: 'start_new_text' }
        ]
      ]
    };

    await sendMessage(BOT_TOKEN, chatId, 
      `🎬 به ربات فیلم‌پروکسی خوش آمدید!\n\n` +
      `لطفاً یکی از گزینه‌های زیر رو انتخاب کنید:`,
      keyboard
    );

    res.status(200).json({ ok: true });
    return;
  }

  // ============================================================
  // 📝 مدیریت متن (افزودن متن یا اسم فیلم)
  // ============================================================
  if (text && !text.startsWith('/') && !hasFile && !hasPhoto) {
    // ===== چک کردن اینکه کاربر در حالت waiting_for_movie_name هست =====
    const pending = await db.collection("pending_movies").findOne({
      userId: fromId,
      status: 'waiting_for_movie_name'
    });

    if (pending) {
      // ===== دریافت اسم فیلم =====
      const movieName = text.trim().replace(/\s+/g, '-').toLowerCase();

      if (!/^[a-zA-Z0-9\-]+$/.test(movieName)) {
        await sendMessage(BOT_TOKEN, chatId, 
          '❌ اسم فیلم باید فقط شامل حروف انگلیسی، اعداد و "-" باشه.\n' +
          'مثال: The-Last-Dance'
        );
        res.status(200).json({ ok: true });
        return;
      }

      const existing = await db.collection("movies").findOne({ name: movieName });
      if (existing) {
        await sendMessage(BOT_TOKEN, chatId, 
          `❌ فیلمی با اسم "${movieName}" قبلاً وجود داره.\n` +
          `لطفاً اسم دیگه‌ای انتخاب کن.`
        );
        res.status(200).json({ ok: true });
        return;
      }

      await db.collection("pending_movies").updateOne(
        { _id: pending._id },
        { 
          $set: { 
            movieName: movieName,
            status: 'waiting_for_poster'
          } 
        }
      );

      await sendMessage(BOT_TOKEN, chatId, 
        `✅ اسم فیلم ثبت شد: "${movieName}"\n\n` +
        `🖼️ حالا پوستر فیلم رو بفرست (یه عکس).`
      );

      res.status(200).json({ ok: true });
      return;
    }

    // ===== افزودن متن (اگر در حالت waiting_for_movie_name نبود) =====
    await db.collection("texts").insertOne({
      text: text.trim(),
      createdAt: new Date(),
      updatedAt: new Date(),
      userId: fromId,
    });

    await sendMessage(BOT_TOKEN, chatId, `✅ متن با موفقیت اضافه شد:\n\n"${text.trim()}"`);

    res.status(200).json({ ok: true });
    return;
  }

  // ============================================================
  // 🖼️ دریافت پوستر (عکس)
  // ============================================================
  if (hasPhoto) {
    const pending = await db.collection("pending_movies").findOne({
      userId: fromId,
      status: 'waiting_for_poster'
    });

    if (pending) {
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
          { _id: pending._id },
          { 
            $set: { 
              posterMessageId: posterMessageId,
              status: 'waiting_for_quality',
              qualities: {},
              currentQuality: '360'
            } 
          }
        );

        const keyboard = {
          inline_keyboard: [
            [{ text: '📺 کیفیت 360', callback_data: 'quality_360' }],
            [{ text: '📺 کیفیت 480', callback_data: 'quality_480' }],
            [{ text: '📺 کیفیت 720', callback_data: 'quality_720' }],
            [{ text: '📺 کیفیت 1080', callback_data: 'quality_1080' }],
            [{ text: '✅ همه قسمت‌ها رو فرستادم', callback_data: 'all_qualities_sent' }]
          ]
        };

        await sendMessage(BOT_TOKEN, chatId, 
          `✅ پوستر با موفقیت ذخیره شد!\n\n` +
          `🎬 فیلم: ${pending.movieName}\n\n` +
          `📤 حالا کیفیت‌های مختلف فیلم رو بفرست.\n` +
          `از کیفیت ۳۶۰ شروع کن و به ترتیب برو بالا.\n\n` +
          `هر کیفیت رو که می‌فرستی، روی دکمه مربوطه کلیک کن.`,
          keyboard
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
  // 🎬 دریافت فایل (کیفیت‌های فیلم)
  // ============================================================
  if (hasFile) {
    const pending = await db.collection("pending_movies").findOne({
      userId: fromId,
      status: 'waiting_for_quality'
    });

    if (pending && pending.currentQuality) {
      const quality = pending.currentQuality;
      const qualityMap = {
        '360': 'کیفیت ۳۶۰',
        '480': 'کیفیت ۴۸۰',
        '720': 'کیفیت ۷۲۰',
        '1080': 'کیفیت ۱۰۸۰'
      };

      try {
        const forwardFile = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/forwardMessage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: CHANNEL_USERNAME,
            from_chat_id: chatId,
            message_id: message.message_id,
          }),
        });

        const fileResult = await forwardFile.json();

        if (!fileResult.ok) {
          throw new Error(fileResult.description || "خطا در ارسال فیلم");
        }

        const fileMessageId = fileResult.result.message_id;

        const updateQuery = {};
        updateQuery[`qualities.${quality}`] = fileMessageId;

        await db.collection("pending_movies").updateOne(
          { _id: pending._id },
          { $set: updateQuery }
        );

        const qualities = ['360', '480', '720', '1080'];
        const currentIndex = qualities.indexOf(quality);
        const nextQuality = qualities[currentIndex + 1];

        if (nextQuality) {
          await db.collection("pending_movies").updateOne(
            { _id: pending._id },
            { $set: { currentQuality: nextQuality } }
          );

          await sendMessage(BOT_TOKEN, chatId, 
            `✅ ${qualityMap[quality]} با موفقیت ذخیره شد!\n\n` +
            `📤 حالا ${qualityMap[nextQuality]} رو بفرست.`
          );
        } else {
          await db.collection("pending_movies").updateOne(
            { _id: pending._id },
            { $set: { currentQuality: null } }
          );

          await sendMessage(BOT_TOKEN, chatId, 
            `✅ همه کیفیت‌ها با موفقیت ذخیره شدند!\n\n` +
            `برای نهایی کردن، دکمه "همه قسمت‌ها رو فرستادم" رو بزن.`
          );
        }

      } catch (err) {
        console.error("[bot] ❌ Error saving quality:", err);
        await sendMessage(BOT_TOKEN, chatId, `❌ خطا در ذخیره ${qualityMap[quality]}. دوباره تلاش کن.`);
      }

      res.status(200).json({ ok: true });
      return;
    }
  }

  // ============================================================
  // 🎬 اگر هیچکدام از حالت‌ها نبود
  // ============================================================
  const keyboard = {
    inline_keyboard: [
      [
        { text: '🎬 افزودن فیلم', callback_data: 'start_new_movie' },
        { text: '📝 افزودن متن', callback_data: 'start_new_text' }
      ]
    ]
  };

  await sendMessage(BOT_TOKEN, chatId, 
    `❓ دستور نامعتبر.\n\n` +
    `لطفاً از دکمه‌های زیر استفاده کنید:`,
    keyboard
  );

  res.status(200).json({ ok: true });
};

// ============================================================
// 🛠 توابع کمکی
// ============================================================

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