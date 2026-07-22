const { getDb } = require("../lib/db");
const { ObjectId } = require("mongodb"); // ← این خط رو اضافه کن!

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
      console.log("[texts] 📥 دریافت همه متن‌ها");
      const texts = await collection
        .find({})
        .sort({ createdAt: -1 })
        .toArray();
      
      console.log(`[texts] ✅ ${texts.length} متن پیدا شد`);
      res.status(200).json(texts);
      return;
    }

    // ===== POST: افزودن متن جدید =====
    if (req.method === "POST") {
      const { text } = req.body;
      
      console.log("[texts] 📝 افزودن متن جدید:", text);
      
      if (!text || text.trim().length === 0) {
        console.log("[texts] ❌ متن خالی است");
        res.status(400).json({ error: "متن وارد نشده است" });
        return;
      }

      const newText = {
        text: text.trim(),
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const result = await collection.insertOne(newText);
      console.log("[texts] ✅ متن با ID اضافه شد:", result.insertedId);
      
      res.status(201).json({
        success: true,
        _id: result.insertedId,
        ...newText,
      });
      return;
    }

    // ===== PUT: ویرایش متن =====
    if (req.method === "PUT") {
      const { id, text } = req.body;
      
      console.log("[texts] ✏️ ویرایش متن:", id, text);
      
      if (!id || !text || text.trim().length === 0) {
        res.status(400).json({ error: "اطلاعات ناقص است" });
        return;
      }

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
        console.log("[texts] ❌ متن پیدا نشد");
        res.status(404).json({ error: "متن پیدا نشد" });
        return;
      }

      console.log("[texts] ✅ متن ویرایش شد");
      res.status(200).json({ success: true });
      return;
    }

    // ===== DELETE: حذف متن =====
    if (req.method === "DELETE") {
      const { id } = req.query;
      
      console.log("[texts] 🗑️ حذف متن:", id);
      
      if (!id) {
        res.status(400).json({ error: "شناسه متن وارد نشده است" });
        return;
      }

      const result = await collection.deleteOne({ _id: new ObjectId(id) });

      if (result.deletedCount === 0) {
        console.log("[texts] ❌ متن پیدا نشد");
        res.status(404).json({ error: "متن پیدا نشد" });
        return;
      }

      console.log("[texts] ✅ متن حذف شد");
      res.status(200).json({ success: true });
      return;
    }

    res.status(405).json({ error: "روش غیرمجاز" });
  } catch (err) {
    console.error("[texts] ❌ خطا:", err);
    res.status(500).json({ error: "خطا در سرور: " + err.message });
  }
};