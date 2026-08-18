/**
 * ============================================================================
 * TESTES DE RECEBIMENTO E COMISSÃO
 * ============================================================================
 *
 * Rodar:  npx tsx src/utils/recebimentos.test.ts
 *
 * O que estes testes existem para impedir, em ordem de gravidade:
 *
 * 1. Venda antiga deixar de somar no faturamento. É o pior estrago possível
 *    aqui: o dinheiro some da tela e ninguém percebe até o contador conferir.
 * 2. O invariante `valor === soma dos recebidos` sair de sincronia. Quando ele
 *    quebra, o caixa e o plano de recebimento discordam em silêncio.
 *    (Ver src/utils/recebimentos.ts.)
 * 3. Centavos de ponto flutuante fazerem uma venda quitada parecer que ainda
 *    tem R$ 0,01 a receber.
 * 4. Comissão duplicar no Livro Caixa por causa de dois cliques.
 */

import {
  aplicarRecebimentos,
  arredondar,
  calcularComissao,
  confirmarParcela,
  despesaDaComissao,
  diasEmAberto,
  diasDeAtraso,
  entradaDaCondicao,
  idDespesaComissao,
  liquidoDaVenda,
  montarAReceber,
  montarPlano,
  normalizarVenda,
  paraBR,
  paraISO,
  planoDoOrcamento,
  receberParcialmente,
  recebimentosDa,
  situacaoDaVenda,
  textoDaCondicao,
  tocaOPeriodo,
  totalAReceber,
  totalDaVenda,
  totalRecebido,
  valorNoPeriodo,
} from "./recebimentos";
import type { Transacao } from "../types";

let passou = 0;
let falhou = 0;

function t(nome: string, condicao: boolean, detalhe?: unknown) {
  if (condicao) {
    passou++;
  } else {
    falhou++;
    console.error(`  ✗ ${nome}${detalhe !== undefined ? `\n      obtido: ${JSON.stringify(detalhe)}` : ""}`);
  }
}

function bloco(titulo: string) {
  console.log(`\n${titulo}`);
}

/* ==========================================================================
   1. DATAS — o bug que já custou caro neste projeto
   ========================================================================== */

bloco("Datas");

t("dd/mm/aaaa com dia acima de 12 não vira Invalid Date", paraISO("25/12/2026") === "2026-12-25", paraISO("25/12/2026"));
t("dia e mês não se invertem", paraISO("05/11/2026") === "2026-11-05", paraISO("05/11/2026"));
t("aaaa-mm-dd passa direto", paraISO("2026-08-18") === "2026-08-18");
t("ISO completo é cortado no dia", paraISO("2026-08-18T13:00:00.000Z") === "2026-08-18");
t("texto sem sentido devolve vazio, não NaN", paraISO("amanhã") === "");
t("vazio devolve vazio", paraISO(undefined) === "");
t("volta para o formato brasileiro", paraBR("2026-12-25") === "25/12/2026");

/* ==========================================================================
   2. VENDA ANTIGA — a base inteira que existia antes deste recurso
   ========================================================================== */

bloco("Venda antiga (sem nenhum campo novo)");

const antiga: Transacao = {
  id: "tx_1",
  tipo: "entrada",
  valor: 1200,
  data: "15/06/2026",
  descricao: "Consultoria UX",
  categoria: "Consultoria",
  clienteNome: "Alice Martins",
  formaPagamento: "Pix",
};

const antigaNorm = normalizarVenda(antiga);

t("continua valendo o mesmo no caixa", antigaNorm.valor === 1200, antigaNorm.valor);
t("o total da venda é o próprio valor", totalDaVenda(antiga) === 1200);
t("não tem nada a receber", totalAReceber(antiga) === 0);
t("aparece como quitada", situacaoDaVenda(antiga) === "quitada");
t("vira uma parcela única já recebida", recebimentosDa(antiga).length === 1 && recebimentosDa(antiga)[0].situacao === "recebido");
t("a parcela herda a forma de pagamento", recebimentosDa(antiga)[0].forma === "Pix");
t("normalizar não inventa campo novo no banco", antigaNorm.recebimentos === undefined && antigaNorm.valorTotal === undefined);
t("não entra na lista de a receber", montarAReceber([antiga]).linhas.length === 0);

const despesa: Transacao = {
  id: "tx_2", tipo: "saida", valor: 85, data: "12/06/2026",
  descricao: "Hospedagem", categoria: "Infraestrutura",
};
t("despesa passa intacta pela normalização", JSON.stringify(normalizarVenda(despesa)) === JSON.stringify(despesa));

/* ==========================================================================
   3. O CASO FOTOVOLTAICO — 50% agora, o resto sem data
   ========================================================================== */

bloco("Venda 50% + saldo sem data (o caso da Coelba)");

