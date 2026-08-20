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
import { excluirEventoAgendamento, criarEventoAgendamento } from "./googleCalendar.js";
import { carregarTipo, calcularHorariosDoDia, dataISOEmBrasilia } from "./agendamentoPublico.js";

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
    tipoId: d.tipoId || null,
    tipoNome: d.tipoNome,
    duracaoMin: d.duracaoMin,
    status: d.status,
    dataHoraInicio: d.dataHoraInicio,
    dataHoraFimPrevisto: d.dataHoraFimPrevisto,
    enderecoTexto: d.enderecoTexto || "",
    clienteNome: d.cliente?.nome || "",
    clienteTelefone: d.cliente?.telefone || "",
    // CPF/CNPJ é opcional (nem todo cliente informa) — só existe quando o
    // pagamento pelo link público exigiu, ou quando o profissional digitou
    // na criação manual. `null` é normal e esperado, não um dado faltando.
    clienteDocumento: d.cliente?.documento || null,
    endereco: {
      cep: d.cliente?.cep || "",
      logradouro: d.cliente?.logradouro || "",
      numero: d.cliente?.numero || "",
      complemento: d.cliente?.complemento || "",
      bairro: d.cliente?.bairro || "",
      cidade: d.cliente?.cidade || "",
      uf: d.cliente?.uf || "",
      referencia: d.cliente?.referencia || "",
      lat: typeof d.cliente?.lat === "number" ? d.cliente.lat : null,
      lng: typeof d.cliente?.lng === "number" ? d.cliente.lng : null,
    },
    valor: d.valor || 0,
    exigePagamento: !!d.exigePagamento,
    googleEventId: d.googleEventId || null,
    criadoEm: d.criadoEm || null,
    criadoPor: d.criadoPor || "cliente",
    concluidoEm: d.concluidoEm || null,
    // Vínculo Fase 6 — ver claude/AGENDAMENTO_GOOGLE_CALENDAR_ESTRUTURA.md:
    // origemOrcamentoId = este agendamento nasceu de um orçamento aceito;
    // orcamentoGeradoId = este agendamento já gerou um orçamento (não deixa
    // gerar dois orçamentos da mesma visita por engano).
    origemOrcamentoId: d.origemOrcamentoId || null,
    orcamentoGeradoId: d.orcamentoGeradoId || null,
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

  // ============================================================================
  // FASE 6 — CONCLUIR (baixa simples) + INTEGRAÇÃO COM ORÇAMENTO
  // ============================================================================
  //
  // Ver claude/AGENDAMENTO_GOOGLE_CALENDAR_ESTRUTURA.md, seção 11 (Fase 6), no
  // projeto "Mei Flow". Esta é a baixa MÍNIMA — só muda o status para
  // `concluido` e grava `concluidoEm`. A parte de horário de conclusão
  // editável, descrição do serviço e relatório mensal (seção 9 do desenho)
  // fica para uma etapa seguinte; esta rota já nasce pronta para carregar
  // esses campos no futuro sem precisar de uma rota nova.
  //
  // Quando a baixa acontece pelo botão "Gerar orçamento" (Orçamento nasce dos
  // dados do agendamento), o front já criou o orçamento do lado dele (a
  // gravação de `usuarios/{uid}/orcamentos` é sempre feita pelo SDK do
  // cliente, nunca pelo servidor — mesmo padrão de sempre nesta feature) e
  // manda o id aqui em `orcamentoGeradoId`, só para registro/rastreio.

  app.post("/api/agendamento/:id/concluir", async (req: any, res: any) => {
    try {
      const uid = await exigirUsuario(req);
      const ref = db.collection("agendamentos").doc(String(req.params.id));
      const snap = await ref.get();
      if (!snap.exists || snap.data().userId !== uid) {
        return res.status(404).json({ success: false, mensagem: "Agendamento não encontrado." });
      }
      const a = snap.data();
      if (["concluido", "cancelado"].includes(a.status)) {
        return res.status(409).json({ success: false, mensagem: "Este agendamento já não está mais em aberto." });
      }

      const atualizacao: any = { status: "concluido", concluidoEm: agora(), atualizadoEm: agora() };

      const orcamentoGeradoId = String(req.body?.orcamentoGeradoId || "").trim();
      if (orcamentoGeradoId) {
        if (a.orcamentoGeradoId) {
          return res.status(409).json({
            success: false,
            mensagem: "Este agendamento já tem um orçamento gerado — evite gerar outro para a mesma visita.",
          });
        }
        atualizacao.orcamentoGeradoId = orcamentoGeradoId;
      }

      await ref.set(atualizacao, { merge: true });
      res.json({ success: true, status: "concluido", orcamentoGeradoId: atualizacao.orcamentoGeradoId || null });
    } catch (err: any) {
      const s = erroParaStatus(err);
      res.status(s).json({ success: false, mensagem: mensagemDeErro(s, err) });
    }
  });

  // --------------------------------------------------------------------------
  // HORÁRIOS DISPONÍVEIS — versão autenticada da mesma grade que a página
  // pública usa (mesma função `calcularHorariosDoDia`, reaproveitada de
  // agendamentoPublico.ts). Serve tanto o agendamento criado a partir de um
  // orçamento aceito quanto a criação manual pelo profissional.
  //   ?tipoId=...&data=2026-08-25
  // --------------------------------------------------------------------------
  app.get("/api/agendamento/horarios", async (req: any, res: any) => {
    try {
      const uid = await exigirUsuario(req);
      const tipoId = String(req.query?.tipoId || "");
      const dataISO = String(req.query?.data || "");

      if (!/^\d{4}-\d{2}-\d{2}$/.test(dataISO)) {
        return res.status(400).json({ success: false, mensagem: "Informe a data no formato AAAA-MM-DD." });
      }

      const tipo = await carregarTipo(db, uid, tipoId);
      if (!tipo) return res.status(404).json({ success: false, mensagem: "Tipo de agendamento não encontrado." });

      const hojeISO = dataISOEmBrasilia(new Date());
      if (dataISO < hojeISO) return res.json({ success: true, horarios: [] });

      const horarios = await calcularHorariosDoDia(db, uid, dataISO, tipo.duracaoPadraoMin);
      res.json({ success: true, horarios });
    } catch (err: any) {
      const s = erroParaStatus(err);
      res.status(s).json({ success: false, mensagem: mensagemDeErro(s, err) });
    }
  });

  // --------------------------------------------------------------------------
  // CRIAR AGENDAMENTO — pelo próprio profissional, sem o cliente passar pelo
  // link público. Dois casos de uso (ver claude/AGENDAMENTO_GOOGLE_CALENDAR_ESTRUTURA.md,
  // Fase 6): (1) agendar a instalação/serviço a partir de um orçamento já
  // aceito — `origemOrcamentoId` amarra os dois; (2) marcar um horário manual
  // para um cliente que não sabe ou não quer usar o link (decisão do
  // usuário). Em ambos os casos: SEMPRE confirma direto, sem pagamento — o
  // profissional já está falando com o cliente, e se houver dinheiro
  // envolvido isso é combinado pelo orçamento/venda, não por aqui. Por isso
  // nenhum campo de cliente é obrigatório além do nome: nem todo cliente
  // passa CPF, telefone ou endereço completo nessa hora, e travar a criação
  // por isso seria pior do que aceitar o cadastro incompleto.
  // --------------------------------------------------------------------------
  app.post("/api/agendamento/criar", async (req: any, res: any) => {
    try {
      const uid = await exigirUsuario(req);
      const { tipoId, dataHoraInicio, cliente, origemOrcamentoId } = req.body || {};

      const tipo = await carregarTipo(db, uid, String(tipoId || ""));
      if (!tipo) return res.status(404).json({ success: false, mensagem: "Tipo de agendamento não encontrado." });

      const inicio = new Date(String(dataHoraInicio || ""));
      if (isNaN(inicio.getTime())) return res.status(400).json({ success: false, mensagem: "Horário inválido." });
      if (inicio.getTime() < Date.now() - 60000) {
        return res.status(400).json({ success: false, mensagem: "Este horário já passou. Escolha outro." });
      }
      const fim = new Date(inicio.getTime() + tipo.duracaoPadraoMin * 60000);

      const nome = String(cliente?.nome || "").trim();
      if (!nome) return res.status(400).json({ success: false, mensagem: "Informe o nome do cliente." });
      if (nome.length > 120) return res.status(400).json({ success: false, mensagem: "Nome muito longo." });

      // Telefone, documento e endereço são OPCIONAIS aqui — diferente do
      // link público, onde o telefone é a única forma de contato e por isso
      // é exigido. Aqui quem está cadastrando já está falando com o cliente.
      const telefone = String(cliente?.telefone || "").replace(/\D/g, "");
      if (telefone && (telefone.length < 10 || telefone.length > 11)) {
        return res.status(400).json({ success: false, mensagem: "Telefone inválido — informe com DDD ou deixe em branco." });
      }
      const documento = String(cliente?.documento || "").replace(/\D/g, "");
      if (documento && documento.length !== 11 && documento.length !== 14) {
        return res.status(400).json({ success: false, mensagem: "CPF/CNPJ inválido — informe 11 ou 14 dígitos, ou deixe em branco." });
      }
      const cepDigitos = String(cliente?.cep || "").replace(/\D/g, "");
      if (cepDigitos && cepDigitos.length !== 8) {
        return res.status(400).json({ success: false, mensagem: "CEP inválido — informe 8 dígitos ou deixe em branco." });
      }

      // -------- revalida a grade: o horário pedido precisa continuar livre --------
      const dataISO = dataISOEmBrasilia(inicio);
      const horariosValidos = await calcularHorariosDoDia(db, uid, dataISO, tipo.duracaoPadraoMin);
      if (!horariosValidos.includes(inicio.toISOString())) {
        return res.status(409).json({
          success: false,
          mensagem: "Este horário acabou de deixar de estar disponível. Escolha outro.",
        });
      }

      const endereco = {
        cep: cepDigitos,
        numero: String(cliente?.numero || "").trim(),
        complemento: String(cliente?.complemento || "").trim(),
        logradouro: String(cliente?.logradouro || "").trim(),
        bairro: String(cliente?.bairro || "").trim(),
        cidade: String(cliente?.cidade || "").trim(),
        uf: String(cliente?.uf || "").trim(),
        referencia: String(cliente?.referencia || "").trim(),
        lat: typeof cliente?.lat === "number" ? cliente.lat : null,
        lng: typeof cliente?.lng === "number" ? cliente.lng : null,
      };
      const enderecoTexto = [
        endereco.logradouro && `${endereco.logradouro}, ${endereco.numero}`,
        !endereco.logradouro && endereco.numero,
        endereco.complemento,
        endereco.bairro,
        endereco.cidade && endereco.uf ? `${endereco.cidade}/${endereco.uf}` : endereco.cidade || endereco.uf,
        cepDigitos ? `CEP ${cepDigitos.slice(0, 5)}-${cepDigitos.slice(5)}` : "",
      ]
        .filter(Boolean)
        .join(" — ");

      const origemId = String(origemOrcamentoId || "").trim();

      const ref = db.collection("agendamentos").doc();
      const registro: any = {
        id: ref.id,
        userId: uid,
        tipoId: tipo.id,
        tipoNome: tipo.nome,
        duracaoMin: tipo.duracaoPadraoMin,
        valor: tipo.valor || 0,
        // Sempre false aqui: mesmo que o tipo normalmente exija pagamento no
        // link público, este agendamento nasceu de uma criação manual do
        // profissional e confirma direto — ver o comentário no topo da rota.
        exigePagamento: false,
        dataHoraInicio: inicio.toISOString(),
        dataHoraFimPrevisto: fim.toISOString(),
        cliente: { nome, telefone: telefone || "", documento: documento || null, ...endereco },
        enderecoTexto,
        criadoPor: "profissional",
        criadoEm: agora(),
        atualizadoEm: agora(),
        status: "confirmado",
        pagamento: null,
      };
      if (origemId) registro.origemOrcamentoId = origemId;

      const googleEventId = await criarEventoAgendamento(db, uid, {
        titulo: `${tipo.nome} — ${nome}`,
        descricao:
          `Agendado pelo profissional no MEI Flow.\nCliente: ${nome}` +
          (telefone ? `\nTelefone: ${telefone}` : "") +
          (enderecoTexto ? `\nEndereço: ${enderecoTexto}` : ""),
        local: enderecoTexto,
        inicioISO: inicio.toISOString(),
        fimISO: fim.toISOString(),
      });
      registro.googleEventId = googleEventId;

      await ref.set(registro);
      res.json({ success: true, agendamentoId: ref.id, status: "confirmado" });
    } catch (err: any) {
      const s = erroParaStatus(err);
      res.status(s).json({ success: false, mensagem: mensagemDeErro(s, err) });
    }
  });

  console.log(
    "[Agendamento] Rotas registradas: /api/agendamento/tipos, /api/agendamento/disponibilidade, " +
      "/api/agendamento/lista, /api/agendamento/:id/a-caminho, /api/agendamento/:id/cancelar, " +
      "/api/agendamento/:id/concluir, /api/agendamento/horarios, /api/agendamento/criar"
  );
}
