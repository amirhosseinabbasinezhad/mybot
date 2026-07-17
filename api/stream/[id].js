const { TelegramClient, Api } = require("telegram");
const { StringSession } = require("telegram/sessions");
const bigInt = require("big-integer");
const { getDb } = require("../../lib/db");

module.exports.config = {
  api: {
    bodyParser: false,
    responseLimit: false,
    externalResolver: true,
  },
};

// ============================================
// 🚀 نگه‌داری اتصال در حافظه (برای سرعت بیشتر)
// ============================================
let clientInstance = null;
let clientPromise = null;
let lastUsed = Date.now();

async function getCachedClient() {
  // اگر کلاینت وجود داره و کمتر از ۵ دقیقه از آخرین استفاده گذشته
  if (clientInstance && (Date.now() - lastUsed < 300000)) {
    console.log("[stream] ♻️ استفاده از اتصال قبلی");
    lastUsed = Date.now();
    return clientInstance;
  }

  // اگر کلاینت قدیمی شده، ببندش
  if (clientInstance) {
    console.log("[stream] 🔄 اتصال قدیمی، وصل مجدد...");
    try {
      await clientInstance.disconnect();
    } catch (e) {}
    clientInstance = null;
    clientPromise = null;
  }

  // اتصال جدید
  console.log("[stream] 🔌 اتصال جدید به تلگرام...");
  const apiId = parseInt(process.env.TG_API_ID, 10);
  const apiHash = process.env.TG_API_HASH;
  const session = new StringSession(process.env.SESSION_STRING);
  
  const client = new TelegramClient(session, apiId, apiHash, {
    connectionRetries: 5,
    timeout: 120,
    keepAlive: true,
  });

  clientPromise = client.connect().then(() => {
    console.log("[stream] ✅ به تلگرام وصل شد");
    clientInstance = client;
    lastUsed = Date.now();
    return client;
  }).catch(err => {
    console.error("[stream] ❌ خطا در اتصال:", err.message);
    clientInstance = null;
    clientPromise = null;
    throw err;
  });

  return clientPromise;
}

async function closeConnection() {
  if (clientInstance) {
    try {
      await clientInstance.disconnect();
      console.log("[stream] 🔌 اتصال بسته شد");
    } catch (e) {}
    clientInstance = null;
    clientPromise = null;
  }
}
// ============================================

