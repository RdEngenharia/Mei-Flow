/**
 * ============================================================================
 * MATERIAL E FORNECEDOR — repasse direto e material comprado por você
 * ============================================================================
 *
 * O PEDIDO
 *
 * Projeto fotovoltaico onde parte do orçamento é material que o fornecedor
 * fatura e recebe direto do cliente — o dinheiro nunca passa pela sua mão.
 * Você só presta o serviço e manda uma nota de serviço PARA O FORNECEDOR, que
 * é quem te paga. Por outro lado, existe o caso oposto: você compra o
 * material (ex.: instalação elétrica) e revende embutido no serviço — aí o
 * cliente paga tudo a você, e o material vira só mais uma despesa sua.
 *
 * A DIFERENÇA QUE TUDO DEPENDE
 *
 *   Repasse ativo    → só o SERVIÇO é seu dinheiro. O material nunca entra
 *                       nem sai do seu Livro Caixa, e a nota fiscal deve ir
 *                       para o fornecedor, não para o cliente.
 *   Repasse inativo  → o valor CHEIO é seu dinheiro (o cliente te paga tudo).
 *                       O material, se você comprou, é uma despesa comum —
 *                       linkável a esta venda para enxergar a margem líquida.
 *
 * DE ONDE VEM A COMPOSIÇÃO
 *
 * No orçamento, cada item já tem um `tipo`: "produto" ou "serviço" — não
 * inventamos um campo novo, só somamos o que já existe. `composicaoDosItens`
 * é a única fonte dessa conta; ninguém deve somar itens por tipo em outro
 * lugar do código.
 *
 * A venda gerada a partir do orçamento não guarda `itens` (só o orçamento
 * guarda), então ela recebe uma FOTOGRAFIA da composição no momento da
 * conversão — ver `App.tsx`, `converterOrcamentoEmVenda`. Numa venda lançada
 * na mão (fora do funil), a composição vem direto do formulário.
 */

import type {
  ComposicaoValor,
  ItemOrcamento,
  RepasseFornecedor,
  Transacao,
} from "../types";

const arredondar = (n: unknown): number => Math.round((Number(n) || 0) * 100) / 100;

const emReais = (n: number) =>
  arredondar(n).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

/**
 * Soma os itens de um orçamento por tipo. É a ÚNICA fonte da divisão
 * material/serviço — o orçamento não guarda esse número, ele é sempre
 * recalculado dos itens, para nunca desalinhar de quem edita a lista.
 */
export function composicaoDosItens(itens?: ItemOrcamento[] | null): ComposicaoValor {
  const lista = itens || [];
  const soma = (tipo: "produto" | "serviço") =>
    arredondar(
      lista
        .filter((it) => it?.tipo === tipo)
        .reduce((s, it) => s + (Number(it.quantidade) || 0) * (Number(it.valorUnitario) || 0), 0)
    );
  return { servico: soma("serviço"), material: soma("produto") };
}

/** Só faz sentido falar em "composição" quando o orçamento realmente mistura os dois. */
export function temMaterial(c?: ComposicaoValor | null): boolean {
  return !!c && arredondar(c.material) > 0;
}

/**
 * Quanto desta venda deveria entrar no SEU Livro Caixa.
 *
 * Repasse ativo exclui o material por completo — aquele dinheiro nunca foi
 * seu, o fornecedor faturou e recebeu direto do cliente. Sem repasse, o valor
 * cheio é seu (o material, se houver, foi comprado e revendido por você).
 */
export function valorParaCaixa(
  total: number,
  composicao?: ComposicaoValor | null,
  repasse?: RepasseFornecedor | null
): number {
  if (repasse?.ativo && composicao) return arredondar(composicao.servico);
  return arredondar(total);
}

/**
 * Os itens que o CLIENTE vê no PDF/impressão da proposta.
 *
 * `mostrarComposicao === false` consolida tudo numa linha só, com o valor
 * total — é o "o cliente vê só o valor do serviço" que motivou este recurso.
 * Em qualquer outro caso (ausente, `true`, ou orçamento sem material) devolve
 * os itens como estão: o comportamento de sempre, sem mudar uma proposta que
 * já existia antes deste recurso.
 */
export function itensParaExibir(
  itens: ItemOrcamento[],
  mostrarComposicao: boolean | undefined,
  rotuloConsolidado = "Serviço prestado"
): ItemOrcamento[] {
  const composicao = composicaoDosItens(itens);
  if (mostrarComposicao !== false || !temMaterial(composicao)) return itens;

  const total = arredondar(composicao.servico + composicao.material);
  return [
    {
      id: "consolidado",
      tipo: "serviço",
      nome: rotuloConsolidado,
      quantidade: 1,
      valorUnitario: total,
    },
  ];
}

/** Frase curta para telas internas (nunca sai no PDF do cliente). */
export function textoComposicao(c: ComposicaoValor, repasse?: RepasseFornecedor | null): string {
  const base = `Serviço: ${emReais(c.servico)} · Material: ${emReais(c.material)}`;
  if (repasse?.ativo) {
    const quem = repasse.fornecedorNome?.trim() || "o fornecedor";
    return `${base} (repassado a ${quem} — não entra no seu caixa)`;
  }
  return base;
}

/** Soma das despesas de compra de material vinculadas a uma venda. */
export function custoMaterialDaVenda(vendaId: string, despesas: Transacao[]): number {
  return arredondar(
    (despesas || [])
      .filter((d) => d?.tipo === "saida" && d.vendaOrigemId === vendaId && d.origemTipo === "material")
      .reduce((s, d) => s + (Number(d.valor) || 0), 0)
  );
}

/**
 * Margem líquida real de uma venda com material comprado por você: o que
 * entrou, menos a comissão (se houver) e menos o custo do material vinculado.
 */
export function margemComMaterial(
  totalRecebido: number,
  comissaoValor: number | undefined,
  custoMaterial: number
): number {
  return arredondar(arredondar(totalRecebido) - arredondar(comissaoValor) - arredondar(custoMaterial));
}
