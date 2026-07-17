const { getDb } = require("../lib/db");

module.exports = async (req, res) => {
  try {
    const db = await getDb();
    const movies = await db
      .collection("movies")
      .find({}, { projection: { name: 1, createdAt: 1, _id: 0 } })
      .sort({ createdAt: -1 })
      .toArray();

    res.status(200).json(movies);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "خطا در گرفتن لیست فیلم‌ها" });
  }
};
