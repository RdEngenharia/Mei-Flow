/**
 * ============================================================================
 * DANFSe v2.0 — conforme a Nota Técnica SE/CGNFS-e nº 008/2026
 * ============================================================================
 *
 * POR QUE ESTE ARQUIVO FOI REESCRITO
 *
 * A folha anterior era desenhada por nós, com o leiaute que achamos bonito. O
 * usuário levantou a dúvida certa — "tenho medo dele ser rejeitado por ser
 * diferente" — e a checagem confirmou o receio: a NT 008/2026 não descreve
 * quais informações devem constar, ela DEFINE O DESENHO. Ordem fixa dos
 * blocos, rótulos literais, corpos de fonte, espessura das linhas, sombreado.
 * E o prazo já venceu: a API que gerava a DANFSe oficial foi suspensa em
 * 03/08/2026, o que torna a geração própria obrigatória — e, com ela, o
 * cumprimento do leiaute.
 *
 * DE ONDE VIERAM AS MEDIDAS
 *
 * Não do texto da norma, e sim de uma DANFSe v2.0 emitida pelo próprio Portal
 * para o CNPJ do usuário. O PDF foi aberto e as posições extraídas: as quatro
 * colunas caem em 11,9 / 156,5 / 301,0 / 445,6 pontos, e a linha tem 19,1
 * pontos de altura. Copiar do documento oficial é mais confiável do que
 * interpretar prosa.
 *
 * ⚠️ A LOGO DO MEI NÃO ENTRA MAIS AQUI.
 *
 * O cabeçalho do modelo é da marca NFS-e, não do emissor. Perdemos a folha
 * bonita com a logo — mas ela continua no orçamento, que é documento comercial
 * dele e não tem norma nenhuma ditando o formato.
 *
 * ⚠️ AO MEXER: qualquer mudança de posição ou de rótulo aqui é desvio da
 *    norma. Se precisar mexer, confira antes contra o Anexo I.
 */

export type DadosDanfse = {
  numeroNfse?: string | number;
  numeroDps?: string | number;
  serie?: string;
  chave?: string;
  emitidaEm?: string;
  emitidaEmDps?: string;
  competencia?: string;
  ambiente?: string;
  ambienteGerador?: string;
  situacao?: string;
  finalidade?: string;
  emitente?: string;
  /** Nome da cidade, lido do próprio XML da nota (xLocPrestacao / xLocEmi). */
  municipio?: string;
  prestador?: {
    nome?: string; cnpj?: string; inscricaoMunicipal?: string; fone?: string;
    email?: string; logradouro?: string; numero?: string; bairro?: string;
    cep?: string; municipio?: string; uf?: string;
    regimeApuracao?: string;
  };
  tomador?: {
    nome?: string; documento?: string; email?: string; fone?: string;
    inscricaoMunicipal?: string; logradouro?: string; numero?: string; bairro?: string;
    cep?: string; municipio?: string; uf?: string; codigoIbge?: string;
  } | null;
  servico?: {
    descricao?: string; codigoTributacao?: string; codigoTributacaoMunicipal?: string;
    codigoNbs?: string; localPrestacao?: string; informacoesComplementares?: string;
    descricaoOficial?: string; descricaoNbs?: string;
  };
  valores?: {
    servico?: number; descontoIncondicionado?: number; descontoCondicionado?: number;
    deducoes?: number; liquido?: number; issRetido?: boolean; issTributavel?: boolean;
    aliquota?: number; valorIss?: number; baseCalculo?: number; totalTributos?: number;
    totalRetencoes?: number; totalIbsCbs?: number; liquidoComIbsCbs?: number;
    tributosFederais?: number; tributosEstaduais?: number; tributosMunicipais?: number;
  };
  regime?: { opSimpNac?: string };
};

