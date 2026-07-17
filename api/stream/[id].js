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

  console.log("[stream] ========================================");
  console.log("[stream] 🔍 NEW REQUEST");
  console.log("[stream] Slug:", requestedSlug);
  console.log("[stream] ========================================");

  if (!requestedSlug) {
    res.status(400).send("لینک ناقصه");
    return;
  }

  try {
    // 1. گرفتن از دیتابیس
    console.log("[stream] 📂 Step 1: Checking database...");
    const db = await getDb();
    const movie = await db.collection("movies").findOne({ name: requestedSlug });

    if (!movie) {
      console.log("[stream] ❌ Movie not found in database");
      res.status(404).send("فیلمی با این اسم پیدا نشد.");
      return;
    }

    console.log("[stream] ✅ Movie found in database:");
    console.log("[stream]    - name:", movie.name);
    console.log("[stream]    - messageId:", movie.messageId);
    console.log("[stream]    - channelUsername:", movie.channelUsername || process.env.CHANNEL_USERNAME);

    // 2. اتصال به تلگرام
    console.log("[stream] 📡 Step 2: Connecting to Telegram...");
    const client = await getClient();
    
    // 3. گرفتن کانال
    const channelUsername = movie.channelUsername || process.env.CHANNEL_USERNAME;
    console.log("[stream] 📢 Step 3: Getting channel:", channelUsername);
    
    let entity;
    try {
      entity = await client.getEntity(channelUsername);
      console.log("[stream] ✅ Channel found:");
      console.log("[stream]    - id:", entity.id);
      console.log("[stream]    - title:", entity.title || entity.username);
    } catch (err) {
      console.error("[stream] ❌ Channel not found:");
      console.error("[stream]    - Error:", err.message);
      console.error("[stream]    - Make sure the account is in the channel");
      res.status(500).send(`کانال پیدا نشد: ${err.message}`);
      return;
    }

    // 4. پیدا کردن پیام - روش اول
    console.log("[stream] 🔎 Step 4: Searching for message", movie.messageId);
    let message = null;
    
    try {
      console.log("[stream]    - Method 1: Direct getMessages...");
      const direct = await client.getMessages(entity, { ids: [movie.messageId] });
      
      if (direct && direct[0]) {
        console.log("[stream]    - Message found!");
        console.log("[stream]    - Has media:", !!direct[0].media);
        console.log("[stream]    - Has document:", !!(direct[0].media && direct[0].media.document));
        
        if (direct[0].media && direct[0].media.document) {
          message = direct[0];
          console.log("[stream] ✅ Message found with document!");
        } else {
          console.log("[stream] ⚠️ Message found but no document");
        }
      } else {
        console.log("[stream]    - No message found with ID:", movie.messageId);
      }
    } catch (e) {
      console.log("[stream] ❌ Method 1 failed:", e.message);
    }

    // 5. روش دوم: جستجو در پیام‌های اخیر
    if (!message) {
      console.log("[stream]    - Method 2: Searching recent messages...");
      try {
        const recent = await client.getMessages(entity, {
          limit: 100,
          filter: new Api.InputMessagesFilterDocument(),
        });
        console.log("[stream]    - Found", recent.length, "recent documents");
        
        // نمایش چند تا از آخرین پیام‌ها برای دیباگ
        recent.slice(0, 5).forEach((m, i) => {
          console.log(`[stream]    - [${i}] ID: ${m.id}, Has doc: ${!!(m.media && m.media.document)}`);
        });
        
        message = recent.find((m) => m.id === movie.messageId) || null;
        if (message) {
          console.log("[stream] ✅ Message found in recent messages!");
        } else {
          console.log("[stream]    - Message not found in recent messages");
        }
      } catch (e) {
        console.log("[stream] ❌ Method 2 failed:", e.message);
      }
    }

    // 6. اگر پیام پیدا نشد
    if (!message) {
      console.log("[stream] ❌ Message NOT FOUND!");
      console.log("[stream]    - Check if the message ID is correct");
      console.log("[stream]    - Check if the channel has the message");
      res.status(404).send("فایل روی تلگرام پیدا نشد.");
      return;
    }

    if (!message.media || !message.media.document) {
      console.log("[stream] ❌ Message has no document!");
      res.status(404).send("فایل روی تلگرام پیدا نشد.");
      return;
    }

    // 7. استریم کردن
    const doc = message.media.document;
    const fileSize = Number(doc.size);
    const mimeType = doc.mimeType || "video/mp4";
    
    console.log("[stream] ✅ File found:");
    console.log("[stream]    - Size:", fileSize, "bytes");
    console.log("[stream]    - MIME:", mimeType);

    const CHUNK_SIZE = 6 * 1024 * 1024;
    let start = 0;
    let end = fileSize - 1;
    const range = req.headers.range;

    if (range) {
      const match = /bytes=(\d+)-(\d*)/.exec(range);
      if (match) {
        start = parseInt(match[1], 10);
        if (match[2]) end = parseInt(match[2], 10);
      }
      console.log("[stream]    - Range:", range);
      console.log("[stream]    - Start:", start, "End:", end);
    }

    if (end - start + 1 > CHUNK_SIZE) {
      end = start + CHUNK_SIZE - 1;
    }
    if (end > fileSize - 1) end = fileSize - 1;

    console.log("[stream] 📤 Sending response:");
    console.log("[stream]    - Range:", `${start}-${end}/${fileSize}`);

    res.writeHead(206, {
      "Content-Type": mimeType,
      "Content-Length": end - start + 1,
      "Content-Range": `bytes ${start}-${end}/${fileSize}`,
      "Accept-Ranges": "bytes",
      "Cache-Control": "no-store",
    });

    console.log("[stream] ⬇️ Starting download...");
    const iter = client.iterDownload({
      file: message.media,
      offset: bigInt(start),
      limit: end - start + 1,
    });

    let bytesSent = 0;
    for await (const chunk of iter) {
      res.write(chunk);
      bytesSent += chunk.length;
    }
    
    console.log("[stream] ✅ Complete! Bytes sent:", bytesSent);
    res.end();

  } catch (err) {
    console.error("[stream] ❌ FATAL ERROR:");
    console.error("[stream]    - Message:", err.message);
    console.error("[stream]    - Stack:", err.stack);
    
    if (!res.headersSent) {
      res.status(500).send("خطا در پخش فایل: " + err.message);
    } else {
      res.end();
    }
  }
};