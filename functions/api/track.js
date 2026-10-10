// Lets a customer check ONE order using its secret code. Returns no personal details.
const SB = "https://kshtwnflgwwuyngjxzqn.supabase.co";
const json = o => new Response(JSON.stringify(o), {headers: {"Content-Type": "application/json"}});

export async function onRequestGet({request, env}) {
  const ref = (new URL(request.url).searchParams.get("ref") || "").trim().toUpperCase();
  if (!/^[A-Z0-9]{6,30}$/.test(ref)) return json({found: false});
  const r = await fetch(`${SB}/rest/v1/orders?reference=eq.${ref}&select=payment_status,fulfilment_status,qty,total,created_at`, {headers: {apikey: env.SUPABASE_SECRET_KEY}});
  const a = r.ok ? await r.json() : [];
  if (!a[0]) return json({found: false});
  return json({found: true, payment: a[0].payment_status, fulfilment: a[0].fulfilment_status, qty: a[0].qty, total: a[0].total, date: a[0].created_at});
}
