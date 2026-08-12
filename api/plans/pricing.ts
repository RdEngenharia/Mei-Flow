// ============================================================================
// PREÇO DO PREMIUM — R$ 49,90 por mês
// ============================================================================
//
// ⚠️ ESTE VALOR ESTÁ REPETIDO EM SEIS ARQUIVOS, E JÁ ESTEVE ERRADO EM TRÊS.
//
// Antes desta correção: a tela e a cobrança diziam R$ 14,90, o registro
// pós-pagamento dizia R$ 14,00, e a nota fiscal da assinatura saía com
// R$ 29,90 — um valor que ninguém pagou. Ao mexer no preço, MEXA NOS SEIS:
//
//   api/plans/pricing.ts        → o que a tela mostra
//   api/checkout.ts             → o que é cobrado (Vercel)
//   api/mercadopago/checkout.ts → o que é cobrado (Vercel, caminho antigo)
//   api/mercadopago/webhook.ts  → o que é registrado depois de aprovado
//   server.ts                   → tudo isso, quando roda na sua máquina
//   src/components/UpgradeModal.tsx → o número que pisca antes da resposta chegar
//
// ----------------------------------------------------------------------------
// O PLANO ANUAL SAIU DE CARTAZ
//
// O valor continua definido aqui de propósito: quem já assinou no anual tem
// `billingCycle: "annual"` gravado, e a renovação lê esse campo. Apagar o
// número quebraria esses cadastros. O que mudou é que ele não é mais OFERECIDO
// — a tela não mostra o seletor, e o checkout recusa pedido novo de anual.
const PREMIUM_ANUAL_DISPONIVEL = false;

const PREMIUM_PRICING = {
  monthly: 49.9,
  annual: 49.9 * 12, // 598,80 — só para assinaturas anuais antigas
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
    annualMonthlyEquivalent: Number((PREMIUM_PRICING.annual / 12).toFixed(2)),
    // A tela lê isto para decidir se mostra o seletor Mensal/Anual. Vindo do
    // servidor, o dia em que o anual voltar não exige publicar o app de novo.
    annualDisponivel: PREMIUM_ANUAL_DISPONIVEL
  });
}