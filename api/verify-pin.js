// Vercel Serverless Function – Admin PIN verification
// Env var required in Vercel dashboard:
//   ADMIN_PIN  → your admin PIN
// PIN comparison is done server-side (never sent to the browser)
// and uses timing-safe comparison to prevent timing attacks.

const crypto = require("crypto");

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false });
  }

  const adminPin = process.env.ADMIN_PIN;
  if (!adminPin) {
    return res.status(500).json({ ok: false, error: "Not configured" });
  }

  const { pin } = req.body || {};
  const entered = String(pin || "");

  // Constant-time comparison (prevents brute-force timing attacks)
  let match = false;
  try {
    const len = Math.max(entered.length, adminPin.length);
    const a = Buffer.alloc(len, 0);
    const b = Buffer.alloc(len, 0);
    Buffer.from(entered).copy(a);
    Buffer.from(adminPin).copy(b);
    match = crypto.timingSafeEqual(a, b) && entered.length === adminPin.length;
  } catch (e) {
    match = false;
  }

  return res.status(200).json({ ok: match });
};
