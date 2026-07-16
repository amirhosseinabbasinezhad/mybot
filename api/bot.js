// این فانکشن webhook باته که تلگرام هر پیام جدید رو بهش می‌فرسته.
// وقتی یه فایل ویدیویی دریافت کنه، اونو به چت رله (اکانت شخصی/یوزربات) فوروارد می‌کنه
// و یه لینک پخش برمی‌گردونه.

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.status(200).send("OK");
    return;
  }
 
  
  const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
  const RELAY_CHAT_ID = process.env.RELAY_CHAT_ID; // آیدی عددی چت اکانت شخصی با این بات
  const BASE_URL = process.env.PUBLIC_BASE_URL; // مثلا https://yourapp.vercel.app

  const update = req.body;
  const message = update && update.message;

  if (!message) {
    res.status(200).json({ ok: true });
    return;
  }

  const chatId = message.chat.id;
  const hasFile = message.document || message.video || message.audio;

  if (!hasFile) {
    await sendMessage(BOT_TOKEN, chatId, "یه فایل ویدیویی یا فیلم برام بفرست تا لینک پخشش رو بدم.");
    res.status(200).json({ ok: true });
    return;
  }

  try {
    const forwarded = await forwardMessage(BOT_TOKEN, RELAY_CHAT_ID, chatId, message.message_id);

    if (!forwarded.ok) {
      throw new Error(JSON.stringify(forwarded));
    }

    const msgId = forwarded.result.message_id;
    const link = `${BASE_URL}/watch.html?id=${msgId}`;
    await sendMessage(
      BOT_TOKEN,
      chatId,
      `لینک پخش آماده شد:\n${link}\n\nاین لینک رو تو مرورگر تلویزیون یا هر مرورگری باز کن.`
    );
  } catch (err) {
    console.error(err);
    await sendMessage(BOT_TOKEN, chatId, "یه مشکلی پیش اومد. مطمئن شو اکانت رله یه بار /start رو به این بات زده. دوباره امتحان کن.");
  }

  res.status(200).json({ ok: true });
};

async function sendMessage(token, chatId, text) {
  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text }),
  });
}

async function forwardMessage(token, toChatId, fromChatId, messageId) {
  const r = await fetch(`https://api.telegram.org/bot${token}/forwardMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: toChatId,
      from_chat_id: fromChatId,
      message_id: messageId,
    }),
  });
  return r.json();
}
