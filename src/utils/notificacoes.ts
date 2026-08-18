/**
 * ============================================================================
 * CENTRAL DE NOTIFICAÇÕES — as regras de quando avisar, sem nenhum fetch
 * ============================================================================
 *
 * O PEDIDO
 *
 * Avisar um dia antes do DAS vencer e no dia do vencimento; avisar quando uma
 * parcela de recebimento chega na data prevista e ainda não foi confirmada
 * como recebida — e o aviso PERSISTE (continua aparecendo) até alguém marcar
 * como recebido, porque ele reflete um fato ("ainda não caiu"), não um evento
 * que dispara uma vez e se apaga sozinho.
 *
 * Junto entraram três avisos que já tinham os dados prontos no sistema:
 * certificado A1 perto de vencer, boleto emitido a cliente vencido, e
 * proximidade do teto de faturamento do MEI.
 *
 * POR QUE ISTO É UM ARQUIVO SÓ DE FUNÇÕES PURAS
 *
 * Mesmo motivo de utils/recebimentos.ts: cada regra aqui decide "dinheiro" ou
 * "prazo legal" (DAS é imposto; datar errado o aviso do certificado deixa a
 * nota fiscal parar de sair sem aviso prévio). Função pura testa sem precisar
 * de Firestore, sem precisar de relógio de verdade, e sem precisar do app
 * inteiro rodando. `notificacoes.test.ts` cobre os casos de borda.
 *
 * O que faz fetch (certificado A1 na Efí/Focus, boletos vencidos na Efí/Asaas)
 * mora em CentralNotificacoes.tsx — este arquivo só recebe os números já
 * prontos e decide o texto e a severidade.
 */

export type CategoriaNotificacao = "das" | "recebimento" | "certificado" | "cobranca" | "limite";
export type SeveridadeNotificacao = "aviso" | "urgente";

export type Notificacao = {
  id: string;
  categoria: CategoriaNotificacao;
  severidade: SeveridadeNotificacao;
  titulo: string;
  detalhe: string;
  /** Texto do botão de ação, quando existe uma tela para onde ir. */
  acao?: string;
  /** Presentes só na categoria "recebimento", para o clique saber qual venda abrir. */
  vendaId?: string;
  parcelaId?: string;
};

/** Meio-dia, para a diferença de dias não escorregar no horário de verão. */
const aoMeioDia = (iso: string) => new Date(`${iso}T12:00:00`);

function diasEntre(deISO: string, ateISO: string): number {
  const a = aoMeioDia(deISO);
  const b = aoMeioDia(ateISO);
  if (isNaN(a.getTime()) || isNaN(b.getTime())) return 0;
  return Math.round((b.getTime() - a.getTime()) / 86400000);
}

function hojeISOPadrao(): string {
  return new Date().toISOString().slice(0, 10);
}

function paraBR(iso: string): string {
  const [a, m, d] = iso.split("-");
  return `${d}/${m}/${a}`;
}

/* ==========================================================================
   1. DAS — vence todo dia 20
   ==========================================================================
   ⚠️ SIMPLIFICAÇÃO ASSUMIDA: o DAS-MEI vence no dia 20 de cada mês; quando
   o dia 20 cai num sábado ou domingo, a Receita empurra para o próximo dia
   útil. Isto NÃO considera feriados nacionais, estaduais ou municipais — só
   fim de semana. Feriado no dia 20 (ou no dia empurrado) faria a data real
   ser um dia depois da calculada aqui. Documentado de propósito: se um dia
   isso incomodar, o ajuste é trocar só esta função por uma que consulte uma
   lista de feriados — o resto do sistema não muda.
   ========================================================================== */

/** Dia 20 do mês de `iso`, empurrado para segunda-feira se cair em fim de semana. */
export function vencimentoDasDoMes(iso: string): string {
  const [ano, mes] = iso.split("-").map(Number);
  const d = new Date(Date.UTC(ano, mes - 1, 20, 12));
  const diaSemana = d.getUTCDay(); // 0 = domingo, 6 = sábado
  if (diaSemana === 6) d.setUTCDate(d.getUTCDate() + 2); // sábado → segunda
  if (diaSemana === 0) d.setUTCDate(d.getUTCDate() + 1); // domingo → segunda
  return d.toISOString().slice(0, 10);
}

