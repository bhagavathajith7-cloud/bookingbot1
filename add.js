const { createClient } = require("@supabase/supabase-js");
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  const { rooms, guest_name, check_in, check_out, amount, notes } = req.body;
  if (!rooms || !guest_name || !check_in || !check_out)
    return res.status(400).json({ success: false, error: "Missing required fields" });

  const { data, error } = await supabase.from("bookings")
    .insert([{ rooms, guest_name, check_in, check_out, amount: amount||0, notes: notes||"" }])
    .select().single();

  if (error) return res.status(500).json({ success: false, error: error.message });
  return res.json({ success: true, booking: data });
};
