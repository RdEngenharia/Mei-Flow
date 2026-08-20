/**
 * ============================================================================
 * MEI FLOW — Agendamento de serviços (Fase 1: fundação de dados)
 * ============================================================================
 *
 * O QUE É ISTO
 *
 * Primeira fase da feature de agendamento com Google Calendar, desenhada em
 * conversa com o usuário e documentada em claude/AGENDAMENTO_GOOGLE_CALENDAR_ESTRUTURA.md
 * (projeto "Mei Flow"). Esta fase só cobre a FUNDAÇÃO: o profissional cadastra
 * os tipos de serviço que oferece e os horários em que atende. Ainda NÃO tem:
 * conexão com Google Calendar, página pública de agendamento, página de
 * acompanhamento do cliente, mensagens pré-configuradas nem relatório mensal —
 * isso vem nas fases seguintes, cada uma com sua própria entrega.
 *
 * ----------------------------------------------------------------------------
 * COMO INSTALAR
 *
 * 1. Salve como  agendamento.ts  na raiz (junto de server.ts e cobrancas.ts).
 * 2. No server.ts, no topo:      import { registrarRotasAgendamento } from "./agendamento";
 *    e dentro de startServer():  registrarRotasAgendamento(app, db);
 * 3. Adicione a rota no vercel.json (rewrite /api/agendamento/:path*).
 * 4. Adicione as regras de tipos_agendamento e disponibilidade_agenda no
 *    firestore.rules — as duas ficam bloqueadas para o app (allow read,
 *    write: if false), porque só o servidor (Admin SDK) toca nelas, no mesmo
 *    padrão de `cobrancas` e `banco_credenciais`.
 *
 * ----------------------------------------------------------------------------
 * POR QUE NÃO É O CLIENTE QUE LÊ ESSAS COLEÇÕES DIRETO DO FIRESTORE
 *
 * Igual a `cobrancas`: se o app lesse direto, cada regra de negócio (dono do
 * tipo, formato do horário, o dia da semana existir) teria que estar escrita
 * em Regras de Segurança do Firestore — uma linguagem ruim pra validação. Rota
 * de servidor valida com TypeScript de verdade e é onde as fases seguintes vão
 * plugar (ex.: checar Google Calendar antes de aceitar disponibilidade).
 */

import { exigirUsuario as verificarLogin } from "./auth-firebase.js";

async function exigirUsuario(req: any): Promise<string> {
  return verificarLogin(req);
}

function erroParaStatus(err: any): number {
  return err?.message === "NAO_AUTENTICADO" ? 401 : 500;
}

function mensagemDeErro(status: number, err: any): string {
  return status === 401 ? "Faça login para continuar." : err?.message || "Algo deu errado.";
}

const agora = () => new Date().toISOString();

// ============================================================================
// TIPOS DE AGENDAMENTO
// ============================================================================
//
// Cada profissional cadastra os serviços que oferece: nome, duração padrão
// (usada pra checar disponibilidade na grade, a partir da Fase 2/3) e se
// aquele tipo exige pagamento pra confirmar (reaproveita o motor de cobrança
// que já existe — nenhuma forma de pagamento nova).
// ============================================================================

const DURACAO_MIN_MINUTOS = 5;
const DURACAO_MAX_MINUTOS = 480; // 8 horas — teto generoso pra não travar visitas longas

function montarTipo(d: any) {
  return {
    id: d.id,
    nome: d.nome,
    duracaoPadraoMin: d.duracaoPadraoMin,
    exigePagamento: !!d.exigePagamento,
    ativo: d.ativo !== false,
    criadoEm: d.criadoEm || null,
    atualizadoEm: d.atualizadoEm || null,
  };
}