export function notificacaoDas(hojeISO?: string): Notificacao[] {
  const hoje = hojeISO || hojeISOPadrao();
  const vencimento = vencimentoDasDoMes(hoje);
  const dif = diasEntre(hoje, vencimento);

  if (dif === 1) {
    return [{
      id: `das_${vencimento}_amanha`,
      categoria: "das",
      severidade: "aviso",
      titulo: "O DAS vence amanhã",
      detalhe: `Vencimento em ${paraBR(vencimento)}. Emita a guia com antecedência para não correr risco de multa.`,
      acao: "Emitir DAS",
    }];
  }
  if (dif === 0) {
    return [{
      id: `das_${vencimento}_hoje`,
      categoria: "das",
      severidade: "urgente",
      titulo: "O DAS vence hoje",
      detalhe: `Vencimento em ${paraBR(vencimento)}. Pague ainda hoje para evitar juros e multa.`,
      acao: "Emitir DAS",
    }];
  }
  return [];
}

/* ==========================================================================
   2. RECEBIMENTO COM PREVISÃO VENCIDA
   ==========================================================================
   Só entra aqui quem TEM previsão marcada (a maioria das parcelas do caso
   fotovoltaico não tem, e está certo não ter — ver utils/recebimentos.ts).
   Sem data, não existe "venceu": existe só "está em aberto há N dias", que já
   aparece no painel A Receber, sem precisar de um aviso separado.
   ========================================================================== */

type ParcelaComoInput = {
  vendaId: string;
  parcelaId: string;
  clienteNome?: string;
  valor: number;
  previsaoISO?: string;
  situacao: "recebido" | "aguardando";
};

export function notificacoesRecebimento(parcelas: ParcelaComoInput[], hojeISO?: string): Notificacao[] {
  const hoje = hojeISO || hojeISOPadrao();
  const emReais = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

  return (parcelas || [])
    .filter((p) => p.situacao === "aguardando" && p.previsaoISO)
    .map((p) => ({ p, atraso: diasEntre(p.previsaoISO as string, hoje) }))
    .filter(({ atraso }) => atraso >= 0) // hoje ou depois da previsão
    // Mais atrasado primeiro — é o que precisa da ligação de hoje.
    .sort((a, b) => b.atraso - a.atraso)
    .map(({ p, atraso }) => {
      const quemPaga = p.clienteNome || "cliente";
      return {
        id: `receb_${p.vendaId}_${p.parcelaId}`,
        categoria: "recebimento" as const,
        severidade: (atraso > 0 ? "urgente" : "aviso") as SeveridadeNotificacao,
        titulo: atraso > 0
          ? `Recebimento de ${quemPaga} está atrasado`
          : `Recebimento de ${quemPaga} previsto para hoje`,
        detalhe: atraso > 0
          ? `${emReais(p.valor)} previstos para ${paraBR(p.previsaoISO as string)} — ${atraso} ${atraso === 1 ? "dia" : "dias"} de atraso. Some daqui assim que você marcar como recebido.`
          : `${emReais(p.valor)} previstos para hoje. Assim que cair, marque como recebido para o aviso sair sozinho.`,
        acao: "Marcar como recebido",
        vendaId: p.vendaId,
        parcelaId: p.parcelaId,
      };
    });
}

/* ==========================================================================
   3. LIMITE ANUAL DO MEI
   ========================================================================== */

