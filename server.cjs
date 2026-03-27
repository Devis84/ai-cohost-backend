const express = require("express");
const axios = require("axios");
const OpenAI = require("openai");

const app = express();
app.use(express.json());

// 🔐 ENV
const VERIFY_TOKEN = "my_verify_token";
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

// 🤖 OpenAI
const openai = new OpenAI({
  apiKey: OPENAI_API_KEY,
});

// 🧠 MEMORIA
const conversations = {};
const processedMessages = new Set();

// 🔍 VERIFY
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    console.log("✅ WEBHOOK VERIFICATO");
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
});

// 📩 WEBHOOK
app.post("/webhook", async (req, res) => {
  console.log("📩 WEBHOOK POST RICEVUTO");

  try {
    const message =
      req.body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];

    if (!message || !message.text) {
      console.log("⚠️ Nessun messaggio valido");
      return res.sendStatus(200);
    }

    const messageId = message.id;

    // 🚫 BLOCCA DUPLICATI
    if (processedMessages.has(messageId)) {
      console.log("⚠️ Messaggio già processato");
      return res.sendStatus(200);
    }

    processedMessages.add(messageId);

    const from = message.from;
    const text = message.text.body;

    console.log("👤 Da:", from);
    console.log("💬 Testo:", text);

    // 🧠 CREA MEMORIA
    if (!conversations[from]) {
      conversations[from] = [];
    }

    // ➕ USER
    conversations[from].push({
      role: "user",
      content: text,
    });

    // ✂️ LIMITE
    conversations[from] = conversations[from].slice(-10);

    console.log("🧠 Memoria:", conversations[from]);

    // 🤖 AI
    const aiResponse = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content:
            "Sei un assistente Airbnb. Rispondi come un host reale. Dai prezzi indicativi (es. 100-120€) e chiedi sempre le date. Risposte brevi e concrete.",
        },
        ...conversations[from],
      ],
    });

    const reply = aiResponse.choices[0].message.content;

    console.log("🤖 AI:", reply);

    // ➕ SALVA AI
    conversations[from].push({
      role: "assistant",
      content: reply,
    });

    // 📤 INVIO
    await axios.post(
      `https://graph.facebook.com/v19.0/${PHONE_NUMBER_ID}/messages`,
      {
        messaging_product: "whatsapp",
        to: from,
        text: { body: reply },
      },
      {
        headers: {
          Authorization: `Bearer ${WHATSAPP_TOKEN}`,
          "Content-Type": "application/json",
        },
      }
    );

    console.log("📤 RISPOSTA INVIATA");

    res.sendStatus(200);
  } catch (error) {
    console.error("❌ ERRORE:", error.response?.data || error.message);
    res.sendStatus(500);
  }
});

// 🚀 START
const PORT = process.env.PORT || 10000;

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});