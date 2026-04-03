const express = require("express");
import bodyParser from "body-parser";
const fetch = require("node-fetch");

const app = express();
app.use(bodyParser.json());

const VERIFY_TOKEN = "my_verify_token_123";
const ACCESS_TOKEN = process.env.META_TOKEN;

// ✅ QUESTA È LA PARTE CHE TI MANCAVA
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    console.log("WEBHOOK VERIFIED");
    return res.status(200).send(challenge);
  }

  res.sendStatus(403);
});

// ✅ RICEZIONE MESSAGGI
app.post("/webhook", async (req, res) => {
  try {
    console.log("RAW BODY:", JSON.stringify(req.body, null, 2));

    const entry = req.body.entry?.[0];
    const changes = entry?.changes?.[0];
    const value = changes?.value;

    const message = value?.messages?.[0];

    if (!message) {
      return res.sendStatus(200);
    }

    const from = message.from;
    const text = message.text?.body || "";

    console.log("MESSAGE RECEIVED:", text);

    let reply = "Non ho capito 😅";

    if (text.toLowerCase().includes("wifi")) {
      reply = "📶 Network: ARRIS-6F59 | Password: Malta2025";
    }

    if (text.toLowerCase().includes("parcheggio")) {
      reply = "🚗 Parcheggio gratuito nei dintorni. Nessun parcheggio privato.";
    }

    await fetch(
      `https://graph.facebook.com/v19.0/${value.metadata.phone_number_id}/messages`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${ACCESS_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          to: from,
          text: { body: reply },
        }),
      }
    );

    res.sendStatus(200);
  } catch (err) {
    console.error("ERROR:", err);
    res.sendStatus(500);
  }
});

app.listen(10000, () => console.log("🚀 Server running"));