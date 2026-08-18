/**
 * ============================================================================
 * RECEBIMENTOS E COMISSÃO — todo o cálculo de "já recebi" × "tenho a receber"
 * ============================================================================
 *
 * O PROBLEMA QUE ORIGINOU ESTE ARQUIVO
 *
 * Projeto fotovoltaico: 50% de entrada quando fecha, o resto quando a
 * concessionária aprova — o que leva "até 40 dias", e ninguém sabe quantos.
 * Registrar isso como uma venda única de valor cheio mente sobre o caixa;
 * registrar só a entrada perde metade do contrato de vista.
 *
 * A SAÍDA, EM UMA FRASE
 *
 *   `Transacao.valor` continua sendo O QUE ENTROU NO CAIXA.
 *   O valor cheio da venda passa a morar em `valorTotal`.
 *
 * Essa escolha é o que permitiu não tocar em nada que já funcionava: o
 * faturamento consolidado, o percentual do limite de R$ 81.000, os gráficos e o
 * relatório em PDF somam `valor` — e continuam certos sozinhos.
 *
 * ⚠️ O INVARIANTE
 *
 *   valor === soma dos recebimentos com situacao "recebido"
 *
 * Ele é mantido em UM lugar só: `aplicarRecebimentos()`. Nenhum outro código
 * deve escrever `valor` numa venda parcelada — se escrever, o caixa e o plano
 * de recebimento passam a discordar, e discordam em silêncio.
 *
 * ⚠️ POR QUE A DATA DA PARCELA É OPCIONAL
 *
 * Porque o usuário não a conhece. Uma data inventada vira alarme falso de
 * atraso duas semanas depois, e alarme falso ensina a ignorar alarme. No lugar
 * dela existe `gatilho` — o marco que destrava o dinheiro, em texto ("Aprovação
 * na Coelba") — e a contagem de dias em aberto, que é um fato, não um palpite.
 * Quem TEM data (venda a prazo comum) preenche a data e ganha a previsão.
 */

import type {
  Comissao,
  CondicaoPagamento,
  Recebimento,
  Transacao,
} from "../types";

/* ==========================================================================
   DINHEIRO E DATA — as duas fontes clássicas de bug neste projeto
   ========================================================================== */

/**
 * Arredonda para centavos.
 *
 * 0.1 + 0.2 dá 0.30000000000000004 em JavaScript, e uma venda de R$ 30.000,00
 * dividida em três chega a mostrar R$ 0,01 a receber numa venda quitada. Toda
 * soma de dinheiro deste arquivo passa por aqui.
 */
export const arredondar = (n: unknown): number =>
  Math.round((Number(n) || 0) * 100) / 100;

/**
 * dd/mm/aaaa ou aaaa-mm-dd → aaaa-mm-dd. Devolve "" quando não reconhece.
 *
 * ⚠️ NUNCA jogue "25/12/2026" dentro de `new Date()`: o JavaScript lê como
 *    mês/dia americano, e com dia acima de 12 devolve Invalid Date. Foi esse
 *    engano exato que impediu despesas de salvar neste projeto (BUGS_ENCONTRADOS,
 *    item 1). A conversão aqui é explícita, e é a única permitida.
 */
export function paraISO(data?: string | null): string {
  const s = String(data || "").trim();
  if (!s) return "";

  const iso = s.slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;

  const br = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  return br ? `${br[3]}-${br[2]}-${br[1]}` : "";
}

/** aaaa-mm-dd → dd/mm/aaaa, que é o formato que o app escreve e exibe. */
export function paraBR(iso?: string | null): string {
  const s = paraISO(iso);
  if (!s) return "";
  const [a, m, d] = s.split("-");
  return `${d}/${m}/${a}`;
}

/** Hoje em dd/mm/aaaa, no fuso do aparelho — o padrão dos campos de data. */
export function hojeBR(): string {
  const d = new Date();
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
}

/** Meio-dia, para a contagem de dias não escorregar no horário de verão. */
const aoMeioDia = (iso: string) => new Date(`${iso}T12:00:00`);

/** Dias inteiros entre duas datas. Data ilegível conta como 0, nunca NaN. */
export function diasEntre(deISO: string, ateISO: string): number {
  const a = aoMeioDia(paraISO(deISO));
  const b = aoMeioDia(paraISO(ateISO));
  if (isNaN(a.getTime()) || isNaN(b.getTime())) return 0;
  return Math.round((b.getTime() - a.getTime()) / 86400000);
}

