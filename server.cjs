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
console.log("🔑 API KEY:", process.env.OPENAI_API_KEY ? "PRESENTE" : "MANCANTE");

// 🔐 VERIFICA WEBHOOK
app.get("/webhook", (req, res) => {
  const VERIFY_TOKEN = "my_verify_token";

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

// 📩 RICEZIONE MESSAGGI
app.post("/webhook", async (req, res) => {
  console.log("📩 WEBHOOK:");
  console.log(JSON.stringify(req.body, null, 2));

  try {
    const value = req.body.entry?.[0]?.changes?.[0]?.value;

    if (!value) {
      console.log("❌ Nessun value");
      return res.sendStatus(200);
    }

    const message = value.messages?.[0];

    if (!message) {
      console.log("⚠️ Nessun messaggio (probabile status update)");
      return res.sendStatus(200);
    }

    const from = message.from;
    const text = message.text?.body;

    if (!text) {
      console.log("⚠️ Messaggio senza testo");
      return res.sendStatus(200);
    }

    console.log("👤 Da:", from);
    console.log("💬 Testo:", text);

    // 🤖 OPENAI
    console.log("🚀 CHIAMO OPENAI...");

const aiResponse = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content:
            "Sei un assistente Airbnb professionale. Rispondi in modo cordiale e utile.",
        },
        {
          role: "user",
          content: text,
        },
      ],
    });

    const reply = aiResponse.choices[0].message.content;
console.log("✅ OPENAI RISPOSTO");

    console.log("🤖 AI:", reply);

    // 📤 INVIO RISPOSTA
    await axios.post(
      `https://graph.facebook.com/v18.0/1101846813008656/messages,
      {
        messaging_product: "whatsapp",
        to: from,
        text: { body: reply },
      },
      {
        headers: {
          Authorization: await axios.post(
  "https://graph.facebook.com/v18.0/1101846813008656/messages",
  {
    messaging_product: "whatsapp",
    to: from,
    text: { body: aiReply },
  },
  {
    headers: {
      Authorization: "Bearer EAAVvcnWyukgBRLZBR0TVaDZB7jxn0KTNvy6X1jEpFLHPouMWZCuAxDDXuZB258uOpolf9N8ehwxlFKdAe3E5VF0GfU3YYhVTVEt6SWlNoplmvzfVdEZCkdc4pvZCBTXlAddYwDRJUIjFjx0QjS8qRXKf2PSEFsPQMfM6caTbnKWPyoDIRCuZCo9tBVCdukZBjRbFDCfM5H0MpjsjV3c61SxNCuhqx9S4GyqUzKtinkuEWqesWRCAJoykstkiJlETEkXJCLlLetiRoVFukT82AHZBtrQZDZD",
      "Content-Type": "application/json",
    },
  }
);
          "Content-Type": "application/json",
        },
      }
    );

    console.log("📤 Risposta inviata");

    res.sendStatus(200);
  } catch (error) {
    console.error("❌ ERRORE:", error.response?.data || error.message);
    res.sendStatus(500);
  }
});

app.listen(PORT, () => {
  console.log("🚀 Server running on port " + PORT);
});