/**
 * ============================================================================
 * MEI FLOW — Agendamento de serviços (Fase 1: fundação de dados)
 * ============================================================================
 *
 * O QUE É ISTO
 *
 * Primeira fase da feature de agendamento com Google Calendar, desenhada em
 * conversa com o usuário e documentada em claude/AGENDAMENTO_GOOGLE_CALENDAR_ESTRUTURA.md
 * (projeto "Mei Flow"). Esta fase cobre a FUNDAÇÃO: o profissional cadastra os
 * tipos de serviço que oferece (nome, duração e — desde a Fase 3 — o preço,
 * quando o tipo exige pagamento) e os horários em que atende.
 *
 * ⚠️ O campo `valor` foi adicionado na Fase 3 (agendamento público), que
 * PRECISA saber quanto cobrar. Tipo criado antes disso não tem preço — ainda
 * pode ser usado sem pagamento, mas exigir pagamento sem preço é bloqueado em
 * `validarTipo`.
 *
 * As rotas PÚBLICAS (sem login, para o cliente marcar horário e pagar) vivem
 * em `agendamentoPublico.ts` — este arquivo aqui é só o cadastro, feito pelo
 * profissional logado.
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
import { excluirEventoAgendamento } from "./googleCalendar.js";

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
    // Preço do serviço — usado pela Fase 3 (agendamento público) para saber
    // quanto cobrar. Tipo antigo, criado antes desta fase, chega aqui como
    // `null`: continua existindo e podendo ser editado, só não pode exigir
    // pagamento até alguém preencher o valor (ver validarTipo).
    valor: typeof d.valor === "number" && d.valor > 0 ? d.valor : null,
    ativo: d.ativo !== false,
    criadoEm: d.criadoEm || null,
    atualizadoEm: d.atualizadoEm || null,
  };
}

function validarTipo(
  body: any
): { erro?: string; nome?: string; duracaoPadraoMin?: number; exigePagamento?: boolean; valor?: number | null } {
  const nome = String(body?.nome || "").trim();
  if (!nome) return { erro: "Informe o nome do serviço." };
  if (nome.length > 80) return { erro: "O nome do serviço pode ter no máximo 80 caracteres." };

  const duracaoPadraoMin = Math.round(Number(body?.duracaoPadraoMin));
  if (!Number.isFinite(duracaoPadraoMin) || duracaoPadraoMin < DURACAO_MIN_MINUTOS || duracaoPadraoMin > DURACAO_MAX_MINUTOS) {
    return { erro: `A duração precisa estar entre ${DURACAO_MIN_MINUTOS} minutos e ${DURACAO_MAX_MINUTOS / 60} horas.` };
  }

  const exigePagamento = !!body?.exigePagamento;

  // Sem valor não dá para cobrar — mas só travamos quando o pagamento está
  // ligado. Um tipo gratuito não precisa de preço nenhum.
  let valor: number | null = null;
  if (exigePagamento) {
    valor = Number(body?.valor);
    if (!Number.isFinite(valor) || valor <= 0) {
      return { erro: "Informe o valor do serviço — ele é cobrado do cliente ao confirmar o agendamento." };
    }
    valor = Math.round(valor * 100) / 100;
  }

  return { nome, duracaoPadraoMin, exigePagamento, valor };
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
// AGENDAMENTOS DO PROFISSIONAL (Fase 4)
// ============================================================================
//
// A Fase 3 criou a coleção `agendamentos`, alimentada só pela página pública
// (agendamentoPublico.ts, sem login). Esta seção é a primeira vez que o
// PRÓPRIO profissional lê e altera esses registros — precisa ver o que foi
// marcado ("profissional vê o novo agendamento", seção 5 do desenho) e marcar
// "a caminho" (toggle manual, seção 5.7). Concluir/dar baixa é da Fase 6.
// ============================================================================

function montarAgendamentoResumo(d: any) {
  return {
    id: d.id,
    tipoNome: d.tipoNome,
    duracaoMin: d.duracaoMin,
    status: d.status,
    dataHoraInicio: d.dataHoraInicio,
    dataHoraFimPrevisto: d.dataHoraFimPrevisto,
    enderecoTexto: d.enderecoTexto || "",
    clienteNome: d.cliente?.nome || "",
    clienteTelefone: d.cliente?.telefone || "",
    valor: d.valor || 0,
    exigePagamento: !!d.exigePagamento,
    googleEventId: d.googleEventId || null,
    criadoEm: d.criadoEm || null,
  };
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
        valor: v.valor,
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
        valor: v.valor,
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

  // --------------------------------------------------------------------------
  // MEUS AGENDAMENTOS (Fase 4) — o que a página pública já criou
  // --------------------------------------------------------------------------

  app.get("/api/agendamento/lista", async (req: any, res: any) => {
    try {
      const uid = await exigirUsuario(req);
      const snap = await db.collection("agendamentos").where("userId", "==", uid).get();
      const itens = snap.docs
        .map((d: any) => montarAgendamentoResumo(d.data()))
        .sort((a: any, b: any) => String(a.dataHoraInicio).localeCompare(String(b.dataHoraInicio)));
      res.json({ success: true, agendamentos: itens });
    } catch (err: any) {
      const s = erroParaStatus(err);
      res.status(s).json({ success: false, mensagem: mensagemDeErro(s, err) });
    }
  });

  // MARCAR "A CAMINHO" — toggle manual, sem gatilho automático por horário
  // (decisão explícita do usuário: "manual por enquanto").
  app.post("/api/agendamento/:id/a-caminho", async (req: any, res: any) => {
    try {
      const uid = await exigirUsuario(req);
      const ref = db.collection("agendamentos").doc(String(req.params.id));
      const snap = await ref.get();
      if (!snap.exists || snap.data().userId !== uid) {
        return res.status(404).json({ success: false, mensagem: "Agendamento não encontrado." });
      }
      if (snap.data().status !== "confirmado") {
        return res.status(409).json({
          success: false,
          mensagem: "Só é possível marcar 'a caminho' em um agendamento confirmado.",
        });
      }
      await ref.set({ status: "a_caminho", aCaminhoEm: agora(), atualizadoEm: agora() }, { merge: true });
      res.json({ success: true, status: "a_caminho" });
    } catch (err: any) {
      const s = erroParaStatus(err);
      res.status(s).json({ success: false, mensagem: mensagemDeErro(s, err) });
    }
  });

  // CANCELAR pelo próprio profissional (ex.: imprevisto, não vai conseguir
  // atender). Sem estorno automático — se for o caso, o profissional resolve
  // direto com o cliente e/ou no painel da Asaas.
  app.post("/api/agendamento/:id/cancelar", async (req: any, res: any) => {
    try {
      const uid = await exigirUsuario(req);
      const ref = db.collection("agendamentos").doc(String(req.params.id));
      const snap = await ref.get();
      if (!snap.exists || snap.data().userId !== uid) {
        return res.status(404).json({ success: false, mensagem: "Agendamento não encontrado." });
      }
      const a = snap.data();
      if (["concluido", "cancelado"].includes(a.status)) {
        return res.status(409).json({ success: false, mensagem: "Este agendamento já não pode mais ser cancelado." });
      }
      if (a.googleEventId) await excluirEventoAgendamento(db, uid, a.googleEventId);
      await ref.set(
        { status: "cancelado", canceladoEm: agora(), canceladoPor: "profissional", atualizadoEm: agora() },
        { merge: true }
      );
      res.json({ success: true, status: "cancelado" });
    } catch (err: any) {
      const s = erroParaStatus(err);
      res.status(s).json({ success: false, mensagem: mensagemDeErro(s, err) });
    }
  });

  console.log(
    "[Agendamento] Rotas registradas: /api/agendamento/tipos, /api/agendamento/disponibilidade, " +
      "/api/agendamento/lista, /api/agendamento/:id/a-caminho, /api/agendamento/:id/cancelar"
  );
}
