/**
 * ============================================================================
 * ESTOQUE — compra, consumo por cliente, e quanto vale o que sobrou
 * ============================================================================
 *
 * O PROBLEMA QUE ORIGINOU ESTE ARQUIVO
 *
 * Comprar material para uma instalação (elétrica, fotovoltaica, o que for),
 * guardar no estoque, e dar baixa conforme usa em cada cliente — sabendo a
 * qualquer momento quanto tem de cada item e quanto isso vale em dinheiro
 * parado, sem ter que abrir nota por nota para lembrar o preço.
 *
 * O INVARIANTE
 *
 *   quantidadeAtual e custoMedio são sempre a CONSEQUÊNCIA de `movimentos` —
 *   nunca um número editado solto. Só `registrarEntrada` e `registrarSaida`
 *   têm permissão de mexer nos dois, do mesmo jeito que `aplicarRecebimentos`
 *   (utils/recebimentos.ts) é a única função que escreve `valor` numa venda.
 *
 * CUSTO MÉDIO PONDERADO
 *
 *   Cada compra pode vir por um preço diferente. Em vez de guardar um preço
 *   por lote (complexo demais para o que um MEI precisa), este arquivo usa
 *   custo médio ponderado: toda entrada mistura o valor do que já tinha com o
 *   valor do que chegou, na proporção da quantidade de cada um. Uma saída
 *   usa esse custo médio do MOMENTO — e ele fica congelado na movimentação,
 *   então o histórico não muda de valor se o custo médio mudar depois.
 */

import type { ItemEstoque, MovimentoEstoque, UnidadeEstoque } from "../types";
import { arredondar, hojeBR, paraISO } from "./recebimentos";

let contador = 0;
/** Id de movimentação/item. Não usa só o relógio: dois cliques no mesmo milissegundo colidiam. */
function novoId(prefixo: string): string {
  contador += 1;
  return `${prefixo}_${Date.now().toString(36)}_${contador.toString(36)}`;
}

export function novoIdMovimento(): string {
  return novoId("mv");
}

/* ==========================================================================
   CRIAR E LER
   ========================================================================== */

export type NovoItemInfo = {
  nome: string;
  unidade: UnidadeEstoque;
  categoria?: string;
  estoqueMinimo?: number;
};

/** Um item novo, sempre zerado — a quantidade e o custo nascem das movimentações. */
export function criarItemEstoque(info: NovoItemInfo): ItemEstoque {
  return {
    id: novoId("it_estoque"),
    nome: info.nome.trim(),
    unidade: info.unidade,
    categoria: info.categoria?.trim() || undefined,
    estoqueMinimo: typeof info.estoqueMinimo === "number" && info.estoqueMinimo > 0 ? info.estoqueMinimo : undefined,
    quantidadeAtual: 0,
    custoMedio: 0,
    movimentos: [],
    createdAt: new Date().toISOString(),
  };
}

/** Quanto este item vale hoje, parado no estoque. */
export function valorEmEstoque(item: ItemEstoque): number {
  return arredondar(item.quantidadeAtual * item.custoMedio);
}

/** Quanto TODO o estoque vale hoje. */
export function valorTotalEstoque(itens: ItemEstoque[]): number {
  return arredondar((itens || []).reduce((s, i) => s + valorEmEstoque(i), 0));
}

/* ==========================================================================
   ENTRADA — a compra
   ========================================================================== */

export type EntradaInfo = {
  quantidade: number;
  /** O que foi pago por unidade nesta compra. */
  custoUnitario: number;
  /** dd/mm/aaaa — hoje se ausente. */
  data?: string;
  observacao?: string;
};

/**
 * ⚠️ UMA DAS DUAS FUNÇÕES QUE PODEM ESCREVER `quantidadeAtual`/`custoMedio`.
 *
 * Recalcula o custo médio ponderado e soma a quantidade. Chame sempre que
 * registrar uma compra — nunca some `quantidadeAtual` direto.
 */
export function registrarEntrada(item: ItemEstoque, info: EntradaInfo): ItemEstoque {
  const quantidade = arredondar(info.quantidade);
  const custoUnitario = arredondar(info.custoUnitario);
  if (quantidade <= 0) return item;

  const custoTotalAntigo = item.quantidadeAtual * item.custoMedio;
  const custoTotalNovo = quantidade * custoUnitario;
  const quantidadeAtual = arredondar(item.quantidadeAtual + quantidade);
  const custoMedio = quantidadeAtual > 0 ? arredondar((custoTotalAntigo + custoTotalNovo) / quantidadeAtual) : 0;

  const movimento: MovimentoEstoque = {
    id: novoIdMovimento(),
    tipo: "entrada",
    quantidade,
    data: info.data || hojeBR(),
    custoUnitario,
    valorTotal: arredondar(custoTotalNovo),
    observacao: info.observacao?.trim() || undefined,
  };

  return {
    ...item,
    quantidadeAtual,
    custoMedio,
    movimentos: [...item.movimentos, movimento],
    atualizadoEm: new Date().toISOString(),
  };
}

/* ==========================================================================
   SAÍDA — o consumo numa instalação
   ========================================================================== */

