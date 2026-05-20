// Vercel Serverless Function - Midtrans QRIS
// Uses Node built-in https (works on all Node versions, no fetch needed)
// Env vars: MIDTRANS_SERVER_KEY (required), MIDTRANS_PAYMENT_AMOUNT (optional)

const https = require("https");

function httpPost(hostname, path, headers, body) {
  return new Promise(function (resolve, reject) {
    const data = JSON.stringify(body);
    const options = {
      hostname: hostname,
      path: path,
      method: "POST",
      headers: Object.assign({}, headers, {
        "Content-Length": Buffer.byteLength(data),
      }),
    };
    const req = https.request(options, function (res) {
      let raw = "";
      res.on("data", function (chunk) { raw += chunk; });
      res.on("end", function () {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(raw) });
        } catch (e) {
          reject(new Error("Non-JSON from Midtrans: " + raw.slice(0, 200)));
        }
      });
    });
    req.on("error", reject);
    req.write(data);
    req.end();
  });
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const serverKey = process.env.MIDTRANS_SERVER_KEY;
  if (!serverKey) {
    return res.status(500).json({ error: "Payment gateway not configured" });
  }

  const body = req.body || {};
  const envAmount = process.env.MIDTRANS_PAYMENT_AMOUNT
    ? parseInt(process.env.MIDTRANS_PAYMENT_AMOUNT, 10)
    : null;
  const amount =
    envAmount && envAmount > 0
      ? envAmount
      : Math.max(1000, Math.round(Number(body.gross_amount) || 5000));

  const name = String(body.customer_name || "Tamu").replace(/[<>]/g, "").slice(0, 50);
  const phone = String(body.customer_phone || "").replace(/[^0-9+\-\s]/g, "").slice(0, 20);
  const orderId = "ANTRI-" + Date.now() + "-" + Math.random().toString(36).slice(2, 7).toUpperCase();
  const auth = Buffer.from(serverKey + ":").toString("base64");
  const hostname = serverKey.startsWith("SB-")
    ? "api.sandbox.midtrans.com"
    : "api.midtrans.com";

  const payload = {
    payment_type: "qris",
    transaction_details: { order_id: orderId, gross_amount: amount },
    qris: { acquirer: "gopay" },
    customer_details: { first_name: name, phone: phone },
  };

  try {
    const result = await httpPost(
      hostname,
      "/v2/charge",
      {
        "Content-Type": "application/json",
        Authorization: "Basic " + auth,
        Accept: "application/json",
      },
      payload
    );

    const data = result.body;

    if (data.status_code === "201") {
      const qrAction = data.actions && data.actions.find(function (a) {
        return a.rel === "generate-qr-code";
      });
      return res.status(200).json({
        order_id: data.order_id,
        qr_url: qrAction ? qrAction.url : null,
        qr_string: data.qr_string || null,
        amount: amount,
      });
    }

    return res.status(400).json({
      error: data.status_message || "Gagal membuat pembayaran",
      midtrans_status_code: data.status_code,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message || "Server error" });
  }
};
