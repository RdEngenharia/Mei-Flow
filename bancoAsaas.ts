/**
 * ============================================================================
 * MEI FLOW — EMISSÃO DE BOLETO PELA ASAAS
 * ============================================================================
 *
 * Portado do Vitri Pro, onde já emitiu boleto real em produção. O fluxo é o
 * mesmo, confirmado contra a documentação oficial e contra um boleto de
 * verdade; o que mudou foi o encanamento — lá era Cloud Functions com o `https`
 * do Node, aqui é axios, que o MEI Flow já usa.
 *
 * ----------------------------------------------------------------------------
 * POR QUE A ASAAS É O PROVEDOR MAIS SIMPLES
 *
 * Autenticação por UMA chave de API, mandada no header `access_token`. Sem
 * OAuth2, sem renovação de token, sem certificado mTLS. Isso é exceção, não
 * regra: a Efí exige OAuth2, e o Banco Inter exige certificado mesmo só para
 * boleto. Não presuma que um banco novo se pareça com este.
 *
 * ----------------------------------------------------------------------------
 * O FLUXO, EM TRÊS PASSOS
 *
 *   1. Procura o cliente pelo CPF/CNPJ  → GET  /v3/customers?cpfCnpj=…
 *   2. Cria, se não existir             → POST /v3/customers
 *   3. Cria a cobrança em boleto        → POST /v3/payments
 *
 * O passo 1 não é otimização: sem ele, cada boleto criaria um cliente novo e o
 * painel da Asaas ficaria com a mesma pessoa repetida dezenas de vezes.
 *
 * A resposta do passo 3 já traz o link do PDF (`bankSlipUrl`) e a linha
 * digitável (`identificationField`) — não é preciso uma segunda chamada.
 */

import axios from "axios";

const BASE_PRODUCAO = "https://api.asaas.com";
const BASE_SANDBOX = "https://api-sandbox.asaas.com";

export function baseAsaas(ambiente?: string): string {
  return ambiente === "homologacao" ? BASE_SANDBOX : BASE_PRODUCAO;
}

/**
 * Uma chamada à Asaas.
 *
 * Os erros dela vêm num array `errors` com `description` legível. Juntar tudo
 * numa frase só é o que faz a diferença entre "erro 400" e "o CPF informado é
 * inválido" na tela do usuário.
 */
async function chamar(
  ambiente: string | undefined,
  apiKey: string,
  metodo: "GET" | "POST",
  caminho: string,
  corpo?: any
) {
  try {
    const { data } = await axios.request({
      method: metodo,
      url: `${baseAsaas(ambiente)}${caminho}`,
      data: corpo,
      headers: {
        "Content-Type": "application/json",
        // ⚠️ A Asaas autentica pela própria chave neste header — NÃO é um
        //    "Authorization: Bearer" de OAuth2.
        access_token: apiKey,
        "User-Agent": "MEIFlow/1.0",
      },
      timeout: 20000,
    });
    return data;
  } catch (err: any) {
    const erros = err?.response?.data?.errors;
    if (Array.isArray(erros) && erros.length) {
      throw new Error(erros.map((e: any) => e.description || e.code).join("; "));
    }
    throw new Error(
      err?.response?.data?.message ||
        err?.message ||
        "Não foi possível falar com a Asaas."
    );
  }
}

export type DadosBoletoAsaas = {
  /** Em reais. */
  valor: number;
  /** ISO curto: 2026-09-10. */
  vencimento: string;
  clienteNome: string;
  /** Só dígitos. Obrigatório — a Asaas recusa cliente sem ele. */
  clienteDocumento: string;
  clienteEmail?: string;
  clienteTelefone?: string;
  /**
   * O texto que o pagador lê. Na folha do boleto ele aparece em "Instruções
   * (Texto de responsabilidade do beneficiário)" — é o ÚNICO lugar onde uma
   * descrição livre do serviço chega ao cliente. Confirmado em boleto real.
   */
  descricao?: string;
  juros?: number;
  multa?: number;
};

export type BoletoEmitido = {
  id: string;
  linhaDigitavel: string;
  linkPdf: string;
  status: string;
  valor: number;
  vencimento: string;
};

/**
 * Emite o boleto. Lança erro com mensagem pronta para a tela.
 */
