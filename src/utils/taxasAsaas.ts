/**
 * ============================================================================
 * TAXAS DE CARTÃO DA ASAAS — simulador de "quanto sobra líquido"
 * ============================================================================
 *
 * A Asaas tem, no painel dela, um "Simulador de vendas": antes de fechar uma
 * cobrança, o usuário vê quanto vai receber líquido em cada opção de
 * parcelamento. Isto aqui é a mesma ideia, dentro do MEI Flow — para o MEI
 * decidir ANTES de gerar a cobrança, sem trocar de aba.
 *
 * ⚠️ TAXA PROMOCIONAL, COM VALIDADE — NÃO NECESSARIAMENTE A DA SUA CONTA.
 *
 * A tabela abaixo foi corrigida a partir de dois lugares que precisam bater
 * um com o outro: o "Simulador de vendas" da própria Asaas
 * (asaas.com/paymentSimulator) e a página de Configurações → Preços e taxas
 * da conta (conferida em 19/08/2026). Os dois mostraram a mesma coisa: hoje
 * a conta está com um PREÇO PROMOCIONAL, um ponto percentual abaixo da taxa
 * "padrão" publicada em asaas.com/precos-e-taxas — foi aí que a versão
 * anterior desta tabela errou, usando a taxa padrão em vez da promocional.
 *
 * A própria tela da Asaas mostra a validade: **promoção válida até
 * 10/09/2026**. Depois dessa data, o certo é a taxa "padrão" (a fixa some,
 * só a percentual sobe 1 ponto em cada faixa — deixada comentada abaixo para
 * não perder o valor):
 *   à vista (1x)   → R$ 0,49 + 2,99%  (padrão, sem promoção)
 *   2 a 6x         → R$ 0,49 + 3,49%
 *   7 a 12x        → R$ 0,49 + 3,99%
 *   13 a 21x       → R$ 0,49 + 4,29%
 *
 * FAIXAS ATUAIS, com a promoção (valor fixo + percentual sobre o total):
 *   à vista (1x)   → R$ 0,49 + 1,99%
 *   2 a 6x         → R$ 0,49 + 2,49%
 *   7 a 12x        → R$ 0,49 + 2,99%
 *   13 a 21x       → R$ 0,49 + 3,29%
 *
 * A taxa fixa é cobrada UMA VEZ por cobrança, não por parcela — é assim que
 * a maioria dos adquirentes brasileiros opera, e bate com a forma como a
 * cobrança nasce aqui: uma `payment` só, parcelada pela Asaas.
 *
 * ⚠️ MESMO CORRIGIDA, ESTA CONTINUA SENDO UMA TABELA FIXA NO CÓDIGO — não uma
 * consulta em tempo real à Asaas. Promoção pode mudar de novo antes de
 * 10/09/2026, ou a conta pode ter uma taxa negociada à parte. O número exato
 * de centavos também pode variar um pouco: a Asaas parece arredondar taxa
 * por parcela, este simulador arredonda uma vez sobre o total — a diferença
 * fica em 1 ou 2 centavos, não é motivo pra desconfiar do cálculo, mas para
 * um valor grande vale sempre conferir no simulador da própria Asaas antes
 * de fechar. Se um dia a Asaas expuser a taxa contratada via API, vale
 * trocar esta tabela fixa por uma consulta de verdade.
 */

/**
 * ============================================================================
 * ANTECIPAÇÃO — quanto custa receber "de uma vez" em vez de mês a mês
 * ============================================================================
 *
 * A Asaas divulga a taxa como "X% ao mês" (confirmado no Simulador de vendas
 * da própria conta, em 20/08/2026): 1,25% ao mês para venda à vista, 1,70% ao
 * mês para venda parcelada. O "ao mês" importa: quem antecipa uma parcela que
 * só cairia daqui a 10 meses paga uns 10 meses de taxa, não 1 — é por isso que
 * antecipar um parcelamento longo (13x-21x) "desconta muito", como reclamado
 * na prática.
 *
 * A Asaas não publica a fórmula exata (quantos dias por "mês", se conta do dia
 * da venda ou da confirmação, arredondamento por parcela...). O que existe
 * aqui é uma RECONSTRUÇÃO, calibrada batendo com três simulações reais feitas
 * no Simulador de vendas da própria Asaas (R$ 10.000, R$ 21.515,60 e
 * R$ 50.000, todas em 21x): nas três, o desconto da antecipação ficou em
 * ~19,97% do valor já líquido da taxa de cartão — e a conta abaixo
 * (1,70% × 32/30 dias × parcela média) bate em ~19,95%, a menos de 0,03 ponto
 * percentual de diferença. Perto o bastante para orçar, não perto o bastante
 * para faturar sem checar.
 *
 * ⚠️ ESTIMATIVA — para valores grandes, sempre confira o número exato no
 * Simulador de vendas da própria Asaas (Cobranças → Simulador de vendas)
 * antes de fechar o preço com o cliente.
 */
