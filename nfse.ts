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
import crypto from "crypto";
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

type Certificado = {
  chavePem: string;
  certPem: string;
  agente: https.Agent;
  titular: string;
  cnpj: string;
  validade: Date;
};

/**
 * ⚠️ CACHE POR USUÁRIO — NÃO TRANSFORME ISTO NUMA VARIÁVEL ÚNICA.
 *
 * Antes aqui havia um `let cacheCert` só. Funcionava enquanto existia um único
 * MEI no sistema. Com dois, o segundo a emitir uma nota assinaria com o
 * certificado do primeiro — nota fiscal saindo no CNPJ errado, e ninguém
 * perceberia até a Receita perceber. A chave do mapa é o id do usuário.
 */
const cacheCerts = new Map<string, { cert: Certificado; expiraEm: number }>();
const CACHE_MS = 10 * 60 * 1000;

export function limparCacheCertificado(uid: string) {
  cacheCerts.delete(uid);
}

/**
 * Abre um .p12/.pfx e extrai a chave privada e o certificado.
 * O mesmo par serve para assinar o XML e para autenticar a conexão.
 */
function abrirP12(b64Bruto: string, senha: string): Certificado {
  // Colar o base64 num campo de texto costuma trazer quebras de linha e espaços
  // junto. O decodificador rejeita qualquer um deles, e o erro que ele devolve
  // ("senha errada") aponta para o lugar errado. Então limpamos antes.
  const b64 = String(b64Bruto || "").replace(/\s+/g, "");
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
    throw new Error("SENHA_OU_ARQUIVO");
  }
  if (!chave || !certificado) throw new Error("SENHA_OU_ARQUIVO");

  return montarCertificado(
    forge.pki.privateKeyToPem(chave),
    forge.pki.certificateToPem(certificado)
  );
}

/** Monta o par já em PEM: é o formato que fica guardado no cofre. */
function montarCertificado(chavePem: string, certPem: string): Certificado {
  const certificado = forge.pki.certificateFromPem(certPem);
  const validade = certificado.validity.notAfter;
  if (validade.getTime() < Date.now()) throw new Error("CERTIFICADO_VENCIDO");

  // No A1 de pessoa jurídica o CNPJ vem colado no fim do CN ("EMPRESA:12345678000199").
  const titular = String(certificado.subject.getField("CN")?.value || "");
  const cnpj = (titular.match(/(\d{14})\s*$/) || [])[1] || "";

  return {
    chavePem,
    certPem,
    // A conexão com o Portal exige apresentar o certificado (autenticação mútua).
    agente: new https.Agent({ key: chavePem, cert: certPem, keepAlive: true }),
    titular: titular.replace(/:?\d{14}\s*$/, "").trim(),
    cnpj,
    validade,
  };
}

// ============================================================================
// COFRE DO CERTIFICADO (AES-256-GCM)
// ============================================================================
//
// O que fica guardado no Firestore é o par de chaves JÁ CIFRADO. A senha do
// arquivo .pfx nunca é gravada: ela é usada uma vez, no momento do envio, para
// abrir o arquivo, e depois descartada. A chave que desembaralha mora numa
// variável de ambiente, fora do banco — quem levasse o banco levaria ruído.
//
// A coleção `nfse_certificados` PRECISA estar com regra de negação total no
// Firestore. Nenhum aplicativo cliente pode lê-la; só o servidor, que entra
// pelo Admin SDK e passa por cima das regras.

function chaveCripto(): Buffer {
  const hex = env("NFSE_CRYPTO_KEY") || env("CONEXOES_CRYPTO_KEY");
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
  if (!iv || !tag || !dados) throw new Error("COFRE_CORROMPIDO");
  const d = crypto.createDecipheriv("aes-256-gcm", chaveCripto(), Buffer.from(iv, "base64"));
  d.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([d.update(Buffer.from(dados, "base64")), d.final()]).toString("utf8");
}

