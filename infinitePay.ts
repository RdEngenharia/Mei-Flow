/**
 * ============================================================================
 * MEI FLOW — LINK DE PAGAMENTO PELA INFINITEPAY
 * ============================================================================
 *
 * POR QUE ESTE ARQUIVO EXISTE
 *
 * A Asaas não tem maquininha física — alguns clientes preferem pagar na
 * maquineta em vez de digitar o cartão num link. A InfinitePay resolve isso:
 * gera um link de cobrança e paga em até 1 dia útil, sem a taxa de
 * antecipação separada que a Asaas cobra. Em troca, só parcela até 12x — a
 * Asaas vai até 21x. Por isso os dois convivem como opções DIFERENTES: a
 * InfinitePay é MAIS UM jeito de cobrar no cartão, não substitui a Asaas.
 *
 * ----------------------------------------------------------------------------
 * AUTENTICAÇÃO — SÓ O HANDLE, SEM CHAVE
 *
 * Ao contrário da Asaas (chave de API) e da Efí (Client ID/Secret + OAuth2),
 * a API de Checkout Integrado da InfinitePay identifica o recebedor pelo
 * `handle` — o nome de usuário (InfiniteTag) da conta, sem o "@". É tudo que
 * o cofre de credenciais (bancoCofre.ts) precisa guardar para este provedor.
 *
 * ----------------------------------------------------------------------------
 * ⚠️ ESTE CÓDIGO NUNCA FOI EXECUTADO CONTRA A API DE VERDADE.
 *
 * Foi escrito a partir da documentação pública em
 * infinitepay.io/checkout-documentacao — a documentação técnica completa em
 * docs.infinitepay.io bloqueou o acesso automatizado ao ser buscada. Os nomes
 * de campo abaixo (`items`, `order_nsu`, `paid_amount`, `capture_method` etc.)
 * vêm de lá; espere precisar ajustar assim que houver uma chamada real de
 * teste com um handle válido — igual já aconteceu com a Efí (ver aviso em
 * efi.ts) antes da primeira emissão de verdade.
 *
 * ----------------------------------------------------------------------------
 * O FLUXO
 *
 *   1. Criar o link        → POST /links          (chamado por efi.ts ao gerar
 *                                                    a cobrança em `cobrancas`)
 *   2. Cliente paga fora daqui, no link ou na maquininha física
 *   3. Confirmar de verdade → POST /payment_check  (NUNCA confiar só no aviso
 *      do webhook — mesmo princípio já usado para a Asaas: o aviso é tratado
 *      como boato até o próprio provedor confirmar. Ver o comentário sobre
 *      isso em bancoCofre.ts, "O QUE NUNCA SAI DAQUI".)
 */

import axios from "axios";

const BASE = "https://api.checkout.infinitepay.io";

async function chamar(metodo: "GET" | "POST", caminho: string, corpo?: any) {
  try {
    const { data } = await axios.request({
      method: metodo,
      url: `${BASE}${caminho}`,
      data: corpo,
      headers: { "Content-Type": "application/json", "User-Agent": "MEIFlow/1.0" },
      timeout: 20000,
    });
    return data;
  } catch (err: any) {
    throw new Error(
      err?.response?.data?.message ||
        err?.response?.data?.error ||
        err?.message ||
        "Não foi possível falar com a InfinitePay."
    );
  }
}

export type LinkPagamentoInfinitePay = {
  url: string;
  orderNsu: string;
};

/**
 * Gera um link de cobrança em cartão.
 *
 * `valor` vem em reais, como o resto do sistema — é convertido para
 * centavos aqui dentro, porque é assim que a InfinitePay espera.
 *
 * `orderNsu` é o NOSSO identificador da cobrança (o id do documento em
 * `cobrancas`), para o webhook conseguir achar de volta qual cobrança foi
 * paga — o mesmo papel que `referenciaId` cumpre em `criarLancamento`
 * (efi.ts).
 */
export async function criarLinkInfinitePay(
  handle: string,
  opts: { valor: number; descricao: string; orderNsu: string; webhookUrl?: string }
): Promise<LinkPagamentoInfinitePay> {
  if (!handle) throw new Error("SEM_HANDLE_INFINITEPAY");

  const centavos = Math.round(Number(opts.valor) * 100);
  if (!centavos || centavos <= 0) throw new Error("Valor inválido para gerar o link.");

  const resp = await chamar("POST", "/links", {
    handle,
    order_nsu: opts.orderNsu,
    ...(opts.webhookUrl ? { webhook_url: opts.webhookUrl } : {}),
    items: [
      {
        quantity: 1,
        price: centavos,
        description: String(opts.descricao || "Cobrança MEI Flow").slice(0, 190),
      },
    ],
  });

  const url = resp?.url || resp?.link || resp?.payment_url;
  if (!url) throw new Error("A InfinitePay não devolveu o link de pagamento.");

  return { url, orderNsu: opts.orderNsu };
}

export type StatusPagamentoInfinitePay = {
  pago: boolean;
  valorPago?: number;
  parcelas?: number;
  transactionNsu?: string;
  reciboUrl?: string;
};

/**
 * Pergunta DIRETO à InfinitePay se um pedido foi pago.
 *
 * Nunca confia só no corpo do webhook recebido — pelo mesmo motivo já
 * documentado para a Asaas: um aviso forjado criaria um recebimento (e uma
 * NOTA FISCAL) de um pagamento que nunca existiu.
 */
export async function verificarPagamentoInfinitePay(
  handle: string,
  opts: { orderNsu?: string; transactionNsu?: string }
): Promise<StatusPagamentoInfinitePay> {
  if (!handle) throw new Error("SEM_HANDLE_INFINITEPAY");
  if (!opts.orderNsu && !opts.transactionNsu) {
    throw new Error("Informe order_nsu ou transaction_nsu para conferir o pagamento.");
  }

  const resp = await chamar("POST", "/payment_check", {
    handle,
    ...(opts.orderNsu ? { order_nsu: opts.orderNsu } : {}),
    ...(opts.transactionNsu ? { transaction_nsu: opts.transactionNsu } : {}),
  });

  return {
    pago: resp?.paid === true,
    valorPago: typeof resp?.paid_amount === "number" ? resp.paid_amount / 100 : undefined,
    parcelas: resp?.installments,
    transactionNsu: resp?.transaction_nsu,
    reciboUrl: resp?.receipt_url,
  };
}
