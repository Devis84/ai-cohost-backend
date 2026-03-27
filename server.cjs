const express = require("express");
const axios = require("axios");
const OpenAI = require("openai");
const { createClient } = require("@supabase/supabase-js");

const app = express();
app.use(express.json());

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

function mapRole(role) {
  if (role === "guest") return "user";
  if (role === "assistant") return "assistant";
  return "user";
}

app.post("/webhook", async (req, res) => {
  console.log("WEBHOOK");

  try {
    const msg = req.body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];

    if (!msg) {
      return res.sendStatus(200);
    }

    const from = msg.from;
    const text = msg.text?.body;

    if (!text) {
      return res.sendStatus(200);
    }

    console.log("FROM:", from);
    console.log("TEXT:", text);

    // salva utente
    await supabase.from("conversations").insert([
      { phone: from, role: "guest", message: text }
    ]);

    // storico
    const { data: history } = await supabase
      .from("conversations")
      .select("*")
      .eq("phone", from)
      .order("created_at", { ascending: true })
      .limit(10);

    const messages = [
      {
        role: "system",
        content: "Sei un assistente Airbnb. Risposte brevi e utili."
      }
    ];

    if (history) {
      for (const h of history) {
        messages.push({
          role: mapRole(h.role),
          content: h.message
        });
      }
    }

    console.log("CALL OPENAI");

    const ai = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: messages
    });

    const reply = ai.choices[0].message.content;

    console.log("AI:", reply);

    // salva risposta
    await supabase.from("conversations").insert([
      { phone: from, role: "assistant", message: reply }
    ]);

    // invia whatsapp
    await axios.post(
      `https://graph.facebook.com/v18.0/${process.env.PHONE_NUMBER_ID}/messages`,
      {
        messaging_product: "whatsapp",
        to: from,
        text: { body: reply }
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
          "Content-Type": "application/json"
        }
      }
    );

    console.log("SENT");

    res.sendStatus(200);

  } catch (err) {
    console.log("ERROR:", err.message);
    res.sendStatus(500);
  }
});

app.get("/", (req, res) => {
  res.send("OK");
});

app.listen(process.env.PORT || 3001, () => {
  console.log("SERVER LIVE");
});