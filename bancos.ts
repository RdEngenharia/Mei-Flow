/**
 * ============================================================================
 * MEI FLOW — Conexão da conta bancária do usuário (OAuth 2.0)
 * ============================================================================
 *
 * O QUE ESTE MÓDULO FAZ
 *
 * Permite que o MEI conecte o banco DELE ao MEI Flow e veja saldo e extrato
 * dentro da carteira digital — sem precisar abrir conta na Efí e sem precisar
 * colar nenhuma chave de API.
 *
 * O usuário escolhe o banco numa lista, é levado para o ambiente do próprio
 * banco, se autentica lá e autoriza o compartilhamento. A senha do banco
 * NUNCA passa pelo MEI Flow.
 *
 * ----------------------------------------------------------------------------
 * COMO INSTALAR
 *
 * 1. Salve como  bancos.ts  na raiz do projeto (junto do server.ts e do efi.ts).
 * 2. No server.ts, adicione no topo:
 *
 *        import { registrarRotasBancos } from "./bancos";
 *
 *    e dentro de startServer(), junto com a linha do Efí:
 *
 *        registrarRotasBancos(app, db);
 *
 * ----------------------------------------------------------------------------
 * FUNCIONA HOJE, MESMO SEM CONTRATO
 *
 * A rota GET /api/bancos já devolve a lista de bancos compatíveis usando o
 * catálogo local abaixo. Ou seja, a TELA "escolha o seu banco" pode ser
 * construída e publicada agora. A conexão de verdade só liga quando as
 * credenciais do agregador forem preenchidas — até lá, a rota de conexão
 * responde com uma mensagem explicando o que falta, sem quebrar o app.
 *
 * ----------------------------------------------------------------------------
 * VARIÁVEIS DE AMBIENTE (só quando for ativar de verdade)
 *
 *   AGREGADOR_PROVEDOR   → "pluggy" (padrão) — deixado configurável de
 *                          propósito, para trocar de fornecedor sem reescrever
 *                          o app inteiro.
 *   PLUGGY_CLIENT_ID
 *   PLUGGY_CLIENT_SECRET
 *
 * ⚠️ CÓDIGO NUNCA EXECUTADO — escrito a partir da documentação oficial.
 */

import axios from "axios";
import { getAuth } from "firebase-admin/auth";

// ============================================================================
// 1. CATÁLOGO DE BANCOS COMPATÍVEIS
// ============================================================================
//
// Esta lista existe para a tela funcionar desde já e para o app nunca ficar
// mudo caso o agregador esteja fora do ar. Quando as credenciais estiverem
// configuradas, a lista real (400+ instituições, sempre atualizada) passa a
// vir da API e esta vira apenas o plano B.
//
// Todos os listados participam do Open Finance Brasil, que é o mecanismo que
// torna a conexão possível. Os grandes são obrigados por regulação; os
// menores aderiram voluntariamente.
// ============================================================================

export type BancoCompativel = {
  id: string;
  nome: string;
  tipo: "banco" | "fintech" | "cooperativa" | "pagamento";
  /** true = entre as maiores instituições, participação obrigatória */
  obrigatorio: boolean;
};

export const CATALOGO_BANCOS: BancoCompativel[] = [
  { id: "bb",            nome: "Banco do Brasil",      tipo: "banco",       obrigatorio: true },
  { id: "bradesco",      nome: "Bradesco",             tipo: "banco",       obrigatorio: true },
  { id: "caixa",         nome: "Caixa Econômica",      tipo: "banco",       obrigatorio: true },
  { id: "itau",          nome: "Itaú Unibanco",        tipo: "banco",       obrigatorio: true },
  { id: "santander",     nome: "Santander",            tipo: "banco",       obrigatorio: true },
  { id: "nubank",        nome: "Nubank",               tipo: "fintech",     obrigatorio: true },
  { id: "inter",         nome: "Banco Inter",          tipo: "banco",       obrigatorio: true },
  { id: "c6",            nome: "C6 Bank",              tipo: "banco",       obrigatorio: true },
  { id: "btg",           nome: "BTG Pactual",          tipo: "banco",       obrigatorio: true },
  { id: "safra",         nome: "Banco Safra",          tipo: "banco",       obrigatorio: true },
  { id: "sicoob",        nome: "Sicoob",               tipo: "cooperativa", obrigatorio: true },
  { id: "sicredi",       nome: "Sicredi",              tipo: "cooperativa", obrigatorio: true },
  { id: "banrisul",      nome: "Banrisul",             tipo: "banco",       obrigatorio: true },
  { id: "original",      nome: "Banco Original",       tipo: "banco",       obrigatorio: false },
  { id: "neon",          nome: "Neon",                 tipo: "fintech",     obrigatorio: false },
  { id: "will",          nome: "Will Bank",            tipo: "fintech",     obrigatorio: false },
  { id: "pagbank",       nome: "PagBank",              tipo: "pagamento",   obrigatorio: false },
  { id: "mercadopago",   nome: "Mercado Pago",         tipo: "pagamento",   obrigatorio: false },
  { id: "stone",         nome: "Stone",                tipo: "pagamento",   obrigatorio: false },
  { id: "cora",          nome: "Cora",                 tipo: "fintech",     obrigatorio: false },
  { id: "asaas",         nome: "Asaas",                tipo: "pagamento",   obrigatorio: false },
  { id: "efi",           nome: "Efí Bank",             tipo: "fintech",     obrigatorio: false },
  { id: "xp",            nome: "XP Investimentos",     tipo: "banco",       obrigatorio: false },
  { id: "brb",           nome: "BRB",                  tipo: "banco",       obrigatorio: false },
  { id: "daycoval",      nome: "Banco Daycoval",       tipo: "banco",       obrigatorio: false },
  { id: "bmg",           nome: "Banco BMG",            tipo: "banco",       obrigatorio: false },
];

