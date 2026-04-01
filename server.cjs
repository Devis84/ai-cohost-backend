const express = require("express");
const bodyParser = require("body-parser");
const axios = require("axios");
require("dotenv").config();
const { createClient } = require("@supabase/supabase-js");
const path = require("path");

const app = express();
app.use(bodyParser.json());

// =============================
// STATIC FIX (CRITICO)
// =============================
app.use(express.static(path.join(__dirname, "public"), {
  setHeaders: (res, filePath) => {
    if (filePath.endsWith(".html")) {
      res.setHeader("Content-Type", "text/html");
    }
  }
}));

// ROUTE FORZATA
app.get("/dashboard.html", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "dashboard.html"));
});

// =============================
// ENV
// =============================
const {
  WHATSAPP_TOKEN,
  PHONE_NUMBER_ID,
  SUPABASE_URL,
  SUPABASE_KEY,
  HOST_PHONE
} = process.env;

// =============================
// SUPABASE
// =============================
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// =============================
// MEMORY
// =============================
const sessions = {};
const takeover = new Set();

// =============================
// SEND
// =============================
async function send(to, text) {
  try {
    await axios.post(
      `https://graph.facebook.com/v18.0/${PHONE_NUMBER_ID}/messages`,
      {
        messaging_product: "whatsapp",
        to,
        text: { body: text }
      },
      {
        headers: {
          Authorization: `Bearer ${WHATSAPP_TOKEN}`,
          "Content-Type": "application/json"
        }
      }
    );
  } catch (err) {
    console.error("SEND ERROR:", err.response?.data || err.message);
  }
}

// =============================
// PROPERTY
// =============================
async function getProperty(propertyId) {
  const { data, error } = await supabase
    .from("property_info")
    .select("*")
    .eq("property_id", propertyId)
    .single();

  if (error) return null;
  return data;
}

// =============================
// SAVE
// =============================
async function saveMessage(phone, role, message, propertyId) {
  await supabase.from("messages").insert([
    { phone, role, message, property_id: propertyId }
  ]);
}

// =============================
// HOST NOTIFY
// =============================
async function notifyHost(phone, text) {
  if (!HOST_PHONE) return;

  await send(HOST_PHONE, `👤 Guest ${phone}\n💬 ${text}`);
}

// =============================
// AI
// =============================
function smartReply(text, p) {
  const t = text.toLowerCase();

  if (t.includes("wifi")) return `📶 WiFi: ${p.wifi}`;
  if (t.includes("check")) return `🕒 Check-in: ${p.checkin}`;
  if (t.includes("parking")) return `🚗 ${p.parking}`;
  if (t.includes("party")) return `🚫 ${p.house_rules}`;
  if (t.includes("airport")) return `🚕 ${p.transport}`;

  return "🙂 Posso aiutarti con WiFi, check-in e info.";
}

// =============================
// WEBHOOK
// =============================
app.post("/webhook", async (req, res) => {
  try {
    const msg = req.body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
    if (!msg) return res.sendStatus(200);

    const from = msg.from;
    const text = msg.text?.body;

    if (!sessions[from]) sessions[from] = {};

    if (text.startsWith("/start")) {
      const propertyId = text.split("pid=")[1];
      sessions[from].propertyId = propertyId;

      await send(from, "✅ Assistente attivo!");
      return res.sendStatus(200);
    }

    const propertyId = sessions[from].propertyId;

    if (!propertyId) {
      await send(from, "📲 Scansiona il QR della casa.");
      return res.sendStatus(200);
    }

    const property = await getProperty(propertyId);
    if (!property) {
      await send(from, "❌ Errore proprietà.");
      return res.sendStatus(200);
    }

    await saveMessage(from, "guest", text, propertyId);
    await notifyHost(from, text);

    if (takeover.has(from)) {
      await send(from, "👤 L’host ti risponderà a breve.");
      return res.sendStatus(200);
    }

    const reply = smartReply(text, property);

    await saveMessage(from, "assistant", reply, propertyId);
    await send(from, reply);

    res.sendStatus(200);

  } catch (err) {
    console.error("WEBHOOK ERROR:", err);
    res.sendStatus(500);
  }
});

// =============================
// DASHBOARD API
// =============================
app.get("/conversations", async (req, res) => {
  const { data } = await supabase
    .from("messages")
    .select("*")
    .order("created_at", { ascending: false });

  res.json(data);
});

// =============================
app.listen(process.env.PORT || 3000, () => {
  console.log("🚀 Server running");
});