import express from "express";
import bodyParser from "body-parser";
import axios from "axios";
import { createClient } from "@supabase/supabase-js";
import OpenAI from "openai";

const app = express();
app.use(bodyParser.json());
app.use(express.static("public"));

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const takeover = new Set();

// ======================
// SEND WHATSAPP
// ======================
async function send(to, text) {
  await axios.post(
    `https://graph.facebook.com/v18.0/${process.env.PHONE_NUMBER_ID}/messages`,
    {
      messaging_product: "whatsapp",
      to,
      type: "text",
      text: { body: text }
    },
    {
      headers: {
        Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
        "Content-Type": "application/json"
      }
    }
  );
}

// ======================
// SAVE MESSAGE
// ======================
async function saveMessage(phone, role, message, property_id) {
  await supabase.from("messages").insert([
    { phone, role, message, property_id }
  ]);
}

// ======================
// GET HISTORY
// ======================
async function getHistory(phone) {
  const { data } = await supabase
    .from("messages")
    .select("*")
    .eq("phone", phone)
    .order("created_at", { ascending: true })
    .limit(20);

  return data || [];
}

// ======================
// GET PROPERTY
// ======================
async function getProperty(property_id) {
  const { data } = await supabase
    .from("property_info")
    .select("*")
    .eq("property_id", property_id)
    .single();

  return data;
}

// ======================
// AI RESPONSE
// ======================
async function askAI(text, property, history) {
  try {
    const context = history.map(m => `${m.role}: ${m.message}`).join("\n");

    const prompt = `
You are an assistant for a vacation rental.

PROPERTY INFO:
${JSON.stringify(property)}

CONVERSATION:
${context}

USER: ${text}

Answer clearly and helpfully.
`;

    const res = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }]
    });

    return res.choices[0].message.content;
  } catch (e) {
    return null;
  }
}

// ======================
// WEBHOOK
// ======================
app.post("/webhook", async (req, res) => {
  try {
    const msg = req.body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
    if (!msg) return res.sendStatus(200);

    const from = msg.from;
    const text = msg.text?.body;

    if (!text) return res.sendStatus(200);

    // property id fisso per ora
    const property_id = "80ffd815-7985-47a1-84d6-c9463bf13590";

    await saveMessage(from, "guest", text, property_id);

    // takeover attivo
    if (takeover.has(from)) {
      await send(from, "👤 L'host ti risponderà a breve.");
      return res.sendStatus(200);
    }

    const property = await getProperty(property_id);
    const history = await getHistory(from);

    let reply = await askAI(text, property, history);

    if (!reply) {
      reply = "Sorry, I couldn't find the information.";
    }

    await saveMessage(from, "assistant", reply, property_id);
    await send(from, reply);

    res.sendStatus(200);
  } catch (err) {
    console.error(err);
    res.sendStatus(500);
  }
});

// ======================
// HOST SEND MESSAGE
// ======================
app.post("/host-send", async (req, res) => {
  const { phone, message } = req.body;

  await send(phone, message);
  await saveMessage(phone, "host", message, null);

  res.sendStatus(200);
});

// ======================
// TAKEOVER
// ======================
app.post("/takeover", (req, res) => {
  const { phone, active } = req.body;

  if (active) takeover.add(phone);
  else takeover.delete(phone);

  res.sendStatus(200);
});

// ======================
// GET CONVERSATIONS
// ======================
app.get("/conversations", async (req, res) => {
  const { data } = await supabase
    .from("messages")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(100);

  res.json(data);
});

// ======================
app.listen(process.env.PORT || 3000, () => {
  console.log("🚀 Server running");
});