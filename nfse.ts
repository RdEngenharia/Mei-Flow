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
import { desenharDanfse, type DadosDanfse, type ExtrasDanfse } from "./src/utils/danfsePdf.js";
import { carregarLogoBase64 } from "./src/utils/logoImagem.js";

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
  /** Vai no campo "Informações Complementares" da nota. */
  observacao?: string;
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
      /**
       * ⚠️ infoCompl É O ÚLTIMO FILHO DE serv. Não suba ele.
       *
       * A sequência é locPrest, cServ, comExt, obra, atvEvento, infoCompl. Como
       * não mandamos os do meio, ele fica logo depois do cServ — mas sempre
       * DEPOIS. É o campo que sai como "Informações Complementares" na nota.
       */
      (d.observacao
        ? `<infoCompl><xInfComp>${xml(semAcento(d.observacao)).slice(0, 2000)}</xInfComp></infoCompl>`
        : "") +
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
// LEITURA DO XML DA NOTA — a fonte da verdade
// ============================================================================
//
// A DANFSe tem que ser montada a partir do XML que o Portal devolveu, e não dos
// campos que a gente lembrou de guardar num documento à parte. Duas razões:
//
//  1. O NÚMERO DA NOTA NÃO É O NOSSO. Nós escolhemos o número da DPS (a
//     declaração). O Portal responde com o número da NFS-e, que é a sequência
//     dele por CNPJ e pode ser completamente diferente — a primeira nota do
//     MEI Flow saiu com DPS nº 1 e NFS-e nº 3. Imprimir o número errado faz o
//     cliente procurar uma nota que não existe.
//  2. Qualquer campo que a gente esqueça de copiar aparece vazio na folha, como
//     aconteceu com a descrição do serviço.
//
// Ler do XML resolve os dois de uma vez, e continua funcionando para notas
// emitidas antes de qualquer campo novo existir.

/** Tira o conteúdo de uma tag, ignorando prefixo de namespace. */
function tag(xml: string, nome: string): string {
  const m = xml.match(new RegExp(`<(?:\\w+:)?${nome}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:\\w+:)?${nome}>`));
  return m ? m[1].trim() : "";
}

/** Primeiro valor encontrado entre vários nomes possíveis. */
function tagQualquer(xml: string, nomes: string[]): string {
  for (const n of nomes) {
    const v = tag(xml, n);
    if (v) return v;
  }
  return "";
}

/**
 * Extrai da NFS-e tudo que a folha impressa precisa.
 *
 * Feito com busca por nome de tag, e não com um leitor de XML completo, porque
 * o layout varia de versão para versão e um leitor rígido quebraria a folha
 * inteira por causa de um campo novo. Aqui, campo que não existe volta vazio e
 * o resto continua saindo.
 */
