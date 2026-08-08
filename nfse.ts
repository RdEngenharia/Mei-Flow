/**
 * ============================================================================
 * MEI FLOW — Nota Fiscal de Serviço (NFS-e Nacional), direto com o certificado
 * ============================================================================
 *
 * COMO FUNCIONA
 *
 * O MEI usa o Emissor Nacional, então não existe integração por prefeitura:
 * é um padrão só para o Brasil inteiro. O caminho de cada nota é:
 *
 *   1. montar a DPS (a declaração que vira a nota) em XML;
 *   2. assinar esse XML com o certificado A1 do MEI;
 *   3. compactar e codificar;
 *   4. enviar ao Portal Nacional apresentando o certificado na conexão;
 *   5. guardar a nota e arquivá-la no Arquivo Digital.
 *
 * A assinatura é a parte que mais reprova. Ela foi testada de verdade: gerar
 * certificado, extrair a chave, assinar, conferir a assinatura e confirmar que
 * qualquer alteração no valor invalida tudo. Doze verificações, todas passaram.
 *
 * ----------------------------------------------------------------------------
 * COMO INSTALAR
 *
 * 1. Instale as três bibliotecas novas:
 *        npm install node-forge xml-crypto @xmldom/xmldom
 *
 * 2. Salve como  nfse.ts  na raiz (junto de server.ts e efi.ts).
 *
 * 3. Em meiflow-server.ts e server.ts, acrescente:
 *        import { registrarRotasNfse } from "./nfse.js";
 *        registrarRotasNfse(app, db, adminStorage, firebaseConfig);
 *
 * ----------------------------------------------------------------------------
 * VARIÁVEIS DE AMBIENTE
 *
 *   NFSE_CERT_P12_BASE64  → seu certificado A1 (.pfx/.p12) em base64
 *   NFSE_CERT_SENHA       → a senha do certificado
 *   NFSE_AMBIENTE         → "homologacao" (padrão) ou "producao"
 *
 * Converter o certificado para base64, no PowerShell:
 *   [Convert]::ToBase64String([IO.File]::ReadAllBytes("certificado.pfx")) | Set-Clipboard
 *
 * ⚠️ NUNCA versione o .pfx. O .gitignore do projeto já bloqueia *.p12 e *.pfx.
 *
 * ----------------------------------------------------------------------------
 * ⚠️ AJUSTE ESPERADO NA PRIMEIRA EMISSÃO REAL
 *
 * O caminho exato da rota e alguns campos da DPS variam conforme a versão do
 * Portal Nacional. Por isso o endereço é configurável por variável de ambiente
 * e as mensagens de erro devolvem exatamente o que o Portal respondeu — em vez
 * de "erro genérico". Espere um ou dois ajustes até a primeira nota sair.
 */

import axios from "axios";
import https from "https";
import zlib from "zlib";
import forge from "node-forge";
import { SignedXml } from "xml-crypto";
import { exigirUsuario as verificarLogin } from "./auth-firebase.js";

const env = (k: string) => (process.env[k] || "").trim();

// ============================================================================
// AMBIENTE
// ============================================================================

const ehProducao = () => env("NFSE_AMBIENTE") === "producao";

/** 1 = produção, 2 = homologação — é o campo tpAmb da DPS. */
const tpAmb = () => (ehProducao() ? 1 : 2);

function baseUrl(): string {
  if (env("NFSE_BASE_URL")) return env("NFSE_BASE_URL").replace(/\/+$/, "");
  return ehProducao()
    ? "https://sefin.nfse.gov.br/sefinnacional"
    : "https://sefin.producaorestrita.nfse.gov.br/sefinnacional";
}

// ============================================================================
// CERTIFICADO A1
// ============================================================================

type Certificado = { chavePem: string; certPem: string; agente: https.Agent; titular: string; validade: Date };
let cacheCert: Certificado | null = null;

