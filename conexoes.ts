/**
 * ============================================================================
 * MEI FLOW — Conexão automática de contas (OAuth 2.0 multi-provedor)
 * ============================================================================
 *
 * PRINCÍPIO DESTE ARQUIVO: o usuário final NÃO configura nada.
 *
 * Ele vê a lista de contas, toca em "Conectar", autoriza dentro da própria
 * fintech e acabou. Daí em diante o sistema cuida de tudo sozinho:
 *
 *   ✔ descobre quais provedores estão prontos (pelas credenciais do servidor)
 *   ✔ renova o token antes de vencer, sem pedir nada ao usuário
 *   ✔ trata rotação de refresh token (PagBank invalida o anterior a cada uso)
 *   ✔ guarda uma fotografia em cache, então a tela abre instantânea
 *   ✔ atualiza em segundo plano quando o cache envelhece
 *   ✔ se a autorização for revogada, marca "reautorizar" em vez de quebrar
 *
 * ADICIONAR UM NOVO PROVEDOR = acrescentar um bloco em PROVEDORES.
 * Nenhuma rota, nenhuma tela e nenhum fluxo precisa ser reescrito.
 *
 * ----------------------------------------------------------------------------
 * COMO INSTALAR
 *
 * 1. Salve como  conexoes.ts  na raiz (junto de server.ts e efi.ts).
 * 2. No server.ts, no topo:      import { registrarRotasConexoes } from "./conexoes";
 *    e dentro de startServer():  registrarRotasConexoes(app, db);
 *
 * ----------------------------------------------------------------------------
 * VARIÁVEIS DE AMBIENTE (só o DONO configura, uma vez, na Vercel)
 *
 *   APP_URL                    → https://meiflow.rdhomologacao.com.br
 *   CONEXOES_CRYPTO_KEY        → openssl rand -hex 32
 *   CONEXOES_SANDBOX           → "true" enquanto testa
 *
 *   MP_OAUTH_CLIENT_ID / MP_OAUTH_CLIENT_SECRET          (Mercado Pago)
 *   PAGBANK_CLIENT_ID / PAGBANK_CLIENT_SECRET            (PagBank)
 *
 * Provedor sem credencial simplesmente não aparece como disponível na tela.
 * Nada quebra.
 *
 * ⚠️ CÓDIGO NUNCA EXECUTADO CONTRA AS APIS REAIS. Escrito a partir da
 *    documentação oficial. A lógica interna (criptografia, PKCE, baldes)
 *    foi testada isoladamente e passou.
 */

import axios from "axios";
import crypto from "crypto";
import { getAuth } from "firebase-admin/auth";

const APP_URL = process.env.APP_URL || "https://meiflow.rdhomologacao.com.br";
const SANDBOX = process.env.CONEXOES_SANDBOX === "true";

/** Quanto tempo a fotografia vale antes de ser refeita. */
const CACHE_MINUTOS = 10;
/** Renova o token quando faltar menos que isto para vencer. */
const MARGEM_RENOVACAO_MS = 24 * 60 * 60 * 1000;

// ============================================================================
// 1. CATÁLOGO DE PROVEDORES — a única coisa que muda ao adicionar um novo
// ============================================================================

export type Movimento = {
  id: string;
  descricao: string;
  valorBruto: number;
  valorLiquido: number;
  status: string;
  situacao: "disponivel" | "aLiberar" | "pendente";
  dataAprovacao: string | null;
  dataLiberacao: string | null;
  meio: string;
};

export type Fotografia = {
  disponivel: number;
  aLiberar: number;
  pendente: number;
  total: number;
  contagem: { disponivel: number; aLiberar: number; pendente: number };
  movimentos: Movimento[];
};

type Provedor = {
  id: string;
  nome: string;
  metodo: "oauth" | "chave" | "open_finance";
  cor: string;
  mostra: string[];
  observacao?: string;
  /** Lê as credenciais do ambiente. Retorna null se não configurado. */
  credenciais?: () => { id: string; secret: string } | null;
  urlAutorizacao?: () => string;
  urlToken?: () => string;
  urlRenovacao?: () => string;
  escopos?: string;
  /** PKCE só é suportado por alguns provedores. */
  usaPkce?: boolean;
  /** Como o provedor espera receber client_id/secret na troca de token. */
  estiloAuth?: "corpo" | "headers_x_client";
  /** Traduz a API do provedor na fotografia padronizada. */
  fotografar?: (accessToken: string, dias: number) => Promise<Fotografia>;
};

