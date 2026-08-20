/**
 * ============================================================================
 * MEI FLOW — COFRE DE CREDENCIAIS BANCÁRIAS (uma conta por usuário)
 * ============================================================================
 *
 * O PROBLEMA QUE ESTE ARQUIVO RESOLVE
 *
 * Até aqui, as credenciais do banco não eram do usuário: eram do SISTEMA.
 * Ficavam em variáveis de ambiente do servidor (EFI_CLIENT_ID e companhia), e
 * qualquer pessoa que se cadastrasse e emitisse um boleto emitiria na conta do
 * dono do sistema — o dinheiro do cliente dela cairia no banco de outra
 * pessoa. Com um único usuário isso passa despercebido; no dia em que o
 * sistema é vendido, vira um problema de dinheiro alheio, não de software.
 *
 * Aqui cada usuário passa a ter as credenciais DELE, guardadas cifradas, e o
 * emissor de boletos passa a perguntar de quem é a cobrança antes de falar
 * com o banco.
 *
 * ----------------------------------------------------------------------------
 * COMO O SEGREDO É GUARDADO
 *
 * Mesmo padrão já usado no cofre do certificado digital (nfse.ts): AES-256-GCM,
 * com a chave morando numa variável de ambiente, FORA do banco de dados. Quem
 * levasse uma cópia do banco levaria ruído. O GCM ainda carrega uma etiqueta de
 * autenticidade: se alguém editar o texto cifrado na marra, a abertura falha em
 * vez de devolver lixo silenciosamente.
 *
 * ----------------------------------------------------------------------------
 * ⚠️ UM BLOB SÓ, E NÃO UM CAMPO POR SEGREDO
 *
 * A primeira versão guardava `clientIdCifrado`, `clientSecretCifrado`,
 * `pixClientIdCifrado`… um campo para cada segredo. Funcionou até chegar o
 * primeiro banco com formato diferente: a Asaas não usa Client ID nem Client
 * Secret — usa UMA chave de API. O cofre a recusava por "credenciais
 * incompletas", e não havia nada de errado com ela.
 *
 * Agora todos os segredos viram um JSON único, cifrado inteiro. Banco novo com
 * formato novo não exige campo novo no banco de dados nem migração.
 *
 * Documentos gravados no formato antigo continuam sendo lidos — ver
 * `lerCredenciaisBanco`. Ninguém precisa cadastrar de novo.
 *
 * (Desenho trazido do Vitri Pro, onde já rodou em produção.)
 *
 * ----------------------------------------------------------------------------
 * ⚠️ CADA BANCO DECLARA OS CAMPOS DELE
 *
 * A tela NÃO sabe que existe "Client Secret". Ela lê `credenciais` do provedor
 * escolhido e desenha o formulário a partir disso. Consequência prática:
 * implementar um banco novo é criar um item nesta lista e um arquivo de
 * emissão — nenhuma tela muda.
 *
 * ----------------------------------------------------------------------------
 * O QUE NUNCA SAI DAQUI
 *
 * Nenhum segredo volta para a tela, nem para o dono dele. A tela recebe um
 * RESUMO: qual banco, qual ambiente, quando foi cadastrado, e o começo/fim do
 * identificador para a pessoa reconhecer o que cadastrou. Se precisar trocar,
 * cadastra de novo. É a mesma regra da senha do certificado — o que não é
 * devolvido não vaza por descuido de tela, de log ou de captura de tela.
 *
 * ----------------------------------------------------------------------------
 * A COLEÇÃO PRECISA SER FECHADA NAS REGRAS DO FIRESTORE
 *
 * `banco_credenciais` tem `allow read, write: if false` em firestore.rules. O
 * servidor entra pelo Admin SDK e passa por cima das regras; nenhum navegador
 * pode chegar perto. Não abra essa regra.
 */

import crypto from "crypto";
import { exigirUsuario as verificarLogin } from "./auth-firebase.js";

const env = (k: string) => (process.env[k] || "").trim();

/** Onde os documentos moram. Trocar isto exige trocar também firestore.rules. */
export const COLECAO_CREDENCIAIS = "banco_credenciais";

