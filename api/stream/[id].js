// این فانکشن با اکانت شخصی (Session String) به تلگرام وصل میشه و فایل رو
// تیکه‌تیکه (بر اساس Range که مرورگر/تلویزیون درخواست می‌ده) استریم می‌کنه.
// اسم فیلم رو تو MongoDB جستجو می‌کنه تا شناسه دقیق پیام رو پیدا کنه.

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
      connectionRetries: 3,
    });
    clientPromise = client.connect().then(() => client);
  }
  return clientPromise;
}

module.exports = async (req, res) => {
  const botUsername = process.env.RELAY_BOT_USERNAME;
  const requestedSlug = (req.query.id || "").toString().trim().toLowerCase();

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
    const entity = await client.getEntity(botUsername);

    // روش ۱: مستقیم با شناسه (سریع‌تر، ولی گاهی جواب نمی‌ده)
    let message = null;
    try {
      const direct = await client.getMessages(entity, { ids: [movie.messageId] });
      message = direct && direct[0] && direct[0].media && direct[0].media.document ? direct[0] : null;
    } catch (e) {
      console.log("[stream] روش مستقیم جواب نداد:", e.message);
    }

    // روش ۲ (fallback): گشتن وسط لیست فایل‌ها
    if (!message) {
      console.log("[stream] رفتن سراغ روش fallback...");
      const recent = await client.getMessages(entity, {
        limit: 200,
        filter: new Api.InputMessagesFilterDocument(),
      });
      message = recent.find((m) => m.id === movie.messageId) || null;
    }

    if (!message || !message.media || !message.media.document) {
      res.status(404).send("فایل روی تلگرام پیدا نشد (شاید پاک شده باشه).");
      return;
    }

    const doc = message.media.document;
    const fileSize = Number(doc.size);
    const mimeType = doc.mimeType || "video/mp4";
    const CHUNK_SIZE = 6 * 1024 * 1024; // 6 مگابایت به ازای هر درخواست

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
      "Cache-Control": "no-store",
    });

    const iter = client.iterDownload({
      file: message.media,
      offset: bigInt(start),
      limit: end - start + 1,
    });

    for await (const chunk of iter) {
      res.write(chunk);
    }
    res.end();
  } catch (err) {
    console.error("[stream] خطا:", err);
    if (!res.headersSent) {
      res.status(500).send("خطا در پخش فایل");
    } else {
      res.end();
    }
  }
};