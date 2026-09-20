const { createClient } = require("@supabase/supabase-js");

const SUPABASE_URL = "https://ekqxrttxkntvcqyojfjq.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_AYrayKhIpdftrYfyxt9dhA_P3WNxlRZ";
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const VALID_CREATOR_CODE = "HARSHIL15";

// Authoritative prices — mirrors the front-end catalog, but this is the copy
// that's actually trusted. Client-submitted prices are ignored entirely.
const SERVICE_CATALOG = {
  growth: { label: "Growth Website Package", onetime: 12000, monthly: 2000, yearly: 0 },
  erestro: { label: "E-Restro", onetime: 4000, monthly: 0, yearly: 0 },
  portfolio: { label: "Student Portfolio Website", onetime: 0, monthly: 300, yearly: 0 },
  ecommerce: { label: "E-commerce / online store", onetime: 6000, monthly: 0, yearly: 0 },
  logo: { label: "Logo & brand identity", onetime: 1200, monthly: 0, yearly: 0 },
  booking: { label: "Booking / reservation system", onetime: 5000, monthly: 0, yearly: 0 },
  multilang: { label: "Multi-language support", onetime: 400, monthly: 0, yearly: 0 },
  seo: { label: "Advanced SEO & analytics", onetime: 1600, monthly: 0, yearly: 0 },
  social: { label: "Social media management", onetime: 0, monthly: 450, yearly: 0 },
  prestige: { label: "Prestige Membership", onetime: 0, monthly: 0, yearly: 2800 },
};

const MAX_LEN = { whatsapp: 20, message: 1000, referral: 30 };
const MAX_ITEMS = 20;

function clip(str, max) {
  return String(str || "").trim().slice(0, max);
}

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  if (!SERVICE_ROLE_KEY) return res.status(500).json({ error: "Server misconfigured" });

  // Require a real, verified session — no more anonymous submissions
  const token = (req.headers.authorization || "").replace("Bearer ", "");
  if (!token) return res.status(401).json({ error: "Please sign in to send a request." });

  const callerClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data: userData, error: userErr } = await callerClient.auth.getUser(token);
  if (userErr || !userData?.user) return res.status(401).json({ error: "Your session has expired — please sign in again." });

  const { data: profile } = await callerClient
    .from("profiles")
    .select("full_name, email")
    .eq("id", userData.user.id)
    .single();

  const body = req.body || {};
  const whatsapp = clip(body.whatsapp, MAX_LEN.whatsapp);
  const message = clip(body.message, MAX_LEN.message);
  const rawItems = Array.isArray(body.items) ? body.items.slice(0, MAX_ITEMS) : [];

  if (!whatsapp) return res.status(400).json({ error: "A WhatsApp number is required." });

  // Only accept known service IDs, and only ever price them from our own
  // catalog above — a tampered client-side price is simply ignored.
  const validItems = rawItems
    .map((it) => SERVICE_CATALOG[it?.svc] ? { svc: it.svc, ...SERVICE_CATALOG[it.svc] } : null)
    .filter(Boolean);

  if (validItems.length === 0) return res.status(400).json({ error: "No valid services in cart." });

  let oneTime = 0, monthly = 0, yearly = 0;
  for (const it of validItems) {
    oneTime += it.onetime;
    monthly += it.monthly;
    yearly += it.yearly;
  }

  const submittedCode = clip(body.referral_code, MAX_LEN.referral).toUpperCase();
  const referral_code = submittedCode === VALID_CREATOR_CODE ? VALID_CREATOR_CODE : null;
  if (referral_code) {
    oneTime = Math.round(oneTime * 0.85);
    monthly = Math.round(monthly * 0.85);
    yearly = Math.round(yearly * 0.85);
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  // Abuse guard: max 3 requests per account per hour
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { count } = await admin
    .from("service_requests")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userData.user.id)
    .gte("created_at", oneHourAgo);
  if ((count || 0) >= 3) {
    return res.status(429).json({ error: "Too many requests — please try again later." });
  }

  const plan_summary = validItems.map((i) => i.label).join(", ");
  const estimate_onetime = `₹${oneTime.toLocaleString("en-IN")}`;
  const estimate_monthly = `₹${monthly.toLocaleString("en-IN")}/mo` + (yearly ? ` + ₹${yearly.toLocaleString("en-IN")}/yr` : "");

  const { error } = await admin.from("service_requests").insert({
    user_id: userData.user.id,
    name: profile?.full_name || "",
    email: profile?.email || userData.user.email || "",
    whatsapp,
    message,
    plan_summary,
    estimate_onetime,
    estimate_monthly,
    prestige: validItems.some((i) => i.svc === "prestige"),
    referral_code,
  });
  if (error) {
    console.error("submit-request insert failed:", error.message);
    return res.status(500).json({ error: "Something went wrong — please try again." });
  }

  return res.status(200).json({ ok: true });
};