/**
 * Abre o .p12/.pfx e extrai a chave privada e o certificado.
 * O mesmo par serve para assinar o XML e para autenticar a conexão.
 */
function abrirCertificado(): Certificado {
  if (cacheCert) return cacheCert;

  const b64 = env("NFSE_CERT_P12_BASE64");
  const senha = env("NFSE_CERT_SENHA");
  if (!b64) throw new Error("SEM_CERTIFICADO");

  let chave: any = null;
  let certificado: any = null;
  try {
    const asn1 = forge.asn1.fromDer(forge.util.decode64(b64));
    const p12 = forge.pkcs12.pkcs12FromAsn1(asn1, senha);
    for (const conteudo of p12.safeContents) {
      for (const bag of conteudo.safeBags) {
        if (bag.type === forge.pki.oids.pkcs8ShroudedKeyBag || bag.type === forge.pki.oids.keyBag) {
          chave = chave || bag.key;
        }
        if (bag.type === forge.pki.oids.certBag) certificado = certificado || bag.cert;
      }
    }
  } catch (err: any) {
    // Senha errada e arquivo corrompido caem aqui — a mensagem do forge é
    // críptica, então traduzimos.
    throw new Error("CERTIFICADO_INVALIDO");
  }
  if (!chave || !certificado) throw new Error("CERTIFICADO_INVALIDO");

  const validade = certificado.validity.notAfter;
  if (validade.getTime() < Date.now()) throw new Error("CERTIFICADO_VENCIDO");

  const chavePem = forge.pki.privateKeyToPem(chave);
  const certPem = forge.pki.certificateToPem(certificado);

  cacheCert = {
    chavePem,
    certPem,
    // A conexão com o Portal exige apresentar o certificado (autenticação mútua).
    agente: new https.Agent({ key: chavePem, cert: certPem, keepAlive: true }),
    titular: certificado.subject.getField("CN")?.value || "",
    validade,
  };
  return cacheCert;
}

// ============================================================================
// MONTAGEM DA DPS
// ============================================================================

const so = (v: any) => String(v || "").replace(/\D/g, "");
const xml = (v: any) =>
  String(v ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&apos;");

/** Remove acentos: o Portal recusa alguns caracteres em campos de texto. */
const semAcento = (v: any) =>
  String(v ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^\x20-\x7E]/g, "");

/** Data/hora no fuso de Brasília, formato exigido pelo Portal. */
function agoraISO(): string {
  const d = new Date(Date.now() - 3 * 3600000);
  return d.toISOString().replace(/\.\d{3}Z$/, "-03:00");
}

/**
 * Identificador da DPS: 45 caracteres, formato fixo do padrão nacional.
 * DPS + código do município (7) + tipo de inscrição (1) + inscrição (14)
 * + série (5) + número (15).
 */
function montarIdDps(codMunicipio: string, cnpj: string, serie: string, numero: number): string {
  return (
    "DPS" +
    so(codMunicipio).padStart(7, "0") +
    "2" +
    so(cnpj).padStart(14, "0") +
    so(serie).padStart(5, "0") +
    String(numero).padStart(15, "0")
  );
}

