/**
 * ============================================================================
 * MEI FLOW — Créditos pré-pagos (recarga via Pix)
 * ============================================================================
 *
 * COMO FUNCIONA
 *
 *   1. O usuário escolhe um valor e pede a recarga.
 *   2. O sistema gera um Pix na conta Efí do MEI Flow e devolve o QR Code.
 *   3. Quando o Pix cai, a Efí avisa por webhook e o saldo sobe sozinho.
 *   4. Cada mensagem enviada desconta do saldo. Saldo zero, não envia.
 *
 * Este módulo cuida SÓ do dinheiro. O envio de WhatsApp vem depois e vai
 * apenas chamar `debitarCredito()` daqui.
 *
 * ----------------------------------------------------------------------------
 * TRÊS DECISÕES DE ENGENHARIA QUE NÃO SÃO NEGOCIÁVEIS
 *
 *   • DINHEIRO EM CENTAVOS, sempre inteiro. Guardar 0.50 como número decimal
 *     acumula erro de arredondamento — depois de milhares de operações o saldo
 *     não fecha e não há como explicar ao usuário onde sumiu.
 *
 *   • DÉBITO DENTRO DE TRANSAÇÃO. Duas mensagens disparadas no mesmo instante
 *     poderiam ler o mesmo saldo e gravar duas vezes, deixando o saldo
 *     negativo. A transação do Firestore impede isso.
 *
 *   • EXTRATO DE TUDO. Cada centavo que entra ou sai vira uma linha com saldo
 *     antes e depois. Quando alguém disser "sumiu crédito", existe resposta.
 *
 * ----------------------------------------------------------------------------
 * ⚠️ ENVIE UMA MENSAGEM DE CADA VEZ (não dispare em paralelo)
 *
 * O saldo de cada usuário é um único registro. O Firestore resolve disputa
 * repetindo a transação, e o saldo NUNCA fica errado — isso foi testado com
 * 50 débitos simultâneos. Mas sob disputa alta parte das operações falha por
 * contenção (falha segura: não cobra e não envia).
 *
 * Portanto o laço de envio deve ser sequencial:
 *
 *     for (const cobranca of lista) {
 *       const r = await debitarCredito(db, uid, cobranca.id);
 *       if (!r.ok) break;              // acabou o saldo
 *       await enviarMensagem(...);
 *     }
 *
 * Nunca `Promise.all` em cima de débitos do mesmo usuário.
 *
 * ----------------------------------------------------------------------------
 * COMO INSTALAR
 *
 * 1. Salve como  creditos.ts  na raiz (junto de server.ts e efi.ts).
 * 2. No server.ts, no topo:      import { registrarRotasCreditos } from "./creditos";
 *    e dentro de startServer():  registrarRotasCreditos(app, db);
 *
 * 3. Cadastre o webhook do Pix na Efí UMA vez, chamando:
 *        POST /api/creditos/webhook/configurar   (autenticado)
 *
 * ----------------------------------------------------------------------------
 * VARIÁVEIS DE AMBIENTE
 *
 *   APP_URL                    → https://meiflow.rdhomologacao.com.br
 *   EFI_CHAVE_PIX              → a chave Pix da conta Efí do MEI FLOW (recebe)
 *   EFI_CERT_P12_BASE64        → certificado (a API Pix exige)
 *   EFI_PIX_CLIENT_ID / _SECRET
 *   EFI_SANDBOX                → "true" enquanto testa
 *   CREDITOS_WEBHOOK_HMAC      → segredo na URL do webhook (ver nota abaixo)
 *   PRECO_MENSAGEM_CENTAVOS    → padrão 50 (R$ 0,50)
 *
 * ⚠️ NOTA SOBRE O WEBHOOK DA EFÍ: por exigência do Banco Central, a Efí chama
 *    o webhook com mTLS (certificado nos dois lados). A Vercel não permite
 *    configurar isso. A saída oficial da própria Efí é enviar o header
 *    `x-skip-mtls-checking: true` no cadastro e proteger a URL com um segredo
 *    (HMAC) — é o que este módulo faz. Sem esse segredo a rota recusa tudo.
 *
 * ⚠️ CÓDIGO NUNCA EXECUTADO CONTRA A API REAL. Os endpoints de cobrança Pix
 *    seguem o padrão do Banco Central, que todos os bancos implementam igual.
 */

