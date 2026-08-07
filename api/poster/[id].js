const { TelegramClient, Api } = require("telegram");
const { StringSession } = require("telegram/sessions");
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
    clientPromise = client.connect().then(() => {
      console.log("[poster] ✅ Connected to Telegram");
      return client;
    }).catch(err => {
      console.error("[poster] ❌ Connection error:", err);
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

    if (!movie.posterMessageId) {
      res.status(404).send("پوستری برای این فیلم پیدا نشد");
      return;
    }

    const client = await getClient();
    const channelUsername = movie.channelUsername || process.env.CHANNEL_USERNAME;
    const entity = await client.getEntity(channelUsername);

    const messages = await client.getMessages(entity, { ids: [movie.posterMessageId] });
    const message = messages && messages[0];

    if (!message || !message.media || !message.media.photo) {
      res.status(404).send("پوستر پیدا نشد");
      return;
    }

    const file = await client.downloadMedia(message.media, {
      sizeType: "full",
    });

    res.setHeader("Content-Type", "image/jpeg");
    res.setHeader("Cache-Control", "public, max-age=86400");
    res.send(file);

  } catch (err) {
    console.error("[poster] ❌ Error:", err);
    res.status(500).send("خطا در دریافت پوستر: " + err.message);
  }
};