/**
 * ============================================================================
 * ORÇAMENTO EM PDF — desenhado, não fotografado
 * ============================================================================
 *
 * POR QUE ESTE ARQUIVO EXISTE
 *
 * O orçamento saía do "Baixar PDF" pequeno, sem estilo e fora do lugar — o
 * mesmo defeito que a nota fiscal tinha. A causa é a mesma: o html2canvas
 * clona a página num quadro à parte e precisa recarregar a folha de estilo;
 * quando a captura acontece antes de o CSS chegar, ele fotografa HTML cru.
 * A prova: o PDF que o usuário enviou trazia uma imagem de 3808 px de largura
 * para uma folha que na tela tem 672 px.
 *
 * Aqui o PDF é DESENHADO com jsPDF: retângulos, linhas e texto. Não depende de
 * CSS nem de navegador, o texto sai selecionável, o arquivo fica dez vezes
 * menor — e o resultado é idêntico toda vez.
 *
 * ⚠️ AO MEXER NO LEIAUTE: a função devolve a altura usada em mm. O teste
 *    renderiza um orçamento cheio e falha se passar de uma página. Rode-o.
 */

export type ItemOrcamentoPdf = {
  id?: string;
  nome?: string;
  tipo?: string;
  quantidade?: number;
  valorUnitario?: number;
};

export type DadosOrcamento = {
  numero?: string | number;
  createdAt?: string;
  validade?: string;
  clienteNome?: string;
  clienteDocumento?: string;
  clienteEmail?: string;
  clienteTelefone?: string;
  itens?: ItemOrcamentoPdf[];
  observacoes?: string;
  desconto?: number;
  total?: number;
  /**
   * Frase já pronta da condição de pagamento (ver `textoDaCondicao` em
   * utils/recebimentos.ts). Chega como texto, não como objeto: este arquivo
   * só desenha, quem decide o que a frase diz é uma função só, com teste.
   */
  condicaoPagamentoTexto?: string;
};

export type ExtrasOrcamento = {
  meiName?: string;
  cnpjPrestador?: string;
  inscricaoMunicipal?: string;
  telefonePrestador?: string;
  emailPrestador?: string;
  /** Endereço da empresa — faltava, e por isso não saía no papel. */
  enderecoPrestador?: { cep?: string; logradouro?: string; numero?: string; bairro?: string; cidade?: string; uf?: string };
  /** Logo já convertida para data:image/...;base64. */
  logoBase64?: string;
  /** No plano gratuito o rodapé é a assinatura do MEI Flow. */
  premium?: boolean;
};

// ---------------------------------------------------------------------------
// Formatação (mesmas regras da DANFSe, para os dois documentos combinarem)
// ---------------------------------------------------------------------------

const brl = (n: any) =>
  "R$ " + Number(n || 0).toFixed(2).replace(".", ",").replace(/\B(?=(\d{3})+(?!\d))/g, ".");

const soDigitos = (v: any) => String(v || "").replace(/\D/g, "");

const docBR = (v: any) => {
  const n = soDigitos(v);
  if (n.length === 11) return n.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4");
  if (n.length === 14) return n.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, "$1.$2.$3/$4-$5");
  return String(v || "");
};

const foneBR = (v: any) => {
  const n = soDigitos(v);
  if (n.length === 11) return n.replace(/(\d{2})(\d{5})(\d{4})/, "($1) $2-$3");
  if (n.length === 10) return n.replace(/(\d{2})(\d{4})(\d{4})/, "($1) $2-$3");
  return String(v || "");
};

/**
 * Data em pt-BR sem depender de fuso.
 * "2026-08-08" vira 08/08/2026 e não 07/08/2026 — o erro clássico de quem
 * joga uma data sem hora dentro de new Date() em fuso negativo.
 */
