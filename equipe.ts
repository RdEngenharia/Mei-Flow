/**
 * ============================================================================
 * MEI FLOW — USUÁRIOS DA EMPRESA (dono + ajudantes com permissões)
 * ============================================================================
 *
 * O QUE ISTO RESOLVE
 *
 * Até aqui, uma conta era uma pessoa. Quem contrata um ajudante e quer que ele
 * lance vendas sem enxergar o faturamento inteiro — ou emita boleto sem poder
 * trocar a conta bancária que recebe — não tinha saída a não ser emprestar a
 * própria senha. Emprestar senha não é permissão: é abrir tudo e torcer.
 *
 * Aqui o dono cria logins próprios, com senha própria, e escolhe o que cada um
 * enxerga.
 *
 * (Desenho trazido do Vitri Pro, onde já roda em produção. O modelo é o mesmo;
 * o encanamento é outro — ver abaixo.)
 *
 * ----------------------------------------------------------------------------
 * ⚠️ POR QUE NÃO USAMOS `firebase-admin/auth`
 *
 * No Vitri Pro isto é uma linha: `admin.auth().createUser()`. Aqui não pode
 * ser. Aquele pacote arrasta o `jose` em formato novo e ESTOURA na Vercel com
 * ERR_REQUIRE_ESM — a função morre antes de rodar a primeira linha. É o mesmo
 * motivo pelo qual a verificação de login deste projeto foi escrita à mão, em
 * auth-firebase.ts.
 *
 * Então falamos com o Firebase pela API REST dele, assinando um token de
 * serviço com a chave que já está nas variáveis de ambiente. Mesmo resultado,
 * mesmas garantias, nenhuma dependência nova.
 *
 * ----------------------------------------------------------------------------
 * ONDE AS PERMISSÕES MORAM
 *
 * Dentro do token de login (as "custom claims"), e não numa coleção. Uma
 * coleção obrigaria a uma leitura de banco a cada operação; no token, chegam
 * prontas e já verificadas pela assinatura do Google.
 *
 * O preço disso está na seção "O ATRASO DO TOKEN", mais abaixo. É pequeno, mas
 * precisa aparecer na tela — senão vira "mudei a permissão e não aconteceu
 * nada".
 */

import crypto from "crypto";
import axios from "axios";
import { exigirUsuarioCompleto, type UsuarioVerificado } from "./auth-firebase.js";
import { exigirPremium, responderSePlano } from "./plano.js";

const env = (k: string) => (process.env[k] || "").trim();

/** Onde a lista de pessoas da empresa fica. */
export const COLECAO_EQUIPE = "equipe";

/** Quantos ajudantes cada empresa pode ter. Vale só no Premium. */
export const MAX_MEMBROS = 2;

// ============================================================================
// AS ÁREAS QUE PODEM SER DELEGADAS
// ============================================================================
//
// A lista mora no servidor e a tela lê dela — mesmo princípio já usado nos
// bancos: é impossível a tela oferecer uma permissão que o servidor não
// reconhece.
//
// ⚠️ NEM TUDO ENTRA AQUI, E ISSO É DELIBERADO.
//
// "Poder operar" e "poder configurar o que a operação usa por trás" são coisas
// diferentes, e a segunda é mais sensível. Um ajudante pode emitir boleto; ele
// NÃO pode trocar a conta bancária que recebe o dinheiro, nem enviar o
// certificado digital que assina notas no CNPJ do dono, nem criar outros
// usuários. Essas três não são permissões — são exclusivas do dono, sempre.

export type AreaPermissao =
  | "financeiro" | "clientes" | "orcamentos" | "catalogo" | "cobrancas" | "notafiscal" | "arquivos";