export type ExtrasDanfse = {
  /** Nome cadastrado. Reserva para quando o XML não trouxer o nome do emissor. */
  nomeExibicao?: string;
  municipio?: string;
  tomadorEndereco?: { logradouro?: string; numero?: string; bairro?: string; cidade?: string; uf?: string; cep?: string };
  tomadorTelefone?: string;
  tomadorEmail?: string;
  /**
   * ⚠️ Mantido só por compatibilidade com quem chama — a NT 008/2026 não
   *    prevê logo do emissor no DANFSe. É ignorado de propósito.
   */
  logoBase64?: string;
  /** QR já pronto, em data:image/png;base64. */
  qrBase64?: string;
  textoServicoOficial?: string;
  textoNbs?: string;
};

// ---------------------------------------------------------------------------
// Formatação
// ---------------------------------------------------------------------------

const brl = (n: any) =>
  "R$ " + Number(n || 0).toFixed(2).replace(".", ",").replace(/\B(?=(\d{3})+(?!\d))/g, ".");

const soDigitos = (v: any) => String(v || "").replace(/\D/g, "");

/** Traço simples é como a folha oficial representa campo sem valor. */
const ou = (v: any) => {
  const s = String(v ?? "").trim();
  return s === "" ? "-" : s;
};

const docBR = (v: any) => {
  const n = soDigitos(v);
  if (n.length === 11) return n.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4");
  if (n.length === 14) return n.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, "$1.$2.$3/$4-$5");
  return n ? String(v) : "-";
};

/**
 * CEP no formato do modelo oficial: 45.810-000.
 *
 * ⚠️ NÃO é o 45810-000 do dia a dia. A folha do Portal pontua os dois
 *    primeiros dígitos, e como a conformidade é comparada campo a campo com o
 *    documento oficial, seguimos o que ele imprime — não o que é costume.
 */
const cepBR = (v: any) => {
  const n = soDigitos(v);
  return n.length === 8 ? `${n.slice(0, 2)}.${n.slice(2, 5)}-${n.slice(5)}` : "";
};

/** O oficial imprime o IBGE pontuado: 29.25303 */
const ibgeBR = (v: any) => {
  const n = soDigitos(v);
  return n.length === 7 ? `${n.slice(0, 2)}.${n.slice(2)}` : "";
};

const foneBR = (v: any) => {
  const n = soDigitos(v);
  if (n.length === 11) return n.replace(/(\d{2})(\d{5})(\d{4})/, "($1) $2-$3");
  if (n.length === 10) return n.replace(/(\d{2})(\d{4})(\d{4})/, "($1) $2-$3");
  return "";
};

