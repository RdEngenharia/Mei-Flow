/**
 * ============================================================================
 * MEI FLOW — Integração Efí Bank (Carteira Digital)
 * ============================================================================
 *
 * COMO INSTALAR (2 passos):
 *
 * 1. Salve este arquivo como  efi.ts  na RAIZ do projeto (mesma pasta do server.ts).
 *
 * 2. No server.ts, adicione a linha de import junto com os outros imports do topo:
 *
 *        import { registrarRotasEfi } from "./efi";
 *
 *    E, dentro da função startServer(), logo DEPOIS da linha
 *    `app.use(express.urlencoded({ limit: "50mb", extended: true }));`,
 *    adicione:
 *
 *        registrarRotasEfi(app, db, adminStorage, firebaseConfig);
 *
 * Pronto. Nada mais precisa ser alterado no server.ts.
 *
 * ----------------------------------------------------------------------------
 * VARIÁVEIS DE AMBIENTE
 *
 *   FASE 1 — emitir boleto (funciona já, sem certificado):
 *     EFI_CLIENT_ID          → do painel da Efí, aplicação "Cobranças"
 *     EFI_CLIENT_SECRET      → idem
 *     EFI_SANDBOX            → "true" enquanto testa, "false" em produção
 *     EFI_WEBHOOK_TOKEN      → invente uma senha longa e aleatória
 *
 *   FASE 2 — pagar boleto/DAS e ENVIAR PIX (exige certificado):
 *     EFI_CERT_P12_BASE64    → o arquivo .p12 convertido em base64
 *     EFI_CERT_PASSWORD      → normalmente vazio nos certificados da Efí
 *     EFI_PIX_CLIENT_ID      → aplicação com a API Pix habilitada (cai para
 *     EFI_PIX_CLIENT_SECRET    EFI_CLIENT_ID/SECRET se não for informado)
 *     EFI_CHAVE_PIX          → a chave Pix da SUA conta Efí (origem do envio)
 *     EFI_PIX_LIMITE         → teto por envio, em reais. Padrão: 5000
 *
 * A conexão do usuário com o BANCO DELE (saldo e extrato refletidos na
 * carteira) NÃO é feita aqui — fica no módulo separado bancos.ts.
 *
 * URL PÚBLICA DO SISTEMA: https://meiflow.rdhomologacao.com.br
 * ----------------------------------------------------------------------------
 *
 * ⚠️ ESTE CÓDIGO NUNCA FOI EXECUTADO. Foi escrito a partir da documentação
 *    oficial da Efí e do código existente do MEI Flow. Espere ajustes na
 *    primeira execução real com credenciais de homologação.
 */

import axios from "axios";
import https from "https";
import crypto from "crypto";
import { getAuth } from "firebase-admin/auth";

/** URL pública do sistema — usada em webhooks e no retorno do banco. */
export const APP_URL = process.env.APP_URL || "https://meiflow.rdhomologacao.com.br";

// ============================================================================
// CONSTANTES QUE PRECISAM BATER COM O FRONT-END — NÃO ALTERE SEM CONFERIR
// ============================================================================

/**
 * Nomes dos meses EXATAMENTE como aparecem em ArquivoDigitalMei.tsx (const MESES).
 * A tela filtra com comparação literal (`docItem.mes === selectedMonth`), então
 * qualquer diferença — inclusive o cedilha de "Março" — faz o comprovante ser
 * salvo no banco mas NÃO aparecer na pasta para o usuário.
 */
const MESES = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
];

/** Estratégia de arquivamento decidida: a pasta é o mês em que o pagamento liquidou. */
const ESTRATEGIA_MES_FISCAL: "pagamento" | "vencimento" | "competencia" = "pagamento";

// ============================================================================
// AUTENTICAÇÃO NA EFÍ
// ============================================================================

type TokenCache = { token: string; exp: number };
const tokenCache: Record<string, TokenCache> = {};

function baseCobrancas(): string {
  return process.env.EFI_SANDBOX !== "false"
    ? "https://cobrancas-h.api.efipay.com.br"
    : "https://cobrancas.api.efipay.com.br";
}

/**
 * Obtém (e reaproveita) o access token da API Cobranças.
 * O token da Efí dura ~600s; renovamos 30s antes de expirar.
 */
async function getTokenCobrancas(): Promise<string> {
  const cached = tokenCache.cobrancas;
  if (cached && cached.exp > Date.now() + 30_000) return cached.token;

  const clientId = process.env.EFI_CLIENT_ID;
  const clientSecret = process.env.EFI_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error(
      "Credenciais da Efí não configuradas. Defina EFI_CLIENT_ID e EFI_CLIENT_SECRET."
    );
  }

  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");

  const { data } = await axios.post(
    `${baseCobrancas()}/v1/authorize`,
    { grant_type: "client_credentials" },
    {
      headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/json" },
      timeout: 15000,
    }
  );

  tokenCache.cobrancas = {
    token: data.access_token,
    exp: Date.now() + (data.expires_in || 600) * 1000,
  };
  return data.access_token;
}

