const express = require("express");
const bodyParser = require("body-parser");
const axios = require("axios");
const { createClient } = require("@supabase/supabase-js");

const app = express();
app.use(bodyParser.json());

// ============================
// ENV
// ============================
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

const VERIFY_TOKEN = "123456";

// ============================
// SESSION (phone → property)
// ============================
const sessions = new Map();

// ============================
// WEBHOOK VERIFY
// ============================
app.get("/webhook", (req, res) => {
  if (
    req.query["hub.mode"] === "subscribe" &&
    req.query["hub.verify_token"] === VERIFY_TOKEN
  ) {
    return res.status(200).send(req.query["hub.challenge"]);
  }
  res.sendStatus(403);
});

// ============================
// GET PROPERTY INFO
// ============================
async function getProperty(propertyId) {
  const { data, error } = await supabase
    .from("property_info")
    .select("*")
    .eq("property_id", propertyId)
    .single();

  if (error) {
    console.error("PROPERTY ERROR:", error);
    return null;
  }

  return data;
}

// ============================
// SAVE MESSAGE (HOST CONTROL)
// ============================
async function saveMessage(phone, role, text, propertyId) {
  await supabase.from("messages").insert([
    {
      phone,
      role,
      message: text,
      property_id: propertyId,
    },
  ]);
}

// ============================
// AI REPLY
// ============================
function generateReply(msg, property) {
  if (!property) return "Errore recupero dati casa.";

  const text = msg.toLowerCase();

  if (text.includes("wifi")) return `📶 ${property.wifi}`;
  if (text.includes("check in")) return `🕓 ${property.checkin}`;
  if (text.includes("check out")) return `🕓 ${property.checkout}`;
  if (text.includes("parcheggio")) return `🚗 ${property.parking}`;
  if (text.includes("regole")) return `📋 ${property.house_rules}`;
  if (text.includes("ristoranti")) return `🍝 ${property.restaurants}`;
  if (text.includes("trasporti")) return `🚌 ${property.transport}`;
  if (text.includes("zona")) return `📍 ${property.location_info}`;
  if (text.includes("emergenza")) return `📞 ${property.emergency_contact}`;

  return "🙂 Posso aiutarti con WiFi, check-in, parcheggio e info utili.";
}

// ============================
// SEND WHATSAPP
// ============================
async function send(to, text) {
  await axios.post(
    `https://graph.facebook.com/v18.0/${process.env.PHONE_NUMBER_ID}/messages`,
    {
      messaging_product: "whatsapp",
      to,
      text: { body: text },
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
// MAIN
// ============================
app.post("/webhook", async (req, res) => {
  try {
    const msg = req.body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
    if (!msg) return res.sendStatus(200);

    const from = msg.from;
    const text = msg.text?.body || "";

    console.log("MSG:", text);

    // ============================
    // 🔥 FIX PID DA TESTO
    // ============================
    if (text.startsWith("/start")) {
      const match = text.match(/pid=([a-zA-Z0-9-]+)/);
      if (match) {
        const pid = match[1];
        sessions.set(from, pid);

        await send(from, "✅ Assistente attivato per la tua casa!");
        return res.sendStatus(200);
      }
    }

    // ============================
    // SESSION
    // ============================
    const propertyId = sessions.get(from);

    if (!propertyId) {
      await send(from, "📲 Usa il link o QR della casa per iniziare.");
      return res.sendStatus(200);
    }

    // ============================
    // SAVE USER MESSAGE
    // ============================
    await saveMessage(from, "guest", text, propertyId);

    // ============================
    // PROPERTY
    // ============================
    const property = await getProperty(propertyId);

    // ============================
    // AI REPLY
    // ============================
    const reply = generateReply(text, property);

    // ============================
    // SAVE AI MESSAGE
    // ============================
    await saveMessage(from, "assistant", reply, propertyId);

    // ============================
    // SEND
    // ============================
    await send(from, reply);

    res.sendStatus(200);
  } catch (err) {
    console.error("ERROR:", err);
    res.sendStatus(500);
  }
});

// ============================
app.listen(process.env.PORT || 3000, () => {
  console.log("🚀 Server running");
});