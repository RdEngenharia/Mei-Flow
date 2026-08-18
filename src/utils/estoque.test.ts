/**
 * ============================================================================
 * TESTES DO ESTOQUE
 * ============================================================================
 * Rodar: npx tsx src/utils/estoque.test.ts
 *
 * O que precisa continuar verdade, em ordem de gravidade:
 * 1. O custo médio pondera direito quando chega material por preço diferente.
 * 2. Uma saída usa o custo médio do MOMENTO, e ele fica congelado depois.
 * 3. Saldo pode ficar negativo — não é bug, é a baixa acontecendo antes da
 *    entrada ser lançada.
 * 4. O relatório por cliente soma certo e nunca mistura a venda errada.
 */

import {
  criarItemEstoque,
  registrarEntrada,
  registrarSaida,
  removerUltimoMovimento,
  estoqueSuficiente,
  valorEmEstoque,
  valorTotalEstoque,
  itensComEstoqueBaixo,
  buscarItens,
  baixasNoPeriodo,
  totalBaixasPorCliente,
  custoMaterialDaVenda,
} from "./estoque";
import type { ItemEstoque } from "../types";

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
bloco("Criar item");

const vazio = criarItemEstoque({ nome: "Disjuntor 20A", unidade: "un" });
t("nasce zerado", vazio.quantidadeAtual === 0 && vazio.custoMedio === 0 && vazio.movimentos.length === 0);
t("nome sem espaço nas pontas", criarItemEstoque({ nome: "  Cabo 2.5mm  ", unidade: "m" }).nome === "Cabo 2.5mm");

/* ========================================================================== */
bloco("Entrada — custo médio ponderado");

let item = criarItemEstoque({ nome: "Disjuntor 20A", unidade: "un" });
item = registrarEntrada(item, { quantidade: 10, custoUnitario: 20, data: "01/08/2026" });
t("primeira compra: quantidade e custo médio batem com o que foi pago", item.quantidadeAtual === 10 && item.custoMedio === 20);

item = registrarEntrada(item, { quantidade: 10, custoUnitario: 30, data: "05/08/2026" });
// (10*20 + 10*30) / 20 = 25
t("segunda compra por preço diferente pondera certo", item.quantidadeAtual === 20 && item.custoMedio === 25, item);
t("cada entrada vira uma movimentação", item.movimentos.filter((m) => m.tipo === "entrada").length === 2);
t("entrada de quantidade zero ou negativa não faz nada", registrarEntrada(item, { quantidade: 0, custoUnitario: 10 }).movimentos.length === item.movimentos.length);

/* ========================================================================== */
bloco("Saída — consumo por cliente");

let saida = registrarSaida(item, { quantidade: 4, clienteId: "c1", clienteNome: "Carlos", vendaId: "v1", data: "10/08/2026" });
t("desconta a quantidade", saida.quantidadeAtual === 16);
t("usa o custo médio do momento (25), não o preço de nenhuma compra específica", saida.movimentos.at(-1)?.custoUnitario === 25);
t("valor total da baixa é quantidade × custo médio", saida.movimentos.at(-1)?.valorTotal === 100);
t("guarda o cliente e a venda", saida.movimentos.at(-1)?.clienteId === "c1" && saida.movimentos.at(-1)?.vendaId === "v1");

// Uma entrada depois da saída não deve mudar o custo já congelado na saída anterior.
let comNovaEntrada = registrarEntrada(saida, { quantidade: 10, custoUnitario: 100, data: "15/08/2026" });
t("custo da saída antiga não muda quando chega uma entrada nova", comNovaEntrada.movimentos.find((m) => m.tipo === "saida")?.custoUnitario === 25);

t("saída de quantidade zero não faz nada", registrarSaida(item, { quantidade: 0 }).movimentos.length === item.movimentos.length);

t("estoqueSuficiente diz a verdade antes de baixar", estoqueSuficiente(item, 20) && !estoqueSuficiente(item, 21));

