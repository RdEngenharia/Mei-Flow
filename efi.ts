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
import { exigirUsuario as verificarLogin } from "./auth-firebase.js";
import {
  lerCredenciaisBanco, registrarRotasBanco, tokenWebhookConfere,
} from "./bancoCofre.js";
import {
  emitirBoletoAsaas, consultarCobrancaAsaas, situacaoAsaas, cancelarCobrancaAsaas, emitirCartaoAsaas,
  solicitarAntecipacaoAsaas, desligarNotificacaoWhatsappAsaas,
} from "./bancoAsaas.js";
import { exigirPremium, responderSePlano } from "./plano.js";

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

/**
 * ⚠️ UMA GAVETA POR USUÁRIO — NÃO VOLTE A USAR UMA VARIÁVEL SÓ.
 *
 * Antes isto era `const tokenCache: Record<string, TokenCache>` com as chaves
 * fixas "cobrancas" e "pix". Com um único usuário, funciona. Com dois, o
 * segundo usa o token do primeiro — ou seja, emite boleto na conta do outro.
 * É o mesmo erro que já apareceu no cache do certificado digital e teve que
 * ser corrigido lá. A etiqueta da gaveta agora carrega o UID.
 */
const tokenCache = new Map<string, TokenCache>();

export function limparCacheTokenEfi(uid?: string) {
  if (!uid) return tokenCache.clear();
  for (const chave of Array.from(tokenCache.keys())) {
    if (chave.startsWith(`${uid}|`)) tokenCache.delete(chave);
  }
}

/**
 * Referência ao banco de dados para o módulo conseguir abrir o cofre.
 * É preenchida em registrarRotasEfi — as funções de token são de módulo e não
 * recebem `db` por parâmetro.
 */
let dbCofre: any = null;

// ============================================================================
// DE QUEM É A CONTA? — a decisão que faltava
// ============================================================================
//
// Cada usuário emite com as credenciais DELE, guardadas cifradas em
// bancoCofre.ts. As variáveis de ambiente (EFI_CLIENT_ID etc.) descrevem UMA
// conta só: a do dono do sistema. Usá-las para qualquer pessoa significa
// mandar o dinheiro do cliente dela para a conta de outro.
//
// Por isso a conta do ambiente virou EXCEÇÃO EXPLÍCITA, não padrão:
//
//   EFI_CONTA_COMPARTILHADA=true   liga a exceção;
//   EFI_CONTA_COMPARTILHADA_UIDS   (opcional) restringe a UIDs específicos,
//                                  separados por vírgula.
//
// Com a chave desligada, quem não cadastrou credencial não emite — e recebe
// uma mensagem dizendo o que fazer, em vez de emitir no lugar errado.

type ContaEfi = {
  clientId: string;
  clientSecret: string;
  ambiente: "homologacao" | "producao";
  origem: "usuario" | "sistema";
};