// ============================================================================
// 2. ADAPTADOR DO AGREGADOR
// ============================================================================
//
// Toda conversa com o fornecedor passa por aqui. Trocar de fornecedor no
// futuro significa escrever outro adaptador, sem mexer nas rotas nem no app.
// ============================================================================

type Conexao = { token: string; exp: number };
let apiKeyCache: Conexao | null = null;

const PLUGGY_BASE = "https://api.pluggy.ai";

function credenciaisConfiguradas(): boolean {
  return Boolean(process.env.PLUGGY_CLIENT_ID && process.env.PLUGGY_CLIENT_SECRET);
}

/**
 * Autentica o MEI Flow no agregador. A chave vale 2 horas.
 * Isto acontece SEMPRE no servidor — nunca no navegador nem no APK.
 */
async function getApiKey(): Promise<string> {
  if (apiKeyCache && apiKeyCache.exp > Date.now() + 60_000) return apiKeyCache.token;
  if (!credenciaisConfiguradas()) throw new Error("SEM_CREDENCIAIS");

  const { data } = await axios.post(
    `${PLUGGY_BASE}/auth`,
    {
      clientId: process.env.PLUGGY_CLIENT_ID,
      clientSecret: process.env.PLUGGY_CLIENT_SECRET,
    },
    { headers: { "Content-Type": "application/json" }, timeout: 20000 }
  );

  apiKeyCache = { token: data.apiKey, exp: Date.now() + 2 * 60 * 60 * 1000 };
  return data.apiKey;
}

async function chamarAgregador(method: "GET" | "POST" | "DELETE", path: string, body?: any) {
  const apiKey = await getApiKey();
  const { data } = await axios.request({
    method,
    url: `${PLUGGY_BASE}${path}`,
    data: body,
    headers: { "X-API-KEY": apiKey, "Content-Type": "application/json" },
    timeout: 30000,
  });
  return data;
}

function explicarFalha(err: any): { status: number; mensagem: string } {
  if (err.message === "SEM_CREDENCIAIS") {
    return {
      status: 503,
      mensagem:
        "A conexão com bancos ainda não foi ativada. Falta contratar o agregador e preencher PLUGGY_CLIENT_ID e PLUGGY_CLIENT_SECRET.",
    };
  }
  if (err.message === "NAO_AUTENTICADO") {
    return { status: 401, mensagem: "Faça login para conectar seu banco." };
  }
  return {
    status: 502,
    mensagem: `Não foi possível falar com o serviço de conexão bancária: ${
      err.response?.data?.message || err.message
    }`,
  };
}

async function exigirUsuarioAutenticado(req: any): Promise<string> {
  const header = String(req.headers.authorization || "");
  const idToken = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!idToken) throw new Error("NAO_AUTENTICADO");
  try {
    const decoded = await getAuth().verifyIdToken(idToken);
    return decoded.uid;
  } catch {
    throw new Error("NAO_AUTENTICADO");
  }
}

// ============================================================================
// 3. ROTAS
// ============================================================================