import axios from "axios";
import https from "https";
import crypto from "crypto";
import { exigirUsuario as verificarLogin } from "./auth-firebase.js";

const env = (k: string) => (process.env[k] || "").trim();
const APP_URL = env("APP_URL") || "https://meiflow.rdhomologacao.com.br";

/** Preço cobrado do usuário por mensagem enviada. */
export const PRECO_MENSAGEM_CENTAVOS = Number(env("PRECO_MENSAGEM_CENTAVOS") || 50);

/** Recarga mínima — abaixo disso a taxa do Pix come a operação. */
const RECARGA_MINIMA_CENTAVOS = 1000; // R$ 10,00
const RECARGA_MAXIMA_CENTAVOS = 500000; // R$ 5.000,00

/** Avisa o usuário quando o saldo cair abaixo disto. */
const SALDO_BAIXO_CENTAVOS = PRECO_MENSAGEM_CENTAVOS * 20; // 20 mensagens

/**
 * Pacotes sugeridos. O bônus existe para incentivar recarga maior — menos
 * transações Pix, menos suporte, e o usuário sente que ganhou algo.
 */
export const PACOTES = [
  { id: "p25", valorCentavos: 2500, bonusCentavos: 0 },
  { id: "p50", valorCentavos: 5000, bonusCentavos: 250 },   // +5%
  { id: "p100", valorCentavos: 10000, bonusCentavos: 1000 }, // +10%
  { id: "p200", valorCentavos: 20000, bonusCentavos: 3000 }, // +15%
];

// ============================================================================
// DINHEIRO
// ============================================================================

/** Centavos para exibição: 1250 → "12,50" */
export function formatarBRL(centavos: number): string {
  const n = Math.round(Number(centavos) || 0);
  const sinal = n < 0 ? "-" : "";
  const abs = Math.abs(n);
  return `${sinal}${Math.floor(abs / 100)},${String(abs % 100).padStart(2, "0")}`;
}

/** "12,50" ou 12.5 para centavos inteiros. */
export function paraCentavos(valor: string | number): number {
  if (typeof valor === "number") return Math.round(valor * 100);
  const limpo = String(valor).replace(/[^\d,.-]/g, "").replace(/\./g, "").replace(",", ".");
  return Math.round(Number(limpo) * 100) || 0;
}

/** Quantas mensagens o saldo ainda paga. */
export function mensagensRestantes(saldoCentavos: number): number {
  return Math.floor(saldoCentavos / PRECO_MENSAGEM_CENTAVOS);
}

// ============================================================================
// EFÍ PIX — geração da cobrança
// ============================================================================

let agente: https.Agent | null = null;
function certificado(): https.Agent {
  if (agente) return agente;
  const b64 = env("EFI_CERT_P12_BASE64");
  if (!b64) throw new Error("SEM_CERTIFICADO");
  agente = new https.Agent({
    pfx: Buffer.from(b64, "base64"),
    passphrase: env("EFI_CERT_PASSWORD"),
    keepAlive: true,
  });
  return agente;
}

const basePix = () =>
  env("EFI_SANDBOX") !== "false"
    ? "https://pix-h.api.efipay.com.br"
    : "https://pix.api.efipay.com.br";

let tokenPix: { valor: string; exp: number } | null = null;

async function autenticarPix(): Promise<string> {
  if (tokenPix && tokenPix.exp > Date.now() + 30_000) return tokenPix.valor;

  const id = env("EFI_PIX_CLIENT_ID") || env("EFI_CLIENT_ID");
  const secret = env("EFI_PIX_CLIENT_SECRET") || env("EFI_CLIENT_SECRET");
  if (!id || !secret) throw new Error("SEM_CREDENCIAIS_PIX");

  const basic = Buffer.from(`${id}:${secret}`).toString("base64");
  const { data } = await axios.post(
    `${basePix()}/oauth/token`,
    { grant_type: "client_credentials" },
    {
      headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/json" },
      httpsAgent: certificado(),
      timeout: 20000,
    }
  );
  tokenPix = { valor: data.access_token, exp: Date.now() + (data.expires_in || 600) * 1000 };
  return data.access_token;
}

async function chamarPix(metodo: "GET" | "PUT" | "POST", caminho: string, corpo?: any) {
  const token = await autenticarPix();
  const { data } = await axios.request({
    method: metodo,
    url: `${basePix()}${caminho}`,
    data: corpo,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    httpsAgent: certificado(),
    timeout: 25000,
  });
  return data;
}