function contaCompartilhadaLiberada(uid: string): boolean {
  if ((process.env.EFI_CONTA_COMPARTILHADA || "").trim() !== "true") return false;
  const lista = (process.env.EFI_CONTA_COMPARTILHADA_UIDS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return lista.length === 0 ? true : lista.includes(uid);
}

/** Ambiente do sistema, para quando a conta usada for a compartilhada. */
function ambienteDoSistema(): "homologacao" | "producao" {
  return process.env.EFI_SANDBOX === "false" ? "producao" : "homologacao";
}

/**
 * Resolve a conta que vai emitir. Lança erro em vez de escolher a conta errada.
 *
 * @param tipo "cobrancas" (boleto/carnê) ou "pix" (dinheiro saindo).
 */
async function contaEfi(uid: string, tipo: "cobrancas" | "pix" = "cobrancas"): Promise<ContaEfi> {
  if (!uid) throw new Error("NAO_AUTENTICADO");

  const proprias = dbCofre ? await lerCredenciaisBanco(dbCofre, uid) : null;

  if (proprias) {
    // Esta função é só da Efí. Quem cadastrou outro banco chega aqui apenas
    // por engano de roteamento — e o erro precisa dizer isso, não "credencial
    // inválida", que mandaria a pessoa conferir o que está certo.
    if (proprias.provedor !== "efi") throw new Error("BANCO_SEM_EMISSAO");

    const seg = proprias.segredos || {};
    const clientId = (tipo === "pix" ? seg.pixClientId || seg.clientId : seg.clientId) || "";
    const clientSecret =
      (tipo === "pix" ? seg.pixClientSecret || seg.clientSecret : seg.clientSecret) || "";

    if (!clientId || !clientSecret) throw new Error("SEM_CREDENCIAIS_USUARIO");
    return { clientId, clientSecret, ambiente: proprias.ambiente, origem: "usuario" };
  }

  if (!contaCompartilhadaLiberada(uid)) throw new Error("SEM_CREDENCIAIS_USUARIO");

  const clientId =
    (tipo === "pix" ? process.env.EFI_PIX_CLIENT_ID : "") || process.env.EFI_CLIENT_ID || "";
  const clientSecret =
    (tipo === "pix" ? process.env.EFI_PIX_CLIENT_SECRET : "") ||
    process.env.EFI_CLIENT_SECRET ||
    "";
  if (!clientId || !clientSecret) throw new Error("SEM_CREDENCIAIS_USUARIO");

  return { clientId, clientSecret, ambiente: ambienteDoSistema(), origem: "sistema" };
}

/**
 * ⚠️ USO ÚNICO: o aviso de pagamento de boletos emitidos ANTES do cofre.
 *
 * Aqueles boletos foram criados quando só existia a conta do sistema, e o
 * endereço de retorno gravado neles não carrega o dono. Sem esta porta, o
 * pagamento de um boleto antigo deixaria de dar baixa — quebraria o que já
 * funciona. Ela NÃO serve para emitir nada: só consulta uma notificação.
 */
async function efiCobrancasContaDoSistema(
  method: "GET" | "POST" | "PUT",
  path: string,
  body?: any
) {
  const clientId = process.env.EFI_CLIENT_ID || "";
  const clientSecret = process.env.EFI_CLIENT_SECRET || "";
  if (!clientId || !clientSecret) throw new Error("SEM_CREDENCIAIS_USUARIO");

  const ambiente = ambienteDoSistema();
  const etiqueta = `__sistema__|cobrancas|${ambiente}`;
  let token = tokenCache.get(etiqueta)?.token || "";
  const valido = (tokenCache.get(etiqueta)?.exp || 0) > Date.now() + 30_000;

  if (!token || !valido) {
    const basic = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
    const { data } = await axios.post(
      `${baseCobrancas(ambiente)}/v1/authorize`,
      { grant_type: "client_credentials" },
      {
        headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/json" },
        timeout: 15000,
      }
    );
    token = data.access_token;
    tokenCache.set(etiqueta, {
      token,
      exp: Date.now() + (data.expires_in || 600) * 1000,
    });
  }

  const { data } = await axios.request({
    method,
    url: `${baseCobrancas(ambiente)}${path}`,
    data: body,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    timeout: 20000,
  });
  return data;
}

/**
 * Traduz a falha para uma frase que diz o que fazer.
 *
 * "Credenciais não configuradas" não ajuda ninguém: a pessoa não sabe se o
 * problema é dela, do sistema, ou do banco. Aqui cada caso vira uma instrução.
 */
export function explicarFalhaConta(err: any): { status: number; mensagem: string } {
  switch (err?.message) {
    case "NAO_AUTENTICADO":
      return { status: 401, mensagem: "Faça login para emitir cobranças." };
    case "SEM_CREDENCIAIS_USUARIO":
      return {
        status: 428,
        mensagem:
          "Antes de emitir, cadastre as credenciais do seu banco em Configurações → Banco. " +
          "Sem elas o boleto não pode ser registrado na sua conta.",
      };
    case "BANCO_SEM_EMISSAO":
      return {
        status: 428,
        mensagem:
          "O banco cadastrado ainda não emite boleto pelo sistema — as credenciais estão guardadas, " +
          "mas a emissão por ele depende de uma integração que ainda não está pronta.",
      };
    case "SEM_CHAVE_CRIPTO":
      return {
        status: 503,
        mensagem:
          "O servidor está sem a chave de segurança para abrir o cofre de credenciais.",
      };
    default:
      return {
        status: err?.response?.status === 401 ? 401 : 502,
        mensagem: `Falha ao falar com o banco: ${
          err?.response?.data?.error_description ||
          err?.response?.data?.mensagem ||
          err?.message ||
          "erro desconhecido"
        }`,
      };
  }
}

function baseCobrancas(ambiente: "homologacao" | "producao" = ambienteDoSistema()): string {
  return ambiente === "producao"
    ? "https://cobrancas.api.efipay.com.br"
    : "https://cobrancas-h.api.efipay.com.br";
}

/**
 * Obtém (e reaproveita) o access token da API Cobranças DO USUÁRIO.
 * O token da Efí dura ~600s; renovamos 30s antes de expirar.
 */
async function getTokenCobrancas(uid: string): Promise<{ token: string; conta: ContaEfi }> {
  const conta = await contaEfi(uid, "cobrancas");
  const etiqueta = `${uid}|cobrancas|${conta.ambiente}`;

  const cached = tokenCache.get(etiqueta);
  if (cached && cached.exp > Date.now() + 30_000) return { token: cached.token, conta };

  const basic = Buffer.from(`${conta.clientId}:${conta.clientSecret}`).toString("base64");

  const { data } = await axios.post(
    `${baseCobrancas(conta.ambiente)}/v1/authorize`,
    { grant_type: "client_credentials" },
    {
      headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/json" },
      timeout: 15000,
    }
  );

  tokenCache.set(etiqueta, {
    token: data.access_token,
    exp: Date.now() + (data.expires_in || 600) * 1000,
  });
  return { token: data.access_token, conta };
}

/**
 * ⚠️ O PRIMEIRO PARÂMETRO É O DONO DA COBRANÇA.
 *
 * Não existe chamada "sem dono": ou se sabe de quem é a conta, ou não se fala
 * com o banco. Se algum dia aparecer um `efiCobrancas("POST", ...)` sem UID, o
 * TypeScript reclama — e é exatamente esse o objetivo.
 */
async function efiCobrancas(
  uid: string,
  method: "GET" | "POST" | "PUT",
  path: string,
  body?: any
) {
  const { token, conta } = await getTokenCobrancas(uid);
  const { data } = await axios.request({
    method,
    url: `${baseCobrancas(conta.ambiente)}${path}`,
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
  // Verificacao feita em auth-firebase.ts, sem firebase-admin/auth:
  // aquele pacote arrasta jwks-rsa + jose 6, que quebram na Vercel.
  return verificarLogin(req);
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

  /**
   * ⚠️ O IDENTIFICADOR PRECISA SER DERIVADO DA ORIGEM, NÃO DO RELÓGIO.
   *
   * Era `tx_${Date.now()}`: cada execução gerava um id novo. Como o pagamento
   * pode ser reprocessado — e agora é, de propósito, quando algo falhou no meio
   * —, isso criaria uma entrada NOVA a cada tentativa. O faturamento passaria a
   * contar o mesmo recebimento duas, três vezes, e o MEI declararia a maior.
   *
   * Com o id derivado da referência, reprocessar SOBRESCREVE a mesma linha.
   * Duplicar deixa de ser possível, mesmo se algo chamar isto dez vezes.
   */
  const id = opts.referenciaId
    ? `tx_${String(opts.tipo).slice(0, 1)}_${String(opts.referenciaId).replace(/[^A-Za-z0-9_-]/g, "")}`
    : `tx_${Date.now().toString().slice(-6)}`;

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
  // O cofre precisa da mesma conexão de banco que as rotas de cobrança.
  dbCofre = db;

  // As rotas do cofre (/api/banco/...) moram no bancoCofre.ts e entram aqui
  // junto, para não haver um módulo registrado e o outro esquecido.
  registrarRotasBanco(app, db);

  // --------------------------------------------------------------------------
  // Teste de conexão — use esta rota primeiro, para confirmar as credenciais
  // --------------------------------------------------------------------------
  //
  // Agora exige login: o teste é das credenciais DAQUELE usuário. Antes ele
  // testava a conta do sistema e respondia "conexão estabelecida" para
  // qualquer visitante — o que dava a impressão errada de que a conta dele
  // estava configurada.
  app.get("/api/efi/test-connection", async (req: any, res: any) => {
    try {
      const uid = await exigirUsuarioAutenticado(req);
      const { conta } = await getTokenCobrancas(uid);
      res.json({
        success: true,
        ambiente: conta.ambiente === "producao" ? "Produção" : "Homologação",
        conta: conta.origem === "usuario" ? "sua conta" : "conta compartilhada do sistema",
        mensagem:
          conta.origem === "usuario"
            ? "Conexão estabelecida com a sua conta na Efí."
            : "Conexão estabelecida usando a conta compartilhada do sistema.",
      });
    } catch (err: any) {
      const { status, mensagem } = explicarFalhaConta(err);
      if (status >= 500) console.error("[Efí Teste]", err.response?.data || err.message);
      res.status(status).json({ success: false, mensagem });
    }
  });

  // --------------------------------------------------------------------------
  // Emitir boleto para um cliente já cadastrado no MEI Flow
  // --------------------------------------------------------------------------
  app.post("/api/efi/boleto", async (req: any, res: any) => {
    try {
      const uid = await exigirUsuarioAutenticado(req);
      // Antes de tocar no cofre de credenciais e de falar com o banco.
      await exigirPremium(db, uid, "boleto");
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

      // ======================================================================
      // DE QUEM É A CONTA, E QUAL BANCO?
      // ======================================================================
      //
      // Tudo acima é comum a qualquer banco: achar o cliente, conferir o
      // documento. Tudo abaixo é específico. A separação fica aqui de
      // propósito — banco novo entra como mais um ramo, sem mexer no que já
      // funciona.
      //
      // ⚠️ O nome da rota continua /api/efi/boleto por compatibilidade com o
      //    aplicativo publicado. Ela já não é só da Efí. Renomear exigiria
      //    atualizar o APK, e endereço de rota não vale uma quebra dessas.
      const contaDoUsuario = await lerCredenciaisBanco(db, uid);

      if (contaDoUsuario?.provedor === "asaas") {
        const totalAsaas = itens.reduce(
          (soma: number, it: any) =>
            soma + Number(it.valor ?? it.value ?? 0) * Number(it.quantidade ?? it.amount ?? 1),
          0
        );

        // A descrição é o único texto livre que chega ao pagador na folha do
        // boleto ("Instruções"). Montar a partir dos itens vale muito mais que
        // repetir o número do pedido — foi lição do boleto real do Vitri Pro.
        const descricaoAsaas =
          String(mensagem || "").trim() ||
          itens
            .map((it: any) => {
              const qtd = Number(it.quantidade ?? it.amount ?? 1);
              const nome = String(it.nome || it.name || "Serviço");
              return qtd > 1 ? `${qtd}x ${nome}` : nome;
            })
            .join(" · ")
            .slice(0, 500);

        const boleto = await emitirBoletoAsaas(
          contaDoUsuario.segredos || {},
          contaDoUsuario.ambiente,
          {
            valor: totalAsaas,
            vencimento,
            clienteNome: nomeCliente,
            clienteDocumento: doc,
            clienteEmail: cliente.email || "",
            clienteTelefone: cliente.telefone || "",
            descricao: descricaoAsaas,
            juros,
            multa,
          }
        );

        // O documento gravado tem O MESMO FORMATO do da Efí. É isso que faz a
        // agenda de cobranças, o Arquivo Digital e a emissão de nota ao pagar
        // continuarem funcionando sem saber qual banco emitiu.
        await db.collection("cobrancas").doc(String(boleto.id)).set({
          id: String(boleto.id),
          userId: uid,
          customerId: String(customerId),
          clienteNome: nomeCliente,
          clienteDocumento: doc,
          gateway: "asaas",
          valor: boleto.valor,
          vencimento: boleto.vencimento,
          status: boleto.status,
          barcode: boleto.linhaDigitavel,
          link: boleto.linkPdf,
          pdfUrl: boleto.linkPdf,
          // ⚠️ Sem isto, a nota fiscal emitida automaticamente ao pagar (ver
          // emitirNfseDaCobranca em nfse.ts) não sabia qual foi o serviço
          // prestado e caía no texto genérico "Prestacao de servicos" — mesmo
          // o boleto tendo saído com a descrição certa para o cliente.
          descricao: descricaoAsaas,
          criadoEm: new Date().toISOString(),
          pagoEm: null,
        });

        return res.json({
          success: true,
          chargeId: boleto.id,
          valor: boleto.valor,
          link: boleto.linkPdf,
          pdf: boleto.linkPdf,
          barcode: boleto.linhaDigitavel,
          status: boleto.status,
          // A Asaas ainda não avisa o pagamento sozinho aqui. A tela usa isto
          // para explicar por que a baixa depende do botão Sincronizar, em vez
          // de o usuário achar que o sistema esqueceu dele.
          avisoAutomatico: false,
        });
      }

      // ============================================ daqui para baixo, Efí
      const customer: any =
        doc.length === 11
          ? { name: nomeCliente, cpf: doc }
          : { juridical_person: { corporate_name: nomeCliente, cnpj: doc } };

      if (cliente.email) customer.email = cliente.email;
      const tel = String(cliente.telefone || "").replace(/\D/g, "");
      if (tel.length >= 10) customer.phone_number = tel;

      // ----------------------------------------------------------------------
      // ENDEREÇO — exigência do boleto registrado.
      //
      // Em homologação a Efí aceita sem, mas em PRODUÇÃO o boleto é registrado
      // no banco e a legislação exige o endereço do pagador. Sem ele a emissão
      // é recusada. Usa o que já está salvo no cliente; se vier um novo no
      // pedido, ele tem prioridade e fica gravado para as próximas vezes.
      // ----------------------------------------------------------------------
      const end = { ...(cliente.endereco || {}), ...(req.body.endereco || {}) };
      const cep = String(end.cep || end.zipcode || "").replace(/\D/g, "");
      const completo =
        cep.length === 8 && end.logradouro && end.numero && end.bairro && end.cidade && end.uf;

      if (completo) {
        customer.address = {
          street: String(end.logradouro).slice(0, 200),
          number: String(end.numero).slice(0, 10),
          neighborhood: String(end.bairro).slice(0, 100),
          zipcode: cep,
          city: String(end.cidade).slice(0, 100),
          state: String(end.uf).toUpperCase().slice(0, 2),
          ...(end.complemento ? { complement: String(end.complemento).slice(0, 100) } : {}),
        };

        // Guarda no cliente para não pedir de novo na próxima emissão.
        if (req.body.endereco) {
          const dados = { cep, logradouro: end.logradouro, numero: end.numero,
            bairro: end.bairro, cidade: end.cidade, uf: String(end.uf).toUpperCase(),
            complemento: end.complemento || "" };
          for (const col of ["customers", "clientes"]) {
            await db.collection(col).doc(String(customerId))
              .set({ endereco: dados }, { merge: true }).catch(() => {});
          }
        }
      } else if (process.env.EFI_SANDBOX === "false") {
        // Só bloqueia em produção — em homologação deixa testar sem endereço.
        return res.status(400).json({
          success: false,
          precisaEndereco: true,
          mensagem:
            "Para emitir boleto em produção o banco exige o endereço do cliente. Preencha CEP, rua, número, bairro, cidade e estado.",
        });
      }

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
          notification_url:
            // ⚠️ O `u=` NÃO É ENFEITE. Quando a Efí avisa que o boleto foi pago,
            // ela chama esta URL — e o servidor precisa saber de QUEM é a conta
            // para consultar a notificação com o token certo. Sem isso, a baixa
            // do pagamento tentaria ler a cobrança de um usuário usando a conta
            // de outro, e falharia (ou pior, leria a errada).
            `${APP_URL}/api/efi/webhook?token=${process.env.EFI_WEBHOOK_TOKEN || ""}&u=${encodeURIComponent(uid)}`,
          custom_id: `mf_${uid.slice(0, 12)}_${Date.now()}`,
        },
      };

      const resposta = await efiCobrancas(uid, "POST", "/v1/charge/one-step", payload);
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
          // Mesmo texto que foi mandado para a Efí em `payload.payment.banking_billet.message`
          // — é o que a nota fiscal automática (emitirNfseDaCobranca, em nfse.ts) usa como
          // descrição do serviço.
          descricao: String(mensagem || "Emitido via MEI Flow").slice(0, 100),
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
      // Recusa por causa do plano vem primeiro: a tela lê o 428 e abre a
      // assinatura, em vez de mostrar "erro ao gerar boleto".
      if (responderSePlano(res, err)) return;

      // Falta de conta cadastrada não é "erro do sistema": é uma etapa que o
      // usuário ainda não fez. Responde com a instrução, não com um 500.
      if (
        err.message === "NAO_AUTENTICADO" ||
        err.message === "SEM_CREDENCIAIS_USUARIO" ||
        err.message === "BANCO_SEM_EMISSAO" ||
        err.message === "SEM_CHAVE_CRIPTO"
      ) {
        const { status, mensagem } = explicarFalhaConta(err);
        return res.status(status).json({ success: false, mensagem });
      }
      console.error("[Efí Boleto]", err.response?.data || err.message);

      // 401 = a Efí recusou as credenciais. A causa quase sempre é a mesma:
      // o par de chaves não corresponde ao ambiente escolhido. As chaves de
      // homologação NÃO funcionam em produção, e vice-versa.
      if (err.response?.status === 401) {
        return res.status(401).json({
          success: false,
          mensagem:
            "A Efí recusou as credenciais cadastradas. Confira, em Configurações → Banco, " +
            "se o Client ID e o Client Secret são do mesmo ambiente escolhido " +
            "(as chaves de homologação não funcionam em produção, e vice-versa).",
        });
      }

      const detalhe =
        err.response?.data?.error_description?.message ||
        err.response?.data?.error_description ||
        err.response?.data?.errors?.[0]?.message ||
        err.message;
      res.status(500).json({ success: false, mensagem: `Erro ao gerar boleto: ${detalhe}` });
    }
  });

  // --------------------------------------------------------------------------
  // CARTÃO DE CRÉDITO PARCELADO — só para conta conectada via Asaas
  // --------------------------------------------------------------------------
  //
  // Só existe pelo checkout hospedado da Asaas: o cliente digita o cartão na
  // página dela, nunca aqui. Ver o comentário grande em `emitirCartaoAsaas`
  // (bancoAsaas.ts) para o porquê disso e o que ainda falta confirmar contra
  // uma cobrança real.
  //
  // ⚠️ A Efí não faz parte desta rota. Quem usa Efí recebe uma mensagem
  // dizendo para conectar a Asaas, em vez de um erro genérico do banco.
  // --------------------------------------------------------------------------
  app.post("/api/efi/cartao", async (req: any, res: any) => {
    try {
      const uid = await exigirUsuarioAutenticado(req);
      await exigirPremium(db, uid, "boleto");
      const { customerId, valor, vencimento, parcelas, mensagem, antecipar } = req.body;

      const valorNum = Number(valor);
      if (!customerId || !vencimento || !valorNum || valorNum <= 0) {
        return res.status(400).json({
          success: false,
          mensagem: "Informe o cliente, o valor e a data de vencimento.",
        });
      }

      const contaDoUsuario = await lerCredenciaisBanco(db, uid);
      if (contaDoUsuario?.provedor !== "asaas") {
        return res.status(428).json({
          success: false,
          mensagem:
            "Cartão de crédito parcelado está disponível só para conta conectada via Asaas. " +
            "Conecte a Asaas em Configurações → Banco para usar esta forma de cobrança.",
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
        return res.status(404).json({ success: false, mensagem: "Cliente não encontrado no seu cadastro." });
      }

      const doc = String(cliente.cpfCnpj || cliente.documento || "").replace(/\D/g, "");
      if (doc.length !== 11 && doc.length !== 14) {
        return res.status(400).json({
          success: false,
          mensagem: "O cliente precisa ter um CPF (11 dígitos) ou CNPJ (14 dígitos) válido para cobrar.",
        });
      }
      const nomeCliente = cliente.name || cliente.nome || "Cliente";

      const cobranca = await emitirCartaoAsaas(contaDoUsuario.segredos || {}, contaDoUsuario.ambiente, {
        valor: valorNum,
        vencimento,
        clienteNome: nomeCliente,
        clienteDocumento: doc,
        clienteEmail: cliente.email || "",
        clienteTelefone: cliente.telefone || "",
        descricao: mensagem,
        parcelas: Number(parcelas) || 1,
      });

      // --------------------------------------------------------------------
      // ANTECIPAÇÃO — "receber tudo de uma vez" em vez de esperar o prazo
      // padrão da Asaas (~32 dias — mês a mês, se for parcelado).
      //
      // ⚠️ VALE PARA À VISTA TAMBÉM, NÃO SÓ PARCELADO. Uma versão anterior
      // deste código dizia que à vista "já paga no prazo mais curto", como
      // se antecipação não fizesse sentido — isso estava errado: a própria
      // tela de Configurações → Preços e taxas da Asaas mostra "Recebimento
      // em 32 dias após o pagamento" para cartão de crédito em qualquer
      // parcelamento, incluindo à vista. Uma venda de R$100 à vista também
      // fica presa 32 dias até cair na conta, a menos que se peça
      // antecipação — com a taxa maior de sempre.
      //
      // É pedida DEPOIS de criar a cobrança, porque só agora existe o que
      // antecipar — a Asaas não aceita isso como campo junto na criação, é
      // uma chamada separada (ver bancoAsaas.ts).
      // --------------------------------------------------------------------
      let antecipacao: {
        solicitada: boolean;
        status?: string;
        valorLiquidoEstimado?: number;
        aviso?: string;
        erro?: string;
      } = { solicitada: false };

      if (antecipar) {
        // Parcelado: antecipa o PLANO inteiro, pelo id do parcelamento — mas
        // só se a Asaas devolveu esse id (ver aviso em `emitirCartaoAsaas`
        // sobre o campo `installment` não ter sido confirmado). À vista: não
        // existe plano, antecipa direto pelo id da própria cobrança — esse
        // caminho não depende de nenhum campo incerto.
        const alvo: { tipo: "installment" | "payment"; id: string } | null =
          cobranca.parcelas > 1
            ? cobranca.installmentId
              ? { tipo: "installment", id: cobranca.installmentId }
              : null
            : { tipo: "payment", id: String(cobranca.id) };

        if (!alvo) {
          antecipacao = {
            solicitada: false,
            aviso:
              "A cobrança foi gerada, mas não foi possível confirmar automaticamente o " +
              "identificador do parcelamento para pedir a antecipação. Peça a antecipação " +
              "direto no painel da Asaas para esta cobrança, ou avise se isso continuar acontecendo.",
          };
        } else {
          try {
            const resultado = await solicitarAntecipacaoAsaas(
              contaDoUsuario.segredos || {},
              contaDoUsuario.ambiente,
              alvo
            );
            antecipacao = {
              solicitada: true,
              status: resultado.status,
              valorLiquidoEstimado: resultado.valorLiquidoEstimado,
            };
          } catch (errAntecip: any) {
            // A cobrança em si já foi criada com sucesso — um erro ao pedir a
            // antecipação não pode derrubar a resposta toda, só avisar.
            antecipacao = {
              solicitada: false,
              erro:
                errAntecip?.message ||
                "Não foi possível pedir a antecipação agora. A cobrança foi gerada normalmente; " +
                  "tente antecipar de novo pelo painel da Asaas.",
            };
          }
        }
      }

      await db.collection("cobrancas").doc(String(cobranca.id)).set({
        id: String(cobranca.id),
        userId: uid,
        customerId: String(customerId),
        clienteNome: nomeCliente,
        clienteDocumento: doc,
        gateway: "asaas",
        formaPagamento: "cartao",
        parcelas: cobranca.parcelas,
        valor: cobranca.valor,
        vencimento: cobranca.vencimento,
        status: cobranca.status,
        barcode: "",
        link: cobranca.linkPagamento,
        pdfUrl: "",
        // Mesmo texto mandado para a Asaas como descrição da cobrança — é o
        // que a nota fiscal automática (emitirNfseDaCobranca, em nfse.ts) usa
        // como descrição do serviço quando o pagamento for confirmado.
        descricao: String(mensagem || "").trim() || "Emitido via MEI Flow",
        criadoEm: new Date().toISOString(),
        pagoEm: null,
        installmentId: cobranca.installmentId || null,
        recebimento: antecipar ? "antecipado" : "padrao",
        antecipacaoSolicitada: antecipacao.solicitada,
        ...(antecipacao.status ? { antecipacaoStatus: antecipacao.status } : {}),
        ...(antecipacao.valorLiquidoEstimado != null
          ? { antecipacaoValorLiquidoEstimado: antecipacao.valorLiquidoEstimado }
          : {}),
        ...(antecipacao.aviso ? { antecipacaoAviso: antecipacao.aviso } : {}),
        ...(antecipacao.erro ? { antecipacaoErro: antecipacao.erro } : {}),
      });

      res.json({
        success: true,
        chargeId: cobranca.id,
        valor: cobranca.valor,
        parcelas: cobranca.parcelas,
        link: cobranca.linkPagamento,
        status: cobranca.status,
        antecipacao,
      });
    } catch (err: any) {
      if (responderSePlano(res, err)) return;
      if (
        err.message === "NAO_AUTENTICADO" ||
        err.message === "SEM_CREDENCIAIS_USUARIO" ||
        err.message === "BANCO_SEM_EMISSAO" ||
        err.message === "SEM_CHAVE_CRIPTO"
      ) {
        const { status, mensagem } = explicarFalhaConta(err);
        return res.status(status).json({ success: false, mensagem });
      }
      console.error("[Asaas Cartão]", err.response?.data || err.message);
      const detalhe =
        err.response?.data?.error_description?.message ||
        err.response?.data?.error_description ||
        err.response?.data?.errors?.[0]?.message ||
        err.message;
      res.status(500).json({ success: false, mensagem: `Erro ao gerar cobrança em cartão: ${detalhe}` });
    }
  });

  // --------------------------------------------------------------------------
  // CANCELAR/EXCLUIR um boleto já emitido
  // --------------------------------------------------------------------------
  //
  // "Excluir" aqui significa cancelar a cobrança no banco (Efí ou Asaas), não
  // só apagar o registro local. Um boleto cancelado só no Firestore continuaria
  // válido para o cliente pagar no banco — o usuário acharia que sumiu e o
  // dinheiro entraria do mesmo jeito, sem lançamento correspondente.
  //
  // ⚠️ BOLETO PAGO NÃO ENTRA AQUI. Cancelar não é estornar: nem a Efí nem a
  // Asaas devolvem o dinheiro por esta chamada. Bloqueado antes de tentar,
  // com uma mensagem que explica o motivo em vez de deixar o banco recusar.
  // --------------------------------------------------------------------------
  const STATUS_PAGOS = ["paid", "settled", "received", "confirmed", "approved"];

  app.delete("/api/efi/boleto/:id", async (req: any, res: any) => {
    try {
      const uid = await exigirUsuarioAutenticado(req);
      const id = String(req.params.id);

      const snap = await db.collection("cobrancas").doc(id).get();
      if (!snap.exists || snap.data().userId !== uid) {
        return res.status(404).json({ success: false, mensagem: "Boleto não encontrado." });
      }
      const cobranca = snap.data();

      if (STATUS_PAGOS.includes(String(cobranca.status || "").toLowerCase())) {
        return res.status(400).json({
          success: false,
          mensagem:
            "Este boleto já foi pago — excluir aqui não devolve o dinheiro. Para estornar, use o painel do seu banco.",
        });
      }

      /*
        O BOLETO FOI EMITIDO POR UM BANCO — TEM QUE SER CANCELADO POR ELE.

        ⚠️ Isto não é opcional: a conta cadastrada em Configurações → Banco
        pode ter MUDADO depois que o boleto foi emitido (era Efí, virou
        Asaas, por exemplo). Cancelar sempre fala com o banco que emitiu,
        nunca com o que está conectado agora — senão a Efí (ou a Asaas)
        recusaria a chamada (credencial de outra conta) e o erro cru
        vazaria para a tela, sem explicar o que fazer.
      */
      const gatewayDoBoleto: "asaas" | "efi" = cobranca.gateway === "asaas" ? "asaas" : "efi";
      const contaDoUsuario = await lerCredenciaisBanco(db, uid);
      const gatewayAtual: "asaas" | "efi" = contaDoUsuario?.provedor === "asaas" ? "asaas" : "efi";

      if (gatewayDoBoleto !== gatewayAtual) {
        const nomeEmissor = gatewayDoBoleto === "asaas" ? "Asaas" : "Efí";
        return res.status(428).json({
          success: false,
          mensagem:
            `Este boleto foi emitido pela ${nomeEmissor}, mas a conta conectada agora é outra. ` +
            `Para cancelar, reconecte a ${nomeEmissor} temporariamente em Configurações → Banco, ` +
            `ou cancele direto no painel da ${nomeEmissor}.`,
        });
      }

      if (gatewayDoBoleto === "asaas") {
        await cancelarCobrancaAsaas(contaDoUsuario?.segredos || {}, contaDoUsuario?.ambiente, id);
      } else {
        await efiCobrancas(uid, "PUT", `/v1/charge/${encodeURIComponent(id)}/cancel`);
      }

      // Fica marcado como cancelado, não apagado — o Arquivo Digital e o
      // painel de evolução precisam saber que existiu, mesmo sem valer mais.
      await db.collection("cobrancas").doc(id).set(
        { status: "canceled", canceladoEm: new Date().toISOString() },
        { merge: true }
      );

      res.json({ success: true, mensagem: "Boleto cancelado." });
    } catch (err: any) {
      // Mesmas causas conhecidas da emissão (sem credencial, sem chave de
      // cofre etc.) podem acontecer aqui também — a mesma tradução serve.
      if (
        err.message === "NAO_AUTENTICADO" ||
        err.message === "SEM_CREDENCIAIS_USUARIO" ||
        err.message === "BANCO_SEM_EMISSAO" ||
        err.message === "SEM_CHAVE_CRIPTO"
      ) {
        const { status, mensagem } = explicarFalhaConta(err);
        return res.status(status).json({ success: false, mensagem });
      }
      console.error("[Efí Cancelar Boleto]", err.response?.data || err.message);
      const detalhe =
        err.response?.data?.error_description?.message ||
        err.response?.data?.error_description ||
        err.response?.data?.errors?.[0]?.message ||
        err.message;
      res.status(500).json({ success: false, mensagem: `Não foi possível cancelar: ${detalhe}` });
    }
  });

  // --------------------------------------------------------------------------
  // MARCAR COMO CANCELADO SÓ AQUI — para quem já cancelou direto no banco
  // --------------------------------------------------------------------------
  //
  // A rota acima recusa quando o boleto foi emitido por um banco diferente do
  // que está conectado hoje (ver o comentário ali). Quando isso acontece, a
  // única saída pela API seria reconectar o banco antigo — chato, mas às
  // vezes a pessoa já foi direto no painel do banco e cancelou por lá.
  //
  // Esta rota NÃO fala com nenhum banco. Ela confia na palavra do usuário de
  // que o boleto já está morto do outro lado, e só atualiza o registro local.
  // Isso é seguro justamente PORQUE não muda nada na cobrança de verdade — se
  // o usuário errou e o boleto continua ativo lá, o pior caso é o MEI Flow
  // mostrar como cancelado um boleto que o cliente ainda pode pagar (a mesma
  // situação de qualquer painel que não sincroniza na hora), não o contrário
  // (nunca inventa uma cobrança nem mexe em dinheiro).
  // --------------------------------------------------------------------------
  app.post("/api/efi/boleto/:id/cancelar-local", async (req: any, res: any) => {
    try {
      const uid = await exigirUsuarioAutenticado(req);
      const id = String(req.params.id);

      const snap = await db.collection("cobrancas").doc(id).get();
      if (!snap.exists || snap.data().userId !== uid) {
        return res.status(404).json({ success: false, mensagem: "Boleto não encontrado." });
      }
      const cobranca = snap.data();

      if (STATUS_PAGOS.includes(String(cobranca.status || "").toLowerCase())) {
        return res.status(400).json({
          success: false,
          mensagem: "Este boleto já foi pago — não é possível marcar como cancelado.",
        });
      }

      await db.collection("cobrancas").doc(id).set(
        {
          status: "canceled",
          canceladoEm: new Date().toISOString(),
          // Fica registrado que ninguém confirmou isso com o banco — só o
          // usuário disse que já tinha cancelado por fora.
          canceladoLocalmente: true,
        },
        { merge: true }
      );

      res.json({ success: true, mensagem: "Boleto marcado como cancelado." });
    } catch (err: any) {
      if (err.message === "NAO_AUTENTICADO") {
        return res.status(401).json({ success: false, mensagem: "Faça login para continuar." });
      }
      console.error("[Efí Cancelar Boleto — local]", err.message);
      res.status(500).json({ success: false, mensagem: `Não foi possível atualizar: ${err.message}` });
    }
  });

  // --------------------------------------------------------------------------
  // CARNÊ — parcelamento em vários boletos de uma vez
  // --------------------------------------------------------------------------
  //
  // Exemplo: R$ 1.000 em 10x gera 10 boletos de R$ 100, um por mês, com
  // vencimentos sequenciais a partir da data informada.
  //
  // ⚠️ O PULO DO GATO É O `split_items`:
  //    true  → o valor total é DIVIDIDO entre as parcelas (1000 em 10x = 100 cada)
  //    false → CADA parcela cobra o valor cheio (1000 em 10x = 10.000 no total!)
  // O padrão da Efí é `false`. Enviar `true` explicitamente evita cobrar dez
  // vezes a mais do cliente por engano.
  // --------------------------------------------------------------------------
  app.post("/api/efi/carne", async (req: any, res: any) => {
    try {
      const uid = await exigirUsuarioAutenticado(req);
      await exigirPremium(db, uid, "boleto");

      // O carnê é um recurso da Efí — a Asaas tem parcelamento, mas com outro
      // formato, ainda não implementado. Dizer isso aqui evita a mensagem
      // errada ("seu banco não emite boleto"), que seria falsa: ele emite,
      // só não emite CARNÊ.
      const contaCarne = await lerCredenciaisBanco(db, uid);
      if (contaCarne && contaCarne.provedor !== "efi") {
        return res.status(428).json({
          success: false,
          mensagem:
            "O carnê parcelado ainda só funciona com a Efí. Com o seu banco, emita os boletos um a um.",
        });
      }
      const { customerId, valorTotal, parcelas, primeiroVencimento, descricao, juros, multa } = req.body;

      const total = Number(valorTotal);
      const n = Math.floor(Number(parcelas));

      if (!customerId || !total || total <= 0 || !primeiroVencimento) {
        return res.status(400).json({
          success: false,
          mensagem: "Informe o cliente, o valor total e a data da primeira parcela.",
        });
      }
      if (!n || n < 2 || n > 48) {
        return res.status(400).json({
          success: false,
          mensagem: "O número de parcelas deve ser entre 2 e 48.",
        });
      }
      // Boleto de valor muito baixo costuma custar mais em tarifa do que rende.
      if (total / n < 5) {
        return res.status(400).json({
          success: false,
          mensagem: `Cada parcela ficaria em R$ ${(total / n).toFixed(2).replace(".", ",")}. O valor mínimo por parcela é R$ 5,00 — reduza o número de parcelas.`,
        });
      }

      // ---- cliente (mesma regra do boleto avulso) ----
      let cliente: any = null;
      for (const col of ["customers", "clientes"]) {
        const snap = await db.collection(col).doc(String(customerId)).get();
        if (snap.exists) {
          const d = snap.data();
          if (d.userId === uid || d.mei_uid === uid) { cliente = d; break; }
        }
      }
      if (!cliente) {
        return res.status(404).json({ success: false, mensagem: "Cliente não encontrado no seu cadastro." });
      }

      const doc = String(cliente.cpfCnpj || cliente.documento || "").replace(/\D/g, "");
      if (doc.length !== 11 && doc.length !== 14) {
        return res.status(400).json({
          success: false,
          mensagem: "O cliente precisa ter CPF (11 dígitos) ou CNPJ (14 dígitos) válido.",
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

      const end = { ...(cliente.endereco || {}), ...(req.body.endereco || {}) };
      const cep = String(end.cep || end.zipcode || "").replace(/\D/g, "");
      const completo = cep.length === 8 && end.logradouro && end.numero && end.bairro && end.cidade && end.uf;

      if (completo) {
        customer.address = {
          street: String(end.logradouro).slice(0, 200),
          number: String(end.numero).slice(0, 10),
          neighborhood: String(end.bairro).slice(0, 100),
          zipcode: cep,
          city: String(end.cidade).slice(0, 100),
          state: String(end.uf).toUpperCase().slice(0, 2),
        };
        if (req.body.endereco) {
          const dados = { cep, logradouro: end.logradouro, numero: end.numero,
            bairro: end.bairro, cidade: end.cidade, uf: String(end.uf).toUpperCase() };
          for (const col of ["customers", "clientes"]) {
            await db.collection(col).doc(String(customerId)).set({ endereco: dados }, { merge: true }).catch(() => {});
          }
        }
      } else if (process.env.EFI_SANDBOX === "false") {
        return res.status(400).json({
          success: false,
          precisaEndereco: true,
          mensagem: "Para emitir carnê em produção o banco exige o endereço do cliente.",
        });
      }

      const payload = {
        // O valor total vai em UM item; o split_items reparte entre as parcelas.
        items: [{
          name: String(descricao || "Parcelamento").slice(0, 255),
          value: Math.round(total * 100), // centavos
          amount: 1,
        }],
        customer,
        expire_at: primeiroVencimento,   // vencimento da 1a parcela
        repeats: n,                      // quantas parcelas
        split_items: true,               // ⚠️ divide o total; sem isto cobra n vezes o total
        configurations: {
          fine: Number(multa ?? 200),      // 2,00%
          interest: Number(juros ?? 33),   // 0,33% ao mês
        },
        message: String(descricao || "Emitido via MEI Flow").slice(0, 80),
        metadata: {
          notification_url:
            // ⚠️ O `u=` NÃO É ENFEITE. Quando a Efí avisa que o boleto foi pago,
            // ela chama esta URL — e o servidor precisa saber de QUEM é a conta
            // para consultar a notificação com o token certo. Sem isso, a baixa
            // do pagamento tentaria ler a cobrança de um usuário usando a conta
            // de outro, e falharia (ou pior, leria a errada).
            `${APP_URL}/api/efi/webhook?token=${process.env.EFI_WEBHOOK_TOKEN || ""}&u=${encodeURIComponent(uid)}`,
          custom_id: `mfc_${uid.slice(0, 10)}_${Date.now()}`,
        },
      };

      const resposta = await efiCobrancas(uid, "POST", "/v1/carnet", payload);
      const carne = resposta?.data || resposta;
      const parcelasEfi: any[] = carne?.charges || [];
      const valorParcela = Math.round((total / n) * 100) / 100;

      // Cada parcela vira uma cobrança própria — o painel já as enxerga como
      // boletos normais, com vencimento e status independentes.
      for (const p of parcelasEfi) {
        await db.collection("cobrancas").doc(String(p.charge_id)).set({
          id: String(p.charge_id),
          userId: uid,
          customerId: String(customerId),
          clienteNome: nomeCliente,
          clienteDocumento: doc,
          gateway: "efi",
          tipo: "carne",
          carneId: String(carne.carnet_id || ""),
          parcela: Number(p.parcel || 0),
          totalParcelas: n,
          valor: valorParcela,
          vencimento: p.expire_at || primeiroVencimento,
          status: p.status || "waiting",
          barcode: p.barcode || "",
          link: p.link || carne.link || carne.carnet_link || "",
          pdfUrl: p.pdf?.charge || carne.pdf?.carnet || "",
          // Mesmo texto usado no carnê (payload.items[0].name / payload.message) — é o
          // que a nota fiscal automática (emitirNfseDaCobranca, em nfse.ts) usa como
          // descrição do serviço quando esta parcela for paga.
          descricao: String(descricao || "Emitido via MEI Flow").slice(0, 100),
          criadoEm: new Date().toISOString(),
          pagoEm: null,
        });
      }

      console.log(`[Efí Carnê] ${parcelasEfi.length} parcelas de R$ ${valorParcela} para ${uid}`);

      res.json({
        success: true,
        carneId: carne.carnet_id,
        parcelas: parcelasEfi.length,
        valorParcela,
        valorTotal: total,
        link: carne.link || carne.carnet_link,
        pdf: carne.pdf?.carnet || carne.pdf?.cover,
        primeiroVencimento,
      });
    } catch (err: any) {
      if (responderSePlano(res, err)) return;
      if (
        err.message === "SEM_CREDENCIAIS_USUARIO" ||
        err.message === "BANCO_SEM_EMISSAO" ||
        err.message === "SEM_CHAVE_CRIPTO"
      ) {
        const { status, mensagem } = explicarFalhaConta(err);
        return res.status(status).json({ success: false, mensagem });
      }
      if (err.message === "NAO_AUTENTICADO") {
        return res.status(401).json({ success: false, mensagem: "Faça login para emitir carnê." });
      }
      console.error("[Efí Carnê]", err.response?.data || err.message);
      if (err.response?.status === 401) {
        const ambiente = process.env.EFI_SANDBOX !== "false" ? "Homologação" : "Produção";
        return res.status(401).json({
          success: false,
          mensagem: `A Efí recusou as credenciais. O sistema está em ${ambiente} — confira o par de chaves e faça Redeploy.`,
        });
      }
      const detalhe =
        err.response?.data?.error_description?.message ||
        err.response?.data?.error_description ||
        err.message;
      res.status(500).json({ success: false, mensagem: `Erro ao gerar carnê: ${detalhe}` });
    }
  });

  // --------------------------------------------------------------------------
  // CONCLUIR PAGAMENTO — um caminho só, usado pelo webhook E pela sincronização
  // --------------------------------------------------------------------------
  /**
   * Marca a cobrança como paga, gera o comprovante, arquiva no mês certo,
   * lança a entrada no financeiro e emite a nota fiscal.
   *
   * ============================================================================
   * ⚠️ POR QUE ESTA FUNÇÃO FOI REESCRITA
   * ============================================================================
   *
   * Ela tinha três `try/catch` que só faziam `console.warn` e seguiam adiante —
   * e no fim marcava a cobrança como PAGA de qualquer jeito. O resultado, num
   * caso real: o boleto apareceu como pago na lista, mas não houve lançamento
   * no livro caixa, não houve comprovante no Arquivo Digital e não saiu nota
   * fiscal. Nada acusou. E, pior, a cobrança ficava PRESA: a sincronização
   * ignora o que já está "paid", e o aviso do banco responde "já estava paga".
   * Ou seja, o estado errado era permanente e invisível.
   *
   * Agora:
   *   • cada etapa registra a falha DENTRO do documento da cobrança;
   *   • `processadoEm` só é gravado quando tudo essencial deu certo;
   *   • quem não tem `processadoEm` é reprocessado na próxima sincronização;
   *   • a função devolve as falhas, para a tela poder dizer o que houve.
   *
   * Continua idempotente — e continua verdade que uma falha aqui NÃO desfaz o
   * pagamento. O que muda é que ela deixa de mentir que deu tudo certo.
   */
  async function concluirPagamento(chargeId: string, dataPagamento?: string) {
    const snap = await db.collection("cobrancas").doc(String(chargeId)).get();
    if (!snap.exists) return { ok: false, motivo: "cobranca_desconhecida" };

    const cobranca = snap.data();
    // ⚠️ A trava é `processadoEm`, e não `documentoId`. O documento pode ser
    //    nulo legitimamente (Storage indisponível), e usá-lo como marca fazia
    //    a cobrança ser reprocessada para sempre — ou nunca.
    if (cobranca.processadoEm) return { ok: true, motivo: "ja_processada" };

    /** O que deu errado. Vazio no fim = processamento completo. */
    const falhas: string[] = [];

    const pago = dataPagamento || new Date().toISOString();
    const { ano, mes } = resolverMesFiscal(pago, cobranca.vencimento, false);

    const perfilSnap = await db.collection("users").doc(cobranca.userId).get();
    const perfil = perfilSnap.exists ? perfilSnap.data() : {};

    // ⚠️ "COMPROVANTE DE RECEBIMENTO" DESLIGADO DE PROPÓSITO.
    //
    // Este PDF interno (gerarComprovantePdf + arquivarComprovante) foi pedido
    // no início do projeto, mas o usuário identificou que, ao lado da nota
    // fiscal de verdade emitida pela prefeitura, ele é redundante — a nota já
    // é o documento fiscal válido. Gerar os dois só duplicava arquivo no
    // Arquivo Digital.
    //
    // `documento` fica null de propósito: `documentoId` é só um vínculo
    // opcional entre o lançamento no livro caixa e um PDF arquivado — nada
    // mais depende dele (nenhuma tela do app lê `documentoId`), então deixar
    // nulo aqui não quebra nada, só deixa de arquivar um PDF que não é mais
    // gerado.
    //
    // Se um dia quiser o comprovante de volta, a função `gerarComprovantePdf`
    // e `arquivarComprovante` continuam abaixo (usadas pelo Pix enviado) —
    // bastaria restaurar o bloco que chamava as duas aqui.
    const documento: any = null;

    const lancamento = await criarLancamento(db, {
      userId: cobranca.userId,
      tipo: "entrada",
      valor: Number(cobranca.valor),
      dataISO: pago,
      descricao: `Recebimento de ${cobranca.clienteNome || "cliente"}`,
      categoria: "Serviços",
      formaPagamento: "Boleto",
      documentoId: documento?.id,
      referenciaId: String(chargeId),
      clienteId: cobranca.customerId,
      clienteNome: cobranca.clienteNome,
      clienteDocumento: cobranca.clienteDocumento,
    });

    // ⚠️ `criarLancamento` engole o próprio erro e devolve null. Sem conferir
    //    o retorno, o dinheiro entrava no banco e NÃO aparecia no faturamento —
    //    exatamente o sintoma relatado: "não mudou o saldo na tela inicial".
    if (!lancamento) {
      falhas.push("lancamento: a entrada não pôde ser gravada no livro caixa");
    }

    await snap.ref.set(
      { status: "paid", pagoEm: pago, documentoId: documento?.id || null },
      { merge: true }
    );

    // --------------------------------------------------------------------
    // NOTA FISCAL — emitida só depois que o dinheiro entrou.
    // Emitir na hora do boleto criaria nota de serviço que o cliente talvez
    // nunca pague, e nota emitida indevidamente dá trabalho para cancelar.
    // Falha aqui NÃO desfaz o pagamento: o recebimento continua registrado.
    // --------------------------------------------------------------------
    let notaEmitida: any = null;
    try {
      const cfgSnap = await db.collection("nfse_config").doc(cobranca.userId).get();

      // ⚠️ Três motivos diferentes para a nota não sair, e eles PRECISAM ser
      //    distinguidos: sem configuração fiscal, desligado de propósito, ou
      //    falha de verdade. Antes os três eram silêncio idêntico, e o usuário
      //    só via "não emitiu a nota".
      if (!cfgSnap.exists) {
        falhas.push("nota fiscal: dados fiscais não configurados");
      } else if (cfgSnap.data().ativo === false || cfgSnap.data().emitirAoPagar === false) {
        console.log(`[MEI Flow] Nota automática desligada para ${cobranca.userId}. Nada a fazer.`);
      } else {
        const { emitirNfseDaCobranca } = await import("./nfse.js");
        notaEmitida = await emitirNfseDaCobranca(db, adminStorage, firebaseConfig, String(chargeId));
        console.log(`[MEI Flow] Nota fiscal da cobrança ${chargeId}:`, notaEmitida?.chave || notaEmitida);
      }
    } catch (errNota: any) {
      const motivo =
        errNota?.response?.data?.mensagem || errNota?.message || "erro desconhecido";
      console.warn(`[MEI Flow] Pagamento registrado, mas a nota fiscal falhou (${chargeId}):`, motivo);
      falhas.push(`nota fiscal: ${String(motivo).slice(0, 200)}`);
      await snap.ref.set(
        { nfseErro: String(motivo).slice(0, 300), nfseTentadaEm: new Date().toISOString() },
        { merge: true }
      );
    }

    /**
     * ⚠️ O QUE TRAVA A CONCLUSÃO É SÓ O ESSENCIAL — E ISSO É DELIBERADO.
     *
     * A primeira versão desta regra segurava a marca de "processado" diante de
     * QUALQUER falha. Parecia mais seguro e era pior: com o Storage fora do ar,
     * o comprovante falha sempre, a cobrança nunca fecha, e cada sincronização
     * recomeça o processamento. O teste flagrou o resultado — lançamento
     * duplicado. Faturamento inflado é bem pior que comprovante faltando.
     *
     * Então:
     *   • lançamento no livro caixa  → ESSENCIAL. Falhou, tenta de novo.
     *   • comprovante em PDF          → o dinheiro já está registrado; o PDF é
     *                                   regerável e não vale repetir tudo.
     *   • nota fiscal                 → idem: ela tem trava própria contra
     *                                   emissão dupla, e insistir num usuário
     *                                   sem dados fiscais seria laço infinito.
     *
     * As pendências continuam gravadas e aparecem na tela em qualquer caso —
     * o que não acontece é o reprocessamento em loop.
     */
    const precisaRefazer = falhas.some((f) => f.startsWith("lancamento:"));

    await snap.ref.set(
      {
        processadoEm: precisaRefazer ? null : new Date().toISOString(),
        falhasProcessamento: falhas,
        ultimaTentativaEm: new Date().toISOString(),
      },
      { merge: true }
    );

    if (falhas.length) {
      console.warn(`[MEI Flow] Cobrança ${chargeId} paga, mas com pendências:`, falhas.join(" | "));
    } else {
      console.log(`[MEI Flow] Cobrança ${chargeId} concluída e arquivada em ${mes}/${ano}.`);
    }

    return {
      ok: falhas.length === 0,
      ano, mes,
      documentoId: documento?.id || null,
      notaChave: notaEmitida?.chave || null,
      falhas,
    };
  }

  // --------------------------------------------------------------------------
  // SINCRONIZAR — pergunta o status direto à Efí, sem depender de webhook
  // --------------------------------------------------------------------------
  //
  // POR QUE ISTO EXISTE: webhook é frágil. Pode não ter sido cadastrado, pode
  // ter falhado numa hora que o servidor estava frio, pode ter sido emitido
  // antes de o endereço de aviso existir. Esta rota varre as cobranças em
  // aberto e pergunta à Efí, uma por uma, qual o status real. É o que garante
  // que o painel nunca fique mentindo.
  // --------------------------------------------------------------------------
  app.post("/api/efi/sincronizar", async (req: any, res: any) => {
    try {
      const uid = await exigirUsuarioAutenticado(req);

      const snap = await db.collection("cobrancas").where("userId", "==", uid).get();
      const todas = snap.docs.map((d: any) => d.data());

      const MORTAS = ["canceled", "cancelled", "unpaid", "expired"];
      const PAGAS = ["paid", "settled"];

      /**
       * ⚠️ AS PAGAS-MAS-NÃO-PROCESSADAS PRECISAM ENTRAR AQUI.
       *
       * Antes a varredura pulava tudo que já estava "paid". Só que uma cobrança
       * pode ter sido marcada como paga e ter falhado depois — sem lançamento,
       * sem comprovante, sem nota. Ficava presa para sempre: a sincronização a
       * ignorava e o aviso do banco respondia "já estava paga". Era um beco sem
       * saída, e o usuário não tinha como sair dele.
       *
       * Agora quem está pago sem `processadoEm` volta para a fila — e não custa
       * nada, porque essas nem precisam de consulta ao banco: já sabemos que
       * foram pagas.
       */
      const presas = todas.filter(
        (c: any) => PAGAS.includes(String(c.status)) && !c.processadoEm
      );

      const abertas = todas
        .filter((c: any) => !PAGAS.includes(String(c.status)) && !MORTAS.includes(String(c.status)))
        .slice(0, 60); // teto de segurança por chamada

      const contaDoUsuario = await lerCredenciaisBanco(db, uid);
      const ehAsaas = contaDoUsuario?.provedor === "asaas";

      // Confere a conta UMA vez, antes do laço. Sem isto, a falta de
      // credencial cairia no catch de cada item, seria só um aviso no log, e a
      // tela responderia "Tudo já estava em dia" — a pior resposta possível,
      // porque nada foi verificado.
      if (abertas.length && !ehAsaas) await getTokenCobrancas(uid);

      let atualizadas = 0, pagas = 0;
      const detalhes: any[] = [];
      const pendencias: any[] = [];

      // Primeiro as presas: terminar o que ficou pela metade vem antes de
      // procurar novidade.
      for (const c of presas.slice(0, 60)) {
        try {
          const r = await concluirPagamento(String(c.id), c.pagoEm || undefined);
          if (r?.falhas?.length) {
            pendencias.push({ id: c.id, cliente: c.clienteNome, falhas: r.falhas });
          } else if (r?.ok) {
            pagas++;
            detalhes.push({ id: c.id, cliente: c.clienteNome, status: "pago", recuperada: true });
          }
        } catch (err: any) {
          pendencias.push({
            id: c.id, cliente: c.clienteNome,
            falhas: [String(err?.message || err).slice(0, 200)],
          });
        }
      }

      for (const c of abertas) {
        try {
          // ⚠️ Cada cobrança é consultada no banco QUE A EMITIU, e não no banco
          //    que o usuário usa hoje. Quem trocou de provedor tem cobranças
          //    antigas de um e novas de outro — perguntar ao banco errado
          //    devolveria "não encontrado" e a baixa nunca aconteceria.
          const emitidaPorAsaas = c.gateway === "asaas" || (!c.gateway && ehAsaas);

          let status = "";
          let quandoPago = "";

          if (emitidaPorAsaas) {
            const r = await consultarCobrancaAsaas(
              contaDoUsuario?.segredos || {},
              contaDoUsuario?.ambiente,
              String(c.id)
            );
            status = situacaoAsaas(r.status) === "pago" ? "paid" : r.status;
            quandoPago = r.pagoEm || "";
          } else {
            const r = await efiCobrancas(uid, "GET", `/v1/charge/${c.id}`);
            const dados = r?.data || r;
            status = String(dados?.status || "");
            quandoPago =
              dados?.payment?.banking_billet?.paid_at || dados?.paid_at || "";
          }

          if (!status || status === c.status) continue;

          atualizadas++;
          if (PAGAS.includes(status)) {
            const r = await concluirPagamento(String(c.id), quandoPago || new Date().toISOString());
            if (r?.falhas?.length) {
              pendencias.push({ id: c.id, cliente: c.clienteNome, falhas: r.falhas });
            }
            pagas++;
            detalhes.push({ id: c.id, cliente: c.clienteNome, status: "pago" });
          } else {
            await db.collection("cobrancas").doc(String(c.id)).set({ status }, { merge: true });
            detalhes.push({ id: c.id, cliente: c.clienteNome, status });
          }
        } catch (err: any) {
          console.warn(`[Efí Sincronizar] Falha em ${c.id}:`, err.response?.data || err.message);
        }
      }

      // ⚠️ "Tudo já estava em dia" era a resposta mesmo quando havia cobrança
      //    paga pela metade. A mensagem precisa carregar a pendência, senão o
      //    usuário fecha a tela achando que está tudo certo.
      const mensagem = pendencias.length
        ? `${pendencias.length} cobrança(s) foram pagas, mas algo não pôde ser concluído. Veja os detalhes.`
        : pagas > 0
          ? `${pagas} cobrança(s) marcada(s) como paga(s).`
          : atualizadas > 0
            ? `${atualizadas} cobrança(s) atualizada(s).`
            : "Tudo já estava em dia.";

      res.json({
        success: true,
        verificadas: abertas.length,
        recuperadas: presas.length,
        atualizadas,
        pagas,
        detalhes,
        pendencias,
        mensagem,
      });
    } catch (err: any) {
      if (
        err.message === "NAO_AUTENTICADO" ||
        err.message === "SEM_CREDENCIAIS_USUARIO" ||
        err.message === "BANCO_SEM_EMISSAO" ||
        err.message === "SEM_CHAVE_CRIPTO"
      ) {
        const { status, mensagem } = explicarFalhaConta(err);
        return res.status(status).json({ success: false, mensagem });
      }
      console.error("[Efí Sincronizar]", err.response?.data || err.message);
      res.status(500).json({ success: false, mensagem: `Erro ao sincronizar: ${err.message}` });
    }
  });

  // --------------------------------------------------------------------------
  // DESLIGAR NOTIFICAÇÕES PAGAS (WhatsApp, SMS, ligação) — corrige clientes
  // já cadastrados
  // --------------------------------------------------------------------------
  //
  // A partir de agora, todo cliente NOVO (ou reutilizado) já sai com esses
  // três canais desligados — ver `resolverClienteAsaas` em bancoAsaas.ts.
  // Mas isso só vale a partir da PRÓXIMA cobrança de cada cliente; quem já
  // tem clientes cadastrados de antes continua sendo cobrado por notificação
  // até que essa rotina rode uma vez para eles. É por isso que esta rota
  // existe: um botão de "corrigir agora, de uma vez" para os clientes já
  // usados.
  //
  // ⚠️ E-mail continua ligado — é grátis e o cliente ainda precisa saber que
  // tem uma cobrança. ⚠️ Só Asaas — a Efí não tem esse mecanismo de
  // notificação paga neste app.
  // --------------------------------------------------------------------------
  app.post("/api/efi/notificacoes/desativar-whatsapp", async (req: any, res: any) => {
    try {
      const uid = await exigirUsuarioAutenticado(req);

      const contaDoUsuario = await lerCredenciaisBanco(db, uid);
      if (contaDoUsuario?.provedor !== "asaas") {
        return res.status(428).json({
          success: false,
          mensagem: "Isto só se aplica a contas conectadas via Asaas.",
        });
      }

      // Os mesmos clientes que já foram cobrados por este usuário — não dá
      // para listar "todos os clientes da Asaas", só os que passaram por
      // uma cobrança feita pelo MEI Flow.
      const snap = await db.collection("cobrancas").where("userId", "==", uid).get();
      const idsClientes = Array.from(
        new Set(
          snap.docs
            .map((d: any) => d.data())
            .filter((c: any) => c.gateway === "asaas" && c.customerId)
            .map((c: any) => String(c.customerId))
        )
      );

      let corrigidos = 0;
      const falhas: { customerId: string; erro: string }[] = [];

      for (const customerId of idsClientes) {
        try {
          await desligarNotificacaoWhatsappAsaas(
            contaDoUsuario.segredos || {},
            contaDoUsuario.ambiente,
            customerId
          );
          corrigidos++;
        } catch (err: any) {
          falhas.push({ customerId, erro: String(err?.message || err).slice(0, 200) });
        }
      }

      res.json({
        success: true,
        totalClientes: idsClientes.length,
        corrigidos,
        falhas,
        mensagem:
          idsClientes.length === 0
            ? "Nenhum cliente cobrado pela Asaas ainda."
            : falhas.length
            ? `${corrigidos} de ${idsClientes.length} cliente(s) corrigido(s). ${falhas.length} falharam — tente de novo.`
            : `Notificações pagas (WhatsApp/SMS/ligação) desligadas para ${corrigidos} cliente(s). Cobranças novas para eles não devem mais gerar essa taxa.`,
      });
    } catch (err: any) {
      if (
        err.message === "NAO_AUTENTICADO" ||
        err.message === "SEM_CREDENCIAIS_USUARIO" ||
        err.message === "BANCO_SEM_EMISSAO" ||
        err.message === "SEM_CHAVE_CRIPTO"
      ) {
        const { status, mensagem } = explicarFalhaConta(err);
        return res.status(status).json({ success: false, mensagem });
      }
      console.error("[Asaas Notificações]", err.response?.data || err.message);
      res.status(500).json({
        success: false,
        mensagem: `Erro ao desligar notificações: ${err.message}`,
      });
    }
  });

  // --------------------------------------------------------------------------
  // Webhook da Efí — o caminho automático (quando funciona)
  // --------------------------------------------------------------------------
  // A Efí NÃO envia os dados da cobrança: envia só um token de notificação,
  // que precisamos consultar de volta. E ela repete a chamada até 10 vezes se
  // não receber 2xx — por isso respondemos 200 mesmo em erro.
  // --------------------------------------------------------------------------
  app.post("/api/efi/webhook", async (req: any, res: any) => {
    if (req.query.token !== process.env.EFI_WEBHOOK_TOKEN) {
      console.warn("[Efí Webhook] Token inválido. Requisição recusada.");
      return res.status(401).json({ erro: "token invalido" });
    }

    res.status(200).json({ status: "recebido" });

    try {
      // A Efí pode mandar como JSON ou como formulário; aceitamos os dois.
      const notificationToken =
        req.body?.notification ||
        (typeof req.body === "string" ? new URLSearchParams(req.body).get("notification") : null);
      if (!notificationToken) {
        console.warn("[Efí Webhook] Sem token de notificação no corpo.");
        return;
      }

      // De quem é esta cobrança? Vem no próprio endereço que a Efí chamou,
      // porque foi assim que ele foi montado na hora de emitir.
      //
      // Boletos emitidos ANTES desta mudança não têm o `u=`. Para eles, o
      // caminho antigo continua: a conta compartilhada do sistema — que era a
      // única que existia quando aqueles boletos nasceram. Assim nada que já
      // estava rodando quebra, e nada novo depende disso.
      const donoDaCobranca = String(req.query?.u || "").trim();
      if (!donoDaCobranca) {
        console.warn(
          "[Efí Webhook] Cobrança sem dono no endereço — usando a conta compartilhada. " +
            "Isso só deve acontecer com boletos emitidos antes do cofre por usuário."
        );
      }

      const detalhe = donoDaCobranca
        ? await efiCobrancas(donoDaCobranca, "GET", `/v1/notification/${notificationToken}`)
        : await efiCobrancasContaDoSistema("GET", `/v1/notification/${notificationToken}`);
      const historico = detalhe?.data || [];
      const ultimo = Array.isArray(historico) ? historico[historico.length - 1] : historico;

      const statusAtual = ultimo?.status?.current;
      const chargeId = String(ultimo?.identifiers?.charge_id || ultimo?.charge_id || "");

      console.log(`[Efí Webhook] Cobrança ${chargeId} → status "${statusAtual}"`);
      if (!chargeId) return;

      if (statusAtual === "paid" || statusAtual === "settled") {
        await concluirPagamento(chargeId, ultimo?.received_by_bank_at);
      } else if (statusAtual) {
        await db.collection("cobrancas").doc(chargeId).set({ status: statusAtual }, { merge: true });
      }
    } catch (err: any) {
      console.error("[Efí Webhook Erro]", err.response?.data || err.message);
    }
  });

  // ==========================================================================
  // AVISO DE PAGAMENTO DA ASAAS
  // ==========================================================================
  //
  // A Efí é configurada por cobrança: o endereço de retorno vai dentro de cada
  // boleto. A Asaas é diferente — o usuário configura UM endereço no painel
  // dele, e a Asaas passa a avisar todos os pagamentos daquela conta. Por isso
  // este endereço carrega o UID: é ele que diz de quem é a conta.
  //
  // ⚠️ O AVISO É TRATADO COMO BOATO.
  //
  // Qualquer pessoa pode descobrir este endereço e mandar um JSON dizendo
  // "fulano pagou". Se acreditássemos, o sistema registraria um recebimento
  // que não existiu e emitiria uma NOTA FISCAL de um serviço não pago — que é
  // problema fiscal, não bug de tela. Então o aviso serve só para dizer "vá
  // conferir": quem responde de verdade é a Asaas, consultada com a chave do
  // próprio usuário.
  //
  // O token é a primeira porta, não a garantia. Ele evita que qualquer robô
  // faça o servidor consultar a Asaas à toa.
  app.post("/api/banco/webhook/asaas", async (req: any, res: any) => {
    // Responde já. Webhook que demora vira reenvio, e reenvio vira pagamento
    // processado duas vezes.
    res.status(200).json({ recebido: true });

    try {
      const uid = String(req.query?.u || "").trim();
      if (!uid) return console.warn("[Asaas Webhook] Aviso sem dono no endereço. Ignorado.");

      const conta = await lerCredenciaisBanco(db, uid);
      if (!conta || conta.provedor !== "asaas") {
        return console.warn(`[Asaas Webhook] ${uid} não usa Asaas. Ignorado.`);
      }

      const enviado =
        req.headers?.["asaas-access-token"] ||
        req.headers?.["Asaas-Access-Token"] ||
        req.query?.token ||
        "";
      if (!tokenWebhookConfere(conta.segredos.webhookToken || "", String(enviado))) {
        return console.warn(`[Asaas Webhook] Token inválido para ${uid}. Recusado.`);
      }

      const corpo =
        typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
      const idCobranca = String(corpo?.payment?.id || "").trim();
      if (!idCobranca) return console.warn("[Asaas Webhook] Aviso sem id de cobrança.");

      // ⚠️ AQUI ESTÁ A CONFIRMAÇÃO. O status usado é o que a Asaas responde
      //    agora, não o que veio no aviso.
      const confirmado = await consultarCobrancaAsaas(
        conta.segredos,
        conta.ambiente,
        idCobranca
      );
      const situacao = situacaoAsaas(confirmado.status);

      console.log(
        `[Asaas Webhook] ${idCobranca}: aviso "${corpo?.event || "?"}" → confirmado "${confirmado.status}"`
      );

      if (situacao !== "pago") {
        await db.collection("cobrancas").doc(idCobranca)
          .set({ status: confirmado.status }, { merge: true });
        return;
      }

      // A cobrança precisa ser DESTE usuário. Sem esta conferência, um aviso
      // com o id de uma cobrança alheia daria baixa na cobrança de outra
      // pessoa — e emitiria a nota fiscal dela.
      const snap = await db.collection("cobrancas").doc(idCobranca).get();
      if (!snap.exists) return console.warn(`[Asaas Webhook] Cobrança ${idCobranca} não é do MEI Flow.`);
      if (snap.data()?.userId !== uid) {
        return console.warn(`[Asaas Webhook] Cobrança ${idCobranca} não pertence a ${uid}. Recusado.`);
      }
      // ⚠️ A trava é `processadoEm`, não o status. Uma cobrança marcada como
      //    paga que falhou no meio do caminho PRECISA ser retomada — antes,
      //    este `return` a deixava presa para sempre.
      if (snap.data()?.processadoEm) {
        return console.log(`[Asaas Webhook] ${idCobranca} já foi processada. Nada a fazer.`);
      }

      // Daqui em diante é o MESMO caminho da Efí: registra o recebimento,
      // arquiva o comprovante e emite a nota fiscal, se estiver ligado.
      await concluirPagamento(idCobranca, confirmado.pagoEm || new Date().toISOString());
    } catch (err: any) {
      console.error("[Asaas Webhook Erro]", err?.response?.data || err?.message || err);
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
  //
  // ⚠️ AQUI O DINHEIRO SAI DA CONTA. Enquanto o token do Pix ficava numa
  //    variável só, alimentada pelo ambiente, qualquer usuário logado que
  //    chamasse /api/efi/pix/enviar estaria mandando dinheiro DA CONTA DO DONO
  //    DO SISTEMA. Agora vale a mesma regra do boleto: a conta é a do usuário,
  //    e a compartilhada só entra com a chave EFI_CONTA_COMPARTILHADA ligada.
  // ==========================================================================

  function basePix(ambiente: "homologacao" | "producao"): string {
    return ambiente === "producao"
      ? "https://pix.api.efipay.com.br"
      : "https://pix-h.api.efipay.com.br";
  }

  async function getTokenPix(uid: string): Promise<{ token: string; conta: ContaEfi }> {
    const conta = await contaEfi(uid, "pix");
    const etiqueta = `${uid}|pix|${conta.ambiente}`;

    const cached = tokenCache.get(etiqueta);
    if (cached && cached.exp > Date.now() + 30_000) return { token: cached.token, conta };

    const basic = Buffer.from(`${conta.clientId}:${conta.clientSecret}`).toString("base64");
    const { data } = await axios.post(
      `${basePix(conta.ambiente)}/oauth/token`,
      { grant_type: "client_credentials" },
      {
        headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/json" },
        httpsAgent: getEfiAgent(),
        timeout: 20000,
      }
    );

    tokenCache.set(etiqueta, {
      token: data.access_token,
      exp: Date.now() + (data.expires_in || 600) * 1000,
    });
    return { token: data.access_token, conta };
  }

  async function efiPix(uid: string, method: "GET" | "POST" | "PUT", caminho: string, corpo?: any) {
    const { token, conta } = await getTokenPix(uid);
    const { data } = await axios.request({
      method,
      url: `${basePix(conta.ambiente)}${caminho}`,
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
    // As falhas de conta ("você ainda não cadastrou seu banco") são as mesmas
    // do boleto — e a frase precisa ser a mesma, senão a pessoa acha que são
    // dois problemas diferentes.
    if (err.message === "SEM_CREDENCIAIS_USUARIO" || err.message === "BANCO_SEM_EMISSAO") {
      return explicarFalhaConta(err);
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
      const uid = await exigirUsuarioAutenticado(req);
      const dados = await efiPix(uid, "GET", "/v2/gn/saldo/");
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

      const resposta = await efiPix(uid, "PUT", `/v3/gn/pix/${idEnvio}`, {
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
      const resposta = await efiPix(uid, "PUT", `/v2/gn/pix/${idEnvio}/qrcode`, {
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

      const dados = await efiPix(uid, "GET", `/v2/gn/pix/enviados/id-envio/${idEnvio}`);
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
      const uid = await exigirUsuarioAutenticado(req);
      const fim = req.query.fim || new Date().toISOString();
      const inicio =
        req.query.inicio || new Date(Date.now() - 30 * 86400000).toISOString();
      const dados = await efiPix(uid, "GET", `/v2/gn/pix/enviados?inicio=${inicio}&fim=${fim}`);
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