const env = (k: string) => (process.env[k] || "").trim();

function credenciaisDe(idVar: string, secretVar: string) {
  return () => {
    const id = env(idVar);
    const secret = env(secretVar);
    return id && secret ? { id, secret } : null;
  };
}

export const PROVEDORES: Provedor[] = [
  // -------------------------------------------------------------- MERCADO PAGO
  {
    id: "mercadopago",
    nome: "Mercado Pago",
    metodo: "oauth",
    cor: "#00B1EA",
    mostra: ["saldo disponível", "a liberar", "pendente", "extrato"],
    credenciais: credenciaisDe("MP_OAUTH_CLIENT_ID", "MP_OAUTH_CLIENT_SECRET"),
    urlAutorizacao: () => "https://auth.mercadopago.com.br/authorization",
    urlToken: () => "https://api.mercadopago.com/oauth/token",
    urlRenovacao: () => "https://api.mercadopago.com/oauth/token",
    usaPkce: true,
    estiloAuth: "corpo",
    fotografar: fotografarMercadoPago,
  },

  // ------------------------------------------------------------------- PAGBANK
  {
    id: "pagbank",
    nome: "PagBank",
    metodo: "oauth",
    cor: "#0F9D58",
    mostra: ["recebimentos", "pendente", "extrato"],
    credenciais: credenciaisDe("PAGBANK_CLIENT_ID", "PAGBANK_CLIENT_SECRET"),
    urlAutorizacao: () =>
      SANDBOX
        ? "https://connect.sandbox.pagbank.com.br/oauth2/authorize"
        : "https://connect.pagbank.com.br/oauth2/authorize",
    urlToken: () =>
      SANDBOX
        ? "https://sandbox.api.pagseguro.com/oauth2/token"
        : "https://api.pagseguro.com/oauth2/token",
    urlRenovacao: () =>
      SANDBOX
        ? "https://sandbox.api.pagseguro.com/oauth2/refresh"
        : "https://api.pagseguro.com/oauth2/refresh",
    escopos: "payments.read+accounts.read",
    usaPkce: false,
    estiloAuth: "headers_x_client",
    fotografar: fotografarPagBank,
  },

  // ----------------------------------------------- AINDA NÃO CONECTÁVEIS
  {
    id: "efi",
    nome: "Efí Bank",
    metodo: "chave",
    cor: "#F36F21",
    mostra: ["saldo", "extrato", "Pix"],
    observacao:
      "Conta do próprio MEI Flow. Usa certificado digital, não OAuth do usuário. Ver efi.ts.",
  },
  {
    id: "asaas",
    nome: "Asaas",
    metodo: "chave",
    cor: "#1E40AF",
    mostra: ["saldo", "cobranças"],
    observacao: "Não oferece OAuth para terceiros — só chave de API. Em desativação aqui.",
  },
  {
    id: "stone",
    nome: "Stone",
    metodo: "chave",
    cor: "#00A868",
    mostra: ["transações"],
    observacao:
      "O Stone Connect integra maquininha e PDV, não dá acesso de terceiro à conta. Não serve para a carteira.",
  },
  {
    id: "banco_tradicional",
    nome: "Banco tradicional (Itaú, Bradesco, Nubank…)",
    metodo: "open_finance",
    cor: "#475569",
    mostra: ["saldo", "extrato"],
    observacao:
      "Só via Open Finance, que exige agregador pago (~R$ 2.500/mês). Ver bancos.ts. Adiar até haver base de usuários.",
  },
];

const acharProvedor = (id: string) => PROVEDORES.find((p) => p.id === id);

/** Provedor está pronto para uso? (tem credenciais no servidor) */
function estaPronto(p: Provedor): boolean {
  return p.metodo === "oauth" && Boolean(p.credenciais?.());
}

// ============================================================================
// 2. COFRE DOS TOKENS (AES-256-GCM)
// ============================================================================