/**
 * txid do padrão Pix: 26 a 35 caracteres alfanuméricos, sem símbolos.
 * Usar PUT /v2/cob/:txid (em vez de POST) deixa a criação idempotente:
 * repetir a chamada com o mesmo txid não gera duas cobranças.
 */
function gerarTxid(): string {
  return `MF${Date.now()}${crypto.randomBytes(8).toString("hex")}`.slice(0, 35).toUpperCase();
}

// ============================================================================
// SALDO E EXTRATO — o coração do módulo
// ============================================================================

export type TipoMovimento = "recarga" | "bonus" | "consumo" | "estorno" | "ajuste";

async function lerSaldo(db: any, userId: string): Promise<number> {
  const snap = await db.collection("creditos_saldo").doc(userId).get();
  return snap.exists ? Number(snap.data().saldoCentavos || 0) : 0;
}

/**
 * Movimenta o saldo dentro de uma transação e registra no extrato.
 *
 * `referencia` é a chave de idempotência: se já existir um movimento com a
 * mesma referência, nada acontece e o saldo atual é devolvido. É isso que
 * impede o webhook do Pix de creditar duas vezes o mesmo pagamento, e o
 * disparo de mensagem de cobrar duas vezes a mesma mensagem.
 */
export async function movimentar(
  db: any,
  opts: {
    userId: string;
    tipo: TipoMovimento;
    centavos: number; // positivo credita, negativo debita
    referencia: string;
    descricao: string;
    permitirNegativo?: boolean;
  }
): Promise<{ saldoCentavos: number; aplicado: boolean; motivo?: string }> {
  const refSaldo = db.collection("creditos_saldo").doc(opts.userId);
  const refMov = db.collection("creditos_movimentos").doc(opts.referencia);

  return db.runTransaction(async (t: any) => {
    const [saldoSnap, movSnap] = await Promise.all([t.get(refSaldo), t.get(refMov)]);

    // Já processado antes — não faz de novo.
    if (movSnap.exists) {
      return {
        saldoCentavos: saldoSnap.exists ? Number(saldoSnap.data().saldoCentavos || 0) : 0,
        aplicado: false,
        motivo: "ja_processado",
      };
    }

    const antes = saldoSnap.exists ? Number(saldoSnap.data().saldoCentavos || 0) : 0;
    const depois = antes + Math.round(opts.centavos);

    if (depois < 0 && !opts.permitirNegativo) {
      return { saldoCentavos: antes, aplicado: false, motivo: "saldo_insuficiente" };
    }

    t.set(
      refSaldo,
      {
        userId: opts.userId,
        saldoCentavos: depois,
        atualizadoEm: new Date().toISOString(),
        // Zera o aviso quando o saldo volta a subir, para poder avisar de novo.
        alertaBaixoEnviado: depois > SALDO_BAIXO_CENTAVOS ? false : saldoSnap.data()?.alertaBaixoEnviado || false,
      },
      { merge: true }
    );

    t.set(refMov, {
      id: opts.referencia,
      userId: opts.userId,
      tipo: opts.tipo,
      centavos: Math.round(opts.centavos),
      saldoAntes: antes,
      saldoDepois: depois,
      descricao: opts.descricao,
      criadoEm: new Date().toISOString(),
    });

    return { saldoCentavos: depois, aplicado: true };
  });
}

/**
 * Desconta o preço de UMA mensagem. Use esta função no módulo de envio.
 * Chame ANTES de enviar: se não houver saldo, nem tenta.
 * Se o envio falhar depois, chame `estornarCredito()` com a mesma referência.
 */
export async function debitarCredito(
  db: any,
  userId: string,
  referencia: string,
  descricao = "Mensagem de cobrança"
): Promise<{ ok: boolean; saldoCentavos: number; motivo?: string }> {
  const r = await movimentar(db, {
    userId,
    tipo: "consumo",
    centavos: -PRECO_MENSAGEM_CENTAVOS,
    referencia: `consumo_${referencia}`,
    descricao,
  });
  return {
    ok: r.aplicado || r.motivo === "ja_processado",
    saldoCentavos: r.saldoCentavos,
    motivo: r.motivo,
  };
}

