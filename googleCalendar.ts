/**
 * ============================================================================
 * MEI FLOW — Conexão com o Google Calendar (Fase 2 do Agendamento)
 * ============================================================================
 *
 * O QUE ESTA FASE FAZ, E O QUE NÃO FAZ
 *
 * Só a conexão: o profissional clica em "Conectar Google Calendar", autoriza
 * no Google, e o MEI Flow guarda um jeito de falar com a agenda dele para
 * sempre (até ele desconectar). NENHUM evento é criado ainda — isso é da Fase
 * 3 em diante, quando existir agendamento de verdade para sincronizar. O que
 * esta fase entrega de reaproveitável para lá é `obterAccessTokenValido`,
 * pronta para qualquer rota futura que precise falar com a Calendar API.
 *
 * ----------------------------------------------------------------------------
 * ⚠️ PRÉ-REQUISITO EXTERNO — ISTO NÃO FUNCIONA SÓ COM O CÓDIGO
 *
 * Diferente de Tipos de Agendamento e Disponibilidade (Fase 1), esta fase
 * depende de coisas que só existem fora do repositório:
 *
 *   1. Um projeto no Google Cloud Console com a Google Calendar API ativada.
 *   2. Uma tela de consentimento OAuth configurada (nome do app, e-mail de
 *      suporte, política de privacidade — o Google exige isso mesmo em teste).
 *   3. Um "OAuth Client ID" do tipo "Aplicativo da Web", com a URI de
 *      redirecionamento cadastrada EXATAMENTE como:
 *        {APP_URL}/api/agendamento/google/callback
 *   4. As variáveis de ambiente no servidor (Vercel):
 *        GOOGLE_CALENDAR_CLIENT_ID
 *        GOOGLE_CALENDAR_CLIENT_SECRET
 *        APP_URL   (já deve existir — é a mesma usada no webhook da Asaas)
 *
 * Sem isso, as rotas abaixo respondem com uma mensagem clara em vez de
 * quebrar — mas ninguém consegue conectar de verdade até esse cadastro ser
 * feito no Google Cloud Console, uma única vez, pelo dono do MEI Flow (não
 * por cada profissional).
 *
 * ⚠️ Enquanto a tela de consentimento estiver em modo "Teste" no Google, só
 * as contas do Google cadastradas manualmente como testadoras conseguem
 * conectar — qualquer outro profissional vê uma tela de aviso do Google e não
 * passa. Para valer para QUALQUER cliente do MEI Flow, a tela de
 * consentimento precisa estar publicada (Google chama isso de "verificação
 * do app" para escopos sensíveis, como o de Calendar) — processo que é feito
 * uma vez só pelo dono do MEI Flow, mas que não é instantâneo. Confira o
 * estado atual desse processo na documentação do Google antes de anunciar a
 * função para os usuários.
 *
 * ----------------------------------------------------------------------------
 * COMO O TOKEN É GUARDADO
 *
 * Só o REFRESH TOKEN é cifrado e guardado (mesmo padrão AES-256-GCM do cofre
 * do banco, em bancoCofre.ts — mesma chave mestra, `NFSE_CRYPTO_KEY` ou
 * `CONEXOES_CRYPTO_KEY`). O access token (validade de ~1h) nunca é gravado:
 * é pedido ao Google de novo, a partir do refresh token, toda vez que alguma
 * rota futura precisar falar com a Calendar API. Isso segue a mesma regra do
 * cofre do banco: quanto menos segredo de vida longa parado no banco de
 * dados, melhor.
 *
 * ----------------------------------------------------------------------------
 * COMO INSTALAR
 *
 * 1. Salve como  googleCalendar.ts  na raiz.
 * 2. No server.ts:  import { registrarRotasGoogleCalendar } from "./googleCalendar";
 *    e dentro de startServer():  registrarRotasGoogleCalendar(app, db);
 * 3. As rotas usam o prefixo /api/agendamento/google/*, que já está coberto
 *    pelo rewrite /api/agendamento/:path* no vercel.json (Fase 1) — nada novo
 *    para adicionar lá.
 * 4. Adicione as regras de google_calendar_credenciais e google_oauth_estado
 *    no firestore.rules (mesmo bloqueio de sempre: só o servidor toca).
 */

