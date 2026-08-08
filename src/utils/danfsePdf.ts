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
 * ----------------------------------------------------------------------------
 * SOBRE ESTE LEIAUTE
 *
 * Durante um tempo o sistema teve DUAS folhas diferentes: esta e uma versão em
 * HTML que o navegador imprimia. O usuário reparou e resumiu bem — "é como se
 * estivesse com dois servidores de notas fiscais". Ele preferiu a aparência da
 * folha em HTML: mais leve, com cartões de borda clara em vez de blocos
 * pesados, números em fonte de máquina de escrever, e o total sem faixa preta.
 *
 * Este arquivo passou a ser essa folha. A versão em HTML foi removida, e este é
 * o ÚNICO desenho de nota fiscal do sistema. Ao mexer aqui, lembre que o
 * resultado é o que vai para o cliente do MEI e para a guarda dos cinco anos.
 *
 * ⚠️ AO MEXER NO LEIAUTE: a função devolve a altura usada. O teste renderiza a
 *    folha e falha se passar de uma página. Rode-o. E suba `VERSAO_FOLHA` no
 *    nfse.ts se a mudança valer refazer as notas já arquivadas.
 */

export type DadosDanfse = {
  numeroNfse?: string | number;
  numeroDps?: string | number;
  serie?: string;
  chave?: string;
  emitidaEm?: string;
  competencia?: string;
  ambiente?: string;
  /** Nome da cidade, lido do próprio XML da nota (xLocPrestacao / xLocEmi). */
  municipio?: string;
  prestador?: {
    nome?: string; cnpj?: string; inscricaoMunicipal?: string; fone?: string;
    email?: string; logradouro?: string; numero?: string; bairro?: string;
    cep?: string; municipio?: string; uf?: string;
  };
  tomador?: { nome?: string; documento?: string; email?: string } | null;
  servico?: {
    descricao?: string; codigoTributacao?: string; codigoNbs?: string;
    localPrestacao?: string; informacoesComplementares?: string;
    /** Item da lista de serviços (xTribNac) e descrição do NBS (xNBS). */
    descricaoOficial?: string; descricaoNbs?: string;
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
  /** Texto oficial do item da lista de serviços (xTribNac). */
  textoServicoOficial?: string;
  /** Descrição do código NBS (xNBS). */
  textoNbs?: string;
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

const TINTA = { escuro: [15, 23, 42], texto: [51, 65, 85], claro: [100, 116, 139],
                fraco: [148, 163, 184], linha: [226, 232, 240], fundo: [248, 250, 252],
                marca: [79, 70, 229], ok: [4, 120, 87], alerta: [185, 28, 28] } as const;

// ---------------------------------------------------------------------------
// Desenho
// ---------------------------------------------------------------------------

/**
 * Monta a DANFSe. Recebe o jsPDF já instanciado para funcionar igual no
 * servidor e no navegador — quem chama é que sabe como importar a biblioteca.
 *
 * @returns altura ocupada em mm, para o teste conferir que cabe na página.
 */
export function desenharDanfse(doc: any, d: DadosDanfse, extras: ExtrasDanfse = {}): number {
  const M = 13;                  // margem
  const L = 210 - M * 2;         // largura útil = 184mm
  let y = M;

  const cor = (c: readonly number[]) => doc.setTextColor(c[0], c[1], c[2]);
  const traco = (c: readonly number[]) => doc.setDrawColor(c[0], c[1], c[2]);
  const preenche = (c: readonly number[]) => doc.setFillColor(c[0], c[1], c[2]);

  /**
   * Rótulo pequeno em maiúsculas com as letras afastadas.
   *
   * O jsPDF não tem letter-spacing, e é justamente esse respiro entre as letras
   * que dá o ar leve da folha que o usuário escolheu. Então desenhamos letra a
   * letra. É pouco texto — só rótulos — então o custo é irrelevante.
   */
  const rotulo = (t: string, x: number, yy: number, tam = 5.4, espaco = 0.35, tinta: readonly number[] = TINTA.fraco) => {
    doc.setFont("helvetica", "bold").setFontSize(tam);
    cor(tinta);
    let cx = x;
    for (const letra of String(t || "").toUpperCase()) {
      doc.text(letra, cx, yy);
      cx += doc.getTextWidth(letra) + espaco;
    }
  };

  /** Largura que `rotulo` vai ocupar, para poder alinhar à direita. */
  const larguraRotulo = (t: string, tam = 5.4, espaco = 0.35) => {
    doc.setFont("helvetica", "bold").setFontSize(tam);
    let w = 0;
    for (const letra of String(t || "").toUpperCase()) w += doc.getTextWidth(letra) + espaco;
    return Math.max(0, w - espaco);
  };

  /** Valor em fonte de máquina de escrever — como os números da folha na tela. */
  const valorMono = (t: string, x: number, yy: number, tam = 7.6) => {
    doc.setFont("courier", "normal").setFontSize(tam);
    cor(TINTA.texto);
    doc.text(String(t ?? "—") || "—", x, yy);
  };

  const valorTexto = (t: string, x: number, yy: number, tam = 7.6) => {
    doc.setFont("helvetica", "normal").setFontSize(tam);
    cor(TINTA.texto);
    doc.text(String(t ?? "—") || "—", x, yy);
  };

  /**
   * Escreve encolhendo a fonte até caber — nunca corta.
   *
   * Substitui o corte com reticências nos campos que são um dado único e
   * precisam ser lidos inteiros: nome da empresa, nome do cliente, e-mail. Um
   * e-mail pela metade não serve para nada, e um nome cortado numa nota fiscal
   * parece erro do emissor. Perder meio ponto de corpo é sempre melhor.
   */
  const escreverCabendo = (
    texto: string, x: number, yy: number, largura: number,
    tam: number, peso: "normal" | "bold" = "normal", minimo = 5.2
  ) => {
    const t = String(texto ?? "") || "—";
    let corpo = tam;
    doc.setFont("helvetica", peso).setFontSize(corpo);
    while (corpo > minimo && doc.getTextWidth(t) > largura) {
      corpo -= 0.25;
      doc.setFontSize(corpo);
    }
    // Se nem no corpo mínimo couber, aí sim quebra em duas linhas.
    if (doc.getTextWidth(t) > largura) {
      doc.text(doc.splitTextToSize(t, largura).slice(0, 2), x, yy);
    } else {
      doc.text(t, x, yy);
    }
  };

  /**
   * Cartão de borda clara com uma faixa de título — o elemento que se repete na
   * folha inteira e responde pela leveza dela.
   */
  const cartao = (x: number, largura: number, altura: number, titulo: string, destaque = false) => {
    preenche([255, 255, 255]);
    traco(TINTA.linha);
    doc.setLineWidth(0.2);
    doc.roundedRect(x, y, largura, altura, 1.8, 1.8, "FD");
    if (titulo) {
      preenche(destaque ? [238, 242, 255] : TINTA.fundo);
      doc.roundedRect(x + 0.15, y + 0.15, largura - 0.3, 5.6, 1.6, 1.6, "F");
      doc.rect(x + 0.15, y + 3.5, largura - 0.3, 2.25, "F");
      traco(TINTA.linha);
      doc.line(x + 0.15, y + 5.75, x + largura - 0.15, y + 5.75);
      rotulo(titulo, x + 3.5, y + 3.9, 5.4, 0.45, destaque ? TINTA.marca : TINTA.claro);
    }
  };

  const ehTeste = String(d.ambiente || "").startsWith("homolog");
  const nomeTopo = extras.nomeExibicao || d.prestador?.nome || "—";

  // ---------------------------------------------------------------- topo
  if (extras.logoBase64) {
    preenche([255, 255, 255]);
    traco(TINTA.linha);
    doc.setLineWidth(0.2);
    doc.roundedRect(M, y, 15, 15, 2, 2, "FD");
    try { doc.addImage(extras.logoBase64, "PNG", M + 1.4, y + 1.4, 12.2, 12.2, undefined, "FAST"); }
    catch { /* logo inválida não pode derrubar a nota */ }
  } else {
    preenche(TINTA.marca);
    doc.roundedRect(M, y, 15, 15, 2.5, 2.5, "F");
    doc.setFont("helvetica", "bold").setFontSize(9.5);
    doc.setTextColor(255, 255, 255);
    doc.text(iniciais(nomeTopo), M + 7.5, y + 9.6, { align: "center" });
  }

  cor(TINTA.escuro);
  // Largura útil até o bloco do número, à direita.
  escreverCabendo(String(nomeTopo).toUpperCase(), M + 19, y + 6.4, L - 19 - 42, 14, "bold", 8.5);
  doc.setFont("helvetica", "normal").setFontSize(6.8);
  cor(TINTA.claro);
  doc.text("Documento Auxiliar da Nota Fiscal de Serviço eletrônica", M + 19, y + 10.6);

  /**
   * Bloco do número, à direita.
   *
   * ⚠️ Rótulo alinhado à direita PRECISA ser posicionado pela largura medida.
   *    A versão que escrevia à esquerda e tapava com um retângulo branco
   *    produziu "NFS-E NºNFS-E Nº" na folha que chegou ao usuário.
   */
  const dir = M + L;
  rotulo("NFS-e Nº", dir - larguraRotulo("NFS-e Nº"), y + 3);

  doc.setFont("helvetica", "bold").setFontSize(21);
  cor(TINTA.escuro);
  doc.text(String(d.numeroNfse || d.numeroDps || "—"), dir, y + 11.5, { align: "right" });

  doc.setFont("courier", "normal").setFontSize(6.6);
  cor(TINTA.fraco);
  doc.text(`Série ${d.serie || "—"} · DPS nº ${d.numeroDps || "—"}`, dir, y + 15.5, { align: "right" });

  const selo = ehTeste ? "Teste — sem validade fiscal" : "Autorizada";
  const larguraSelo = larguraRotulo(selo, 5.4, 0.4) + 6;
  preenche(ehTeste ? [254, 242, 242] : [236, 253, 245]);
  traco(ehTeste ? [254, 202, 202] : [167, 243, 208]);
  doc.setLineWidth(0.2);
  doc.roundedRect(dir - larguraSelo, y + 18, larguraSelo, 5.4, 1.4, 1.4, "FD");
  rotulo(selo, dir - larguraSelo + 3, y + 21.6, 5.4, 0.4, ehTeste ? TINTA.alerta : TINTA.ok);

  y += 26;

  // Fio fino que se dissolve da esquerda para a direita — o mesmo gesto do
  // degradê que a folha na tela usa embaixo do cabeçalho.
  doc.setLineWidth(0.35);
  for (let i = 0; i < 26; i++) {
    const t = i / 26;
    doc.setDrawColor(
      Math.round(79 + (255 - 79) * t),
      Math.round(70 + (255 - 70) * t),
      Math.round(229 + (255 - 229) * t)
    );
    doc.line(M + (L * i) / 26, y, M + (L * (i + 1)) / 26, y);
  }
  y += 6.5;

  // ------------------------------------------------------------- datas
  const col = L / 3;
  ([["Emissão", dataBR(String(d.emitidaEm || "").slice(0, 10)), true],
    ["Competência", competenciaBR(d.competencia), true],
    ["Local da prestação", d.municipio || extras.municipio
      || (d.servico?.localPrestacao ? `IBGE ${d.servico.localPrestacao}` : "—"), false]] as [string, string, boolean][])
    .forEach(([r, v, mono], i) => {
      rotulo(r, M + col * i, y);
      if (mono) valorMono(v, M + col * i, y + 4.4, 8);
      else valorTexto(v, M + col * i, y + 4.4, 8);
    });
  y += 9.5;

  // ------------------------------------------- prestador / tomador
  const meia = (L - 4) / 2;
  type Par = [string, string, boolean?];

  const p = d.prestador || {};
  const endPrest = p.logradouro
    ? `${p.logradouro}${p.numero ? ", " + p.numero : ""}${p.bairro ? " — " + p.bairro : ""}` +
      `${d.municipio ? "\n" + d.municipio : ""}${p.uf ? " / " + p.uf : ""}${p.cep ? " · CEP " + cepBR(p.cep) : ""}`
    : "—";

  const paresPrest: Par[] = [
    ["CNPJ", docBR(p.cnpj)],
    ["Endereço", endPrest],
    /**
     * ⚠️ E-MAIL OCUPA A LINHA INTEIRA — NÃO O COLOQUE DE VOLTA AO LADO DO
     *    TELEFONE.
     *
     * Em meia largura ele não cabia e saía cortado com reticências:
     * "RODRIGUES.SOLAR@HOTMAIL.…". Num documento fiscal isso é pior do que
     * feio — o cliente não consegue responder para um endereço pela metade.
     * Endereço de e-mail é o campo mais comprido do cartão; a linha é dele.
     */
    ["Telefone", foneBR(p.fone) || "—", true],
    ["Inscrição municipal ", p.inscricaoMunicipal || "—", true],
    ["E-mail", p.email || "—"],
    ["Regime tributário", d.regime?.opSimpNac === "3" ? "Simples Nacional — ME/EPP"
      : d.regime?.opSimpNac === "1" ? "Não optante pelo Simples Nacional"
      : "Simples Nacional — Microempreendedor Individual (MEI)"],
  ];

  const t = d.tomador;
  const e = extras.tomadorEndereco;
  const endToma = e?.logradouro
    ? `${e.logradouro}${e.numero ? ", " + e.numero : ""}${e.bairro ? " — " + e.bairro : ""}` +
      `${e.cidade ? "\n" + e.cidade : ""}${e.uf ? " / " + e.uf : ""}${e.cep ? " · CEP " + cepBR(e.cep) : ""}`
    : "Não informado no cadastro";

  const paresToma: Par[] = t ? [
    ["CPF / CNPJ", docBR(t.documento)],
    ["Endereço", endToma],
    ["Telefone", foneBR(extras.tomadorTelefone) || "—", true],
    ["Tipo ", soDigitos(t.documento).length === 14 ? "Pessoa jurídica" : "Pessoa física", true],
    // Mesmo motivo do prestador: e-mail cortado não serve para nada.
    ["E-mail", t.email || extras.tomadorEmail || "—"],
    ["Município de incidência do ISSQN",
      `${d.municipio || extras.municipio || "—"}${d.servico?.localPrestacao ? " · IBGE " + d.servico.localPrestacao : ""}`],
  ] : [];

  /**
   * ⚠️ ALTURA MEDIDA, NÃO CHUTADA.
   *
   * Com altura fixa, a última linha do cartão saía com o rótulo dentro e o
   * valor fora — um rótulo solto no meio do papel. Aqui os dois cartões são
   * medidos antes e o maior manda, para terminarem juntos.
   */
  const medirParte = (pares: Par[], temSub: boolean) => {
    let h = temSub ? 19 : 16;
    for (let i = 0; i < pares.length; i++) {
      const [, valor, meioLado] = pares[i];
      const largura = meioLado ? (meia - 10) / 2 : meia - 7;
      doc.setFont("helvetica", "normal").setFontSize(6.8);
      if (meioLado && pares[i + 1]?.[2]) {
        // Campo de meia largura é sempre uma linha só — ele é cortado, não quebrado.
        h += 3.4 + 3 + 1.8;
        i++;
      } else {
        const linhas = doc.splitTextToSize(String(valor || "—"), largura).slice(0, 2);
        h += 3.4 + linhas.length * 3 + 1.8;
      }
    }
    return h + 1;
  };

  const temSubPrest = !!(extras.nomeExibicao && p.nome && p.nome !== extras.nomeExibicao);
  const alturaPartes = Math.max(
    medirParte(paresPrest, temSubPrest),
    t ? medirParte(paresToma, false) : 32
  );

  const desenharParte = (x: number, titulo: string, destaque: boolean, pares: Par[], nome: string, sub?: string) => {
    cartao(x, meia, alturaPartes, titulo, destaque);

    cor(TINTA.escuro);
    escreverCabendo(String(nome), x + 3.5, y + 11, meia - 7, 9.5, "bold", 6.5);
    if (sub) {
      cor(TINTA.claro);
      escreverCabendo(String(sub), x + 3.5, y + 14.4, meia - 7, 6.2, "normal", 5);
    }

    let yy = y + (sub ? 19 : 16);
    for (let i = 0; i < pares.length; i++) {
      const [r, v, meioLado] = pares[i];
      const largura = meioLado ? (meia - 10) / 2 : meia - 7;
      rotulo(r, x + 3.5, yy, 5.2, 0.3);

      if (meioLado && pares[i + 1]?.[2]) {
        // Dois campos lado a lado, uma linha cada, cortados se não couberem.
        cor(TINTA.texto);
        escreverCabendo(v, x + 3.5, yy + 3.4, largura, 6.8, "normal", 5.4);

        const x2 = x + 3.5 + largura + 3;
        rotulo(pares[i + 1][0], x2, yy, 5.2, 0.3);
        cor(TINTA.texto);
        escreverCabendo(pares[i + 1][1], x2, yy + 3.4, largura, 6.8, "normal", 5.4);
        yy += 3.4 + 3 + 1.8;
        i++;
      } else {
        doc.setFont("helvetica", "normal").setFontSize(6.8);
        cor(TINTA.texto);
        const l1 = doc.splitTextToSize(String(v || "—"), largura).slice(0, 2);
        doc.text(l1, x + 3.5, yy + 3.4);
        yy += 3.4 + l1.length * 3 + 1.8;
      }
    }
  };

  desenharParte(M, "Prestador do serviço", true, paresPrest,
    extras.nomeExibicao || p.nome || "—",
    temSubPrest ? p.nome : undefined);

  if (t) {
    desenharParte(M + meia + 4, "Tomador do serviço", false, paresToma, t.nome || "—");
  } else {
    const x = M + meia + 4;
    cartao(x, meia, alturaPartes, "Tomador do serviço");
    doc.setFont("helvetica", "bold").setFontSize(8);
    cor(TINTA.claro);
    doc.text("Tomador não identificado", x + meia / 2, y + alturaPartes / 2 + 1, { align: "center" });
    doc.setFont("helvetica", "normal").setFontSize(6);
    cor(TINTA.fraco);
    doc.text("A nota foi emitida sem identificação do cliente.", x + meia / 2, y + alturaPartes / 2 + 5, { align: "center" });
  }
  y += alturaPartes + 4;

  // ------------------------------------------------------------ serviço
  /**
   * ⚠️ A DESCRIÇÃO DO SERVIÇO É O CORAÇÃO DESTA NOTA — E ELA SAIU FALTANDO.
   *
   * A folha imprimia só `xDescServ`, o texto livre do emissor. No sistema do
   * usuário esse campo é preenchido automaticamente com "Recebimento de
   * FULANO", que não diz absolutamente nada sobre o que foi prestado. O cliente
   * recebia uma nota que não explicava o que ele tinha comprado.
   *
   * As descrições que importam vêm prontas do Portal e estavam sendo ignoradas:
   * `xTribNac` (o item da lista de serviços da LC 116) e `xNBS` (a descrição do
   * código NBS). Agora as três aparecem, cada uma no seu peso.
   */
  doc.setFont("helvetica", "normal").setFontSize(9);
  const descricao = doc.splitTextToSize(String(d.servico?.descricao || "—"), L - 8);

  const oficialTexto = extras.textoServicoOficial || d.servico?.descricaoOficial || "";
  const nbsTexto = extras.textoNbs || d.servico?.descricaoNbs || "";

  doc.setFont("helvetica", "normal").setFontSize(6.4);
  const oficial = oficialTexto
    ? doc.splitTextToSize(`Item ${codServico(d.servico?.codigoTributacao)} da lista de serviços: ${oficialTexto}`, L - 8).slice(0, 3)
    : [];
  const nbs = nbsTexto
    ? doc.splitTextToSize(`NBS ${codNbs(d.servico?.codigoNbs)}: ${nbsTexto}`, L - 8).slice(0, 2)
    : [];

  const altExtras = (oficial.length + nbs.length) ? (oficial.length + nbs.length) * 3 + 3 : 0;
  const altServico = 11 + descricao.length * 3.8 + 9.5 + altExtras;

  cartao(M, L, altServico, "Discriminação do serviço");
  doc.setFont("helvetica", "normal").setFontSize(9);
  cor(TINTA.escuro);
  doc.text(descricao, M + 4, y + 11);

  const yServ = y + 11 + descricao.length * 3.8 + 2.5;
  const c3 = (L - 8) / 3;
  ([["Cód. tributação nacional", codServico(d.servico?.codigoTributacao)],
    ["Cód. NBS", codNbs(d.servico?.codigoNbs)],
    ["Local da prestação", d.servico?.localPrestacao || "—"]] as [string, string][])
    .forEach(([r, v], i) => {
      rotulo(r, M + 4 + c3 * i, yServ);
      valorMono(v, M + 4 + c3 * i, yServ + 3.8);
    });

  let yExtra = yServ + 8.8;
  doc.setFont("helvetica", "normal").setFontSize(6.4);
  cor(TINTA.claro);
  if (oficial.length) { doc.text(oficial, M + 4, yExtra); yExtra += oficial.length * 3; }
  if (nbs.length) { doc.text(nbs, M + 4, yExtra); }
  y += altServico + 3.5;

  // --------------------------------------------------------- tributação
  cartao(M, L, 16, "Tributação");
  const c5 = (L - 8) / 5;
  ([["Tipo de tributação", d.valores?.issTributavel === false ? "Não tributável" : "Operação tributável", false],
    ["Retenção do ISSQN", d.valores?.issRetido ? "Retido" : "Não retido", false],
    ["Base de cálculo", d.valores?.baseCalculo ? brl(d.valores.baseCalculo) : "—", true],
    ["Alíquota", d.valores?.aliquota ? `${d.valores.aliquota}%` : "—", true],
    ["ISSQN apurado", d.valores?.valorIss ? brl(d.valores.valorIss) : "—", true]] as [string, string, boolean][])
    .forEach(([r, v, mono], i) => {
      rotulo(r, M + 4 + c5 * i, y + 10);
      if (mono) valorMono(v, M + 4 + c5 * i, y + 13.6, 7.2);
      else valorTexto(v, M + 4 + c5 * i, y + 13.6, 7.2);
    });
  y += 19.5;

  // ------------------------------------------ informações complementares
  const info = String(d.servico?.informacoesComplementares || "").trim();
  doc.setFont("helvetica", "normal").setFontSize(7.2);
  const infoLinhas = info ? doc.splitTextToSize(info, L - 8).slice(0, 4) : [];
  const altInfo = 10.5 + infoLinhas.length * 3.3 + 5;
  cartao(M, L, altInfo, "Informações complementares");
  if (infoLinhas.length) {
    doc.setFont("helvetica", "normal").setFontSize(7.2);
    cor(TINTA.texto);
    doc.text(infoLinhas, M + 4, y + 11);
  }
  doc.setFont("helvetica", "normal").setFontSize(5.8);
  cor(TINTA.fraco);
  doc.text(
    `Totais aproximados dos tributos conforme Lei nº 12.741/2012: ${d.valores?.totalTributos ? brl(d.valores.totalTributos) : "não informado"}.`,
    M + 4, y + altInfo - 3
  );
  y += altInfo + 5;

  // ------------------------------------------------------------ valores
  /**
   * ⚠️ SEM FAIXA PRETA AQUI — foi escolha do usuário.
   *
   * A versão anterior punha os valores dentro de um bloco escuro com o total em
   * branco. Ele preferiu esta: os valores respirando no papel e o total grande
   * e discreto à direita. Num documento que vai para o cliente do MEI, tinta
   * pesada não acrescenta nada.
   */
  const cv = (L - 62) / 3;
  ([["Valor do serviço", brl(d.valores?.servico)],
    ["Desconto incondicionado", brl(d.valores?.descontoIncondicionado)],
    ["Deduções / Reduções", brl(d.valores?.deducoes)],
    ["Desconto condicionado", brl(d.valores?.descontoCondicionado)],
    ["ISSQN retido", brl(d.valores?.issRetido ? d.valores?.valorIss : 0)],
    ["Total das retenções", brl(d.valores?.issRetido ? d.valores?.valorIss : 0)]] as [string, string][])
    .forEach(([r, v], i) => {
      const x = M + 2 + cv * (i % 3);
      const yy = y + 4 + Math.floor(i / 3) * 9.5;
      rotulo(r, x, yy);
      valorMono(v, x, yy + 4);
    });

  rotulo("Valor líquido da NFS-e", dir - larguraRotulo("Valor líquido da NFS-e"), y + 5);
  doc.setFont("courier", "bold").setFontSize(17);
  cor(TINTA.claro);
  doc.text(brl(d.valores?.liquido || d.valores?.servico), dir, y + 14.5, { align: "right" });
  y += 23;

  // -------------------------------------------------------- verificação
  const altQr = 27;
  cartao(M, L, altQr, "");

  if (extras.qrBase64) {
    try { doc.addImage(extras.qrBase64, "PNG", M + 4, y + 4, 19, 19, undefined, "FAST"); }
    catch { /* sem QR, a chave impressa resolve */ }
  }
  rotulo("Chave de acesso da NFS-e", M + 28, y + 7.5);
  doc.setFont("courier", "normal").setFontSize(7.4);
  cor(TINTA.escuro);
  doc.text(doc.splitTextToSize(chaveEmGrupos(d.chave) || "—", L - 34).slice(0, 2), M + 28, y + 12);
  doc.setFont("helvetica", "normal").setFontSize(6.4);
  cor(TINTA.claro);
  doc.text(
    doc.splitTextToSize(
      "Aponte a câmera para o código ou consulte a chave em nfse.gov.br para conferir a autenticidade desta nota.",
      L - 34
    ).slice(0, 2),
    M + 28, y + 19
  );
  y += altQr + 5;

  // ------------------------------------------------------------- rodapé
  traco(TINTA.linha);
  doc.setLineWidth(0.2);
  doc.line(M, y, M + L, y);
  doc.setFont("helvetica", "normal").setFontSize(5.8);
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