export function lerDadosDaNota(xmlNota: string) {
  const x = String(xmlNota || "");

  // O bloco do prestador aparece como <emit> na NFS-e e como <prest> na DPS.
  const blocoPrest = tagQualquer(x, ["emit", "prest"]);
  const blocoToma = tag(x, "toma");
  const blocoServ = tag(x, "serv");
  const blocoValores = tag(x, "valores");
  const blocoCServ = tag(blocoServ, "cServ");
  const blocoInfoCompl = tag(blocoServ, "infoCompl");

  /**
   * ENDEREÇO DE VERIFICAÇÃO — o que vai dentro do QR Code.
   *
   * O formato do QR da DANFSe nacional não é publicado em lugar nenhum que eu
   * tenha conseguido confirmar; a folha oficial do Portal usa um token cifrado
   * próprio, que não dá para montar de fora. Então:
   *
   *   1. se o XML trouxer um link (alguns emissores trazem), usamos ele;
   *   2. senão, montamos o endereço da consulta pública com a chave.
   *
   * E, nos dois casos, a chave de 50 dígitos vai impressa em texto na folha —
   * esse é o caminho que funciona sempre, com ou sem câmera.
   */
  const chaveLida = tagQualquer(x, ["chaveAcesso", "ChaveAcesso"]);
  const linkNoXml = tagQualquer(x, ["link", "linkNFSe", "urlConsulta", "url"]);
  const linkVerificacao = /^https?:\/\//i.test(linkNoXml)
    ? linkNoXml
    : chaveLida
      ? `https://www.nfse.gov.br/consultapublica?chaveAcesso=${chaveLida}`
      : "";

  return {
    // O número que vale para o cliente é o da NFS-e.
    numeroNfse: tagQualquer(x, ["nNFSe", "nNFSE"]),
    linkVerificacao,
    numeroDps: tag(x, "nDPS"),
    serie: tag(x, "serie"),
    chave: chaveLida,
    emitidaEm: tagQualquer(x, ["dhProc", "dhEmi"]),
    competencia: tag(x, "dCompet"),
    ambiente: tag(x, "tpAmb") === "1" ? "producao" : "homologacao",

    prestador: {
      nome: tag(blocoPrest, "xNome"),
      cnpj: tagQualquer(blocoPrest, ["CNPJ", "CPF"]),
      inscricaoMunicipal: tag(blocoPrest, "IM"),
      fone: tag(blocoPrest, "fone"),
      email: tag(blocoPrest, "email"),
      logradouro: tag(blocoPrest, "xLgr"),
      numero: tag(blocoPrest, "nro"),
      bairro: tag(blocoPrest, "xBairro"),
      cep: tag(blocoPrest, "CEP"),
      municipio: tag(blocoPrest, "cMun"),
    },

    // Sem bloco <toma>, o Portal imprime "tomador não identificado".
    tomador: blocoToma
      ? {
          nome: tag(blocoToma, "xNome"),
          documento: tagQualquer(blocoToma, ["CNPJ", "CPF"]),
          email: tag(blocoToma, "email"),
        }
      : null,

    servico: {
      descricao: tag(blocoCServ, "xDescServ"),
      codigoTributacao: tag(blocoCServ, "cTribNac"),
      codigoNbs: tag(blocoCServ, "cNBS"),
      localPrestacao: tag(tag(blocoServ, "locPrest"), "cLocPrestacao"),
      informacoesComplementares: tag(blocoInfoCompl, "xInfComp"),
    },

    valores: {
      servico: Number(tag(tag(blocoValores, "vServPrest"), "vServ") || 0),
      recebido: Number(tag(tag(blocoValores, "vServPrest"), "vReceb") || 0),
      descontoIncondicionado: Number(tag(tag(blocoValores, "vDescCondIncond"), "vDescIncond") || 0),
      descontoCondicionado: Number(tag(tag(blocoValores, "vDescCondIncond"), "vDescCond") || 0),
      deducoes: Number(tag(tag(blocoValores, "vDedRed"), "vDR") || 0),
      liquido: Number(tagQualquer(x, ["vLiq", "vLiqNFSe"]) || 0),
      issRetido: tag(tag(tag(blocoValores, "trib"), "tribMun"), "tpRetISSQN") === "2",
      issTributavel: tag(tag(tag(blocoValores, "trib"), "tribMun"), "tribISSQN") === "1",
      aliquota: Number(tag(tag(tag(blocoValores, "trib"), "tribMun"), "pAliq") || 0),
      valorIss: Number(tagQualquer(x, ["vISSQN", "vIss"]) || 0),
      baseCalculo: Number(tagQualquer(x, ["vBC", "vBCISSQN"]) || 0),
      totalTributos: Number(tagQualquer(x, ["vTotTrib", "vTotTribFed"]) || 0),
    },
    /** Regime do prestador na data da competência — vira texto na folha. */
    regime: {
      opSimpNac: tag(tag(blocoPrest, "regTrib"), "opSimpNac"),
      regEspTrib: tag(tag(blocoPrest, "regTrib"), "regEspTrib"),
    },
  };
}

// ============================================================================
// ARQUIVO DIGITAL — a nota é documento de guarda obrigatória
// ============================================================================

/**
 * ⚠️ NOMES DOS MESES: PRECISAM SER IDÊNTICOS AOS DE ArquivoDigitalMei.tsx.
 *
 * A tela do Arquivo Digital filtra por comparação literal de texto
 * (`doc.mes === mesSelecionado`). Qualquer diferença — inclusive o cedilha de
 * "Março" — faz o documento ser salvo no banco e NÃO aparecer na pasta. O mesmo
 * cuidado existe no efi.ts, pelo mesmo motivo.
 */
const MESES = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
];

/**
 * Guarda um arquivo da nota no Arquivo Digital do MEI, na pasta do mês da
 * emissão.
 *
 * O XML é o documento fiscal de verdade e é de guarda obrigatória — deixá-lo só
 * numa coleção do banco é meio caminho. A DANFSe em PDF entra junto quando o
 * Portal fornece.
 *
 * Idempotente pela `referenciaId`: emitir de novo, ou um webhook repetido, não
 * cria segunda cópia.
 */
