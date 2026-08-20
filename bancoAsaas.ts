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
  metodo: "GET" | "POST" | "PUT" | "DELETE",
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

/** Achado ou criado — o mesmo cliente serve para boleto e para cartão. */
type ClienteMinimo = {
  clienteNome: string;
  /** Só dígitos. */
  clienteDocumento: string;
  clienteEmail?: string;
  clienteTelefone?: string;
};

/**
 * ============================================================================
 * NOTIFICAÇÕES PAGAS — desligando a cobrança automática por mensagem
 * ============================================================================
 *
 * A Asaas cria, para todo cliente novo, uma sequência de notificações
 * automáticas (cobrança criada, vencimento próximo, recebida, etc.). E-mail
 * é grátis, mas os outros canais são cobrados por mensagem — e é cada uma
 * dessas mensagens que aparece no extrato da Asaas como "Taxa de notificação
 * por WhatsApp" ou "Taxa de mensageria" (essa segunda apareceu depois: é o
 * SMS, que também é pago e a versão anterior desta função não desligava —
 * só cuidava do WhatsApp, achando que era o único canal cobrado). Numa
 * cobrança PARCELADA, cada parcela nasce como uma cobrança (`payment`)
 * separada por baixo dos panos — é por isso que uma venda em 10x pode gerar
 * 10 mensagens (e 10 taxas) de uma vez: não é 10 mensagens sobre 1 cobrança,
 * são 10 cobranças, cada uma com sua própria notificação.
 *
 * A configuração de notificação, porém, é por CLIENTE, não por cobrança —
 * então desligar os canais pagos uma vez para o cliente vale para todas as
 * cobranças dele, presentes e futuras, parceladas ou não.
 *
 * ⚠️ NÃO CONFIRMADO CONTRA UMA RESPOSTA REAL: a documentação não deixa 100%
 * claro se o PUT em `/v3/notifications/{id}` aceita só os campos que mudam
 * (parcial) ou se é preciso reenviar o objeto inteiro. Aqui mandamos só os
 * três campos que zeramos — é o padrão mais comum no resto desta API (todas
 * as outras rotas usadas neste arquivo aceitam corpo parcial). Depois de
 * usar, vale conferir no painel da Asaas (Cliente → Notificações) se o
 * e-mail continua do jeito que estava antes.
 */
async function desligarNotificacoesPagasDoCliente(
  ambiente: string | undefined,
  apiKey: string,
  customerId: string
): Promise<void> {
  const resposta = await chamar(
    ambiente,
    apiKey,
    "GET",
    `/v3/customers/${encodeURIComponent(customerId)}/notifications`
  );
  const notificacoes: any[] = Array.isArray(resposta?.data)
    ? resposta.data
    : Array.isArray(resposta)
    ? resposta
    : [];

  for (const n of notificacoes) {
    if (!n?.id) continue;
    // Já desligado nos três? Não gasta chamada à toa.
    if (
      n.whatsappEnabledForCustomer === false &&
      n.smsEnabledForCustomer === false &&
      n.phoneCallEnabledForCustomer === false
    ) {
      continue;
    }
    await chamar(ambiente, apiKey, "PUT", `/v3/notifications/${encodeURIComponent(n.id)}`, {
      whatsappEnabledForCustomer: false,
      smsEnabledForCustomer: false,
      phoneCallEnabledForCustomer: false,
    });
  }
}

/**
 * Chama `desligarNotificacoesPagasDoCliente` sem deixar uma falha nela
 * travar a emissão da cobrança em si — é mais importante o MEI conseguir
 * cobrar o cliente do que essa limpeza funcionar toda vez. Se falhar, só
 * registra no log do servidor.
 */
async function desligarNotificacoesPagasSeNecessario(
  ambiente: string | undefined,
  apiKey: string,
  customerId: string
): Promise<void> {
  try {
    await desligarNotificacoesPagasDoCliente(ambiente, apiKey, customerId);
  } catch (err: any) {
    console.error(
      "[Asaas] Não foi possível desligar as notificações pagas do cliente:",
      err?.message || err
    );
  }
}