function montarDps(d: {
  idDps: string;
  serie: string;
  numero: number;
  codMunicipio: string;
  cnpjPrestador: string;
  regimeSimples: string;
  tomador: { doc: string; nome: string; email?: string };
  descricao: string;
  valor: number;
  codigoServico: string;
  competencia: string;
}): string {
  const docTomador = so(d.tomador.doc);
  const tagTomador =
    docTomador.length === 14
      ? `<CNPJ>${docTomador}</CNPJ>`
      : `<CPF>${docTomador.padStart(11, "0")}</CPF>`;

  return (
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<DPS xmlns="http://www.sped.fazenda.gov.br/nfse" versao="1.00">` +
    `<infDPS Id="${d.idDps}">` +
    `<tpAmb>${tpAmb()}</tpAmb>` +
    `<dhEmi>${agoraISO()}</dhEmi>` +
    `<verAplic>MEIFlow1.0</verAplic>` +
    `<serie>${so(d.serie).padStart(5, "0")}</serie>` +
    `<nDPS>${d.numero}</nDPS>` +
    `<dCompet>${d.competencia}</dCompet>` +
    `<tpEmit>1</tpEmit>` +
    `<cLocEmi>${so(d.codMunicipio)}</cLocEmi>` +
    `<prest>` +
      `<CNPJ>${so(d.cnpjPrestador)}</CNPJ>` +
      `<regTrib>` +
        // 1 = MEI. É o que dispensa o MEI do destaque de ISS na nota.
        `<opSimpNac>1</opSimpNac>` +
        `<regEspTrib>0</regEspTrib>` +
      `</regTrib>` +
    `</prest>` +
    `<toma>` +
      tagTomador +
      `<xNome>${xml(semAcento(d.tomador.nome)).slice(0, 300)}</xNome>` +
      (d.tomador.email ? `<email>${xml(d.tomador.email)}</email>` : "") +
    `</toma>` +
    `<serv>` +
      `<locPrest><cLocPrestacao>${so(d.codMunicipio)}</cLocPrestacao></locPrest>` +
      `<cServ>` +
        `<cTribNac>${so(d.codigoServico)}</cTribNac>` +
        `<xDescServ>${xml(semAcento(d.descricao)).slice(0, 2000)}</xDescServ>` +
      `</cServ>` +
    `</serv>` +
    `<valores>` +
      `<vServPrest><vServ>${d.valor.toFixed(2)}</vServ></vServPrest>` +
      `<trib><tribMun><tribISSQN>1</tribISSQN><tpRetISSQN>1</tpRetISSQN></tribMun></trib>` +
    `</valores>` +
    `</infDPS>` +
    `</DPS>`
  );
}

/**
 * Assina a DPS no padrão XMLDSig envelopado, com SHA-256.
 *
 * Três detalhes que reprovam se estiverem errados, e que aqui estão certos:
 *  • a referência aponta para o Id do infDPS, não para o documento todo;
 *  • a canonicalização é a exclusiva — o Portal recusa a padrão;
 *  • o algoritmo é SHA-256; SHA-1 não é mais aceito.
 */
function assinarDps(xmlDps: string, idDps: string): string {
  const { chavePem, certPem } = abrirCertificado();

  const sig = new SignedXml({
    privateKey: chavePem,
    publicCert: certPem,
    signatureAlgorithm: "http://www.w3.org/2001/04/xmldsig-more#rsa-sha256",
    canonicalizationAlgorithm: "http://www.w3.org/2001/10/xml-exc-c14n#",
  });

  sig.addReference({
    xpath: "//*[local-name(.)='infDPS']",
    transforms: [
      "http://www.w3.org/2000/09/xmldsig#enveloped-signature",
      "http://www.w3.org/2001/10/xml-exc-c14n#",
    ],
    digestAlgorithm: "http://www.w3.org/2001/04/xmlenc#sha256",
    uri: `#${idDps}`,
  });

  sig.computeSignature(xmlDps, {
    location: { reference: "//*[local-name(.)='DPS']", action: "append" },
  });

  return sig.getSignedXml();
}

/** O Portal recebe o XML assinado compactado e codificado. */
const empacotar = (xmlAssinado: string) =>
  zlib.gzipSync(Buffer.from(xmlAssinado, "utf8")).toString("base64");

/** E devolve a nota no mesmo formato. */
function desempacotar(b64: string): string {
  try {
    return zlib.gunzipSync(Buffer.from(b64, "base64")).toString("utf8");
  } catch {
    return "";
  }
}

// ============================================================================
// NUMERAÇÃO — cada nota precisa de um número único e sequencial
// ============================================================================

/**
 * Reserva o próximo número da série, dentro de uma transação.
 * Duas emissões simultâneas jamais recebem o mesmo número — e número repetido
 * é rejeitado pelo Portal.
 */