const plano = montarPlano({
  total: 30000,
  entrada: 15000,
  formaEntrada: "Pix",
  formaSaldo: "Boleto",
  dataEntrada: "18/08/2026",
  gatilhoSaldo: "Aprovação na Coelba",
});

let solar: Transacao = aplicarRecebimentos(
  {
    id: "tx_solar", tipo: "entrada", valor: 0, data: "18/08/2026",
    descricao: "Projeto fotovoltaico 8kWp", categoria: "Serviços Gerais",
    clienteNome: "Jonatan",
  },
  plano
);

t("gera duas linhas", plano.length === 2, plano.length);
t("o caixa recebe só a entrada", solar.valor === 15000, solar.valor);
t("o valor cheio fica guardado", solar.valorTotal === 30000, solar.valorTotal);
t("faltam 15 mil", totalAReceber(solar) === 15000);
t("situação é parcial", situacaoDaVenda(solar) === "parcial");
t("o saldo não tem previsão", solar.recebimentos![1].previsao === undefined);
t("o saldo guarda o gatilho no lugar da data", solar.recebimentos![1].gatilho === "Aprovação na Coelba");
t("o saldo sem previsão nunca conta como atraso", diasDeAtraso(solar.recebimentos![1], "30/09/2026") === 0);
t("mas conta os dias em aberto", diasEmAberto(solar, "27/09/2026") === 40, diasEmAberto(solar, "27/09/2026"));
t("aparece uma linha no painel a receber", montarAReceber([solar], "27/09/2026").total === 15000);

solar = confirmarParcela(solar, solar.recebimentos![1].id, { data: "28/09/2026", forma: "Pix" });

t("depois da baixa o caixa tem os 30 mil", solar.valor === 30000, solar.valor);
t("a venda fica quitada", situacaoDaVenda(solar) === "quitada");
t("nada mais a receber", totalAReceber(solar) === 0);
t("a data real do recebimento fica gravada", solar.recebimentos![1].dataRecebimento === "28/09/2026");
t("some do painel a receber", montarAReceber([solar]).linhas.length === 0);

const solarDeNovo = confirmarParcela(solar, solar.recebimentos![1].id, { data: "05/10/2026" });
t("confirmar duas vezes não soma de novo", solarDeNovo.valor === 30000, solarDeNovo.valor);
t("confirmar duas vezes não reescreve a data original", solarDeNovo.recebimentos![1].dataRecebimento === "28/09/2026");

/* ==========================================================================
   4. O INVARIANTE
   ========================================================================== */

bloco("Invariante valor === soma dos recebidos");

const casos: Transacao[] = [solar, antiga];
for (const tx of casos) {
  t(`invariante vale para ${tx.id}`, arredondar(tx.valor) === totalRecebido(tx), { valor: tx.valor, soma: totalRecebido(tx) });
}

const semEntrada = aplicarRecebimentos(
  { id: "tx_0", tipo: "entrada", valor: 999, data: "18/08/2026", descricao: "Fechado sem entrada", categoria: "Serviços Gerais" },
  montarPlano({ total: 5000, entrada: 0, gatilhoSaldo: "Entrega do material" })
);
t("venda fechada sem entrada zera o caixa", semEntrada.valor === 0, semEntrada.valor);
t("mas mantém o valor cheio", semEntrada.valorTotal === 5000);
t("e é classificada como aberta, não quitada", situacaoDaVenda(semEntrada) === "aberta");
t("uma linha só, aguardando", semEntrada.recebimentos!.length === 1 && semEntrada.recebimentos![0].situacao === "aguardando");

const tudoAgora = aplicarRecebimentos(
  { id: "tx_v", tipo: "entrada", valor: 0, data: "18/08/2026", descricao: "À vista", categoria: "Consultoria" },
  montarPlano({ total: 800, entrada: 800, formaEntrada: "Dinheiro" })
);
t("entrada igual ao total volta a ser venda à vista", tudoAgora.recebimentos === undefined && tudoAgora.valorTotal === undefined);
t("e o valor é o cheio", tudoAgora.valor === 800);
t("e a forma de pagamento sobe para a venda", tudoAgora.formaPagamento === "Dinheiro");

const entradaMaior = montarPlano({ total: 1000, entrada: 4000 });
t("entrada maior que o total não cria saldo negativo", entradaMaior.length === 1 && entradaMaior[0].valor === 1000);

/* ==========================================================================
   5. CENTAVOS
   ========================================================================== */

bloco("Centavos");

