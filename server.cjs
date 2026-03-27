if (!message) return res.sendStatus(200);

const from = message.from;
const text = message.text?.body;

console.log("👤", from);
console.log("💬", text);

if (!text) return res.sendStatus(200);

// salva utente
await supabase.from("conversations").insert([
  { phone: from, role: "guest", message: text },
]);

// recupera storico
const { data: history } = await supabase
  .from("conversations")
  .select("*")
  .eq("phone", from)
  .order("created_at", { ascending: true })
  .limit(10);

const messages = [
  {
    role: "system",
    content:
      "Sei un assistente Airbnb. Risposte brevi, utili e concrete.",
  },
];

if (history) {
  for (const msg of history) {
    messages.push({
      role: mapRole(msg.role),
      content: msg.message,
    });
  }
}

console.log("🚀 OpenAI");

const ai = await openai.chat.completions.create({
  model: "gpt-4o-mini",
  messages,
});

const reply = ai.choices[0].message.content;

console.log("🤖", reply);

// salva risposta
await supabase.from("conversations").insert([
  { phone: from, role: "assistant", message: reply },
]);

// invia whatsapp
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