// این اسکریپت رو فقط یه بار، روی کامپیوتر خودتون (نه روی Vercel) اجرا می‌کنید
// تا با اکانت شخصی (یا اکانت جدید مخصوص این کار) لاگین بشید و "Session String" بگیرید.
//
// اجرا با:  TG_API_ID=xxx TG_API_HASH=xxx node scripts/login.js

const { TelegramClient } = require("telegram");
const { StringSession } = require("telegram/sessions");
const input = require("input");

const apiId = parseInt(process.env.TG_API_ID, 10);
const apiHash = process.env.TG_API_HASH;

if (!apiId || !apiHash) {
  console.error("لطفا اول TG_API_ID و TG_API_HASH رو از my.telegram.org بگیرید و ست کنید.");
  process.exit(1);
}

(async () => {
  console.log("در حال اتصال به تلگرام...");
  const client = new TelegramClient(new StringSession(""), apiId, apiHash, {
    connectionRetries: 5,
  });

  await client.start({
    phoneNumber: async () => await input.text("شماره تلفن (با کد کشور، مثلا +98912...): "),
    password: async () => await input.text("رمز دو مرحله‌ای (اگر فعال نکردید، Enter بزنید): "),
    phoneCode: async () => await input.text("کدی که تلگرام براتون فرستاد: "),
    onError: (err) => console.log(err),
  });

  console.log("\n✅ لاگین موفق بود!");
  console.log("این رشته رو کپی کنید و توی تنظیمات Vercel به عنوان متغیر SESSION_STRING ذخیره کنید:\n");
  console.log(client.session.save());
  console.log("\n⚠️ این رشته معادل رمز عبور اکانتتونه، جایی به اشتراک نذارید.");

  await client.disconnect();
  process.exit(0);
})();