const tresPartes = aplicarRecebimentos(
  { id: "tx_c", tipo: "entrada", valor: 0, data: "01/08/2026", descricao: "x", categoria: "y" },
  [
    { id: "a", valor: 10.1, situacao: "recebido" },
    { id: "b", valor: 10.2, situacao: "recebido" },
    { id: "c", valor: 0.3, situacao: "recebido" },
  ]
);
t("soma de 10,10 + 10,20 + 0,30 dá exatamente 20,60", tresPartes.valor === 20.6, tresPartes.valor);

const quaseQuitada = aplicarRecebimentos(
  { id: "tx_q", tipo: "entrada", valor: 0, data: "01/08/2026", descricao: "x", categoria: "y" },
  [
    { id: "a", valor: 0.1, situacao: "recebido" },
    { id: "b", valor: 0.2, situacao: "recebido" },
  ]
);
t("venda quitada não sobra centavo fantasma", totalAReceber(quaseQuitada) === 0, totalAReceber(quaseQuitada));
t("e é reconhecida como quitada", situacaoDaVenda(quaseQuitada) === "quitada");

/* ==========================================================================
   6. RECEBIMENTO PARCIAL
   ========================================================================== */

bloco("Recebimento parcial");

let parcial = aplicarRecebimentos(
  { id: "tx_p", tipo: "entrada", valor: 0, data: "01/07/2026", descricao: "Obra", categoria: "Serviços Gerais" },
  montarPlano({ total: 30000, entrada: 15000, dataEntrada: "01/07/2026" })
);
const idSaldo = parcial.recebimentos![1].id;
parcial = receberParcialmente(parcial, idSaldo, 10000, { data: "10/08/2026", forma: "Pix" });

t("o caixa sobe só o que caiu", parcial.valor === 25000, parcial.valor);
t("o total da venda não muda", parcial.valorTotal === 30000, parcial.valorTotal);
t("sobram 5 mil a receber", totalAReceber(parcial) === 5000);
t("virou três linhas", parcial.recebimentos!.length === 3, parcial.recebimentos!.length);
t("continua parcial", situacaoDaVenda(parcial) === "parcial");
t("o resto perdeu o gatilho antigo? não, o restante mantém o combinado", parcial.recebimentos![2].situacao === "aguardando");

/* ==========================================================================
   7. PERÍODO — a distorção que o parcelamento causaria no relatório
   ========================================================================== */

bloco("Valor por período");

const julhoAgosto = valorNoPeriodo(parcial, "2026-07-01", "2026-07-31");
t("julho recebe só a entrada", julhoAgosto === 15000, julhoAgosto);
t("agosto recebe só o pagamento parcial", valorNoPeriodo(parcial, "2026-08-01", "2026-08-31") === 10000);
t("sem período, é tudo o que entrou", valorNoPeriodo(parcial) === 25000);
t("venda antiga responde como sempre respondeu", valorNoPeriodo(antiga, "2026-06-01", "2026-06-30") === 1200);
t("venda antiga fora do período dá zero", valorNoPeriodo(antiga, "2026-07-01", "2026-07-31") === 0);
t("despesa continua valendo pela data do lançamento", valorNoPeriodo(despesa, "2026-06-01", "2026-06-30") === 85);
t("a venda aparece na lista de agosto mesmo tendo sido feita em julho", tocaOPeriodo(parcial, "2026-08-01", "2026-08-31"));
t("e continua aparecendo na lista de julho", tocaOPeriodo(parcial, "2026-07-01", "2026-07-31"));
t("mas não aparece em setembro", !tocaOPeriodo(parcial, "2026-09-01", "2026-09-30"));

/* ==========================================================================
   8. COMISSÃO
   ========================================================================== */

bloco("Comissão");

const com10 = calcularComissao(
  { beneficiario: "Carlos", base: "percentual", percentual: 10, sobre: "total" },
  { total: 30000, recebido: 15000 }
);
t("10% de 30 mil dá 3 mil", com10?.valor === 3000, com10?.valor);
t("nasce como a pagar", com10?.situacao === "aPagar");
t("guarda o percentual para a tela explicar", com10?.percentual === 10);

const comRecebido = calcularComissao(
  { beneficiario: "Carlos", base: "percentual", percentual: 10, sobre: "recebido" },
  { total: 30000, recebido: 15000 }
);
t("sobre o recebido, incide só sobre o que entrou", comRecebido?.valor === 1500, comRecebido?.valor);

const comFixo = calcularComissao(
  { beneficiario: "Indicação do Pedro", base: "fixo", valorFixo: 250 },
  { total: 30000, recebido: 15000 }
);
t("valor fixo é respeitado", comFixo?.valor === 250);

t("sem beneficiário não existe comissão", calcularComissao({ beneficiario: "  ", base: "fixo", valorFixo: 100 }, { total: 1, recebido: 1 }) === undefined);
t("comissão de zero não é gravada", calcularComissao({ beneficiario: "Carlos", base: "percentual", percentual: 0 }, { total: 1000, recebido: 0 }) === undefined);
t("percentual sem número não vira NaN", calcularComissao({ beneficiario: "Carlos", base: "percentual" }, { total: 1000, recebido: 0 }) === undefined);

