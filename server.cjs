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

// 🧠 MEMORIA IN RAM
const conversations = {};

// 🔍 WEBHOOK VERIFICA
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    console.log("✅ WEBHOOK VERIFICATO");
    return res.status(200).send(challenge);
  } else {
    return res.sendStatus(403);
  }
});

// 📩 WEBHOOK RICEZIONE
app.post("/webhook", async (req, res) => {
  console.log("📩 WEBHOOK POST RICEVUTO");

  try {
    const message =
      req.body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];

    if (!message || !message.text) {
      console.log("⚠️ Nessun messaggio valido");
      return res.sendStatus(200);
    }

    const from = message.from;
    const text = message.text.body;

    console.log("👤 Da:", from);
    console.log("💬 Testo:", text);

    // 🧠 CREA MEMORIA SE NON ESISTE
    if (!conversations[from]) {
      conversations[from] = [];
    }

    // ➕ AGGIUNGI MESSAGGIO UTENTE
    conversations[from].push({
      role: "user",
      content: text,
    });

    // ✂️ LIMITA MEMORIA (ultimi 10 messaggi)
    conversations[from] = conversations[from].slice(-10);

    console.log("🧠 Conversazione:", conversations[from]);

    // 🤖 CHIAMATA OPENAI CON CONTEXTO
    const aiResponse = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content:
            "Sei un assistente per un host Airbnb. Rispondi in modo naturale, breve e utile. Dai informazioni concrete. Se parlano di prezzi, dai una stima realistica (es. 100-120€) e chiedi le date.",
        },
        ...conversations[from],
      ],
    });

    const reply = aiResponse.choices[0].message.content;

    console.log("🤖 AI:", reply);

    // ➕ SALVA RISPOSTA AI
    conversations[from].push({
      role: "assistant",
      content: reply,
    });

    // 📤 INVIO WHATSAPP
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

// 🚀 SERVER
const PORT = process.env.PORT || 10000;

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});