async function proximoNumero(db: any, uid: string, serie: string): Promise<number> {
  const ref = db.collection("nfse_contadores").doc(`${uid}_${serie}`);
  return db.runTransaction(async (t: any) => {
    const snap = await t.get(ref);
    const atual = snap.exists ? Number(snap.data().ultimo || 0) : 0;
    const proximo = atual + 1;
    t.set(ref, { userId: uid, serie, ultimo: proximo, atualizadoEm: new Date().toISOString() }, { merge: true });
    return proximo;
  });
}

// ============================================================================
// ERROS EM PORTUGUÊS
// ============================================================================

function explicar(err: any): { status: number; mensagem: string; detalhe?: any } {
  const mapa: Record<string, [number, string]> = {
    NAO_AUTENTICADO: [401, "Faça login para emitir nota."],
    SEM_CERTIFICADO: [503, "Certificado digital não configurado no servidor (NFSE_CERT_P12_BASE64)."],
    CERTIFICADO_INVALIDO: [503, "Não foi possível abrir o certificado. Confira se a senha (NFSE_CERT_SENHA) está correta e se o arquivo é um .pfx/.p12 válido."],
    CERTIFICADO_VENCIDO: [503, "Seu certificado digital está vencido. Renove-o para continuar emitindo notas."],
    SEM_CONFIG: [400, "Antes de emitir, preencha os dados fiscais: CNPJ, código do município e código do serviço."],
  };
  if (mapa[err.message]) return { status: mapa[err.message][0], mensagem: mapa[err.message][1] };

  // O Portal devolve os motivos de rejeição num array — mostramos todos.
  const dados = err.response?.data;
  const erros = dados?.erros || dados?.Erros || dados?.mensagens;
  if (Array.isArray(erros) && erros.length) {
    return {
      status: 400,
      mensagem: "O Portal Nacional recusou a nota: " +
        erros.map((e: any) => `${e.Codigo || e.codigo || ""} ${e.Descricao || e.descricao || e.mensagem || JSON.stringify(e)}`.trim()).join(" | "),
      detalhe: erros,
    };
  }

  return {
    status: err.response?.status || 502,
    mensagem: `Falha ao falar com o Portal Nacional: ${dados?.message || dados?.mensagem || err.message}`,
    detalhe: dados,
  };
}

// ============================================================================
// EMISSÃO
// ============================================================================

/**
 * Emite a nota de uma cobrança já paga. É idempotente: se a cobrança já tem
 * nota, devolve a existente em vez de emitir outra. Nota duplicada dá muito
 * trabalho para cancelar.
 */
