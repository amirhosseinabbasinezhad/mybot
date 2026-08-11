const { getDb } = require("../../lib/db");

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") {
    res.status(200).end();
    return;
  }

  const requestedSlug = (req.query.id || "").toString().trim().toLowerCase();

  console.log("[movie-info] 🔍 دریافت اطلاعات فیلم:", requestedSlug);

  if (!requestedSlug) {
    return res.status(400).json({ error: "لینک ناقصه" });
  }

  try {
    const db = await getDb();
    const movie = await db.collection("movies").findOne({ name: requestedSlug });

    if (!movie) {
      console.log("[movie-info] ❌ فیلم پیدا نشد:", requestedSlug);
      return res.status(404).json({ error: "فیلم پیدا نشد" });
    }

    console.log("[movie-info] ✅ فیلم پیدا شد:", movie.name);

    // === بخش جدید: استخراج لیست کیفیت‌ها ===
    let qualitiesArray = [];
    let bestQuality = movie.bestQuality || null;

    if (movie.qualities && typeof movie.qualities === 'object') {
      // اگر qualities یک آبجکت است (مثلاً { "1080p": "...", "720p": "..." })
      // کلیدهای آبجکت را به عنوان لیست کیفیت برمی‌گردانیم
      qualitiesArray = Object.keys(movie.qualities);
      
      // اگر bestQuality در دیتابیس خالی بود، بالاترین کیفیت موجود را به عنوان بهترین انتخاب می‌کنیم
      if (!bestQuality && qualitiesArray.length > 0) {
        // مرتب‌سازی عددی (مثلاً 1080p از 720p بزرگتر است)
        const sortedQualities = qualitiesArray.sort((a, b) => {
          const numA = parseInt(a);
          const numB = parseInt(b);
          return numB - numA; // نزولی (بزرگترین اول)
        });
        bestQuality = sortedQualities[0];
      }
    } else if (Array.isArray(movie.qualities)) {
      // اگر qualities یک آرایه است (مثلاً ["1080p", "720p"])
      qualitiesArray = movie.qualities;
    }

    res.status(200).json({
      name: movie.name,
      description: movie.description || "بدون توضیحات",
      qualities: qualitiesArray,        // آرایه‌ای از نام کیفیت‌ها (مثلاً ["1080p", "720p"])
      bestQuality: bestQuality          // بهترین کیفیت پیشنهادی
    });

  } catch (err) {
    console.error("[movie-info] ❌ Error:", err);
    res.status(500).json({ error: "خطا در دریافت اطلاعات" });
  }
};