const express = require("express");
const bodyParser = require("body-parser");
const { createClient } = require("@supabase/supabase-js");
const OpenAI = require("openai");

const app = express();
app.use(bodyParser.json());

const VERIFY_TOKEN = "my_verify_token";
const ACCESS_TOKEN = process.env.META_TOKEN;

// 🔌 SUPABASE
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

// 🤖 OPENAI
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// 🧠 anti-duplicati
const processedMessages = new Set();

// =========================
// 🧠 RULES ENGINE (SCALABILE)
// =========================
const rules = [
  {
    keywords: ["wifi", "internet"],
    response:
      "📶 Network: ARRIS-6F59\n🔑 Password: Malta2025",
  },
  {
    keywords: ["check-in", "check in"],
    response:
      "🕒 Check-in is from 15:00 (3 PM). Let me know if you need flexibility.",
  },
  {
    keywords: ["check-out", "checkout", "check out"],
    response:
      "🕚 Check-out is before 11:00 AM.",
  },
  {
    keywords: ["parking", "parcheggio"],
    response:
      "🚗 Free street parking is available nearby. No private parking.",
  },
];

// 🔍 RULE MATCHER
function matchRule(text) {
  const lower = text.toLowerCase();

  for (let rule of rules) {
    for (let keyword of rule.keywords) {
      if (lower.includes(keyword)) {
        return rule.response;
      }
    }
  }
  return null;
}

// 🔐 VERIFY
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode && token === VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  } else {
    return res.sendStatus(403);
  }
});

// 📩 INCOMING
app.post("/webhook", async (req, res) => {
  try {
    const message = req.body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
    if (!message) return res.sendStatus(200);

    const messageId = message.id;

    if (processedMessages.has(messageId)) {
      return res.sendStatus(200);
    }
    processedMessages.add(messageId);

    const from = message.from;
    const text = message.text?.body;

    if (!text) return res.sendStatus(200);

    // 💾 salva user message
    await supabase.from("messages").insert([
      {
        phone: from,
        role: "user",
        message: text,
      },
    ]);

    // =========================
    // ⚡ RULE ENGINE FIRST
    // =========================
    const ruleResponse = matchRule(text);

    if (ruleResponse) {
      // 💾 salva risposta
      await supabase.from("messages").insert([
        {
          phone: from,
          role: "assistant",
          message: ruleResponse,
        },
      ]);

      // 📤 invia
      await fetch(`https://graph.facebook.com/v18.0/${process.env.PHONE_NUMBER_ID}/messages`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${ACCESS_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          to: from,
          text: { body: ruleResponse },
        }),
      });

      return res.sendStatus(200); // 🔥 STOP QUI (NO AI)
    }

    // =========================
    // 🤖 AI FALLBACK
    // =========================

    const { data: history } = await supabase
      .from("messages")
      .select("*")
      .eq("phone", from)
      .order("created_at", { ascending: false })
      .limit(10);

    const messages = history
      .reverse()
      .map((m) => ({
        role: m.role === "assistant" ? "assistant" : "user",
        content: m.message,
      }));

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content:
            "You are an Airbnb co-host. Be helpful, concise, and natural.",
        },
        ...messages,
      ],
    });

    const reply = completion.choices[0].message.content;

    // 💾 salva AI risposta
    await supabase.from("messages").insert([
      {
        phone: from,
        role: "assistant",
        message: reply,
      },
    ]);

    // 📤 invia
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