t("margem líquida desconta a comissão", liquidoDaVenda(30000, com10) === 27000);
t("margem sem comissão é o total", liquidoDaVenda(30000, undefined) === 30000);

const vendaComissionada: Transacao = { ...solar, comissao: { ...(com10 as any), dataPagamento: "01/10/2026" } };
const d1 = despesaDaComissao(vendaComissionada, vendaComissionada.comissao!);
const d2 = despesaDaComissao(vendaComissionada, vendaComissionada.comissao!);
t("a despesa da comissão tem id determinístico", d1.id === d2.id && d1.id === idDespesaComissao("tx_solar"), d1.id);
t("é uma saída", d1.tipo === "saida" && d1.valor === 3000);
t("usa a data em que foi paga", d1.data === "01/10/2026");
t("aponta de volta para a venda", d1.vendaOrigemId === "tx_solar");
t("cai numa categoria própria", d1.categoria === "Comissões");

/* ==========================================================================
   9. ORÇAMENTO → VENDA
   ========================================================================== */

bloco("Condição de pagamento do orçamento");

t("50% de 30 mil", entradaDaCondicao(30000, { entradaPercentual: 50 }) === 15000);
t("entrada em valor fechado tem prioridade", entradaDaCondicao(30000, { entradaPercentual: 50, entradaValor: 8000 }) === 8000);
t("entrada maior que o total é aparada", entradaDaCondicao(1000, { entradaValor: 9999 }) === 1000);
t("sem condição, é tudo à vista", entradaDaCondicao(1000, undefined) === 1000);

const planoOrc = planoDoOrcamento(30000, { entradaPercentual: 40, formaEntrada: "Pix", gatilhoSaldo: "Aprovação na Coelba" });
t("gera duas parcelas", planoOrc.length === 2);
t("40% de entrada", planoOrc[0].valor === 12000);
t("⚠️ NENHUMA nasce recebida: aceitar proposta não é receber", planoOrc.every((p) => p.situacao === "aguardando"));

const orcVirouVenda = aplicarRecebimentos(
  { id: "tx_orc", tipo: "entrada", valor: 0, data: "18/08/2026", descricao: "Orçamento nº 7", categoria: "Serviços Gerais" },
  planoOrc
);
t("a venda do orçamento aceito nasce com caixa zero", orcVirouVenda.valor === 0, orcVirouVenda.valor);
t("e com o valor cheio guardado", orcVirouVenda.valorTotal === 30000);

const frase = textoDaCondicao(30000, { entradaPercentual: 50, formaEntrada: "Pix", formaSaldo: "Boleto", gatilhoSaldo: "aprovação na concessionária" });
t("a frase da proposta cita entrada, percentual e gatilho", /50%/.test(frase) && /aprovação na concessionária/.test(frase), frase);
t("à vista tem frase própria", /à vista/i.test(textoDaCondicao(1000, { entradaPercentual: 100, formaEntrada: "Pix" })));

/* ==========================================================================
   10. PAINEL A RECEBER — a ordem importa
   ========================================================================== */

bloco("Painel a receber");

const atrasada = aplicarRecebimentos(
  { id: "tx_atr", tipo: "entrada", valor: 0, data: "01/08/2026", descricao: "A prazo", categoria: "Serviços Gerais" },
  montarPlano({ total: 1000, entrada: 0, previsaoSaldo: "10/08/2026" })
);
const semPrevisao = aplicarRecebimentos(
  { id: "tx_sp", tipo: "entrada", valor: 0, data: "01/07/2026", descricao: "Coelba", categoria: "Serviços Gerais" },
  montarPlano({ total: 2000, entrada: 0, gatilhoSaldo: "Aprovação" })
);

const painel = montarAReceber([semPrevisao, atrasada], "18/08/2026");
t("soma tudo que falta entrar", painel.total === 3000, painel.total);
t("o atrasado com data vem primeiro", painel.linhas[0].venda.id === "tx_atr", painel.linhas.map((l) => l.venda.id));
t("o atraso é contado da previsão", painel.linhas[0].diasDeAtraso === 8, painel.linhas[0].diasDeAtraso);
t("o sem previsão não acusa atraso", painel.linhas[1].diasDeAtraso === 0);
t("mas mostra 48 dias em aberto", painel.linhas[1].diasEmAberto === 48, painel.linhas[1].diasEmAberto);

/* ========================================================================== */

console.log(`\n${falhou === 0 ? "✓" : "✗"} ${passou} passaram, ${falhou} falharam\n`);
if (falhou > 0) process.exit(1);
