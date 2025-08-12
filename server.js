import express from "express";
import axios from "axios";

const app = express();
app.use(express.json());

app.get("/", (req, res) => {
  res.send("Slepsk-Prod API is running 🚤");
});

// Example endpoint for cloning (placeholder)
app.post("/clone-epic", async (req, res) => {
  try {
    // Jira API logic will go here later
    res.json({ status: "success", message: "Epic cloned (placeholder)" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ status: "error", message: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