export const AREAS: { id: AreaPermissao; nome: string; descricao: string }[] = [
  { id: "financeiro", nome: "Livro Caixa", descricao: "Ver e lançar entradas e saídas." },
  { id: "clientes", nome: "Clientes", descricao: "Cadastrar e editar clientes." },
  { id: "orcamentos", nome: "Orçamentos", descricao: "Criar propostas e acompanhar o funil." },
  { id: "catalogo", nome: "Catálogo", descricao: "Cadastrar produtos e serviços." },
  { id: "cobrancas", nome: "Cobranças e boletos", descricao: "Emitir boletos e acompanhar pagamentos." },
  { id: "notafiscal", nome: "Nota fiscal", descricao: "Emitir NFS-e com o certificado da empresa." },
  { id: "arquivos", nome: "Arquivos Fiscais", descricao: "Ver e baixar notas e comprovantes." },
];

export type Permissoes = Partial<Record<AreaPermissao, boolean>>;

/**
 * Reconstrói o objeto campo a campo.
 *
 * ⚠️ NUNCA aceite o objeto cru que veio do navegador. Sem isto, alguém poderia
 *    mandar `{ mestre: true }` junto e o campo entraria no token de login — que
 *    é a coisa em que todo o resto do sistema confia.
 */
export function limparPermissoes(bruto: any): Permissoes {
  const limpo: Permissoes = {};
  for (const area of AREAS) limpo[area.id] = !!bruto?.[area.id];
  return limpo;
}

// ============================================================================
// FALANDO COM O FIREBASE PELA API REST
// ============================================================================

let tokenServico: { valor: string; expiraEm: number } | null = null;

/**
 * Token de acesso do Google, obtido assinando um JWT com a chave de serviço.
 *
 * Este é o único trecho "de infraestrutura" do arquivo. Ele existe porque não
 * podemos importar o SDK administrativo — ver o aviso no topo.
 */
async function tokenDoServico(): Promise<string> {
  if (tokenServico && tokenServico.expiraEm > Date.now() + 60_000) return tokenServico.valor;

  const email = env("FIREBASE_CLIENT_EMAIL");
  const chave = env("FIREBASE_PRIVATE_KEY").replace(/\\n/g, "\n");
  if (!email || !chave) throw new Error("SEM_CREDENCIAL_ADMIN");

  const agora = Math.floor(Date.now() / 1000);
  const cabecalho = { alg: "RS256", typ: "JWT" };
  const corpo = {
    iss: email,
    scope: "https://www.googleapis.com/auth/identitytoolkit https://www.googleapis.com/auth/cloud-platform",
    aud: "https://oauth2.googleapis.com/token",
    iat: agora,
    exp: agora + 3600,
  };

  const b64 = (o: any) =>
    Buffer.from(JSON.stringify(o)).toString("base64url");
  const naoAssinado = `${b64(cabecalho)}.${b64(corpo)}`;
  const assinatura = crypto.sign("RSA-SHA256", Buffer.from(naoAssinado), chave).toString("base64url");

  const { data } = await axios.post(
    "https://oauth2.googleapis.com/token",
    new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: `${naoAssinado}.${assinatura}`,
    }).toString(),
    { headers: { "Content-Type": "application/x-www-form-urlencoded" }, timeout: 15000 }
  );

  tokenServico = {
    valor: data.access_token,
    expiraEm: Date.now() + (data.expires_in || 3600) * 1000,
  };
  return tokenServico.valor;
}

const projeto = () => env("FIREBASE_PROJECT_ID") || "mei-flow-692d9";

async function identityToolkit(caminho: string, corpo: any) {
  const token = await tokenDoServico();
  try {
    const { data } = await axios.post(
      `https://identitytoolkit.googleapis.com/v1/projects/${projeto()}${caminho}`,
      corpo,
      { headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, timeout: 20000 }
    );
    return data;
  } catch (err: any) {
    const motivo = err?.response?.data?.error?.message || err?.message || "";
    // Os erros do Firebase vêm em caixa-alta e sem tradução. Como o usuário lê
    // isto na tela, cada um vira uma frase que diz o que fazer.
    if (/EMAIL_EXISTS/i.test(motivo)) throw new Error("EMAIL_JA_USADO");
    if (/INVALID_EMAIL/i.test(motivo)) throw new Error("EMAIL_INVALIDO");
    if (/WEAK_PASSWORD/i.test(motivo)) throw new Error("SENHA_FRACA");
    console.error("[Equipe] Firebase recusou:", motivo);
    throw new Error("FIREBASE_RECUSOU");
  }
}

