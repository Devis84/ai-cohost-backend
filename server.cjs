const express = require("express");
const bodyParser = require("body-parser");
const fetch = require("node-fetch");

const app = express();
app.use(bodyParser.json());

const VERIFY_TOKEN = "my_verify_token";
const ACCESS_TOKEN = process.env.META_TOKEN;

// WEBHOOK VERIFY
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

// INCOMING MESSAGE
app.post("/webhook", async (req, res) => {
  console.log("RAW BODY:", JSON.stringify(req.body, null, 2));

  const entry = req.body.entry?.[0];
  const changes = entry?.changes?.[0];
  const message = changes?.value?.messages?.[0];

  if (!message) {
    return res.sendStatus(200);
  }

  const from = message.from;
  const text = message.text?.body?.toLowerCase();

  let reply = "Sorry, I didn't understand.";

  if (text && text.includes("wifi")) {
    reply = "Network: ARRIS-6F59 | Password: Malta2025";
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

  res.sendStatus(200);
});

app.listen(10000, () => console.log("Server running"));