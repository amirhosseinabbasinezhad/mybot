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
      console.log("[stream] ✅ Connected");
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

  console.log("[stream] New request:", requestedSlug);

  if (!requestedSlug) {
    res.status(400).send("لینک ناقصه");
    return;
  }

  try {
    const db = await getDb();
    const movie = await db.collection("movies").findOne({ name: requestedSlug });

    if (!movie) {
      res.status(404).send("فیلمی با این اسم پیدا نشد.");
      return;
    }

    const client = await getClient();
    const channelUsername = movie.channelUsername || process.env.CHANNEL_USERNAME;

    let entity;
    try {
      entity = await client.getEntity(channelUsername);
    } catch (err) {
      console.error("[stream] Channel not found:", err.message);
      res.status(500).send("کانال پیدا نشد.");
      return;
    }

    let message = null;
    try {
      const direct = await client.getMessages(entity, { ids: [movie.messageId] });
      message = direct && direct[0] && direct[0].media && direct[0].media.document ? direct[0] : null;
    } catch (e) {
      console.log("[stream] Direct failed:", e.message);
    }

    if (!message) {
      try {
        const recent = await client.getMessages(entity, {
          limit: 100,
          filter: new Api.InputMessagesFilterDocument(),
        });
        message = recent.find((m) => m.id === movie.messageId) || null;
      } catch (e) {
        console.log("[stream] Fallback failed:", e.message);
      }
    }

    if (!message || !message.media || !message.media.document) {
      res.status(404).send("فایل روی تلگرام پیدا نشد.");
      return;
    }

    const doc = message.media.document;
    const fileSize = Number(doc.size);
    const mimeType = doc.mimeType || "video/mp4";

    // ========================================
    // ✅ تنظیمات برای کاهش مصرف اینترنت
    // ========================================
    const CHUNK_SIZE = 1 * 1024 * 1024; // 1 مگابایت (کمتر = مصرف کمتر)
    const REQUEST_SIZE = 64 * 1024; // 64KB

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

    // ========================================
    // ✅ هدرهای بهینه با کش
    // ========================================
    res.writeHead(206, {
      "Content-Type": mimeType,
      "Content-Length": end - start + 1,
      "Content-Range": `bytes ${start}-${end}/${fileSize}`,
      "Accept-Ranges": "bytes",
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "public, max-age=86400, stale-while-revalidate=86400", // ← کش ۲۴ ساعته
      "Connection": "keep-alive",
    });

    console.log(`[stream] Sending: ${start}-${end}/${fileSize}`);

    // ========================================
    // ✅ دانلود با تنظیمات کم مصرف
    // ========================================
    const iter = client.iterDownload({
      file: message.media,
      offset: bigInt(start),
      limit: end - start + 1,
      requestSize: REQUEST_SIZE,
      poolSize: 1, // ← فقط ۱ تا همزمان (کمترین مصرف)
    });

    let bytesSent = 0;
    let lastLog = Date.now();

    for await (const chunk of iter) {
      if (res.destroyed) break;
      res.write(chunk);
      bytesSent += chunk.length;

      if (Date.now() - lastLog > 10000) {
        const percent = ((bytesSent / (end - start + 1)) * 100).toFixed(1);
        console.log(`[stream] Progress: ${percent}%`);
        lastLog = Date.now();
      }
    }

    console.log(`[stream] ✅ Complete: ${bytesSent} bytes`);
    res.end();

  } catch (err) {
    console.error("[stream] ❌ Error:", err);
    if (!res.headersSent) {
      res.status(500).send("خطا در پخش فایل: " + err.message);
    } else {
      try {
        res.end();
      } catch (e) {}
    }
  }
};