// ============================================================================
// QUEM É QUEM
// ============================================================================

export type AcessoResolvido = {
  /** O login de quem está usando o sistema agora. */
  uid: string;
  /** A empresa dona dos dados. Para o mestre, é o próprio uid. */
  empresaId: string;
  papel: "mestre" | "membro";
  permissoes?: Permissoes;
};

export async function resolverAcesso(req: any): Promise<AcessoResolvido> {
  const u: UsuarioVerificado = await exigirUsuarioCompleto(req);
  return {
    uid: u.uid,
    empresaId: u.empresaId || u.uid,
    papel: u.papel === "membro" ? "membro" : "mestre",
    permissoes: u.permissoes as Permissoes | undefined,
  };
}

/**
 * Exige uma área específica. O mestre nunca é barrado.
 *
 * Use isto nas rotas que mexem em dados de uma área — e não `exigirUsuario`
 * sozinho, que só diz que a pessoa está logada.
 */
export async function exigirArea(req: any, area: AreaPermissao): Promise<AcessoResolvido> {
  const acesso = await resolverAcesso(req);
  if (acesso.papel === "mestre") return acesso;
  if (!acesso.permissoes?.[area]) throw new Error("SEM_PERMISSAO");
  return acesso;
}

/**
 * Só o dono passa — nem um membro com todas as áreas marcadas.
 *
 * Vale para gerenciar equipe, para o certificado digital e para as credenciais
 * do banco. Quem opera não configura o que a operação usa.
 */
export async function exigirMestre(req: any): Promise<AcessoResolvido> {
  const acesso = await resolverAcesso(req);
  if (acesso.papel === "membro") throw new Error("APENAS_MESTRE");
  return acesso;
}

// ============================================================================
// AS OPERAÇÕES
// ============================================================================

export type MembroEquipe = {
  uid: string;
  empresaId: string;
  nome: string;
  email: string;
  papel: "mestre" | "membro";
  permissoes: Permissoes;
  criadoEm?: string;
  atualizadoEm?: string;
};

export async function listarEquipe(db: any, empresaId: string): Promise<MembroEquipe[]> {
  if (!db) return [];
  const snap = await db.collection(COLECAO_EQUIPE).where("empresaId", "==", empresaId).get();
  return snap.docs.map((d: any) => d.data());
}

export async function criarMembro(
  db: any,
  empresaId: string,
  entrada: { nome?: string; email?: string; senha?: string; permissoes?: any }
): Promise<MembroEquipe> {
  const nome = String(entrada?.nome || "").trim();
  const email = String(entrada?.email || "").trim().toLowerCase();
  const senha = String(entrada?.senha || "");

  if (!nome) throw new Error("SEM_NOME");
  if (!email.includes("@")) throw new Error("EMAIL_INVALIDO");
  // O Firebase exige 6; exigimos 8 porque esta senha abre o sistema de uma
  // empresa, não um fórum.
  if (senha.length < 8) throw new Error("SENHA_FRACA");

  const jaExistem = (await listarEquipe(db, empresaId)).filter((m) => m.papel === "membro");
  if (jaExistem.length >= MAX_MEMBROS) throw new Error("LIMITE_ATINGIDO");

  const permissoes = limparPermissoes(entrada?.permissoes);

  // 1) a conta de login
  const criado = await identityToolkit("/accounts", {
    email,
    password: senha,
    displayName: nome,
    emailVerified: false,
  });
  const uid = String(criado?.localId || "");
  if (!uid) throw new Error("FIREBASE_RECUSOU");

  // 2) as permissões, gravadas dentro do token de login
  await gravarClaims(uid, empresaId, permissoes);

  // 3) o registro que a tela lista
  const agora = new Date().toISOString();
  const membro: MembroEquipe = {
    uid, empresaId, nome, email, papel: "membro", permissoes,
    criadoEm: agora, atualizadoEm: agora,
  };
  await db.collection(COLECAO_EQUIPE).doc(uid).set(membro);
  return membro;
}

