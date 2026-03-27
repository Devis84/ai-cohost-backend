const express = require("express");

const app = express();
const PORT = process.env.PORT || 3001;

// Test base
app.get("/", (req, res) => {
  console.log("🔥 SERVER FUNZIONA");
  res.send("OK");
});

app.listen(PORT, () => {
  console.log("🚀 Server running on port " + PORT);
});