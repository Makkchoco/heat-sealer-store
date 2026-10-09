// Runs on Cloudflare's server. Prices and delivery are calculated HERE, never trusted from the browser.
const BUNDLES = {1:7500, 2:15000, 3:21000, 4:27000, 5:33000};
const MORE_RATE = 6600, FREE_MIN_QTY = 2, SINGLE_FEE = 4000, SURCHARGE = 2000;
const Z_STATES = {
  sw:"Lagos,Ogun,Oyo,Osun,Ondo,Ekiti", se:"Abia,Anambra,Ebonyi,Enugu,Imo",
  ss:"Akwa Ibom,Bayelsa,Cross River,Delta,Edo,Rivers",
  nc:"Benue,Kogi,Kwara,Nasarawa,Niger,Plateau,FCT (Abuja)",
  ne:"Adamawa,Bauchi,Borno,Gombe,Taraba,Yobe", nw:"Jigawa,Kaduna,Kano,Katsina,Kebbi,Sokoto,Zamfara"
};
const EXTRA = {sw:0, se:0, ss:0, nc:SURCHARGE, ne:SURCHARGE, nw:SURCHARGE};
const ZONE = {}; Object.keys(Z_STATES).forEach(k => Z_STATES[k].split(",").forEach(s => ZONE[s] = k));
const SB = "https://kshtwnflgwwuyngjxzqn.supabase.co";

const json = (o, status = 200) => new Response(JSON.stringify(o), {status, headers: {"Content-Type": "application/json"}});
const clean = (v, n) => String(v || "").trim().slice(0, n);

export async function onRequestPost({request, env}) {
  let b; try { b = await request.json(); } catch { return json({error: "Bad request."}, 400); }
  const qty = parseInt(b.qty, 10), state = clean(b.state, 40), zone = ZONE[state];
  const name = clean(b.name, 80), phone = clean(b.phone, 20).replace(/[\s-]/g, ""), city = clean(b.city, 80), pickup = clean(b.pickup, 200);
  let email = clean(b.email, 120);
  if (!(qty >= 1 && qty <= 100)) return json({error: "Invalid quantity."}, 400);
  if (!zone) return json({error: "Invalid state."}, 400);
  if (!name || !city || !pickup) return json({error: "Please fill in all details."}, 400);
  if (!/^(\+?234|0)[789][01]\d{8}$/.test(phone)) return json({error: "Invalid phone number."}, 400);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) email = "";

  const subtotal = BUNDLES[qty] || qty * MORE_RATE;
  const fee = qty < FREE_MIN_QTY ? SINGLE_FEE : EXTRA[zone];
  const total = subtotal + fee;
  const sbHeaders = {apikey: env.SUPABASE_SECRET_KEY, "Content-Type": "application/json"};

  // stock check
  const st = await (await fetch(`${SB}/rest/v1/stock?id=eq.1&select=quantity`, {headers: sbHeaders})).json();
  if (!Array.isArray(st) || !st[0]) return json({error: "Store is not ready yet."}, 500);
  if (st[0].quantity < qty) return json({error: "Sorry, we do not have enough stock for that quantity."}, 409);

  const reference = "SS" + Date.now().toString(36).toUpperCase() + Math.random().toString(36).slice(2, 6).toUpperCase();
  const ins = await fetch(`${SB}/rest/v1/orders`, {method: "POST", headers: {...sbHeaders, Prefer: "return=minimal"},
    body: JSON.stringify({reference, name, phone, email, state, city, pickup, qty, subtotal, delivery_fee: fee, total})});
  if (!ins.ok) return json({error: "Could not save your order."}, 500);

  const origin = new URL(request.url).origin;
  const ps = await (await fetch("https://api.paystack.co/transaction/initialize", {
    method: "POST",
    headers: {Authorization: "Bearer " + env.PAYSTACK_SECRET_KEY, "Content-Type": "application/json"},
    body: JSON.stringify({email: email || "makkychoco+" + reference.toLowerCase() + "@gmail.com", amount: total * 100,
      currency: "NGN", reference, callback_url: origin + "/", metadata: {name, phone, qty}})
  })).json();
  if (!ps.status) return json({error: "Could not start payment."}, 502);
  return json({authorization_url: ps.data.authorization_url, reference});
}
