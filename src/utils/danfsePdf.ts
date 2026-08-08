/**
 * ============================================================================
 * DANFSe EM PDF — desenhada, não fotografada
 * ============================================================================
 *
 * POR QUE ESTE ARQUIVO EXISTE
 *
 * A primeira versão gerava o PDF fotografando a tela com html2canvas. O
 * resultado chegou ao usuário assim: texto miúdo, fonte serifada, sem bordas,
 * amontoado no canto — e a imagem embutida tinha 3808 px de largura quando a
 * folha na tela tem 672 px.
 *
 * A causa: o html2canvas clona a página num quadro à parte e precisa recarregar
 * a folha de estilo. Quando a captura acontece antes de o CSS chegar, ele
 * fotografa HTML cru. É uma corrida — funciona às vezes, falha outras.
 *
 * Aqui o PDF é DESENHADO com jsPDF: linhas, retângulos e texto. Não depende de
 * CSS, não depende de navegador, o texto sai selecionável e o arquivo é dez
 * vezes menor. E, o mais importante, o MESMO código roda no servidor — que é o
 * que permite guardar o PDF no Arquivo Digital junto do XML.
 *
 * ⚠️ AO MEXER NO LEIAUTE: a função devolve a altura usada. O teste renderiza a
 *    folha e falha se passar de uma página. Rode-o.
 */

export type DadosDanfse = {
  numeroNfse?: string | number;
  numeroDps?: string | number;
  serie?: string;
  chave?: string;
  emitidaEm?: string;
  competencia?: string;
  ambiente?: string;
  prestador?: {
    nome?: string; cnpj?: string; inscricaoMunicipal?: string; fone?: string;
    email?: string; logradouro?: string; numero?: string; bairro?: string;
    cep?: string; municipio?: string;
  };
  tomador?: { nome?: string; documento?: string; email?: string } | null;
  servico?: {
    descricao?: string; codigoTributacao?: string; codigoNbs?: string;
    localPrestacao?: string; informacoesComplementares?: string;
  };
  valores?: {
    servico?: number; descontoIncondicionado?: number; descontoCondicionado?: number;
    deducoes?: number; liquido?: number; issRetido?: boolean; issTributavel?: boolean;
    aliquota?: number; valorIss?: number; baseCalculo?: number; totalTributos?: number;
  };
  regime?: { opSimpNac?: string };
};

export type ExtrasDanfse = {
  /** Nome fantasia que o usuário cadastrou; costuma ser melhor que a razão social. */
  nomeExibicao?: string;
  municipio?: string;
  /** Endereço e telefone do tomador saem do cadastro de clientes. */
  tomadorEndereco?: { logradouro?: string; numero?: string; bairro?: string; cidade?: string; uf?: string; cep?: string };
  tomadorTelefone?: string;
  tomadorEmail?: string;
  /** Logo em data:image/...;base64 — é assim que o MEI Flow guarda. */
  logoBase64?: string;
  /** QR já pronto, em data:image/png;base64. */
  qrBase64?: string;
  /** Texto oficial do item da lista de serviços. */
  textoServicoOficial?: string;
};

// ---------------------------------------------------------------------------
// Formatação
// ---------------------------------------------------------------------------

const brl = (n: any) =>
  "R$ " + Number(n || 0).toFixed(2).replace(".", ",").replace(/\B(?=(\d{3})+(?!\d))/g, ".");

const soDigitos = (v: any) => String(v || "").replace(/\D/g, "");

const docBR = (v: any) => {
  const n = soDigitos(v);
  if (n.length === 11) return n.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4");
  if (n.length === 14) return n.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, "$1.$2.$3/$4-$5");
  return String(v || "—");
};

const cepBR = (v: any) => {
  const n = soDigitos(v);
  return n.length === 8 ? n.replace(/(\d{5})(\d{3})/, "$1-$2") : String(v || "");
};

const foneBR = (v: any) => {
  const n = soDigitos(v);
  if (n.length === 11) return n.replace(/(\d{2})(\d{5})(\d{4})/, "($1) $2-$3");
  if (n.length === 10) return n.replace(/(\d{2})(\d{4})(\d{4})/, "($1) $2-$3");
  return String(v || "");
};

