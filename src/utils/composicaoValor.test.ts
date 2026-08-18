/**
 * ============================================================================
 * TESTES — MATERIAL E FORNECEDOR
 * ============================================================================
 * Rodar: npx tsx src/utils/composicaoValor.test.ts
 *
 * O que precisa continuar verdade, em ordem de gravidade:
 * 1. Repasse ativo tira o material do que entra no seu caixa — é o motivo do
 *    recurso existir: aquele dinheiro nunca foi seu.
 * 2. Sem repasse, o valor cheio é seu — o material, se você comprou, é uma
 *    despesa comum, não um desconto na receita.
 * 3. Orçamento sem material nunca muda de comportamento: composição vazia,
 *    itens intactos no PDF, nada de novo na tela.
 */

import {
  composicaoDosItens,
  temMaterial,
  valorParaCaixa,
  itensParaExibir,
  textoComposicao,
  custoMaterialDaVenda,
  margemComMaterial,
} from "./composicaoValor";
import type { ItemOrcamento, Transacao } from "../types";

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

const item = (p: Partial<ItemOrcamento>): ItemOrcamento => ({
  id: p.id || "it_x",
  tipo: p.tipo || "serviço",
  nome: p.nome || "Item",
  quantidade: p.quantidade ?? 1,
  valorUnitario: p.valorUnitario ?? 0,
});

/* ========================================================================== */
bloco("composicaoDosItens");

t("orçamento só de serviço: material zerado", (() => {
  const c = composicaoDosItens([item({ tipo: "serviço", valorUnitario: 5000 })]);
  return c.servico === 5000 && c.material === 0;
})());

t("orçamento misto soma cada tipo separadamente", (() => {
  const c = composicaoDosItens([
    item({ tipo: "serviço", valorUnitario: 5000 }),
    item({ tipo: "produto", quantidade: 12, valorUnitario: 2000 }),
  ]);
  return c.servico === 5000 && c.material === 24000;
})(), composicaoDosItens([item({ tipo: "serviço", valorUnitario: 5000 }), item({ tipo: "produto", quantidade: 12, valorUnitario: 2000 })]));

t("sem itens não quebra", (() => {
  const c = composicaoDosItens(undefined);
  return c.servico === 0 && c.material === 0;
})());

t("temMaterial só é verdade quando há produto", !temMaterial({ servico: 100, material: 0 }) && temMaterial({ servico: 100, material: 1 }));

/* ========================================================================== */
bloco("valorParaCaixa — o coração do repasse");

t("sem repasse, o valor cheio é seu", valorParaCaixa(30000, { servico: 5000, material: 25000 }, undefined) === 30000);
t("repasse ativo, só o serviço é seu", valorParaCaixa(30000, { servico: 5000, material: 25000 }, { ativo: true, fornecedorNome: "Fulano" }) === 5000);
t("repasse marcado mas inativo não muda nada", valorParaCaixa(30000, { servico: 5000, material: 25000 }, { ativo: false, fornecedorNome: "Fulano" }) === 30000);
t("sem composição, repasse ativo cai no total (nunca quebra)", valorParaCaixa(10000, undefined, { ativo: true, fornecedorNome: "X" }) === 10000);

/* ========================================================================== */
bloco("itensParaExibir — o que o cliente vê no PDF");

const itensMistos = [
  item({ id: "s1", tipo: "serviço", nome: "Instalação", valorUnitario: 5000 }),
  item({ id: "p1", tipo: "produto", nome: "Placas solares", quantidade: 12, valorUnitario: 2000 }),
];

t("mostrarComposicao ausente mantém os itens como estão (comportamento de sempre)", itensParaExibir(itensMistos, undefined) === itensMistos);
t("mostrarComposicao true mantém os itens", itensParaExibir(itensMistos, true) === itensMistos);
t("mostrarComposicao false consolida numa linha só com o total", (() => {
  const r = itensParaExibir(itensMistos, false);
  return r.length === 1 && r[0].valorUnitario === 29000;
})(), itensParaExibir(itensMistos, false));

const itensSoServico = [item({ tipo: "serviço", valorUnitario: 5000 })];
t("orçamento só de serviço nunca consolida, mesmo com mostrarComposicao false", itensParaExibir(itensSoServico, false) === itensSoServico);

/* ========================================================================== */
bloco("textoComposicao");

t("sem repasse, texto simples", !textoComposicao({ servico: 5000, material: 25000 }).includes("repassado"));
t("com repasse, cita o fornecedor", textoComposicao({ servico: 5000, material: 25000 }, { ativo: true, fornecedorNome: "Fulano Energia" }).includes("Fulano Energia"));

/* ========================================================================== */
bloco("Custo de material vinculado e margem");

const despesas: Transacao[] = [
  { id: "d1", tipo: "saida", valor: 2000, data: "10/08/2026", descricao: "Fio e disjuntores", categoria: "Materiais", vendaOrigemId: "v1", origemTipo: "material" },
  { id: "d2", tipo: "saida", valor: 500, data: "10/08/2026", descricao: "Comissão", categoria: "Comissões", vendaOrigemId: "v1", origemTipo: "comissao" },
  { id: "d3", tipo: "saida", valor: 300, data: "10/08/2026", descricao: "Material de outra venda", categoria: "Materiais", vendaOrigemId: "v2", origemTipo: "material" },
];

t("soma só as despesas de material desta venda", custoMaterialDaVenda("v1", despesas) === 2000);
t("não confunde despesa de comissão com despesa de material", custoMaterialDaVenda("v1", despesas) !== 2500);
t("venda sem despesa vinculada dá zero", custoMaterialDaVenda("v3", despesas) === 0);

t("margem desconta comissão e material do que entrou", margemComMaterial(10000, 1000, 2000) === 7000);
t("margem sem comissão nem custo é o próprio total recebido", margemComMaterial(10000, undefined, 0) === 10000);

console.log(`\n${falhou === 0 ? "✓" : "✗"} ${passou} passaram, ${falhou} falharam\n`);
if (falhou > 0) process.exit(1);
