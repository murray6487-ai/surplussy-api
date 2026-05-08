import type { Config } from "@netlify/functions";

export default async (req: Request) => {
  // Always return 200 to Twilio at the end
  const ok = new Response("<?xml version='1.0' encoding='UTF-8'?><Response></Response>", {
    headers: { "Content-Type": "text/xml" },
  });

  if (req.method !== "POST") return ok;

  const TWILIO_ACCOUNT_SID = Netlify.env.get("TWILIO_ACCOUNT_SID") ?? "";
  const TWILIO_AUTH_TOKEN  = Netlify.env.get("TWILIO_AUTH_TOKEN") ?? "";
  const ANTHROPIC_API_KEY  = Netlify.env.get("ANTHROPIC_API_KEY") ?? "";
  const SUPABASE_URL       = Netlify.env.get("SUPABASE_URL") ?? "";
  const SUPABASE_ANON_KEY  = Netlify.env.get("SUPABASE_ANON_KEY") ?? "";

  const body = await req.text();
  const params = new URLSearchParams(body);
  const numMedia = parseInt(params.get("NumMedia") ?? "0", 10);
  const mediaUrl = params.get("MediaUrl0") ?? "";

  if (numMedia === 0 || !mediaUrl) return ok;

  try {
    // 1. Download image from Twilio with auth
    const mediaRes = await fetch(mediaUrl, {
      headers: { Authorization: "Basic " + btoa(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`) },
    });
    if (!mediaRes.ok) throw new Error(`Media fetch failed: ${mediaRes.status}`);

    const imageBuffer = await mediaRes.arrayBuffer();
    const contentType = mediaRes.headers.get("content-type") ?? "image/jpeg";

    // 2. Safe base64 encode (chunk to avoid call stack overflow on large images)
    const bytes = new Uint8Array(imageBuffer);
    let binary = "";
    for (let i = 0; i < bytes.length; i += 8192) {
      binary += String.fromCharCode(...bytes.slice(i, i + 8192));
    }
    const base64Image = btoa(binary);

    // 3. Call Claude
    const claudeRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 512,
        messages: [{
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: contentType, data: base64Image } },
            { type: "text", text: `Analyze this surplus item and create a marketplace listing for contractor buyers in South Florida. Return ONLY valid JSON:\n{"item_name":"","suggested_price":"$XX","condition":"New or Like New or Good or Fair","description":"3-4 sentences on specs and contractor value","category":"Electrical or Tools or Industrial or Fixtures or Other"}` }
          ]
        }]
      }),
    });
    if (!claudeRes.ok) throw new Error(`Claude error: ${await claudeRes.text()}`);

    const claudeData = await claudeRes.json() as any;
    const rawText = (claudeData.content[0].text as string).replace(/```json|```/g, "").trim();
    const listing = JSON.parse(rawText);
    const price = parseFloat(listing.suggested_price.replace(/[^0-9.]/g, "")) || 0;

    // 4. Write to Supabase
    const dbRes = await fetch(`${SUPABASE_URL}/rest/v1/listings`, {
      method: "POST",
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify({
        title: listing.item_name,
        description: listing.description,
        price,
        category: listing.category,
        condition: listing.condition,
        images: mediaUrl,
        status: "available",
        location: "Boca Raton, FL",
        seller_name: "Connected Contracting Corporation",
        seller_phone: "561-225-5051",
        phone: "561-225-5051",
      }),
    });
    if (!dbRes.ok) throw new Error(`Supabase error ${dbRes.status}: ${await dbRes.text()}`);

    console.log(`LISTED: ${listing.item_name} @ ${listing.suggested_price}`);

  } catch (err) {
    console.error("ClickList v4 error:", err);
  }

  return ok;
};

export const config: Config = { path: "/api/v4" };
