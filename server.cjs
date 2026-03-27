const from = msg.from;
const text = msg.text?.body;

if (!text) return res.sendStatus(200);

// SALVATAGGIO UTENTE
await supabase.from("conversations").insert([
  { phone: from, role: "guest", message: text },
]);

// STORICO
const { data: history } = await supabase
  .from("conversations")
  .select("*")
  .eq("phone", from)
  .order("created_at", { ascending: true })
  .limit(10);

const messages = [
  {
    role: "system",
    content: "Sei un assistente Airbnb, risposte brevi e utili.",
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

const ai = await openai.chat.completions.create({
  model: "gpt-4o-mini",
  messages,
});

const reply = ai.choices[0].message.content;

// SALVATAGGIO AI
await supabase.from("conversations").insert([
  { phone: from, role: "assistant", message: reply },
]);

// INVIO WHATSAPP
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

res.sendStatus(200);