async function arquivarNaPasta(
  db: any,
  adminStorage: any,
  firebaseConfig: any,
  opts: {
    userId: string;
    conteudo: Buffer;
    nomeArquivo: string;
    contentType: string;
    quando: Date;
    referenciaId: string;
  }
) {
  if (!db || !adminStorage) return null;

  const jaExiste = await db
    .collection("documentos")
    .where("userId", "==", opts.userId)
    .where("referenciaId", "==", opts.referenciaId)
    .limit(1)
    .get();
  if (!jaExiste.empty) return jaExiste.docs[0].data();

  const ano = opts.quando.getFullYear();
  const mes = MESES[opts.quando.getMonth()];
  const docId = `doc_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
  const limpo = opts.nomeArquivo.replace(/[^a-zA-Z0-9.\-_]/g, "_");
  const storagePath = `usuarios/${opts.userId}/${ano}/${mes}/${limpo}`;
  const downloadUrl = `/api/documentos/download?path=${encodeURIComponent(storagePath)}`;

  const bucketName = firebaseConfig?.storageBucket || "mei-flow-692d9.firebasestorage.app";
  await adminStorage.bucket(bucketName).file(storagePath).save(opts.conteudo, {
    metadata: { contentType: opts.contentType },
  });

  const agora = new Date().toISOString();
  const meta = {
    id: docId,
    nome: opts.nomeArquivo,
    url: downloadUrl,
    downloadUrl,
    ano: Number(ano),  // NUMBER — a query do front usa where("ano","==",Number(...))
    mes,               // STRING por extenso
    criadoEm: agora,
    uploadedAt: agora,
    tamanho: opts.conteudo.length,
    tipo: opts.contentType,
    userId: opts.userId,
    storagePath,
    isSimulated: false,
    origem: "nfse",
    referenciaId: opts.referenciaId,
    automatico: true,
  };
  await db.collection("documentos").doc(docId).set(meta);
  console.log(`[NFS-e] Arquivado em ${mes}/${ano}: ${opts.nomeArquivo}`);
  return meta;
}

/**
 * Monta a DANFSe em PDF aqui no servidor.
 *
 * É o mesmo desenho que a tela usa — o arquivo danfsePdf.ts é compartilhado.
 * Fazer no servidor é o que permite guardar o PDF no Arquivo Digital junto do
 * XML, sem depender de o usuário abrir a nota no navegador.
 *
 * Nunca lança: nota emitida não pode falhar por causa do PDF.
 */
async function montarDanfsePdf(
  db: any,
  uid: string,
  dados: DadosDanfse,
  municipio?: string
): Promise<Buffer | null> {
  try {
    const { jsPDF } = await import("jspdf");
    const QRCode = (await import("qrcode")).default;

    const extras: ExtrasDanfse = { municipio };

    // Logo e nome de exibição vêm do perfil do MEI.
    try {
      const perfil = await db.collection("users").doc(uid).get();
      if (perfil.exists) {
        const u = perfil.data();
        extras.nomeExibicao = u.meiName || u.nomeComercial || u.razaoSocial || undefined;
        /**
         * ⚠️ A LOGO CHEGA COMO URL, NÃO COMO BASE64.
         *
         * A versão anterior desta linha só aceitava logo começando com
         * "data:image". Parecia razoável — era assim que o MEI Flow guardava.
         * Só que a logo passou a ir para o Firebase Storage (o Firestore tem
         * teto de ~1 MiB por documento e a imagem estourava esse limite,
         * travando qualquer edição de perfil), e desde então `companyLogo` é
         * uma URL. Resultado: a condição nunca era verdadeira e TODA nota saía
         * sem logo, exatamente como o usuário relatou.
         *
         * `carregarLogoBase64` aceita as duas formas e nunca lança.
         */
        extras.logoBase64 = await carregarLogoBase64(u.companyLogo || u.logoUrl);
      }
    } catch { /* segue sem logo */ }

    // Endereço e telefone do tomador saem do cadastro de clientes: o Portal
    // não recebe esses campos na DPS hoje.
    const docTomador = so(dados.tomador?.documento);
    if (docTomador) {
      try {
        const cli = await db.collection("customers")
          .where("userId", "==", uid).where("cpfCnpj", "==", docTomador).limit(1).get();
        const achado = cli.empty
          ? (await db.collection("customers").where("userId", "==", uid).get()).docs
              .find((c: any) => so(c.data().cpfCnpj) === docTomador)
          : cli.docs[0];
        if (achado) {
          const c = achado.data();
          extras.tomadorEndereco = c.endereco || undefined;
          extras.tomadorTelefone = c.telefone || undefined;
          extras.tomadorEmail = c.email || undefined;
        }
      } catch { /* sem cadastro, a folha diz "não informado" */ }
    }

    if (dados.chave) {
      extras.qrBase64 = await QRCode.toDataURL(
        `https://www.nfse.gov.br/consultapublica?chaveAcesso=${dados.chave}`,
        { margin: 0, width: 300, errorCorrectionLevel: "M" }
      );
    }

    const doc = new jsPDF({ unit: "mm", format: "a4" });
    desenharDanfse(doc, dados, extras);
    return Buffer.from(doc.output("arraybuffer"));
  } catch (err: any) {
    console.error("[NFS-e] Não consegui montar o PDF da nota:", err.message);
    return null;
  }
}

/**
 * Tenta baixar a DANFSe pronta do Portal.
 *
 * ⚠️ Este endereço NÃO está no manual oficial dos contribuintes — o manual
 * documenta só o XML (`GET /nfse/{chave}`). O caminho da DANFSe aparece em
 * relatos e em serviços intermediários, então tratamos como opcional: se
 * responder um PDF, ótimo; se não, o próprio MEI Flow monta a DANFSe a partir
 * do XML, que é o que realmente importa guardar.
 *
 * Nunca lança: falha aqui não pode derrubar uma emissão que já deu certo.
 */
