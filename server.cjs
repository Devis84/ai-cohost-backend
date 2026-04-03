const express = require("express");
const bodyParser = require("body-parser");
const { createClient } = require("@supabase/supabase-js");
const OpenAI = require("openai");

const app = express();

// supporta entrambi i formati
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
// WEBHOOK
// =========================
app.post("/webhook", async (req, res) => {
  try {
    console.log("RAW BODY:", req.body);

    // =========================
    // 🚫 IGNORA META WEBHOOK
    // =========================
    if (req.body.object === "whatsapp_business_account") {
      console.log("Meta webhook detected → ignored");
      return res.sendStatus(200);
    }

    // =========================
    // ✅ TWILIO FLOW
    // =========================
    const fromRaw = req.body.From;
    const text = req.body.Body;

    if (!fromRaw || !text) {
      console.log("Invalid Twilio payload");
      return res.send("<Response></Response>");
    }

    const from = fromRaw.replace("whatsapp:", "");

    console.log("Incoming Twilio:", from, text);

    // salva guest
    await supabase.from("messages").insert({
      phone: from,
      role: "guest",
      message: text,
    });

    // storico
    const { data: history } = await supabase
      .from("messages")
      .select("*")
      .eq("phone", from)
      .order("created_at", { ascending: true });

    const messages = history.map((m) => ({
      role: m.role === "assistant" ? "assistant" : "user",
      content: m.message,
    }));

    // AI
    const completion = await openai.chat.completions.create({
      model: "gpt-4.1-mini",
      messages,
    });

    const reply =
      completion.choices?.[0]?.message?.content ||
      "Error generating response";

    console.log("AI reply:", reply);

    // salva risposta
    await supabase.from("messages").insert({
      phone: from,
      role: "assistant",
      message: reply,
    });

    // risposta Twilio
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
        <Message>Error, try again.</Message>
      </Response>
    `);
  }
});

// =========================
// START
// =========================
app.listen(process.env.PORT || 3000, () => {
  console.log("🚀 Server running");
});