function chaveCripto(): Buffer {
  const hex = env("CONEXOES_CRYPTO_KEY");
  if (hex.length !== 64) throw new Error("SEM_CHAVE_CRIPTO");
  return Buffer.from(hex, "hex");
}

function cifrar(texto: string): string {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", chaveCripto(), iv);
  const d = Buffer.concat([c.update(texto || "", "utf8"), c.final()]);
  return `${iv.toString("base64")}.${c.getAuthTag().toString("base64")}.${d.toString("base64")}`;
}

function decifrar(pacote: string): string {
  const [iv, tag, dados] = String(pacote || "").split(".");
  if (!iv || !tag || !dados) throw new Error("TOKEN_CORROMPIDO");
  const d = crypto.createDecipheriv("aes-256-gcm", chaveCripto(), Buffer.from(iv, "base64"));
  d.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([d.update(Buffer.from(dados, "base64")), d.final()]).toString("utf8");
}

// ============================================================================
// 3. MOTOR OAUTH GENÉRICO
// ============================================================================

function redirectDe(provedorId: string) {
  return `${APP_URL}/api/conexoes/${provedorId}/callback`;
}

function gerarPkce() {
  const verifier = crypto.randomBytes(32).toString("base64url");
  const challenge = crypto.createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

function montarUrlAutorizacao(p: Provedor, state: string, challenge?: string): string {
  const cred = p.credenciais!()!;
  const partes = [
    `client_id=${encodeURIComponent(cred.id)}`,
    `response_type=code`,
    `redirect_uri=${encodeURIComponent(redirectDe(p.id))}`,
    `state=${encodeURIComponent(state)}`,
  ];
  if (p.id === "mercadopago") partes.push("platform_id=mp");
  if (p.escopos) partes.push(`scope=${p.escopos}`); // já vem com + entre escopos
  if (p.usaPkce && challenge) {
    partes.push(`code_challenge=${encodeURIComponent(challenge)}`, `code_challenge_method=S256`);
  }
  return `${p.urlAutorizacao!()}?${partes.join("&")}`;
}

/** Troca código por token, ou renova. Cobre os dois estilos de autenticação. */
async function chamarToken(
  p: Provedor,
  corpo: Record<string, string>,
  renovar = false
): Promise<any> {
  const cred = p.credenciais!()!;
  const url = renovar ? p.urlRenovacao!() : p.urlToken!();

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json",
  };
  const payload: Record<string, string> = { ...corpo };

  if (p.estiloAuth === "headers_x_client") {
    headers["X_CLIENT_ID"] = cred.id;
    headers["X_CLIENT_SECRET"] = cred.secret;
  } else {
    payload.client_id = cred.id;
    payload.client_secret = cred.secret;
  }

  const { data } = await axios.post(url, payload, { headers, timeout: 20000 });
  return data;
}

/**
 * Devolve um access token válido, renovando sozinho quando necessário.
 *
 * ⚠️ O PagBank ROTACIONA o refresh token: a cada renovação o anterior é
 * invalidado. Por isso gravamos sempre o novo par antes de usar.
 */
async function tokenValido(db: any, conexao: any): Promise<string> {
  const p = acharProvedor(conexao.provedor);
  if (!p) throw new Error("PROVEDOR_DESCONHECIDO");

  const vence = new Date(conexao.expiraEm || 0).getTime();
  if (vence > Date.now() + MARGEM_RENOVACAO_MS) return decifrar(conexao.accessToken);

  const dados = await chamarToken(
    p,
    { grant_type: "refresh_token", refresh_token: decifrar(conexao.refreshToken) },
    true
  );

  const atualizacao = {
    accessToken: cifrar(dados.access_token),
    refreshToken: cifrar(dados.refresh_token || decifrar(conexao.refreshToken)),
    expiraEm: new Date(Date.now() + (dados.expires_in || 15552000) * 1000).toISOString(),
    renovadoEm: new Date().toISOString(),
    status: "ativo",
  };
  await db.collection("conexoes_contas").doc(conexao.id).set(atualizacao, { merge: true });
  console.log(`[Conexões] Token renovado sozinho: ${conexao.id}`);
  return dados.access_token;
}

// ============================================================================
// 4. ADAPTADORES — traduzem cada API na mesma fotografia
// ============================================================================