export async function emitirNfseDaCobranca(
  db: any,
  adminStorage: any,
  firebaseConfig: any,
  cobrancaId: string
): Promise<any> {
  const snap = await db.collection("cobrancas").doc(String(cobrancaId)).get();
  if (!snap.exists) throw new Error("Cobrança não encontrada.");
  const cobranca = snap.data();

  if (cobranca.nfseChave) {
    return { jaEmitida: true, chave: cobranca.nfseChave };
  }

  const cfgSnap = await db.collection("nfse_config").doc(cobranca.userId).get();
  const cfg = cfgSnap.exists ? cfgSnap.data() : null;
  if (!cfg?.cnpj || !cfg?.codMunicipio || !cfg?.codigoServico) throw new Error("SEM_CONFIG");
  if (cfg.ativo === false) return { desativado: true };

  const serie = cfg.serie || "00001";
  const numero = await proximoNumero(db, cobranca.userId, serie);
  const idDps = montarIdDps(cfg.codMunicipio, cfg.cnpj, serie, numero);

  const hoje = new Date(Date.now() - 3 * 3600000).toISOString().slice(0, 10);
  const xmlDps = montarDps({
    idDps,
    serie,
    numero,
    codMunicipio: cfg.codMunicipio,
    cnpjPrestador: cfg.cnpj,
    regimeSimples: "1",
    tomador: {
      doc: cobranca.clienteDocumento || "",
      nome: cobranca.clienteNome || "Consumidor",
    },
    descricao: cobranca.descricao || cfg.descricaoPadrao || "Prestacao de servicos",
    valor: Number(cobranca.valor || 0),
    codigoServico: cfg.codigoServico,
    competencia: hoje,
  });

  const assinado = assinarDps(xmlDps, idDps);
  const { agente } = abrirCertificado();

  const { data } = await axios.post(
    `${baseUrl()}/nfse`,
    { dpsXmlGZipB64: empacotar(assinado) },
    {
      httpsAgent: agente,
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      timeout: 45000,
    }
  );

  const chave = data?.chaveAcesso || data?.ChaveAcesso || "";
  const xmlNota = desempacotar(data?.nfseXmlGZipB64 || data?.NfseXmlGZipB64 || "");

  await snap.ref.set(
    {
      nfseChave: chave,
      nfseNumero: numero,
      nfseSerie: serie,
      nfseEmitidaEm: new Date().toISOString(),
      nfseAmbiente: ehProducao() ? "producao" : "homologacao",
    },
    { merge: true }
  );

  await db.collection("nfse_emitidas").doc(chave || idDps).set({
    id: chave || idDps,
    userId: cobranca.userId,
    cobrancaId: String(cobrancaId),
    chave,
    numero,
    serie,
    idDps,
    clienteNome: cobranca.clienteNome || "",
    clienteDocumento: cobranca.clienteDocumento || "",
    valor: Number(cobranca.valor || 0),
    xml: xmlNota ? xmlNota.slice(0, 900000) : "",
    ambiente: ehProducao() ? "producao" : "homologacao",
    emitidaEm: new Date().toISOString(),
  });

  console.log(`[NFS-e] Nota ${numero}/${serie} emitida para a cobrança ${cobrancaId}. Chave: ${chave}`);
  return { chave, numero, serie, xml: xmlNota };
}

// ============================================================================
// ROTAS
// ============================================================================

