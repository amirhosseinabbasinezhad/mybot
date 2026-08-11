const { TelegramClient, Api } = require("telegram");
const { StringSession } = require("telegram/sessions");
const bigInt = require("big-integer");
const { getDb } = require("../../lib/db");

module.exports.config = {
  api: { bodyParser: false, responseLimit: false },
};

let clientPromise = null;

function getClient() {
  if (!clientPromise) {
    const apiId = parseInt(process.env.TG_API_ID, 10);
    const apiHash = process.env.TG_API_HASH;
    const session = new StringSession(process.env.SESSION_STRING);
    const client = new TelegramClient(session, apiId, apiHash, {
      connectionRetries: 5,
      timeout: 120,
    });
    clientPromise = client.connect().then(() => {
      console.log("[stream] ✅ Connected to Telegram");
      return client;
    }).catch(err => {
      console.error("[stream] ❌ Connection error:", err);
      throw err;
    });
  }
  return clientPromise;
}

module.exports = async (req, res) => {
  const requestedSlug = (req.query.id || "").toString().trim().toLowerCase();
  const requestedQuality = req.query.quality || "auto";

  console.log("[stream] 🔍 درخواست:", requestedSlug, "| کیفیت:", requestedQuality);

  if (!requestedSlug) {
    res.status(400).send("لینک ناقصه");
    return;
  }

  try {
    const db = await getDb();
    const movie = await db.collection("movies").findOne({ name: requestedSlug });

    if (!movie) {
      console.log("[stream] ❌ فیلم در دیتابیس پیدا نشد");
      res.status(404).send("فیلمی با این اسم پیدا نشد.");
      return;
    }

    console.log("[stream] ✅ فیلم پیدا شد:", movie.name);

    // ============================================================
    // 🎯 انتخاب کیفیت مناسب
    // ============================================================
    let messageId = movie.messageId; // حالت قبلی (برای兼容)

    // اگر کیفیت مشخص شده و در دیتابیس وجود داره
    if (requestedQuality !== "auto" && movie.qualities && movie.qualities[requestedQuality]) {
      messageId = movie.qualities[requestedQuality];
      console.log(`[stream] 📺 استفاده از کیفیت ${requestedQuality}p (messageId: ${messageId})`);
    } 
    // اگر کیفیت auto هست یا کیفیت مورد نظر وجود نداره، بهترین کیفیت موجود رو انتخاب کن
    else if (movie.qualities) {
      const qualities = ['1080', '720', '480', '360'];
      for (const q of qualities) {
        if (movie.qualities[q]) {
          messageId = movie.qualities[q];
          console.log(`[stream] 📺 استفاده از بهترین کیفیت موجود: ${q}p (messageId: ${messageId})`);
          break;
        }
      }
    }

    const client = await getClient();
    const channelUsername = movie.channelUsername || process.env.CHANNEL_USERNAME;
    const entity = await client.getEntity(channelUsername);

    // ============================================================
    // 🔍 پیدا کردن پیام
    // ============================================================
    let message = null;
    try {
      const direct = await client.getMessages(entity, { ids: [messageId] });
      message = direct && direct[0] && direct[0].media && direct[0].media.document ? direct[0] : null;
      if (message) console.log("[stream] ✅ پیام با messageId پیدا شد:", messageId);
    } catch (e) {
      console.log("[stream] روش مستقیم خطا:", e.message);
    }

    if (!message) {
      try {
        const recent = await client.getMessages(entity, {
          limit: 200,
          filter: new Api.InputMessagesFilterDocument(),
        });
        message = recent.find((m) => m.id === messageId) || null;
        if (message) console.log("[stream] ✅ پیام در لیست اخیر پیدا شد");
      } catch (e) {
        console.log("[stream] روش جایگزین خطا:", e.message);
      }
    }

    if (!message || !message.media || !message.media.document) {
      console.log("[stream] ❌ فایل روی تلگرام پیدا نشد");
      res.status(404).send("فایل روی تلگرام پیدا نشد.");
      return;
    }

    const doc = message.media.document;
    const fileSize = Number(doc.size);
    const mimeType = doc.mimeType || "video/mp4";

    console.log("[stream] ✅ فایل پیدا شد - حجم:", fileSize, "bytes");

    const CHUNK_SIZE = 5 * 1024 * 1024;

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
      "Cache-Control": "public, max-age=3600",
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
    for await (const chunk of iter) {
      if (res.destroyed) break;
      res.write(chunk);
      bytesSent += chunk.length;
    }

    console.log(`[stream] ✅ کامل شد: ${bytesSent} bytes`);
    res.end();

  } catch (err) {
    console.error("[stream] ❌ Error:", err);
    if (!res.headersSent) {
      res.status(500).send("خطا در پخش فایل: " + err.message);
    } else {
      res.end();
    }
  }
};