import type { Config } from "@netlify/functions";

export default async (req: Request) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const TWILIO_ACCOUNT_SID = Netlify.env.get("TWILIO_ACCOUNT_SID") ?? "";
  const TWILIO_AUTH_TOKEN  = Netlify.env.get("TWILIO_AUTH_TOKEN") ?? "";
  const ANTHROPIC_API_KEY  = Netlify.env.get("ANTHROPIC_API_KEY") ?? "";
  const SUPABASE_URL       = Netlify.env.get("SUPABASE_URL") ?? "";
  const SUPABASE_ANON_KEY  = Netlify.env.get("SUPABASE_ANON_KEY") ?? "";

  const body = await req.text();
  const params = new URLSearchParams(body);

  const numMedia = parseInt(params.get("NumMedia") ?? "0", 10);
  const mediaUrl = params.get("MediaUrl0") ?? "";

  if (numMedia === 0 || !mediaUrl) {
    return new Response("<?xml version='1.0' encoding='UTF-8'?><Response></Response>", {
      headers: { "Content-Type": "text/xml" },
    });
  }

  try {
    const mediaRes = await fetch(mediaUrl, {
      headers: {
        Authorization: "Basic " + btoa(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`),
      },
    });

    if (!mediaRes.ok) throw new Error(`Media fetch failed: ${mediaRes.status}`);

    const imageBuffer = await mediaRes.arrayBuffer();
    const base64Image = btoa(String.fromCharCode(...new Uint8Array(imageBuffer)));
    const contentType = mediaRes.headers.get("content-type") ?? "image/jpeg";

    const claudeRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 1024,
        messages: [{
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: contentType, data: base64Image } },
            { type: "text", text: `Analyze this surplus item photo and create a marketplace listing for contractor buyers in South Florida. Return ONLY valid JSON:\n{"item_name":"","suggested_price":"$XX","condition":"New or Like New or Good or Fair","description":"3-4 sentences about specs and contractor value","category":"Electrical or Tools or Industrial or Fixtures or Other"}` }
          ]
        }]
      }),
    });

    if (!claudeRes.ok) throw new Error(`Claude error: ${await claudeRes.text()}`);

    const claudeData = await claudeRes.json() as any;
    const rawText = claudeData.content[0].text as string;
    const clean = rawText.replace(/```json|```/g, "").trim();
    const listing = JSON.parse(clean);
    const price = parseFloat(listing.suggested_price.replace(/[^0-9.]/g, "")) || 0;

    await fetch(`${SUPABASE_URL}/rest/v1/listings`, {
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

    console.log(`Surplussy listing created: ${listing.item_name} @ ${listing.suggested_price}`);

  } catch (err) {
    console.error("Surplussy inbound error:", err);
  }

  return new Response("<?xml version='1.0' encoding='UTF-8'?><Response></Response>", {
    headers: { "Content-Type": "text/xml" },
  });
};

export const config: Config = {
  path: "/api/inbound",
};
