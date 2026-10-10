// Checks payments with Paystack's server. An order is only marked paid after Paystack confirms it.
const SB = "https://kshtwnflgwwuyngjxzqn.supabase.co";
const json = (o, status = 200) => new Response(JSON.stringify(o), {status, headers: {"Content-Type": "application/json"}});

async function hmac(secret, body) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), {name: "HMAC", hash: "SHA-512"}, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(body));
  return [...new Uint8Array(sig)].map(x => x.toString(16).padStart(2, "0")).join("");
}

// Sends a "new paid order" alert. Each channel only runs if its settings exist in Cloudflare.
async function notify(env, o, stock) {
  const money = "₦" + Number(o.total).toLocaleString("en-NG");
  let text = `New PAID order ${o.reference}\n${o.qty} × sealer · ${money}\n${o.name} · ${o.phone}\n${o.address || ""}, ${o.city}, ${o.state}\n` +
    (/home delivery/i.test(o.pickup || "") ? "Home delivery" : "Pickup: " + o.pickup);
  if (stock && stock.quantity <= stock.low_threshold) text += `\n\nLOW STOCK: only ${stock.quantity} left.`;
  const jobs = [];
  if (env.RESEND_API_KEY && env.ALERT_EMAIL)
    jobs.push(fetch("https://api.resend.com/emails", {method: "POST",
      headers: {Authorization: "Bearer " + env.RESEND_API_KEY, "Content-Type": "application/json"},
      body: JSON.stringify({from: "SnapSeal Orders <onboarding@resend.dev>", to: [env.ALERT_EMAIL], subject: `New paid order ${o.reference} - ${money}`, text})}));
  if (env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID)
    jobs.push(fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {method: "POST",
      headers: {"Content-Type": "application/json"}, body: JSON.stringify({chat_id: env.TELEGRAM_CHAT_ID, text})}));
  await Promise.allSettled(jobs);
}

async function confirm(ref, env) {
  const h = {apikey: env.SUPABASE_SECRET_KEY, "Content-Type": "application/json"};
  const r = await fetch("https://api.paystack.co/transaction/verify/" + encodeURIComponent(ref), {headers: {Authorization: "Bearer " + env.PAYSTACK_SECRET_KEY}});
  const d = await r.json();
  if (!d.status) return {state: "error"};
  const t = d.data;
  if (t.status === "success") {
    if (t.currency !== "NGN") return {state: "error"};
    const res = await (await fetch(`${SB}/rest/v1/rpc/mark_paid`, {method: "POST", headers: h, body: JSON.stringify({p_ref: ref, p_amount: Math.round(t.amount / 100)})})).json();
    if (res !== "paid" && res !== "already_paid") return {state: "error"};
    const o = await (await fetch(`${SB}/rest/v1/orders?reference=eq.${encodeURIComponent(ref)}&select=*`, {headers: h})).json();
    if (res === "paid" && o[0]) {   // "paid" appears only the first time, so the alert is sent once
      try {
        const sk = await (await fetch(`${SB}/rest/v1/stock?id=eq.1&select=quantity,low_threshold`, {headers: h})).json();
        await notify(env, o[0], sk[0]);
      } catch (e) {}
    }
    return {state: "paid", reference: ref, total: o[0] && o[0].total};
  }
  if (t.status === "failed") {
    await fetch(`${SB}/rest/v1/orders?reference=eq.${encodeURIComponent(ref)}&payment_status=eq.pending`, {method: "PATCH", headers: h, body: JSON.stringify({payment_status: "failed"})});
    return {state: "failed"};
  }
  return {state: "pending"};
}

// Customer returns from Paystack: the page asks us to check.
export async function onRequestGet({request, env}) {
  const ref = new URL(request.url).searchParams.get("ref");
  if (!ref) return json({state: "error"}, 400);
  return json(await confirm(ref, env));
}

// Paystack tells us directly (webhook). Signature must match or we ignore it.
export async function onRequestPost({request, env}) {
  const raw = await request.text();
  if (request.headers.get("x-paystack-signature") !== await hmac(env.PAYSTACK_SECRET_KEY, raw)) return new Response("Invalid", {status: 401});
  const ev = JSON.parse(raw);
  if (ev.event === "charge.success" && ev.data && ev.data.reference) await confirm(ev.data.reference, env);
  return new Response("ok");
}