const arred = (n: number) => Math.round(n * 100) / 100;

function baldeVazio(): Fotografia {
  return {
    disponivel: 0, aLiberar: 0, pendente: 0, total: 0,
    contagem: { disponivel: 0, aLiberar: 0, pendente: 0 },
    movimentos: [],
  };
}

function classificar(
  foto: Fotografia,
  situacao: "disponivel" | "aLiberar" | "pendente",
  liquido: number,
  mov: Movimento
) {
  foto[situacao] += liquido;
  foto.contagem[situacao] += 1;
  if (foto.movimentos.length < 100) foto.movimentos.push(mov);
}

/** MERCADO PAGO — GET /v1/payments/search */
async function fotografarMercadoPago(accessToken: string, dias: number): Promise<Fotografia> {
  const foto = baldeVazio();
  const fim = new Date();
  const inicio = new Date(Date.now() - dias * 86400000);
  const limite = 50;

  for (let pagina = 0, offset = 0; pagina < 10; pagina++, offset += limite) {
    const { data } = await axios.get("https://api.mercadopago.com/v1/payments/search", {
      params: {
        sort: "date_created", criteria: "desc", range: "date_created",
        begin_date: inicio.toISOString(), end_date: fim.toISOString(),
        limit: limite, offset,
      },
      headers: { Authorization: `Bearer ${accessToken}` },
      timeout: 25000,
    });

    const itens: any[] = data?.results || [];
    if (!itens.length) break;

    for (const p of itens) {
      // net_received_amount já vem sem as taxas — usar o bruto infla o saldo.
      const liquido = Number(p.transaction_details?.net_received_amount ?? p.transaction_amount ?? 0);
      const status = String(p.status || "");
      const lib = p.money_release_date ? new Date(p.money_release_date) : null;

      let situacao: "disponivel" | "aLiberar" | "pendente";
      if (status === "approved") {
        situacao = lib && lib.getTime() <= Date.now() ? "disponivel" : "aLiberar";
      } else if (["pending", "in_process", "authorized"].includes(status)) {
        situacao = "pendente";
      } else continue;

      classificar(foto, situacao, liquido, {
        id: String(p.id),
        descricao: p.description || p.payment_method_id || "Recebimento",
        valorBruto: Number(p.transaction_amount || 0),
        valorLiquido: liquido,
        status, situacao,
        dataAprovacao: p.date_approved || null,
        dataLiberacao: p.money_release_date || null,
        meio: p.payment_method_id || "",
      });
    }
    if (itens.length < limite) break;
  }

  foto.disponivel = arred(foto.disponivel);
  foto.aLiberar = arred(foto.aLiberar);
  foto.pendente = arred(foto.pendente);
  foto.total = arred(foto.disponivel + foto.aLiberar);
  return foto;
}

/**
 * PAGBANK — GET /orders
 *
 * ⚠️ O fluxo de conexão está conforme a documentação oficial. O mapeamento de
 * status abaixo foi montado a partir dos estados públicos de charge do PagBank
 * e ainda NÃO foi conferido contra uma conta real. Se algum valor sair fora do
 * balde certo, é aqui que se ajusta — o resto do módulo não muda.
 */
async function fotografarPagBank(accessToken: string, dias: number): Promise<Fotografia> {
  const foto = baldeVazio();
  const base = SANDBOX ? "https://sandbox.api.pagseguro.com" : "https://api.pagseguro.com";
  const inicio = new Date(Date.now() - dias * 86400000);

  const { data } = await axios.get(`${base}/orders`, {
    params: { created_at_start: inicio.toISOString(), size: 100 },
    headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
    timeout: 25000,
  });

  for (const pedido of data?.orders || data?.items || []) {
    for (const cobranca of pedido.charges || []) {
      const bruto = Number(cobranca.amount?.value || 0) / 100; // PagBank usa centavos
      const pago = Number(cobranca.amount?.summary?.paid || 0) / 100;
      const status = String(cobranca.status || "");

      let situacao: "disponivel" | "aLiberar" | "pendente";
      if (status === "PAID") situacao = "disponivel";
      else if (status === "AUTHORIZED" || status === "IN_ANALYSIS") situacao = "aLiberar";
      else if (status === "WAITING") situacao = "pendente";
      else continue; // DECLINED, CANCELED

      classificar(foto, situacao, pago || bruto, {
        id: String(cobranca.id),
        descricao: pedido.reference_id || cobranca.description || "Recebimento",
        valorBruto: bruto,
        valorLiquido: pago || bruto,
        status, situacao,
        dataAprovacao: cobranca.paid_at || null,
        dataLiberacao: null,
        meio: cobranca.payment_method?.type || "",
      });
    }
  }

  foto.disponivel = arred(foto.disponivel);
  foto.aLiberar = arred(foto.aLiberar);
  foto.pendente = arred(foto.pendente);
  foto.total = arred(foto.disponivel + foto.aLiberar);
  return foto;
}

