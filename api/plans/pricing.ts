// Fonte única de verdade para os valores cobrados (mesma referência usada em
// /api/checkout.ts, /api/mercadopago/checkout.ts e /api/mercadopago/webhook.ts).
const PREMIUM_PRICING = {
  monthly: 14.0,
  annual: 14.0 * 12, // 168.00 — cobrança única equivalente a 12 meses
};

export default function handler(req: any, res: any) {
  // CORS: necessário para o app empacotado como APK (Capacitor), que chama
  // a API a partir da origem fixa "https://localhost".
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  if (req.method !== "GET") {
    return res.status(405).json({ success: false, error: "Method not allowed. Use GET." });
  }

  res.status(200).json({
    success: true,
    currency: "BRL",
    monthly: PREMIUM_PRICING.monthly,
    annual: PREMIUM_PRICING.annual,
    annualMonthlyEquivalent: Number((PREMIUM_PRICING.annual / 12).toFixed(2))
  });
}