// ============================================================================
// QUEM O SISTEMA SABE OPERAR — e quem ele apenas guarda
// ============================================================================
//
// Esta lista é honesta de propósito. `emiteBoleto: true` significa que o
// sistema fala a língua daquele banco e o boleto sai registrado de verdade.
// `false` significa que as credenciais ficam guardadas e organizadas, mas a
// emissão ainda depende de uma integração própria (o caminho da remessa CNAB).
//
// A tela LÊ esta lista do servidor em vez de trazer a própria. Assim é
// impossível a tela prometer um banco que o servidor não sabe operar.

export type ProvedorBanco = "efi" | "asaas" | "caixa" | "outro";

/** Um campo que o banco pede. A tela desenha o formulário a partir disto. */
export type CampoCredencial = {
  id: string;
  label: string;
  tipo: "text" | "password";
  opcional?: boolean;
  dica?: string;
};

export type DefinicaoProvedor = {
  id: ProvedorBanco;
  nome: string;
  /** true quando o sistema registra o boleto sozinho, de ponta a ponta. */
  emiteBoleto: boolean;
  /** true quando o provedor avisa o pagamento sozinho (webhook). */
  avisoAutomatico: boolean;
  /** Frase curta mostrada na tela, sem promessa que o sistema não cumpre. */
  situacao: string;
  /** Segredos — vão cifrados para o blob. */
  credenciais: CampoCredencial[];
  /** Dados de conta, que não são segredo e aparecem no resumo. */
  conta: string[];
};

export const PROVEDORES: DefinicaoProvedor[] = [
  {
    id: "efi",
    nome: "Efí Bank (antigo Gerencianet)",
    emiteBoleto: true,
    avisoAutomatico: true,
    situacao:
      "Pronto. Cadastre o Client ID e o Client Secret da aplicação de Cobranças e o boleto já sai registrado. O pagamento dá baixa sozinho.",
    credenciais: [
      { id: "clientId", label: "Client ID", tipo: "text" },
      { id: "clientSecret", label: "Client Secret", tipo: "password" },
      {
        id: "pixClientId",
        label: "Client ID do Pix",
        tipo: "text",
        opcional: true,
        dica: "Só se você usa uma aplicação separada para Pix. Em branco, usa a de Cobranças.",
      },
      { id: "pixClientSecret", label: "Client Secret do Pix", tipo: "password", opcional: true },
    ],
    conta: ["cedente", "chavePix"],
  },
  {
    id: "asaas",
    nome: "Asaas",
    emiteBoleto: true,
    // Passou a avisar sozinha: ver o aviso de pagamento em efi.ts. Exige um
    // passo manual UMA vez — colar o endereço no painel da Asaas.
    avisoAutomatico: true,
    situacao:
      "Pronto. Cadastre a Chave de API e o boleto já sai registrado. Para o pagamento dar baixa sozinho, cole o endereço de aviso no painel da Asaas — as instruções aparecem aqui depois de salvar.",
    credenciais: [
      {
        id: "apiKey",
        label: "Chave de API (API Key)",
        tipo: "password",
        dica: "No painel da Asaas: Configurações → Integrações → Chave de API.",
      },
    ],
    conta: ["cedente"],
  },
  {
    id: "caixa",
    nome: "Caixa Econômica Federal",
    emiteBoleto: false,
    avisoAutomatico: false,
    situacao:
      "As credenciais ficam guardadas aqui, no mesmo lugar das outras. A emissão pela Caixa depende da integração de remessa, que ainda não está pronta — cadastre agora e o sistema avisa quando puder emitir.",
    credenciais: [
      { id: "clientId", label: "Client ID", tipo: "text" },
      { id: "clientSecret", label: "Client Secret", tipo: "password" },
    ],
    conta: ["banco", "agencia", "conta", "convenio", "carteira", "cedente"],
  },
  {
    id: "outro",
    nome: "Outro banco",
    emiteBoleto: false,
    avisoAutomatico: false,
    situacao:
      "Guarda as credenciais e os dados do convênio de cobrança para quando a integração daquele banco existir.",
    credenciais: [
      { id: "clientId", label: "Client ID", tipo: "text" },
      { id: "clientSecret", label: "Client Secret", tipo: "password" },
    ],
    conta: ["banco", "agencia", "conta", "convenio", "carteira", "cedente"],
  },
];