function validarTipo(body: any): { erro?: string; nome?: string; duracaoPadraoMin?: number; exigePagamento?: boolean } {
  const nome = String(body?.nome || "").trim();
  if (!nome) return { erro: "Informe o nome do serviço." };
  if (nome.length > 80) return { erro: "O nome do serviço pode ter no máximo 80 caracteres." };

  const duracaoPadraoMin = Math.round(Number(body?.duracaoPadraoMin));
  if (!Number.isFinite(duracaoPadraoMin) || duracaoPadraoMin < DURACAO_MIN_MINUTOS || duracaoPadraoMin > DURACAO_MAX_MINUTOS) {
    return { erro: `A duração precisa estar entre ${DURACAO_MIN_MINUTOS} minutos e ${DURACAO_MAX_MINUTOS / 60} horas.` };
  }

  return { nome, duracaoPadraoMin, exigePagamento: !!body?.exigePagamento };
}

// ============================================================================
// DISPONIBILIDADE
// ============================================================================
//
// Um documento por profissional (id do doc = uid), com os horários que atende
// em cada dia da semana. Cruzar isso com o Google Calendar de verdade é da
// Fase 2 em diante — aqui só existe o cadastro.
// ============================================================================

const DIAS_SEMANA = ["dom", "seg", "ter", "qua", "qui", "sex", "sab"] as const;
type DiaSemana = (typeof DIAS_SEMANA)[number];

type Janela = { inicio: string; fim: string };

function disponibilidadeVazia() {
  const dias: Record<DiaSemana, Janela[]> = { dom: [], seg: [], ter: [], qua: [], qui: [], sex: [], sab: [] };
  return { dias, atualizadoEm: null };
}

const HORA_VALIDA = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Valida o corpo inteiro antes de gravar — ou tudo entra certo, ou nada entra. */
function validarDisponibilidade(body: any): { erro?: string; dias?: Record<DiaSemana, Janela[]> } {
  const entrada = body?.dias;
  if (!entrada || typeof entrada !== "object") return { erro: "Formato de disponibilidade inválido." };

  const dias = disponibilidadeVazia().dias;

  for (const dia of DIAS_SEMANA) {
    const lista = entrada[dia];
    if (lista === undefined) continue;
    if (!Array.isArray(lista)) return { erro: `Horários de ${dia} em formato inválido.` };
    if (lista.length > 12) return { erro: `Muitos horários em um único dia (${dia}).` };

    const janelas: Janela[] = [];
    for (const j of lista) {
      const inicio = String(j?.inicio || "");
      const fim = String(j?.fim || "");
      if (!HORA_VALIDA.test(inicio) || !HORA_VALIDA.test(fim)) {
        return { erro: `Horário inválido em ${dia} — use o formato HH:MM.` };
      }
      if (inicio >= fim) {
        return { erro: `Em ${dia}, o horário de início precisa ser antes do de fim.` };
      }
      janelas.push({ inicio, fim });
    }

    // Mais cedo primeiro — facilita ler e é o que a tela espera de volta.
    janelas.sort((a, b) => a.inicio.localeCompare(b.inicio));
    dias[dia] = janelas;
  }

  return { dias };
}

// ============================================================================
// ROTAS
// ============================================================================