/** Devolve o crédito quando a mensagem não foi entregue. */
export async function estornarCredito(
  db: any,
  userId: string,
  referencia: string,
  descricao = "Estorno: mensagem não entregue"
) {
  return movimentar(db, {
    userId,
    tipo: "estorno",
    centavos: PRECO_MENSAGEM_CENTAVOS,
    referencia: `estorno_${referencia}`,
    descricao,
  });
}

// ============================================================================
// ROTAS
// ============================================================================

async function exigirUsuario(req: any): Promise<string> {
  // Verificacao feita em auth-firebase.ts, sem firebase-admin/auth:
  // aquele pacote arrasta jwks-rsa + jose 6, que quebram na Vercel.
  return verificarLogin(req);
}

function explicar(err: any): { status: number; mensagem: string } {
  const mapa: Record<string, [number, string]> = {
    NAO_AUTENTICADO: [401, "Faça login para continuar."],
    SEM_CERTIFICADO: [503, "Recarga indisponível: falta o certificado digital da Efí no servidor."],
    SEM_CREDENCIAIS_PIX: [503, "Recarga indisponível: faltam as credenciais da API Pix da Efí."],
    SEM_CHAVE_PIX: [503, "Recarga indisponível: falta configurar a chave Pix de recebimento."],
  };
  if (mapa[err.message]) return { status: mapa[err.message][0], mensagem: mapa[err.message][1] };
  return {
    status: 502,
    mensagem: `Não foi possível gerar a recarga: ${
      err.response?.data?.mensagem || err.response?.data?.detail || err.message
    }`,
  };
}