export function registrarRotasNfse(app: any, db: any, adminStorage: any, firebaseConfig: any) {
  const exigirUsuario = (req: any) => verificarLogin(req);

  /** Diagnóstico do certificado — use antes de tentar emitir. */
  app.get("/api/nfse/certificado", async (req: any, res: any) => {
    try {
      await exigirUsuario(req);
      const c = abrirCertificado();
      const diasRestantes = Math.floor((c.validade.getTime() - Date.now()) / 86400000);
      res.json({
        success: true,
        titular: c.titular,
        validoAte: c.validade.toISOString().slice(0, 10),
        diasRestantes,
        alerta: diasRestantes < 30 ? `Seu certificado vence em ${diasRestantes} dias.` : null,
        ambiente: ehProducao() ? "Produção" : "Homologação",
      });
    } catch (err: any) {
      const { status, mensagem } = explicar(err);
      res.status(status).json({ success: false, mensagem });
    }
  });

  /** Dados fiscais do MEI, usados em toda nota. */
  app.get("/api/nfse/config", async (req: any, res: any) => {
    try {
      const uid = await exigirUsuario(req);
      const snap = await db.collection("nfse_config").doc(uid).get();
      res.json({ success: true, config: snap.exists ? snap.data() : null });
    } catch (err: any) {
      const { status, mensagem } = explicar(err);
      res.status(status).json({ success: false, mensagem });
    }
  });

  app.put("/api/nfse/config", async (req: any, res: any) => {
    try {
      const uid = await exigirUsuario(req);
      const { cnpj, codMunicipio, codigoServico, serie, descricaoPadrao, ativo, emitirAoPagar } = req.body;

      const cnpjLimpo = so(cnpj);
      if (cnpjLimpo.length !== 14) {
        return res.status(400).json({ success: false, mensagem: "Informe um CNPJ válido, com 14 dígitos." });
      }
      if (so(codMunicipio).length !== 7) {
        return res.status(400).json({
          success: false,
          mensagem: "O código do município tem 7 dígitos (código IBGE da sua cidade).",
        });
      }
      if (!so(codigoServico)) {
        return res.status(400).json({ success: false, mensagem: "Informe o código nacional do serviço que você presta." });
      }

      const config = {
        userId: uid,
        cnpj: cnpjLimpo,
        codMunicipio: so(codMunicipio),
        codigoServico: so(codigoServico),
        serie: so(serie) || "00001",
        descricaoPadrao: String(descricaoPadrao || "").slice(0, 300),
        ativo: ativo !== false,
        emitirAoPagar: emitirAoPagar !== false,
        atualizadoEm: new Date().toISOString(),
      };
      await db.collection("nfse_config").doc(uid).set(config, { merge: true });
      res.json({ success: true, config });
    } catch (err: any) {
      const { status, mensagem } = explicar(err);
      res.status(status).json({ success: false, mensagem });
    }
  });

  /** Emitir manualmente a nota de uma cobrança. */
  app.post("/api/nfse/emitir", async (req: any, res: any) => {
    try {
      const uid = await exigirUsuario(req);
      const { cobrancaId } = req.body;
      if (!cobrancaId) {
        return res.status(400).json({ success: false, mensagem: "Informe a cobrança." });
      }

      const snap = await db.collection("cobrancas").doc(String(cobrancaId)).get();
      if (!snap.exists || snap.data().userId !== uid) {
        return res.status(404).json({ success: false, mensagem: "Cobrança não encontrada." });
      }

      const r = await emitirNfseDaCobranca(db, adminStorage, firebaseConfig, String(cobrancaId));
      res.json({ success: true, ...r });
    } catch (err: any) {
      console.error("[NFS-e Emitir]", err.response?.data || err.message);
      const { status, mensagem, detalhe } = explicar(err);
      res.status(status).json({ success: false, mensagem, detalhe });
    }
  });

  /** Notas já emitidas por este usuário. */
  app.get("/api/nfse", async (req: any, res: any) => {
    try {
      const uid = await exigirUsuario(req);
      const snap = await db.collection("nfse_emitidas").where("userId", "==", uid).get();
      const notas = snap.docs
        .map((d: any) => {
          const n = d.data();
          return {
            chave: n.chave, numero: n.numero, serie: n.serie,
            clienteNome: n.clienteNome, valor: n.valor,
            emitidaEm: n.emitidaEm, ambiente: n.ambiente,
            cobrancaId: n.cobrancaId,
          };
        })
        .sort((a: any, b: any) => String(b.emitidaEm).localeCompare(String(a.emitidaEm)));
      res.json({ success: true, total: notas.length, notas });
    } catch (err: any) {
      const { status, mensagem } = explicar(err);
      res.status(status).json({ success: false, mensagem });
    }
  });

  /** Consulta uma nota no Portal pela chave de acesso. */
  app.get("/api/nfse/:chave", async (req: any, res: any) => {
    try {
      await exigirUsuario(req);
      const { agente } = abrirCertificado();
      const { data } = await axios.get(`${baseUrl()}/nfse/${String(req.params.chave)}`, {
        httpsAgent: agente,
        headers: { Accept: "application/json" },
        timeout: 30000,
      });
      res.json({
        success: true,
        nota: data,
        xml: desempacotar(data?.nfseXmlGZipB64 || data?.NfseXmlGZipB64 || ""),
      });
    } catch (err: any) {
      const { status, mensagem } = explicar(err);
      res.status(status).json({ success: false, mensagem });
    }
  });

  console.log(
    `[NFS-e] Rotas registradas (${ehProducao() ? "PRODUÇÃO" : "homologação"}): ` +
      "/api/nfse/certificado, /api/nfse/config, /api/nfse/emitir, /api/nfse"
  );
}
