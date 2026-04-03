const express = require("express");
const bodyParser = require("body-parser");
const { createClient } = require("@supabase/supabase-js");
const OpenAI = require("openai");

const app = express();
app.use(bodyParser.urlencoded({ extended: false }));

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// =========================
// WEBHOOK WHATSAPP
// =========================
app.post("/webhook", async (req, res) => {
  try {
    const from = req.body.From.replace("whatsapp:", "");
    const text = req.body.Body;

    console.log("Incoming:", from, text);

    // salva messaggio guest
    await supabase.from("messages").insert({
      phone: from,
      role: "guest",
      message: text,
    });

    // recupera storico
    const { data: history } = await supabase
      .from("messages")
      .select("*")
      .eq("phone", from)
      .order("created_at", { ascending: true });

    const messages = history.map((m) => ({
      role: m.role === "assistant" ? "assistant" : "user",
      content: m.message,
    }));

    // AI risposta
    const completion = await openai.chat.completions.create({
      model: "gpt-4.1-mini",
      messages,
    });

    const reply = completion.choices[0].message.content;

    // salva risposta
    await supabase.from("messages").insert({
      phone: from,
      role: "assistant",
      message: reply,
    });

    // ⚠️ RISPOSTA CORRETTA PER TWILIO (FONDAMENTALE)
    res.set("Content-Type", "text/xml");
    res.send(`
      <Response>
        <Message>${reply}</Message>
      </Response>
    `);

  } catch (err) {
    console.error(err);

    res.set("Content-Type", "text/xml");
    res.send(`
      <Response>
        <Message>Errore temporaneo, riprova.</Message>
      </Response>
    `);
  }
});

// =========================
// SERVER
// =========================
app.listen(process.env.PORT || 3000, () => {
  console.log("🚀 Server running");
});