/* ==========================================================================
   NORMALIZAÇÃO — venda antiga entrando no formato novo, na leitura
   ==========================================================================

   Mesmo padrão de `normalizarOrcamento()`: não migramos o banco, convertemos
   na leitura. É reversível, não perde nada, e uma venda gravada em junho
   continua abrindo em agosto sem ninguém rodar script.
   ========================================================================== */

let contador = 0;
/** Id de parcela. Não usa só o relógio: dois cliques no mesmo milissegundo colidiam. */
export function novoIdRecebimento(): string {
  contador += 1;
  return `rc_${Date.now().toString(36)}_${contador.toString(36)}`;
}

/**
 * Devolve as parcelas de uma venda, SEMPRE como lista.
 *
 * Venda sem `recebimentos` é venda à vista — e é o caso da base inteira que
 * existia antes deste recurso. Ela vira uma parcela única, já recebida, com a
 * data e a forma de pagamento que a venda sempre teve. Nada se perde, e todo o
 * resto do arquivo pode assumir que a lista existe.
 */
export function recebimentosDa(tx: Partial<Transacao> | null | undefined): Recebimento[] {
  const lista = (tx as any)?.recebimentos;
  if (Array.isArray(lista) && lista.length > 0) {
    return lista.map((r: any, i: number) => ({
      id: String(r?.id || `rc_legado_${i}`),
      valor: arredondar(r?.valor),
      situacao: r?.situacao === "aguardando" ? "aguardando" : "recebido",
      rotulo: r?.rotulo || undefined,
      forma: r?.forma || undefined,
      dataRecebimento: r?.dataRecebimento || undefined,
      previsao: r?.previsao || undefined,
      gatilho: r?.gatilho || undefined,
      cobrancaId: r?.cobrancaId || undefined,
    }));
  }

  return [
    {
      id: "rc_avista",
      valor: arredondar(tx?.valor),
      situacao: "recebido",
      rotulo: "Pagamento à vista",
      forma: tx?.formaPagamento || undefined,
      dataRecebimento: tx?.data || undefined,
    },
  ];
}

/**
 * Converte uma venda de qualquer época para o formato atual, EM MEMÓRIA.
 *
 * Não grava nada. Chame na leitura (fetchVendasFromFirebase) e depois de
 * qualquer alteração no plano de recebimento.
 */
export function normalizarVenda<T extends Partial<Transacao>>(tx: T): T & Transacao {
  const base = { ...(tx as any) } as Transacao;
  if (base.tipo !== "entrada") return base as any;
  return aplicarRecebimentos(base, recebimentosDa(base)) as any;
}

/**
 * ⚠️ A ÚNICA FUNÇÃO QUE PODE ESCREVER `valor` NUMA VENDA PARCELADA.
 *
 * Recebe o plano de recebimento e devolve a venda coerente com ele:
 * `valor` = o que já entrou, `valorTotal` = o combinado. Chame sempre que
 * adicionar, confirmar, editar ou remover uma parcela.
 *
 * Venda com uma parcela só, já recebida, volta a ser uma venda à vista: os
 * campos novos são apagados para não poluir o banco com estrutura inútil.
 */
export function aplicarRecebimentos(tx: Transacao, recebimentos: Recebimento[]): Transacao {
  const lista = (recebimentos || []).map((r) => ({ ...r, valor: arredondar(r.valor) }));

  const recebido = arredondar(
    lista.filter((r) => r.situacao === "recebido").reduce((s, r) => s + r.valor, 0)
  );
  const total = arredondar(lista.reduce((s, r) => s + r.valor, 0));

  const parcelado = lista.length > 1 || lista.some((r) => r.situacao === "aguardando");

  const atualizada: Transacao = {
    ...tx,
    valor: recebido,
    valorTotal: total,
    recebimentos: lista,
  };

  if (!parcelado) {
    // Voltou a ser à vista: sem estrutura sobrando.
    delete (atualizada as any).recebimentos;
    delete (atualizada as any).valorTotal;
    atualizada.valor = total;
    const unica = lista[0];
    if (unica?.forma) atualizada.formaPagamento = unica.forma;
  }

  return atualizada;
}

/* ==========================================================================
   AS PERGUNTAS QUE A TELA FAZ
   ========================================================================== */

