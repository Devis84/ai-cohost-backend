if (!message) {
  console.log("⚠️ Nessun messaggio");
  return res.sendStatus(200);
}

const from = message.from;
const text = message.text?.body;

console.log("👤 Da:", from);
console.log("💬 Testo:", text);

if (!text) return res.sendStatus(200);

// salva messaggio utente
await supabase.from("conversations").insert([
  {
    phone: from,
    role: "guest",
    message: text,
  },
]);

console.log("✅ Salvato messaggio utente");

// recupera storico
const { data: history } = await supabase
  .from("conversations")
  .select("*")
  .eq("phone", from)
  .order("created_at", { ascending: true })
  .limit(20);

const messages = [
  {
    role: "system",
    content:
      "Sei un assistente per un host Airbnb. Rispondi in modo naturale, umano e utile.",
  },
];

if (history) {
  history.forEach((msg) => {
    messages.push({
      role: mapRole(msg.role),
      content: msg.message,
    });
  });
}

console.log("🚀 CHIAMO OPENAI...");

const aiResponse = await openai.chat.completions.create({
  model: "gpt-4o-mini",
  messages: messages,
});

const reply = aiResponse.choices[0].message.content;

console.log("🤖 AI:", reply);

// salva risposta AI
await supabase.from("conversations").insert([
  {
    phone: from,
    role: "assistant",
    message: reply,
  },
]);

// invia WhatsApp
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

console.log("📤 RISPOSTA INVIATA");

res.sendStatus(200);