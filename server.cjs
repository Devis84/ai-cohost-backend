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
const HOST_PHONE = process.env.HOST_PHONE;

// ============================
// STATE
// ============================
const sessions = new Map();
const takeover = new Set();

// ============================
// VERIFY
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
// DB
// ============================
async function getProperty(propertyId) {
  const { data } = await supabase
    .from("property_info")
    .select("*")
    .eq("property_id", propertyId)
    .single();

  return data;
}

async function saveMessage(phone, role, text, propertyId) {
  await supabase.from("messages").insert([
    { phone, role, message: text, property_id: propertyId },
  ]);
}

// ============================
// OPENAI
// ============================
async function askAI(message, property) {
  try {
    const prompt = `
You are a professional Airbnb co-host assistant.

IMPORTANT:
- You ONLY answer using the property information provided.
- You DO NOT invent information.
- You DO NOT talk about booking, pricing, availability.
- You ONLY help guests during their stay.

PROPERTY DATA:
WiFi: ${property.wifi}
Check-in: ${property.checkin}
Check-out: ${property.checkout}
Parking: ${property.parking}
Rules: ${property.house_rules}
Restaurants: ${property.restaurants}
Transport: ${property.transport}
Location: ${property.location_info}
Emergency: ${property.emergency_contact}

User question:
"${message}"

Answer naturally and clearly.
`;

    const response = await axios.post(
      "https://api.openai.com/v1/chat/completions",
      {
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: prompt }],
        temperature: 0.3,
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        },
      }
    );

    return response.data.choices[0].message.content;
  } catch (err) {
    console.error("AI ERROR:", err.message);
    return null;
  }
}

// ============================
// FALLBACK
// ============================
function fallback(msg, p) {
  const t = msg.toLowerCase();

  if (t.includes("wifi")) return p.wifi;
  if (t.includes("check")) return p.checkin;
  if (t.includes("parcheggio") || t.includes("parking")) return p.parking;
  if (t.includes("regole") || t.includes("rules") || t.includes("party"))
    return p.house_rules;

  return "🙂 Posso aiutarti con WiFi, check-in, parcheggio o regole.";
}

// ============================
// SEND
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
      },
    }
  );
}

// ============================
// HOST NOTIFY
// ============================
async function notifyHost(phone, text) {
  await send(HOST_PHONE, `👤 ${phone}\n💬 ${text}`);
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

    console.log("MSG:", from, text);

    // HOST COMMANDS
    if (from === HOST_PHONE) {
      if (text.startsWith("/takeover")) {
        const target = text.split(" ")[1];
        takeover.add(target);
        return res.sendStatus(200);
      }

      if (text.startsWith("/release")) {
        const target = text.split(" ")[1];
        takeover.delete(target);
        return res.sendStatus(200);
      }

      const [target, reply] = text.split("|");
      if (target && reply) {
        await send(target, reply);
        return res.sendStatus(200);
      }
    }

    // START
    if (text.startsWith("/start")) {
      const match = text.match(/pid=([a-zA-Z0-9-]+)/);
      if (match) {
        sessions.set(from, match[1]);
        await send(from, "✅ Assistente attivo!");
        return res.sendStatus(200);
      }
    }

    const propertyId = sessions.get(from);

    if (!propertyId) {
      await send(from, "📲 Scansiona il QR della casa.");
      return res.sendStatus(200);
    }

    const property = await getProperty(propertyId);

    await saveMessage(from, "guest", text, propertyId);

    await notifyHost(from, text);

    if (takeover.has(from)) {
      await send(from, "👤 L’host ti risponderà a breve.");
      return res.sendStatus(200);
    }

    // AI FIRST
    let reply = await askAI(text, property);

    // FALLBACK
    if (!reply || reply.length < 5) {
      reply = fallback(text, property);
    }

    await saveMessage(from, "assistant", reply, propertyId);

    await send(from, reply);

    res.sendStatus(200);
  } catch (err) {
    console.error(err);
    res.sendStatus(500);
  }
});

// ============================
app.listen(process.env.PORT || 3000, () => {
  console.log("🚀 Server running");
});