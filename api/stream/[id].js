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
    const entity = await client.getEntity(channelUsername);

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
          limit: 200,
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

    res.end();

  } catch (err) {
    console.error("[stream] ❌ Error:", err);
    if (!res.headersSent) {
      res.status(500).send("خطا در پخش فایل");
    } else {
      res.end();
    }
  }
};