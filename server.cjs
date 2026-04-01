const express = require("express");
const bodyParser = require("body-parser");
const axios = require("axios");
const { createClient } = require("@supabase/supabase-js");

const app = express();
app.use(bodyParser.json());

// ============================
// 🔐 ENV
// ============================
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

const VERIFY_TOKEN = "123456";

// ============================
// 🧠 SESSION (phone → property)
// ============================
const sessions = new Map();

// ============================
// ✅ WEBHOOK VERIFY
// ============================
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    console.log("✅ Webhook verificato");
    res.status(200).send(challenge);
  } else {
    res.sendStatus(403);
  }
});

// ============================
// 🔥 GET PROPERTY INFO
// ============================
async function getPropertyInfo(propertyId) {
  const { data, error } = await supabase
    .from("property_info")
    .select("*")
    .eq("property_id", propertyId)
    .single();

  if (error || !data) {
    console.error("❌ PROPERTY ERROR:", error);
    return null;
  }

  return data;
}

// ============================
// 🧠 CO-HOST REPLY
// ============================
function generateReply(message, property) {
  if (!property) {
    return "⚠️ Non riesco a recuperare le informazioni della casa.";
  }

  const text = message.toLowerCase();

  if (text.includes("wifi")) {
    return `📶 WiFi: ${property.wifi}`;
  }

  if (text.includes("check in") || text.includes("checkin")) {
    return `🕓 Check-in: ${property.checkin}`;
  }

  if (text.includes("check out") || text.includes("checkout")) {
    return `🕓 Check-out: ${property.checkout}`;
  }

  if (text.includes("regole")) {
    return `📋 Regole: ${property.house_rules}`;
  }

  if (text.includes("parcheggio")) {
    return `🚗 Parcheggio: ${property.parking}`;
  }

  if (text.includes("ristoranti")) {
    return `🍝 Ristoranti: ${property.restaurants}`;
  }

  if (text.includes("trasport")) {
    return `🚌 Trasporti: ${property.transport}`;
  }

  if (text.includes("zona") || text.includes("posizione")) {
    return `📍 ${property.location_info}`;
  }

  if (text.includes("emergenza")) {
    return `📞 ${property.emergency_contact}`;
  }

  return `🙂 Posso aiutarti con WiFi, check-in, parcheggio, regole e info zona.`;
}

// ============================
// 📩 SEND WHATSAPP
// ============================
async function sendWhatsApp(to, message) {
  await axios.post(
    `https://graph.facebook.com/v18.0/${process.env.PHONE_NUMBER_ID}/messages`,
    {
      messaging_product: "whatsapp",
      to: to,
      text: { body: message },
    },
    {
      headers: {
        Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
        "Content-Type": "application/json",
      },
    }
  );
}

// ============================
// 🔥 MAIN WEBHOOK
// ============================
app.post("/webhook", async (req, res) => {
  try {
    const entry = req.body.entry?.[0];
    const changes = entry?.changes?.[0];
    const value = changes?.value;

    const message = value?.messages?.[0];
    if (!message) return res.sendStatus(200);

    const from = message.from;
    const text = message.text?.body || "";

    console.log("📩 MSG:", text);

    // ============================
    // 🔑 1. PRIMO ACCESSO → prende PID dal referral (QR / link)
    // ============================
    const referralPid =
      message?.context?.referral?.ref || // click-to-WhatsApp ads / referral
      req.body?.pid || // fallback eventuale
      null;

    if (referralPid) {
      sessions.set(from, referralPid);
      console.log("🔗 SESSION SET:", from, referralPid);
    }

    // ============================
    // 🔁 2. RECUPERA PROPERTY DA SESSION
    // ============================
    const propertyId = sessions.get(from);

    if (!propertyId) {
      await sendWhatsApp(
        from,
        "👋 Scansiona il QR code della casa per iniziare."
      );
      return res.sendStatus(200);
    }

    const property = await getPropertyInfo(propertyId);

    const reply = generateReply(text, property);

    await sendWhatsApp(from, reply);

    res.sendStatus(200);
  } catch (err) {
    console.error("❌ ERROR:", err);
    res.sendStatus(500);
  }
});

// ============================
app.listen(process.env.PORT || 3000, () => {
  console.log("🚀 Server running");
});