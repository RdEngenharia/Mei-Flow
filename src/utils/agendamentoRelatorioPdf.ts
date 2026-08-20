/**
 * ============================================================================
 * RELATÓRIO MENSAL DE AGENDAMENTOS EM PDF — desenhado, não fotografado
 * ============================================================================
 *
 * Mesmo padrão de `orcamentoPdf.ts`: jsPDF desenhando retângulos, linhas e
 * texto — sem html2canvas, sem depender de CSS carregado, texto selecionável.
 *
 * Diferença de layout: aqui a lista de atendimentos pode não caber numa
 * página só (um mês cheio de agendamentos concluídos), então a tabela tem
 * paginação de verdade — mede a altura de cada linha antes de desenhar e
 * pula de página quando não cabe mais, redesenhando o cabeçalho da tabela.
 */

export type AtendimentoRelatorioPdf = {
  clienteNome?: string;
  concluidoEm?: string;
  duracaoMin?: number;
  valor?: number;
  descricaoServico?: string;
};

export type DadosRelatorioAgendamento = {
  mes: number;
  ano: number;
  totalAgendados?: number;
  totalConcluidos?: number;
  duracaoMediaMin?: number;
  valorRecebido?: number;
  valorPorHora?: number;
  atendimentos: AtendimentoRelatorioPdf[];
};

export type ExtrasRelatorioAgendamento = {
  meiName?: string;
  cnpjPrestador?: string;
  telefonePrestador?: string;
  emailPrestador?: string;
  logoBase64?: string;
  premium?: boolean;
};

const brl = (n: any) =>
  "R$ " + Number(n || 0).toFixed(2).replace(".", ",").replace(/\B(?=(\d{3})+(?!\d))/g, ".");

const MESES = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
];

const dataHoraBR = (iso?: string) => {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  const data = d.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit" });
  const hora = d.toLocaleTimeString("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" });
  return `${data} ${hora}`;
};

const duracaoFmt = (min?: number) => {
  const m = Math.round(Number(min) || 0);
  if (m < 60) return `${m}min`;
  const h = Math.floor(m / 60);
  const resto = m % 60;
  return resto ? `${h}h${String(resto).padStart(2, "0")}` : `${h}h`;
};

const iniciais = (nome?: string) => {
  const p = String(nome || "MEI").trim().split(/\s+/).filter(Boolean);
  if (!p.length) return "MF";
  if (p[0].length <= 3) return p[0].slice(0, 2).toUpperCase();
  return p.filter((w) => w.length > 1).slice(0, 2).map((w) => w[0]).join("").toUpperCase() || "MF";
};

const TINTA = {
  escuro: [15, 23, 42], texto: [51, 65, 85], claro: [100, 116, 139],
  fraco: [148, 163, 184], linha: [203, 213, 225], fundo: [248, 250, 252],
  marca: [79, 70, 229],
} as const;

const M = 14;
const L = 210 - M * 2;
const ALTURA_PAGINA = 297;
const RODAPE_RESERVA = 14;

/**
 * Desenha o relatório mensal. Pode ocupar mais de uma página — quem chama
 * não precisa se preocupar com isso, a função já paginou sozinha.
 */