/**
 * Grava as permissões DENTRO do token de login.
 *
 * `customAttributes` é uma string JSON — não um objeto. Mandar objeto faz o
 * Firebase aceitar a chamada e guardar nada, o que é o pior desfecho: parece
 * que deu certo e a pessoa entra sem permissão nenhuma.
 */
async function gravarClaims(uid: string, empresaId: string, permissoes: Permissoes) {
  await identityToolkit("/accounts:update", {
    localId: uid,
    customAttributes: JSON.stringify({ empresaId, papel: "membro", permissoes }),
  });
}

export async function atualizarPermissoes(
  db: any,
  empresaId: string,
  uid: string,
  brutas: any
): Promise<MembroEquipe> {
  const snap = await db.collection(COLECAO_EQUIPE).doc(uid).get();
  if (!snap.exists) throw new Error("MEMBRO_DESCONHECIDO");
  const atual = snap.data();
  // Sem esta conferência, o dono de uma empresa mexeria no funcionário de
  // outra passando o uid dele na mão.
  if (atual.empresaId !== empresaId) throw new Error("MEMBRO_DE_OUTRA_EMPRESA");
  if (atual.papel === "mestre") throw new Error("MESTRE_NAO_TEM_PERMISSAO_LIMITADA");

  const permissoes = limparPermissoes(brutas);
  await gravarClaims(uid, empresaId, permissoes);

  const atualizado = { ...atual, permissoes, atualizadoEm: new Date().toISOString() };
  await db.collection(COLECAO_EQUIPE).doc(uid).set(atualizado, { merge: true });
  return atualizado;
}

export async function removerMembro(db: any, empresaId: string, uid: string): Promise<void> {
  const snap = await db.collection(COLECAO_EQUIPE).doc(uid).get();
  if (!snap.exists) throw new Error("MEMBRO_DESCONHECIDO");
  const atual = snap.data();
  if (atual.empresaId !== empresaId) throw new Error("MEMBRO_DE_OUTRA_EMPRESA");
  if (atual.papel === "mestre") throw new Error("NAO_REMOVE_MESTRE");

  const token = await tokenDoServico();
  await axios.post(
    `https://identitytoolkit.googleapis.com/v1/projects/${projeto()}/accounts:delete`,
    { localId: uid },
    { headers: { Authorization: `Bearer ${token}` }, timeout: 20000 }
  ).catch((err: any) => {
    // A conta pode já ter sido apagada no console do Firebase. O registro
    // daqui precisa sair de qualquer forma, senão a lista mostra um fantasma.
    console.warn("[Equipe] Conta de login não removida:", err?.response?.data || err?.message);
  });

  await db.collection(COLECAO_EQUIPE).doc(uid).delete();
}

// ============================================================================
// ROTAS
// ============================================================================

const MENSAGENS: Record<string, [number, string]> = {
  NAO_AUTENTICADO: [401, "Faça login para continuar."],
  APENAS_MESTRE: [403, "Só o dono da conta pode gerenciar os usuários."],
  SEM_PERMISSAO: [403, "Você não tem acesso a esta área. Peça ao dono da conta."],
  SEM_NOME: [400, "Informe o nome da pessoa."],
  EMAIL_INVALIDO: [400, "Esse e-mail não parece válido."],
  EMAIL_JA_USADO: [400, "Já existe uma conta com esse e-mail."],
  SENHA_FRACA: [400, "A senha precisa ter pelo menos 8 caracteres."],
  LIMITE_ATINGIDO: [400, `Você já tem ${MAX_MEMBROS} usuários. Remova um antes de criar outro.`],
  MEMBRO_DESCONHECIDO: [404, "Usuário não encontrado."],
  MEMBRO_DE_OUTRA_EMPRESA: [403, "Esse usuário não é da sua empresa."],
  NAO_REMOVE_MESTRE: [400, "O dono da conta não pode ser removido."],
  MESTRE_NAO_TEM_PERMISSAO_LIMITADA: [400, "O dono da conta enxerga tudo, sempre."],
  SEM_CREDENCIAL_ADMIN: [503, "O servidor está sem a credencial para criar contas."],
  FIREBASE_RECUSOU: [502, "O serviço de login recusou a operação. Tente de novo em instantes."],
  PRECISA_PREMIUM: [428, "Criar usuários para a sua equipe é um recurso do plano Premium."],
};

