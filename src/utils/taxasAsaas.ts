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