export function provedorConhecido(id: string): DefinicaoProvedor | null {
  return PROVEDORES.find((p) => p.id === id) || null;
}

// ============================================================================
// CIFRA
// ============================================================================

function chaveCripto(): Buffer {
  const hex = env("NFSE_CRYPTO_KEY") || env("CONEXOES_CRYPTO_KEY");
  if (hex.length !== 64) throw new Error("SEM_CHAVE_CRIPTO");
  return Buffer.from(hex, "hex");
}

/** Verdadeiro quando o servidor tem chave para guardar segredo. */
export function cofreDisponivel(): boolean {
  try {
    chaveCripto();
    return true;
  } catch {
    return false;
  }
}

function cifrar(texto: string): string {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", chaveCripto(), iv);
  const d = Buffer.concat([c.update(texto || "", "utf8"), c.final()]);
  return `${iv.toString("base64")}.${c.getAuthTag().toString("base64")}.${d.toString("base64")}`;
}

function decifrar(pacote: string): string {
  const [iv, tag, dados] = String(pacote || "").split(".");
  if (!iv || !tag || !dados) throw new Error("COFRE_CORROMPIDO");
  const d = crypto.createDecipheriv("aes-256-gcm", chaveCripto(), Buffer.from(iv, "base64"));
  d.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([d.update(Buffer.from(dados, "base64")), d.final()]).toString("utf8");
}

// ============================================================================
// O QUE FICA GUARDADO
// ============================================================================

/** Os segredos, abertos. As chaves variam por banco — ver PROVEDORES. */
export type SegredosBanco = Record<string, string>;

export type CredenciaisBanco = {
  provedor: ProvedorBanco;
  ambiente: "homologacao" | "producao";

  /** Segredos abertos. USO EXCLUSIVO DO SERVIDOR. */
  segredos: SegredosBanco;

  /** Dados de conta — não são segredo, aparecem no resumo. */
  banco?: string;
  agencia?: string;
  conta?: string;
  convenio?: string;
  carteira?: string;
  cedente?: string;
  chavePix?: string;
  observacoes?: string;
};

/** O que a tela pode ver. Nenhum segredo aqui dentro. */
export type ResumoCredenciais = {
  cadastrado: boolean;
  provedor?: ProvedorBanco;
  provedorNome?: string;
  emiteBoleto?: boolean;
  avisoAutomatico?: boolean;
  ambiente?: "homologacao" | "producao";
  identificacao?: string;
  temSegredo?: boolean;
  banco?: string;
  agencia?: string;
  conta?: string;
  convenio?: string;
  carteira?: string;
  cedente?: string;
  chavePix?: string;
  observacoes?: string;
  cadastradoEm?: string;
  atualizadoEm?: string;
};

/**
 * Mostra as pontas do identificador e esconde o meio.
 *
 * Serve para a pessoa reconhecer o que cadastrou ("é esse mesmo") sem que a
 * tela — ou uma captura dela — carregue a credencial inteira.
 */
function mascarar(txt: string): string {
  const s = String(txt || "");
  if (s.length <= 8) return s ? `${s.slice(0, 2)}••••` : "";
  return `${s.slice(0, 4)}••••${s.slice(-4)}`;
}

const limpar = (v: any) => String(v ?? "").trim();

/** Todos os campos de conta que existem, para o gravador não precisar saber. */
const CAMPOS_CONTA = [
  "banco", "agencia", "conta", "convenio", "carteira", "cedente", "chavePix", "observacoes",
];

// ============================================================================
// CACHE — uma gaveta POR USUÁRIO
// ============================================================================
//
// ⚠️ ESTE É O ERRO QUE JÁ APARECEU TRÊS VEZES NESTE PROJETO.
//
// Guardar em uma variável só ("o certificado", "o token") funciona enquanto
// existe um usuário. No segundo, o servidor entrega para B o que era de A —
// e, aqui, isso significaria emitir boleto na conta errada. Por isso a gaveta
// é um Map com o UID na etiqueta, e nunca uma variável solta.