/* ========================================================================== */
bloco("Entrada — frete rateado no custo médio");

let itemFrete = criarItemEstoque({ nome: "Cabo 4mm", unidade: "m" });
itemFrete = registrarEntrada(itemFrete, { quantidade: 10, custoUnitario: 20, frete: 50, data: "01/08/2026" });
// custo total = 10*20 + 50 = 250 → 25/un
t("frete entra no custo por unidade", itemFrete.quantidadeAtual === 10 && itemFrete.custoMedio === 25, itemFrete);
t("guarda o frete desta compra na movimentação", itemFrete.movimentos.at(-1)?.frete === 50);
t("valorTotal do movimento inclui o frete", itemFrete.movimentos.at(-1)?.valorTotal === 250);
t("custoUnitario do movimento já vem com o frete embutido", itemFrete.movimentos.at(-1)?.custoUnitario === 25);

itemFrete = registrarEntrada(itemFrete, { quantidade: 10, custoUnitario: 20, data: "05/08/2026" });
// (10*25 + 10*20) / 20 = 22.5 — segunda compra sem frete não carrega o frete da primeira
t("compra seguinte sem frete não herda o frete da anterior", itemFrete.custoMedio === 22.5, itemFrete);
t("movimento sem frete não guarda o campo", itemFrete.movimentos.at(-1)?.frete === undefined);

let semFrete = registrarEntrada(criarItemEstoque({ nome: "Parafuso", unidade: "un" }), { quantidade: 5, custoUnitario: 10, frete: 0 });
t("frete zero é o mesmo que sem frete", semFrete.custoMedio === 10 && semFrete.movimentos.at(-1)?.frete === undefined);

let saldoNegativo = registrarSaida(item, { quantidade: 999, clienteNome: "Cliente ansioso" });
t("saldo pode ficar negativo — é a verdade, não um bug escondido", saldoNegativo.quantidadeAtual < 0, saldoNegativo.quantidadeAtual);

/* ========================================================================== */
bloco("Desfazer o último lançamento");

t("item sem movimentação nenhuma não quebra (no-op)", removerUltimoMovimento(criarItemEstoque({ nome: "X", unidade: "un" })).movimentos.length === 0);

// Duas entradas por preço diferente, desfazer a última volta exatamente à primeira.
let desfazer = criarItemEstoque({ nome: "Disjuntor", unidade: "un" });
desfazer = registrarEntrada(desfazer, { quantidade: 10, custoUnitario: 20 });
desfazer = registrarEntrada(desfazer, { quantidade: 10, custoUnitario: 30 });
t("antes de desfazer: pesou as duas (25)", desfazer.custoMedio === 25);
desfazer = removerUltimoMovimento(desfazer);
t("desfazer a última entrada volta exatamente ao estado da primeira", desfazer.quantidadeAtual === 10 && desfazer.custoMedio === 20 && desfazer.movimentos.length === 1, desfazer);

// Desfazer uma saída só devolve a quantidade — custo médio não muda.
desfazer = registrarSaida(desfazer, { quantidade: 4, clienteNome: "Carlos" });
t("saída desconta", desfazer.quantidadeAtual === 6);
desfazer = removerUltimoMovimento(desfazer);
t("desfazer a saída devolve a quantidade sem mexer no custo médio", desfazer.quantidadeAtual === 10 && desfazer.custoMedio === 20 && desfazer.movimentos.length === 1, desfazer);

// Desfazer a única entrada que existe zera tudo — não pode sobrar custo médio "fantasma".
t("desfazer a única entrada zera quantidade e custo médio", removerUltimoMovimento(desfazer).quantidadeAtual === 0 && removerUltimoMovimento(desfazer).custoMedio === 0);

