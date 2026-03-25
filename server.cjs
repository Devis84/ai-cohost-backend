const express = require("express");

const app = express();
const PORT = 3001;

// 🔥 serve per leggere JSON (FONDAMENTALE)
app.use(express.json());

// Test base
app.get("/", (req, res) => {
  res.send("OK");
});

// 🔥 VERIFICA WEBHOOK META
app.get("/webhook", (req, res) => {
  const VERIFY_TOKEN = "my_verify_token";

  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  console.log("🔥 Query ricevuta:", req.query);

  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    console.log("✅ WEBHOOK VERIFICATO DA META");
    return res.status(200).send(challenge);
  } else {
    console.log("❌ TOKEN NON VALIDO");
    return res.sendStatus(403);
  }
});

// 🔥 QUI ARRIVANO I DATI VERI (POST)
app.post("/webhook", (req, res) => {
  console.log("📩 WEBHOOK POST RICEVUTO:");
  console.log(JSON.stringify(req.body, null, 2));

  res.sendStatus(200);
});

app.listen(PORT, () => {
  console.log("🚀 Server running on port " + PORT);
});