export const TAXA_ANTECIPACAO_AVISTA_MES = 1.25;
export const TAXA_ANTECIPACAO_PARCELADO_MES = 1.70;
/** Prazo padrão que a antecipação "pula" — o mesmo D+32 do recebimento normal. */
const DIAS_PRAZO_PADRAO = 32;
const DIAS_POR_MES = 30;

/**
 * Fração do valor (já líquido da taxa de cartão) que a antecipação desconta.
 *
 * À vista: uma parcela só, antecipando ~32 dias.
 * Parcelado: parcela 1 vence em ~32 dias, parcela 2 em ~64, ..., parcela N em
 * ~32×N — antecipar o plano inteiro de uma vez cobra a média dessas N
 * distâncias, daí o fator (N+1)/2 (média de 1..N).
 */
export function fatorAntecipacaoEstimado(parcelas: number): number {
  const p = parcelasValidas(parcelas);
  const periodos = DIAS_PRAZO_PADRAO / DIAS_POR_MES;
  if (p <= 1) return (TAXA_ANTECIPACAO_AVISTA_MES / 100) * periodos;
  return (TAXA_ANTECIPACAO_PARCELADO_MES / 100) * periodos * ((p + 1) / 2);
}

export type FaixaTaxaCartao = {
  min: number;
  max: number;
  taxaFixa: number; // R$, cobrado uma vez por cobrança
  taxaPercentual: number; // ex.: 2.49 para 2,49% sobre o valor total
};

export const TABELA_TAXAS_CARTAO_ASAAS: FaixaTaxaCartao[] = [
  { min: 1, max: 1, taxaFixa: 0.49, taxaPercentual: 1.99 },
  { min: 2, max: 6, taxaFixa: 0.49, taxaPercentual: 2.49 },
  { min: 7, max: 12, taxaFixa: 0.49, taxaPercentual: 2.99 },
  { min: 13, max: 21, taxaFixa: 0.49, taxaPercentual: 3.29 },
];

const arredondar = (n: number) => Math.round(n * 100) / 100;

/** Limita ao intervalo aceito pela Asaas (1 a 21x) antes de qualquer cálculo. */
function parcelasValidas(parcelas: number): number {
  const p = Math.round(Number(parcelas) || 1);
  return Math.max(1, Math.min(21, p));
}

/** A faixa de taxa que se aplica a este número de parcelas. */
export function taxaParaParcelas(parcelas: number): FaixaTaxaCartao {
  const p = parcelasValidas(parcelas);
  return (
    TABELA_TAXAS_CARTAO_ASAAS.find((f) => p >= f.min && p <= f.max) ||
    TABELA_TAXAS_CARTAO_ASAAS[0]
  );
}

export type SimulacaoCartao = {
  parcelas: number;
  /** Quanto o cliente paga em cada parcela. */
  valorParcela: number;
  taxaFixa: number;
  taxaPercentual: number;
  /** Total de taxas descontado desta venda. */
  valorTaxas: number;
  /** O que efetivamente sobra para o MEI, depois das taxas. */
  valorLiquido: number;
  /** Total cobrado do cliente (= valorParcela × parcelas). Repetido aqui para
   *  não obrigar quem consome a recalcular — em "com repasse" é diferente do
   *  valor que o MEI digitou. */
  valorBruto: number;
};

/**
 * Simula quanto sobra líquido para o MEI numa venda de `valorVenda`, parcelada
 * em `parcelas` vezes no cartão, quando o PRÓPRIO MEI absorve a taxa — o
 * cliente paga exatamente `valorVenda`, dividido nas parcelas.
 *
 * Nunca lança erro — valores fora do intervalo são limitados silenciosamente
 * (1 a 21x, valor negativo vira zero), porque isto alimenta uma tela que
 * atualiza a cada tecla digitada: travar no meio da digitação seria pior que
 * mostrar um número provisório.
 */
export function simularRecebimentoCartao(valorVenda: number, parcelas: number): SimulacaoCartao {
  const p = parcelasValidas(parcelas);
  const valor = Math.max(0, Number(valorVenda) || 0);
  const faixa = taxaParaParcelas(p);
  const valorTaxas = arredondar(faixa.taxaFixa + (valor * faixa.taxaPercentual) / 100);
  const valorLiquido = arredondar(Math.max(0, valor - valorTaxas));

  return {
    parcelas: p,
    valorParcela: arredondar(valor / p),
    taxaFixa: faixa.taxaFixa,
    taxaPercentual: faixa.taxaPercentual,
    valorTaxas,
    valorLiquido,
    valorBruto: arredondar(valor),
  };
}