/** Valor cheio da venda. Para venda à vista é o próprio `valor`. */
export function totalDaVenda(tx?: Partial<Transacao> | null): number {
  if (!tx) return 0;
  if (typeof tx.valorTotal === "number") return arredondar(tx.valorTotal);
  return arredondar(
    recebimentosDa(tx).reduce((s, r) => s + r.valor, 0)
  );
}

/** O que já entrou no caixa. Idêntico a `valor` — existe para o código ler melhor. */
export function totalRecebido(tx?: Partial<Transacao> | null): number {
  if (!tx) return 0;
  return arredondar(
    recebimentosDa(tx)
      .filter((r) => r.situacao === "recebido")
      .reduce((s, r) => s + r.valor, 0)
  );
}

/** O que falta entrar. Nunca negativo. */
export function totalAReceber(tx?: Partial<Transacao> | null): number {
  return Math.max(0, arredondar(totalDaVenda(tx) - totalRecebido(tx)));
}

export type SituacaoDaVenda = "quitada" | "parcial" | "aberta";

/**
 * Em que pé a venda está.
 *
 * "aberta" é a venda que ainda não trouxe nenhum centavo — o cliente fechou e
 * não pagou entrada. Ela precisa de destaque próprio: uma venda de R$ 30 mil
 * com R$ 0,00 no caixa não pode parecer uma venda de R$ 0,00.
 */
export function situacaoDaVenda(tx?: Partial<Transacao> | null): SituacaoDaVenda {
  const recebido = totalRecebido(tx);
  const total = totalDaVenda(tx);
  if (recebido <= 0 && total > 0) return "aberta";
  if (recebido + 0.005 < total) return "parcial";
  return "quitada";
}

/** Só as parcelas que ainda não entraram. */
export function parcelasAguardando(tx?: Partial<Transacao> | null): Recebimento[] {
  return recebimentosDa(tx).filter((r) => r.situacao === "aguardando");
}

/**
 * Há quantos dias este dinheiro está sendo esperado.
 *
 * Conta da DATA DA VENDA, não de uma previsão — justamente porque previsão pode
 * não existir. É um fato verificável ("fechei há 27 dias e o saldo não caiu"),
 * e é o número que faz a pessoa ligar para a concessionária.
 */
export function diasEmAberto(tx?: Partial<Transacao> | null, hoje?: string): number {
  const inicio = paraISO(tx?.data);
  if (!inicio) return 0;
  return Math.max(0, diasEntre(inicio, paraISO(hoje) || new Date().toISOString().slice(0, 10)));
}

/**
 * Quanto está atrasado em relação à previsão. Sem previsão, nunca há atraso.
 *
 * Esta é a diferença entre "não sei quando cai" e "prometeram para o dia 10 e
 * já é 17". Só o segundo caso merece a cor vermelha.
 */
export function diasDeAtraso(parcela?: Recebimento | null, hoje?: string): number {
  const prev = paraISO(parcela?.previsao);
  if (!prev || parcela?.situacao === "recebido") return 0;
  return Math.max(0, diasEntre(prev, paraISO(hoje) || new Date().toISOString().slice(0, 10)));
}

/**
 * Quanto desta venda entrou no caixa DENTRO do período.
 *
 * É o que corrige a distorção do parcelamento no relatório: a entrada caiu em
 * julho, o saldo em setembro, e cada mês precisa mostrar o seu. Uma venda à
 * vista (ou antiga) responde exatamente o que respondia antes — o valor cheio
 * se a data da venda está no período, zero se não está.
 *
 * @param de  aaaa-mm-dd ou vazio para "desde sempre"
 * @param ate aaaa-mm-dd ou vazio para "até hoje"
 */
export function valorNoPeriodo(
  tx: Partial<Transacao> | null | undefined,
  de?: string | null,
  ate?: string | null
): number {
  if (!tx) return 0;

  const inicio = paraISO(de);
  const fim = paraISO(ate);
  const dentro = (iso: string) => {
    if (!iso) return false;
    if (inicio && iso < inicio) return false;
    if (fim && iso > fim) return false;
    return true;
  };

  if (!inicio && !fim) return totalRecebido(tx);

  // Despesa não tem parcelas: vale a data do lançamento, como sempre valeu.
  if (tx.tipo !== "entrada") {
    return dentro(paraISO(tx.data)) ? arredondar(tx.valor) : 0;
  }

  return arredondar(
    recebimentosDa(tx)
      .filter((r) => r.situacao === "recebido")
      // Parcela sem data de recebimento cai na data da venda — é o caso das
      // vendas antigas, em que essa data é a única que existe.
      .filter((r) => dentro(paraISO(r.dataRecebimento || tx.data)))
      .reduce((s, r) => s + r.valor, 0)
  );
}

