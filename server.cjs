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
// SESSION + TAKEOVER
// ============================
const sessions = new Map(); // phone → property
const takeover = new Set(); // phone in manual mode

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
// AI REPLY
// ============================
function generateReply(msg, p) {
  if (!p) return "Errore recupero dati.";

  const t = msg.toLowerCase();

  if (t.includes("wifi")) return `📶 ${p.wifi}`;
  if (t.includes("check in")) return `🕓 ${p.checkin}`;
  if (t.includes("check out")) return `🕓 ${p.checkout}`;
  if (t.includes("parcheggio")) return `🚗 ${p.parking}`;
  if (t.includes("regole")) return `📋 ${p.house_rules}`;
  if (t.includes("ristoranti")) return `🍝 ${p.restaurants}`;
  if (t.includes("trasporti")) return `🚌 ${p.transport}`;
  if (t.includes("zona")) return `📍 ${p.location_info}`;
  if (t.includes("emergenza")) return `📞 ${p.emergency_contact}`;

  return "🙂 Posso aiutarti con WiFi, check-in, parcheggio e info.";
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
// NOTIFY HOST
// ============================
async function notifyHost(phone, text) {
  await send(
    HOST_PHONE,
    `👤 Guest: ${phone}\n💬 ${text}`
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

    console.log("MSG:", from, text);

    // ============================
    // HOST COMMANDS
    // ============================
    if (from === HOST_PHONE) {
      if (text.startsWith("/takeover")) {
        const target = text.split(" ")[1];
        takeover.add(target);
        await send(from, `✅ Takeover attivo per ${target}`);
        return res.sendStatus(200);
      }

      if (text.startsWith("/release")) {
        const target = text.split(" ")[1];
        takeover.delete(target);
        await send(from, `♻️ AI riattivata per ${target}`);
        return res.sendStatus(200);
      }

      // risposta manuale host
      const target = text.split("|")[0];
      const reply = text.split("|")[1];

      if (target && reply) {
        await send(target, reply);
        return res.sendStatus(200);
      }
    }

    // ============================
    // START PID
    // ============================
    if (text.startsWith("/start")) {
      const match = text.match(/pid=([a-zA-Z0-9-]+)/);
      if (match) {
        const pid = match[1];
        sessions.set(from, pid);

        await send(from, "✅ Assistente attivo!");
        return res.sendStatus(200);
      }
    }

    const propertyId = sessions.get(from);

    if (!propertyId) {
      await send(from, "📲 Scansiona il QR della casa.");
      return res.sendStatus(200);
    }

    await saveMessage(from, "guest", text, propertyId);

    // ============================
    // HOST NOTIFY
    // ============================
    await notifyHost(from, text);

    // ============================
    // TAKEOVER MODE
    // ============================
    if (takeover.has(from)) {
      await send(from, "👤 L’host ti risponderà a breve.");
      return res.sendStatus(200);
    }

    // ============================
    // AI
    // ============================
    const property = await getProperty(propertyId);
    const reply = generateReply(text, property);

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