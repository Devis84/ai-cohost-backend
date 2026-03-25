const express = require("express");
const bodyParser = require("body-parser");
const axios = require("axios");
require("dotenv").config();

const OpenAI = require("openai");

const app = express();
app.use(bodyParser.json());

const PORT = process.env.PORT || 3001;

// 🔥 OPENAI
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// 🔥 WEBHOOK VERIFICA (GET)
app.get("/webhook", (req, res) => {
  const VERIFY_TOKEN = "my_verify_token";

  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  console.log("🔍 Verifica webhook...");

  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    console.log("✅ WEBHOOK VERIFICATO DA META");
    return res.status(200).send(challenge);
  } else {
    console.log("❌ TOKEN NON VALIDO");
    return res.sendStatus(403);
  }
});

// 🔥 WEBHOOK MESSAGGI (POST)
app.post("/webhook", async (req, res) => {
  console.log("📩 WEBHOOK POST RICEVUTO:");
  console.log(JSON.stringify(req.body, null, 2));

  try {
    const messages =
      req.body.entry?.[0]?.changes?.[0]?.value?.messages;

    if (!messages) {
      console.log("⚠️ Nessun messaggio trovato");
      return res.sendStatus(200);
    }

    const message = messages[0];
    const from = message.from;
    const text = message.text?.body;

    console.log("👤 Da:", from);
    console.log("💬 Testo:", text);

    // 🔥 CHIAMATA OPENAI
    const aiResponse = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content:
            "Sei un co-host Airbnb professionale. Rispondi in modo chiaro, cordiale e utile.",
        },
        {
          role: "user",
          content: text,
        },
      ],
    });

    const reply = aiResponse.choices[0].message.content;

    console.log("🤖 Risposta AI:", reply);

    // 🔥 INVIO RISPOSTA WHATSAPP
    await axios.post(
      "https://graph.facebook.com/v18.0/+35677088080/messages",
      {
        messaging_product: "whatsapp",
        to: from,
        text: { body: reply },
      },
      {
        headers: {
          Authorization: "EAAVvcnWyukgBRLZBR0TVaDZB7jxn0KTNvy6X1jEpFLHPouMWZCuAxDDXuZB258uOpolf9N8ehwxlFKdAe3E5VF0GfU3YYhVTVEt6SWlNoplmvzfVdEZCkdc4pvZCBTXlAddYwDRJUIjFjx0QjS8qRXKf2PSEFsPQMfM6caTbnKWPyoDIRCuZCo9tBVCdukZBjRbFDCfM5H0MpjsjV3c61SxNCuhqx9S4GyqUzKtinkuEWqesWRCAJoykstkiJlETEkXJCLlLetiRoVFukT82AHZBtrQZDZD",
          "Content-Type": "application/json",
        },
      }
    );

    res.sendStatus(200);
  }