module.exports = async (req, res) => {
  const requestedSlug = (req.query.id || "").toString().trim().toLowerCase();

  console.log("[stream] ========================================");
  console.log("[stream] 📺 درخواست جدید:", requestedSlug);
  console.log("[stream] ========================================");

  if (!requestedSlug) {
    res.status(400).send("لینک ناقصه");
    return;
  }

  req.setTimeout(180000);
  res.setTimeout(180000);

  try {
    // 1. گرفتن از دیتابیس
    console.log("[stream] 📂 مرحله 1: جستجو در دیتابیس...");
    const db = await getDb();
    const movie = await db.collection("movies").findOne({ name: requestedSlug });

    if (!movie) {
      console.log("[stream] ❌ فیلم پیدا نشد");
      res.status(404).send("فیلمی با این اسم پیدا نشد.");
      return;
    }

    console.log("[stream] ✅ فیلم پیدا شد - messageId:", movie.messageId);

    // 2. گرفتن کلاینت (از کش یا جدید)
    console.log("[stream] 📡 مرحله 2: گرفتن کلاینت تلگرام...");
    const client = await getCachedClient();
    
    // 3. گرفتن کانال
    const channelUsername = movie.channelUsername || process.env.CHANNEL_USERNAME;
    console.log("[stream] 📢 مرحله 3: گرفتن کانال:", channelUsername);
    
    let entity;
    try {
      entity = await client.getEntity(channelUsername);
      console.log("[stream] ✅ کانال پیدا شد");
    } catch (err) {
      console.error("[stream] ❌ کانال پیدا نشد:", err.message);
      await closeConnection();
      res.status(500).send("کانال پیدا نشد.");
      return;
    }

    // 4. پیدا کردن پیام
    console.log("[stream] 🔎 مرحله 4: پیدا کردن پیام...");
    let message = null;
    
    try {
      const direct = await client.getMessages(entity, { ids: [movie.messageId] });
      message = direct && direct[0] && direct[0].media && direct[0].media.document ? direct[0] : null;
      if (message) console.log("[stream] ✅ پیام مستقیم پیدا شد");
    } catch (e) {
      console.log("[stream] روش مستقیم خطا:", e.message);
    }

    if (!message) {
      try {
        const recent = await client.getMessages(entity, {
          limit: 100,
          filter: new Api.InputMessagesFilterDocument(),
        });
        message = recent.find((m) => m.id === movie.messageId) || null;
        if (message) console.log("[stream] ✅ پیام در لیست اخیر پیدا شد");
      } catch (e) {
        console.log("[stream] روش جایگزین خطا:", e.message);
      }
    }

    if (!message || !message.media || !message.media.document) {
      console.log("[stream] ❌ پیام پیدا نشد");
      res.status(404).send("فایل روی تلگرام پیدا نشد.");
      return;
    }

    const doc = message.media.document;
    const fileSize = Number(doc.size);
    const mimeType = doc.mimeType || "video/mp4";

    console.log("[stream] ✅ فایل پیدا شد - حجم:", fileSize, "bytes");

    // 5. استریم کردن
    const CHUNK_SIZE = 3 * 1024 * 1024; // 3 مگابایت (برای اینترنت کند)

    let start = 0;
    let end = fileSize - 1;
    const range = req.headers.range;

    if (range) {
      const match = /bytes=(\d+)-(\d*)/.exec(range);
      if (match) {
        start = parseInt(match[1], 10);
        if (match[2]) end = parseInt(match[2], 10);
      }
    }

    if (end - start + 1 > CHUNK_SIZE) {
      end = start + CHUNK_SIZE - 1;
    }
    if (end > fileSize - 1) end = fileSize - 1;

    res.writeHead(206, {
      "Content-Type": mimeType,
      "Content-Length": end - start + 1,
      "Content-Range": `bytes ${start}-${end}/${fileSize}`,
      "Accept-Ranges": "bytes",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
      "Access-Control-Allow-Headers": "Range, Content-Range, Accept-Encoding",
      "Access-Control-Expose-Headers": "Content-Range, Accept-Ranges, Content-Length",
      "Cache-Control": "public, max-age=3600",
      "Connection": "keep-alive",
      "Keep-Alive": "timeout=120, max=100",
    });

    console.log(`[stream] 📤 ارسال: ${start}-${end}/${fileSize}`);

    const iter = client.iterDownload({
      file: message.media,
      offset: bigInt(start),
      limit: end - start + 1,
      requestSize: 256 * 1024,
      poolSize: 2,
    });

    let bytesSent = 0;
    let lastLog = Date.now();

    for await (const chunk of iter) {
      if (res.destroyed) {
        console.log("[stream] اتصال قطع شد");
        break;
      }

      res.write(chunk);
      bytesSent += chunk.length;

      if (Date.now() - lastLog > 10000) {
        const percent = ((bytesSent / (end - start + 1)) * 100).toFixed(1);
        console.log(`[stream] پیشرفت: ${percent}%`);
        lastLog = Date.now();
      }
    }

    console.log(`[stream] ✅ کامل شد: ${bytesSent} bytes`);
    res.end();

  } catch (err) {
    console.error("[stream] ❌ خطا:", err.message);
    console.error("[stream] Stack:", err.stack);
    await closeConnection();
    if (!res.headersSent) {
      res.status(500).send("خطا در پخش فایل: " + err.message);
    } else {
      try {
        res.end();
      } catch (e) {}
    }
  }
};

// ============================================
// 🧹 هر ۱۰ دقیقه اتصال قدیمی رو پاک کن
// ============================================
setInterval(() => {
  if (clientInstance && (Date.now() - lastUsed > 600000)) {
    console.log("[stream] 🧹 پاک کردن اتصال قدیمی");
    closeConnection();
  }
}, 600000);