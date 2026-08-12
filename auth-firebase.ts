/**
 * ============================================================================
 * MEI FLOW — Verificação do login do usuário, sem firebase-admin/auth
 * ============================================================================
 *
 * POR QUE ESTE ARQUIVO EXISTE
 *
 * O `firebase-admin/auth` arrasta uma corrente de dependências que quebra na
 * Vercel: ele usa `jwks-rsa`, que por sua vez exige a versão 6 do `jose` —
 * publicada apenas no formato novo de módulo. Como a Vercel compila as funções
 * para o formato antigo, o carregamento estoura com ERR_REQUIRE_ESM e a rota
 * inteira morre antes de rodar uma linha.
 *
 * A solução é conferir o login por conta própria. O token que o aplicativo
 * envia é assinado pelo Google com chaves públicas publicadas em um endereço
 * fixo. Basta buscar essas chaves, conferir a assinatura e validar os campos.
 * Usa só o `crypto`, que já vem no Node — nenhuma dependência nova.
 *
 * Nada de segurança é afinado aqui: continuam sendo verificados a assinatura,
 * o emissor, o destinatário, a validade e o algoritmo.
 */

import crypto from "crypto";

const PROJETO = process.env.FIREBASE_PROJECT_ID || "mei-flow-692d9";
const EMISSOR = `https://securetoken.google.com/${PROJETO}`;
const URL_CERTIFICADOS =
  "https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com";

/** As chaves do Google giram de tempos em tempos; guardamos até expirarem. */
let cacheCertificados: { chaves: Record<string, string>; expiraEm: number } | null = null;

async function obterCertificados(): Promise<Record<string, string>> {
  if (cacheCertificados && cacheCertificados.expiraEm > Date.now()) {
    return cacheCertificados.chaves;
  }

  const resposta = await fetch(URL_CERTIFICADOS);
  if (!resposta.ok) {
    throw new Error(`Não foi possível obter as chaves públicas do Google (${resposta.status}).`);
  }
  const chaves = (await resposta.json()) as Record<string, string>;

  // Respeita o tempo de validade informado pelo próprio Google.
  let validadeMs = 60 * 60 * 1000;
  const cc = resposta.headers.get("cache-control") || "";
  const m = cc.match(/max-age=(\d+)/);
  if (m) validadeMs = Math.max(Number(m[1]) * 1000, 60_000);

  cacheCertificados = { chaves, expiraEm: Date.now() + validadeMs };
  return chaves;
}

function base64UrlParaBuffer(txt: string): Buffer {
  return Buffer.from(txt.replace(/-/g, "+").replace(/_/g, "/"), "base64");
}

function lerJson(parte: string): any {
  return JSON.parse(base64UrlParaBuffer(parte).toString("utf8"));
}

export type UsuarioVerificado = {
  uid: string;
  email?: string;
  emailVerificado?: boolean;

  /**
   * ============================================================================
   * AS PERMISSÕES VIAJAM DENTRO DO PRÓPRIO TOKEN
   * ============================================================================
   *
   * Quando o dono da conta cria um usuário para um ajudante, o servidor grava
   * no login dessa pessoa três informações extras (as "custom claims" do
   * Firebase): de quem é a empresa, que papel ela tem, e o que pode fazer.
   *
   * A alternativa seria guardar isso numa coleção e consultar a cada operação —
   * o que custa uma leitura de banco em TODA chamada, não só no login. Vindo no
   * token, já chega pronto e conferido: a assinatura do Google é verificada
   * acima, então nada aqui pode ter sido forjado pelo navegador.
   *
   * ⚠️ AUSÊNCIA DE `papel` SIGNIFICA "É O DONO".
   *
   * Contas criadas antes deste sistema existir não têm claim nenhuma — e não
   * podem ficar trancadas fora do próprio sistema por causa de um campo que
   * não existia quando elas nasceram. Quem não é membro é mestre.
   */
  empresaId?: string;
  papel?: "mestre" | "membro";
  permissoes?: Record<string, boolean>;
};

/**
 * Confere o token enviado pelo aplicativo e devolve quem é o usuário.
 * Lança erro se qualquer verificação falhar — nunca devolve "meio válido".
 */