/** A venda tem alguma coisa dentro do período? Decide se a linha aparece na lista. */
export function tocaOPeriodo(
  tx: Partial<Transacao> | null | undefined,
  de?: string | null,
  ate?: string | null
): boolean {
  if (!tx) return false;
  const inicio = paraISO(de);
  const fim = paraISO(ate);
  if (!inicio && !fim) return true;

  const dentro = (iso: string) => {
    if (!iso) return false;
    if (inicio && iso < inicio) return false;
    if (fim && iso > fim) return false;
    return true;
  };

  if (dentro(paraISO(tx.data))) return true;
  if (tx.tipo !== "entrada") return false;

  return recebimentosDa(tx).some(
    (r) => r.situacao === "recebido" && dentro(paraISO(r.dataRecebimento))
  );
}

/* ==========================================================================
   MONTAR O PLANO — o que o formulário de venda produz
   ========================================================================== */

export type EntradaInformada = {
  /** Valor cheio da venda. */
  total: number;
  /** Quanto entra agora. Pode ser 0 — "fechei e ainda não recebi nada". */
  entrada: number;
  formaEntrada?: string;
  formaSaldo?: string;
  /** dd/mm/aaaa — data do recebimento da entrada. Normalmente a data da venda. */
  dataEntrada?: string;
  /** dd/mm/aaaa — OPCIONAL. */
  previsaoSaldo?: string;
  /** Texto livre. Usado quando não há previsão. */
  gatilhoSaldo?: string;
};

/**
 * Duas linhas — entrada e saldo — a partir do que a pessoa digitou.
 *
 * Entrada maior ou igual ao total devolve UMA linha só: é venda à vista, e
 * criar um saldo de R$ 0,00 encheria a tela de parcela fantasma.
 */
export function montarPlano(e: EntradaInformada): Recebimento[] {
  const total = arredondar(e.total);
  const entrada = Math.min(Math.max(0, arredondar(e.entrada)), total);
  const saldo = arredondar(total - entrada);

  const linhas: Recebimento[] = [];

  if (entrada > 0 || saldo <= 0) {
    linhas.push({
      id: novoIdRecebimento(),
      valor: entrada > 0 ? entrada : total,
      situacao: "recebido",
      rotulo: saldo > 0 ? "Entrada" : "Pagamento à vista",
      forma: e.formaEntrada || undefined,
      dataRecebimento: e.dataEntrada || hojeBR(),
    });
  }

  if (saldo > 0) {
    linhas.push({
      id: novoIdRecebimento(),
      valor: saldo,
      situacao: "aguardando",
      rotulo: entrada > 0 ? "Saldo" : "Valor combinado",
      forma: e.formaSaldo || undefined,
      previsao: e.previsaoSaldo || undefined,
      gatilho: e.gatilhoSaldo || undefined,
    });
  }

  return linhas;
}

/** Confirma uma parcela. Confirmar de novo não duplica nem muda a data original. */
export function confirmarParcela(
  tx: Transacao,
  parcelaId: string,
  dados?: { data?: string; forma?: string; valor?: number }
): Transacao {
  const lista = recebimentosDa(tx).map((r) => {
    if (r.id !== parcelaId || r.situacao === "recebido") return r;
    return {
      ...r,
      situacao: "recebido" as const,
      valor: typeof dados?.valor === "number" ? arredondar(dados.valor) : r.valor,
      forma: dados?.forma || r.forma,
      dataRecebimento: dados?.data || hojeBR(),
    };
  });
  return aplicarRecebimentos(tx, lista);
}

/**
 * Recebimento parcial: quebra a parcela em "o que caiu" e "o que ainda falta".
 *
 * O cliente que devia R$ 15.000 e mandou R$ 10.000 não quitou nem deixou de
 * pagar. Sem isto, a única saída seria mentir para um dos dois lados.
 */
