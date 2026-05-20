// Vercel Serverless Function – Midtrans QRIS (Production)
// Env vars required in Vercel dashboard:
//   MIDTRANS_SERVER_KEY  → your Midtrans Production Server Key (SB-Mid-server-... or Mid-server-...)
// Optional:
//   MIDTRANS_PAYMENT_AMOUNT  → fixed amount in IDR (e.g. 5000); if set, client value is ignored

module.exports = async function handler(req, res) {
  // Only allow POST
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const serverKey = process.env.MIDTRANS_SERVER_KEY;
  if (!serverKey) {
    return res.status(500).json({ error: "Payment gateway not configured" });
  }

  const { gross_amount, customer_name, customer_phone } = req.body || {};

  // Amount: prefer env var (admin-controlled), fallback to client value (min 1000 IDR)
  const envAmount = process.env.MIDTRANS_PAYMENT_AMOUNT
    ? parseInt(process.env.MIDTRANS_PAYMENT_AMOUNT, 10)
    : null;
  const amount =
    envAmount && envAmount > 0
      ? envAmount
      : Math.max(1000, Math.round(Number(gross_amount) || 5000));

  // Sanitise customer details (length-limited, no HTML)
  const name = String(customer_name || "Tamu")
    .replace(/[<>]/g, "")
    .slice(0, 50);
  const phone = String(customer_phone || "")
    .replace(/[^0-9+\-\s]/g, "")
    .slice(0, 20);

  // Unique order ID
  const orderId =
    "ANTRI-" +
    Date.now() +
    "-" +
    Math.random().toString(36).slice(2, 7).toUpperCase();

  const auth = Buffer.from(serverKey + ":").toString("base64");

  const payload = {
    payment_type: "qris",
    transaction_details: {
      order_id: orderId,
      gross_amount: amount,
    },
    qris: { acquirer: "gopay" },
    customer_details: {
      first_name: name,
      phone: phone,
    },
  };

  try {
    const resp = await fetch("https://api.midtrans.com/v2/charge", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Basic " + auth,
        Accept: "application/json",
      },
      body: JSON.stringify(payload),
    });

    const data = await resp.json();

    if (data.status_code === "201") {
      // Find QR image URL from actions array
      const qrAction =
        data.actions &&
        data.actions.find(function (a) {
          return a.rel === "generate-qr-code";
        });

      return res.status(200).json({
        order_id: data.order_id,
        qr_url: qrAction ? qrAction.url : null,
        qr_string: data.qr_string || null,
        amount: amount,
      });
    }

    // Midtrans returned an error
    return res.status(400).json({
      error: data.status_message || "Gagal membuat pembayaran",
    });
  } catch (err) {
    return res.status(500).json({ error: "Server error" });
  }
};