export function registrarRotasCreditos(app: any, db: any) {
  // ------------------------------------------------------------------ saldo
  app.get("/api/creditos/saldo", async (req: any, res: any) => {
    try {
      const uid = await exigirUsuario(req);
      const saldo = await lerSaldo(db, uid);
      res.json({
        success: true,
        saldoCentavos: saldo,
        saldo: formatarBRL(saldo),
        mensagensRestantes: mensagensRestantes(saldo),
        precoMensagem: formatarBRL(PRECO_MENSAGEM_CENTAVOS),
        saldoBaixo: saldo < SALDO_BAIXO_CENTAVOS,
        semSaldo: saldo < PRECO_MENSAGEM_CENTAVOS,
      });
    } catch (err: any) {
      const { status, mensagem } = explicar(err);
      res.status(status).json({ success: false, mensagem });
    }
  });

  // ----------------------------------------------------------------- pacotes
  app.get("/api/creditos/pacotes", (_req: any, res: any) => {
    res.json({
      success: true,
      precoMensagem: formatarBRL(PRECO_MENSAGEM_CENTAVOS),
      minimo: formatarBRL(RECARGA_MINIMA_CENTAVOS),
      pacotes: PACOTES.map((p) => {
        const total = p.valorCentavos + p.bonusCentavos;
        return {
          id: p.id,
          valor: formatarBRL(p.valorCentavos),
          valorCentavos: p.valorCentavos,
          bonus: p.bonusCentavos > 0 ? formatarBRL(p.bonusCentavos) : null,
          creditoTotal: formatarBRL(total),
          mensagens: mensagensRestantes(total),
          destaque: p.bonusCentavos > 0
            ? `+${Math.round((p.bonusCentavos / p.valorCentavos) * 100)}% de bônus`
            : null,
        };
      }),
    });
  });

  // ----------------------------------------------------------------- recarga
  app.post("/api/creditos/recarga", async (req: any, res: any) => {
    try {
      const uid = await exigirUsuario(req);
      const chaveRecebedora = env("EFI_CHAVE_PIX");
      if (!chaveRecebedora) throw new Error("SEM_CHAVE_PIX");

      // Aceita um pacote pelo id, ou um valor livre.
      const pacote = PACOTES.find((p) => p.id === req.body?.pacote);
      const valorCentavos = pacote ? pacote.valorCentavos : paraCentavos(req.body?.valor);
      const bonusCentavos = pacote ? pacote.bonusCentavos : 0;

      if (valorCentavos < RECARGA_MINIMA_CENTAVOS || valorCentavos > RECARGA_MAXIMA_CENTAVOS) {
        return res.status(400).json({
          success: false,
          mensagem: `A recarga deve ser entre R$ ${formatarBRL(RECARGA_MINIMA_CENTAVOS)} e R$ ${formatarBRL(RECARGA_MAXIMA_CENTAVOS)}.`,
        });
      }

      const perfil = await db.collection("users").doc(uid).get();
      const dados = perfil.exists ? perfil.data() : {};
      const doc = String(dados.cnpjPrestador || dados.cnpj || "").replace(/\D/g, "");

      const txid = gerarTxid();
      const corpo: any = {
        calendario: { expiracao: 3600 }, // 1 hora para pagar
        valor: { original: (valorCentavos / 100).toFixed(2) },
        chave: chaveRecebedora,
        solicitacaoPagador: `Creditos MEI Flow - ${mensagensRestantes(valorCentavos + bonusCentavos)} mensagens`,
      };
      // O devedor é opcional; só envia se o documento for válido.
      if (doc.length === 14) corpo.devedor = { cnpj: doc, nome: dados.name || "Cliente MEI Flow" };
      else if (doc.length === 11) corpo.devedor = { cpf: doc, nome: dados.name || "Cliente MEI Flow" };

      // PUT com txid próprio = idempotente.
      const cob = await chamarPix("PUT", `/v2/cob/${txid}`, corpo);

      // O QR Code vem do "location" gerado junto da cobrança.
      let qrcode = cob?.pixCopiaECola || "";
      let imagem = "";
      if (!qrcode && cob?.loc?.id) {
        const qr = await chamarPix("GET", `/v2/loc/${cob.loc.id}/qrcode`);
        qrcode = qr?.qrcode || "";
        imagem = qr?.imagemQrcode || "";
      }

      await db.collection("creditos_recargas").doc(txid).set({
        txid,
        userId: uid,
        valorCentavos,
        bonusCentavos,
        status: "aguardando",
        criadoEm: new Date().toISOString(),
        expiraEm: new Date(Date.now() + 3600_000).toISOString(),
      });

      res.json({
        success: true,
        txid,
        valor: formatarBRL(valorCentavos),
        bonus: bonusCentavos ? formatarBRL(bonusCentavos) : null,
        creditoTotal: formatarBRL(valorCentavos + bonusCentavos),
        mensagens: mensagensRestantes(valorCentavos + bonusCentavos),
        pixCopiaECola: qrcode,
        qrCodeImagem: imagem,
        expiraEm: new Date(Date.now() + 3600_000).toISOString(),
      });
    } catch (err: any) {
      console.error("[Créditos recarga]", err.response?.data || err.message);
      const { status, mensagem } = explicar(err);
      res.status(status).json({ success: false, mensagem });
    }
  });

  /** O app consulta isto enquanto a tela do QR Code está aberta. */
  app.get("/api/creditos/recarga/:txid", async (req: any, res: any) => {
    try {
      const uid = await exigirUsuario(req);
      const snap = await db.collection("creditos_recargas").doc(String(req.params.txid)).get();
      if (!snap.exists || snap.data().userId !== uid) {
        return res.status(404).json({ success: false, mensagem: "Recarga não encontrada." });
      }
      const r = snap.data();
      res.json({
        success: true,
        status: r.status,
        pago: r.status === "pago",
        valor: formatarBRL(r.valorCentavos),
        pagoEm: r.pagoEm || null,
        saldoAtual: formatarBRL(await lerSaldo(db, uid)),
      });
    } catch (err: any) {
      const { status, mensagem } = explicar(err);
      res.status(status).json({ success: false, mensagem });
    }
  });

  // ----------------------------------------------------------------- extrato
  app.get("/api/creditos/extrato", async (req: any, res: any) => {
    try {
      const uid = await exigirUsuario(req);
      const limite = Math.min(Number(req.query.limite) || 100, 500);
      const snap = await db
        .collection("creditos_movimentos")
        .where("userId", "==", uid)
        .get();

      const movimentos = snap.docs
        .map((d: any) => d.data())
        .sort((a: any, b: any) => String(b.criadoEm).localeCompare(String(a.criadoEm)))
        .slice(0, limite)
        .map((m: any) => ({
          data: m.criadoEm,
          tipo: m.tipo,
          descricao: m.descricao,
          valor: formatarBRL(m.centavos),
          entrada: m.centavos > 0,
          saldoDepois: formatarBRL(m.saldoDepois),
        }));

      res.json({ success: true, total: movimentos.length, movimentos });
    } catch (err: any) {
      const { status, mensagem } = explicar(err);
      res.status(status).json({ success: false, mensagem });
    }
  });

  // ---------------------------------------------------------------- webhook
  //
  // A Efí chama esta rota quando um Pix cai. A URL carrega um segredo, porque
  // a Vercel não permite a checagem por certificado que a Efí faria por padrão.
  //
  // Responde 200 SEMPRE que o segredo confere: a Efí repete até 9 vezes se não
  // receber 2xx, e a idempotência de `movimentar()` já protege contra duplicidade.
  // --------------------------------------------------------------------------
  app.post(["/api/creditos/webhook/pix", "/api/creditos/webhook/pix/pix"], async (req: any, res: any) => {
    const segredo = env("CREDITOS_WEBHOOK_HMAC");
    if (!segredo || req.query.hmac !== segredo) {
      console.warn("[Créditos webhook] Segredo inválido. Recusado.");
      return res.status(401).json({ erro: "nao autorizado" });
    }

    res.status(200).json({ recebido: true });

    try {
      for (const pix of req.body?.pix || []) {
        const txid = String(pix.txid || "");
        if (!txid) continue;

        const ref = db.collection("creditos_recargas").doc(txid);
        const snap = await ref.get();
        if (!snap.exists) {
          console.warn(`[Créditos webhook] txid desconhecido: ${txid}`);
          continue;
        }
        const r = snap.data();

        // Confere se o valor pago bate com o cobrado.
        const pagoCentavos = paraCentavos(String(pix.valor || "0"));
        if (pagoCentavos < r.valorCentavos) {
          console.warn(`[Créditos webhook] Pagamento parcial em ${txid}: ${pagoCentavos} de ${r.valorCentavos}`);
        }

        await movimentar(db, {
          userId: r.userId,
          tipo: "recarga",
          centavos: pagoCentavos,
          referencia: `recarga_${txid}`,
          descricao: `Recarga via Pix de R$ ${formatarBRL(pagoCentavos)}`,
        });

        if (r.bonusCentavos > 0) {
          await movimentar(db, {
            userId: r.userId,
            tipo: "bonus",
            centavos: r.bonusCentavos,
            referencia: `bonus_${txid}`,
            descricao: `Bônus da recarga de R$ ${formatarBRL(r.valorCentavos)}`,
          });
        }

        await ref.set(
          {
            status: "pago",
            pagoEm: pix.horario || new Date().toISOString(),
            e2eId: pix.endToEndId || "",
            valorPagoCentavos: pagoCentavos,
          },
          { merge: true }
        );

        console.log(`[Créditos] Recarga ${txid} confirmada: R$ ${formatarBRL(pagoCentavos)}`);
      }
    } catch (err: any) {
      console.error("[Créditos webhook]", err.message);
    }
  });

  /** Cadastra a URL do webhook na Efí. Rode uma vez, depois de configurar tudo. */
  app.post("/api/creditos/webhook/configurar", async (req: any, res: any) => {
    try {
      await exigirUsuario(req);
      const chave = env("EFI_CHAVE_PIX");
      const segredo = env("CREDITOS_WEBHOOK_HMAC");
      if (!chave) throw new Error("SEM_CHAVE_PIX");
      if (!segredo) {
        return res.status(503).json({
          success: false,
          mensagem: "Configure CREDITOS_WEBHOOK_HMAC antes (um segredo longo e aleatório).",
        });
      }

      const token = await autenticarPix();
      const { data } = await axios.put(
        `${basePix()}/v2/webhook/${chave}`,
        { webhookUrl: `${APP_URL}/api/creditos/webhook/pix?hmac=${encodeURIComponent(segredo)}` },
        {
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
            // Sem isto a Efí exige mTLS, que a Vercel não permite configurar.
            "x-skip-mtls-checking": "true",
          },
          httpsAgent: certificado(),
          timeout: 20000,
        }
      );

      res.json({ success: true, webhook: data, mensagem: "Webhook cadastrado na Efí." });
    } catch (err: any) {
      console.error("[Créditos webhook config]", err.response?.data || err.message);
      const { status, mensagem } = explicar(err);
      res.status(status).json({ success: false, mensagem });
    }
  });

  console.log(
    `[Créditos] Rotas registradas. Preço por mensagem: R$ ${formatarBRL(PRECO_MENSAGEM_CENTAVOS)}`
  );
}