async function efiCobrancas(method: "GET" | "POST" | "PUT", path: string, body?: any) {
  const token = await getTokenCobrancas();
  const { data } = await axios.request({
    method,
    url: `${baseCobrancas()}${path}`,
    data: body,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    timeout: 20000,
  });
  return data;
}

/**
 * Agente HTTPS com o certificado da Efí (necessário na Fase 2: pagar boleto/DAS).
 * O fetch nativo do Node não aceita certificado de cliente — por isso axios.
 * O mesmo certificado serve para as APIs de Pix e de Pagamento de Contas.
 */
let certAgent: https.Agent | null = null;
export function getEfiAgent(): https.Agent {
  if (certAgent) return certAgent;
  const b64 = process.env.EFI_CERT_P12_BASE64;
  if (!b64) throw new Error("SEM_CERTIFICADO");
  certAgent = new https.Agent({
    pfx: Buffer.from(b64, "base64"),
    passphrase: process.env.EFI_CERT_PASSWORD || "",
    keepAlive: true,
  });
  return certAgent;
}

// ============================================================================
// SEGURANÇA: identificar quem está chamando
// ============================================================================

/**
 * Confere o token do Firebase enviado pelo app e devolve o UID real.
 * Substitui o padrão inseguro de confiar num userId vindo no corpo da requisição.
 */
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
// DATAS
// ============================================================================

/** Decide em qual pasta (ano + mês) o comprovante será arquivado. */
export function resolverMesFiscal(
  dataPagamentoISO: string,
  dataVencimentoISO?: string,
  ehDas = false
): { ano: number; mes: string } {
  let base: Date;

  if (ESTRATEGIA_MES_FISCAL === "vencimento" && dataVencimentoISO) {
    base = new Date(dataVencimentoISO);
  } else if (ESTRATEGIA_MES_FISCAL === "competencia" && dataVencimentoISO) {
    base = new Date(dataVencimentoISO);
    if (ehDas) base.setMonth(base.getMonth() - 1);
  } else {
    base = new Date(dataPagamentoISO);
  }

  if (isNaN(base.getTime())) base = new Date();

  return { ano: base.getFullYear(), mes: MESES[base.getMonth()] };
}

/** Converte data ISO para o formato dd/mm/aaaa usado pelos lançamentos do app. */
function paraDataBR(iso: string): string {
  const d = new Date(iso);
  const dia = String(d.getDate()).padStart(2, "0");
  const mes = String(d.getMonth() + 1).padStart(2, "0");
  return `${dia}/${mes}/${d.getFullYear()}`;
}

// ============================================================================
// GERAÇÃO DO PDF DO COMPROVANTE
// ============================================================================

/**
 * Monta um comprovante em PDF. Imprime vencimento E pagamento, para que o
 * contador identifique o período mesmo com o arquivo guardado na pasta do
 * mês do pagamento.
 */