const dataBR = (iso?: string) => {
  const s = String(iso || "");
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  const d = new Date(s);
  return isNaN(d.getTime())
    ? "—"
    : `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
};

/**
 * Iniciais para o monograma de quem não tem logo.
 * "RD SOLUCOES DIGITAIS" vira RD, e não RS: sigla curta na frente É a marca.
 */
const iniciais = (nome?: string) => {
  const p = String(nome || "MEI").trim().split(/\s+/).filter(Boolean);
  if (!p.length) return "MF";
  if (p[0].length <= 3) return p[0].slice(0, 2).toUpperCase();
  return p.filter((w) => w.length > 1).slice(0, 2).map((w) => w[0]).join("").toUpperCase() || "MF";
};

const TINTA = { escuro: [15, 23, 42], texto: [51, 65, 85], claro: [100, 116, 139],
                fraco: [148, 163, 184], linha: [203, 213, 225], fundo: [248, 250, 252],
                marca: [79, 70, 229], servico: [245, 158, 11], produto: [16, 185, 129] } as const;

const somaItens = (itens: ItemOrcamentoPdf[]) =>
  itens.reduce((s, it) => s + (Number(it.quantidade) || 0) * (Number(it.valorUnitario) || 0), 0);

// ---------------------------------------------------------------------------
// Desenho
// ---------------------------------------------------------------------------

/**
 * Monta o orçamento. Recebe o jsPDF já instanciado para funcionar igual no
 * servidor e no navegador — quem chama é que sabe como importar a biblioteca.
 *
 * @returns altura ocupada em mm, para o teste conferir que cabe na página.
 */
export function desenharOrcamento(doc: any, d: DadosOrcamento, extras: ExtrasOrcamento = {}): number {
  const M = 14;                  // margem
  const L = 210 - M * 2;         // largura útil = 182mm
  let y = M;

  const cor = (c: readonly number[]) => doc.setTextColor(c[0], c[1], c[2]);
  const traco = (c: readonly number[]) => doc.setDrawColor(c[0], c[1], c[2]);
  const preenche = (c: readonly number[]) => doc.setFillColor(c[0], c[1], c[2]);

  const rotulo = (t: string, x: number, yy: number, tam = 5.8) => {
    doc.setFont("helvetica", "bold").setFontSize(tam);
    cor(TINTA.fraco);
    doc.text(String(t || "").toUpperCase(), x, yy);
  };

  const itens = (d.itens || []).filter((it) => it && (it.nome || it.valorUnitario));
  const subtotal = somaItens(itens);
  const desconto = Number(d.desconto) || 0;
  const total = Number(d.total) || subtotal - desconto;

  // ---------------------------------------------------------------- topo
  const nome = extras.meiName || "—";

  if (extras.logoBase64) {
    try { doc.addImage(extras.logoBase64, "PNG", M, y, 16, 16, undefined, "FAST"); }
    catch { /* logo inválida não pode derrubar o orçamento */ }
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

  const identidade = [
    extras.cnpjPrestador ? `CNPJ ${docBR(extras.cnpjPrestador)}` : "",
    extras.inscricaoMunicipal ? `Insc. Municipal ${extras.inscricaoMunicipal}` : "",
  ].filter(Boolean).join("   ·   ");
  const contato = [
    foneBR(extras.telefonePrestador),
    extras.emailPrestador || "",
  ].filter(Boolean).join("   ·   ");

  /**
   * ⚠️ O ENDEREÇO PRECISA CABER SEM EMPURRAR O RESTO.
   *
   * Ele não existia no cabeçalho — o orçamento saía com nome, CNPJ e telefone e
   * mais nada, o que num documento comercial passa impressão de improviso. Como
   * a folha é medida linha a linha, a linha nova entra aqui e o resto desce
   * junto, sem número mágico espalhado.
   */
  const e = extras.enderecoPrestador || {};
  const endereco = e.logradouro
    ? [
        `${e.logradouro}${e.numero ? ", " + e.numero : ""}${e.bairro ? " — " + e.bairro : ""}`,
        [e.cidade, e.uf].filter(Boolean).join(" / "),
        e.cep ? `CEP ${String(e.cep).replace(/\D/g, "").replace(/(\d{5})(\d{3})/, "$1-$2")}` : "",
      ].filter(Boolean).join("   ·   ")
    : "";

  doc.setFont("helvetica", "normal").setFontSize(7);
  cor(TINTA.claro);
  let yTopo = y + 10.5;
  if (identidade) { doc.text(identidade, M + 20, yTopo); yTopo += 4; }
  if (endereco) { doc.text(String(endereco).slice(0, 95), M + 20, yTopo); yTopo += 4; }
  if (contato) { doc.text(contato, M + 20, yTopo); yTopo += 4; }
  const alturaTopo = Math.max(21, yTopo - y + 1);

  // Bloco do número, à direita.
  // ⚠️ Rótulo alinhado à direita PRECISA usar { align: "right" } na primeira
  //    escrita — tapar texto com retângulo branco foi o que produziu o
  //    "NFS-E NºNFS-E Nº" duplicado na nota fiscal.
  const dir = M + L;
  const selo = "ORÇAMENTO";
  doc.setFont("helvetica", "bold").setFontSize(7.5);
  const larguraSelo = doc.getTextWidth(selo) + 7;
  preenche(TINTA.escuro);
  doc.roundedRect(dir - larguraSelo, y, larguraSelo, 6.5, 1.5, 1.5, "F");
  doc.setTextColor(255, 255, 255);
  doc.text(selo, dir - 3.5, y + 4.6, { align: "right" });

  doc.setFont("helvetica", "bold").setFontSize(16);
  cor(TINTA.escuro);
  doc.text(`Nº ${d.numero || "—"}`, dir, y + 14, { align: "right" });

  doc.setFont("helvetica", "normal").setFontSize(6.8);
  cor(TINTA.fraco);
  doc.text(`Emitido em ${dataBR(d.createdAt)}`, dir, y + 18, { align: "right" });

  y += alturaTopo;
  traco(TINTA.marca);
  doc.setLineWidth(0.5);
  doc.line(M, y, M + L * 0.5, y);
  traco(TINTA.linha);
  doc.setLineWidth(0.2);
  doc.line(M + L * 0.5, y, M + L, y);
  y += 7;

  // -------------------------------------------------------------- cliente
  const contatosCliente: [string, string][] = [];
  if (d.clienteDocumento) contatosCliente.push(["CPF / CNPJ", docBR(d.clienteDocumento)]);
  if (d.clienteTelefone) contatosCliente.push(["Telefone", foneBR(d.clienteTelefone)]);
  if (d.clienteEmail) contatosCliente.push(["E-mail", String(d.clienteEmail)]);

  const altCliente = contatosCliente.length ? 22 : 15;
  preenche(TINTA.fundo);
  traco(TINTA.linha);
  doc.setLineWidth(0.2);
  doc.roundedRect(M, y, L, altCliente, 2, 2, "FD");

  rotulo("Cliente", M + 4, y + 5);
  doc.setFont("helvetica", "bold").setFontSize(11);
  cor(TINTA.escuro);
  doc.text(String(d.clienteNome || "—").slice(0, 60), M + 4, y + 11);

  if (contatosCliente.length) {
    const cc = (L - 8) / contatosCliente.length;
    contatosCliente.forEach(([r, v], i) => {
      rotulo(r, M + 4 + cc * i, y + 16, 5.4);
      doc.setFont("helvetica", "normal").setFontSize(7.4);
      cor(TINTA.texto);
      doc.text(String(v).slice(0, 40), M + 4 + cc * i, y + 19.5);
    });
  }
  y += altCliente + 5;

  // ---------------------------------------------------------------- itens
  /**
   * ⚠️ ALTURA CALCULADA, NÃO CHUTADA.
   *
   * Cada item pode ter uma descrição longa que quebra em duas linhas. Medir
   * antes de desenhar é o que garante que a moldura da tabela termine junto
   * com a última linha — e não no meio dela, como acontecia quando a altura
   * era um número fixo.
   */
  const colDesc = L * 0.56;
  const colQtd = L * 0.10;
  const colUnit = L * 0.16;
  const colTotal = L * 0.18;
  const xQtd = M + colDesc;
  const xUnit = xQtd + colQtd;
  const xTotal = xUnit + colUnit;

  const linhas = itens.map((it) => {
    doc.setFont("helvetica", "normal").setFontSize(8);
    const partes: string[] = doc.splitTextToSize(String(it.nome || "—"), colDesc - 10);
    return { it, partes: partes.slice(0, 2), altura: Math.max(7, partes.slice(0, 2).length * 3.6 + 3.4) };
  });

  const altCabecalho = 7;
  const altTabela = altCabecalho + linhas.reduce((s, l) => s + l.altura, 0);

  rotulo("Itens da proposta", M, y);
  y += 3;

  traco(TINTA.linha);
  doc.setLineWidth(0.2);
  preenche([255, 255, 255]);
  doc.roundedRect(M, y, L, altTabela, 2, 2, "FD");

  preenche([241, 245, 249]);
  doc.rect(M + 0.2, y + 0.2, L - 0.4, altCabecalho - 0.2, "F");
  doc.setFont("helvetica", "bold").setFontSize(5.8);
  cor(TINTA.claro);
  doc.text("DESCRIÇÃO", M + 4, y + 4.6);
  doc.text("QTD.", xQtd + colQtd / 2, y + 4.6, { align: "center" });
  doc.text("VALOR UNIT.", xUnit + colUnit - 3, y + 4.6, { align: "right" });
  doc.text("TOTAL", xTotal + colTotal - 4, y + 4.6, { align: "right" });

  let yLinha = y + altCabecalho;
  linhas.forEach(({ it, partes, altura }, i) => {
    if (i > 0) {
      traco([241, 245, 249]);
      doc.setLineWidth(0.2);
      doc.line(M + 3, yLinha, M + L - 3, yLinha);
    }
    const meio = yLinha + altura / 2 + 1;

    // Bolinha de tipo: âmbar para serviço, verde para produto — igual à tela.
    preenche(String(it.tipo || "").toLowerCase().startsWith("serv") ? TINTA.servico : TINTA.produto);
    doc.circle(M + 5, yLinha + 3.6, 0.9, "F");

    doc.setFont("helvetica", "normal").setFontSize(8);
    cor(TINTA.escuro);
    doc.text(partes, M + 8, yLinha + 4.4);

    doc.setFont("helvetica", "normal").setFontSize(8);
    cor(TINTA.texto);
    doc.text(String(Number(it.quantidade) || 0), xQtd + colQtd / 2, meio, { align: "center" });
    doc.text(brl(it.valorUnitario), xUnit + colUnit - 3, meio, { align: "right" });

    doc.setFont("helvetica", "bold").setFontSize(8);
    cor(TINTA.escuro);
    doc.text(brl((Number(it.quantidade) || 0) * (Number(it.valorUnitario) || 0)), xTotal + colTotal - 4, meio, { align: "right" });

    yLinha += altura;
  });
  y += altTabela + 5;

  // ---------------------------------------------------------- observações
  const obs = String(d.observacoes || "").trim();
  if (obs) {
    doc.setFont("helvetica", "normal").setFontSize(7.6);
    const linhasObs: string[] = doc.splitTextToSize(obs, L - 8);
    const usadas = linhasObs.slice(0, 6);
    const altObs = 8 + usadas.length * 3.4;
    preenche(TINTA.fundo);
    traco(TINTA.linha);
    doc.setLineWidth(0.2);
    doc.roundedRect(M, y, L, altObs, 2, 2, "FD");
    rotulo("Observações", M + 4, y + 5);
    doc.setFont("helvetica", "normal").setFontSize(7.6);
    cor(TINTA.texto);
    doc.text(usadas, M + 4, y + 9.5);
    y += altObs + 5;
  }

  // ------------------------------------------------- condição de pagamento
  //
  // Mesmo molde do bloco de observações, um pouco mais enxuto: é uma frase só.
  // Só ocupa espaço na folha quando a proposta tem entrada/saldo combinados —
  // a maioria das propostas (à vista) sai do PDF exatamente como sempre saiu.
  const condTexto = String(d.condicaoPagamentoTexto || "").trim();
  if (condTexto) {
    doc.setFont("helvetica", "normal").setFontSize(7.6);
    const linhasCond: string[] = doc.splitTextToSize(condTexto, L - 8);
    const usadasCond = linhasCond.slice(0, 3);
    const altCond = 8 + usadasCond.length * 3.4;
    preenche([239, 246, 255]); // blue-50
    traco([191, 219, 254]); // blue-200
    doc.setLineWidth(0.2);
    doc.roundedRect(M, y, L, altCond, 2, 2, "FD");
    rotulo("Condição de pagamento", M + 4, y + 5);
    doc.setFont("helvetica", "normal").setFontSize(7.6);
    doc.setTextColor(30, 64, 175); // blue-800
    doc.text(usadasCond, M + 4, y + 9.5);
    y += altCond + 5;
  }

  // ---------------------------------------------------------- total geral
  const altTotal = 24;
  preenche(TINTA.escuro);
  doc.roundedRect(M, y, L, altTotal, 2.5, 2.5, "F");

  doc.setFont("helvetica", "bold").setFontSize(5.6);
  doc.setTextColor(148, 163, 184);
  doc.text("VALIDADE DA PROPOSTA", M + 5, y + 7);
  doc.setFont("helvetica", "bold").setFontSize(9);
  doc.setTextColor(147, 197, 253);
  doc.text(dataBR(d.validade), M + 5, y + 12);

  if (desconto > 0) {
    doc.setFont("helvetica", "normal").setFontSize(6.4);
    doc.setTextColor(148, 163, 184);
    doc.text(`Subtotal ${brl(subtotal)}   ·   desconto ${brl(desconto)}`, M + 5, y + 18);
  }

  doc.setFont("helvetica", "bold").setFontSize(5.6);
  doc.setTextColor(148, 163, 184);
  doc.text("VALOR TOTAL", M + L - 5, y + 9, { align: "right" });
  doc.setFont("helvetica", "bold").setFontSize(18);
  doc.setTextColor(255, 255, 255);
  doc.text(brl(total), M + L - 5, y + 18, { align: "right" });
  y += altTotal + 14;

  // ----------------------------------------------------------- assinaturas
  const meia = (L - 20) / 2;
  ([["Assinatura do emissor", M], ["Aceite do cliente", M + meia + 20]] as [string, number][])
    .forEach(([texto, x]) => {
      traco(TINTA.linha);
      doc.setLineWidth(0.3);
      doc.line(x, y, x + meia, y);
      doc.setFont("helvetica", "bold").setFontSize(5.8);
      cor(TINTA.fraco);
      doc.text(texto.toUpperCase(), x + meia / 2, y + 4, { align: "center" });
    });
  y += 10;

  // --------------------------------------------------------------- rodapé
  traco([241, 245, 249]);
  doc.setLineWidth(0.2);
  doc.line(M, y, M + L, y);
  doc.setFont("helvetica", "normal").setFontSize(5.8);
  cor(TINTA.fraco);
  doc.text(
    extras.premium
      ? `Obrigado por nos escolher! Atenciosamente, ${extras.meiName || ""}.`
      : "Gerado eletronicamente via MEI Flow",
    M + L / 2, y + 4, { align: "center" }
  );
  y += 6;

  return y;
}

/** Nome de arquivo previsível: número e cliente, sem acento nem espaço. */
export function nomeArquivoOrcamento(d: DadosOrcamento): string {
  const quem = String(d.clienteNome || "cliente")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^\w ]/g, "").trim().replace(/\s+/g, "_");
  return `orcamento_${d.numero || "s-n"}_${quem || "cliente"}.pdf`;
}