const dataBR = (iso?: string) => {
  const s = String(iso || "");
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : "—";
};

const competenciaBR = (iso?: string) => {
  const m = String(iso || "").match(/^(\d{4})-(\d{2})/);
  return m ? `${m[2]}/${m[1]}` : "—";
};

const codServico = (c: any) => {
  const n = soDigitos(c);
  return n.length === 6 ? n.replace(/(\d{2})(\d{2})(\d{2})/, "$1.$2.$3") : (n || "—");
};

const codNbs = (c: any) => {
  const n = soDigitos(c);
  return n.length === 9 ? n.replace(/(\d)(\d{4})(\d{2})(\d{2})/, "$1.$2.$3.$4") : (n || "—");
};

/** Chave de 50 dígitos em grupos de 4 — bem mais fácil de conferir a olho. */
const chaveEmGrupos = (c: any) => soDigitos(c).replace(/(.{4})/g, "$1 ").trim();

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

// ---------------------------------------------------------------------------
// Desenho
// ---------------------------------------------------------------------------

const TINTA = { escuro: [15, 23, 42], texto: [51, 65, 85], claro: [100, 116, 139],
                fraco: [148, 163, 184], linha: [203, 213, 225], fundo: [248, 250, 252],
                marca: [79, 70, 229], ok: [5, 150, 105], alerta: [220, 38, 38] } as const;

/**
 * Monta a DANFSe. Recebe o jsPDF já instanciado para funcionar igual no
 * servidor e no navegador — quem chama é que sabe como importar a biblioteca.
 *
 * @returns altura ocupada em mm, para o teste conferir que cabe na página.
 */