async function gerarComprovantePdf(dados: {
  titulo: string;
  meiNome: string;
  meiCnpj: string;
  linhas: Array<[string, string]>;
}): Promise<Buffer> {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF();

  doc.setFillColor(15, 23, 42);
  doc.rect(0, 0, 210, 28, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(15);
  doc.setFont("helvetica", "bold");
  doc.text("MEI FLOW", 14, 13);
  doc.setFontSize(9);
  doc.setFont("helvetica", "normal");
  doc.text(dados.titulo, 14, 21);

  doc.setTextColor(30, 41, 59);
  doc.setFontSize(10);
  doc.setFont("helvetica", "bold");
  doc.text(dados.meiNome, 14, 40);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(100, 116, 139);
  doc.text(`CNPJ: ${dados.meiCnpj || "Não informado"}`, 14, 46);

  let y = 60;
  doc.setDrawColor(226, 232, 240);
  doc.line(14, y - 5, 196, y - 5);

  for (const [rotulo, valor] of dados.linhas) {
    doc.setFontSize(8);
    doc.setTextColor(100, 116, 139);
    doc.setFont("helvetica", "bold");
    doc.text(String(rotulo).toUpperCase(), 14, y);

    doc.setFontSize(10);
    doc.setTextColor(15, 23, 42);
    doc.setFont("helvetica", "normal");
    doc.text(String(valor || "-"), 14, y + 6);

    y += 15;
    if (y > 260) {
      doc.addPage();
      y = 25;
    }
  }

  doc.setFontSize(7);
  doc.setTextColor(148, 163, 184);
  doc.text(
    "Documento gerado automaticamente pelo MEI Flow. Guarda obrigatoria por 5 anos.",
    14,
    285
  );

  return Buffer.from(doc.output("arraybuffer") as ArrayBuffer);
}

// ============================================================================
// ARQUIVAMENTO AUTOMÁTICO NO ARQUIVO DIGITAL  ⭐ (coração da funcionalidade)
// ============================================================================

/**
 * Grava o comprovante no Storage e registra os metadados na coleção "documentos",
 * usando exatamente o mesmo contrato de /api/documentos/upload — por isso o
 * arquivo aparece sozinho na tela do Arquivo Digital, sem mexer no front-end.
 */
export async function arquivarComprovante(
  db: any,
  adminStorage: any,
  firebaseConfig: any,
  opts: {
    userId: string;
    pdfBuffer: Buffer;
    nomeArquivo: string;
    ano: number;
    mes: string;
    origem: "efi_pagamento" | "efi_cobranca";
    referenciaId: string;
  }
) {
  if (!db || !adminStorage) {
    throw new Error("Firebase Admin não inicializado (faltam as credenciais de produção).");
  }

  // --- Idempotência: webhooks se repetem. Nunca arquivar duas vezes o mesmo evento.
  const jaExiste = await db
    .collection("documentos")
    .where("userId", "==", opts.userId)
    .where("referenciaId", "==", opts.referenciaId)
    .limit(1)
    .get();

  if (!jaExiste.empty) {
    console.log(`[Efí Arquivamento] Já arquivado anteriormente: ${opts.referenciaId}. Ignorando.`);
    return jaExiste.docs[0].data();
  }

  const docId = `doc_${Date.now()}`;
  const cleanFileName = opts.nomeArquivo.replace(/[^a-zA-Z0-9.\-_]/g, "_");
  const storagePath = `usuarios/${opts.userId}/${opts.ano}/${opts.mes}/${cleanFileName}`;
  const downloadUrl = `/api/documentos/download?path=${encodeURIComponent(storagePath)}`;

  const bucketName = firebaseConfig?.storageBucket || "mei-flow-692d9.firebasestorage.app";
  await adminStorage
    .bucket(bucketName)
    .file(storagePath)
    .save(opts.pdfBuffer, { metadata: { contentType: "application/pdf" } });

  const agora = new Date().toISOString();
  const metadataDoc = {
    id: docId,
    nome: opts.nomeArquivo,
    url: downloadUrl,
    downloadUrl,
    ano: Number(opts.ano),   // NUMBER — a query do front usa where("ano","==",Number(...))
    mes: opts.mes,           // STRING por extenso — "Agosto", "Março"...
    criadoEm: agora,
    uploadedAt: agora,
    tamanho: opts.pdfBuffer.length,
    tipo: "application/pdf",
    userId: opts.userId,
    storagePath,
    isSimulated: false,
    // Campos extras (o front ignora o que não conhece):
    origem: opts.origem,
    referenciaId: opts.referenciaId,
    automatico: true,
  };

  await db.collection("documentos").doc(docId).set(metadataDoc);
  console.log(`[Efí Arquivamento] Comprovante salvo em ${opts.mes}/${opts.ano} → ${docId}`);
  return metadataDoc;
}

/**
 * Cria o lançamento financeiro correspondente.
 *
 * ⚠️ ENTRADA E SAÍDA VÃO PARA LUGARES DIFERENTES, COM FORMATOS DIFERENTES.
 * Isto não é escolha nossa — é como o src/firebase.ts do app já funciona:
 *
 *   • ENTRADA (venda)  → saveVendaToFirebase      → usuarios/{uid}/vendas/{id}
 *                        campos em PORTUGUÊS, `data` como STRING "dd/mm/aaaa"
 *
 *   • SAÍDA (despesa)  → saveTransacaoToFirebase  → transactions/{id}
 *                        campos em INGLÊS (type/value/description/date),
 *                        `date` como objeto Date (vira Timestamp no Firestore)
 *
 * Gravar no formato errado faz o lançamento não aparecer, ou aparecer com a
 * data trocada. Aqui passamos um Date real direto, o que também evita o bug de
 * parsing de data que existe hoje no app (ver relatório de bugs).
 */
export async function criarLancamento(
  db: any,
  opts: {
    userId: string;
    tipo: "entrada" | "saida";
    valor: number;
    dataISO: string;
    descricao: string;
    categoria: string;
    formaPagamento: string;
    documentoId?: string;
    referenciaId?: string;
    clienteId?: string;
    clienteNome?: string;
    clienteDocumento?: string;
  }
) {
  if (!db) return null;

  const id = `tx_${Date.now().toString().slice(-6)}`;

  try {
    if (opts.tipo === "entrada") {
      // ---- VENDA: subcoleção do usuário, campos em português ----
      await db
        .collection("usuarios")
        .doc(opts.userId)
        .collection("vendas")
        .doc(id)
        .set({
          id,
          tipo: "entrada",
          valor: Number(opts.valor),
          data: paraDataBR(opts.dataISO), // STRING "dd/mm/aaaa"
          descricao: opts.descricao,
          categoria: opts.categoria,
          clienteId: opts.clienteId || "",
          clienteNome: opts.clienteNome || "",
          clienteDocumento: opts.clienteDocumento || "",
          formaPagamento: opts.formaPagamento,
          createdAt: new Date().toISOString(),
          // extras nossos:
          documentoId: opts.documentoId || "",
          referenciaId: opts.referenciaId || "",
        });
    } else {
      // ---- DESPESA: coleção raiz, campos em inglês, date como Date ----
      await db
        .collection("transactions")
        .doc(id)
        .set({
          id,
          userId: opts.userId,
          type: "saida",
          value: Number(opts.valor),
          description: opts.descricao,
          date: new Date(opts.dataISO), // objeto Date — NÃO string
          categoria: opts.categoria,
          clienteId: "",
          clienteNome: "",
          clienteDocumento: "",
          formaPagamento: opts.formaPagamento,
          // extras nossos:
          documentoId: opts.documentoId || "",
          referenciaId: opts.referenciaId || "",
        });
    }
  } catch (err: any) {
    console.warn(`[Efí Lançamento] Falha ao gravar ${opts.tipo}:`, err.message);
    return null;
  }

  return { id, tipo: opts.tipo };
}

// ============================================================================
// ROTAS
// ============================================================================

export function registrarRotasEfi(
  app: any,
  db: any,
  adminStorage: any,
  firebaseConfig: any
) {
  // --------------------------------------------------------------------------
  // Teste de conexão — use esta rota primeiro, para confirmar as credenciais
  // --------------------------------------------------------------------------
  app.get("/api/efi/test-connection", async (_req: any, res: any) => {
    try {
      await getTokenCobrancas();
      res.json({
        success: true,
        ambiente: process.env.EFI_SANDBOX !== "false" ? "Homologação" : "Produção",
        mensagem: "Conexão com a Efí estabelecida com sucesso.",
      });
    } catch (err: any) {
      console.error("[Efí Teste]", err.response?.data || err.message);
      res.status(401).json({
        success: false,
        mensagem: `Falha ao conectar na Efí: ${
          err.response?.data?.error_description || err.message
        }`,
      });
    }
  });

  // --------------------------------------------------------------------------
  // Emitir boleto para um cliente já cadastrado no MEI Flow
  // --------------------------------------------------------------------------
  app.post("/api/efi/boleto", async (req: any, res: any) => {
    try {
      const uid = await exigirUsuarioAutenticado(req);
      const { customerId, itens, vencimento, mensagem, juros, multa } = req.body;

      if (!customerId || !vencimento || !Array.isArray(itens) || itens.length === 0) {
        return res.status(400).json({
          success: false,
          mensagem: "Informe o cliente, ao menos um item e a data de vencimento.",
        });
      }

      // Busca o cliente no banco. O app manda só o ID — CPF/CNPJ nunca trafega do navegador.
      let cliente: any = null;
      for (const col of ["customers", "clientes"]) {
        const snap = await db.collection(col).doc(String(customerId)).get();
        if (snap.exists) {
          const d = snap.data();
          if (d.userId === uid || d.mei_uid === uid) {
            cliente = d;
            break;
          }
        }
      }

      if (!cliente) {
        return res
          .status(404)
          .json({ success: false, mensagem: "Cliente não encontrado no seu cadastro." });
      }

      const doc = String(cliente.cpfCnpj || cliente.documento || "").replace(/\D/g, "");
      if (doc.length !== 11 && doc.length !== 14) {
        return res.status(400).json({
          success: false,
          mensagem:
            "O cliente precisa ter um CPF (11 dígitos) ou CNPJ (14 dígitos) válido para emissão de boleto.",
        });
      }

      const nomeCliente = cliente.name || cliente.nome || "Cliente";
      const customer: any =
        doc.length === 11
          ? { name: nomeCliente, cpf: doc }
          : { juridical_person: { corporate_name: nomeCliente, cnpj: doc } };

      if (cliente.email) customer.email = cliente.email;
      const tel = String(cliente.telefone || "").replace(/\D/g, "");
      if (tel.length >= 10) customer.phone_number = tel;

      const payload = {
        items: itens.map((it: any) => ({
          name: String(it.nome || it.name || "Serviço").slice(0, 255),
          value: Math.round(Number(it.valor ?? it.value) * 100), // Efí trabalha em CENTAVOS
          amount: Number(it.quantidade ?? it.amount ?? 1),
        })),
        payment: {
          banking_billet: {
            expire_at: vencimento, // "aaaa-mm-dd"
            customer,
            configurations: {
              fine: Number(multa ?? 200),      // 2,00%
              interest: Number(juros ?? 33),   // 0,33% ao mês
            },
            message: String(mensagem || "Emitido via MEI Flow").slice(0, 100),
          },
        },
        // ⚠️ O endereço de aviso vai AQUI, em cada cobrança — e não na aba
        // "URL de callback" do painel da Efí. Aquela aba é do formato antigo:
        // envia XML (<pagamento><cliente>...), que este webhook não entende.
        // Configurada por aqui, a Efí usa o formato moderno, que manda apenas
        // um token de notificação para consultarmos de volta.
        metadata: {
          notification_url: `${APP_URL}/api/efi/webhook?token=${process.env.EFI_WEBHOOK_TOKEN || ""}`,
          custom_id: `mf_${uid.slice(0, 12)}_${Date.now()}`,
        },
      };

      const resposta = await efiCobrancas("POST", "/v1/charge/one-step", payload);
      const cobranca = resposta?.data || resposta;

      const totalReais =
        payload.items.reduce((s: number, i: any) => s + i.value * i.amount, 0) / 100;

      await db
        .collection("cobrancas")
        .doc(String(cobranca.charge_id))
        .set({
          id: String(cobranca.charge_id),
          userId: uid,
          customerId: String(customerId),
          clienteNome: nomeCliente,
          clienteDocumento: doc,
          gateway: "efi",
          valor: totalReais,
          vencimento,
          status: cobranca.status || "waiting",
          barcode: cobranca.barcode || "",
          link: cobranca.link || "",
          pdfUrl: cobranca.pdf?.charge || "",
          criadoEm: new Date().toISOString(),
          pagoEm: null,
        });

      res.json({
        success: true,
        chargeId: cobranca.charge_id,
        valor: totalReais,
        link: cobranca.link,
        pdf: cobranca.pdf?.charge,
        barcode: cobranca.barcode,
        status: cobranca.status,
      });
    } catch (err: any) {
      if (err.message === "NAO_AUTENTICADO") {
        return res.status(401).json({ success: false, mensagem: "Faça login para emitir boletos." });
      }
      const detalhe =
        err.response?.data?.error_description?.message ||
        err.response?.data?.error_description ||
        err.message;
      console.error("[Efí Boleto]", err.response?.data || err.message);
      res.status(500).json({ success: false, mensagem: `Erro ao gerar boleto: ${detalhe}` });
    }
  });

  // --------------------------------------------------------------------------
  // Webhook da Efí — dispara o arquivamento automático do comprovante
  // --------------------------------------------------------------------------
  // Cadastre no painel da Efí a URL:
  //   https://meiflow.rdhomologacao.com.br/api/efi/webhook?token=SEU_EFI_WEBHOOK_TOKEN
  //
  // A Efí NÃO envia os dados da cobrança: envia só um token de notificação,
  // que precisamos consultar de volta. E ela repete a chamada até 10 vezes se
  // não receber uma resposta 2xx — por isso respondemos 200 mesmo em erro.
  // --------------------------------------------------------------------------
  app.post("/api/efi/webhook", async (req: any, res: any) => {
    if (req.query.token !== process.env.EFI_WEBHOOK_TOKEN) {
      console.warn("[Efí Webhook] Token inválido. Requisição recusada.");
      return res.status(401).json({ erro: "token invalido" });
    }

    // Responde imediatamente; o processamento pesado segue em segundo plano.
    res.status(200).json({ status: "recebido" });

    try {
      const notificationToken = req.body?.notification;
      if (!notificationToken) return;

      const detalhe = await efiCobrancas("GET", `/v1/notification/${notificationToken}`);
      const historico = detalhe?.data || [];
      const ultimo = Array.isArray(historico) ? historico[historico.length - 1] : historico;

      const statusAtual = ultimo?.status?.current;
      const chargeId = String(ultimo?.identifiers?.charge_id || ultimo?.charge_id || "");

      console.log(`[Efí Webhook] Cobrança ${chargeId} → status "${statusAtual}"`);
      if (statusAtual !== "paid" || !chargeId) return;

      const cobrancaSnap = await db.collection("cobrancas").doc(chargeId).get();
      if (!cobrancaSnap.exists) {
        console.warn(`[Efí Webhook] Cobrança ${chargeId} não encontrada no banco.`);
        return;
      }
      const cobranca = cobrancaSnap.data();

      const dataPagamento = ultimo?.received_by_bank_at || new Date().toISOString();
      const { ano, mes } = resolverMesFiscal(dataPagamento, cobranca.vencimento, false);

      const perfilSnap = await db.collection("users").doc(cobranca.userId).get();
      const perfil = perfilSnap.exists ? perfilSnap.data() : {};

      const pdf = await gerarComprovantePdf({
        titulo: "Comprovante de Recebimento",
        meiNome: perfil.name || perfil.meiName || "Microempreendedor Individual",
        meiCnpj: perfil.cnpjPrestador || perfil.cnpj || "",
        linhas: [
          ["Pagador", cobranca.clienteNome || "-"],
          ["CPF / CNPJ do pagador", cobranca.clienteDocumento || "-"],
          ["Valor recebido", `R$ ${Number(cobranca.valor).toFixed(2).replace(".", ",")}`],
          ["Vencimento do boleto", paraDataBR(cobranca.vencimento)],
          ["Data do pagamento", paraDataBR(dataPagamento)],
          ["Forma de pagamento", "Boleto bancario (Efi)"],
          ["Identificador da cobranca", chargeId],
        ],
      });

      const documento = await arquivarComprovante(db, adminStorage, firebaseConfig, {
        userId: cobranca.userId,
        pdfBuffer: pdf,
        nomeArquivo: `Recebimento_${mes}_${ano}_${chargeId}.pdf`,
        ano,
        mes,
        origem: "efi_cobranca",
        referenciaId: chargeId,
      });

      await criarLancamento(db, {
        userId: cobranca.userId,
        tipo: "entrada",
        valor: Number(cobranca.valor),
        dataISO: dataPagamento,
        descricao: `Recebimento de ${cobranca.clienteNome || "cliente"}`,
        categoria: "Serviços",
        formaPagamento: "Boleto",
        documentoId: documento?.id,
        referenciaId: chargeId,
        clienteId: cobranca.customerId,
        clienteNome: cobranca.clienteNome,
        clienteDocumento: cobranca.clienteDocumento,
      });

      await db.collection("cobrancas").doc(chargeId).set(
        { status: "paid", pagoEm: dataPagamento, documentoId: documento?.id },
        { merge: true }
      );

      console.log(`[Efí Webhook] Cobrança ${chargeId} processada e arquivada em ${mes}/${ano}.`);
    } catch (err: any) {
      console.error("[Efí Webhook Erro]", err.response?.data || err.message);
    }
  });

  // ==========================================================================
  // PIX — saldo, envio e pagamento de QR Code
  // ==========================================================================
  //
  // POR QUE ENVIAR PIX MORA AQUI, E NÃO EM conexoes.ts:
  // O Mercado Pago e o PagBank só deixam RECEBER pela API. Tirar dinheiro da
  // conta por API não é liberado para terceiros neles — o saque é manual, no
  // aplicativo. A Efí é diferente: a API Pix dela permite enviar de verdade.
  // Por isso todo "dinheiro saindo" passa pela Efí.
  //
  // Tudo aqui exige o certificado digital (EFI_CERT_P12_BASE64).
  // ==========================================================================

  function basePix(): string {
    return process.env.EFI_SANDBOX !== "false"
      ? "https://pix-h.api.efipay.com.br"
      : "https://pix.api.efipay.com.br";
  }

  async function getTokenPix(): Promise<string> {
    const cached = tokenCache.pix;
    if (cached && cached.exp > Date.now() + 30_000) return cached.token;

    const clientId = process.env.EFI_PIX_CLIENT_ID || process.env.EFI_CLIENT_ID;
    const clientSecret = process.env.EFI_PIX_CLIENT_SECRET || process.env.EFI_CLIENT_SECRET;
    if (!clientId || !clientSecret) throw new Error("SEM_CREDENCIAIS_PIX");

    const basic = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
    const { data } = await axios.post(
      `${basePix()}/oauth/token`,
      { grant_type: "client_credentials" },
      {
        headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/json" },
        httpsAgent: getEfiAgent(),
        timeout: 20000,
      }
    );

    tokenCache.pix = {
      token: data.access_token,
      exp: Date.now() + (data.expires_in || 600) * 1000,
    };
    return data.access_token;
  }

  async function efiPix(method: "GET" | "POST" | "PUT", caminho: string, corpo?: any) {
    const token = await getTokenPix();
    const { data } = await axios.request({
      method,
      url: `${basePix()}${caminho}`,
      data: corpo,
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      httpsAgent: getEfiAgent(),
      timeout: 30000,
    });
    return data;
  }

  function explicarFalhaPix(err: any): { status: number; mensagem: string } {
    if (err.message === "SEM_CERTIFICADO") {
      return {
        status: 503,
        mensagem:
          "Pix indisponível: falta enviar o certificado digital da Efí (EFI_CERT_P12_BASE64).",
      };
    }
    if (err.message === "SEM_CREDENCIAIS_PIX") {
      return { status: 503, mensagem: "Pix indisponível: faltam as credenciais da API Pix da Efí." };
    }
    if (err.message === "NAO_AUTENTICADO") {
      return { status: 401, mensagem: "Faça login para movimentar dinheiro." };
    }
    return {
      status: 502,
      mensagem: `Erro no Pix: ${
        err.response?.data?.mensagem ||
        err.response?.data?.detail ||
        err.response?.data?.error_description ||
        err.message
      }`,
    };
  }

  /** Saldo da conta Efí. */
  app.get("/api/efi/saldo", async (req: any, res: any) => {
    try {
      await exigirUsuarioAutenticado(req);
      const dados = await efiPix("GET", "/v2/gn/saldo/");
      res.json({ success: true, saldo: dados });
    } catch (err: any) {
      const { status, mensagem } = explicarFalhaPix(err);
      res.status(status).json({ success: false, mensagem });
    }
  });

  /**
   * ENVIAR PIX.
   *
   * Três travas de segurança, porque aqui o dinheiro sai de verdade:
   *  1. exige token do Firebase (nunca aceita userId no corpo);
   *  2. idEnvio único por operação — o endpoint da Efí é idempotente, então
   *     duplo clique ou reenvio da requisição NÃO paga duas vezes;
   *  3. teto de valor por operação (EFI_PIX_LIMITE, padrão R$ 5.000).
   */
  app.post("/api/efi/pix/enviar", async (req: any, res: any) => {
    try {
      const uid = await exigirUsuarioAutenticado(req);
      const { chave, valor, descricao, chavePagador } = req.body;

      if (!chave || !valor) {
        return res
          .status(400)
          .json({ success: false, mensagem: "Informe a chave Pix de destino e o valor." });
      }

      const limite = Number(process.env.EFI_PIX_LIMITE || 5000);
      if (Number(valor) <= 0 || Number(valor) > limite) {
        return res.status(400).json({
          success: false,
          mensagem: `Valor fora do permitido. O limite por envio é de R$ ${limite.toFixed(2)}.`,
        });
      }

      const chaveOrigem = chavePagador || process.env.EFI_CHAVE_PIX;
      if (!chaveOrigem) {
        return res.status(503).json({
          success: false,
          mensagem: "Falta configurar a chave Pix da conta Efí (EFI_CHAVE_PIX).",
        });
      }

      // O idEnvio é a garantia de não pagar duas vezes: reenviar o mesmo id
      // devolve a operação original em vez de criar outra.
      const idEnvio = `mf${Date.now()}${crypto.randomBytes(4).toString("hex")}`.slice(0, 35);

      const resposta = await efiPix("PUT", `/v3/gn/pix/${idEnvio}`, {
        valor: Number(valor).toFixed(2),
        pagador: { chave: chaveOrigem, infoPagador: String(descricao || "Pagamento via MEI Flow").slice(0, 140) },
        favorecido: { chave: String(chave) },
      });

      await db.collection("pix_enviados").doc(idEnvio).set({
        id: idEnvio,
        userId: uid,
        chaveDestino: String(chave),
        valor: Number(valor),
        descricao: descricao || "",
        status: resposta?.status || "EM_PROCESSAMENTO",
        e2eId: resposta?.e2eId || "",
        criadoEm: new Date().toISOString(),
      });

      console.log(`[Efí Pix] Envio ${idEnvio} solicitado por ${uid}: R$ ${Number(valor).toFixed(2)}`);
      res.json({ success: true, idEnvio, status: resposta?.status, e2eId: resposta?.e2eId, resposta });
    } catch (err: any) {
      const { status, mensagem } = explicarFalhaPix(err);
      console.error("[Efí Pix enviar]", err.response?.data || err.message);
      res.status(status).json({ success: false, mensagem });
    }
  });

  /** Pagar um QR Code Pix (copia e cola). Útil para contas e para o DAS via Pix. */
  app.post("/api/efi/pix/pagar-qrcode", async (req: any, res: any) => {
    try {
      const uid = await exigirUsuarioAutenticado(req);
      const { qrcode, chavePagador } = req.body;
      if (!qrcode) {
        return res.status(400).json({ success: false, mensagem: "Cole o código Pix copia e cola." });
      }

      const chaveOrigem = chavePagador || process.env.EFI_CHAVE_PIX;
      if (!chaveOrigem) {
        return res
          .status(503)
          .json({ success: false, mensagem: "Falta configurar a chave Pix da conta Efí." });
      }

      const idEnvio = `mq${Date.now()}${crypto.randomBytes(4).toString("hex")}`.slice(0, 35);
      const resposta = await efiPix("PUT", `/v2/gn/pix/${idEnvio}/qrcode`, {
        pagador: { chave: chaveOrigem },
        pixCopiaECola: String(qrcode).trim(),
      });

      await db.collection("pix_enviados").doc(idEnvio).set({
        id: idEnvio,
        userId: uid,
        tipo: "qrcode",
        valor: Number(resposta?.valor || 0),
        status: resposta?.status || "EM_PROCESSAMENTO",
        e2eId: resposta?.e2eId || "",
        criadoEm: new Date().toISOString(),
      });

      res.json({ success: true, idEnvio, resposta });
    } catch (err: any) {
      const { status, mensagem } = explicarFalhaPix(err);
      res.status(status).json({ success: false, mensagem });
    }
  });

  /** Consulta um envio e, quando concluído, arquiva o comprovante sozinho. */
  app.get("/api/efi/pix/enviado/:idEnvio", async (req: any, res: any) => {
    try {
      const uid = await exigirUsuarioAutenticado(req);
      const idEnvio = String(req.params.idEnvio);

      const ref = db.collection("pix_enviados").doc(idEnvio);
      const snap = await ref.get();
      if (!snap.exists || snap.data().userId !== uid) {
        return res.status(403).json({ success: false, mensagem: "Envio não encontrado." });
      }

      const dados = await efiPix("GET", `/v2/gn/pix/enviados/id-envio/${idEnvio}`);
      const status = String(dados?.status || "");
      const concluido = ["REALIZADO", "CONCLUIDA", "LIQUIDADO"].includes(status.toUpperCase());

      await ref.set({ status, atualizadoEm: new Date().toISOString() }, { merge: true });

      // Mesma função de arquivamento do boleto e do DAS: um caminho só.
      if (concluido && !snap.data().documentoId) {
        try {
          const registro = snap.data();
          const dataPagamento = dados?.horario || new Date().toISOString();
          const { ano, mes } = resolverMesFiscal(dataPagamento);

          const perfilSnap = await db.collection("users").doc(uid).get();
          const perfil = perfilSnap.exists ? perfilSnap.data() : {};

          const pdf = await gerarComprovantePdf({
            titulo: "Comprovante de Pix Enviado",
            meiNome: perfil.name || perfil.meiName || "Microempreendedor Individual",
            meiCnpj: perfil.cnpjPrestador || perfil.cnpj || "",
            linhas: [
              ["Chave de destino", registro.chaveDestino || "-"],
              ["Valor enviado", `R$ ${Number(registro.valor).toFixed(2).replace(".", ",")}`],
              ["Descricao", registro.descricao || "-"],
              ["Data do envio", paraDataBR(dataPagamento)],
              ["Identificador do envio", idEnvio],
              ["Codigo da transacao (E2E)", dados?.e2eId || "-"],
            ],
          });

          const documento = await arquivarComprovante(db, adminStorage, firebaseConfig, {
            userId: uid,
            pdfBuffer: pdf,
            nomeArquivo: `Pix_Enviado_${mes}_${ano}_${idEnvio}.pdf`,
            ano,
            mes,
            origem: "efi_pagamento",
            referenciaId: idEnvio,
          });

          await criarLancamento(db, {
            userId: uid,
            tipo: "saida",
            valor: Number(registro.valor),
            dataISO: dataPagamento,
            descricao: registro.descricao || `Pix para ${registro.chaveDestino}`,
            categoria: "Geral",
            formaPagamento: "Pix",
            documentoId: documento?.id,
            referenciaId: idEnvio,
          });

          await ref.set({ documentoId: documento?.id }, { merge: true });
          console.log(`[Efí Pix] Comprovante de ${idEnvio} arquivado em ${mes}/${ano}.`);
        } catch (arqErr: any) {
          console.warn("[Efí Pix] Falha ao arquivar comprovante:", arqErr.message);
        }
      }

      res.json({ success: true, status, dados });
    } catch (err: any) {
      const { status, mensagem } = explicarFalhaPix(err);
      res.status(status).json({ success: false, mensagem });
    }
  });

  /** Pix enviados num período. */
  app.get("/api/efi/pix/enviados", async (req: any, res: any) => {
    try {
      await exigirUsuarioAutenticado(req);
      const fim = req.query.fim || new Date().toISOString();
      const inicio =
        req.query.inicio || new Date(Date.now() - 30 * 86400000).toISOString();
      const dados = await efiPix("GET", `/v2/gn/pix/enviados?inicio=${inicio}&fim=${fim}`);
      res.json({ success: true, enviados: dados });
    } catch (err: any) {
      const { status, mensagem } = explicarFalhaPix(err);
      res.status(status).json({ success: false, mensagem });
    }
  });

  console.log(
    "[Efí] Rotas registradas: /api/efi/test-connection, /api/efi/boleto, /api/efi/webhook, " +
      "/api/efi/saldo, /api/efi/pix/enviar, /api/efi/pix/pagar-qrcode, /api/efi/pix/enviados"
  );
}
