const express = require("express");
const cors = require("cors");
const { createClient } = require("@supabase/supabase-js");

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static("public"));

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

// ===============================
// GET CONVERSATIONS
// ===============================
app.get("/conversations", async (req, res) => {
  const { data } = await supabase
    .from("messages")
    .select("*")
    .order("created_at", { ascending: true });

  res.json(data);
});

// ===============================
// GET CLEANING TASKS
// ===============================
app.get("/cleaning-tasks", async (req, res) => {
  const { data } = await supabase
    .from("cleaning_tasks")
    .select("*, cleaners(name, phone)")
    .order("date", { ascending: true });

  res.json(data);
});

// ===============================
// GET CLEANERS
// ===============================
app.get("/cleaners", async (req, res) => {
  const { data } = await supabase.from("cleaners").select("*");
  res.json(data);
});

// ===============================
// CREATE BOOKING → CREA TASK + NOTIFICA
// ===============================
app.post("/create-booking", async (req, res) => {
  const { phone, checkin, checkout } = req.body;

  try {
    const { data: booking } = await supabase
      .from("bookings")
      .insert([{ phone, checkin, checkout }])
      .select()
      .single();

    // crea cleaning task (check-out)
    await supabase.from("cleaning_tasks").insert([
      {
        booking_id: booking.id,
        date: checkout,
        status: "pending",
      },
    ]);

    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).send("error");
  }
});

// ===============================
// ASSEGNA CLEANER
// ===============================
app.post("/assign-cleaner", async (req, res) => {
  const { taskId, cleanerId } = req.body;

  await supabase
    .from("cleaning_tasks")
    .update({
      cleaner_id: cleanerId,
      status: "assigned",
    })
    .eq("id", taskId);

  res.sendStatus(200);
});

// ===============================
// COMPLETA TASK
// ===============================
app.post("/complete-task", async (req, res) => {
  const { taskId } = req.body;

  await supabase
    .from("cleaning_tasks")
    .update({ status: "completed" })
    .eq("id", taskId);

  res.sendStatus(200);
});

// ===============================
app.listen(process.env.PORT || 3000, () => {
  console.log("🚀 Server running");
});