async function baixarDanfseOficial(cert: Certificado, chave: string): Promise<Buffer | null> {
  if (!chave) return null;
  const caminhos = [`${baseUrl()}/danfse/${chave}`, `${baseUrl()}/nfse/${chave}/danfse`];
  for (const url of caminhos) {
    try {
      const r = await axios.get(url, {
        httpsAgent: cert.agente,
        responseType: "arraybuffer",
        headers: { Accept: "application/pdf" },
        timeout: 30000,
        validateStatus: () => true,
      } as any);
      const buf = Buffer.from(r.data || []);
      // %PDF- é a assinatura de um PDF. Sem ela, o que voltou foi um JSON de
      // erro disfarçado de sucesso.
      if (r.status === 200 && buf.length > 1000 && buf.subarray(0, 5).toString() === "%PDF-") {
        return buf;
      }
    } catch {
      // Endereço inexistente, timeout, certificado recusado — segue para o próximo.
    }
  }
  return null;
}

// ============================================================================
// NUMERAÇÃO — cada nota precisa de um número único e sequencial
// ============================================================================

/**
 * ⚠️ CADA AMBIENTE TEM O SEU CONTADOR. NÃO JUNTE OS DOIS.
 *
 * Homologação e produção são mundos separados no Portal, com numerações
 * independentes. O contador aqui era um só por série — então cada teste em
 * homologação queimava um número da produção, e a primeira nota real sairia
 * com o número 5 ou 10, deixando buraco na sequência fiscal. Buraco em
 * numeração de nota é a primeira coisa que um fiscal repara.
 *
 * O ambiente entra no nome do documento. Nota de teste some junto com o
 * ambiente de teste, e a produção começa limpa no 1.
 */
function refContador(db: any, uid: string, serie: string) {
  const ambiente = ehProducao() ? "producao" : "homologacao";
  return db.collection("nfse_contadores").doc(`${uid}_${serie}_${ambiente}`);
}

/**
 * Reserva o próximo número da série, dentro de uma transação.
 * Duas emissões simultâneas jamais recebem o mesmo número — e número repetido
 * é rejeitado pelo Portal.
 */
