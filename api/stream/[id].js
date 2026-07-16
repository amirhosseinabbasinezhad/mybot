// این فانکشن با اکانت شخصی (Session String) به تلگرام وصل میشه و فایل رو
// تیکه‌تیکه (بر اساس Range که مرورگر/تلویزیون درخواست می‌ده) استریم می‌کنه.
// چون از طریق اکانت واقعی کاربر متصل میشه، محدودیت ۲۰ مگابایتی بات رو نداره.

const { TelegramClient } = require("telegram");
const { StringSession } = require("telegram/sessions");

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
  const { id } = req.query;
  const relayChatId = process.env.RELAY_CHAT_ID;

  if (!id) {
    res.status(400).send("شناسه فایل مشخص نیست");
    return;
  }

  try {
    const client = await getClient();
    const messages = await client.getMessages(relayChatId, { ids: [parseInt(id, 10)] });
    const message = messages && messages[0];

    if (!message || !message.media || !message.media.document) {
      res.status(404).send("فایل پیدا نشد");
      return;
    }

    const doc = message.media.document;
    const fileSize = Number(doc.size);
    const mimeType = doc.mimeType || "video/mp4";

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

    res.writeHead(range ? 206 : 200, {
      "Content-Type": mimeType,
      "Content-Length": end - start + 1,
      "Content-Range": `bytes ${start}-${end}/${fileSize}`,
      "Accept-Ranges": "bytes",
      "Cache-Control": "no-store",
    });

    const iter = client.iterDownload({
      file: message.media,
      offset: BigInt(start),
      limit: end - start + 1,
    });

    for await (const chunk of iter) {
      res.write(chunk);
    }
    res.end();
  } catch (err) {
    console.error(err);
    if (!res.headersSent) {
      res.status(500).send("خطا در پخش فایل");
    } else {
      res.end();
    }
  }
};
