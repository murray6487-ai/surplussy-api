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

  // Respond to Twilio immediately so we don't timeout
  const twimlResponse = new Response("<?xml version='1.0' encoding='UTF-8'?><Response></Response>", {
    headers: { "Content-Type": "text/xml" },
  });

  // Do the heavy work after responding
  (async () => {
    try {
      // Download image with Twilio auth
      const mediaRes = await fetch(mediaUrl, {
        headers: {
          Authorization: "Basic " + btoa(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`),
        },
      });

      if (!mediaRes.ok) throw new Error(`Media fetch failed: ${mediaRes.status}`);

      const imageBuffer = await mediaRes.arrayBuffer();
      const contentType = mediaRes.headers.get("content-type") ?? "image/jpeg";

      // Fix: safe base64 conversion that works on large images
      const bytes = new Uint8Array(imageBuffer);
      let binary = "";
      const chunkSize = 8192;
      for (let i = 0; i < bytes.length; i += chunkSize) {
        binary += String.fromCharCode(...bytes.slice(i, i + chunkSize));
      }
      const base64Image = btoa(binary);

      // Call Claude
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
              { type: "text", text: `You are a marketplace listing expert. Analyze this surplus item photo and create a listing targeting contractor and commercial buyers in South Florida.\n\nReturn ONLY a valid JSON object, no markdown, no explanation:\n{"item_name":"","suggested_price":"$XX","condition":"New or Like New or Good or Fair","description":"3-4 sentences covering specs, brand if visible, quantity, and contractor value","category":"Electrical or Tools or Industrial or Fixtures or Other"}` }
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

      // Save to Supabase
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
      console.error("ClickList error:", err);
    }
  })();

  return twimlResponse;
};

export const config: Config = {
  path: "/api/listing",
};