export type SaidaInfo = {
  quantidade: number;
  /** dd/mm/aaaa — hoje se ausente. */
  data?: string;
  clienteId?: string;
  clienteNome?: string;
  /** A venda que este consumo abasteceu, quando existir. */
  vendaId?: string;
  observacao?: string;
};

/** Há saldo suficiente para esta baixa? Só um aviso para a tela — a função de baixa não trava sozinha. */
export function estoqueSuficiente(item: ItemEstoque, quantidade: number): boolean {
  return item.quantidadeAtual >= arredondar(quantidade);
}

/**
 * ⚠️ A OUTRA FUNÇÃO QUE PODE ESCREVER `quantidadeAtual`.
 *
 * Usa o custo médio ATUAL do item e o congela na movimentação. Permite saldo
 * negativo de propósito — ver o comentário grande no topo do arquivo: é a
 * verdade quando falta lançar uma entrada, não um bug para esconder.
 */
export function registrarSaida(item: ItemEstoque, info: SaidaInfo): ItemEstoque {
  const quantidade = arredondar(info.quantidade);
  if (quantidade <= 0) return item;

  const movimento: MovimentoEstoque = {
    id: novoIdMovimento(),
    tipo: "saida",
    quantidade,
    data: info.data || hojeBR(),
    custoUnitario: item.custoMedio,
    valorTotal: arredondar(quantidade * item.custoMedio),
    clienteId: info.clienteId || undefined,
    clienteNome: info.clienteNome?.trim() || undefined,
    vendaId: info.vendaId || undefined,
    observacao: info.observacao?.trim() || undefined,
  };

  return {
    ...item,
    quantidadeAtual: arredondar(item.quantidadeAtual - quantidade),
    movimentos: [...item.movimentos, movimento],
    atualizadoEm: new Date().toISOString(),
  };
}

/* ==========================================================================
   CONSULTA — a lista e a busca por nome
   ========================================================================== */

/** Itens abaixo do próprio mínimo — só quem tem mínimo definido entra aqui. */
export function itensComEstoqueBaixo(itens: ItemEstoque[]): ItemEstoque[] {
  return (itens || []).filter(
    (i) => typeof i.estoqueMinimo === "number" && i.quantidadeAtual <= i.estoqueMinimo
  );
}

/** Busca por nome, sem acento nem caixa fazerem diferença. */
export function buscarItens(itens: ItemEstoque[], termo: string): ItemEstoque[] {
  const alvo = String(termo || "").trim().toLowerCase();
  if (!alvo) return itens || [];
  return (itens || []).filter((i) => i.nome.toLowerCase().includes(alvo));
}

/* ==========================================================================
   RELATÓRIO — para onde foi cada baixa
   ========================================================================== */

export type LinhaBaixa = { item: ItemEstoque; movimento: MovimentoEstoque };

/** Todas as saídas dentro do período, mais recentes primeiro. Sem `de`/`ate`, devolve tudo. */
export function baixasNoPeriodo(
  itens: ItemEstoque[],
  de?: string | null,
  ate?: string | null
): LinhaBaixa[] {
  const inicio = paraISO(de);
  const fim = paraISO(ate);
  const dentro = (iso: string) => {
    if (!iso) return false;
    if (inicio && iso < inicio) return false;
    if (fim && iso > fim) return false;
    return true;
  };

  const linhas: LinhaBaixa[] = [];
  for (const item of itens || []) {
    for (const mv of item.movimentos || []) {
      if (mv.tipo !== "saida") continue;
      if ((inicio || fim) && !dentro(paraISO(mv.data))) continue;
      linhas.push({ item, movimento: mv });
    }
  }

  linhas.sort((a, b) => paraISO(b.movimento.data).localeCompare(paraISO(a.movimento.data)));
  return linhas;
}

export type ResumoPorCliente = {
  clienteId?: string;
  clienteNome: string;
  total: number;
  baixas: number;
};

/** Agrupa as baixas por cliente — maior valor primeiro. */
export function totalBaixasPorCliente(linhas: LinhaBaixa[]): ResumoPorCliente[] {
  const mapa = new Map<string, ResumoPorCliente>();
  for (const { movimento } of linhas) {
    const chave = movimento.clienteId || movimento.clienteNome || "sem_cliente";
    const atual = mapa.get(chave) || {
      clienteId: movimento.clienteId,
      clienteNome: movimento.clienteNome || "Sem cliente vinculado",
      total: 0,
      baixas: 0,
    };
    atual.total = arredondar(atual.total + movimento.valorTotal);
    atual.baixas += 1;
    mapa.set(chave, atual);
  }
  return Array.from(mapa.values()).sort((a, b) => b.total - a.total);
}

/**
 * Custo real do material de uma venda, a partir do que foi de fato baixado do
 * estoque para ela — mais preciso que uma despesa vinculada à mão, porque
 * reflete o que foi usado na instalação, não só o que foi comprado.
 */
export function custoMaterialDaVenda(vendaId: string, itens: ItemEstoque[]): number {
  return arredondar(
    (itens || []).reduce(
      (s, item) =>
        s +
        (item.movimentos || [])
          .filter((m) => m.tipo === "saida" && m.vendaId === vendaId)
          .reduce((s2, m) => s2 + m.valorTotal, 0),
      0
    )
  );
}
