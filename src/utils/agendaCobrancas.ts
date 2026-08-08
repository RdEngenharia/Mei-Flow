/**
 * ============================================================================
 * AGENDA DE COBRANÇAS — a lista de boletos organizada por vencimento
 * ============================================================================
 *
 * O PROBLEMA
 *
 * A lista era uma pilha: um boleto embaixo do outro, sem nenhuma divisão. Com
 * três boletos funciona; com trinta vira um paredão de nomes e valores em que
 * ninguém acha nada. O usuário viu isso chegando — "vai começar a gerar
 * histórico, vai ficar bagunçado assim".
 *
 * A REFERÊNCIA, E POR QUE NÃO COPIAMOS
 *
 * Ele citou a Cora, que agrupa por faixa de semana ("13/09 - 19/09"). É melhor
 * que pilha, mas a semana é um corte arbitrário: ninguém pensa "aquele boleto
 * da semana do dia 13". As pessoas pensam em MÊS — "o que vence em agosto" — e,
 * dentro do mês, em DIA. É assim que a conta de luz e o aluguel são lembrados.
 *
 * Então aqui a agenda é mês → dia, com o dia da semana escrito, e um resumo no
 * cabeçalho de cada mês (quantos boletos, quanto dá). Os dias próximos ganham
 * nome em vez de número — "Hoje", "Amanhã", "Ontem" —, porque é assim que a
 * pessoa se refere a eles.
 *
 * A ORDEM MUDA COM A ABA, DE PROPÓSITO:
 *   • a vencer  — do mais próximo para o mais distante (o que corre primeiro);
 *   • vencidos  — do mais antigo para o mais novo (o mais atrasado é o mais
 *                 urgente, e é o que some da memória);
 *   • pagos     — do mais recente para o mais antigo (histórico se lê de trás
 *                 para frente).
 */

export type ItemCobranca = {
  id: string;
  cliente: string;
  valor: number;
  /** ISO curto, como o servidor devolve. */
  vencimento?: string;
  vencimentoBR: string;
  situacao: "pago" | "pendente" | "vencido" | "cancelado";
  diasParaVencer: number | null;
  diasEmAtraso: number;
  link: string;
};

export type DiaDaAgenda = {
  chave: string;
  /** "Hoje", "Amanhã", "sáb, 08" — o que a pessoa diria em voz alta. */
  rotulo: string;
  /** Marcado quando é hoje, para a tela poder destacar. */
  ehHoje: boolean;
  itens: ItemCobranca[];
  total: number;
};

export type MesDaAgenda = {
  chave: string;
  /** "Agosto de 2026" */
  rotulo: string;
  dias: DiaDaAgenda[];
  quantidade: number;
  total: number;
};

const MESES = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
];

const DIAS_SEMANA = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];

/**
 * Data ISO curta a partir do que o item trouxer.
 *
 * ⚠️ O `vencimentoBR` vem como dd/mm/aaaa e NÃO pode ser jogado dentro de
 *    `new Date()`: o JavaScript lê como mês/dia/ano americano. Foi exatamente
 *    esse engano que gravou despesas com dia e mês trocados neste projeto. Aqui
 *    a conversão é explícita.
 */
export function dataDoItem(it: { vencimento?: string; vencimentoBR?: string }): string {
  const iso = String(it?.vencimento || "").slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;

  const br = String(it?.vencimentoBR || "").trim();
  const m = br.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : "";
}

/** Meio-dia, para a contagem de dias não escorregar na virada do horário de verão. */
const aoMeioDia = (iso: string) => new Date(`${iso}T12:00:00`);

export function diferencaEmDias(de: string, ate: string): number {
  const a = aoMeioDia(de);
  const b = aoMeioDia(ate);
  if (isNaN(a.getTime()) || isNaN(b.getTime())) return 0;
  return Math.round((b.getTime() - a.getTime()) / 86400000);
}

/**
 * Como o dia é chamado na tela.
 *
 * Dia próximo vira palavra; dia distante vira data com o dia da semana, que
 * ajuda a planejar ("cai num sábado, o cliente não vai ao banco").
 */
export function rotuloDoDia(iso: string, hojeISO: string): string {
  const d = aoMeioDia(iso);
  if (isNaN(d.getTime())) return "Sem data";

  const dif = diferencaEmDias(hojeISO, iso);
  if (dif === 0) return "Hoje";
  if (dif === 1) return "Amanhã";
  if (dif === -1) return "Ontem";

  const dia = String(d.getDate()).padStart(2, "0");
  return `${DIAS_SEMANA[d.getDay()]}, ${dia}`;
}

export function rotuloDoMes(iso: string): string {
  const [ano, mes] = String(iso || "").split("-");
  const i = Number(mes) - 1;
  return MESES[i] ? `${MESES[i]} de ${ano}` : "Sem vencimento";
}

/**
 * Monta a agenda.
 *
 * @param ordem "proximo" (a vencer), "antigo" (vencidos) ou "recente" (pagos).
 */
export function montarAgenda(
  itens: ItemCobranca[],
  ordem: "proximo" | "antigo" | "recente",
  hojeISO?: string
): MesDaAgenda[] {
  const hoje = String(hojeISO || new Date().toISOString()).slice(0, 10);
  const porMes = new Map<string, MesDaAgenda>();
  const porDia = new Map<string, DiaDaAgenda>();

  for (const it of itens || []) {
    const iso = dataDoItem(it);
    const chaveMes = iso ? iso.slice(0, 7) : "sem-data";
    const chaveDia = iso || "sem-data";

    let mes = porMes.get(chaveMes);
    if (!mes) {
      mes = { chave: chaveMes, rotulo: iso ? rotuloDoMes(iso) : "Sem vencimento", dias: [], quantidade: 0, total: 0 };
      porMes.set(chaveMes, mes);
    }

    let dia = porDia.get(chaveDia);
    if (!dia) {
      dia = {
        chave: chaveDia,
        rotulo: iso ? rotuloDoDia(iso, hoje) : "Sem data",
        ehHoje: iso === hoje,
        itens: [],
        total: 0,
      };
      porDia.set(chaveDia, dia);
      mes.dias.push(dia);
    }

    dia.itens.push(it);
    dia.total += Number(it.valor) || 0;
    mes.quantidade += 1;
    mes.total += Number(it.valor) || 0;
  }

  // "recente" é a única que lê de trás para frente.
  const desc = ordem === "recente";
  const comparar = (a: string, b: string) => (desc ? b.localeCompare(a) : a.localeCompare(b));

  const meses = Array.from(porMes.values()).sort((a, b) => {
    // "Sem vencimento" fica sempre no fim: é exceção, não é agenda.
    if (a.chave === "sem-data") return 1;
    if (b.chave === "sem-data") return -1;
    return comparar(a.chave, b.chave);
  });

  for (const mes of meses) {
    mes.dias.sort((a, b) => {
      if (a.chave === "sem-data") return 1;
      if (b.chave === "sem-data") return -1;
      return comparar(a.chave, b.chave);
    });
    // Dentro do dia, o maior valor primeiro — é o que decide a ligação.
    for (const dia of mes.dias) {
      dia.itens.sort((a, b) => (Number(b.valor) || 0) - (Number(a.valor) || 0));
    }
  }

  return meses;
}

/** Ordem certa para cada aba, num lugar só. */
export function ordemDaAba(aba: string): "proximo" | "antigo" | "recente" {
  if (aba === "vencido") return "antigo";
  if (aba === "pago") return "recente";
  return "proximo";
}