export function desenharRelatorioAgendamento(
  doc: any,
  d: DadosRelatorioAgendamento,
  extras: ExtrasRelatorioAgendamento = {}
): void {
  const cor = (c: readonly number[]) => doc.setTextColor(c[0], c[1], c[2]);
  const traco = (c: readonly number[]) => doc.setDrawColor(c[0], c[1], c[2]);
  const preenche = (c: readonly number[]) => doc.setFillColor(c[0], c[1], c[2]);

  let y = M;

  // ---------------------------------------------------------------- topo
  const nome = extras.meiName || "—";
  if (extras.logoBase64) {
    try { doc.addImage(extras.logoBase64, "PNG", M, y, 16, 16, undefined, "FAST"); }
    catch { /* logo inválida não pode derrubar o relatório */ }
  } else {
    preenche(TINTA.marca);
    doc.roundedRect(M, y, 16, 16, 3, 3, "F");
    doc.setFont("helvetica", "bold").setFontSize(10);
    doc.setTextColor(255, 255, 255);
    doc.text(iniciais(nome), M + 8, y + 10.5, { align: "center" });
  }

  doc.setFont("helvetica", "bold").setFontSize(14);
  cor(TINTA.escuro);
  doc.text(String(nome).toUpperCase().slice(0, 38), M + 20, y + 6);

  const contato = [
    extras.cnpjPrestador ? `CNPJ ${extras.cnpjPrestador}` : "",
    extras.telefonePrestador || "",
    extras.emailPrestador || "",
  ].filter(Boolean).join("   ·   ");
  if (contato) {
    doc.setFont("helvetica", "normal").setFontSize(7);
    cor(TINTA.claro);
    doc.text(contato.slice(0, 95), M + 20, y + 11);
  }

  const dir = M + L;
  const selo = "RELATÓRIO DE AGENDAMENTOS";
  doc.setFont("helvetica", "bold").setFontSize(7.5);
  const larguraSelo = doc.getTextWidth(selo) + 7;
  preenche(TINTA.escuro);
  doc.roundedRect(dir - larguraSelo, y, larguraSelo, 6.5, 1.5, 1.5, "F");
  doc.setTextColor(255, 255, 255);
  doc.text(selo, dir - 3.5, y + 4.6, { align: "right" });

  doc.setFont("helvetica", "bold").setFontSize(16);
  cor(TINTA.escuro);
  doc.text(`${MESES[(d.mes || 1) - 1] || "—"}/${d.ano || "—"}`, dir, y + 14, { align: "right" });

  y += 21;
  traco(TINTA.marca);
  doc.setLineWidth(0.5);
  doc.line(M, y, M + L * 0.5, y);
  traco(TINTA.linha);
  doc.setLineWidth(0.2);
  doc.line(M + L * 0.5, y, M + L, y);
  y += 7;

  // -------------------------------------------------------------- métricas
  const cards: [string, string][] = [
    ["Agendados no mês", String(d.totalAgendados ?? 0)],
    ["Concluídos no mês", String(d.totalConcluidos ?? 0)],
    ["Tempo médio/serviço", duracaoFmt(d.duracaoMediaMin)],
    ["Valor recebido", brl(d.valorRecebido)],
    ["R$ por hora trabalhada", brl(d.valorPorHora)],
  ];
  const larguraCard = (L - (cards.length - 1) * 3) / cards.length;
  const altCard = 20;
  cards.forEach(([rot, val], i) => {
    const x = M + i * (larguraCard + 3);
    preenche(TINTA.fundo);
    traco(TINTA.linha);
    doc.setLineWidth(0.2);
    doc.roundedRect(x, y, larguraCard, altCard, 2, 2, "FD");
    doc.setFont("helvetica", "bold").setFontSize(5.4);
    cor(TINTA.fraco);
    const rotLinhas: string[] = doc.splitTextToSize(rot.toUpperCase(), larguraCard - 5);
    doc.text(rotLinhas.slice(0, 2), x + 3, y + 5.5);
    doc.setFont("helvetica", "bold").setFontSize(10.5);
    cor(TINTA.escuro);
    doc.text(String(val).slice(0, 16), x + 3, y + altCard - 4.5);
  });
  y += altCard + 8;

  // ---------------------------------------------------------------- tabela
  const colData = L * 0.14;
  const colCliente = L * 0.24;
  const colDuracao = L * 0.12;
  const colValor = L * 0.14;
  const colDesc = L - colData - colCliente - colDuracao - colValor;
  const xCliente = M + colData;
  const xDuracao = xCliente + colCliente;
  const xValor = xDuracao + colDuracao;
  const xDesc = xValor + colValor;

  const desenharCabecalhoTabela = (yy: number) => {
    preenche([241, 245, 249]);
    doc.rect(M, yy, L, 7, "F");
    doc.setFont("helvetica", "bold").setFontSize(5.8);
    cor(TINTA.claro);
    doc.text("DATA", M + 2, yy + 4.6);
    doc.text("CLIENTE", xCliente + 2, yy + 4.6);
    doc.text("DURAÇÃO", xDuracao + 2, yy + 4.6);
    doc.text("VALOR", xValor + colValor - 2, yy + 4.6, { align: "right" });
    doc.text("DESCRIÇÃO DO SERVIÇO", xDesc + 2, yy + 4.6);
    return yy + 7;
  };

  const rotulo = (t: string, x: number, yy: number) => {
    doc.setFont("helvetica", "bold").setFontSize(5.8);
    cor(TINTA.fraco);
    doc.text(t.toUpperCase(), x, yy);
  };
  rotulo("Atendimentos concluídos no mês", M, y);
  y += 3;
  y = desenharCabecalhoTabela(y);

  const atendimentos = d.atendimentos || [];
  if (!atendimentos.length) {
    preenche([255, 255, 255]);
    traco(TINTA.linha);
    doc.setLineWidth(0.2);
    doc.roundedRect(M, y, L, 12, 0, 0, "FD");
    doc.setFont("helvetica", "normal").setFontSize(8);
    cor(TINTA.fraco);
    doc.text("Nenhum atendimento concluído neste mês.", M + L / 2, y + 7.5, { align: "center" });
    y += 12;
  }

  atendimentos.forEach((a) => {
    doc.setFont("helvetica", "normal").setFontSize(7.4);
    const descPartes: string[] = doc.splitTextToSize(a.descricaoServico || "Sem descrição", colDesc - 4);
    const descUsadas = descPartes.slice(0, 3);
    const altura = Math.max(7, descUsadas.length * 3.2 + 2.6);

    // Pula de página se não couber mais essa linha.
    if (y + altura > ALTURA_PAGINA - RODAPE_RESERVA) {
      doc.addPage();
      y = M;
      y = desenharCabecalhoTabela(y);
    }

    traco([241, 245, 249]);
    doc.setLineWidth(0.2);
    doc.rect(M, y, L, altura);

    doc.setFont("helvetica", "normal").setFontSize(7.4);
    cor(TINTA.texto);
    doc.text(dataHoraBR(a.concluidoEm), M + 2, y + 4.4);
    doc.text(String(a.clienteNome || "—").slice(0, 26), xCliente + 2, y + 4.4);
    doc.text(duracaoFmt(a.duracaoMin), xDuracao + 2, y + 4.4);
    doc.setFont("helvetica", "bold").setFontSize(7.4);
    doc.text(brl(a.valor), xValor + colValor - 2, y + 4.4, { align: "right" });
    doc.setFont("helvetica", a.descricaoServico ? "normal" : "italic").setFontSize(7.2);
    cor(a.descricaoServico ? TINTA.texto : TINTA.fraco);
    doc.text(descUsadas, xDesc + 2, y + 4.4);

    y += altura;
  });

  // --------------------------------------------------------------- rodapé
  traco([241, 245, 249]);
  doc.setLineWidth(0.2);
  doc.line(M, ALTURA_PAGINA - 10, M + L, ALTURA_PAGINA - 10);
  doc.setFont("helvetica", "normal").setFontSize(5.8);
  cor(TINTA.fraco);
  doc.text(
    extras.premium ? `Relatório gerado por ${extras.meiName || "MEI Flow"}.` : "Gerado eletronicamente via MEI Flow",
    M + L / 2,
    ALTURA_PAGINA - 6,
    { align: "center" }
  );
}

/** Nome de arquivo previsível: mês, ano, sem acento nem espaço. */
export function nomeArquivoRelatorioAgendamento(d: DadosRelatorioAgendamento): string {
  const mes = String(d.mes || 1).padStart(2, "0");
  return `relatorio_agendamentos_${d.ano || "s-a"}-${mes}.pdf`;
}
