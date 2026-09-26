const DOMAIN_RE = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/i;

module.exports = async (req, res) => {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const domain = String(req.query.domain || "").trim().toLowerCase();
  if (!domain || domain.length > 253 || !DOMAIN_RE.test(domain)) {
    return res.status(400).json({ error: "Enter a valid domain, e.g. yoursite.in" });
  }

  try {
    // Stage 1: RDAP — the modern WHOIS successor. 200 = registered, 404 = unclaimed
    // (for TLDs RDAP actually covers).
    const rdapRes = await fetch(`https://rdap.org/domain/${domain}`, {
      headers: { Accept: "application/json" },
    });

    if (rdapRes.status === 200) {
      return res.status(200).json({ domain, available: false });
    }

    if (rdapRes.status === 404) {
      // Stage 2: some TLDs (.io, .co, .so, .gg...) aren't in RDAP's bootstrap and
      // 404 for every name regardless of real status. Cross-check with a DNS
      // lookup — if nameservers exist, it's registered even though RDAP missed it.
      const dnsRes = await fetch(
        `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(domain)}&type=NS`,
        { headers: { Accept: "application/dns-json" } }
      );
      const dnsData = await dnsRes.json();
      const hasNameservers = Array.isArray(dnsData.Answer) && dnsData.Answer.length > 0;
      return res.status(200).json({ domain, available: !hasNameservers });
    }

    return res.status(200).json({ domain, available: null, note: "Couldn't confirm — try checking with a registrar directly." });
  } catch (err) {
    console.error("check-domain failed:", err.message);
    return res.status(502).json({ error: "Domain lookup failed — please try again." });
  }
};
