const { createClient } = require("@supabase/supabase-js");

const SUPABASE_URL = "https://ekqxrttxkntvcqyojfjq.supabase.co";
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const VALID_CREATOR_CODE = "HARSHIL15";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_LEN = { name: 100, whatsapp: 20, email: 150, message: 1000, plan_summary: 500, estimate: 60, referral: 30 };

function clip(str, max) {
  return String(str || "").trim().slice(0, max);
}

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  if (!SERVICE_ROLE_KEY) return res.status(500).json({ error: "Server misconfigured" });

  const body = req.body || {};
  const name = clip(body.name, MAX_LEN.name);
  const whatsapp = clip(body.whatsapp, MAX_LEN.whatsapp);
  const email = clip(body.email, MAX_LEN.email);
  const message = clip(body.message, MAX_LEN.message);
  const plan_summary = clip(body.plan_summary, MAX_LEN.plan_summary);
  const estimate_onetime = clip(body.estimate_onetime, MAX_LEN.estimate);
  const estimate_monthly = clip(body.estimate_monthly, MAX_LEN.estimate);
  const prestige = !!body.prestige;

  // Never trust the client's claim of a valid referral code — re-check server-side.
  // A wrong/missing code is simply dropped (stored as null), never surfaced as an error here.
  const submittedCode = clip(body.referral_code, MAX_LEN.referral).toUpperCase();
  const referral_code = submittedCode === VALID_CREATOR_CODE ? VALID_CREATOR_CODE : null;

  if (!name || !whatsapp || !email) {
    return res.status(400).json({ error: "Name, WhatsApp number, and email are required." });
  }
  if (!EMAIL_RE.test(email)) {
    return res.status(400).json({ error: "Please enter a valid email address." });
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  // Basic abuse guard: block if this email already sent 3+ requests in the last hour
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { count } = await admin
    .from("service_requests")
    .select("id", { count: "exact", head: true })
    .eq("email", email)
    .gte("created_at", oneHourAgo);
  if ((count || 0) >= 3) {
    return res.status(429).json({ error: "Too many requests — please try again later." });
  }

  const { error } = await admin.from("service_requests").insert({
    name, whatsapp, email, message, plan_summary, estimate_onetime, estimate_monthly, prestige, referral_code,
  });
  if (error) {
    console.error("submit-request insert failed:", error.message);
    return res.status(500).json({ error: "Something went wrong — please try again." });
  }

  return res.status(200).json({ ok: true });
};

