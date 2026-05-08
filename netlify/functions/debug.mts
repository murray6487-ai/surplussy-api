import type { Config } from "@netlify/functions";

export default async (req: Request) => {
  const ok = new Response("<?xml version='1.0' encoding='UTF-8'?><Response></Response>", {
    headers: { "Content-Type": "text/xml" },
  });

  const TWILIO_ACCOUNT_SID = Netlify.env.get("TWILIO_ACCOUNT_SID") ?? "";
  const TWILIO_AUTH_TOKEN  = Netlify.env.get("TWILIO_AUTH_TOKEN") ?? "";
  const ANTHROPIC_API_KEY  = Netlify.env.get("ANTHROPIC_API_KEY") ?? "";
  const SUPABASE_URL       = Netlify.env.get("SUPABASE_URL") ?? "";
  const SUPABASE_ANON_KEY  = Netlify.env.get("SUPABASE_ANON_KEY") ?? "";

  const log = async (step: string, status: string, detail: string = "") => {
    try {
      await fetch(`${SUPABASE_URL}/rest/v1/debug_log`, {
        method: "POST",
        headers: {
          apikey: SUPABASE_ANON_KEY,
          Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
          "Content-Type": "application/json",
          Prefer: "return=minimal",
        },
        body: JSON.stringify({ step, status, detail: detail.slice(0, 1000) }),
      });
    } catch {}
  };

  if (req.method !== "POST") return ok;

  await log("start", "ok", `method=${req.method}`);

  try {
    const body = await req.text();
    const params = new URLSearchParams(body);
    const numMedia = parseInt(params.get("NumMedia") ?? "0", 10);
    const mediaUrl = params.get("MediaUrl0") ?? "";
    await log("parsed", "ok", `numMedia=${numMedia} mediaUrl=${mediaUrl.slice(0,80)}`);

    if (numMedia === 0 || !mediaUrl) {
      await log("skip", "no_media", "");
      return ok;
    }

    // env check
    await log("env", "check", `sid=${TWILIO_ACCOUNT_SID.slice(0,10)} ant=${ANTHROPIC_API_KEY.slice(0,15)} sb=${SUPABASE_URL.slice(0,40)}`);

    // 1. Download
    const mediaRes = await fetch(mediaUrl, {
      headers: { Authorization: "Basic " + btoa(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`) },
    });
    await log("media_fetch", String(mediaRes.status), `ct=${mediaRes.headers.get("content-type")}`);
    if (!mediaRes.ok) return ok;

    const imageBuffer = await mediaRes.arrayBuffer();
    const contentType = mediaRes.headers.get("content-type") ?? "image/jpeg";
    await log("media_buffer", "ok", `bytes=${imageBuffer.byteLength}`);

    // 2. Encode
    const bytes = new Uint8Array(imageBuffer);
    let binary = "";
    for (let i = 0; i < bytes.length; i += 8192) {
      binary += String.fromCharCode(...bytes.slice(i, i + 8192));
    }
    const base64Image = btoa(binary);
    await log("encoded", "ok", `len=${base64Image.length}`);

    // 3. Claude
    const claudeRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-5",
        max_tokens: 512,
        messages: [{
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: contentType, data: base64Image } },
            { type: "text", text: `Analyze this surplus item and return ONLY valid JSON:\n{"item_name":"","suggested_price":"$XX","condition":"New or Good","description":"3 sentences","category":"Electrical or Tools or Industrial or Fixtures or Other"}` }
          ]
        }]
      }),
    });
    const claudeText = await claudeRes.text();
    await log("claude", String(claudeRes.status), claudeText.slice(0, 800));
    if (!claudeRes.ok) return ok;

    const claudeData = JSON.parse(claudeText);
    const rawText = (claudeData.content[0].text as string).replace(/```json|```/g, "").trim();
    await log("claude_parsed", "ok", rawText.slice(0, 500));

    const listing = JSON.parse(rawText);
    const price = parseFloat(String(listing.suggested_price).replace(/[^0-9.]/g, "")) || 0;

    // 4. Insert
    const insertBody = {
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
    };
    const dbRes = await fetch(`${SUPABASE_URL}/rest/v1/listings`, {
      method: "POST",
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify(insertBody),
    });
    const dbText = await dbRes.text();
    await log("supabase", String(dbRes.status), dbText.slice(0, 500));

  } catch (err) {
    await log("caught", "error", String(err).slice(0, 500));
  }

  return ok;
};

export const config: Config = { path: "/api/debug" };
