const { getDb } = require("../lib/db");
const jwt = require("jsonwebtoken");
const JWT_SECRET = process.env.JWT_SECRET || "your-secret-key";

module.exports = async (req, res) => {
  // ============================================================
  // 🔐 بررسی توکن
  // ============================================================
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return res.status(401).json({ error: "احراز هویت لازم است" });
  }

  try {
    const token = authHeader.split(" ")[1];
    jwt.verify(token, JWT_SECRET);
  } catch (err) {
    return res.status(401).json({ error: "توکن نامعتبر" });
  }

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