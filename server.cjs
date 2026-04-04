const fetch = (...args) =>
  import("node-fetch").then(({ default: fetch }) => fetch(...args));

const express = require("express");
const bodyParser = require("body-parser");
const ical = require("node-ical");

const app = express();
app.use(bodyParser.json());

// ===== CONFIG =====
const ICAL_URL = process.env.ICAL_URL;

const SUPABASE_URL = "https://mhmebkakdmwzqgteywyd.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1obWVibGFrZG13enFndGV5d3lkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3MzMxMDg3ODQsImV4cCI6MjA0ODY4NDc4NH0.85TrSsRELJ5-30BUzf0LLymuYr-4arpOzEY";

const PROPERTY = {
  id: "maltese_maisonette",
  name: "Maltese Maisonette",
};

// ===== SUPABASE FETCH =====
async function supabaseFetch(path, options = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...options,
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
}

// ===== BOOKING EXISTS =====
async function bookingExists(checkin, checkout) {
  const res = await supabaseFetch(
    `bookings?property_id=eq.${PROPERTY.id}&checkin=eq.${checkin}&checkout=eq.${checkout}`
  );
  const data = await res.json();
  return data.length > 0;
}

// ===== CREATE BOOKING =====
async function createBooking(checkin, checkout) {
  const exists = await bookingExists(checkin, checkout);
  if (exists) return;

  const res = await supabaseFetch("bookings", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({
      guest_phone: "ical",
      property_id: PROPERTY.id,
      checkin,
      checkout,
    }),
  });

  const data = await res.json();
  console.log("📅 Booking created:", data);
}

// ===== CLEANING EXISTS =====
async function cleaningExists(booking_id) {
  const res = await supabaseFetch(
    `cleaning_tasks?booking_id=eq.${booking_id}`
  );
  const data = await res.json();
  return data.length > 0;
}

// ===== CREATE CLEANING =====
async function createCleaningTask(booking) {
  const exists = await cleaningExists(booking.id);
  if (exists) return;

  const res = await supabaseFetch("cleaning_tasks", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({
      property_id: booking.property_id,
      booking_id: booking.id,
      cleaning_date: booking.checkout,
      status: "pending",
    }),
  });

  const data = await res.json();
  console.log("🧹 Cleaning created:", data);
}

// ===== ICAL SYNC =====
async function runIcalSync() {
  const data = await ical.async.fromURL(ICAL_URL);

  for (const k in data) {
    const event = data[k];

    if (event.type === "VEVENT") {
      const checkin = event.start.toISOString().split("T")[0];
      const checkout = event.end.toISOString().split("T")[0];

      await createBooking(checkin, checkout);
    }
  }
}

// ===== CLEANING SYNC =====
async function runCleaningSync() {
  const res = await supabaseFetch(
    `bookings?property_id=eq.${PROPERTY.id}`
  );

  const bookings = await res.json();

  for (const booking of bookings) {
    await createCleaningTask(booking);
  }
}

// ===== FULL SYNC =====
async function runFullSync() {
  await runIcalSync();
  await runCleaningSync();
}

// ===== SYNC ENDPOINT =====
app.get("/sync", async (req, res) => {
  await runFullSync();
  res.send("✅ Sync completed");
});

// ===== CALCULATE =====
function calculateTotal(start, end, rate) {
  if (!start || !end || !rate) return null;

  const [sh, sm] = start.split(":").map(Number);
  const [eh, em] = end.split(":").map(Number);

  const hours = eh + em / 60 - (sh + sm / 60);
  return Math.round(hours * rate * 100) / 100;
}

// ===== UPDATE CLEANING =====
app.post("/cleaning/update", async (req, res) => {
  const { id, cleaner, start_time, end_time, hourly_rate, notes, status } =
    req.body;

  const total_amount = calculateTotal(
    start_time,
    end_time,
    hourly_rate
  );

  await supabaseFetch(`cleaning_tasks?id=eq.${id}`, {
    method: "PATCH",
    body: JSON.stringify({
      cleaner,
      start_time,
      end_time,
      hourly_rate,
      total_amount,
      notes,
      status,
    }),
  });

  res.send("✅ Cleaning updated");
});

// ===== START =====
app.listen(10000, () => {
  console.log("🚀 SYSTEM READY");
});