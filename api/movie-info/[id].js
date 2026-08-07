const { getDb } = require("../../lib/db");

module.exports = async (req, res) => {
  const requestedSlug = (req.query.id || "").toString().trim().toLowerCase();

  if (!requestedSlug) {
    res.status(400).json({ error: "لینک ناقصه" });
    return;
  }

  try {
    const db = await getDb();
    const movie = await db.collection("movies").findOne({ name: requestedSlug });

    if (!movie) {
      res.status(404).json({ error: "فیلم پیدا نشد" });
      return;
    }

    res.status(200).json({
      name: movie.name,
      description: movie.description || "بدون توضیحات",
    });

  } catch (err) {
    console.error("[movie-info] ❌ Error:", err);
    res.status(500).json({ error: "خطا در دریافت اطلاعات" });
  }
};