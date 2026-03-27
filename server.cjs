const express = require("express");
const bodyParser = require("body-parser");
const axios = require("axios");
require("dotenv").config();
const OpenAI = require("openai");

const app = express();
app.use(bodyParser.json());

const PORT = process.env.PORT || 3001;

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// ===== VERIFY WEBHOOK =====
app.get("/webhook", (req, res) => {
  const VERIFY_TOKEN = "my_verify_token";

  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode && token === VERIFY_TOKEN) {
    console.log("✅ WEBHOOK VERIFICATO");
    res.status(200).send(challenge);
  } else {
    res.sendStatus(403);
  }
});

// ===== RICEZIONE MESSAGGI =====
app.post("/webhook", async (req, res) => {
  console.log("📩 WEBHOOK POST RICEVUTO");

  try {
    const body = req.body;

    const message =
      body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];

    if (!message) {
      console.log("⚠️ Nessun messaggio trovato");
      return res.sendStatus(200);
    }

    const from = message.from;
    const text = message.text?.body;

    console.log("👤 Da:", from);
    console.log("💬 Testo:", text);

    if (!text) {
      console.log("⚠️ Messaggio senza testo");
      return res.sendStatus(200);
    }

    // ===== OPENAI =====
    console.log("🚀 CHIAMO OPENAI...");

    const aiResponse = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `
Sei l'assistente WhatsApp di un host Airbnb reale.

REGOLE IMPORTANTI:
- NON dare risposte generiche
- NON parlare di Airbnb in generale
- NON dire "dipende" senza dare una risposta concreta
- Rispondi come se gestissi una casa specifica

COMPORTAMENTO:
- Se chiedono il prezzo → dai un esempio concreto (es: "di solito intorno ai 100-120€")
- Poi chiedi le date per dare prezzo preciso
- Risposte brevi, umane, naturali
- Tono cordiale ma diretto

ESEMPIO:
Domanda: "quanto costa una notte?"
Risposta:
"Certo! Di solito siamo intorno ai 100€ a notte, ma dipende dalle date. Se mi dici quando vorresti venire ti do il prezzo preciso 😊"
`,
        },
        {
          role: "user",
          content: text,
        },
      ],
    });

    const reply = aiResponse.choices[0].message.content;

    console.log("🤖 AI:", reply);

    // ===== INVIO RISPOSTA =====
    await axios.post(
      `https://graph.facebook.com/v18.0/${process.env.PHONE_NUMBER_ID}/messages`,
      {
        messaging_product: "whatsapp",
        to: from,
        text: { body: reply },
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
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

// ===== START SERVER =====
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});