export function receberParcialmente(
  tx: Transacao,
  parcelaId: string,
  valorRecebido: number,
  dados?: { data?: string; forma?: string }
): Transacao {
  const recebido = arredondar(valorRecebido);
  const lista: Recebimento[] = [];

  for (const r of recebimentosDa(tx)) {
    if (r.id !== parcelaId || r.situacao === "recebido" || recebido >= r.valor) {
      if (r.id === parcelaId && recebido >= r.valor) {
        lista.push({
          ...r,
          situacao: "recebido",
          forma: dados?.forma || r.forma,
          dataRecebimento: dados?.data || hojeBR(),
        });
      } else {
        lista.push(r);
      }
      continue;
    }

    lista.push({
      ...r,
      id: novoIdRecebimento(),
      valor: recebido,
      situacao: "recebido",
      rotulo: `${r.rotulo || "Parcela"} (parcial)`,
      forma: dados?.forma || r.forma,
      dataRecebimento: dados?.data || hojeBR(),
      previsao: undefined,
      gatilho: undefined,
    });
    lista.push({
      ...r,
      valor: arredondar(r.valor - recebido),
      situacao: "aguardando",
      rotulo: `${r.rotulo || "Parcela"} (restante)`,
    });
  }

  return aplicarRecebimentos(tx, lista);
}

/* ==========================================================================
   COMISSÃO
   ========================================================================== */

export type ComissaoInformada = {
  beneficiario: string;
  base: "percentual" | "fixo";
  percentual?: number;
  valorFixo?: number;
  sobre?: "total" | "recebido";
  observacao?: string;
};

/**
 * Calcula e CONGELA o valor da comissão.
 *
 * Congelar importa: o percentual fica guardado só para a tela explicar de onde
 * veio o número. Se a venda for editada amanhã, a comissão combinada ontem não
 * muda sozinha — quem combinou 10% de R$ 30.000 combinou R$ 3.000.
 */
export function calcularComissao(
  info: ComissaoInformada,
  venda: { total: number; recebido: number }
): Comissao | undefined {
  const beneficiario = String(info?.beneficiario || "").trim();
  if (!beneficiario) return undefined;

  const sobre = info.sobre === "recebido" ? "recebido" : "total";
  const baseValor = sobre === "recebido" ? venda.recebido : venda.total;

  const valor =
    info.base === "fixo"
      ? arredondar(info.valorFixo)
      : arredondar((baseValor * (Number(info.percentual) || 0)) / 100);

  if (valor <= 0) return undefined;

  return {
    beneficiario,
    base: info.base,
    percentual: info.base === "percentual" ? Number(info.percentual) || 0 : undefined,
    sobre,
    valor,
    situacao: "aPagar",
    observacao: String(info.observacao || "").trim() || undefined,
  };
}

/** Sobra da venda depois da comissão. É a margem que o orçamento precisa mostrar. */
export function liquidoDaVenda(total: number, comissao?: Comissao | null): number {
  return arredondar(arredondar(total) - arredondar(comissao?.valor));
}

/**
 * Id da despesa de comissão — DERIVADO DA VENDA, nunca do relógio.
 *
 * Mesma regra já aprendida no recebimento de boleto e na conversão de
 * orçamento: se dois cliques chegarem juntos, gravar por cima da mesma linha é
 * seguro; gerar id novo duplicaria a despesa. Marcar a comissão como paga duas
 * vezes tem que produzir UMA saída no caixa.
 */
export function idDespesaComissao(vendaId: string): string {
  return `tx_com_${String(vendaId).replace(/[^A-Za-z0-9_-]/g, "")}`;
}

/** A saída no Livro Caixa correspondente a uma comissão paga. */
export function despesaDaComissao(venda: Transacao, comissao: Comissao): Transacao {
  return {
    id: idDespesaComissao(venda.id),
    tipo: "saida",
    valor: arredondar(comissao.valor),
    data: comissao.dataPagamento || hojeBR(),
    descricao: `Comissão — ${comissao.beneficiario} (${venda.clienteNome || "venda"})`,
    categoria: "Comissões",
    formaPagamento: comissao.formaPagamento || "Pix",
    vendaOrigemId: venda.id,
  };
}

/* ==========================================================================
   DO ORÇAMENTO PARA A VENDA
   ========================================================================== */

/** Quanto é a entrada combinada numa proposta, em reais. */
export function entradaDaCondicao(total: number, c?: CondicaoPagamento | null): number {
  const cheio = arredondar(total);
  if (!c) return cheio;
  if (typeof c.entradaValor === "number" && c.entradaValor > 0) {
    return Math.min(arredondar(c.entradaValor), cheio);
  }
  if (typeof c.entradaPercentual === "number" && c.entradaPercentual > 0) {
    return Math.min(arredondar((cheio * c.entradaPercentual) / 100), cheio);
  }
  return cheio;
}