export function desenharDanfse(doc: any, d: DadosDanfse, extras: ExtrasDanfse = {}): number {
  const M = 12;                  // margem
  const L = 210 - M * 2;         // largura útil = 186mm
  let y = M;

  const cor = (c: readonly number[]) => doc.setTextColor(c[0], c[1], c[2]);
  const traco = (c: readonly number[]) => doc.setDrawColor(c[0], c[1], c[2]);
  const preenche = (c: readonly number[]) => doc.setFillColor(c[0], c[1], c[2]);

  const rotulo = (t: string, x: number, yy: number) => {
    doc.setFont("helvetica", "bold").setFontSize(5.6);
    cor(TINTA.fraco);
    doc.text(String(t || "").toUpperCase(), x, yy);
  };
  const valor = (t: string, x: number, yy: number, tam = 8, peso: "normal" | "bold" = "normal") => {
    doc.setFont("helvetica", peso).setFontSize(tam);
    cor(TINTA.texto);
    doc.text(String(t ?? "—") || "—", x, yy);
  };

  /** Cabeçalho de bloco: barra clara com o título. */
  const blocoTitulo = (titulo: string, altura: number, destaque = false) => {
    preenche(destaque ? [238, 242, 255] : TINTA.fundo);
    traco(TINTA.linha);
    doc.setLineWidth(0.2);
    doc.roundedRect(M, y, L, altura, 1.5, 1.5, "FD");
    preenche(destaque ? [224, 231, 255] : [241, 245, 249]);
    doc.rect(M + 0.2, y + 0.2, L - 0.4, 5, "F");
    doc.setFont("helvetica", "bold").setFontSize(5.8);
    cor(destaque ? TINTA.marca : TINTA.claro);
    doc.text(titulo.toUpperCase(), M + 3, y + 3.5);
  };

  // ---------------------------------------------------------------- topo
  const nomeTopo = extras.nomeExibicao || d.prestador?.nome || "—";

  if (extras.logoBase64) {
    try { doc.addImage(extras.logoBase64, "PNG", M, y, 14, 14, undefined, "FAST"); }
    catch { /* logo inválida não pode derrubar a nota */ }
  } else {
    preenche(TINTA.marca);
    doc.roundedRect(M, y, 14, 14, 2.5, 2.5, "F");
    doc.setFont("helvetica", "bold").setFontSize(9);
    doc.setTextColor(255, 255, 255);
    doc.text(iniciais(nomeTopo), M + 7, y + 9, { align: "center" });
  }

  doc.setFont("helvetica", "bold").setFontSize(13);
  cor(TINTA.escuro);
  doc.text(String(nomeTopo).slice(0, 42), M + 17, y + 5.5);
  doc.setFont("helvetica", "normal").setFontSize(7);
  cor(TINTA.claro);
  doc.text("Documento Auxiliar da Nota Fiscal de Serviço eletrônica", M + 17, y + 10);

  /**
   * Bloco do número, à direita.
   *
   * ⚠️ Rótulo alinhado à direita PRECISA usar { align: "right" } na primeira
   *    escrita. A versão anterior escrevia à esquerda e tentava tapar com um
   *    retângulo branco — resultado: "NFS-E NºNFS-E Nº" na folha do usuário.
   */
  const dir = M + L;
  doc.setFont("helvetica", "bold").setFontSize(5.6);
  cor(TINTA.fraco);
  doc.text("NFS-E Nº", dir, y + 3, { align: "right" });

  doc.setFont("helvetica", "bold").setFontSize(20);
  cor(TINTA.escuro);
  doc.text(String(d.numeroNfse || d.numeroDps || "—"), dir, y + 11, { align: "right" });

  doc.setFont("helvetica", "normal").setFontSize(6.5);
  cor(TINTA.fraco);
  doc.text(`Série ${d.serie || "—"} · DPS nº ${d.numeroDps || "—"}`, dir, y + 15, { align: "right" });

  // Selo de situação, abaixo da série para não montar por cima dela.
  const ehTeste = String(d.ambiente || "").startsWith("homolog");
  const selo = ehTeste ? "TESTE — SEM VALIDADE FISCAL" : "AUTORIZADA";
  doc.setFont("helvetica", "bold").setFontSize(5.8);
  const larguraSelo = doc.getTextWidth(selo) + 5;
  preenche(ehTeste ? [254, 226, 226] : [209, 250, 229]);
  traco(ehTeste ? [252, 165, 165] : [110, 231, 183]);
  doc.setLineWidth(0.2);
  doc.roundedRect(dir - larguraSelo, y + 17, larguraSelo, 5, 1.2, 1.2, "FD");
  cor(ehTeste ? TINTA.alerta : TINTA.ok);
  doc.text(selo, dir - 2.5, y + 20.4, { align: "right" });

  y += 24;

  // linha de marca
  traco(TINTA.marca);
  doc.setLineWidth(0.5);
  doc.line(M, y, M + L * 0.55, y);
  y += 6;

  // ------------------------------------------------------------- datas
  const col = L / 4;
  const datas: [string, string][] = [
    ["Emissão", dataBR(String(d.emitidaEm || "").slice(0, 10))],
    ["Competência", competenciaBR(d.competencia)],
    ["Local da prestação", extras.municipio || (d.servico?.localPrestacao ? `IBGE ${d.servico.localPrestacao}` : "—")],
    ["Ambiente", ehTeste ? "Homologação" : "Produção"],
  ];
  datas.forEach(([r, v], i) => {
    rotulo(r, M + col * i, y);
    valor(v, M + col * i, y + 4, 7.5, "bold");
  });
  y += 8;

  // ------------------------------------------- prestador / tomador
  /**
   * ⚠️ ALTURA CALCULADA, NÃO CHUTADA.
   *
   * Com 40mm fixos, a última linha (regime tributário / município) ficava com o
   * rótulo dentro e o valor fora do cartão — aparecia um rótulo solto no papel.
   * São 4 linhas, e a do endereço ocupa duas.
   */
  const alturaPartes = 53;
  const meia = (L - 3) / 2;

  const parte = (x: number, titulo: string, destaque: boolean, linhas: [string, string][], nome: string, sub?: string) => {
    preenche(destaque ? [238, 242, 255] : [241, 245, 249]);
    traco(TINTA.linha);
    doc.setLineWidth(0.2);
    doc.roundedRect(x, y, meia, alturaPartes, 1.5, 1.5, "FD");
    preenche([255, 255, 255]);
    doc.rect(x + 0.2, y + 5, meia - 0.4, alturaPartes - 5.2, "F");
    doc.setFont("helvetica", "bold").setFontSize(5.8);
    cor(destaque ? TINTA.marca : TINTA.claro);
    doc.text(titulo.toUpperCase(), x + 3, y + 3.5);

    doc.setFont("helvetica", "bold").setFontSize(9);
    cor(TINTA.escuro);
    doc.text(String(nome).slice(0, 38), x + 3, y + 10);
    if (sub) {
      doc.setFont("helvetica", "normal").setFontSize(6.2);
      cor(TINTA.claro);
      doc.text(String(sub).slice(0, 52), x + 3, y + 13.5);
    }

    let yy = y + 18;
    linhas.forEach(([r, v]) => {
      rotulo(r, x + 3, yy);
      const texto = doc.splitTextToSize(String(v || "—"), meia - 6);
      doc.setFont("helvetica", "normal").setFontSize(6.8);
      cor(TINTA.texto);
      doc.text(texto.slice(0, 2), x + 3, yy + 3);
      yy += 3 + texto.slice(0, 2).length * 2.9 + 1.2;
    });
  };

  const p = d.prestador || {};
  const endPrest = p.logradouro
    ? `${p.logradouro}${p.numero ? ", " + p.numero : ""}${p.bairro ? " — " + p.bairro : ""}` +
      `${extras.municipio ? "\n" + extras.municipio : ""}${p.cep ? " · CEP " + cepBR(p.cep) : ""}`
    : "—";

  parte(M, "Prestador do serviço", true, [
    ["CNPJ · Inscrição Municipal", `${docBR(p.cnpj)}   ·   ${p.inscricaoMunicipal || "—"}`],
    ["Endereço", endPrest],
    ["Telefone · E-mail", `${foneBR(p.fone) || "—"}   ·   ${p.email || "—"}`],
    ["Regime tributário", d.regime?.opSimpNac === "3" ? "Simples Nacional — ME/EPP"
      : d.regime?.opSimpNac === "1" ? "Não optante pelo Simples Nacional"
      : "Simples Nacional — MEI"],
  ], extras.nomeExibicao || p.nome || "—", extras.nomeExibicao && p.nome !== extras.nomeExibicao ? p.nome : undefined);

  const t = d.tomador;
  const e = extras.tomadorEndereco;
  const endToma = e?.logradouro
    ? `${e.logradouro}${e.numero ? ", " + e.numero : ""}${e.bairro ? " — " + e.bairro : ""}` +
      `${e.cidade ? "\n" + e.cidade : ""}${e.uf ? " / " + e.uf : ""}${e.cep ? " · CEP " + cepBR(e.cep) : ""}`
    : "Não informado no cadastro";

  if (t) {
    parte(M + meia + 3, "Tomador do serviço", false, [
      ["CPF / CNPJ", docBR(t.documento)],
      ["Endereço", endToma],
      ["Telefone · E-mail", `${foneBR(extras.tomadorTelefone) || "—"}   ·   ${t.email || extras.tomadorEmail || "—"}`],
      ["Município de incidência do ISSQN", `${extras.municipio || "—"}${d.servico?.localPrestacao ? "  IBGE " + d.servico.localPrestacao : ""}`],
    ], t.nome || "—", soDigitos(t.documento).length === 14 ? "Pessoa jurídica" : "Pessoa física");
  } else {
    const x = M + meia + 3;
    preenche([241, 245, 249]);
    traco(TINTA.linha);
    doc.roundedRect(x, y, meia, alturaPartes, 1.5, 1.5, "FD");
    preenche([255, 255, 255]);
    doc.rect(x + 0.2, y + 5, meia - 0.4, alturaPartes - 5.2, "F");
    doc.setFont("helvetica", "bold").setFontSize(5.8);
    cor(TINTA.claro);
    doc.text("TOMADOR DO SERVIÇO", x + 3, y + 3.5);
    doc.setFont("helvetica", "bold").setFontSize(8);
    cor(TINTA.claro);
    doc.text("Tomador não identificado", x + meia / 2, y + alturaPartes / 2, { align: "center" });
    doc.setFont("helvetica", "normal").setFontSize(6);
    cor(TINTA.fraco);
    doc.text("A nota foi emitida sem identificação do cliente.", x + meia / 2, y + alturaPartes / 2 + 4, { align: "center" });
  }
  y += alturaPartes + 3;

  // ------------------------------------------------------------ serviço
  const descricao = doc.splitTextToSize(String(d.servico?.descricao || "—"), L - 6);
  const oficial = extras.textoServicoOficial
    ? doc.splitTextToSize(extras.textoServicoOficial, L - 6) : [];
  const altServico = 14 + descricao.length * 3.4 + (oficial.length ? oficial.slice(0, 3).length * 2.8 + 3 : 0);
  blocoTitulo("Discriminação do serviço", altServico);
  doc.setFont("helvetica", "normal").setFontSize(8.5);
  cor(TINTA.escuro);
  doc.text(descricao, M + 3, y + 9.5);

  let yServ = y + 9.5 + descricao.length * 3.4 + 1.5;
  const c3 = (L - 6) / 3;
  ([["Cód. Tributação Nacional", codServico(d.servico?.codigoTributacao)],
    ["Cód. NBS", codNbs(d.servico?.codigoNbs)],
    ["Local da prestação", d.servico?.localPrestacao || "—"]] as [string, string][])
    .forEach(([r, v], i) => {
      rotulo(r, M + 3 + c3 * i, yServ);
      valor(v, M + 3 + c3 * i, yServ + 3.4, 7.5, "bold");
    });
  if (oficial.length) {
    doc.setFont("helvetica", "normal").setFontSize(5.8);
    cor(TINTA.fraco);
    doc.text(oficial.slice(0, 3), M + 3, yServ + 8);
  }
  y += altServico + 3;

  // --------------------------------------------------------- tributação
  blocoTitulo("Tributação", 13);
  const c5 = (L - 6) / 5;
  ([["Tipo de tributação", d.valores?.issTributavel === false ? "Não tributável" : "Operação tributável"],
    ["Retenção do ISSQN", d.valores?.issRetido ? "Retido" : "Não retido"],
    ["Base de cálculo", d.valores?.baseCalculo ? brl(d.valores.baseCalculo) : "—"],
    ["Alíquota", d.valores?.aliquota ? `${d.valores.aliquota}%` : "—"],
    ["ISSQN apurado", d.valores?.valorIss ? brl(d.valores.valorIss) : "—"]] as [string, string][])
    .forEach(([r, v], i) => {
      rotulo(r, M + 3 + c5 * i, y + 8);
      valor(v, M + 3 + c5 * i, y + 11.3, 7);
    });
  y += 16;

  // ------------------------------------------ informações complementares
  const info = String(d.servico?.informacoesComplementares || "").trim();
  const infoLinhas = info ? doc.splitTextToSize(info, L - 6) : [];
  const altInfo = 9 + Math.max(1, infoLinhas.slice(0, 4).length) * 3.2 + 4;
  blocoTitulo("Informações complementares", altInfo);
  if (infoLinhas.length) {
    doc.setFont("helvetica", "normal").setFontSize(7);
    cor(TINTA.texto);
    doc.text(infoLinhas.slice(0, 4), M + 3, y + 9);
  }
  doc.setFont("helvetica", "normal").setFontSize(5.8);
  cor(TINTA.fraco);
  doc.text(
    `Totais aproximados dos tributos conforme Lei nº 12.741/2012: ${d.valores?.totalTributos ? brl(d.valores.totalTributos) : "não informado"}.`,
    M + 3, y + altInfo - 2.5
  );
  y += altInfo + 3;

  // ------------------------------------------------------------ valores
  const altVal = 22;
  preenche(TINTA.escuro);
  doc.roundedRect(M, y, L, altVal, 2, 2, "F");
  const larguraTotal = 52;
  preenche([30, 41, 59]);
  doc.roundedRect(M + L - larguraTotal, y, larguraTotal, altVal, 2, 2, "F");
  doc.rect(M + L - larguraTotal, y, 3, altVal, "F");

  const cv = (L - larguraTotal - 8) / 3;
  const linhasVal: [string, string][] = [
    ["Valor do serviço", brl(d.valores?.servico)],
    ["Desconto incondicionado", brl(d.valores?.descontoIncondicionado)],
    ["Deduções / Reduções", brl(d.valores?.deducoes)],
    ["Desconto condicionado", brl(d.valores?.descontoCondicionado)],
    ["ISSQN retido", brl(d.valores?.issRetido ? d.valores?.valorIss : 0)],
    ["Total das retenções", brl(d.valores?.issRetido ? d.valores?.valorIss : 0)],
  ];
  linhasVal.forEach(([r, v], i) => {
    const x = M + 4 + cv * (i % 3);
    const yy = y + 7 + Math.floor(i / 3) * 9;
    doc.setFont("helvetica", "bold").setFontSize(5.4);
    doc.setTextColor(148, 163, 184);
    doc.text(r.toUpperCase(), x, yy);
    doc.setFont("helvetica", "normal").setFontSize(7.2);
    doc.setTextColor(241, 245, 249);
    doc.text(v, x, yy + 3.6);
  });

  doc.setFont("helvetica", "bold").setFontSize(5.4);
  doc.setTextColor(148, 163, 184);
  doc.text("VALOR LÍQUIDO DA NFS-E", M + L - 4, y + 8, { align: "right" });
  doc.setFont("helvetica", "bold").setFontSize(15);
  doc.setTextColor(255, 255, 255);
  doc.text(brl(d.valores?.liquido || d.valores?.servico), M + L - 4, y + 16, { align: "right" });
  y += altVal + 3;

  // -------------------------------------------------------- verificação
  const altQr = 26;
  preenche([248, 250, 252]);
  traco(TINTA.linha);
  doc.setLineWidth(0.2);
  doc.roundedRect(M, y, L, altQr, 1.5, 1.5, "FD");

  if (extras.qrBase64) {
    try { doc.addImage(extras.qrBase64, "PNG", M + 3, y + 3, 20, 20, undefined, "FAST"); }
    catch { /* sem QR, a chave impressa resolve */ }
  }
  rotulo("Chave de acesso da NFS-e", M + 27, y + 6);
  doc.setFont("courier", "normal").setFontSize(7.4);
  cor(TINTA.escuro);
  doc.text(doc.splitTextToSize(chaveEmGrupos(d.chave) || "—", L - 32).slice(0, 2), M + 27, y + 10.5);
  doc.setFont("helvetica", "normal").setFontSize(6.2);
  cor(TINTA.claro);
  doc.text(
    doc.splitTextToSize(
      "Aponte a câmera para o código ou consulte a chave em nfse.gov.br para conferir a autenticidade desta nota.",
      L - 32
    ).slice(0, 2),
    M + 27, y + 18
  );
  y += altQr + 4;

  // ------------------------------------------------------------- rodapé
  traco([241, 245, 249]);
  doc.setLineWidth(0.2);
  doc.line(M, y, M + L, y);
  doc.setFont("helvetica", "normal").setFontSize(5.6);
  cor(TINTA.fraco);
  doc.text(
    "Documento auxiliar da NFS-e, gerado a partir do arquivo XML da nota. O documento fiscal é o próprio XML, guardado no Arquivo Digital.",
    M, y + 4
  );
  doc.text("Emitido via MEI Flow", M + L, y + 4, { align: "right" });
  y += 6;

  return y;
}

/** Nome de arquivo previsível: número da NFS-e e série. */
export function nomeArquivoDanfse(d: DadosDanfse): string {
  return `NFSe_${d.numeroNfse || d.numeroDps || "s-n"}_${d.serie || "00001"}.pdf`;
}