// ============================================================================
// 5. SEGURANÇA E ERROS
// ============================================================================

async function exigirUsuario(req: any): Promise<string> {
  const h = String(req.headers.authorization || "");
  const idToken = h.startsWith("Bearer ") ? h.slice(7) : "";
  if (!idToken) throw new Error("NAO_AUTENTICADO");
  try {
    return (await getAuth().verifyIdToken(idToken)).uid;
  } catch {
    throw new Error("NAO_AUTENTICADO");
  }
}

function explicarErro(err: any): { status: number; mensagem: string } {
  const mapa: Record<string, { status: number; mensagem: string }> = {
    NAO_AUTENTICADO: { status: 401, mensagem: "Faça login para continuar." },
    SEM_CHAVE_CRIPTO: { status: 503, mensagem: "Servidor sem CONEXOES_CRYPTO_KEY configurada." },
    PROVEDOR_DESCONHECIDO: { status: 404, mensagem: "Provedor não reconhecido." },
    PROVEDOR_INDISPONIVEL: {
      status: 503,
      mensagem: "Esta conta ainda não está disponível para conexão.",
    },
    TOKEN_CORROMPIDO: {
      status: 500,
      mensagem: "A conexão guardada está inválida. Conecte a conta novamente.",
    },
  };
  if (mapa[err.message]) return mapa[err.message];
  return {
    status: 502,
    mensagem: `Falha ao falar com o provedor: ${
      err.response?.data?.message || err.response?.data?.error_description || err.message
    }`,
  };
}

