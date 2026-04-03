const express = require("express");
const bodyParser = require("body-parser");
const { createClient } = require("@supabase/supabase-js");
const OpenAI = require("openai");

const app = express();

// ⚠️ fondamentale per Twilio
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());

// =========================
// CONFIG
// =========================
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// =========================
// HEALTH CHECK
// =========================
app.get("/", (req, res) => {
  res.send("AI Co-Host running");
});

// =========================
// WEBHOOK WHATSAPP
// =========================
app.post("/webhook", async (req, res) => {
  try {
    console.log("RAW BODY:", req.body);

    const fromRaw = req.body.From || "";
    const text = req.body.Body || "";

    // 👉 evita crash Twilio
    if (!fromRaw || !text) {
      console.log("Invalid webhook call");

      res.set("Content-Type", "text/xml");
      return res.send("<Response></Response>");
    }

    const from = fromRaw.replace("whatsapp:", "");

    console.log("Incoming:", from, text);

    // =========================
    // SALVA MESSAGGIO GUEST
    // =========================
    await supabase.from("messages").insert({
      phone: from,
      role: "guest",
      message: text,
    });

    // =========================
    // STORICO CHAT
    // =========================
    const { data: history } = await supabase
      .from("messages")
      .select("*")
      .eq("phone", from)
      .order("created_at", { ascending: true });

    const messages = history.map((m) => ({
      role: m.role === "assistant" ? "assistant" : "user",
      content: m.message,
    }));

    // =========================
    // AI RESPONSE
    // =========================
    const completion = await openai.chat.completions.create({
      model: "gpt-4.1-mini",
      messages,
    });

    const reply =
      completion.choices?.[0]?.message?.content ||
      "Sorry, I couldn't reply.";

    console.log("AI reply:", reply);

    // =========================
    // SALVA RISPOSTA
    // =========================
    await supabase.from("messages").insert({
      phone: from,
      role: "assistant",
      message: reply,
    });

    // =========================
    // RISPOSTA TWILIO (CRITICO)
    // =========================
    res.set("Content-Type", "text/xml");
    res.send(`
      <Response>
        <Message>${reply}</Message>
      </Response>
    `);

  } catch (err) {
    console.error("SERVER ERROR:", err);

    res.set("Content-Type", "text/xml");
    res.send(`
      <Response>
        <Message>Temporary error, please try again.</Message>
      </Response>
    `);
  }
});

// =========================
// START SERVER
// =========================
app.listen(process.env.PORT || 3000, () => {
  console.log("🚀 Server running");
});