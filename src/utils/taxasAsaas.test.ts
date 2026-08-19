/**
 * ============================================================================
 * TESTES DO SIMULADOR DE TAXAS DE CARTÃO (ASAAS)
 * ============================================================================
 * Rodar: npx tsx src/utils/taxasAsaas.test.ts
 *
 * O que precisa continuar verdade:
 * 1. As quatro faixas (1x, 2-6x, 7-12x, 13-21x) batem com a tabela publicada.
 * 2. As bordas de cada faixa (1/2, 6/7, 12/13, 21) caem do lado certo.
 * 3. Parcelas fora do intervalo (0, negativo, 22+) são limitadas a 1-21, nunca
 *    lançam erro — a tela chama isto a cada tecla digitada.
 * 4. A taxa fixa é cobrada uma vez só, não uma vez por parcela.
 * 5. Líquido + taxas sempre fecha com o valor da venda.
 */

import { taxaParaParcelas, simularRecebimentoCartao } from "./taxasAsaas";

let passou = 0;
let falhou = 0;
function t(nome: string, condicao: boolean, detalhe?: unknown) {
  if (condicao) passou++;
  else {
    falhou++;
    console.error(`  ✗ ${nome}${detalhe !== undefined ? `\n      obtido: ${JSON.stringify(detalhe)}` : ""}`);
  }
}
function bloco(titulo: string) { console.log(`\n${titulo}`); }

/* ========================================================================== */
bloco("Faixas de taxa — valores e bordas");

t("1x (à vista) é 2,99%", taxaParaParcelas(1).taxaPercentual === 2.99);
t("2x entra na faixa 2-6x (3,49%)", taxaParaParcelas(2).taxaPercentual === 3.49);
t("6x ainda é 3,49%", taxaParaParcelas(6).taxaPercentual === 3.49);
t("7x já é 3,99%", taxaParaParcelas(7).taxaPercentual === 3.99);
t("12x ainda é 3,99%", taxaParaParcelas(12).taxaPercentual === 3.99);
t("13x já é 4,29%", taxaParaParcelas(13).taxaPercentual === 4.29);
t("21x ainda é 4,29%", taxaParaParcelas(21).taxaPercentual === 4.29);
t("taxa fixa é sempre R$ 0,49, em qualquer faixa", [1, 5, 10, 20].every((p) => taxaParaParcelas(p).taxaFixa === 0.49));

/* ========================================================================== */
bloco("Parcelas fora do intervalo não travam o cálculo");

t("0 parcelas vira 1x (à vista)", taxaParaParcelas(0).taxaPercentual === 2.99);
t("parcela negativa vira 1x", taxaParaParcelas(-5).taxaPercentual === 2.99);
t("22 parcelas (acima do limite) vira 21x", taxaParaParcelas(22).taxaPercentual === 4.29);
t("100 parcelas vira 21x", taxaParaParcelas(100).taxaPercentual === 4.29);

/* ========================================================================== */
bloco("Simulação — valores calculados");

const s1 = simularRecebimentoCartao(1000, 1);
t("à vista de R$1000: taxa = 0,49 + 2,99% de 1000 = 29,90 + 0,49 = 30,39", s1.valorTaxas === 30.39, s1);
t("à vista de R$1000: líquido = 1000 - 30,39 = 969,61", s1.valorLiquido === 969.61, s1);
t("à vista: valor da parcela é o total", s1.valorParcela === 1000);

const s2 = simularRecebimentoCartao(1200, 6);
t("R$1200 em 6x: taxa = 0,49 + 3,49% de 1200 = 41,88 + 0,49 = 42,37", s2.valorTaxas === 42.37, s2);
t("R$1200 em 6x: parcela de R$200", s2.valorParcela === 200, s2);

t("líquido + taxas sempre fecha com o valor da venda",
  [1, 3, 7, 13, 21].every((p) => {
    const sim = simularRecebimentoCartao(537.42, p);
    return Math.abs(sim.valorLiquido + sim.valorTaxas - 537.42) < 0.01;
  })
);

/* ========================================================================== */
bloco("Casos degenerados");

const semValor = simularRecebimentoCartao(0, 3);
t("venda de R$0 não gera taxa negativa nem líquido negativo", semValor.valorLiquido === 0 && semValor.valorTaxas >= 0, semValor);

const negativo = simularRecebimentoCartao(-50, 1);
t("valor negativo é tratado como zero, não como venda de fato", negativo.valorTaxas === 0.49 && negativo.valorLiquido === 0, negativo);

console.log(`\n${falhou === 0 ? "✓" : "✗"} ${passou} passaram, ${falhou} falharam\n`);
if (falhou > 0) process.exit(1);