export function notificacaoLimiteMei(faturamentoBrutoTotal: number, limiteAnual: number): Notificacao[] {
  if (!limiteAnual || limiteAnual <= 0) return [];
  const pct = (faturamentoBrutoTotal / limiteAnual) * 100;
  const emReais = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

  if (pct >= 95) {
    return [{
      id: "limite_mei_95",
      categoria: "limite",
      severidade: "urgente",
      titulo: "Faturamento quase no teto do MEI",
      detalhe: `${pct.toFixed(1)}% de ${emReais(limiteAnual)} já faturados. Ultrapassar o limite muda o enquadramento tributário — vale conversar com seu contador.`,
    }];
  }
  if (pct >= 80) {
    return [{
      id: "limite_mei_80",
      categoria: "limite",
      severidade: "aviso",
      titulo: "Faturamento se aproximando do teto do MEI",
      detalhe: `${pct.toFixed(1)}% de ${emReais(limiteAnual)} já faturados este ano.`,
    }];
  }
  return [];
}

/* ==========================================================================
   4. CERTIFICADO A1 PERTO DE VENCER
   ==========================================================================
   `diasRestantes` já vem calculado pelo servidor (GET /api/nfse/certificado,
   ver nfse.ts) — não recalculamos a data aqui para não correr o risco de as
   duas contas divergirem por um dia por causa de fuso horário.
   ========================================================================== */

export function notificacaoCertificado(
  diasRestantes: number | null | undefined,
  validoAteISO?: string
): Notificacao[] {
  if (diasRestantes === null || diasRestantes === undefined) return [];

  if (diasRestantes < 0) {
    return [{
      id: "certificado_vencido",
      categoria: "certificado",
      severidade: "urgente",
      titulo: "Certificado digital vencido",
      detalhe: `Venceu em ${validoAteISO ? paraBR(validoAteISO) : "data desconhecida"}. Novas notas fiscais não podem ser emitidas até você enviar um certificado válido.`,
      acao: "Atualizar certificado",
    }];
  }
  if (diasRestantes <= 7) {
    return [{
      id: "certificado_7dias",
      categoria: "certificado",
      severidade: "urgente",
      titulo: `Certificado digital vence em ${diasRestantes} ${diasRestantes === 1 ? "dia" : "dias"}`,
      detalhe: "Renove com o mesmo fornecedor e envie o novo arquivo para não parar de emitir NFS-e.",
      acao: "Ver certificado",
    }];
  }
  if (diasRestantes <= 30) {
    return [{
      id: "certificado_30dias",
      categoria: "certificado",
      severidade: "aviso",
      titulo: `Certificado digital vence em ${diasRestantes} dias`,
      detalhe: "Ainda dá tempo com folga, mas vale já providenciar a renovação.",
      acao: "Ver certificado",
    }];
  }
  return [];
}

/* ==========================================================================
   5. BOLETOS EMITIDOS A CLIENTES, VENCIDOS
   ==========================================================================
   Agregado numa linha só — um aviso por cliente inadimplente lotaria o sino
   em qualquer carteira com mais de alguns clientes. Quem quer o detalhe
   clica e vai para a aba "Vencidos" do painel de cobranças.
   ========================================================================== */

export function notificacaoCobrancasVencidas(quantidade: number, valorTotal: number): Notificacao[] {
  if (!quantidade || quantidade <= 0) return [];
  const emReais = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  return [{
    id: "cobrancas_vencidas",
    categoria: "cobranca",
    severidade: "urgente",
    titulo: quantidade === 1 ? "1 boleto vencido" : `${quantidade} boletos vencidos`,
    detalhe: `${emReais(valorTotal)} em aberto, vencidos. Considere reenviar a cobrança para o(s) cliente(s).`,
    acao: "Ver cobranças vencidas",
  }];
}

/* ==========================================================================
   ORDENAÇÃO PARA A LISTA FINAL
   ========================================================================== */

const PESO_CATEGORIA: Record<CategoriaNotificacao, number> = {
  das: 0,
  recebimento: 1,
  certificado: 2,
  cobranca: 3,
  limite: 4,
};

/** Urgente antes de aviso; dentro da mesma severidade, a ordem das categorias acima. */
export function ordenarNotificacoes(itens: Notificacao[]): Notificacao[] {
  return [...itens].sort((a, b) => {
    if (a.severidade !== b.severidade) return a.severidade === "urgente" ? -1 : 1;
    return PESO_CATEGORIA[a.categoria] - PESO_CATEGORIA[b.categoria];
  });
}