/**
 * Passos 1 e 2 do fluxo: procura o cliente pelo CPF/CNPJ, cria se não achar.
 * Compartilhado entre boleto e cartão — os dois cobram da mesma carteira de
 * clientes da Asaas, então duplicar essa busca criaria o mesmo cliente duas
 * vezes (uma "boleto", outra "cartão") no painel dela.
 *
 * Também desliga as notificações pagas (WhatsApp, SMS, ligação) do cliente
 * aqui — cliente achado ou criado, tanto faz, porque um cliente antigo (de
 * antes desta função existir) continuaria gerando taxa até alguém desligar
 * manualmente. Fazendo aqui, a primeira cobrança nova para qualquer cliente
 * já corrige isso sozinha.
 */
async function resolverClienteAsaas(
  ambiente: string | undefined,
  apiKey: string,
  dados: ClienteMinimo
): Promise<string> {
  const documento = String(dados.clienteDocumento || "").replace(/\D/g, "");
  if (documento.length !== 11 && documento.length !== 14) {
    throw new Error(
      "O cliente precisa ter um CPF (11 dígitos) ou CNPJ (14 dígitos) válido para cobrar."
    );
  }

  const busca = await chamar(
    ambiente,
    apiKey,
    "GET",
    `/v3/customers?cpfCnpj=${encodeURIComponent(documento)}`
  );

  if (busca && Array.isArray(busca.data) && busca.data.length > 0) {
    const id = busca.data[0].id;
    await desligarNotificacoesPagasSeNecessario(ambiente, apiKey, id);
    return id;
  }

  const criado = await chamar(ambiente, apiKey, "POST", "/v3/customers", {
    name: dados.clienteNome || "Cliente",
    cpfCnpj: documento,
    ...(dados.clienteEmail ? { email: dados.clienteEmail } : {}),
    ...(dados.clienteTelefone
      ? { mobilePhone: String(dados.clienteTelefone).replace(/\D/g, "") }
      : {}),
  });

  if (!criado?.id) throw new Error("A Asaas não devolveu o cliente. Tente novamente.");
  await desligarNotificacoesPagasSeNecessario(ambiente, apiKey, criado.id);
  return criado.id;
}

/**
 * Versão exportada, para uma rotina manual de "corrigir clientes antigos de
 * uma vez" — ver `/api/efi/notificacoes/desativar-whatsapp` em efi.ts. Ao
 * contrário da chamada interna em `resolverClienteAsaas`, esta propaga o
 * erro: quem chama precisa saber, cliente por cliente, se funcionou ou não.
 */
