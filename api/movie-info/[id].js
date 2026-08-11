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

    res.status(200).json({
      name: movie.name,
      description: movie.description || "بدون توضیحات",
      qualities: movie.qualities || {},
      bestQuality: movie.bestQuality || null,
    });

  } catch (err) {
    console.error("[movie-info] ❌ Error:", err);
    res.status(500).json({ error: "خطا در دریافت اطلاعات" });
  }
};