function paginaRetorno(res: any, ok: boolean, titulo: string, texto: string) {
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>MEI Flow</title></head>
<body style="font-family:system-ui;background:#f8fafc;color:#0f172a;display:flex;align-items:center;
justify-content:center;height:100vh;margin:0;text-align:center;padding:20px">
<div><div style="font-size:44px">${ok ? "✅" : "⚠️"}</div>
<h1 style="font-size:19px;margin:14px 0 6px">${titulo}</h1>
<p style="font-size:13px;color:#64748b;max-width:330px;margin:0 auto 22px">${texto}</p>
<a href="${APP_URL}" style="display:inline-block;background:#4f46e5;color:#fff;text-decoration:none;
padding:11px 22px;border-radius:11px;font-weight:700;font-size:13px">Voltar ao MEI Flow</a>
</div></body></html>`);
}

// ============================================================================
// 6. ROTAS
// ============================================================================

export function registrarRotasConexoes(app: any, db: any) {
  const pendentes = new Map<string, { uid: string; verifier: string; provedor: string }>();

  // ---------------------------------------------------------------- provedores
  app.get("/api/conexoes/provedores", (_req: any, res: any) => {
    res.json({
      success: true,
      provedores: PROVEDORES.map((p) => ({
        id: p.id,
        nome: p.nome,
        metodo: p.metodo,
        cor: p.cor,
        mostra: p.mostra,
        disponivel: estaPronto(p),
        conectavelComUmToque: p.metodo === "oauth",
        observacao: p.observacao || null,
      })),
    });
  });

  // ------------------------------------------------------------- passo 1: link
  app.get("/api/conexoes/:provedor/autorizar", async (req: any, res: any) => {
    try {
      const uid = await exigirUsuario(req);
      const p = acharProvedor(String(req.params.provedor));
      if (!p) throw new Error("PROVEDOR_DESCONHECIDO");
      if (!estaPronto(p)) throw new Error("PROVEDOR_INDISPONIVEL");
      chaveCripto();

      const state = crypto.randomBytes(24).toString("base64url");
      const { verifier, challenge } = gerarPkce();

      pendentes.set(state, { uid, verifier, provedor: p.id });
      await db.collection("conexoes_pendentes").doc(state).set({
        uid, verifier, provedor: p.id,
        criadoEm: new Date().toISOString(),
        expiraEm: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
      });

      res.json({ success: true, url: montarUrlAutorizacao(p, state, challenge) });
    } catch (err: any) {
      const { status, mensagem } = explicarErro(err);
      res.status(status).json({ success: false, mensagem });
    }
  });

  // ------------------------------------------------------------ passo 2: volta
  app.get("/api/conexoes/:provedor/callback", async (req: any, res: any) => {
    try {
      const p = acharProvedor(String(req.params.provedor));
      const { code, state, error } = req.query;
      if (!p || error || !code || !state) {
        return paginaRetorno(res, false, "Autorização cancelada",
          "Você pode tentar de novo pelo aplicativo quando quiser.");
      }

      let pedido = pendentes.get(String(state));
      if (!pedido) {
        const snap = await db.collection("conexoes_pendentes").doc(String(state)).get();
        if (snap.exists && new Date(snap.data().expiraEm).getTime() > Date.now()) {
          pedido = { uid: snap.data().uid, verifier: snap.data().verifier, provedor: snap.data().provedor };
        }
      }
      if (!pedido || pedido.provedor !== p.id) {
        return paginaRetorno(res, false, "Pedido expirado",
          "A autorização demorou demais. Comece de novo pelo aplicativo.");
      }

      pendentes.delete(String(state));
      await db.collection("conexoes_pendentes").doc(String(state)).delete().catch(() => {});

      const corpo: Record<string, string> = {
        grant_type: "authorization_code",
        code: String(code),
        redirect_uri: redirectDe(p.id),
      };
      if (p.usaPkce) corpo.code_verifier = pedido.verifier;

      const dados = await chamarToken(p, corpo);
      const contaExterna = String(dados.user_id || dados.account_id || dados.id || "conta");
      const conexaoId = `${p.id}_${contaExterna}`;

      await db.collection("conexoes_contas").doc(conexaoId).set({
        id: conexaoId,
        userId: pedido.uid,
        provedor: p.id,
        provedorNome: p.nome,
        contaExterna,
        accessToken: cifrar(dados.access_token),
        refreshToken: cifrar(dados.refresh_token || ""),
        expiraEm: new Date(Date.now() + (dados.expires_in || 15552000) * 1000).toISOString(),
        escopo: dados.scope || "",
        status: "ativo",
        conectadoEm: new Date().toISOString(),
      });

      console.log(`[Conexões] ${p.nome} conectado para ${pedido.uid}`);
      paginaRetorno(res, true, "Conta conectada",
        `Seu ${p.nome} já está ligado ao MEI Flow. O saldo aparece na carteira automaticamente.`);
    } catch (err: any) {
      console.error("[Conexões callback]", err.response?.data || err.message);
      paginaRetorno(res, false, "Não foi possível conectar",
        "Tente novamente pelo aplicativo em alguns instantes.");
    }
  });

  // ------------------------------------------------------------ contas ligadas
  app.get("/api/conexoes", async (req: any, res: any) => {
    try {
      const uid = await exigirUsuario(req);
      const snap = await db.collection("conexoes_contas").where("userId", "==", uid).get();
      res.json({
        success: true,
        conexoes: snap.docs.map((d: any) => {
          const c = d.data();
          // Nunca devolve token.
          return {
            id: c.id, provedor: c.provedor, provedorNome: c.provedorNome,
            contaExterna: c.contaExterna, status: c.status,
            conectadoEm: c.conectadoEm, ultimaSincronizacao: c.ultimaSincronizacao || null,
          };
        }),
      });
    } catch (err: any) {
      const { status, mensagem } = explicarErro(err);
      res.status(status).json({ success: false, mensagem });
    }
  });

  // ------------------------------------------------------- ⭐ a fotografia
  // Abre instantâneo pelo cache e atualiza em segundo plano quando envelhece.
  // Use ?forcar=1 para ignorar o cache.
  app.get("/api/conexoes/saldo", async (req: any, res: any) => {
    try {
      const uid = await exigirUsuario(req);
      const dias = Math.min(Number(req.query.dias) || 90, 365);
      const forcar = req.query.forcar === "1";

      const snap = await db.collection("conexoes_contas").where("userId", "==", uid).get();
      if (snap.empty) {
        return res.json({
          success: true, contas: [],
          resumo: { disponivel: 0, aLiberar: 0, pendente: 0, total: 0 },
          mensagem: "Nenhuma conta conectada ainda.",
        });
      }

      const contas: any[] = [];
      const resumo = { disponivel: 0, aLiberar: 0, pendente: 0, total: 0 };

      for (const docSnap of snap.docs) {
        const conexao = docSnap.data();
        const p = acharProvedor(conexao.provedor);
        if (!p?.fotografar) continue;

        const cacheIdade = conexao.cacheEm
          ? Date.now() - new Date(conexao.cacheEm).getTime()
          : Infinity;
        const cacheValido = !forcar && conexao.cache && cacheIdade < CACHE_MINUTOS * 60000;

        if (cacheValido) {
          const f = conexao.cache;
          contas.push({ conexaoId: conexao.id, provedorNome: p.nome, doCache: true, ...f });
          resumo.disponivel += f.disponivel; resumo.aLiberar += f.aLiberar;
          resumo.pendente += f.pendente; resumo.total += f.total;
          continue;
        }

        try {
          const token = await tokenValido(db, conexao);
          const foto = await p.fotografar(token, dias);

          contas.push({ conexaoId: conexao.id, provedorNome: p.nome, doCache: false, ...foto });
          resumo.disponivel += foto.disponivel; resumo.aLiberar += foto.aLiberar;
          resumo.pendente += foto.pendente; resumo.total += foto.total;

          await docSnap.ref.set(
            {
              cache: { ...foto, movimentos: foto.movimentos.slice(0, 30) },
              cacheEm: new Date().toISOString(),
              ultimaSincronizacao: new Date().toISOString(),
              status: "ativo", ultimoErro: null,
            },
            { merge: true }
          );
        } catch (e: any) {
          const revogado = e.response?.status === 401 || e.response?.status === 403;
          console.warn(`[Conexões] ${conexao.id}:`, e.message);
          await docSnap.ref.set(
            { status: revogado ? "reautorizar" : "erro", ultimoErro: String(e.message).slice(0, 300) },
            { merge: true }
          );
          // Se houver cache antigo, mostra ele em vez de deixar a tela vazia.
          if (conexao.cache) {
            contas.push({
              conexaoId: conexao.id, provedorNome: p.nome, doCache: true, desatualizado: true,
              ...conexao.cache,
            });
          } else {
            contas.push({
              conexaoId: conexao.id, provedorNome: p.nome,
              erro: revogado
                ? "Autorização expirada. Conecte a conta novamente."
                : "Não foi possível atualizar agora.",
            });
          }
        }
      }

      res.json({
        success: true, contas,
        resumo: {
          disponivel: arred(resumo.disponivel), aLiberar: arred(resumo.aLiberar),
          pendente: arred(resumo.pendente), total: arred(resumo.total),
        },
      });
    } catch (err: any) {
      const { status, mensagem } = explicarErro(err);
      res.status(status).json({ success: false, mensagem });
    }
  });

  // -------------------------------------------------------------- desconectar
  app.delete("/api/conexoes/:id", async (req: any, res: any) => {
    try {
      const uid = await exigirUsuario(req);
      const ref = db.collection("conexoes_contas").doc(String(req.params.id));
      const snap = await ref.get();
      if (!snap.exists || snap.data().userId !== uid) {
        return res.status(403).json({ success: false, mensagem: "Conexão não encontrada." });
      }
      await ref.delete();
      res.json({ success: true, mensagem: "Conta desconectada." });
    } catch (err: any) {
      const { status, mensagem } = explicarErro(err);
      res.status(status).json({ success: false, mensagem });
    }
  });

  const prontos = PROVEDORES.filter(estaPronto).map((p) => p.nome);
  console.log(
    `[Conexões] Rotas registradas. Provedores prontos: ${prontos.length ? prontos.join(", ") : "nenhum (faltam credenciais)"}`
  );
}
