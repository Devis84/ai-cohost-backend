const express = require("express");
const bodyParser = require("body-parser");
const axios = require("axios");
const { createClient } = require("@supabase/supabase-js");

const app = express();
app.use(bodyParser.json());

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

const VERIFY_TOKEN = "123456";

// ============================
// 🔥 WEBHOOK VERIFY
// ============================
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    console.log("Webhook verificato!");
    res.status(200).send(challenge);
  } else {
    res.sendStatus(403);
  }
});

// ============================
// 🔥 FETCH PROPERTY INFO
// ============================
async function getPropertyInfo(propertyId) {
  const { data, error } = await supabase
    .from("property_info")
    .select("*")
    .eq("property_id", propertyId)
    .single();

  if (error) {
    console.error("❌ PROPERTY ERROR:", error);
    return null;
  }

  return data;
}

// ============================
// 🧠 RISPOSTA INTELLIGENTE
// ============================
function generateReply(message, property) {
  if (!property) return "Errore nel recupero informazioni.";

  const text = message.toLowerCase();

  if (text.includes("wifi")) {
    return `📶 WiFi: ${property.wifi}`;
  }

  if (text.includes("check in")) {
    return `🕓 Check-in: ${property.checkin}`;
  }

  if (text.includes("check out")) {
    return `🕓 Check-out: ${property.checkout}`;
  }

  if (text.includes("regole") || text.includes("rules")) {
    return `📋 Regole: ${property.house_rules}`;
  }

  if (text.includes("parcheggio") || text.includes("parking")) {
    return `🚗 Parcheggio: ${property.parking}`;
  }

  if (text.includes("ristoranti")) {
    return `🍝 Ristoranti: ${property.restaurants}`;
  }

  if (text.includes("trasport")) {
    return `🚌 Trasporti: ${property.transport}`;
  }

  if (text.includes("posizione") || text.includes("location")) {
    return `📍 Info zona: ${property.location_info}`;
  }

  if (text.includes("descrizione")) {
    return `🏡 ${property.description}`;
  }

  if (text.includes("emergenza") || text.includes("contatto")) {
    return `📞 ${property.emergency_contact}`;
  }

  return `🙂 Posso aiutarti con WiFi, check-in, parcheggio, regole o info sulla zona.`;
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
    const message = changes?.value?.messages?.[0];

    if (!message) return res.sendStatus(200);

    const from = message.from;
    const text = message.text.body;

    console.log("📩 MSG:", text);

    // 🔥 QUI USIAMO IL TUO PROPERTY ID REALE
    const propertyId = "80ffd815-7985-47a1-84d6-c9463bf13590";

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