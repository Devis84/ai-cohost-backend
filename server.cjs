import express from "express";
import bodyParser from "body-parser";
import axios from "axios";
import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";
import path from "path";
import { fileURLToPath } from "url";

dotenv.config();

const app = express();
app.use(bodyParser.json());

// FIX PATH (__dirname)
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 🔥 SERVE FILE STATICI (QUESTO È IL FIX)
app.use(express.static(__dirname));

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
// SEND MESSAGE
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
// GET PROPERTY INFO
// =============================
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

// =============================
// SAVE MESSAGE
// =============================
async function saveMessage(phone, role, message, propertyId) {
  await supabase.from("messages").insert([
    {
      phone,
      role,
      message,
      property_id: propertyId
    }
  ]);
}

// =============================
// HOST NOTIFY
// =============================
async function notifyHost(phone, text) {
  if (!HOST_PHONE) return;

  await send(
    HOST_PHONE,
    `👤 Guest ${phone}\n💬 ${text}`
  );
}

// =============================
// SIMPLE AI
// =============================
function smartReply(text, property) {
  const t = text.toLowerCase();

  if (t.includes("wifi")) {
    return `📶 WiFi: ${property.wifi}`;
  }

  if (t.includes("check")) {
    return `🕒 Check-in: ${property.checkin}`;
  }

  if (t.includes("parking")) {
    return `🚗 ${property.parking}`;
  }

  if (t.includes("party")) {
    return `🚫 ${property.house_rules}`;
  }

  if (t.includes("airport") || t.includes("transport")) {
    return `🚕 ${property.transport}`;
  }

  return `🙂 Posso aiutarti con WiFi, check-in, parcheggio e info.`;
}

// =============================
// START COMMAND
// =============================
app.post("/webhook", async (req, res) => {
  try {
    const msg = req.body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
    if (!msg) return res.sendStatus(200);

    const from = msg.from;
    const text = msg.text?.body;

    if (!sessions[from]) {
      sessions[from] = {};
    }

    // START
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
// START SERVER
// =============================
app.listen(process.env.PORT || 3000, () => {
  console.log("🚀 Server running");
});