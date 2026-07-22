const { getDb } = require("../lib/db");

module.exports = async (req, res) => {
  // تنظیم CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.status(200).end();
    return;
  }

  try {
    const db = await getDb();
    const collection = db.collection("texts");

    // ===== GET: دریافت همه متن‌ها =====
    if (req.method === "GET") {
      const texts = await collection
        .find({})
        .sort({ createdAt: -1 })
        .toArray();
      
      res.status(200).json(texts);
      return;
    }

    // ===== POST: افزودن متن جدید =====
    if (req.method === "POST") {
      const { text } = req.body;
      
      if (!text || text.trim().length === 0) {
        res.status(400).json({ error: "متن وارد نشده است" });
        return;
      }

      const newText = {
        text: text.trim(),
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const result = await collection.insertOne(newText);
      
      res.status(201).json({
        success: true,
        id: result.insertedId,
        ...newText,
      });
      return;
    }

    // ===== PUT: ویرایش متن =====
    if (req.method === "PUT") {
      const { id, text } = req.body;
      
      if (!id || !text || text.trim().length === 0) {
        res.status(400).json({ error: "اطلاعات ناقص است" });
        return;
      }

      const { ObjectId } = require("mongodb");
      const result = await collection.updateOne(
        { _id: new ObjectId(id) },
        { 
          $set: { 
            text: text.trim(),
            updatedAt: new Date() 
          } 
        }
      );

      if (result.matchedCount === 0) {
        res.status(404).json({ error: "متن پیدا نشد" });
        return;
      }

      res.status(200).json({ success: true });
      return;
    }

    // ===== DELETE: حذف متن =====
    if (req.method === "DELETE") {
      const { id } = req.query;
      
      if (!id) {
        res.status(400).json({ error: "شناسه متن وارد نشده است" });
        return;
      }

      const { ObjectId } = require("mongodb");
      const result = await collection.deleteOne({ _id: new ObjectId(id) });

      if (result.deletedCount === 0) {
        res.status(404).json({ error: "متن پیدا نشد" });
        return;
      }

      res.status(200).json({ success: true });
      return;
    }

    res.status(405).json({ error: "روش غیرمجاز" });
  } catch (err) {
    console.error("❌ Error in texts API:", err);
    res.status(500).json({ error: "خطا در سرور" });
  }
};