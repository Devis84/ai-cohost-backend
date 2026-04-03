const express = require("express");
const bodyParser = require("body-parser");
const axios = require("axios");
const { createClient } = require("@supabase/supabase-js");

const app = express();
app.use(bodyParser.json());
app.use(express.static("public"));

const {
  SUPABASE_URL,
  SUPABASE_KEY,
  WHATSAPP_TOKEN,
  PHONE_NUMBER_ID,
  HOST_PHONE
} = process.env;

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// ======================
// SEND WHATSAPP
// ======================
async function send(to, text) {
  await axios.post(
    `https://graph.facebook.com/v18.0/${PHONE_NUMBER_ID}/messages`,
    {
      messaging_product: "whatsapp",
      to,
      text: { body: text }
    },
    {
      headers: {
        Authorization: `Bearer ${WHATSAPP_TOKEN}`,
        "Content-Type": "application/json"
      }
    }
  );
}

// ======================
// SAVE MESSAGE
// ======================
async function saveMessage(phone, role, message, property_id) {
  await supabase.from("messages").insert({
    phone,
    role,
    message,
    property_id
  });
}

// ======================
// BOOKINGS + CLEANING
// ======================
async function createBooking(propertyId, phone, checkin, checkout) {
  const { data } = await supabase
    .from("bookings")
    .insert({
      property_id: propertyId,
      guest_phone: phone,
      checkin,
      checkout
    })
    .select()
    .single();

  await supabase.from("cleaning_tasks").insert({
    property_id: propertyId,
    booking_id: data.id,
    cleaning_date: checkout,
    status: "pending"
  });

  console.log("🧼 Cleaning scheduled:", checkout);
}

// ======================
// WEBHOOK
// ======================
app.post("/webhook", async (req, res) => {
  try {
    const msg = req.body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
    if (!msg) return res.sendStatus(200);

    const from = msg.from;
    const text = msg.text?.body;

    const property_id = "default-property";

    await saveMessage(from, "guest", text, property_id);

    // risposta base
    let reply = "🙂 I can help you with WiFi, check-in and info.";

    if (text.toLowerCase().includes("wifi")) {
      reply = "📶 WiFi: ARRIS-6F59 | Password: Malta2025";
    }

    await saveMessage(from, "assistant", reply, property_id);
    await send(from, reply);

    res.sendStatus(200);
  } catch (err) {
    console.error(err);
    res.sendStatus(500);
  }
});

// ======================
// CREATE BOOKING API
// ======================
app.post("/create-booking", async (req, res) => {
  const { phone, checkin, checkout } = req.body;

  await createBooking("default-property", phone, checkin, checkout);

  res.json({ success: true });
});

// ======================
// GET CONVERSATIONS
// ======================
app.get("/conversations", async (req, res) => {
  const { data } = await supabase
    .from("messages")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(100);

  res.json(data || []);
});

// ======================
// GET CLEANING TASKS
// ======================
app.get("/cleaning-tasks", async (req, res) => {
  const { data } = await supabase
    .from("cleaning_tasks")
    .select("*")
    .order("cleaning_date", { ascending: true });

  res.json(data || []);
});

// ======================
app.listen(process.env.PORT || 3000, () => {
  console.log("🚀 Server running");
});