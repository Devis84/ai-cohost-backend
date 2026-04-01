const express = require("express");
const bodyParser = require("body-parser");
const axios = require("axios");
const { createClient } = require("@supabase/supabase-js");
const OpenAI = require("openai");

const app = express();
app.use(bodyParser.json());
app.use(express.static("public"));

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const takeover = new Set();

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
async function saveMessage(phone, role, message, property_id) {
  await supabase.from("messages").insert([
    { phone, role, message, property_id }
  ]);
}

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
async function getProperty(property_id) {
  const { data } = await supabase
    .from("property_info")
    .select("*")
    .eq("property_id", property_id)
    .single();

  return data;
}

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

Answer clearly.
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
app.post("/webhook", async (req, res) => {
  try {
    const msg = req.body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
    if (!msg) return res.sendStatus(200);

    const from = msg.from;
    const text = msg.text?.body;
    if (!text) return res.sendStatus(200);

    const property_id = "80ffd815-7985-47a1-84d6-c9463bf13590";

    await saveMessage(from, "guest", text, property_id);

    if (takeover.has(from)) {
      await send(from, "👤 Host will reply shortly.");
      return res.sendStatus(200);
    }

    const property = await getProperty(property_id);
    const history = await getHistory(from);

    let reply = await askAI(text, property, history);

    if (!reply) reply = "I couldn't find that information.";

    await saveMessage(from, "assistant", reply, property_id);
    await send(from, reply);

    res.sendStatus(200);
  } catch (err) {
    console.error(err);
    res.sendStatus(500);
  }
});

// ======================
app.post("/host-send", async (req, res) => {
  const { phone, message } = req.body;

  await send(phone, message);
  await saveMessage(phone, "host", message, null);

  res.sendStatus(200);
});

// ======================
app.post("/takeover", (req, res) => {
  const { phone, active } = req.body;

  if (active) takeover.add(phone);
  else takeover.delete(phone);

  res.sendStatus(200);
});

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