const CACHE_MS = 5 * 60 * 1000;
const cache = new Map<string, { dados: CredenciaisBanco | null; expiraEm: number }>();

export function limparCacheCredenciais(uid?: string) {
  if (uid) cache.delete(uid);
  else cache.clear();
}

// ============================================================================
// LER E GRAVAR
// ============================================================================

/**
 * Abre os segredos de um documento, aceitando os DOIS formatos.
 *
 * Formato novo: um campo `segredosCifrados` com um JSON cifrado inteiro.
 * Formato antigo: um campo cifrado por segredo. Ainda existe no banco de quem
 * cadastrou antes desta mudança — e por isso continua sendo lido. Na próxima
 * gravação o documento passa sozinho para o formato novo.
 */
function abrirSegredos(d: any): SegredosBanco {
  if (d?.segredosCifrados) {
    try {
      const cru = JSON.parse(decifrar(d.segredosCifrados));
      return cru && typeof cru === "object" ? cru : {};
    } catch {
      throw new Error("COFRE_CORROMPIDO");
    }
  }

  const antigos: SegredosBanco = {};
  const mapa: Record<string, string> = {
    clientIdCifrado: "clientId",
    clientSecretCifrado: "clientSecret",
    pixClientIdCifrado: "pixClientId",
    pixClientSecretCifrado: "pixClientSecret",
  };
  for (const [campo, nome] of Object.entries(mapa)) {
    if (d?.[campo]) antigos[nome] = decifrar(d[campo]);
  }
  return antigos;
}

/**
 * Credenciais de um usuário, já abertas. USO EXCLUSIVO DO SERVIDOR.
 *
 * Devolve null quando o usuário ainda não cadastrou — e quem chama PRECISA
 * tratar esse null como "não pode emitir", nunca como "então usa a do
 * sistema". A decisão sobre a conta compartilhada é tomada em um lugar só,
 * dentro do efi.ts, de propósito.
 */
export async function lerCredenciaisBanco(
  db: any,
  uid: string
): Promise<CredenciaisBanco | null> {
  if (!db || !uid) return null;

  const emCache = cache.get(uid);
  if (emCache && emCache.expiraEm > Date.now()) return emCache.dados;

  let dados: CredenciaisBanco | null = null;
  try {
    const snap = await db.collection(COLECAO_CREDENCIAIS).doc(uid).get();
    if (snap.exists) {
      const d = snap.data() || {};
      dados = {
        provedor: (d.provedor || "efi") as ProvedorBanco,
        ambiente: d.ambiente === "producao" ? "producao" : "homologacao",
        segredos: abrirSegredos(d),
      };
      for (const c of CAMPOS_CONTA) (dados as any)[c] = d[c] || "";
    }
  } catch (err: any) {
    // Cofre corrompido ou chave trocada: melhor tratar como "não tem" e deixar
    // o usuário cadastrar de novo do que derrubar a emissão inteira.
    console.error("[Cofre do banco] Falha ao abrir credenciais:", err?.message || err);
    dados = null;
  }

  cache.set(uid, { dados, expiraEm: Date.now() + CACHE_MS });
  return dados;
}

/**
 * Grava.
 *
 * Percorre os campos declarados PELO PROVEDOR — não assume que todo banco tem
 * Client ID e Client Secret, que foi exatamente o engano que a Asaas expôs.
 *
 * Campo em branco significa "não mexi nele": assim a pessoa corrige a agência
 * sem redigitar a chave de API, que é justamente quando ela erraria e
 * derrubaria a emissão.
 */