/**
 * O inverso: quanto COBRAR do cliente para que, depois de descontada a taxa
 * desta faixa de parcelamento, sobre exatamente `valorLiquidoDesejado` para
 * o MEI — "repassar a taxa ao cliente", em vez de o MEI absorver o custo do
 * parcelamento.
 *
 * A conta: se X é o valor cobrado do cliente,
 *   líquido = X − (taxaFixa + X × taxaPercentual/100)
 * Isolando X para que líquido = valorLiquidoDesejado:
 *   X = (valorLiquidoDesejado + taxaFixa) / (1 − taxaPercentual/100)
 *
 * Assim como a função irmã, nunca lança erro — mesma lógica de limitar
 * silenciosamente parcelas e valor, pelo mesmo motivo (tela que recalcula a
 * cada tecla digitada).
 */
export function calcularValorComRepasse(valorLiquidoDesejado: number, parcelas: number): SimulacaoCartao {
  const p = parcelasValidas(parcelas);
  const liquidoAlvo = Math.max(0, Number(valorLiquidoDesejado) || 0);
  const faixa = taxaParaParcelas(p);
  const fatorPercentual = faixa.taxaPercentual / 100;
  // A tabela atual nunca chega perto de 100% de taxa, mas a guarda evita
  // dividir por zero (ou por negativo) se um dia uma faixa absurda for
  // adicionada por engano.
  const valorBruto =
    fatorPercentual < 1
      ? arredondar((liquidoAlvo + faixa.taxaFixa) / (1 - fatorPercentual))
      : arredondar(liquidoAlvo + faixa.taxaFixa);
  const valorTaxas = arredondar(Math.max(0, valorBruto - liquidoAlvo));

  return {
    parcelas: p,
    valorParcela: arredondar(valorBruto / p),
    taxaFixa: faixa.taxaFixa,
    taxaPercentual: faixa.taxaPercentual,
    valorTaxas,
    // Por definição do que foi pedido — o valor efetivo (valorBruto - valorTaxas)
    // pode diferir em menos de 1 centavo por causa do arredondamento acima.
    valorLiquido: liquidoAlvo,
    valorBruto,
  };
}

export type SimulacaoComAntecipacao = SimulacaoCartao & {
  /** Fração estimada que a antecipação desconta (ver fatorAntecipacaoEstimado). */
  fatorAntecipacao: number;
  /** Quanto da taxa total cobrada é só a parte da antecipação (não do cartão). */
  valorTaxaAntecipacao: number;
  /** Sempre true aqui — é reconstrução, não a tabela oficial da Asaas. */
  estimativa: true;
};

/**
 * O mesmo "repassar a taxa" de `calcularValorComRepasse`, mas cobrindo TAMBÉM
 * o custo da antecipação — para quem quer receber o valor cheio de uma vez
 * (sem esperar 32 dias / mês a mês) sem abrir mão de nada para isso, jogando
 * as duas taxas (cartão + antecipação) para dentro do preço cobrado do
 * cliente.
 *
 * A conta, em duas etapas (X = valor cobrado do cliente):
 *   1) depois da taxa do cartão:      semAntecipar = X × (1 − taxaPercentual/100) − taxaFixa
 *   2) depois da taxa de antecipação: líquido      = semAntecipar × (1 − fatorAntecipacao)
 * Isolando X para que líquido = valorLiquidoDesejado:
 *   X = [ valorLiquidoDesejado / (1 − fatorAntecipacao) + taxaFixa ] / (1 − taxaPercentual/100)
 *
 * ⚠️ Usa `fatorAntecipacaoEstimado`, que é uma RECONSTRUÇÃO da taxa da Asaas,
 * não a tabela oficial dela — para uma venda grande, confira o número exato
 * no Simulador de vendas da própria Asaas antes de fechar o preço.
 */
export function calcularValorComRepasseTotal(
  valorLiquidoDesejado: number,
  parcelas: number
): SimulacaoComAntecipacao {
  const p = parcelasValidas(parcelas);
  const liquidoAlvo = Math.max(0, Number(valorLiquidoDesejado) || 0);
  const faixa = taxaParaParcelas(p);
  const fatorPercentual = faixa.taxaPercentual / 100;
  const fatorAntecipacao = fatorAntecipacaoEstimado(p);

  const semAntecipacaoAlvo = fatorAntecipacao < 1 ? liquidoAlvo / (1 - fatorAntecipacao) : liquidoAlvo;
  const valorBruto =
    fatorPercentual < 1
      ? arredondar((semAntecipacaoAlvo + faixa.taxaFixa) / (1 - fatorPercentual))
      : arredondar(semAntecipacaoAlvo + faixa.taxaFixa);

  const valorTaxas = arredondar(Math.max(0, valorBruto - liquidoAlvo));
  const valorTaxaAntecipacao = arredondar(Math.max(0, semAntecipacaoAlvo - liquidoAlvo));

  return {
    parcelas: p,
    valorParcela: arredondar(valorBruto / p),
    taxaFixa: faixa.taxaFixa,
    taxaPercentual: faixa.taxaPercentual,
    valorTaxas,
    valorTaxaAntecipacao,
    fatorAntecipacao,
    valorLiquido: liquidoAlvo,
    valorBruto,
    estimativa: true,
  };
}