function responderErro(res: any, err: any) {
  // A recusa por causa do plano tem resposta própria (com o nome do recurso),
  // definida em plano.ts — o mesmo formato das rotas de nota e de boleto.
  if (responderSePlano(res, err)) return;

  const [status, mensagem] = MENSAGENS[err?.message] || [500, `Não foi possível concluir: ${err?.message || "erro"}`];
  if (status >= 500) console.error("[Equipe]", err?.message || err);
  res.status(status).json({ success: false, mensagem });
}

export function registrarRotasEquipe(app: any, db: any) {
  /** As áreas que podem ser delegadas — a tela desenha a partir daqui. */
  app.get("/api/equipe/areas", (_req: any, res: any) => {
    res.json({ success: true, areas: AREAS, limite: MAX_MEMBROS });
  });

  /** Quem sou eu nesta empresa. A tela usa para montar o menu. */
  app.get("/api/equipe/eu", async (req: any, res: any) => {
    try {
      const acesso = await resolverAcesso(req);
      res.json({ success: true, ...acesso });
    } catch (err: any) {
      responderErro(res, err);
    }
  });

  /** A equipe inteira. Membro também vê — só não mexe. */
  app.get("/api/equipe", async (req: any, res: any) => {
    try {
      const acesso = await resolverAcesso(req);
      const equipe = await listarEquipe(db, acesso.empresaId);
      res.json({ success: true, equipe, limite: MAX_MEMBROS, papel: acesso.papel });
    } catch (err: any) {
      responderErro(res, err);
    }
  });

  app.post("/api/equipe", async (req: any, res: any) => {
    try {
      const acesso = await exigirMestre(req);

      /**
       * O plano é conferido no SERVIDOR, e não só pelo botão escondido na tela.
       *
       * ⚠️ ISTO AQUI OLHAVA SÓ O CAMPO `planType`, E ESSE ERA UM BUG CALADO.
       *
       * O perfil tem três jeitos de dizer "é Premium", herdados de versões
       * diferentes: `planType`, o antigo `plan` e o `isPremium` que o Mercado
       * Pago grava. Existe assinante em produção com só um dos três
       * preenchido — e ele levava um "assine o Premium" na cara, já sendo
       * assinante. Agora quem responde é o plano.ts, que olha os três.
       */
      await exigirPremium(db, acesso.empresaId, "usuarios");

      const membro = await criarMembro(db, acesso.empresaId, req.body || {});
      res.json({
        success: true,
        membro,
        mensagem: `${membro.nome} já pode entrar com o e-mail e a senha que você definiu.`,
      });
    } catch (err: any) {
      responderErro(res, err);
    }
  });

  app.put("/api/equipe/:uid", async (req: any, res: any) => {
    try {
      const acesso = await exigirMestre(req);
      const membro = await atualizarPermissoes(db, acesso.empresaId, String(req.params.uid), req.body?.permissoes);
      res.json({
        success: true,
        membro,
        /**
         * O ATRASO DO TOKEN — precisa aparecer na tela.
         *
         * As permissões vivem dentro do login da pessoa, e esse login só é
         * renovado de tempos em tempos. Mudança feita agora vale quando ela
         * sair e entrar de novo. Não dizer isso gera o pior tipo de dúvida:
         * "eu mudei e não aconteceu nada — será que salvou?".
         */
        mensagem: "Permissões salvas. Elas valem quando a pessoa sair e entrar de novo.",
      });
    } catch (err: any) {
      responderErro(res, err);
    }
  });

  app.delete("/api/equipe/:uid", async (req: any, res: any) => {
    try {
      const acesso = await exigirMestre(req);
      await removerMembro(db, acesso.empresaId, String(req.params.uid));
      res.json({ success: true, mensagem: "Usuário removido. Ele perde o acesso imediatamente." });
    } catch (err: any) {
      responderErro(res, err);
    }
  });
}