export async function desligarNotificacaoWhatsappAsaas(
  credenciais: { apiKey?: string },
  ambiente: string | undefined,
  customerId: string
): Promise<void> {
  const apiKey = String(credenciais?.apiKey || "").trim();
  if (!apiKey) throw new Error("SEM_CREDENCIAIS_USUARIO");
  await desligarNotificacoesPagasDoCliente(ambiente, apiKey, customerId);
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

  // 1 e 2 — cliente: procura antes de criar, para não duplicar.
  const customerId = await resolverClienteAsaas(ambiente, apiKey, dados);

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

export type DadosCartaoAsaas = {
  /** Valor total da venda — se parcelado, a Asaas divide entre as parcelas. */
  valor: number;
  /** ISO curto: 2026-09-10. Data do primeiro vencimento/cobrança. */
  vencimento: string;
  clienteNome: string;
  /** Só dígitos. */
  clienteDocumento: string;
  clienteEmail?: string;
  clienteTelefone?: string;
  descricao?: string;
  /** 1 = à vista. Até 21, mas o limite real depende da bandeira do cartão do cliente. */
  parcelas?: number;
};

export type CobrancaCartaoEmitida = {
  id: string;
  /** Página da própria Asaas onde o cliente digita o cartão — nunca o MEI Flow. */
  linkPagamento: string;
  status: string;
  valor: number;
  parcelas: number;
  vencimento: string;
  /**
   * ID do "plano de parcelamento" que a Asaas devolve quando `parcelas > 1`.
   * ⚠️ NÃO CONFIRMADO: a documentação de criação de cobrança não deixou claro,
   * na leitura feita, se este campo (`installment`) sempre volta na resposta
   * quando se manda `installmentCount`. Guardamos aqui se vier; se não vier,
   * quem for antecipar o parcelamento inteiro (ver `solicitarAntecipacaoAsaas`)
   * não vai ter como, e cai no aviso de "não foi possível confirmar".
   */
  installmentId?: string;
  /** Resposta crua da Asaas, para depurar quando um campo esperado não vem. */
  bruto: any;
};

/**
 * Emite uma cobrança em cartão de crédito, no modelo "checkout hospedado":
 * o MEI Flow NUNCA recebe número de cartão. A Asaas devolve um link
 * (`invoiceUrl`) — o mesmo mecanismo que o boleto já usa — e é lá, na página
 * da própria Asaas, que o cliente digita os dados do cartão e escolhe em
 * quantas vezes quer pagar (até o limite passado em `parcelas`).
 *
 * ⚠️ NUNCA ENVIAR `creditCard`/`creditCardHolderInfo` AQUI.
 *
 * A API da Asaas aceita receber o cartão diretamente, mas isso muda a conta
 * de responsabilidade por completo: o servidor passaria a manipular dado de
 * cartão de verdade, o que exige HTTPS ponta a ponta, cuidado com PCI-DSS e
 * IP do pagador (`remoteIp`). O checkout hospedado evita tudo isso de
 * propósito — a página é da Asaas, a responsabilidade de segurança do
 * cartão é dela.
 *
 * ⚠️ ESTE CAMINHO (parcelas + checkout hospedado, sem dado de cartão) FOI
 * ESCRITO A PARTIR DA DOCUMENTAÇÃO DA ASAAS, NÃO CONFIRMADO CONTRA UMA
 * COBRANÇA REAL. Os campos `installmentCount`/`totalValue` são documentados
 * na criação de cobrança comum (`/v3/payments`) para "cobrança parcelada",
 * mas a doc não deixa 100% claro se, no cartão sem dado enviado, a Asaas
 * respeita esse limite na tela dela ou deixa o cliente escolher livremente.
 * Antes de usar para valer, gere uma cobrança pequena em homologação e
 * confira se a página de pagamento realmente oferece as parcelas certas.
 */
export async function emitirCartaoAsaas(
  credenciais: { apiKey?: string },
  ambiente: string | undefined,
  dados: DadosCartaoAsaas
): Promise<CobrancaCartaoEmitida> {
  const apiKey = String(credenciais?.apiKey || "").trim();
  if (!apiKey) throw new Error("SEM_CREDENCIAIS_USUARIO");

  const customerId = await resolverClienteAsaas(ambiente, apiKey, dados);

  // Visa/Mastercard aceitam até 21x; outras bandeiras, até 12x — mas isso só
  // se sabe depois que o cliente digita o cartão. Aqui só limitamos o teto
  // absoluto; a bandeira específica quem resolve é a própria Asaas na hora.
  const parcelas = Math.max(1, Math.min(21, Math.round(Number(dados.parcelas) || 1)));
  const valorTotal = Number(dados.valor);

  const payload: any = {
    customer: customerId,
    billingType: "CREDIT_CARD",
    dueDate: String(dados.vencimento).slice(0, 10),
    description: dados.descricao || undefined,
  };

  if (parcelas > 1) {
    payload.installmentCount = parcelas;
    payload.totalValue = valorTotal;
  } else {
    payload.value = valorTotal;
  }

  const cobranca = await chamar(ambiente, apiKey, "POST", "/v3/payments", payload);

  return {
    id: String(cobranca?.id || ""),
    linkPagamento: cobranca?.invoiceUrl || "",
    status: cobranca?.status || "PENDING",
    valor: valorTotal,
    parcelas,
    vencimento: String(dados.vencimento).slice(0, 10),
    installmentId: cobranca?.installment ? String(cobranca.installment) : undefined,
    bruto: cobranca,
  };
}

/**
 * ============================================================================
 * ANTECIPAÇÃO DE RECEBÍVEIS — "receber mês a mês" vs "receber tudo de uma vez"
 * ============================================================================
 *
 * Por padrão, a Asaas repassa o dinheiro de uma cobrança em cartão no prazo
 * normal dela (por volta de 32 dias corridos após a venda; parcelado, cada
 * parcela cai separada, mês a mês). Quem quer o dinheiro adiantado — tudo de
 * uma vez, hoje — pede uma ANTECIPAÇÃO, e paga uma taxa maior por isso. É uma
 * chamada separada da criação da cobrança, não um campo que se manda junto.
 *
 * Para cobrança em cartão PARCELADA, dá para antecipar:
 *   - o plano inteiro de uma vez, mandando `installment` (o id do parcelamento)
 *   - ou parcela por parcela, mandando `payment` (o id de cada cobrança)
 * Os dois campos são excludentes — nunca os dois juntos.
 *
 * ⚠️ NÃO CONFIRMADO CONTRA UMA RESPOSTA REAL: a documentação da Asaas para
 * `/v3/anticipations/simulate` e `/v3/anticipations` não trouxe, na consulta
 * feita, o formato exato da resposta (nomes dos campos de taxa e valor
 * líquido). O código abaixo tenta os nomes mais prováveis (`netValue`,
 * `fee`/`value`) e guarda a resposta crua em `bruto` para quem precisar
 * conferir o campo certo na hora de depurar. Antes de confiar nisto para
 * valer, peça para o usuário testar com uma cobrança pequena (ou em
 * homologação) e comparar o valor mostrado aqui com o que aparece no painel
 * da própria Asaas.
 */

export type AlvoAntecipacao =
  | { tipo: "installment"; id: string }
  | { tipo: "payment"; id: string };

export type AntecipacaoAsaas = {
  /** true se a Asaas aceitou o pedido — não necessariamente já pagou. */
  status?: string;
  /** Quanto seria descontado de taxa — campo ainda não confirmado, pode faltar. */
  taxaEstimada?: number;
  /** Quanto sobraria líquido — campo ainda não confirmado, pode faltar. */
  valorLiquidoEstimado?: number;
  /** Resposta crua da Asaas, para conferir/depurar os nomes reais dos campos. */
  bruto: any;
};

async function chamarAntecipacaoAsaas(
  credenciais: { apiKey?: string },
  ambiente: string | undefined,
  alvo: AlvoAntecipacao,
  simular: boolean
): Promise<AntecipacaoAsaas> {
  const apiKey = String(credenciais?.apiKey || "").trim();
  if (!apiKey) throw new Error("SEM_CREDENCIAIS_USUARIO");

  const corpo = alvo.tipo === "installment" ? { installment: alvo.id } : { payment: alvo.id };
  const caminho = simular ? "/v3/anticipations/simulate" : "/v3/anticipations";
  const d = await chamar(ambiente, apiKey, "POST", caminho, corpo);

  // Nomes de campo tentados na ordem mais provável primeiro — nenhum deles
  // confirmado contra uma resposta real (ver aviso acima).
  const valorLiquido = d?.netValue ?? d?.netAmount ?? d?.value ?? undefined;
  const taxa =
    d?.fee ??
    (typeof d?.totalValue === "number" && typeof valorLiquido === "number"
      ? Number((d.totalValue - valorLiquido).toFixed(2))
      : undefined);

  return {
    status: d?.status ? String(d.status) : undefined,
    taxaEstimada: typeof taxa === "number" ? taxa : undefined,
    valorLiquidoEstimado: typeof valorLiquido === "number" ? valorLiquido : undefined,
    bruto: d,
  };
}

/** Simula a antecipação sem pedir de verdade — para mostrar a taxa antes de confirmar. */
export function simularAntecipacaoAsaas(
  credenciais: { apiKey?: string },
  ambiente: string | undefined,
  alvo: AlvoAntecipacao
): Promise<AntecipacaoAsaas> {
  return chamarAntecipacaoAsaas(credenciais, ambiente, alvo, true);
}

/** Pede a antecipação de verdade — dinheiro tudo de uma vez, com a taxa maior. */
export function solicitarAntecipacaoAsaas(
  credenciais: { apiKey?: string },
  ambiente: string | undefined,
  alvo: AlvoAntecipacao
): Promise<AntecipacaoAsaas> {
  return chamarAntecipacaoAsaas(credenciais, ambiente, alvo, false);
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
 * Cancela/exclui uma cobrança que ainda não foi paga.
 *
 * ⚠️ ISTO NÃO É ESTORNO. A própria Asaas documenta que excluir uma cobrança
 * não devolve dinheiro nenhum — para uma cobrança já recebida, ela recusa
 * com 400. Por isso quem chama esta função precisa conferir o status ANTES
 * (ver efi.ts, rota de cancelamento): aqui só repassamos a chamada.
 */
export async function cancelarCobrancaAsaas(
  credenciais: { apiKey?: string },
  ambiente: string | undefined,
  id: string
): Promise<void> {
  const apiKey = String(credenciais?.apiKey || "").trim();
  if (!apiKey) throw new Error("SEM_CREDENCIAIS_USUARIO");
  await chamar(ambiente, apiKey, "DELETE", `/v3/payments/${encodeURIComponent(id)}`);
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
