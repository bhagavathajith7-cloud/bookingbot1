const { createClient } = require("@supabase/supabase-js");
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
 
module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (req.method !== "GET") return res.status(405).end();
  const { data: bookings, error } = await supabase.from("bookings").select("*").order("check_in", { ascending: true });
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ bookings });
};
 