export function registrarRotasAgendamento(app: any, db: any) {
  const colTipos = () => db.collection("tipos_agendamento");
  const colDisponibilidade = () => db.collection("disponibilidade_agenda");

  // --------------------------------------------------------------------------
  // TIPOS DE AGENDAMENTO
  // --------------------------------------------------------------------------

  app.get("/api/agendamento/tipos", async (req: any, res: any) => {
    try {
      const uid = await exigirUsuario(req);
      const incluirInativos = req.query?.todos === "1";
      const snap = await colTipos().where("userId", "==", uid).get();
      let tipos = snap.docs.map((d: any) => montarTipo(d.data()));
      if (!incluirInativos) tipos = tipos.filter((t: any) => t.ativo);
      tipos.sort((a: any, b: any) => String(a.nome).localeCompare(String(b.nome), "pt-BR"));
      res.json({ success: true, tipos });
    } catch (err: any) {
      const s = erroParaStatus(err);
      res.status(s).json({ success: false, mensagem: mensagemDeErro(s, err) });
    }
  });

  app.post("/api/agendamento/tipos", async (req: any, res: any) => {
    try {
      const uid = await exigirUsuario(req);
      const v = validarTipo(req.body);
      if (v.erro) return res.status(400).json({ success: false, mensagem: v.erro });

      const ref = colTipos().doc();
      const registro = {
        id: ref.id,
        userId: uid,
        nome: v.nome,
        duracaoPadraoMin: v.duracaoPadraoMin,
        exigePagamento: v.exigePagamento,
        ativo: true,
        criadoEm: agora(),
        atualizadoEm: agora(),
      };
      await ref.set(registro);
      res.json({ success: true, tipo: montarTipo(registro) });
    } catch (err: any) {
      const s = erroParaStatus(err);
      res.status(s).json({ success: false, mensagem: mensagemDeErro(s, err) });
    }
  });

  app.put("/api/agendamento/tipos/:id", async (req: any, res: any) => {
    try {
      const uid = await exigirUsuario(req);
      const ref = colTipos().doc(String(req.params.id));
      const snap = await ref.get();
      if (!snap.exists || snap.data().userId !== uid) {
        return res.status(404).json({ success: false, mensagem: "Tipo de agendamento não encontrado." });
      }

      const v = validarTipo(req.body);
      if (v.erro) return res.status(400).json({ success: false, mensagem: v.erro });

      const atualizado = {
        nome: v.nome,
        duracaoPadraoMin: v.duracaoPadraoMin,
        exigePagamento: v.exigePagamento,
        ativo: req.body?.ativo !== false,
        atualizadoEm: agora(),
      };
      await ref.update(atualizado);
      res.json({ success: true, tipo: montarTipo({ ...snap.data(), ...atualizado }) });
    } catch (err: any) {
      const s = erroParaStatus(err);
      res.status(s).json({ success: false, mensagem: mensagemDeErro(s, err) });
    }
  });

  app.delete("/api/agendamento/tipos/:id", async (req: any, res: any) => {
    try {
      const uid = await exigirUsuario(req);
      const ref = colTipos().doc(String(req.params.id));
      const snap = await ref.get();
      if (!snap.exists || snap.data().userId !== uid) {
        return res.status(404).json({ success: false, mensagem: "Tipo de agendamento não encontrado." });
      }
      await ref.delete();
      res.json({ success: true });
    } catch (err: any) {
      const s = erroParaStatus(err);
      res.status(s).json({ success: false, mensagem: mensagemDeErro(s, err) });
    }
  });

  // --------------------------------------------------------------------------
  // DISPONIBILIDADE
  // --------------------------------------------------------------------------

  app.get("/api/agendamento/disponibilidade", async (req: any, res: any) => {
    try {
      const uid = await exigirUsuario(req);
      const snap = await colDisponibilidade().doc(uid).get();
      if (!snap.exists) {
        return res.json({ success: true, ...disponibilidadeVazia() });
      }
      const d = snap.data();
      res.json({ success: true, dias: { ...disponibilidadeVazia().dias, ...d.dias }, atualizadoEm: d.atualizadoEm || null });
    } catch (err: any) {
      const s = erroParaStatus(err);
      res.status(s).json({ success: false, mensagem: mensagemDeErro(s, err) });
    }
  });

  app.put("/api/agendamento/disponibilidade", async (req: any, res: any) => {
    try {
      const uid = await exigirUsuario(req);
      const v = validarDisponibilidade(req.body);
      if (v.erro) return res.status(400).json({ success: false, mensagem: v.erro });

      const registro = { userId: uid, dias: v.dias, atualizadoEm: agora() };
      await colDisponibilidade().doc(uid).set(registro);
      res.json({ success: true, dias: registro.dias, atualizadoEm: registro.atualizadoEm });
    } catch (err: any) {
      const s = erroParaStatus(err);
      res.status(s).json({ success: false, mensagem: mensagemDeErro(s, err) });
    }
  });

  console.log(
    "[Agendamento] Rotas registradas (Fase 1): /api/agendamento/tipos, /api/agendamento/disponibilidade"
  );
}
