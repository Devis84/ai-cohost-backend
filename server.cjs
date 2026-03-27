const express = require("express");

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3001;

// 🔐 VERIFICA WEBHOOK
app.get("/webhook", (req, res) => {
  const VERIFY_TOKEN = "my_verify_token";

  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  console.log("🔍 Verifica webhook");

  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    console.log("✅ VERIFICATO");
    return res.status(200).send(challenge);
  } else {
    console.log("❌ ERRORE TOKEN");
    return res.sendStatus(403);
  }
});

// 📩 RICEZIONE MESSAGGI
app.post("/webhook", (req, res) => {
  console.log("📩 WEBHOOK RICEVUTO");
  console.log(JSON.stringify(req.body, null, 2));

  const message =
    req.body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];

  if (!message) {
    console.log("⚠️ Nessun messaggio (status o altro)");
    return res.sendStatus(200);
  }

  const text = message.text?.body;

  console.log("💬 TESTO:", text);

  res.sendStatus(200);
});

app.listen(PORT, () => {
  console.log("🚀 Server running on port " + PORT);
});