const jwt = require("jsonwebtoken");

// ============================================================
// 🔐 کلیدهای امنیتی
// ============================================================
const JWT_SECRET = process.env.JWT_SECRET || "your-secret-key";
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || "your-refresh-secret-key";

// ============================================================
// 👤 دریافت کاربران مجاز از متغیر محیطی (JSON)
// ============================================================
let ALLOWED_USERS = {};

try {
  const usersJson = process.env.ADMIN_USERS || '[{"username":"admin","password":"admin123"}]';
  const usersArray = JSON.parse(usersJson);
  
  usersArray.forEach(user => {
    ALLOWED_USERS[user.username] = user.password;
  });
  
  console.log("[auth] ✅ کاربران بارگذاری شدند:", Object.keys(ALLOWED_USERS));
} catch (err) {
  console.error("[auth] ❌ خطا در بارگذاری کاربران:", err.message);
  ALLOWED_USERS = { "admin": "admin123" };
}

// ============================================================
// 📦 ذخیره Refresh Token (در حافظه - برای سادگی)
// ⚠️ در تولید (Production) از Redis یا دیتابیس استفاده کن
// ============================================================
let refreshTokens = {}; // { username: refreshToken }

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") {
    res.status(200).end();
    return;
  }

  const { action } = req.query;

  // ============================================================
  // 📝 ۱. ورود (Login)
  // ============================================================
  if (action === "login") {
    const { username, password } = req.body;
    
    if (!username || !password) {
      return res.status(400).json({ error: "نام کاربری و رمز عبور الزامی است" });
    }

    if (!ALLOWED_USERS[username] || ALLOWED_USERS[username] !== password) {
      return res.status(401).json({ error: "نام کاربری یا رمز عبور اشتباه است" });
    }

    // 🔥 تولید Access Token (۱۵ دقیقه)
    const accessToken = jwt.sign(
      { username }, 
      JWT_SECRET, 
      { expiresIn: '15m' }
    );

    // 🔥 تولید Refresh Token (۳۰ روز)
    const refreshToken = jwt.sign(
      { username }, 
      JWT_REFRESH_SECRET, 
      { expiresIn: '30d' }
    );

    // ذخیره Refresh Token (برای invalidate کردن بعداً)
    refreshTokens[username] = refreshToken;

    res.status(200).json({ 
      success: true, 
      accessToken,
      refreshToken,
      username,
      expiresIn: '15m'
    });
    return;
  }

  // ============================================================
  // 🔄 ۲. تمدید توکن (Refresh)
  // ============================================================
  if (action === "refresh") {
    const { refreshToken } = req.body;

    if (!refreshToken) {
      return res.status(400).json({ error: "Refresh Token ارسال نشده است" });
    }

    try {
      // بررسی اعتبار Refresh Token
      const decoded = jwt.verify(refreshToken, JWT_REFRESH_SECRET);
      const username = decoded.username;

      // بررسی اینکه Refresh Token با چیزی که ذخیره کردیم یکی باشه
      if (refreshTokens[username] !== refreshToken) {
        return res.status(401).json({ error: "Refresh Token نامعتبر است" });
      }

      // 🔥 تولید Access Token جدید (۱۵ دقیقه)
      const newAccessToken = jwt.sign(
        { username }, 
        JWT_SECRET, 
        { expiresIn: '15m' }
      );

      res.status(200).json({
        success: true,
        accessToken: newAccessToken,
        expiresIn: '15m'
      });

    } catch (err) {
      if (err.name === 'TokenExpiredError') {
        // Refresh Token منقضی شده → کاربر باید دوباره لاگین کنه
        return res.status(401).json({ 
          error: "Refresh Token منقضی شده است. لطفاً دوباره وارد شوید." 
        });
      }
      return res.status(401).json({ error: "Refresh Token نامعتبر است" });
    }
    return;
  }

  // ============================================================
  // 🚪 ۳. خروج (Logout)
  // ============================================================
  if (action === "logout") {
    const { username } = req.body;

    if (username && refreshTokens[username]) {
      // حذف Refresh Token
      delete refreshTokens[username];
      console.log(`[auth] 🚪 ${username} خارج شد`);
    }

    res.status(200).json({ success: true, message: "خروج با موفقیت انجام شد" });
    return;
  }

  // ============================================================
  // ✅ ۴. بررسی اعتبار توکن (Verify)
  // ============================================================
  if (action === "verify") {
    const authHeader = req.headers.authorization;
    
    if (!authHeader) {
      return res.status(401).json({ error: "توکن ارسال نشده است" });
    }

    try {
      const token = authHeader.split(" ")[1];
      const decoded = jwt.verify(token, JWT_SECRET);
      
      res.status(200).json({ 
        success: true, 
        username: decoded.username 
      });
    } catch (err) {
      if (err.name === 'TokenExpiredError') {
        return res.status(401).json({ 
          error: "توکن منقضی شده است",
          expired: true 
        });
      }
      return res.status(401).json({ error: "توکن نامعتبر است" });
    }
    return;
  }

  res.status(404).json({ error: "مسیر نامعتبر" });
};