export async function guardarCredenciaisBanco(
  db: any,
  uid: string,
  entrada: Record<string, any>
): Promise<ResumoCredenciais> {
  if (!db) throw new Error("SEM_BANCO");
  if (!uid) throw new Error("NAO_AUTENTICADO");

  const provedor = (limpar(entrada.provedor) || "efi") as ProvedorBanco;
  const def = provedorConhecido(provedor);
  if (!def) throw new Error("PROVEDOR_DESCONHECIDO");

  const atual = await lerCredenciaisBanco(db, uid);
  // Trocar de banco não herda o segredo do banco anterior: são chaves de
  // sistemas diferentes, e reaproveitar só produziria erro de autenticação
  // difícil de entender.
  const anteriores: SegredosBanco = atual?.provedor === provedor ? atual.segredos : {};

  const segredos: SegredosBanco = {};

  // ⚠️ O token do aviso de pagamento NÃO é um campo declarado pelo provedor —
  //    é nosso, gerado pelo sistema. Sem carregá-lo à mão, a próxima gravação
  //    do formulário o apagaria, e o aviso do banco passaria a ser recusado
  //    silenciosamente. O usuário só descobriria pela nota que não saiu.
  if (anteriores.webhookToken) segredos.webhookToken = anteriores.webhookToken;

  for (const campo of def.credenciais) {
    const valor = limpar(entrada[campo.id]) || anteriores[campo.id] || "";
    if (!campo.opcional && !valor) throw new Error("CREDENCIAIS_INCOMPLETAS");
    if (valor) segredos[campo.id] = valor;
  }

  // O identificador mostrado é o primeiro campo declarado pelo provedor — o
  // Client ID na Efí, a Chave de API na Asaas.
  const principal = segredos[def.credenciais[0]?.id] || "";

  const agora = new Date().toISOString();
  const doc: any = {
    userId: uid,
    provedor,
    ambiente: entrada.ambiente === "producao" ? "producao" : "homologacao",

    segredosCifrados: cifrar(JSON.stringify(segredos)),

    // Guardado em claro só para o resumo conseguir mostrar sem abrir o cofre.
    identificacao: mascarar(principal),

    atualizadoEm: agora,

    // ⚠️ Limpeza do formato antigo. Sem isto, um documento migrado ficaria com
    // os campos velhos cifrados para sempre — segredo duplicado em repouso, e
    // uma segunda cópia para vazar.
    clientIdCifrado: "",
    clientSecretCifrado: "",
    pixClientIdCifrado: "",
    pixClientSecretCifrado: "",
  };

  for (const c of CAMPOS_CONTA) {
    doc[c] = limpar(entrada[c] ?? (atual as any)?.[c]);
  }

  const antes = await db.collection(COLECAO_CREDENCIAIS).doc(uid).get();
  if (!antes.exists) doc.cadastradoEm = agora;

  await db.collection(COLECAO_CREDENCIAIS).doc(uid).set(doc, { merge: true });
  limparCacheCredenciais(uid);

  return await resumoCredenciais(db, uid);
}

// ============================================================================
// AVISO DE PAGAMENTO — o endereço que o usuário cola no painel do banco
// ============================================================================
//
// O banco precisa saber PARA ONDE avisar, e nós precisamos saber DE QUEM é o
// aviso. Como o endereço é colado pelo próprio usuário no painel dele, o UID
// vai na URL — do mesmo jeito que já fazemos com a Efí.
//
// ⚠️ O TOKEN NÃO É O QUE GARANTE A SEGURANÇA. Ele é a primeira porta: barra
//    quem descobriu a URL e resolveu bater nela. A garantia de verdade é que o
//    aviso é tratado como BOATO — ao receber, o sistema pergunta ao próprio
//    banco se aquilo é verdade, usando a chave do usuário. Sem isso, um aviso
//    forjado criaria um recebimento e faria sair uma NOTA FISCAL de um
//    pagamento que nunca aconteceu. Nota fiscal indevida dá trabalho para
//    cancelar e é problema fiscal, não bug de tela.

