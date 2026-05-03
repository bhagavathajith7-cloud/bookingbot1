const { createClient } = require("@supabase/supabase-js");
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  const { id } = req.body;
  if (!id) return res.status(400).json({ success: false, error: "Missing id" });

  const { error } = await supabase.from("bookings").delete().eq("id", id);
  if (error) return res.status(500).json({ success: false, error: error.message });
  return res.json({ success: true });
};