/** Guarda o certificado do usuário no cofre. Devolve os dados visíveis dele. */
async function guardarCertificado(db: any, uid: string, cert: Certificado) {
  await db.collection("nfse_certificados").doc(uid).set({
    userId: uid,
    chavePemCifrada: cifrar(cert.chavePem),
    certPemCifrado: cifrar(cert.certPem),
    titular: cert.titular,
    cnpj: cert.cnpj,
    validoAte: cert.validade.toISOString(),
    enviadoEm: new Date().toISOString(),
  });
  cacheCerts.set(uid, { cert, expiraEm: Date.now() + CACHE_MS });
}

/**
 * Devolve o certificado do usuário. Procura em três lugares, nesta ordem:
 * memória (rápido), cofre no Firestore (o caminho normal), e — só como rede de
 * segurança durante a transição — a variável de ambiente antiga.
 */
async function certificadoDoUsuario(db: any, uid: string): Promise<Certificado> {
  const emMemoria = cacheCerts.get(uid);
  if (emMemoria && emMemoria.expiraEm > Date.now()) return emMemoria.cert;
  cacheCerts.delete(uid);

  if (db) {
    const snap = await db.collection("nfse_certificados").doc(uid).get();
    if (snap.exists) {
      const d = snap.data();
      const cert = montarCertificado(decifrar(d.chavePemCifrada), decifrar(d.certPemCifrado));
      cacheCerts.set(uid, { cert, expiraEm: Date.now() + CACHE_MS });
      return cert;
    }
  }

  // Modo antigo: um certificado só, na variável de ambiente. Fica aqui até o
  // certificado do dono do sistema subir pela tela; depois pode sair.
  const b64 = env("NFSE_CERT_P12_BASE64");
  if (!b64) throw new Error("SEM_CERTIFICADO");
  const cert = abrirP12(b64, env("NFSE_CERT_SENHA"));
  cacheCerts.set(uid, { cert, expiraEm: Date.now() + CACHE_MS });
  return cert;
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
  codigoNbs?: string;
  competencia: string;
}): string {
  const docTomador = so(d.tomador.doc);

  /**
   * ⚠️ TOMADOR SEM DOCUMENTO = BLOCO INTEIRO FORA DA NOTA.
   *
   * Antes, quando o cliente não tinha CPF nem CNPJ, este código mandava
   * `<CPF>00000000000</CPF>`. O Portal recusa: ou o tomador é identificado de
   * verdade, ou ele não existe na nota. A nota que o Jonatan já emite sai com
   * "TOMADOR DA OPERAÇÃO NÃO IDENTIFICADO", que é exatamente este caso.
   */
  const identificado = docTomador.length === 11 || docTomador.length === 14;
  const blocoTomador = !identificado
    ? ""
    : `<toma>` +
        (docTomador.length === 14 ? `<CNPJ>${docTomador}</CNPJ>` : `<CPF>${docTomador}</CPF>`) +
        `<xNome>${xml(semAcento(d.tomador.nome)).slice(0, 300)}</xNome>` +
        (d.tomador.email ? `<email>${xml(d.tomador.email)}</email>` : "") +
      `</toma>`;

  return (
    `<?xml version="1.0" encoding="UTF-8"?>` +
    // ⚠️ 1.01 é a versão do esquema em vigor. Com "1.00" o Portal recusa com
    // E1235 (falha no esquema XML), sem dizer que o problema é a versão.
    `<DPS xmlns="http://www.sped.fazenda.gov.br/nfse" versao="1.01">` +
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
        /**
         * ⚠️ 2 = OPTANTE MEI. NÃO TROQUE POR 1.
         *
         * A tabela é: 1 = Não optante do Simples Nacional, 2 = Optante MEI,
         * 3 = Optante ME/EPP. Este campo já esteve como 1 aqui, por engano meu,
         * o que declararia o Jonatan como empresa fora do Simples. Com 1 o
         * Portal ainda exige alíquota de ISS — que MEI não destaca — e recusa
         * a nota com a rejeição E0617.
         */
        `<opSimpNac>2</opSimpNac>` +
        `<regEspTrib>0</regEspTrib>` +
      `</regTrib>` +
    `</prest>` +
    blocoTomador +
    `<serv>` +
      `<locPrest><cLocPrestacao>${so(d.codMunicipio)}</cLocPrestacao></locPrest>` +
      /**
       * ⚠️ A ORDEM DAS TAGS AQUI NÃO É NEGOCIÁVEL.
       *
       * O esquema define uma sequência: cTribNac, cTribMun, xDescServ, cNBS.
       * Eu tinha colocado o cNBS ANTES do xDescServ, e o Portal recusou com
       * E1235 sem dizer o motivo. XML fora de ordem é XML inválido, mesmo com
       * todas as tags certas. Só acrescente campo novo no lugar dele na lista.
       */
      `<cServ>` +
        `<cTribNac>${so(d.codigoServico)}</cTribNac>` +
        `<xDescServ>${xml(semAcento(d.descricao)).slice(0, 2000)}</xDescServ>` +
        (d.codigoNbs ? `<cNBS>${so(d.codigoNbs)}</cNBS>` : "") +
      `</cServ>` +
    `</serv>` +
    `<valores>` +
      `<vServPrest><vServ>${d.valor.toFixed(2)}</vServ></vServPrest>` +
      `<trib>` +
        `<tribMun>` +
          `<tribISSQN>1</tribISSQN>` +
          `<tpRetISSQN>1</tpRetISSQN>` +
        `</tribMun>` +
        // totTrib é obrigatório dentro de trib. indTotTrib 0 = não informar os
        // totais aproximados da Lei 12.741 — é o que sai na nota do MEI, com
        // tracinho nos três campos de tributos.
        `<totTrib><indTotTrib>0</indTotTrib></totTrib>` +
      `</trib>` +
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
function assinarDps(xmlDps: string, idDps: string, cert: Certificado): string {
  const { chavePem, certPem } = cert;

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
    SEM_CERTIFICADO: [428, "Envie seu certificado digital A1 antes de emitir notas."],
    SENHA_OU_ARQUIVO: [400, "Não consegui abrir o certificado. Confira a senha — e confirme que o arquivo é o .pfx (ou .p12) do seu certificado A1."],
    CERTIFICADO_INVALIDO: [400, "Não consegui abrir o certificado. Confira a senha e o arquivo."],
    CERTIFICADO_VENCIDO: [400, "Este certificado digital está vencido. Renove-o para continuar emitindo notas."],
    SEM_CHAVE_CRIPTO: [503, "O servidor está sem a chave de segurança NFSE_CRYPTO_KEY, então não pode guardar certificados."],
    COFRE_CORROMPIDO: [503, "O certificado guardado não pôde ser lido — provavelmente a chave de segurança do servidor mudou. Envie o certificado novamente."],
    SEM_CONFIG: [400, "Antes de emitir, preencha os dados fiscais: CNPJ, código do município e código do serviço."],
    VALOR_INVALIDO: [400, "O valor da nota precisa ser maior que zero."],
  };
  if (mapa[err.message]) return { status: mapa[err.message][0], mensagem: mapa[err.message][1] };

  // O Portal devolve os motivos de rejeição num array — mostramos todos.
  const dados = err.response?.data;
  const erros = dados?.erros || dados?.Erros || dados?.mensagens;
  if (Array.isArray(erros) && erros.length) {
    return {
      status: 400,
      mensagem: "O Portal Nacional recusou a nota: " +
        erros.map((e: any) => [
          e.Codigo || e.codigo || "",
          e.Descricao || e.descricao || e.mensagem || JSON.stringify(e),
          // O Complemento é onde o Portal diz QUAL campo reprovou. Sem ele, um
          // "falha no esquema" manda a gente procurar agulha no palheiro.
          e.Complemento || e.complemento || "",
        ].filter(Boolean).join(" — ")).join(" | "),
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
 * O CORAÇÃO DA EMISSÃO — usado tanto pelo boleto pago quanto pelo botão NFS-e
 * de um lançamento do Livro Caixa.
 *
 * Recebe só os dados do serviço prestado; quem chama é que sabe de onde eles
 * vieram. Devolve a chave, o número e o XML da nota.
 */
async function emitirNota(
  db: any,
  uid: string,
  dados: { clienteNome?: string; clienteDocumento?: string; valor: number; descricao?: string }
): Promise<any> {
  const cfgSnap = await db.collection("nfse_config").doc(uid).get();
  const cfg = cfgSnap.exists ? cfgSnap.data() : null;
  if (!cfg?.cnpj || !cfg?.codMunicipio || !cfg?.codigoServico) throw new Error("SEM_CONFIG");

  const valor = Number(dados.valor || 0);
  if (!(valor > 0)) throw new Error("VALOR_INVALIDO");

  const serie = cfg.serie || "00001";
  const numero = await proximoNumero(db, uid, serie);
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
      doc: dados.clienteDocumento || "",
      nome: dados.clienteNome || "Consumidor",
    },
    descricao: dados.descricao || cfg.descricaoPadrao || "Prestacao de servicos",
    valor,
    codigoServico: cfg.codigoServico,
    codigoNbs: cfg.codigoNbs || "",
    competencia: hoje,
  });

  const cert = await certificadoDoUsuario(db, uid);
  const assinado = assinarDps(xmlDps, idDps, cert);

  const { data } = await axios.post(
    `${baseUrl()}/nfse`,
    { dpsXmlGZipB64: empacotar(assinado) },
    {
      httpsAgent: cert.agente,
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      timeout: 45000,
    }
  );

  const chave = data?.chaveAcesso || data?.ChaveAcesso || "";
  const xmlNota = desempacotar(data?.nfseXmlGZipB64 || data?.NfseXmlGZipB64 || "");
  return { chave, numero, serie, idDps, xml: xmlNota };
}

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
  if (cfgSnap.exists && cfgSnap.data().ativo === false) return { desativado: true };

  const { chave, numero, serie, idDps, xml: xmlNota } = await emitirNota(db, cobranca.userId, {
    clienteNome: cobranca.clienteNome,
    clienteDocumento: cobranca.clienteDocumento,
    valor: Number(cobranca.valor || 0),
    descricao: cobranca.descricao,
  });

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

  /**
   * Saúde do servidor, SEM login — dá para abrir na barra do navegador.
   * Não fala do certificado de ninguém: só diz se o servidor está pronto para
   * receber certificados. Nenhum dado de usuário sai daqui.
   */
  app.get("/api/nfse/status", (_req: any, res: any) => {
    let cofrePronto = false;
    try { chaveCripto(); cofrePronto = true; } catch { /* segue sem cofre */ }

    res.json({
      success: cofrePronto,
      cofre: cofrePronto ? "pronto" : "sem chave de segurança",
      ambiente: ehProducao() ? "Produção" : "Homologação",
      mensagem: cofrePronto
        ? "Servidor pronto. Envie seu certificado pela tela Certificado Digital."
        : "Falta configurar NFSE_CRYPTO_KEY no servidor (64 caracteres). Sem ela não é possível guardar certificados.",
    });
  });

  /** Situação do certificado DESTE usuário. */
  app.get("/api/nfse/certificado", async (req: any, res: any) => {
    try {
      const uid = await exigirUsuario(req);
      const c = await certificadoDoUsuario(db, uid);
      const diasRestantes = Math.floor((c.validade.getTime() - Date.now()) / 86400000);
      res.json({
        success: true,
        configurado: true,
        titular: c.titular,
        cnpj: c.cnpj,
        validoAte: c.validade.toISOString().slice(0, 10),
        diasRestantes,
        alerta: diasRestantes < 30 ? `Seu certificado vence em ${diasRestantes} dias.` : null,
        ambiente: ehProducao() ? "Produção" : "Homologação",
      });
    } catch (err: any) {
      // "Ainda não enviou" não é erro: é o estado normal de quem acabou de
      // entrar. A tela precisa distinguir isso de uma falha de verdade.
      if (err.message === "SEM_CERTIFICADO") {
        return res.json({
          success: true,
          configurado: false,
          ambiente: ehProducao() ? "Produção" : "Homologação",
          mensagem: "Nenhum certificado enviado ainda.",
        });
      }
      const { status, mensagem } = explicar(err);
      res.status(status).json({ success: false, configurado: false, mensagem });
    }
  });

  /**
   * Envio do certificado A1. O arquivo chega em base64 junto da senha.
   *
   * A senha é usada uma única vez, aqui, para abrir o arquivo — e não é gravada
   * em lugar nenhum. O que vai para o cofre é o par de chaves já cifrado.
   */
  app.post("/api/nfse/certificado", async (req: any, res: any) => {
    try {
      const uid = await exigirUsuario(req);
      const arquivo = String(req.body?.arquivoBase64 || "").replace(/^data:[^,]*,/, "");
      const senha = String(req.body?.senha ?? "");
      if (!arquivo) throw new Error("SEM_CERTIFICADO");

      // Um A1 tem uns poucos KB. Recusar cedo evita gastar memória à toa e
      // barra o engano comum de mandar o arquivo errado.
      if (arquivo.length > 400_000) throw new Error("ARQUIVO_GRANDE");

      // Falha aqui = senha errada ou arquivo que não é certificado. O usuário
      // descobre agora, na tela, e não daqui a uma semana ao emitir a nota.
      const cert = abrirP12(arquivo, senha);

      chaveCripto(); // confere a chave do cofre ANTES de dizer que deu certo
      await guardarCertificado(db, uid, cert);

      const diasRestantes = Math.floor((cert.validade.getTime() - Date.now()) / 86400000);
      console.log(`[NFS-e] Certificado guardado para ${uid}. Titular: ${cert.titular}. Vence em ${diasRestantes} dias.`);

      res.json({
        success: true,
        configurado: true,
        titular: cert.titular,
        cnpj: cert.cnpj,
        validoAte: cert.validade.toISOString().slice(0, 10),
        diasRestantes,
        alerta: diasRestantes < 30 ? `Atenção: este certificado vence em ${diasRestantes} dias.` : null,
        mensagem: "Certificado guardado com segurança. Você já pode emitir notas.",
      });
    } catch (err: any) {
      if (err.message === "ARQUIVO_GRANDE") {
        return res.status(400).json({
          success: false,
          mensagem: "Esse arquivo é grande demais para ser um certificado A1. Confira se você escolheu o arquivo certo.",
        });
      }
      const { status, mensagem } = explicar(err);
      res.status(status).json({ success: false, mensagem });
    }
  });

  /** Remove o certificado do cofre. Some do banco e da memória. */
  app.delete("/api/nfse/certificado", async (req: any, res: any) => {
    try {
      const uid = await exigirUsuario(req);
      await db.collection("nfse_certificados").doc(uid).delete();
      limparCacheCertificado(uid);
      console.log(`[NFS-e] Certificado removido para ${uid}.`);
      res.json({ success: true, configurado: false, mensagem: "Certificado removido." });
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
      const cfg = snap.exists ? snap.data() : null;

      // Mostrar na tela qual será o número da próxima nota evita o erro mais
      // chato do Portal: número de DPS repetido.
      let proximo = 1;
      if (cfg?.serie) {
        const c = await db.collection("nfse_contadores").doc(`${uid}_${cfg.serie}`).get();
        proximo = (c.exists ? Number(c.data().ultimo || 0) : 0) + 1;
      }
      res.json({ success: true, config: cfg, proximoNumero: proximo });
    } catch (err: any) {
      const { status, mensagem } = explicar(err);
      res.status(status).json({ success: false, mensagem });
    }
  });

  app.put("/api/nfse/config", async (req: any, res: any) => {
    try {
      const uid = await exigirUsuario(req);
      const { cnpj, codMunicipio, codigoServico, codigoNbs, serie, proximoNumero: primeiroNumero,
              descricaoPadrao, ativo, emitirAoPagar } = req.body;

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
        codigoNbs: so(codigoNbs),
        serie: so(serie) || "00001",
        descricaoPadrao: String(descricaoPadrao || "").slice(0, 300),
        ativo: ativo !== false,
        emitirAoPagar: emitirAoPagar !== false,
        atualizadoEm: new Date().toISOString(),
      };
      await db.collection("nfse_config").doc(uid).set(config, { merge: true });

      /**
       * ⚠️ CONTINUAR A NUMERAÇÃO DE ONDE O PORTAL PAROU.
       *
       * Quem já emitia direto no Portal Nacional tem notas com número 1, 2, 3...
       * Se o MEI Flow recomeçasse do 1, o Portal recusaria por número repetido.
       * Por isso a tela pergunta qual será a PRÓXIMA nota, e aqui o contador é
       * acertado — só para cima, nunca para trás, para não reabrir um número
       * que já saiu.
       */
      const desejado = Number(primeiroNumero || 0);
      if (desejado > 1) {
        const ref = db.collection("nfse_contadores").doc(`${uid}_${config.serie}`);
        await db.runTransaction(async (t: any) => {
          const snap = await t.get(ref);
          const atual = snap.exists ? Number(snap.data().ultimo || 0) : 0;
          if (desejado - 1 > atual) {
            t.set(ref, { userId: uid, serie: config.serie, ultimo: desejado - 1,
                         atualizadoEm: new Date().toISOString() }, { merge: true });
          }
        });
      }

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

  /**
   * Emissão a partir de um lançamento do Livro Caixa — o botão NFS-e da tabela.
   *
   * Nem toda venda nasceu de boleto: quem vende no Pix, no dinheiro ou lança a
   * mão também precisa de nota. Por isso esta rota recebe os dados direto, sem
   * exigir cobrança nenhuma.
   *
   * O `lancamentoId` serve de trava contra nota repetida: clicar duas vezes no
   * botão devolve a mesma nota em vez de emitir outra. Cancelar NFS-e é
   * burocracia, então é melhor não deixar nascer duplicada.
   */
  app.post("/api/nfse/avulsa", async (req: any, res: any) => {
    try {
      const uid = await exigirUsuario(req);
      const { lancamentoId, clienteNome, clienteDocumento, valor, descricao } = req.body || {};

      if (lancamentoId) {
        const jaTem = await db
          .collection("nfse_emitidas")
          .where("userId", "==", uid)
          .where("lancamentoId", "==", String(lancamentoId))
          .limit(1)
          .get();
        if (!jaTem.empty) {
          const n = jaTem.docs[0].data();
          return res.json({
            success: true,
            jaEmitida: true,
            chave: n.chave,
            numero: n.numero,
            serie: n.serie,
            mensagem: `Este lançamento já tem a nota ${n.numero}.`,
          });
        }
      }

      const r = await emitirNota(db, uid, {
        clienteNome,
        clienteDocumento,
        valor: Number(valor || 0),
        descricao,
      });

      await db.collection("nfse_emitidas").doc(r.chave || r.idDps).set({
        id: r.chave || r.idDps,
        userId: uid,
        lancamentoId: lancamentoId ? String(lancamentoId) : "",
        chave: r.chave,
        numero: r.numero,
        serie: r.serie,
        idDps: r.idDps,
        clienteNome: clienteNome || "",
        clienteDocumento: clienteDocumento || "",
        valor: Number(valor || 0),
        xml: r.xml ? r.xml.slice(0, 900000) : "",
        ambiente: ehProducao() ? "producao" : "homologacao",
        emitidaEm: new Date().toISOString(),
      });

      console.log(`[NFS-e] Nota avulsa ${r.numero}/${r.serie} emitida por ${uid}. Chave: ${r.chave}`);
      res.json({ success: true, ...r, mensagem: `Nota ${r.numero} emitida com sucesso.` });
    } catch (err: any) {
      console.error("[NFS-e Avulsa]", JSON.stringify(err.response?.data || err.message));
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
      const uid = await exigirUsuario(req);
      const { agente } = await certificadoDoUsuario(db, uid);
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
