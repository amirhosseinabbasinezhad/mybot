const { getDb } = require("../lib/db");
const { ObjectId } = require("mongodb");

module.exports = async (req, res) => {
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

    if (req.method === "GET") {
      const texts = await collection.find({}).sort({ createdAt: -1 }).toArray();
      res.status(200).json(texts);
      return;
    }

    if (req.method === "POST") {
      const { text } = req.body;
      if (!text || text.trim().length === 0) {
        return res.status(400).json({ error: "متن وارد نشده است" });
      }

      const newText = {
        text: text.trim(),
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const result = await collection.insertOne(newText);
      res.status(201).json({ success: true, _id: result.insertedId, ...newText });
      return;
    }

    if (req.method === "PUT") {
      const { id, text } = req.body;
      const result = await collection.updateOne(
        { _id: new ObjectId(id) },
        { $set: { text: text.trim(), updatedAt: new Date() } }
      );
      if (result.matchedCount === 0) {
        return res.status(404).json({ error: "متن پیدا نشد" });
      }
      res.status(200).json({ success: true });
      return;
    }

    if (req.method === "DELETE") {
      const { id } = req.query;
      const result = await collection.deleteOne({ _id: new ObjectId(id) });
      if (result.deletedCount === 0) {
        return res.status(404).json({ error: "متن پیدا نشد" });
      }
      res.status(200).json({ success: true });
      return;
    }

    res.status(405).json({ error: "روش غیرمجاز" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "خطا در سرور" });
  }
};