export function registrarRotasBancos(app: any, db: any) {
  let catalogoCache: { lista: any[]; exp: number } | null = null;

  // --------------------------------------------------------------------------
  // Lista os bancos que o usuário pode conectar.
  // Funciona SEM credenciais (usa o catálogo local), e melhora sozinha quando
  // o agregador for ativado.
  // --------------------------------------------------------------------------
  app.get("/api/bancos", async (req: any, res: any) => {
    const busca = String(req.query.nome || "").trim().toLowerCase();

    const responderComCatalogoLocal = (aviso?: string) => {
      const lista = CATALOGO_BANCOS
        .filter((b) => (busca ? b.nome.toLowerCase().includes(busca) : true))
        .map((b) => ({ ...b, logo: null, conectavel: true }));
      res.json({
        success: true,
        fonte: "catalogo_local",
        total: lista.length,
        bancos: lista,
        ...(aviso ? { aviso } : {}),
      });
    };

    try {
      if (!credenciaisConfiguradas()) {
        return responderComCatalogoLocal(
          "Lista de referência. A conexão real será ativada quando o agregador for contratado."
        );
      }

      if (catalogoCache && catalogoCache.exp > Date.now() && !busca) {
        return res.json({
          success: true,
          fonte: "agregador",
          total: catalogoCache.lista.length,
          bancos: catalogoCache.lista,
          cache: true,
        });
      }

      // PERSONAL_BANK + BUSINESS_BANK: conta pessoa física e pessoa jurídica.
      const dados = await chamarAgregador(
        "GET",
        "/connectors?countries[]=BR&types[]=PERSONAL_BANK&types[]=BUSINESS_BANK&isOpenFinance=true"
      );

      const bancos = (dados?.results || dados || [])
        .map((c: any) => ({
          id: String(c.id),
          nome: c.name,
          logo: c.imageUrl || null,
          cor: c.primaryColor ? `#${String(c.primaryColor).replace("#", "")}` : null,
          tipo: c.type === "BUSINESS_BANK" ? "empresarial" : "pessoal",
          conectavel: true,
        }))
        .filter((b: any) => (busca ? String(b.nome).toLowerCase().includes(busca) : true))
        .sort((a: any, b: any) => String(a.nome).localeCompare(String(b.nome), "pt-BR"));

      if (!busca) catalogoCache = { lista: bancos, exp: Date.now() + 6 * 60 * 60 * 1000 };

      res.json({ success: true, fonte: "agregador", total: bancos.length, bancos });
    } catch (err: any) {
      // Nunca deixa a tela vazia: cai para o catálogo local.
      console.warn("[Bancos] Falha ao buscar no agregador:", err.message);
      responderComCatalogoLocal("Exibindo lista de referência (serviço temporariamente indisponível).");
    }
  });

  // --------------------------------------------------------------------------
  // Passo 1 da conexão: gera a autorização temporária que o app usa para abrir
  // a tela do banco. Vale 30 minutos e não dá acesso a mais nada.
  // --------------------------------------------------------------------------
  app.post("/api/bancos/conectar", async (req: any, res: any) => {
    try {
      const uid = await exigirUsuarioAutenticado(req);

      const dados = await chamarAgregador("POST", "/connect_token", {
        // Amarra a conexão ao usuário do MEI Flow.
        clientUserId: uid,
        options: {
          // Só o necessário para a carteira: identidade, conta e extrato.
          products: ["ACCOUNTS", "TRANSACTIONS", "IDENTITY"],
        },
      });

      res.json({ success: true, connectToken: dados.accessToken || dados.connectToken });
    } catch (err: any) {
      const { status, mensagem } = explicarFalha(err);
      res.status(status).json({ success: false, mensagem });
    }
  });

  // --------------------------------------------------------------------------
  // Passo 2: o app avisa qual conexão foi criada, e nós guardamos o vínculo.
  // Guardamos APENAS o identificador da conexão — nenhuma credencial do banco.
  // --------------------------------------------------------------------------
  app.post("/api/bancos/vincular", async (req: any, res: any) => {
    try {
      const uid = await exigirUsuarioAutenticado(req);
      const { itemId, bancoNome } = req.body;
      if (!itemId) {
        return res.status(400).json({ success: false, mensagem: "Identificador da conexão ausente." });
      }

      await db.collection("bancos_conectados").doc(String(itemId)).set({
        id: String(itemId),
        userId: uid,
        bancoNome: bancoNome || "",
        status: "ativo",
        conectadoEm: new Date().toISOString(),
        ultimaSincronizacao: null,
      });

      res.json({ success: true, mensagem: "Banco conectado com sucesso." });
    } catch (err: any) {
      const { status, mensagem } = explicarFalha(err);
      res.status(status).json({ success: false, mensagem });
    }
  });

  // --------------------------------------------------------------------------
  // Bancos que ESTE usuário já conectou.
  // --------------------------------------------------------------------------
  app.get("/api/bancos/conexoes", async (req: any, res: any) => {
    try {
      const uid = await exigirUsuarioAutenticado(req);
      const snap = await db.collection("bancos_conectados").where("userId", "==", uid).get();
      const conexoes = snap.docs.map((d: any) => d.data());
      res.json({ success: true, total: conexoes.length, conexoes });
    } catch (err: any) {
      const { status, mensagem } = explicarFalha(err);
      res.status(status).json({ success: false, mensagem });
    }
  });

  // --------------------------------------------------------------------------
  // O que a carteira mostra: saldo e extrato do banco do usuário.
  // --------------------------------------------------------------------------
  app.get("/api/bancos/saldo", async (req: any, res: any) => {
    try {
      const uid = await exigirUsuarioAutenticado(req);
      const snap = await db.collection("bancos_conectados").where("userId", "==", uid).get();

      if (snap.empty) {
        return res.json({ success: true, contas: [], saldoTotal: 0, mensagem: "Nenhum banco conectado ainda." });
      }

      const contas: any[] = [];
      for (const docSnap of snap.docs) {
        const itemId = docSnap.data().id;
        try {
          const dados = await chamarAgregador("GET", `/accounts?itemId=${itemId}`);
          for (const c of dados?.results || []) {
            contas.push({
              id: c.id,
              banco: c.owner || docSnap.data().bancoNome || "",
              tipo: c.type,
              numero: c.number,
              saldo: Number(c.balance || 0),
              moeda: c.currencyCode || "BRL",
            });
          }
        } catch (contaErr: any) {
          console.warn(`[Bancos] Falha ao ler contas de ${itemId}:`, contaErr.message);
        }
      }

      const saldoTotal = contas.reduce((s, c) => s + c.saldo, 0);
      res.json({ success: true, contas, saldoTotal });
    } catch (err: any) {
      const { status, mensagem } = explicarFalha(err);
      res.status(status).json({ success: false, mensagem });
    }
  });

  /** Extrato de uma conta conectada. */
  app.get("/api/bancos/extrato", async (req: any, res: any) => {
    try {
      await exigirUsuarioAutenticado(req);
      const { contaId, de, ate } = req.query;
      if (!contaId) {
        return res.status(400).json({ success: false, mensagem: "Informe a conta." });
      }
      let caminho = `/transactions?accountId=${encodeURIComponent(String(contaId))}`;
      if (de) caminho += `&from=${de}`;
      if (ate) caminho += `&to=${ate}`;

      const dados = await chamarAgregador("GET", caminho);
      const lancamentos = (dados?.results || []).map((t: any) => ({
        id: t.id,
        data: t.date,
        descricao: t.description,
        valor: Number(t.amount || 0),
        tipo: Number(t.amount || 0) >= 0 ? "entrada" : "saida",
        categoria: t.category || "",
      }));

      res.json({ success: true, total: lancamentos.length, lancamentos });
    } catch (err: any) {
      const { status, mensagem } = explicarFalha(err);
      res.status(status).json({ success: false, mensagem });
    }
  });

  /** Desconectar um banco: remove o vínculo aqui e revoga lá. */
  app.delete("/api/bancos/conexoes/:itemId", async (req: any, res: any) => {
    try {
      const uid = await exigirUsuarioAutenticado(req);
      const itemId = String(req.params.itemId);

      const docRef = db.collection("bancos_conectados").doc(itemId);
      const docSnap = await docRef.get();
      if (!docSnap.exists || docSnap.data().userId !== uid) {
        return res.status(403).json({ success: false, mensagem: "Conexão não encontrada." });
      }

      try {
        await chamarAgregador("DELETE", `/items/${itemId}`);
      } catch (revogarErr: any) {
        console.warn("[Bancos] Falha ao revogar no agregador:", revogarErr.message);
      }

      await docRef.delete();
      res.json({ success: true, mensagem: "Banco desconectado." });
    } catch (err: any) {
      const { status, mensagem } = explicarFalha(err);
      res.status(status).json({ success: false, mensagem });
    }
  });

  console.log(
    "[Bancos] Rotas registradas: /api/bancos, /api/bancos/conectar, /api/bancos/vincular, " +
      "/api/bancos/conexoes, /api/bancos/saldo, /api/bancos/extrato"
  );
}