export async function emitirBoletoAsaas(
  credenciais: { apiKey?: string },
  ambiente: string | undefined,
  dados: DadosBoletoAsaas
): Promise<BoletoEmitido> {
  const apiKey = String(credenciais?.apiKey || "").trim();
  if (!apiKey) throw new Error("SEM_CREDENCIAIS_USUARIO");

  const documento = String(dados.clienteDocumento || "").replace(/\D/g, "");
  // Conferir aqui evita gastar uma chamada de API só para descobrir isto pelo
  // erro — e a mensagem sai clara em vez de "invalid customer".
  if (documento.length !== 11 && documento.length !== 14) {
    throw new Error(
      "O cliente precisa ter um CPF (11 dígitos) ou CNPJ (14 dígitos) válido para emitir boleto."
    );
  }

  // 1 e 2 — cliente: procura antes de criar, para não duplicar.
  let customerId = "";
  const busca = await chamar(
    ambiente,
    apiKey,
    "GET",
    `/v3/customers?cpfCnpj=${encodeURIComponent(documento)}`
  );

  if (busca && Array.isArray(busca.data) && busca.data.length > 0) {
    customerId = busca.data[0].id;
  } else {
    const criado = await chamar(ambiente, apiKey, "POST", "/v3/customers", {
      name: dados.clienteNome || "Cliente",
      cpfCnpj: documento,
      ...(dados.clienteEmail ? { email: dados.clienteEmail } : {}),
      ...(dados.clienteTelefone
        ? { mobilePhone: String(dados.clienteTelefone).replace(/\D/g, "") }
        : {}),
    });
    customerId = criado?.id || "";
  }

  if (!customerId) throw new Error("A Asaas não devolveu o cliente. Tente novamente.");

  // 3 — a cobrança.
  const cobranca = await chamar(ambiente, apiKey, "POST", "/v3/payments", {
    customer: customerId,
    billingType: "BOLETO",
    value: Number(dados.valor),
    dueDate: String(dados.vencimento).slice(0, 10),
    description: dados.descricao || undefined,
    ...(dados.juros ? { interest: { value: Number(dados.juros) } } : {}),
    ...(dados.multa ? { fine: { value: Number(dados.multa) } } : {}),
  });

  return {
    id: String(cobranca?.id || ""),
    linhaDigitavel: cobranca?.identificationField || "",
    // O bankSlipUrl é o PDF; o invoiceUrl é a página de pagamento. Se o
    // primeiro faltar, o segundo ainda leva o cliente ao lugar certo.
    linkPdf: cobranca?.bankSlipUrl || cobranca?.invoiceUrl || "",
    status: cobranca?.status || "PENDING",
    valor: Number(dados.valor),
    vencimento: String(dados.vencimento).slice(0, 10),
  };
}

/**
 * Consulta uma cobrança. É o que dá a baixa enquanto o webhook da Asaas não
 * existe aqui — o botão "Sincronizar" passa por esta função.
 */
export async function consultarCobrancaAsaas(
  credenciais: { apiKey?: string },
  ambiente: string | undefined,
  id: string
): Promise<{ status: string; pagoEm?: string; bruto: any }> {
  const apiKey = String(credenciais?.apiKey || "").trim();
  if (!apiKey) throw new Error("SEM_CREDENCIAIS_USUARIO");

  const d = await chamar(ambiente, apiKey, "GET", `/v3/payments/${encodeURIComponent(id)}`);
  return {
    status: String(d?.status || ""),
    // A Asaas distingue "confirmado" de "creditado na conta". Para a baixa no
    // sistema, a data de pagamento é a que interessa.
    pagoEm: d?.paymentDate || d?.confirmedDate || d?.clientPaymentDate || undefined,
    bruto: d,
  };
}

/**
 * Traduz o status da Asaas para o vocabulário do MEI Flow.
 *
 * ⚠️ RECEIVED e CONFIRMED são coisas diferentes lá: CONFIRMED é "o pagamento
 *    aconteceu", RECEIVED é "o dinheiro já está na conta". Para dar baixa na
 *    cobrança, os dois valem como pago — esperar só o RECEIVED faria o boleto
 *    ficar em aberto por dias depois de o cliente ter pagado.
 */
export function situacaoAsaas(status: string): "pago" | "cancelado" | "vencido" | "pendente" {
  const s = String(status || "").toUpperCase();
  if (s === "RECEIVED" || s === "CONFIRMED" || s === "RECEIVED_IN_CASH") return "pago";
  if (s === "REFUNDED" || s === "DELETED" || s === "CHARGEBACK_REQUESTED") return "cancelado";
  if (s === "OVERDUE") return "vencido";
  return "pendente";
}