export async function verificarIdToken(idToken: string): Promise<UsuarioVerificado> {
  if (!idToken || typeof idToken !== "string") throw new Error("Token ausente.");

  const partes = idToken.split(".");
  if (partes.length !== 3) throw new Error("Token malformado.");

  const [cabecalhoB64, corpoB64, assinaturaB64] = partes;

  let cabecalho: any, corpo: any;
  try {
    cabecalho = lerJson(cabecalhoB64);
    corpo = lerJson(corpoB64);
  } catch {
    throw new Error("Token ilegível.");
  }

  // 1. Algoritmo. Recusar qualquer outro impede o ataque clássico de trocar
  //    o algoritmo por "none" ou por um simétrico.
  if (cabecalho.alg !== "RS256") throw new Error("Algoritmo do token não aceito.");
  if (!cabecalho.kid) throw new Error("Token sem identificação de chave.");

  // 2. Assinatura, com a chave pública correspondente.
  const chaves = await obterCertificados();
  const certificado = chaves[cabecalho.kid];
  if (!certificado) throw new Error("Chave de assinatura desconhecida.");

  const assinaturaValida = crypto
    .createVerify("RSA-SHA256")
    .update(`${cabecalhoB64}.${corpoB64}`)
    .verify(crypto.createPublicKey(certificado), base64UrlParaBuffer(assinaturaB64));

  if (!assinaturaValida) throw new Error("Assinatura do token inválida.");

  // 3. Conteúdo.
  const agora = Math.floor(Date.now() / 1000);
  const folga = 60; // tolerância para relógios levemente dessincronizados

  if (corpo.aud !== PROJETO) throw new Error("Token emitido para outro projeto.");
  if (corpo.iss !== EMISSOR) throw new Error("Emissor do token inválido.");
  if (!corpo.sub || typeof corpo.sub !== "string") throw new Error("Token sem identificação de usuário.");
  if (typeof corpo.exp !== "number" || corpo.exp + folga < agora) throw new Error("Token expirado.");
  if (typeof corpo.iat === "number" && corpo.iat - folga > agora) throw new Error("Token emitido no futuro.");
  if (typeof corpo.auth_time === "number" && corpo.auth_time - folga > agora) {
    throw new Error("Horário de autenticação inválido.");
  }

  const ehMembro = corpo.papel === "membro";

  return {
    uid: corpo.sub,
    email: corpo.email,
    emailVerificado: corpo.email_verified,
    // Membro pertence à empresa do mestre; mestre é a própria empresa.
    empresaId: ehMembro && corpo.empresaId ? String(corpo.empresaId) : corpo.sub,
    papel: ehMembro ? "membro" : "mestre",
    permissoes: ehMembro && corpo.permissoes && typeof corpo.permissoes === "object"
      ? corpo.permissoes
      : undefined,
  };
}

/** Lê o cabeçalho Authorization e devolve o UID. Lança NAO_AUTENTICADO. */
/** O usuário inteiro — para quem precisa do papel e das permissões. */
export async function exigirUsuarioCompleto(req: any): Promise<UsuarioVerificado> {
  const cabecalho = String(req.headers?.authorization || "");
  const token = cabecalho.startsWith("Bearer ") ? cabecalho.slice(7).trim() : "";
  if (!token) throw new Error("NAO_AUTENTICADO");
  try {
    return await verificarIdToken(token);
  } catch (err: any) {
    console.warn("[Auth] Token recusado:", err.message);
    throw new Error("NAO_AUTENTICADO");
  }
}

export async function exigirUsuario(req: any): Promise<string> {
  const cabecalho = String(req.headers?.authorization || "");
  const token = cabecalho.startsWith("Bearer ") ? cabecalho.slice(7).trim() : "";
  if (!token) throw new Error("NAO_AUTENTICADO");
  try {
    const usuario = await verificarIdToken(token);
    /**
     * ⚠️ DEVOLVE A EMPRESA, NÃO O LOGIN.
     *
     * Todas as rotas do sistema usam este retorno para saber "de quem são os
     * dados". Para o dono, os dois são a mesma coisa. Para um ajudante, NÃO:
     * ele tem login próprio, mas os clientes, as cobranças e as notas são da
     * empresa do dono. Devolver o uid dele aqui faria o ajudante entrar num
     * sistema vazio — e gravar tudo num canto que ninguém mais veria.
     */
    return usuario.empresaId || usuario.uid;
  } catch (err: any) {
    console.warn("[Auth] Token recusado:", err.message);
    throw new Error("NAO_AUTENTICADO");
  }
}