async function proximoNumero(db: any, uid: string, serie: string): Promise<number> {
  const ref = refContador(db, uid, serie);
  return db.runTransaction(async (t: any) => {
    const snap = await t.get(ref);
    const atual = snap.exists ? Number(snap.data().ultimo || 0) : 0;
    const proximo = atual + 1;
    t.set(ref, {
      userId: uid, serie, ultimo: proximo,
      ambiente: ehProducao() ? "producao" : "homologacao",
      atualizadoEm: new Date().toISOString(),
    }, { merge: true });
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
    SEM_CONFIG: [400, "Antes de emitir, preencha seus dados fiscais na tela de Nota Fiscal."],
    XML_INDISPONIVEL: [404, "Não encontrei o XML desta nota, nem aqui nem no Portal."],
    SEM_SERVICO: [400, "Cadastre o serviço que você presta na tela de Nota Fiscal — é uma vez só."],
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
  adminStorage: any,
  firebaseConfig: any,
  uid: string,
  dados: {
    clienteNome?: string;
    clienteDocumento?: string;
    valor: number;
    descricao?: string;
    /** Código do serviço pré-configurado que o usuário escolheu na hora. */
    servicoId?: string;
    /** Informações complementares desta nota, já ajustadas pelo usuário. */
    observacao?: string;
  }
): Promise<any> {
  const cfgSnap = await db.collection("nfse_config").doc(uid).get();
  const cfg = cfgSnap.exists ? cfgSnap.data() : null;
  if (!cfg?.cnpj || !cfg?.codMunicipio) throw new Error("SEM_CONFIG");

  /**
   * QUAL SERVIÇO USAR.
   *
   * A empresa pode ter dois CNAEs e prestar serviços diferentes — o eletricista
   * que também vende projeto, a cabeleireira que também faz estética. Então o
   * usuário pré-configura os serviços dele, com o apelido que quiser, e na hora
   * de emitir só escolhe o nome. Aqui a gente resolve: o que ele escolheu, ou o
   * marcado como habitual, ou o único que existe.
   *
   * O último `||` é a compatibilidade com quem configurou antes desta tela
   * existir, quando havia um código só, solto na configuração.
   */
  const servicos: any[] = Array.isArray(cfg.servicos) ? cfg.servicos : [];
  const servico =
    servicos.find((s) => so(s.codigo) === so(dados.servicoId)) ||
    servicos.find((s) => s.padrao) ||
    servicos[0] ||
    { codigo: cfg.codigoServico, nbs: cfg.codigoNbs, descricao: cfg.descricaoPadrao };

  if (!so(servico?.codigo)) throw new Error("SEM_SERVICO");

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
    descricao: dados.descricao || servico.descricao || cfg.descricaoPadrao || "Prestacao de servicos",
    valor,
    codigoServico: servico.codigo,
    codigoNbs: servico.nbs || "",
    observacao: dados.observacao || "",
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

  /**
   * ⚠️ NÚMERO DA NOTA ≠ NÚMERO DA DPS.
   *
   * `numero` acima é o da DPS, que nós escolhemos. O número que o cliente vê e
   * cita é o da NFS-e, que o Portal atribui na sequência dele por CNPJ. Na
   * primeira nota do MEI Flow deu DPS 1 e NFS-e 3.
   */
  const numeroNfse = Number(lerDadosDaNota(xmlNota).numeroNfse || 0) || 0;

  /**
   * ARQUIVAMENTO AUTOMÁTICO — a partir daqui nada pode derrubar a emissão.
   *
   * A nota já existe no Portal. Se o arquivamento falhar, o pior cenário é o
   * documento não aparecer na pasta do mês — e não uma nota emitida que o
   * usuário acha que não saiu. Por isso tudo daqui para baixo é try/catch.
   */
  let danfseB64 = "";
  try {
    const quando = new Date();

    /**
     * ⚠️ O NOME DO ARQUIVO USA O NÚMERO DA NFS-e, NÃO O DA DPS.
     *
     * Com o número da DPS, a nota 1 de homologação e a nota 1 de produção
     * geravam arquivos com o MESMO nome na pasta — pareciam duplicatas e não
     * havia como distinguir. O número da NFS-e é único por CNPJ.
     */
    const rotulo = `NFSe_${numeroNfse || numero}_${serie}`;

    /**
     * ⚠️ ARQUIVO DIGITAL É SÓ PARA DOCUMENTO FISCAL DE VERDADE.
     *
     * Nota de homologação não existe para a Receita. Guardá-la na pasta dos
     * cinco anos suja a guarda fiscal: na hora de conferir, o contador vê
     * documentos que não valem nada misturados com os que valem — e alguns com
     * o mesmo nome. Teste fica de fora, ponto.
     */
    if (!ehProducao()) {
      console.log(`[NFS-e] Nota ${rotulo} é de homologação: não vai para o Arquivo Digital.`);
    } else if (xmlNota) {
      await arquivarNaPasta(db, adminStorage, firebaseConfig, {
        userId: uid,
        conteudo: Buffer.from(xmlNota, "utf8"),
        nomeArquivo: `${rotulo}.xml`,
        contentType: "application/xml",
        quando,
        referenciaId: `nfse_xml_${chave || idDps}`,
      });
    }

    /**
     * O PDF vai para a pasta junto do XML.
     *
     * Preferimos a DANFSe oficial do Portal quando ela existe; senão, montamos
     * a nossa. Nos dois casos o usuário abre a pasta do mês e vê a nota, em vez
     * de encontrar só um XML que o navegador mostra como texto cru.
     */
    if (ehProducao()) {
      const pdf = (await baixarDanfseOficial(cert, chave))
        || (await montarDanfsePdf(db, uid, lerDadosDaNota(xmlNota), cfg.municipio));
      if (pdf) {
        danfseB64 = pdf.toString("base64");
        await arquivarNaPasta(db, adminStorage, firebaseConfig, {
          userId: uid,
          conteudo: pdf,
          nomeArquivo: `${rotulo}.pdf`,
          contentType: "application/pdf",
          quando,
          referenciaId: `nfse_pdf_${chave || idDps}`,
        });
      }
    }
  } catch (err: any) {
    console.error("[NFS-e] Nota emitida, mas o arquivamento falhou:", err.message);
  }

  return {
    chave, numero, numeroNfse, serie, idDps, xml: xmlNota,
    danfseB64,
    servicoApelido: servico.apelido || "",
    servicoCodigo: so(servico.codigo),
    descricaoServico: dados.descricao || servico.descricao || cfg.descricaoPadrao || "",
  };
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

  /**
   * ⚠️ "JÁ EMITIDA" SÓ VALE DENTRO DO MESMO AMBIENTE.
   *
   * A nota de teste que essa cobrança recebeu em homologação não é nota: não
   * existe para a Receita. Se a travinha ignorasse o ambiente, o teste
   * bloquearia a emissão real para sempre, e o usuário ficaria sem entender por
   * que "já está emitida" sem nunca ter havido nota de verdade.
   */
  const ambienteAtual = ehProducao() ? "producao" : "homologacao";
  if (cobranca.nfseChave && (cobranca.nfseAmbiente || "homologacao") === ambienteAtual) {
    return { jaEmitida: true, chave: cobranca.nfseChave };
  }

  const cfgSnap = await db.collection("nfse_config").doc(cobranca.userId).get();
  if (cfgSnap.exists && cfgSnap.data().ativo === false) return { desativado: true };

  const { chave, numero, serie, idDps, xml: xmlNota } = await emitirNota(db, adminStorage, firebaseConfig, cobranca.userId, {
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
        const c = await refContador(db, uid, cfg.serie).get();
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
              descricaoPadrao, ativo, emitirAoPagar, servicos } = req.body;

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
      /**
       * SERVIÇOS PRÉ-CONFIGURADOS.
       *
       * Chegam como lista: apelido que o usuário deu, código nacional, NBS e a
       * descrição que sai na nota. Um deles é o habitual. O `codigoServico`
       * solto continua sendo gravado a partir do habitual, para não quebrar
       * quem já tinha configurado antes desta lista existir.
       */
      const listaServicos = (Array.isArray(servicos) ? servicos : [])
        .map((s: any) => ({
          codigo: so(s?.codigo),
          apelido: String(s?.apelido || "").slice(0, 60),
          nbs: so(s?.nbs),
          descricao: String(s?.descricao || "").slice(0, 300),
          padrao: s?.padrao === true,
        }))
        .filter((s: any) => s.codigo.length >= 4);

      // Códigos repetidos viram confusão na hora de escolher — mantemos o primeiro.
      const vistos = new Set<string>();
      const servicosLimpos = listaServicos.filter((s: any) => {
        if (vistos.has(s.codigo)) return false;
        vistos.add(s.codigo);
        return true;
      });

      // Alguém tem que ser o habitual, senão emitir sem escolher não sabe o que usar.
      if (servicosLimpos.length && !servicosLimpos.some((s: any) => s.padrao)) {
        servicosLimpos[0].padrao = true;
      }

      const habitual = servicosLimpos.find((s: any) => s.padrao);
      const codigoFinal = habitual?.codigo || so(codigoServico);
      if (!codigoFinal) {
        return res.status(400).json({
          success: false,
          mensagem: "Cadastre pelo menos um serviço — é o que diz ao Portal o que você presta.",
        });
      }

      /**
       * ⚠️ A SÉRIE TEM FAIXA POR TIPO DE EMISSOR.
       *
       * O Portal divide as séries: 1 a 49999 para sistema próprio (é o nosso
       * caso), 80000 a 99999 para a versão antiga da integração, e a faixa do
       * meio, 50000 a 79999, é reservada ao emissor do próprio governo — web e
       * aplicativo. Quem já emitia no Portal tem nota com série tipo 70000 e
       * copia esse número para cá, o que devolve a rejeição E0010.
       *
       * Barramos aqui para o usuário não descobrir isso só na hora de emitir.
       */
      const serieNum = Number(so(serie) || 0);
      if (serieNum >= 50000 && serieNum <= 79999) {
        return res.status(400).json({
          success: false,
          mensagem: `A série ${so(serie)} é reservada ao emissor do próprio governo — o Portal recusa notas com ela vindas de outro sistema. Use uma série sua, entre 1 e 49999 (por exemplo 00001). A numeração dessa série nova começa do 1.`,
        });
      }
      if (serieNum > 99999) {
        return res.status(400).json({ success: false, mensagem: "A série vai no máximo até 99999." });
      }

      const config = {
        userId: uid,
        cnpj: cnpjLimpo,
        codMunicipio: so(codMunicipio),
        servicos: servicosLimpos,
        codigoServico: codigoFinal,
        codigoNbs: habitual ? habitual.nbs : so(codigoNbs),
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
        const ref = refContador(db, uid, config.serie);
        await db.runTransaction(async (t: any) => {
          const snap = await t.get(ref);
          const atual = snap.exists ? Number(snap.data().ultimo || 0) : 0;
          if (desejado - 1 > atual) {
            t.set(ref, {
              userId: uid, serie: config.serie, ultimo: desejado - 1,
              ambiente: ehProducao() ? "producao" : "homologacao",
              atualizadoEm: new Date().toISOString(),
            }, { merge: true });
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
      const { lancamentoId, clienteNome, clienteDocumento, valor, descricao, servicoId,
              observacao } = req.body || {};

      if (lancamentoId) {
        // O ambiente entra na busca pelo mesmo motivo da cobrança: nota de
        // teste não pode impedir a nota real do mesmo lançamento.
        const jaTem = await db
          .collection("nfse_emitidas")
          .where("userId", "==", uid)
          .where("lancamentoId", "==", String(lancamentoId))
          .where("ambiente", "==", ehProducao() ? "producao" : "homologacao")
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

      const r = await emitirNota(db, adminStorage, firebaseConfig, uid, {
        clienteNome,
        clienteDocumento,
        valor: Number(valor || 0),
        descricao,
        servicoId,
        observacao,
      });

      await db.collection("nfse_emitidas").doc(r.chave || r.idDps).set({
        id: r.chave || r.idDps,
        userId: uid,
        lancamentoId: lancamentoId ? String(lancamentoId) : "",
        chave: r.chave,
        numero: r.numero,
        numeroNfse: r.numeroNfse || 0,
        serie: r.serie,
        idDps: r.idDps,
        clienteNome: clienteNome || "",
        clienteDocumento: clienteDocumento || "",
        valor: Number(valor || 0),
        observacao: String(observacao || "").slice(0, 2000),
        descricaoServico: r.descricaoServico || "",
        servicoCodigo: r.servicoCodigo || "",
        servicoApelido: r.servicoApelido || "",
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
      // Só as notas do ambiente atual. Misturar teste com real numa lista de
      // documento fiscal é convite para alguém contar errado.
      const ambienteAtual = ehProducao() ? "producao" : "homologacao";
      const snap = await db.collection("nfse_emitidas")
        .where("userId", "==", uid)
        .where("ambiente", "==", ambienteAtual)
        .get();
      const notas = snap.docs
        .map((d: any) => {
          const n = d.data();
          return {
            chave: n.chave, numero: n.numero,
            numeroNfse: n.numeroNfse || 0,
            serie: n.serie,
            clienteNome: n.clienteNome, clienteDocumento: n.clienteDocumento || "",
            valor: n.valor,
            descricaoServico: n.descricaoServico || "",
            servicoCodigo: n.servicoCodigo || "",
            observacao: n.observacao || "",
            emitidaEm: n.emitidaEm, ambiente: n.ambiente,
            cobrancaId: n.cobrancaId || "", lancamentoId: n.lancamentoId || "",
            temXml: !!n.xml,
          };
        })
        .sort((a: any, b: any) => String(b.emitidaEm).localeCompare(String(a.emitidaEm)));
      res.json({ success: true, ambiente: ambienteAtual, total: notas.length, notas });
    } catch (err: any) {
      const { status, mensagem } = explicar(err);
      res.status(status).json({ success: false, mensagem });
    }
  });

  /**
   * XML da nota — o documento fiscal de verdade, de guarda obrigatória.
   *
   * Serve o que está guardado; só vai ao Portal se por algum motivo não tivermos
   * a cópia. Devolve como arquivo, para o navegador oferecer o download.
   */
  app.get("/api/nfse/:chave/xml", async (req: any, res: any) => {
    try {
      const uid = await exigirUsuario(req);
      const chave = String(req.params.chave);

      const snap = await db.collection("nfse_emitidas").doc(chave).get();
      let xmlNota = snap.exists && snap.data().userId === uid ? snap.data().xml : "";

      if (!xmlNota) {
        const { agente } = await certificadoDoUsuario(db, uid);
        const { data } = await axios.get(`${baseUrl()}/nfse/${chave}`, {
          httpsAgent: agente,
          headers: { Accept: "application/json" },
          timeout: 30000,
        });
        xmlNota = desempacotar(data?.nfseXmlGZipB64 || data?.NfseXmlGZipB64 || "");
      }
      if (!xmlNota) throw new Error("XML_INDISPONIVEL");

      res.setHeader("Content-Type", "application/xml; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="NFSe_${chave}.xml"`);
      res.send(xmlNota);
    } catch (err: any) {
      const { status, mensagem } = explicar(err);
      res.status(status).json({ success: false, mensagem });
    }
  });

  /**
   * DANFSe pronta do Portal, quando existir.
   *
   * Devolve JSON com o PDF em base64 em vez dos bytes crus, para a tela poder
   * decidir: se vier, mostra o PDF oficial; se não vier, monta a DANFSe aqui a
   * partir dos dados da nota. Nunca é erro não ter — é o caso normal.
   */
  app.get("/api/nfse/:chave/danfse", async (req: any, res: any) => {
    try {
      const uid = await exigirUsuario(req);
      const chave = String(req.params.chave);

      const snap = await db.collection("nfse_emitidas").doc(chave).get();
      if (!snap.exists || snap.data().userId !== uid) {
        return res.status(404).json({ success: false, mensagem: "Nota não encontrada." });
      }

      const cert = await certificadoDoUsuario(db, uid);
      const pdf = await baixarDanfseOficial(cert, chave);
      if (!pdf) {
        return res.json({
          success: false,
          mensagem: "O Portal não forneceu a DANFSe pronta. O MEI Flow monta a sua.",
        });
      }
      res.json({ success: true, pdfBase64: pdf.toString("base64") });
    } catch (err: any) {
      const { status, mensagem } = explicar(err);
      res.status(status).json({ success: false, mensagem });
    }
  });

  /**
   * Dados da nota lidos do XML — é com isto que a folha impressa é montada.
   *
   * Preferimos o XML guardado; se por algum motivo não tivermos, buscamos no
   * Portal. Assim a folha sai correta até para notas emitidas antes de qualquer
   * campo novo existir no banco.
   */
  app.get("/api/nfse/:chave/dados", async (req: any, res: any) => {
    try {
      const uid = await exigirUsuario(req);
      const chave = String(req.params.chave);

      const snap = await db.collection("nfse_emitidas").doc(chave).get();
      const registro = snap.exists && snap.data().userId === uid ? snap.data() : null;
      let xmlNota = registro?.xml || "";

      if (!xmlNota) {
        const { agente } = await certificadoDoUsuario(db, uid);
        const { data } = await axios.get(`${baseUrl()}/nfse/${chave}`, {
          httpsAgent: agente,
          headers: { Accept: "application/json" },
          timeout: 30000,
        });
        xmlNota = desempacotar(data?.nfseXmlGZipB64 || data?.NfseXmlGZipB64 || "");
      }
      if (!xmlNota) throw new Error("XML_INDISPONIVEL");

      const dados = lerDadosDaNota(xmlNota);
      res.json({
        success: true,
        dados,
        // O registro serve de reserva para o que o XML não trouxer.
        registro: registro
          ? {
              clienteNome: registro.clienteNome || "",
              clienteDocumento: registro.clienteDocumento || "",
              valor: Number(registro.valor || 0),
              observacao: registro.observacao || "",
              ambiente: registro.ambiente || "",
            }
          : null,
      });
    } catch (err: any) {
      const { status, mensagem } = explicar(err);
      res.status(status).json({ success: false, mensagem });
    }
  });

  /**
   * Arquiva no Arquivo Digital as notas que ficaram de fora.
   *
   * POR QUE ISTO EXISTE: o arquivamento automático só passou a rodar depois que
   * as primeiras notas já tinham saído. Sem um reparo, o XML delas — que é o
   * documento de guarda obrigatória — ficaria só numa coleção do banco, fora da
   * pasta do mês, para sempre.
   *
   * Também serve de rede se algum arquivamento falhar no futuro: rodar de novo
   * não duplica nada, porque `arquivarNaPasta` ignora o que já existe.
   */
  app.post("/api/nfse/arquivar-pendentes", async (req: any, res: any) => {
    try {
      const uid = await exigirUsuario(req);
      const snap = await db.collection("nfse_emitidas").where("userId", "==", uid).get();

      let arquivadas = 0;
      let pdfs = 0;
      let ignoradasTeste = 0;
      let semXml = 0;
      let removidasTeste = 0;
      const problemas: string[] = [];

      // O município entra na folha impressa; lido uma vez só, fora do laço.
      const cfgSnap = await db.collection("nfse_config").doc(uid).get();
      const municipioCfg = cfgSnap.exists ? cfgSnap.data()?.municipio : undefined;

      for (const doc of snap.docs) {
        const n = doc.data();
        const chave = n.chave || n.id;
        const ehTeste = String(n.ambiente || "").startsWith("homolog");

        /**
         * LIMPEZA: tira do Arquivo Digital o que nunca deveria ter entrado.
         *
         * A primeira versão deste reparo arquivou tudo, inclusive as notas de
         * homologação. Elas não valem nada para a Receita e ainda apareciam com
         * o mesmo nome das reais, parecendo duplicata. Aqui elas saem.
         */
        if (ehTeste) {
          ignoradasTeste++;
          for (const ref of [`nfse_xml_${chave}`, `nfse_pdf_${chave}`]) {
            const lixo = await db
              .collection("documentos")
              .where("userId", "==", uid)
              .where("referenciaId", "==", ref)
              .get();
            for (const alvo of lixo.docs) {
              try {
                const meta = alvo.data();
                if (meta.storagePath) {
                  const bucket = firebaseConfig?.storageBucket || "mei-flow-692d9.firebasestorage.app";
                  await adminStorage.bucket(bucket).file(meta.storagePath).delete().catch(() => {});
                }
                await alvo.ref.delete();
                removidasTeste++;
              } catch { /* se não sair agora, sai na próxima */ }
            }
          }
          continue;
        }

        if (!n.xml) { semXml++; continue; }

        // A pasta é a do mês em que a nota foi emitida, e não a de hoje —
        // arquivar tudo em agosto bagunçaria a conferência do contador.
        const quando = new Date(n.emitidaEm || Date.now());
        const rotulo = `NFSe_${n.numeroNfse || n.numero}_${n.serie}`;
        try {
          await arquivarNaPasta(db, adminStorage, firebaseConfig, {
            userId: uid,
            conteudo: Buffer.from(n.xml, "utf8"),
            nomeArquivo: `${rotulo}.xml`,
            contentType: "application/xml",
            quando: isNaN(quando.getTime()) ? new Date() : quando,
            referenciaId: `nfse_xml_${chave}`,
          });
          arquivadas++;

          /**
           * O PDF também, e não só o XML.
           *
           * O XML é o documento fiscal — é ele que a Receita reconhece e é ele
           * que o MEI é obrigado a guardar por cinco anos. Mas ninguém manda um
           * XML para o cliente. O usuário pediu os dois no Arquivo Digital, e
           * as notas emitidas antes desta mudança ficaram só com o XML: este
           * laço completa o que falta.
           *
           * `arquivarNaPasta` é idempotente pelo referenciaId, então rodar de
           * novo não duplica nada.
           */
          const pdf = await montarDanfsePdf(db, uid, lerDadosDaNota(n.xml), municipioCfg);
          if (pdf) {
            await arquivarNaPasta(db, adminStorage, firebaseConfig, {
              userId: uid,
              conteudo: pdf,
              nomeArquivo: `${rotulo}.pdf`,
              contentType: "application/pdf",
              quando: isNaN(quando.getTime()) ? new Date() : quando,
              referenciaId: `nfse_pdf_${chave}`,
            });
            pdfs++;
          }
        } catch (err: any) {
          problemas.push(`${rotulo}: ${err.message}`);
        }
      }

      const partes = [`${arquivadas} nota(s) real(is) guardada(s)`];
      if (pdfs) partes.push(`${pdfs} PDF(s) gerado(s)`);
      if (removidasTeste) partes.push(`${removidasTeste} arquivo(s) de teste removido(s)`);
      if (ignoradasTeste && !removidasTeste) partes.push(`${ignoradasTeste} nota(s) de teste ignorada(s)`);
      if (semXml) partes.push(`${semXml} sem XML`);

      res.json({
        success: true,
        total: snap.size,
        arquivadas,
        pdfs,
        ignoradasTeste,
        removidasTeste,
        semXml,
        problemas,
        mensagem: problemas.length
          ? `${partes.join(", ")}. ${problemas.length} deram erro.`
          : `Pronto: ${partes.join(", ")}.`,
      });
    } catch (err: any) {
      console.error("[NFS-e Arquivar]", err.message);
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