/** Devolve o token do aviso, criando na primeira vez. */
export async function garantirTokenWebhook(db: any, uid: string): Promise<string> {
  const atual = await lerCredenciaisBanco(db, uid);
  if (!atual) throw new Error("SEM_CREDENCIAIS_USUARIO");
  if (atual.segredos.webhookToken) return atual.segredos.webhookToken;

  const token = crypto.randomBytes(24).toString("hex");
  const segredos = { ...atual.segredos, webhookToken: token };

  await db.collection(COLECAO_CREDENCIAIS).doc(uid).set(
    { segredosCifrados: cifrar(JSON.stringify(segredos)), atualizadoEm: new Date().toISOString() },
    { merge: true }
  );
  limparCacheCredenciais(uid);
  return token;
}

/** Confere o token que o banco mandou no aviso. Comparação em tempo constante. */
export function tokenWebhookConfere(guardado: string, recebido: string): boolean {
  const a = Buffer.from(String(guardado || ""), "utf8");
  const b = Buffer.from(String(recebido || ""), "utf8");
  // ⚠️ Comprimentos diferentes fazem timingSafeEqual ESTOURAR, em vez de
  //    devolver false. Conferir antes evita derrubar a rota com um aviso
  //    malformado.
  if (a.length === 0 || a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export async function apagarCredenciaisBanco(db: any, uid: string): Promise<void> {
  if (!db || !uid) return;
  await db.collection(COLECAO_CREDENCIAIS).doc(uid).delete();
  limparCacheCredenciais(uid);
}

/** O que a tela recebe. Lê o documento cru, sem abrir os segredos. */
export async function resumoCredenciais(db: any, uid: string): Promise<ResumoCredenciais> {
  if (!db || !uid) return { cadastrado: false };

  let d: any = null;
  try {
    const snap = await db.collection(COLECAO_CREDENCIAIS).doc(uid).get();
    if (snap.exists) d = snap.data();
  } catch (err: any) {
    console.error("[Cofre do banco] Falha ao ler resumo:", err?.message || err);
  }
  if (!d) return { cadastrado: false };

  const def = provedorConhecido(d.provedor || "efi");

  const resumo: ResumoCredenciais = {
    cadastrado: true,
    provedor: (d.provedor || "efi") as ProvedorBanco,
    provedorNome: def?.nome || d.provedor,
    emiteBoleto: !!def?.emiteBoleto,
    avisoAutomatico: !!def?.avisoAutomatico,
    ambiente: d.ambiente === "producao" ? "producao" : "homologacao",
    identificacao: d.identificacao || "",
    temSegredo: !!(d.segredosCifrados || d.clientSecretCifrado),
    cadastradoEm: d.cadastradoEm || "",
    atualizadoEm: d.atualizadoEm || "",
  };
  for (const c of CAMPOS_CONTA) (resumo as any)[c] = d[c] || "";
  return resumo;
}

// ============================================================================
// ROTAS
// ============================================================================
//
// Nenhuma delas devolve segredo. A de gravar responde com o mesmo resumo da de
// ler, para a tela se atualizar sem precisar guardar o que foi digitado.

const MENSAGENS: Record<string, [number, string]> = {
  NAO_AUTENTICADO: [401, "Faça login para cadastrar as credenciais do seu banco."],
  SEM_BANCO: [503, "O servidor está sem conexão com o banco de dados agora."],
  SEM_CHAVE_CRIPTO: [
    503,
    "O servidor está sem a chave de segurança (NFSE_CRYPTO_KEY), então não pode guardar credenciais com segurança.",
  ],
  PROVEDOR_DESCONHECIDO: [400, "Esse banco ainda não é reconhecido pelo sistema."],
  CREDENCIAIS_INCOMPLETAS: [
    400,
    "Preencha todos os campos obrigatórios que o seu banco fornece.",
  ],
  COFRE_CORROMPIDO: [
    500,
    "As credenciais guardadas não puderam ser abertas. Cadastre-as novamente.",
  ],
};

function responderErro(res: any, err: any) {
  const [status, mensagem] = MENSAGENS[err?.message] || [
    500,
    `Não foi possível concluir: ${err?.message || "erro desconhecido"}`,
  ];
  if (status >= 500) console.error("[Cofre do banco]", err?.message || err);
  res.status(status).json({ success: false, mensagem });
}

export function registrarRotasBanco(app: any, db: any) {
  /** Quais bancos o sistema opera hoje, e que campos cada um pede. */
  app.get("/api/banco/provedores", (_req: any, res: any) => {
    res.json({
      success: true,
      cofreDisponivel: cofreDisponivel(),
      provedores: PROVEDORES,
    });
  });

  /** O resumo do que este usuário cadastrou. Sem segredo. */
  app.get("/api/banco/credenciais", async (req: any, res: any) => {
    try {
      const uid = await verificarLogin(req);
      res.json({ success: true, ...(await resumoCredenciais(db, uid)) });
    } catch (err: any) {
      responderErro(res, err);
    }
  });

  const gravar = async (req: any, res: any) => {
    try {
      const uid = await verificarLogin(req);
      const resumo = await guardarCredenciaisBanco(db, uid, req.body || {});
      res.json({ success: true, mensagem: "Credenciais guardadas no cofre.", ...resumo });
    } catch (err: any) {
      responderErro(res, err);
    }
  };

  // Alguns clientes HTTP (e o Capacitor) tratam PUT de forma diferente;
  // POST no mesmo caminho faz a mesma coisa, para não haver surpresa.
  app.put("/api/banco/credenciais", gravar);
  app.post("/api/banco/credenciais", gravar);

  /**
   * O endereço de aviso, para o usuário colar no painel do banco.
   *
   * Só faz sentido para quem usa um banco que avisa sozinho — para os outros a
   * resposta diz isso, em vez de entregar um endereço que ninguém vai usar.
   */
  app.get("/api/banco/webhook", async (req: any, res: any) => {
    try {
      const uid = await verificarLogin(req);
      const resumo = await resumoCredenciais(db, uid);

      if (!resumo.cadastrado) {
        return res.json({ success: true, disponivel: false, motivo: "Cadastre o seu banco primeiro." });
      }
      const def = provedorConhecido(resumo.provedor || "");
      if (!def?.avisoAutomatico || resumo.provedor !== "asaas") {
        return res.json({
          success: true,
          disponivel: false,
          motivo:
            resumo.provedor === "efi"
              ? "A Efí é configurada automaticamente a cada cobrança — não há nada para colar."
              : "Este banco ainda não avisa o pagamento automaticamente.",
        });
      }

      const token = await garantirTokenWebhook(db, uid);
      // ⚠️ Preferir sempre a variável de ambiente. O valor fixo abaixo só
      // entra em cena se ela faltar E o próprio pedido não trouxer o host —
      // um domínio de um ambiente específico, hardcoded, quebraria em
      // silêncio para qualquer outro domínio (produção nova, domínio
      // próprio, etc.). Preferir o host de quem chamou é mais portátil.
      const hostDoPedido = req.headers?.["x-forwarded-host"] || req.headers?.host;
      const protocoloDoPedido = String(req.headers?.["x-forwarded-proto"] || "https").split(",")[0];
      const base = (
        process.env.APP_URL ||
        (hostDoPedido ? `${protocoloDoPedido}://${hostDoPedido}` : "https://meiflow.rdhomologacao.com.br")
      ).replace(/\/+$/, "");

      res.json({
        success: true,
        disponivel: true,
        url: `${base}/api/banco/webhook/asaas?u=${encodeURIComponent(uid)}`,
        token,
        instrucoes: [
          "No painel da Asaas, abra Configurações → Integrações → Webhooks.",
          "Crie um webhook novo e cole o endereço acima no campo de URL.",
          "Cole o token no campo de autenticação (Token de acesso).",
          "Marque os eventos de cobrança — pagamento recebido e confirmado.",
          "Salve. A partir daí, boleto pago dá baixa e emite a nota sozinho.",
        ],
      });
    } catch (err: any) {
      responderErro(res, err);
    }
  });

  /** Apagar. */
  app.delete("/api/banco/credenciais", async (req: any, res: any) => {
    try {
      const uid = await verificarLogin(req);
      await apagarCredenciaisBanco(db, uid);
      res.json({ success: true, mensagem: "Credenciais removidas.", cadastrado: false });
    } catch (err: any) {
      responderErro(res, err);
    }
  });
}