import axios from "axios";
import crypto from "crypto";
import { exigirUsuario as verificarLogin } from "./auth-firebase.js";

const env = (k: string) => (process.env[k] || "").trim();

const COLECAO_CREDENCIAIS = "google_calendar_credenciais";
const COLECAO_ESTADO = "google_oauth_estado";

const ESCOPOS = [
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/userinfo.email",
].join(" ");

const ESTADO_VALIDADE_MS = 10 * 60 * 1000; // 10 minutos para o profissional concluir o consentimento

// ============================================================================
// CIFRA — mesmo padrão de bancoCofre.ts, chave compartilhada de propósito
// ============================================================================

function chaveCripto(): Buffer {
  const hex = env("NFSE_CRYPTO_KEY") || env("CONEXOES_CRYPTO_KEY");
  if (hex.length !== 64) throw new Error("SEM_CHAVE_CRIPTO");
  return Buffer.from(hex, "hex");
}

function cofreDisponivel(): boolean {
  try {
    chaveCripto();
    return true;
  } catch {
    return false;
  }
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

// ============================================================================
// AUXILIARES
// ============================================================================

async function exigirUsuario(req: any): Promise<string> {
  return verificarLogin(req);
}

function erroParaStatus(err: any): number {
  return err?.message === "NAO_AUTENTICADO" ? 401 : 500;
}

/**
 * Mesma lógica de resolução de URL base já usada no webhook da Asaas
 * (bancoCofre.ts): prefere a variável de ambiente, cai para o host de quem
 * chamou, e só usa o domínio fixo como último recurso.
 */
function urlBase(req: any): string {
  const hostDoPedido = req.headers?.["x-forwarded-host"] || req.headers?.host;
  const protocoloDoPedido = String(req.headers?.["x-forwarded-proto"] || "https").split(",")[0];
  return (
    process.env.APP_URL ||
    (hostDoPedido ? `${protocoloDoPedido}://${hostDoPedido}` : "https://meiflow.rdhomologacao.com.br")
  ).replace(/\/+$/, "");
}

function credenciaisOAuthDisponiveis(): boolean {
  return !!env("GOOGLE_CALENDAR_CLIENT_ID") && !!env("GOOGLE_CALENDAR_CLIENT_SECRET");
}

// ============================================================================
// LER / GRAVAR A CONEXÃO
// ============================================================================

export type ResumoConexaoGoogle = {
  conectado: boolean;
  emailConectado?: string;
  conectadoEm?: string;
  atualizadoEm?: string;
};

export async function resumoConexaoGoogle(db: any, uid: string): Promise<ResumoConexaoGoogle> {
  const snap = await db.collection(COLECAO_CREDENCIAIS).doc(uid).get();
  if (!snap.exists) return { conectado: false };
  const d = snap.data() || {};
  return {
    conectado: true,
    emailConectado: d.emailConectado || "",
    conectadoEm: d.conectadoEm || null,
    atualizadoEm: d.atualizadoEm || null,
  };
}

/**
 * Devolve um access token PRONTO PRA USO na Calendar API, pedindo um novo ao
 * Google a partir do refresh token guardado. Uso exclusivo do servidor.
 *
 * Pensada para as fases seguintes (ex.: criar o evento "Visita Técnica" ao
 * confirmar um agendamento) — nenhuma rota desta fase a chama ainda.
 *
 * Devolve null quando o profissional não conectou o Google — quem chamar
 * PRECISA tratar isso como "sem calendário para sincronizar", nunca travar o
 * agendamento por causa disso: a conexão é opcional, do início ao fim.
 */
export async function obterAccessTokenValido(db: any, uid: string): Promise<string | null> {
  if (!db || !uid || !cofreDisponivel() || !credenciaisOAuthDisponiveis()) return null;

  const snap = await db.collection(COLECAO_CREDENCIAIS).doc(uid).get();
  if (!snap.exists) return null;

  const d = snap.data() || {};
  let refreshToken: string;
  try {
    refreshToken = decifrar(d.refreshTokenCifrado);
  } catch {
    console.error("[Google Calendar] Cofre corrompido para uid", uid);
    return null;
  }

  try {
    const { data } = await axios.post("https://oauth2.googleapis.com/token", null, {
      params: {
        client_id: env("GOOGLE_CALENDAR_CLIENT_ID"),
        client_secret: env("GOOGLE_CALENDAR_CLIENT_SECRET"),
        refresh_token: refreshToken,
        grant_type: "refresh_token",
      },
      timeout: 15000,
    });
    return data?.access_token || null;
  } catch (err: any) {
    // Token revogado do lado do Google (usuário removeu o acesso por lá, por
    // exemplo) — melhor tratar como desconectado do que travar quem chamou.
    console.error("[Google Calendar] Falha ao renovar token:", err?.response?.data || err?.message);
    return null;
  }
}

// ============================================================================
// FASE 3 — CONSULTAR OCUPAÇÃO E CRIAR EVENTO
// ============================================================================
//
// As duas funções que a Fase 2 deixou prontas para esta hora chegar. As duas
// seguem a mesma regra: a conexão com o Google é OPCIONAL do início ao fim —
// se não estiver conectado, ou se o Google falhar por qualquer motivo, quem
// chamou recebe "sem informação"/"sem evento", nunca uma exceção. Um
// agendamento não pode travar por causa do calendário de terceiro.
// ============================================================================

export type IntervaloOcupado = { inicio: string; fim: string };

/**
 * Períodos ocupados na agenda do profissional entre `inicioISO` e `fimISO`
 * (formato aceito pela Calendar API: ISO com fuso, ex. 2026-08-25T00:00:00-03:00).
 * Cruza compromissos que o profissional tem FORA do MEI Flow — reunião,
 * consulta, outro cliente marcado direto na agenda dele.
 */
export async function consultarOcupacaoGoogle(
  db: any,
  uid: string,
  inicioISO: string,
  fimISO: string
): Promise<IntervaloOcupado[]> {
  const token = await obterAccessTokenValido(db, uid);
  if (!token) return [];

  try {
    const { data } = await axios.post(
      "https://www.googleapis.com/calendar/v3/freeBusy",
      { timeMin: inicioISO, timeMax: fimISO, items: [{ id: "primary" }] },
      { headers: { Authorization: `Bearer ${token}` }, timeout: 15000 }
    );
    const ocupados = data?.calendars?.primary?.busy || [];
    return ocupados
      .filter((b: any) => b?.start && b?.end)
      .map((b: any) => ({ inicio: String(b.start), fim: String(b.end) }));
  } catch (err: any) {
    console.error("[Google Calendar] Falha ao consultar ocupação:", err?.response?.data || err?.message);
    return [];
  }
}

/**
 * Cria o evento na agenda do profissional quando um agendamento é confirmado.
 * Devolve o id do evento criado, ou `null` se o profissional não estiver
 * conectado ou se o Google recusar a chamada — quem chama trata `null` como
 * "o agendamento existe, só não foi sincronizado", nunca como erro fatal.
 */
export async function criarEventoAgendamento(
  db: any,
  uid: string,
  dados: { titulo: string; descricao?: string; local?: string; inicioISO: string; fimISO: string }
): Promise<string | null> {
  const token = await obterAccessTokenValido(db, uid);
  if (!token) return null;

  try {
    const { data } = await axios.post(
      "https://www.googleapis.com/calendar/v3/calendars/primary/events",
      {
        summary: dados.titulo,
        description: dados.descricao || undefined,
        location: dados.local || undefined,
        start: { dateTime: dados.inicioISO },
        end: { dateTime: dados.fimISO },
      },
      { headers: { Authorization: `Bearer ${token}` }, timeout: 15000 }
    );
    return data?.id ? String(data.id) : null;
  } catch (err: any) {
    console.error("[Google Calendar] Falha ao criar evento:", err?.response?.data || err?.message);
    return null;
  }
}

// ============================================================================
// ROTAS
// ============================================================================

export function registrarRotasGoogleCalendar(app: any, db: any) {
  // --------------------------------------------------------------------------
  // STATUS — o que a tela mostra
  // --------------------------------------------------------------------------
  app.get("/api/agendamento/google/status", async (req: any, res: any) => {
    try {
      const uid = await exigirUsuario(req);
      const resumo = await resumoConexaoGoogle(db, uid);
      res.json({ success: true, ...resumo, configuradoNoServidor: credenciaisOAuthDisponiveis() });
    } catch (err: any) {
      const s = erroParaStatus(err);
      res.status(s).json({ success: false, mensagem: err?.message || "Algo deu errado." });
    }
  });

  // --------------------------------------------------------------------------
  // INICIAR — devolve a URL de consentimento do Google
  // --------------------------------------------------------------------------
  app.get("/api/agendamento/google/conectar", async (req: any, res: any) => {
    try {
      const uid = await exigirUsuario(req);

      if (!credenciaisOAuthDisponiveis()) {
        return res.status(503).json({
          success: false,
          mensagem: "A integração com o Google Calendar ainda não foi configurada pelo MEI Flow.",
        });
      }
      if (!cofreDisponivel()) {
        return res.status(503).json({
          success: false,
          mensagem: "O servidor está sem a chave de segurança para guardar a conexão. Avise o suporte.",
        });
      }

      // Estado de uso único: liga o retorno do Google a ESTE profissional,
      // sem depender de cookie de sessão (o navegador sai do app e volta por
      // um redirecionamento simples do servidor, sem cabeçalho de login).
      const state = crypto.randomBytes(24).toString("hex");
      await db.collection(COLECAO_ESTADO).doc(state).set({
        userId: uid,
        criadoEm: new Date().toISOString(),
        expiraEm: Date.now() + ESTADO_VALIDADE_MS,
      });

      const redirectUri = `${urlBase(req)}/api/agendamento/google/callback`;
      const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
      url.searchParams.set("client_id", env("GOOGLE_CALENDAR_CLIENT_ID"));
      url.searchParams.set("redirect_uri", redirectUri);
      url.searchParams.set("response_type", "code");
      url.searchParams.set("scope", ESCOPOS);
      url.searchParams.set("access_type", "offline"); // pede refresh token
      url.searchParams.set("prompt", "consent"); // garante refresh token mesmo em reconexão
      url.searchParams.set("state", state);

      res.json({ success: true, url: url.toString() });
    } catch (err: any) {
      const s = erroParaStatus(err);
      res.status(s).json({ success: false, mensagem: err?.message || "Algo deu errado." });
    }
  });

  // --------------------------------------------------------------------------
  // CALLBACK — o Google traz o navegador de volta pra cá, sem cabeçalho de
  // login nenhum. Quem autentica isto é o `state` de uso único, não um token.
  // --------------------------------------------------------------------------
  app.get("/api/agendamento/google/callback", async (req: any, res: any) => {
    const paginaResultado = (sucesso: boolean, mensagem: string) => `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><title>Google Calendar — MEI Flow</title>
<style>
  body{font-family:system-ui,-apple-system,sans-serif;background:#f8fafc;color:#1e293b;
    display:flex;align-items:center;justify-content:center;height:100vh;margin:0;text-align:center;padding:24px;box-sizing:border-box}
  .cartao{max-width:360px}
  h1{font-size:16px;margin:0 0 8px}
  p{font-size:13px;color:#64748b;line-height:1.5}
  .icone{font-size:32px;margin-bottom:12px}
</style></head>
<body><div class="cartao">
  <div class="icone">${sucesso ? "✅" : "⚠️"}</div>
  <h1>${sucesso ? "Google Calendar conectado" : "Não foi possível conectar"}</h1>
  <p>${mensagem}</p>
  <p>Você já pode fechar esta aba.</p>
</div>
<script>
  try {
    if (window.opener) {
      window.opener.postMessage({ tipo: "meiflow-google-calendar", sucesso: ${sucesso ? "true" : "false"} }, window.location.origin);
    }
  } catch (e) {}
  setTimeout(function () { window.close(); }, ${sucesso ? "1800" : "4000"});
</script>
</body></html>`;

    try {
      const { code, state } = req.query || {};
      if (!code || !state) throw new Error("Faltou informação do Google no retorno.");

      const estadoRef = db.collection(COLECAO_ESTADO).doc(String(state));
      const estadoSnap = await estadoRef.get();
      if (!estadoSnap.exists) throw new Error("Esta conexão expirou ou já foi usada. Tente conectar de novo.");

      const estado = estadoSnap.data();
      await estadoRef.delete(); // uso único, sempre — sucesso ou falha adiante

      if (!estado?.userId || Number(estado.expiraEm) < Date.now()) {
        throw new Error("Esta conexão expirou. Tente conectar de novo.");
      }
      const uid = String(estado.userId);

      const redirectUri = `${urlBase(req)}/api/agendamento/google/callback`;
      const { data: tokenData } = await axios.post("https://oauth2.googleapis.com/token", null, {
        params: {
          code: String(code),
          client_id: env("GOOGLE_CALENDAR_CLIENT_ID"),
          client_secret: env("GOOGLE_CALENDAR_CLIENT_SECRET"),
          redirect_uri: redirectUri,
          grant_type: "authorization_code",
        },
        timeout: 15000,
      });

      const refreshToken = tokenData?.refresh_token;
      const accessToken = tokenData?.access_token;
      if (!refreshToken || !accessToken) {
        // Acontece quando o Google não devolve refresh_token (ex.: a pessoa já
        // tinha autorizado antes e o `prompt=consent` não bastou por algum
        // motivo). Sem refresh token não há como manter a conexão depois que
        // o access token expirar em ~1h — melhor falhar aqui, claramente, do
        // que guardar uma conexão que vai parar de funcionar sozinha.
        throw new Error("O Google não devolveu uma conexão duradoura. Tente conectar de novo.");
      }

      let emailConectado = "";
      try {
        const { data: userinfo } = await axios.get("https://www.googleapis.com/oauth2/v2/userinfo", {
          headers: { Authorization: `Bearer ${accessToken}` },
          timeout: 10000,
        });
        emailConectado = userinfo?.email || "";
      } catch {
        // Não é crítico: a conexão em si já foi feita. Só perde o rótulo
        // "conectado como fulano@gmail.com" — a tela mostra "conectado" mesmo assim.
      }

      const agora = new Date().toISOString();
      await db.collection(COLECAO_CREDENCIAIS).doc(uid).set({
        userId: uid,
        refreshTokenCifrado: cifrar(refreshToken),
        emailConectado,
        escopos: ESCOPOS.split(" "),
        conectadoEm: agora,
        atualizadoEm: agora,
      });

      res.status(200).send(paginaResultado(true, "Sua agenda já pode receber os agendamentos confirmados."));
    } catch (err: any) {
      console.error("[Google Calendar] Falha no callback:", err?.response?.data || err?.message);
      res
        .status(200)
        .send(paginaResultado(false, err?.message || "Algo deu errado ao falar com o Google."));
    }
  });

  // --------------------------------------------------------------------------
  // DESCONECTAR
  // --------------------------------------------------------------------------
  app.delete("/api/agendamento/google/credenciais", async (req: any, res: any) => {
    try {
      const uid = await exigirUsuario(req);
      const ref = db.collection(COLECAO_CREDENCIAIS).doc(uid);
      const snap = await ref.get();

      if (snap.exists) {
        // Revoga do lado do Google também — não deixa uma autorização válida
        // pendurada lá se o cofre daqui for apagado.
        try {
          const refreshToken = decifrar(snap.data().refreshTokenCifrado);
          await axios.post("https://oauth2.googleapis.com/revoke", null, {
            params: { token: refreshToken },
            timeout: 10000,
          });
        } catch (err: any) {
          console.error("[Google Calendar] Falha ao revogar no Google (seguindo mesmo assim):", err?.message);
        }
        await ref.delete();
      }

      res.json({ success: true, conectado: false });
    } catch (err: any) {
      const s = erroParaStatus(err);
      res.status(s).json({ success: false, mensagem: err?.message || "Algo deu errado." });
    }
  });

  console.log(
    "[Google Calendar] Rotas registradas: /api/agendamento/google/status, /conectar, /callback, /credenciais"
  );
}
