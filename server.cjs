require("dotenv").config();
const express = require("express");
const axios = require("axios");
const OpenAI = require("openai");
const { createClient } = require("@supabase/supabase-js");

const app = express();
app.use(express.json());

// OPENAI
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// SUPABASE
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

// MAPPATURA RUOLI
function mapRole(role) {
  if (role === "guest") return "user";
  if (role === "assistant") return "assistant";
  return "user";
}

// ===== ESTRAZIONE DATI =====
async function extractInfo(text) {
  const res = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      {
        role: "system",
        content: `
Estrai informazioni dal messaggio.

Rispondi SOLO in JSON:

{
  "month": "...",
  "dates": "...",
  "guests": number
}

Se non presenti → null
`,
      },
      {
        role: "user",
        content: text,
      },
    ],
  });

  try {
    return JSON.parse(res.choices[0].message.content);
  } catch {
    return {};
  }
}

// WEBHOOK
app.post("/webhook", async (req, res) => {
  try {
    console.log("📩 WEBHOOK");

    const entry = req.body.entry?.[0];
    const changes = entry?.changes?.[0];
    const value = changes?.value;
    const message = value?.messages?.[0];

    if (!message) return res.sendStatus(200);

    const from = message.from;
    const text = message.text?.body;

    if (!text) return res.sendStatus(200);

    console.log("💬 TEXT:", text);

    // ===== ESTRAZIONE INFO =====
    const info = await extractInfo(text);

    console.log("🧠 INFO:", info);

    // ===== SALVA UTENTE =====
    await supabase.from("conversations").insert([
      {
        phone: from,
        role: "guest",
        message: text,
        guest_month: info.month || null,
        guest_dates: info.dates || null,
        guest_count: info.guests || null,
      },
    ]);

    console.log("✅ Salvato utente");

    // ===== RECUPERA STORICO =====
    const { data: history } = await supabase
      .from("conversations")
      .select("*")
      .eq("phone", from)
      .order("created_at", { ascending: true })
      .limit(10);

    // ===== COSTRUZIONE CONTESTO =====
    let memoryContext = "";

    if (history) {
      const last = history.reverse().find(
        (h) => h.guest_month || h.guest_dates || h.guest_count
      );

      if (last) {
        memoryContext = `
Dati utente:
- mese: ${last.guest_month || "non specificato"}
- date: ${last.guest_dates || "non specificate"}
- ospiti: ${last.guest_count || "non specificati"}
`;
      }
    }

    // ===== PROMPT =====
    const messages = [
      {
        role: "system",
        content: `
Sei un host Airbnb reale.

Appartamento in città.
Prezzi:
- base: 100–120€
- giugno/luglio: 110–130€

${memoryContext}

Regole:
- Risposte brevi
- Usa i dati utente se disponibili
- Non essere generico
- Non dire "dipende da tanti fattori"
- Se hai info → dai risposta diretta
`,
      },
    ];

    if (history) {
      for (const h of history) {
        messages.push({
          role: mapRole(h.role),
          content: h.message,
        });
      }
    }

    // ===== OPENAI =====
    const ai = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages,
    });

    const reply = ai.choices[0].message.content;

    console.log("🤖 AI:", reply);

    // ===== SALVA AI =====
    await supabase.from("conversations").insert([
      {
        phone: from,
        role: "assistant",
        message: reply,
      },
    ]);

    // ===== INVIO WHATSAPP =====
    await axios.post(
      `https://graph.facebook.com/v18.0/${process.env.PHONE_NUMBER_ID}/messages`,
      {
        messaging_product: "whatsapp",
        to: from,
        text: { body: reply },
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
          "Content-Type": "application/json",
        },
      }
    );

    console.log("📤 SENT");

    res.sendStatus(200);
  } catch (err) {
    console.log("❌ ERROR:", err.message);
    res.sendStatus(500);
  }
});

// ROOT
app.get("/", (req, res) => {
  res.send("OK");
});

app.listen(process.env.PORT || 3001, () => {
  console.log("🚀 Server running");
});