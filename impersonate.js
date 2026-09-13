const { createClient } = require("@supabase/supabase-js");

const SUPABASE_URL = "https://ekqxrttxkntvcqyojfjq.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_AYrayKhIpdftrYfyxt9dhA_P3WNxlRZ";
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SITE_URL = "https://covara-website.vercel.app";

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  if (!SERVICE_ROLE_KEY) {
    return res.status(500).json({ error: "Server missing SUPABASE_SERVICE_ROLE_KEY env var" });
  }

  const token = (req.headers.authorization || "").replace("Bearer ", "");
  if (!token) return res.status(401).json({ error: "Missing session token" });

  const { targetEmail } = req.body || {};
  if (!targetEmail) return res.status(400).json({ error: "targetEmail is required" });

  // Verify the caller is a signed-in admin, using THEIR token (RLS-scoped, no elevated access here)
  const callerClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data: userData, error: userErr } = await callerClient.auth.getUser(token);
  if (userErr || !userData?.user) return res.status(401).json({ error: "Invalid or expired session" });

  const { data: profile } = await callerClient
    .from("profiles")
    .select("is_admin")
    .eq("id", userData.user.id)
    .single();
  if (!profile?.is_admin) return res.status(403).json({ error: "Admin access required" });

  // Only now use the service role key, to generate a one-time login link
  const adminClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const { data: linkData, error: linkErr } = await adminClient.auth.admin.generateLink({
    type: "magiclink",
    email: targetEmail,
    options: { redirectTo: `${SITE_URL}/dashboard.html` },
  });
  if (linkErr) return res.status(400).json({ error: linkErr.message });

  return res.status(200).json({ link: linkData.properties.action_link });
};
