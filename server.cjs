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
// 🔥 GET PROPERTY FROM PHONE
// ============================
async function getPropertyByPhone(phone) {
  const { data, error } = await supabase
    .from("guest_properties")
    .select("property_id")
    .eq("phone", phone)
    .single();

  if (error || !data) {
    console.error("❌ MAPPING ERROR:", error);
    return null;
  }

  return data.property_id;
}

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
// 🧠 AI RESPONSE (CO-HOST MODE)
// ============================
function generateReply(message, property) {
  if (!property) {
    return "⚠️ Non riesco a recuperare le informazioni della casa. Contatta l’host.";
  }

  const text = message.toLowerCase();

  // WIFI
  if (text.includes("wifi")) {
    return `📶 WiFi: ${property.wifi}`;
  }

  // CHECK-IN
  if (text.includes("check in") || text.includes("checkin")) {
    return `🕓 Check-in: ${property.checkin}`;
  }

  // CHECK-OUT
  if (text.includes("check out") || text.includes("checkout")) {
    return `🕓 Check-out: ${property.checkout}`;
  }

  // RULES
  if (text.includes("regole") || text.includes("rules")) {
    return `📋 Regole della casa: ${property.house_rules}`;
  }

  // PARKING
  if (text.includes("parcheggio") || text.includes("parking")) {
    return `🚗 Parcheggio: ${property.parking}`;
  }

  // RESTAURANTS
  if (text.includes("ristoranti")) {
    return `🍝 Ristoranti vicini: ${property.restaurants}`;
  }

  // TRANSPORT
  if (text.includes("trasport")) {
    return `🚌 Trasporti: ${property.transport}`;
  }

  // LOCATION
  if (text.includes("zona") || text.includes("posizione")) {
    return `📍 Info zona: ${property.location_info}`;
  }

  // DESCRIPTION
  if (text.includes("casa") || text.includes("appartamento")) {
    return `🏡 ${property.description}`;
  }

  // EMERGENCY
  if (text.includes("emergenza") || text.includes("contatto")) {
    return `📞 ${property.emergency_contact}`;
  }

  // DEFAULT
  return `🙂 Posso aiutarti con:
- WiFi
- Check-in / Check-out
- Regole della casa
- Parcheggio
- Ristoranti
- Trasporti
- Info zona`;
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

    // 🔥 PROPERTY DINAMICA
    const propertyId = await getPropertyByPhone(from);

    if (!propertyId) {
      await sendWhatsApp(
        from,
        "⚠️ Nessuna proprietà associata a questo numero."
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