const dataBR = (iso?: string) => {
  const m = String(iso || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : "";
};

/** "08/08/2026 09:15:40" — o oficial imprime data e hora juntas. */
const dataHoraBR = (iso?: string) => {
  const s = String(iso || "");
  const d = dataBR(s);
  const h = s.match(/T(\d{2}):(\d{2}):(\d{2})/);
  return d ? (h ? `${d} ${h[1]}:${h[2]}:${h[3]}` : d) : "";
};

const codServico = (c: any) => {
  const n = soDigitos(c);
  return n.length === 6 ? n.replace(/(\d{2})(\d{2})(\d{2})/, "$1.$2.$3") : "";
};

const codNbs = (c: any) => {
  const n = soDigitos(c);
  return n.length === 9 ? n.replace(/(\d)(\d{4})(\d{2})(\d{2})/, "$1.$2.$3.$4") : "";
};

/** Regime do prestador, com o texto do modelo oficial. */
const textoSimplesNacional = (op?: string) => {
  if (op === "1") return "Não Optante";
  if (op === "3") return "Optante - Microempresa ou Empresa de Pequeno Porte";
  if (op === "2") return "Optante - Microempreendedor Individual";
  return "-";
};

// ---------------------------------------------------------------------------
// Medidas, tiradas da DANFSe oficial (pontos → milímetros)
// ---------------------------------------------------------------------------

const PT = 2.834645669;
const mm = (pontos: number) => pontos / PT;

/** As quatro colunas do modelo: 11,9 / 156,5 / 301,0 / 445,6 pontos. */
const COL = [mm(11.9), mm(156.5), mm(301.0), mm(445.6)];
/** Moldura externa e limite direito do conteúdo. */
const BORDA = mm(6);
const DIR = 210 - mm(11.9);
/** Altura da linha da grade: 19,1 pontos. */
const LINHA = mm(19.1);

const CINZA = 236;   // sombreado claro do modelo

// ---------------------------------------------------------------------------
// Desenho
// ---------------------------------------------------------------------------

/** Uma célula da grade: em qual coluna começa e quantas colunas ocupa. */
type Celula = { c: number; span?: number; rotulo?: string; valor?: string; negrito?: boolean };

/**
 * Monta a DANFSe v2.0. Recebe o jsPDF já instanciado para funcionar igual no
 * servidor e no navegador.
 *
 * @returns altura ocupada em mm, para o teste conferir que cabe na página.
 */
export function desenharDanfse(doc: any, d: DadosDanfse, extras: ExtrasDanfse = {}): number {
  const p = d.prestador || {};
  const t = d.tomador;
  const v = d.valores || {};
  const s = d.servico || {};
  const ehTeste = String(d.ambiente || "").startsWith("homolog");

  /**
   * ⚠️ FONTE: a norma pede Arial nos títulos e Microsoft Sans Serif no
   *    conteúdo. Nenhuma das duas pode ser embutida legalmente (são da
   *    Monotype e da Microsoft). Usamos Helvetica, que é METRICAMENTE
   *    IDÊNTICA à Arial — mesma largura de cada caractere. No papel o
   *    resultado é indistinguível, e é a substituição que a indústria inteira
   *    faz. Trocar por fonte de métrica diferente quebraria o alinhamento.
   */
  const FONTE = "helvetica";

  const linhaFina = () => { doc.setDrawColor(0, 0, 0); doc.setLineWidth(mm(0.5)); };
  const linhaGrossa = () => { doc.setDrawColor(0, 0, 0); doc.setLineWidth(mm(1)); };

  /**
   * Título de bloco: 7 pt, negrito.
   *
   * ⚠️ NÃO aplique toUpperCase aqui. O modelo escreve "NÚMERO DA NFS-e" e
   *    "VALOR TOTAL DA NFS-e" com o "e" minúsculo — é assim que a marca se
   *    escreve. Forçar maiúsculas produzia "NFS-E", que não existe em lugar
   *    nenhum do documento oficial. Os rótulos abaixo já vêm na grafia certa.
   */
  const tituloBloco = (texto: string, x: number, y: number) => {
    doc.setFont(FONTE, "bold").setFontSize(7);
    doc.setTextColor(0, 0, 0);
    doc.text(String(texto), x, y);
  };
  /** Rótulo de campo: 6 pt, negrito. */
  const rotuloCampo = (texto: string, x: number, y: number) => {
    doc.setFont(FONTE, "bold").setFontSize(6);
    doc.setTextColor(0, 0, 0);
    doc.text(String(texto), x, y);
  };
  /**
   * Conteúdo: 7 pt, normal, cortado com reticências quando não cabe.
   *
   * Cortar aqui não é escolha nossa: é o que a folha oficial faz — ela imprime
   * "Optante - Microempreendedor Individua...". A grade tem largura fixa, e
   * respeitar a coluna é mais importante do que mostrar o texto inteiro.
   */
  const conteudo = (texto: string, x: number, y: number, largura: number) => {
    doc.setFont(FONTE, "normal").setFontSize(7);
    doc.setTextColor(0, 0, 0);
    const txt = String(texto ?? "");
    if (doc.getTextWidth(txt) <= largura) { doc.text(txt, x, y); return; }
    let corte = txt;
    while (corte.length > 1 && doc.getTextWidth(corte + "...") > largura) corte = corte.slice(0, -1);
    doc.text(corte + "...", x, y);
  };

  let y = BORDA;

  const larguraDe = (c: number, span = 1) => {
    const fim = c + span < COL.length ? COL[c + span] : DIR;
    return fim - COL[c] - 2;
  };

  /** Desenha uma linha da grade e avança o cursor vertical. */
  const linha = (celulas: Celula[], opcoes: { titulo?: boolean; fundo?: boolean; altura?: number } = {}) => {
    const alt = opcoes.altura ?? LINHA;

    if (opcoes.fundo) {
      doc.setFillColor(CINZA, CINZA, CINZA);
      doc.rect(BORDA, y, 210 - BORDA * 2, alt, "F");
    } else if (opcoes.titulo) {
      doc.setFillColor(CINZA, CINZA, CINZA);
      doc.rect(BORDA, y, COL[1] - 2 - BORDA, alt, "F");
    }

    for (const cel of celulas) {
      const x = COL[cel.c];
      const largura = larguraDe(cel.c, cel.span);
      if (cel.rotulo) {
        if (cel.negrito) tituloBloco(cel.rotulo, x, y + mm(7.2));
        else rotuloCampo(cel.rotulo, x, y + mm(7.2));
      }
      if (cel.valor !== undefined) conteudo(cel.valor, x, y + mm(16.2), largura);
    }

    y += alt;
    linhaFina();
    doc.line(BORDA, y, 210 - BORDA, y);
  };

  // =================================================================== topo
  /**
   * CABEÇALHO — marca NFS-e à esquerda, identificação do documento ao centro,
   * dados do ambiente à direita.
   *
   * A marca oficial é uma imagem que não temos direito de embutir, então ela é
   * desenhada com o próprio nome, como ela se apresenta: "NFS" escuro e "e"
   * verde, com a legenda de duas linhas ao lado.
   */
  const altTopo = mm(38);
  doc.setFont(FONTE, "bold").setFontSize(19);
  doc.setTextColor(20, 78, 60);
  doc.text("NFS", BORDA + 2, y + mm(26));
  const larguraNfs = doc.getTextWidth("NFS");
  doc.setTextColor(124, 174, 62);
  doc.text("e", BORDA + 2 + larguraNfs + 0.8, y + mm(26));
  doc.setFont(FONTE, "normal").setFontSize(6);
  doc.setTextColor(70, 70, 70);
  doc.text("Nota Fiscal de", BORDA + 2 + larguraNfs + 4.6, y + mm(21));
  doc.text("Serviço eletrônica", BORDA + 2 + larguraNfs + 4.6, y + mm(28));

  doc.setFont(FONTE, "bold").setFontSize(9);
  doc.setTextColor(0, 0, 0);
  doc.text("DANFSe v2.0", 210 / 2, y + mm(15), { align: "center" });
  doc.text("Documento Auxiliar da NFS-e", 210 / 2, y + mm(27), { align: "center" });

  /**
   * ⚠️ MENSAGEM OBRIGATÓRIA DA NOTA DE HOMOLOGAÇÃO.
   *
   * A norma exige exatamente "NFS-e SEM VALIDADE JURÍDICA", em negrito, 9
   * pontos, vermelho sólido, logo abaixo do título. O texto anterior era
   * inventado por nós ("TESTE — SEM VALIDADE FISCAL") e não cumpria a norma.
   */
  if (ehTeste) {
    doc.setFont(FONTE, "bold").setFontSize(9);
    doc.setTextColor(255, 0, 0);
    doc.text("NFS-e SEM VALIDADE JURÍDICA", 210 / 2, y + mm(36), { align: "center" });
  }

  doc.setFont(FONTE, "normal").setFontSize(7.5);
  doc.setTextColor(0, 0, 0);
  doc.text(`Município: ${ou(d.municipio || extras.municipio)}${p.uf ? " - " + p.uf : ""}`, COL[3], y + mm(13));
  doc.setFontSize(6);
  doc.text(`Ambiente Gerador: ${ou(d.ambienteGerador || "2")}`, COL[3], y + mm(22));
  doc.text(`Tipo de Ambiente: ${ehTeste ? "2" : "1"}`, COL[3], y + mm(30));

  y += altTopo;
  linhaFina();
  doc.line(BORDA, y, 210 - BORDA, y);

  // ======================================================= chave de acesso
  const yQr = y;
  linha([{ c: 0, span: 3, rotulo: "CHAVE DE ACESSO DA NFS-e", negrito: true, valor: ou(soDigitos(d.chave)) }]);

  if (extras.qrBase64) {
    /**
     * QR obrigatório, mínimo de 1,52 cm × 1,52 cm pela norma — aqui 20 mm. O
     * conteúdo é o endereço da consulta pública nacional, extraído do QR da
     * própria DANFSe do Portal e não deduzido.
     */
    try { doc.addImage(extras.qrBase64, "PNG", COL[3] + 12, yQr + 1.2, 16, 16, undefined, "FAST"); }
    catch { /* sem QR, a chave impressa resolve */ }
  }

  linha([
    { c: 0, rotulo: "NÚMERO DA NFS-e", negrito: true, valor: ou(d.numeroNfse) },
    { c: 1, rotulo: "COMPETÊNCIA DA NFS-e", negrito: true, valor: ou(dataBR(d.competencia)) },
    { c: 2, rotulo: "DATA E HORA DA EMISSÃO DA NFS-e", negrito: true, valor: ou(dataHoraBR(d.emitidaEm)) },
  ]);
  linha([
    { c: 0, rotulo: "NÚMERO DA DPS", negrito: true, valor: ou(d.numeroDps) },
    { c: 1, rotulo: "SÉRIE DA DPS", negrito: true, valor: ou(Number(soDigitos(d.serie)) || d.serie) },
    { c: 2, rotulo: "DATA E HORA DA EMISSÃO DA DPS", negrito: true, valor: ou(dataHoraBR(d.emitidaEmDps || d.emitidaEm)) },
  ]);
  linha([
    { c: 0, rotulo: "EMITENTE DA NFS-e", negrito: true, valor: ou(d.emitente || "Prestador") },
    { c: 1, rotulo: "SITUAÇÃO DA NFS-e", negrito: true, valor: ou(d.situacao || (d.regime?.opSimpNac === "2" ? "NFS-e MEI" : "NFS-e")) },
    { c: 2, rotulo: "FINALIDADE", negrito: true, valor: ou(d.finalidade) },
  ]);

  // Legenda do QR, três linhas de 6 pontos, como no modelo.
  doc.setFont(FONTE, "normal").setFontSize(6);
  doc.setTextColor(0, 0, 0);
  /**
   * ⚠️ A legenda precisa caber ENTRE o QR e o bloco do prestador.
   *
   * Na primeira montagem ela foi desenhada 25 mm abaixo do topo e caiu em cima
   * do telefone do prestador — duas informações escritas uma sobre a outra. O
   * espaço disponível é o que sobra das quatro linhas de identificação, então
   * as três linhas ficam com 2 mm de entrelinha.
   */
  doc.text([
    "A autenticidade desta NFS-e pode ser verificada",
    "pela leitura deste código QR ou pela consulta da",
    "chave de acesso no portal nacional da NFS-e",
  ], COL[3], yQr + 21.8, { lineHeightFactor: 1.0 });

  // ============================================== prestador / fornecedor
  const juntar = (partes: any[], sep = " / ") => partes.filter(Boolean).join(sep);
  const endereco = (e: { logradouro?: string; numero?: string; bairro?: string }) =>
    juntar([e.logradouro, e.numero, e.bairro], ", ");

  linha([
    { c: 0, rotulo: "PRESTADOR / FORNECEDOR", negrito: true },
    { c: 1, rotulo: "CNPJ / CPF / NIF", valor: docBR(p.cnpj) },
    { c: 2, rotulo: "Indicador Municipal (Inscrição)", valor: ou(p.inscricaoMunicipal) },
    { c: 3, rotulo: "Telefone", valor: ou(foneBR(p.fone)) },
  ], { titulo: true });
  linha([
    { c: 0, span: 2, rotulo: "Nome / Nome Empresarial", valor: ou(p.nome || extras.nomeExibicao) },
    { c: 2, rotulo: "Município / Sigla UF", valor: ou(juntar([d.municipio || extras.municipio, p.uf])) },
    { c: 3, rotulo: "Código IBGE / CEP", valor: ou(juntar([ibgeBR(p.municipio), cepBR(p.cep)])) },
  ]);
  linha([
    { c: 0, span: 2, rotulo: "Endereço", valor: ou(endereco(p)) },
    { c: 2, span: 2, rotulo: "E-mail", valor: ou(p.email) },
  ]);
  linha([
    { c: 0, rotulo: "Simples Nacional na Data de Competência", valor: textoSimplesNacional(d.regime?.opSimpNac) },
    { c: 1, span: 3, rotulo: "Regime de Apuração Tributária pelo SN", valor: ou(p.regimeApuracao) },
  ]);

  // ================================================ tomador / adquirente
  const e = extras.tomadorEndereco || {};
  const endToma = t
    ? endereco({
        logradouro: t.logradouro || e.logradouro,
        numero: t.numero || e.numero,
        bairro: t.bairro || e.bairro,
      })
    : "";

  linha([
    { c: 0, rotulo: "TOMADOR / ADQUIRENTE", negrito: true },
    { c: 1, rotulo: "CNPJ / CPF / NIF", valor: t ? docBR(t.documento) : "-" },
    { c: 2, rotulo: "Indicador Municipal (Inscrição)", valor: ou(t?.inscricaoMunicipal) },
    { c: 3, rotulo: "Telefone", valor: ou(foneBR(t?.fone || extras.tomadorTelefone)) },
  ], { titulo: true });
  linha([
    { c: 0, span: 2, rotulo: "Nome / Nome Empresarial", valor: ou(t?.nome) },
    { c: 2, rotulo: "Município / Sigla UF", valor: ou(juntar([t?.municipio || e.cidade, t?.uf || e.uf])) },
    { c: 3, rotulo: "Código IBGE / CEP", valor: ou(juntar([ibgeBR(t?.codigoIbge), cepBR(t?.cep || e.cep)])) },
  ]);
  linha([
    { c: 0, span: 2, rotulo: "Endereço", valor: ou(endToma) },
    { c: 2, span: 2, rotulo: "E-mail", valor: ou(t?.email || extras.tomadorEmail) },
  ]);

  /**
   * Destinatário e Intermediário são blocos obrigatórios do modelo. Quando não
   * existem — o caso normal de um MEI — o oficial imprime a frase centralizada
   * em vez de omitir o bloco. Some com eles e a folha deixa de bater com o
   * Anexo I.
   */
  const linhaCentral = (texto: string) => {
    const alt = mm(12);
    doc.setFont(FONTE, "normal").setFontSize(7);
    doc.setTextColor(0, 0, 0);
    doc.text(texto, 210 / 2, y + mm(8.5), { align: "center" });
    y += alt;
    linhaFina();
    doc.line(BORDA, y, 210 - BORDA, y);
  };
  linhaCentral("DESTINATÁRIO DA OPERAÇÃO NÃO IDENTIFICADO NA NFS-e");
  linhaCentral("INTERMEDIÁRIO DA OPERAÇÃO NÃO IDENTIFICADO NA NFS-e");

  // ====================================================== serviço prestado
  linha([
    { c: 0, rotulo: "SERVIÇO PRESTADO", negrito: true },
    { c: 1, rotulo: "Código de Tributação Nacional/Municipal",
      valor: `${ou(codServico(s.codigoTributacao))} / ${ou(s.codigoTributacaoMunicipal)}` },
    { c: 2, rotulo: "Código da NBS", valor: ou(codNbs(s.codigoNbs)) },
    { c: 3, rotulo: "Local da Prestação / Sigla UF / País",
      valor: `${ou(d.municipio || extras.municipio)} / ${ou(p.uf)} / -` },
  ], { titulo: true });

  // Descrição oficial do item da lista: largura inteira, sem rótulo.
  {
    conteudo(ou(s.descricaoOficial || extras.textoServicoOficial), COL[0], y + mm(9), DIR - COL[0]);
    y += mm(14);
    linhaFina();
    doc.line(BORDA, y, 210 - BORDA, y);
  }
  linha([{ c: 0, span: 4, rotulo: "Descrição do Serviço", valor: ou(s.descricao) }]);

  // ============================================ tributação municipal (ISSQN)
  linha([
    { c: 0, rotulo: "TRIBUTAÇÃO MUNICIPAL (ISSQN)", negrito: true },
    { c: 1, rotulo: "Tipo de Tributação do ISSQN",
      valor: v.issTributavel === false ? "Não Tributável" : "Operação Tributável" },
    { c: 2, span: 2, rotulo: "Município / Sigla UF / País de Incidência do ISSQN",
      valor: `${ou(d.municipio || extras.municipio)} / ${ou(p.uf)} / -` },
  ], { titulo: true });
  linha([
    { c: 0, rotulo: "BC ISSQN", valor: v.baseCalculo ? brl(v.baseCalculo) : "-" },
    { c: 1, rotulo: "Alíquota Aplicada", valor: v.aliquota ? `${v.aliquota}%` : "-" },
    { c: 2, rotulo: "Retenção do ISSQN", valor: v.issRetido ? "Retido" : "Não Retido" },
    { c: 3, rotulo: "ISSQN Apurado", valor: v.valorIss ? brl(v.valorIss) : "-" },
  ]);

  // ==================================================== tributação federal
  linha([
    { c: 0, rotulo: "TRIBUTAÇÃO FEDERAL (EXCETO CBS)", negrito: true },
    { c: 1, rotulo: "IRRF", valor: "-" },
    { c: 2, rotulo: "Contribuição Previdenciária - Retida", valor: "-" },
    { c: 3, rotulo: "Contribuições Sociais - Retidas", valor: "-" },
  ], { titulo: true });
  linha([
    { c: 0, rotulo: "PIS - Débito Apuração Própria", valor: "-" },
    { c: 1, rotulo: "COFINS - Débito Apuração Própria", valor: "-" },
    { c: 2, span: 2, rotulo: "Descrição Contrib. Sociais - Retidas", valor: "-" },
  ]);

  // ================================================== tributação IBS/CBS
  /**
   * Bloco da Reforma Tributária. Os campos ainda vêm vazios do Portal — a nota
   * do usuário não traz nenhum deles — mas o bloco é obrigatório e precisa
   * aparecer impresso, com traço onde não há valor, exatamente como a folha
   * oficial faz hoje. Quando o Portal passar a preencher, é aqui que entra.
   */
  linha([
    { c: 0, rotulo: "TRIBUTAÇÃO IBS/CBS", negrito: true },
    { c: 1, rotulo: "CST / cClassTrib", valor: "- / -" },
    { c: 2, span: 2, rotulo: "Indicador de Operação / Código IBGE Incidência / Município Incidência / Sigla UF",
      valor: "- / - / - / -" },
  ], { titulo: true });
  linha([
    { c: 0, rotulo: "Exclusões e Reduções da Base de Cálculo", valor: brl(0) },
    { c: 1, rotulo: "Base de Cálculo Após Exclusões e Reduções", valor: "-" },
    { c: 2, rotulo: "Red. Alíquota IBS / Red. Alíquota CBS", valor: "- / - / -" },
    { c: 3, rotulo: "Alíquota - IBS UF / IBS Mun", valor: "- / -" },
  ]);
  linha([
    { c: 0, rotulo: "Alíq. Efetiva Municipal - IBS", valor: "-" },
    { c: 1, rotulo: "Valor Apurado Municipal - IBS", valor: "-" },
    { c: 2, rotulo: "Alíq. Efetiva Estadual - IBS", valor: "-" },
    { c: 3, rotulo: "Valor Apurado Estadual - IBS", valor: "-" },
  ]);
  linha([
    { c: 0, rotulo: "Valor Total Apurado - IBS", valor: "-" },
    { c: 1, rotulo: "Alíquota - CBS", valor: "-" },
    { c: 2, rotulo: "Alíquota Efetiva - CBS", valor: "-" },
    { c: 3, rotulo: "Valor Total Apurado - CBS", valor: "-" },
  ]);

  // ================================================= valor total da NFS-e
  linha([
    { c: 0, rotulo: "VALOR TOTAL DA NFS-e", negrito: true },
    { c: 1, rotulo: "VALOR DA OPERAÇÃO / SERVIÇO", negrito: true, valor: brl(v.servico) },
    { c: 2, rotulo: "Desconto Incondicionado", valor: v.descontoIncondicionado ? brl(v.descontoIncondicionado) : "-" },
    { c: 3, rotulo: "Desconto Condicionado", valor: v.descontoCondicionado ? brl(v.descontoCondicionado) : "-" },
  ], { titulo: true });
  /** A norma manda sombrear a linha do valor líquido. */
  linha([
    { c: 0, rotulo: "Total das Retenções (ISSQN / Federais)", valor: v.totalRetencoes ? brl(v.totalRetencoes) : "-" },
    { c: 1, rotulo: "VALOR LÍQUIDO DA NFS-e", negrito: true, valor: brl(v.liquido ?? v.servico) },
    { c: 2, rotulo: "Total do IBS/CBS", valor: brl(v.totalIbsCbs || 0) },
    { c: 3, rotulo: "VALOR LÍQUIDO DA NFS-e + IBS/CBS", negrito: true, valor: brl(v.liquidoComIbsCbs || 0) },
  ], { fundo: true });

  // ========================================== informações complementares
  linha([{ c: 0, rotulo: "INFORMAÇÕES COMPLEMENTARES", negrito: true }], { titulo: true, altura: mm(13) });

  const info = String(s.informacoesComplementares || "").trim();
  doc.setFont(FONTE, "normal").setFontSize(7);
  doc.setTextColor(0, 0, 0);
  let yInfo = y + mm(14);
  if (info) {
    const linhas = doc.splitTextToSize(info, DIR - COL[0]).slice(0, 8);
    doc.text(linhas, COL[0], yInfo);
    yInfo += linhas.length * mm(10);
  }
  doc.text(
    "Totais aproximados dos Tributos cfe. Lei n° 12.741/2012: " +
    `Federais: ${v.tributosFederais ? brl(v.tributosFederais) : "-"}; ` +
    `Estaduais: ${v.tributosEstaduais ? brl(v.tributosEstaduais) : "-"}; ` +
    `Municipais: ${v.tributosMunicipais ? brl(v.tributosMunicipais) : "-"};`,
    COL[0], yInfo
  );

  // ============================================================== canhoto
  /**
   * Canhoto de recebimento. No modelo ele fica no PÉ DA FOLHA, e não logo
   * abaixo do conteúdo — por isso a posição é fixa e não acompanha o cursor.
   */
  const yCanhoto = 297 - mm(46);
  const fimCanhoto = yCanhoto + mm(30);
  linhaFina();
  doc.line(BORDA, yCanhoto, 210 - BORDA, yCanhoto);
  doc.line(BORDA, fimCanhoto, 210 - BORDA, fimCanhoto);
  doc.line(COL[1] - 2, yCanhoto, COL[1] - 2, fimCanhoto);
  doc.line(COL[2] - 2, yCanhoto, COL[2] - 2, fimCanhoto);
  rotuloCampo("DATA CIENTIFICAÇÃO:", COL[0], yCanhoto + mm(7.5));
  rotuloCampo("IDENTIFICAÇÃO E ASSINATURA", COL[1], yCanhoto + mm(7.5));
  rotuloCampo("N° NFS-e / CHAVE NFS-e", COL[2], yCanhoto + mm(7.5));
  conteudo(`${ou(d.numeroNfse)} / ${ou(soDigitos(d.chave))}`, COL[2], yCanhoto + mm(16), DIR - COL[2]);

  // =========================================================== moldura
  /** Borda externa de 1 ponto, por cima de tudo. */
  linhaGrossa();
  doc.rect(BORDA, BORDA, 210 - BORDA * 2, fimCanhoto - BORDA);

  return fimCanhoto;
}

/** Nome de arquivo previsível: número da NFS-e e série. */
export function nomeArquivoDanfse(d: DadosDanfse): string {
  return `NFSe_${d.numeroNfse || d.numeroDps || "s-n"}_${d.serie || "00001"}.pdf`;
}