/**
 * O plano de recebimento de um orçamento aceito.
 *
 * ⚠️ A entrada nasce COMO AGUARDANDO, não como recebida. Aceitar a proposta não
 * é o mesmo que o dinheiro cair na conta — e um sistema que confunde as duas
 * coisas lança faturamento que não existe. Quem confirma é a baixa.
 */
export function planoDoOrcamento(total: number, c?: CondicaoPagamento | null): Recebimento[] {
  const cheio = arredondar(total);
  const entrada = entradaDaCondicao(cheio, c);
  const saldo = arredondar(cheio - entrada);

  const linhas: Recebimento[] = [
    {
      id: novoIdRecebimento(),
      valor: entrada,
      situacao: "aguardando",
      rotulo: saldo > 0 ? "Entrada" : "Pagamento combinado",
      forma: c?.formaEntrada || undefined,
    },
  ];

  if (saldo > 0) {
    linhas.push({
      id: novoIdRecebimento(),
      valor: saldo,
      situacao: "aguardando",
      rotulo: "Saldo",
      forma: c?.formaSaldo || undefined,
      previsao: c?.previsaoSaldo || undefined,
      gatilho: c?.gatilhoSaldo || undefined,
    });
  }

  return linhas;
}

/** Frase da condição de pagamento, para o PDF da proposta e para a tela. */
export function textoDaCondicao(total: number, c?: CondicaoPagamento | null): string {
  const cheio = arredondar(total);
  const entrada = entradaDaCondicao(cheio, c);
  const saldo = arredondar(cheio - entrada);
  const emReais = (n: number) =>
    n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

  if (saldo <= 0) return `Pagamento à vista${c?.formaEntrada ? ` — ${c.formaEntrada}` : ""}.`;

  const pct = cheio > 0 ? Math.round((entrada / cheio) * 100) : 0;
  const parte1 = `Entrada de ${emReais(entrada)} (${pct}%)${c?.formaEntrada ? ` em ${c.formaEntrada}` : ""}`;

  let quando = "";
  if (c?.previsaoSaldo) quando = ` até ${c.previsaoSaldo}`;
  else if (c?.gatilhoSaldo) quando = ` mediante ${c.gatilhoSaldo}`;

  const parte2 = `saldo de ${emReais(saldo)}${c?.formaSaldo ? ` em ${c.formaSaldo}` : ""}${quando}`;

  return `${parte1}; ${parte2}.`;
}

/* ==========================================================================
   AGRUPAMENTO PARA O PAINEL "A RECEBER"
   ==========================================================================
   Sem previsão não há agenda — e é justamente o caso mais comum aqui. Por isso
   o painel ordena por DIAS EM ABERTO, do mais antigo para o mais novo: o
   dinheiro que está parado há mais tempo é o que precisa da ligação de hoje.
   ========================================================================== */

export type LinhaAReceber = {
  venda: Transacao;
  parcela: Recebimento;
  diasEmAberto: number;
  diasDeAtraso: number;
};

export function montarAReceber(
  transacoes: Transacao[],
  hoje?: string
): { linhas: LinhaAReceber[]; total: number } {
  const linhas: LinhaAReceber[] = [];

  for (const tx of transacoes || []) {
    if (tx?.tipo !== "entrada") continue;
    for (const parcela of parcelasAguardando(tx)) {
      linhas.push({
        venda: tx,
        parcela,
        diasEmAberto: diasEmAberto(tx, hoje),
        diasDeAtraso: diasDeAtraso(parcela, hoje),
      });
    }
  }

  linhas.sort((a, b) => {
    // Atrasado de verdade vem primeiro; depois, o que espera há mais tempo.
    if (a.diasDeAtraso !== b.diasDeAtraso) return b.diasDeAtraso - a.diasDeAtraso;
    if (a.diasEmAberto !== b.diasEmAberto) return b.diasEmAberto - a.diasEmAberto;
    return b.parcela.valor - a.parcela.valor;
  });

  return {
    linhas,
    total: arredondar(linhas.reduce((s, l) => s + l.parcela.valor, 0)),
  };
}

/** Comissões que ainda não saíram do caixa. */
export function comissoesAPagar(transacoes: Transacao[]): { venda: Transacao; comissao: Comissao }[] {
  return (transacoes || [])
    .filter((t) => t?.tipo === "entrada" && t.comissao && t.comissao.situacao !== "paga")
    .map((t) => ({ venda: t, comissao: t.comissao as Comissao }));
}