// Com frete: desfazer precisa reverter o custo médio JÁ COM o frete embutido, não o custoUnitario digitado puro.
let desfazerFrete = criarItemEstoque({ nome: "Cabo 4mm", unidade: "m" });
desfazerFrete = registrarEntrada(desfazerFrete, { quantidade: 10, custoUnitario: 20 }); // custoMedio 20
desfazerFrete = registrarEntrada(desfazerFrete, { quantidade: 10, custoUnitario: 20, frete: 50 }); // (200+250)/20 = 22.5
t("com frete embutido: custo médio pondera certo antes de desfazer", desfazerFrete.custoMedio === 22.5, desfazerFrete);
desfazerFrete = removerUltimoMovimento(desfazerFrete);
t("desfazer a entrada com frete volta exatamente ao estado sem ela", desfazerFrete.quantidadeAtual === 10 && desfazerFrete.custoMedio === 20, desfazerFrete);

/* ========================================================================== */
bloco("Valor em estoque");

t("valor do item é quantidade × custo médio", valorEmEstoque(item) === item.quantidadeAtual * item.custoMedio);

const outroItem = registrarEntrada(criarItemEstoque({ nome: "Cabo 2.5mm", unidade: "m" }), { quantidade: 100, custoUnitario: 2 });
t("valor total do estoque soma todos os itens", valorTotalEstoque([item, outroItem]) === valorEmEstoque(item) + valorEmEstoque(outroItem));

/* ========================================================================== */
bloco("Estoque baixo e busca");

const comMinimo = { ...criarItemEstoque({ nome: "Fita isolante", unidade: "un", estoqueMinimo: 5 }), quantidadeAtual: 3 };
const semMinimo = { ...criarItemEstoque({ nome: "Parafuso", unidade: "un" }), quantidadeAtual: 1 };
t("só entra quem tem mínimo definido e está no limite ou abaixo", itensComEstoqueBaixo([comMinimo, semMinimo]).length === 1);

t("busca ignora maiúscula/minúscula", buscarItens([item, outroItem], "disjuntor").length === 1);
t("busca vazia devolve tudo", buscarItens([item, outroItem], "").length === 2);
t("busca sem resultado devolve lista vazia", buscarItens([item, outroItem], "xyz123").length === 0);

/* ========================================================================== */
bloco("Relatório — baixas por período e por cliente");

const itensRelatorio: ItemEstoque[] = [
  registrarSaida(
    registrarSaida(
      registrarEntrada(criarItemEstoque({ nome: "Disjuntor", unidade: "un" }), { quantidade: 50, custoUnitario: 10 }),
      { quantidade: 5, clienteId: "c1", clienteNome: "Carlos", vendaId: "v1", data: "05/08/2026" }
    ),
    { quantidade: 3, clienteId: "c2", clienteNome: "Maria", data: "10/08/2026" }
  ),
];

const todasBaixas = baixasNoPeriodo(itensRelatorio);
t("pega as duas baixas quando não filtra período", todasBaixas.length === 2);
t("mais recente vem primeiro", todasBaixas[0]?.movimento.clienteNome === "Maria");

const soAgosto5 = baixasNoPeriodo(itensRelatorio, "2026-08-05", "2026-08-05");
t("filtro de período pega só o dia certo", soAgosto5.length === 1 && soAgosto5[0].movimento.clienteNome === "Carlos");

const porCliente = totalBaixasPorCliente(todasBaixas);
t("agrupa por cliente com o total certo", porCliente.find((c) => c.clienteNome === "Carlos")?.total === 50);
t("maior valor vem primeiro", porCliente[0]?.clienteNome === "Carlos");

t("custo do material de uma venda soma só as baixas daquela venda", custoMaterialDaVenda("v1", itensRelatorio) === 50);
t("venda sem baixa vinculada dá zero", custoMaterialDaVenda("v_inexistente", itensRelatorio) === 0);

console.log(`\n${falhou === 0 ? "✓" : "✗"} ${passou} passaram, ${falhou} falharam\n`);
if (falhou > 0) process.exit(1);
