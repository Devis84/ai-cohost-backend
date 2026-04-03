const express = require("express");
const bodyParser = require("body-parser");

const app = express();
app.use(bodyParser.json());

const VERIFY_TOKEN = "my_verify_token";
const ACCESS_TOKEN = process.env.META_TOKEN;

// 🧠 memoria semplice anti-duplicati
const processedMessages = new Set();

// 🔐 WEBHOOK VERIFY
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode && token === VERIFY_TOKEN) {
    console.log("WEBHOOK VERIFIED");
    return res.status(200).send(challenge);
  } else {
    return res.sendStatus(403);
  }
});

// 📩 INCOMING MESSAGE
app.post("/webhook", async (req, res) => {
  try {
    const entry = req.body.entry?.[0];
    const changes = entry?.changes?.[0];
    const message = changes?.value?.messages?.[0];

    if (!message) return res.sendStatus(200);

    const messageId = message.id;

    // 🔥 BLOCCA DUPLICATI
    if (processedMessages.has(messageId)) {
      console.log("Duplicate message ignored:", messageId);
      return res.sendStatus(200);
    }

    processedMessages.add(messageId);

    const from = message.from;
    const text = message.text?.body?.toLowerCase();

    if (!text) return res.sendStatus(200);

    let reply = "Sorry, I didn't understand.";

    if (text.includes("wifi")) {
      reply = "📶 Network: ARRIS-6F59 | Password: Malta2025";
    }

    await fetch(`https://graph.facebook.com/v18.0/${process.env.PHONE_NUMBER_ID}/messages`, {
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
    });

  } catch (err) {
    console.error("ERROR:", err);
  }

  res.sendStatus(200);
});

app.listen(10000, () => console.log("🚀 Server running"));