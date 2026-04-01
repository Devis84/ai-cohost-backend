const express = require("express");
const bodyParser = require("body-parser");
const axios = require("axios");
const { createClient } = require("@supabase/supabase-js");

const app = express();
app.use(bodyParser.json());

// ✅ SERVE DASHBOARD.HTML
app.use(express.static(__dirname));

// ============================
// ENV
// ============================
const VERIFY_TOKEN = "123456";
const HOST_PHONE = process.env.HOST_PHONE;

// ============================
// SUPABASE
// ============================
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

// ============================
// SESSIONI
// ============================
const sessions = new Map();
const takeover = new Set();

// ============================
// VERIFY WEBHOOK
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
// DB FUNCTIONS
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

async function getHistory(phone) {
  const { data } = await supabase
    .from("messages")
    .select("role, message")
    .eq("phone", phone)
    .order("created_at", { ascending: false })
    .limit(10);

  return (data || []).reverse();
}

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
// AI WITH MEMORY
// ============================
async function askAI(message, property, history) {
  try {
    const messages = [
      {
        role: "system",
        content: `
You are an Airbnb co-host assistant.

RULES:
- ONLY use provided property data
- DO NOT invent information
- NO booking, NO pricing
- Be natural and helpful
        `,
      },
      {
        role: "system",
        content: `
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
        `,
      },
      ...history.map((h) => ({
        role: h.role === "assistant" ? "assistant" : "user",
        content: h.message,
      })),
      {
        role: "user",
        content: message,
      },
    ];

    const response = await axios.post(
      "https://api.openai.com/v1/chat/completions",
      {
        model: "gpt-4o-mini",
        messages,
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
  if (t.includes("parking") || t.includes("parcheggio")) return p.parking;
  if (t.includes("party") || t.includes("rules")) return p.house_rules;

  return "🙂 Posso aiutarti con info sulla casa.";
}

// ============================
// SEND WHATSAPP
// ============================
async function send(to, text) {
  try {
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
  } catch (err) {
    console.error("WHATSAPP ERROR:", err.response?.data || err.message);
  }
}

// ============================
// HOST NOTIFY
// ============================
async function notifyHost(phone, text) {
  await send(HOST_PHONE, `👤 ${phone}\n💬 ${text}`);
}

// ============================
// DASHBOARD API
// ============================
app.get("/conversations", async (req, res) => {
  const { data } = await supabase
    .from("messages")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(50);

  res.json(data);
});

// ============================
// MAIN WEBHOOK
// ============================
app.post("/webhook", async (req, res) => {
  try {
    const msg = req.body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
    if (!msg) return res.sendStatus(200);

    const from = msg.from;
    const text = msg.text?.body || "";

    console.log("INCOMING:", from, text);

    // ========================
    // HOST COMMANDS
    // ========================
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

    // ========================
    // START SESSION
    // ========================
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

    if (!property) {
      await send(from, "⚠️ Errore caricamento casa.");
      return res.sendStatus(200);
    }

    const history = await getHistory(from);

    await saveMessage(from, "user", text, propertyId);
    await notifyHost(from, text);

    if (takeover.has(from)) {
      await send(from, "👤 L’host ti risponderà a breve.");
      return res.sendStatus(200);
    }

    let reply = await askAI(text, property, history);

    if (!reply) {
      reply = fallback(text, property);
    }

    await saveMessage(from, "assistant", reply, propertyId);
    await send(from, reply);

    res.sendStatus(200);
  } catch (err) {
    console.error("SERVER ERROR:", err);
    res.sendStatus(500);
  }
});

// ============================
// START SERVER
// ============================
app.listen(process.env.PORT || 3000, () => {
  console.log("🚀 Server running");
});