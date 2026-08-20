/**
 * ============================================================================
 * MEI FLOW — Agendamento público (Fase 3)
 * ============================================================================
 *
 * O QUE É ISTO
 *
 * A tela que o CLIENTE abre — sem login, sem conta no MEI Flow — para marcar
 * um horário com o profissional. Desenhada em conversa com o usuário e
 * documentada em claude/AGENDAMENTO_GOOGLE_CALENDAR_ESTRUTURA.md (seção 5 e
 * 11, projeto "Mei Flow"). O link é fixo por profissional: {APP_URL}/agendar/{uid}.
 *
 * ----------------------------------------------------------------------------
 * POR QUE ESTE ARQUIVO É SEPARADO DE agendamento.ts
 *
 * `agendamento.ts` exige login (`exigirUsuario`) em toda rota — é o
 * profissional cadastrando os próprios tipos e horários. Aqui é o oposto: o
 * visitante não tem conta nenhuma, e a única coisa que o identifica é o `uid`
 * na própria URL. Misturar os dois no mesmo arquivo tornaria fácil esquecer o
 * `exigirUsuario` num lugar errado — e aqui isso significaria vazar dado de um
 * profissional para outro. Arquivo próprio, sem nenhum `exigirUsuario`
 * chamado em lugar nenhum, deixa essa garantia visível.
 *
 * ----------------------------------------------------------------------------
 * PAGAMENTO — SÓ CARTÃO POR ENQUANTO
 *
 * Decisão do usuário (2026-08-20): a página oferece cartão de crédito, via
 * checkout hospedado da Asaas (`emitirCartaoAsaas`, em bancoAsaas.ts) — o
 * mesmo mecanismo que a tela de Cobranças já usa. O MEI Flow nunca recebe
 * número de cartão. Pix fica para uma etapa futura (ainda não configurado);
 * o campo `pagamento.gateway` já guarda "asaas" pensando nisso, para o dia em
 * que outro método existir sem precisar mudar o formato do registro.
 *
 * Cartão só está disponível para profissional conectado via Asaas (mesma
 * regra já aplicada em `/api/efi/cartao`, dentro de efi.ts). Sem isso, a rota
 * de criar agendamento com pagamento devolve 428 com uma mensagem clara.
 *
 * ----------------------------------------------------------------------------
 * SEM RESERVA TEMPORÁRIA (decisão do usuário)
 *
 * Enquanto o cliente está pagando, o horário NÃO fica travado para mais
 * ninguém — o agendamento só passa a existir de verdade (`confirmado`) depois
 * que o pagamento é aprovado. Até lá, o registro existe como
 * `aguardando_pagamento`, mas NÃO entra na lista de horários ocupados (ver
 * `carregarAgendamentosOcupados`). Risco aceito explicitamente pelo usuário:
 * dois clientes tentarem o mesmo horário ao mesmo tempo é raro para um
 * profissional autônomo — e se acontecer, o segundo recebe 409 e escolhe
 * outro horário.
 *
 * ----------------------------------------------------------------------------
 * CONFERE NA LEITURA, NÃO NUM WEBHOOK NOVO
 *
 * Em vez de ensinar o webhook genérico da Asaas (dentro de efi.ts) a conhecer
 * "agendamento" — o que arriscaria mexer numa peça grande e já testada que
 * cuida de dinheiro de verdade — a confirmação acontece quando ALGUÉM lê o
 * status do agendamento (`GET /agendamento/:id/status`, chamado em loop pela
 * tela enquanto o cliente paga). Mesmo padrão já documentado e usado no MEI
 * Flow para o Premium (claude/MERCADO_PAGO_ACESSO_PAGO.md, seção 8): "a
 * conferência acontece na leitura, e não numa tarefa noturna". O `cobrancas`
 * criado aqui aparece normalmente no painel de Cobranças do profissional,
 * com um campo extra `agendamentoId` que mais ninguém usa.
 *
 * ----------------------------------------------------------------------------
 * FUSO HORÁRIO — SEMPRE -03:00, NUNCA O RELÓGIO DO SERVIDOR
 *
 * A Vercel roda em UTC. Disponibilidade e horários são cadastrados pensando
 * em horário de Brasília. Toda montagem de data usa o deslocamento `-03:00`
 * explícito (`${data}T${hora}:00-03:00`) — nunca `new Date(texto sem fuso)`,
 * que pegaria o fuso do servidor. Brasil não tem mais horário de verão desde
 * 2019, então um deslocamento fixo é seguro.
 *
 * ----------------------------------------------------------------------------
 * COMO INSTALAR
 *
 * 1. Salve como  agendamentoPublico.ts  na raiz (junto de agendamento.ts).
 * 2. Em meiflow-server.ts E em server.ts (os dois — ver a lição registrada em
 *    claude/BUGS_ENCONTRADOS.md sobre a Vercel não usar server.ts):
 *      import { registrarRotasAgendamentoPublico } from "./agendamentoPublico";
 *      registrarRotasAgendamentoPublico(app, db);
 * 3. As rotas usam o prefixo /api/agendamento/publico/*, já coberto pelo
 *    rewrite /api/agendamento/:path* no vercel.json — nada novo para lá.
 * 4. Adicione um rewrite de FRONTEND (fora de "rewrites" de API) para que
 *    /agendar/:path* sirva o index.html — sem isso a Vercel devolve 404 para
 *    esse caminho, porque não existe arquivo estático com esse nome.
 * 5. Adicione a regra de `agendamentos` no firestore.rules — deny-all, mesmo
 *    padrão de `cobrancas` e `tipos_agendamento`.
 *
 * ----------------------------------------------------------------------------
 * FASE 6 — FUNÇÕES REAPROVEITADAS POR agendamento.ts
 *
 * `carregarTipo`, `calcularHorariosDoDia` e `dataISOEmBrasilia` ganharam
 * `export` para a Fase 6 (integração com Orçamento e criação manual de
 * agendamento pelo profissional, em agendamento.ts) reaproveitar a MESMA
 * grade de horários — em vez de duplicar a lógica de disponibilidade num
 * segundo lugar, que um dia divergiria. Nada muda no comportamento das rotas
 * públicas deste arquivo.
 */

import { lerCredenciaisBanco } from "./bancoCofre.js";
import { emitirCartaoAsaas } from "./bancoAsaas.js";
import { classificar, diasAte } from "./cobrancas.js";
import {
  consultarOcupacaoGoogle,
  criarEventoAgendamento,
  atualizarEventoAgendamento,
  excluirEventoAgendamento,
} from "./googleCalendar.js";

const agora = () => new Date().toISOString();

// ============================================================================
// AUXILIARES DE LEITURA — mesmas coleções de agendamento.ts, sem exigir login
// ============================================================================

const DIAS_SEMANA = ["dom", "seg", "ter", "qua", "qui", "sex", "sab"] as const;
type Janela = { inicio: string; fim: string };

async function carregarNomeNegocio(db: any, uid: string): Promise<string> {
  try {
    const snap = await db.collection("users").doc(uid).get();
    if (!snap.exists) return "Este profissional";
    const u = snap.data() || {};
    return u.meiName || u.nomeComercial || u.razaoSocial || "Este profissional";
  } catch {
    return "Este profissional";
  }
}

async function carregarTiposAtivos(db: any, uid: string) {
  const snap = await db.collection("tipos_agendamento").where("userId", "==", uid).get();
  return snap.docs
    .map((d: any) => d.data())
    .filter((t: any) => t.ativo !== false)
    .map((t: any) => ({
      id: t.id,
      nome: t.nome,
      duracaoPadraoMin: t.duracaoPadraoMin,
      exigePagamento: !!t.exigePagamento,
      valor: typeof t.valor === "number" ? t.valor : null,
    }))
    .sort((a: any, b: any) => String(a.nome).localeCompare(String(b.nome), "pt-BR"));
}

export async function carregarTipo(db: any, uid: string, tipoId: string) {
  if (!tipoId) return null;
  const snap = await db.collection("tipos_agendamento").doc(String(tipoId)).get();
  if (!snap.exists) return null;
  const t = snap.data();
  if (t.userId !== uid || t.ativo === false) return null;
  return {
    id: t.id,
    nome: t.nome,
    duracaoPadraoMin: Number(t.duracaoPadraoMin) || 0,
    exigePagamento: !!t.exigePagamento,
    valor: typeof t.valor === "number" ? t.valor : null,
  };
}

async function carregarJanelasDoDia(db: any, uid: string, dataISO: string): Promise<Janela[]> {
  const snap = await db.collection("disponibilidade_agenda").doc(uid).get();
  if (!snap.exists) return [];
  const dias = snap.data()?.dias || {};
  const diaSemana = DIAS_SEMANA[new Date(`${dataISO}T12:00:00-03:00`).getDay()];
  const lista = dias[diaSemana];
  return Array.isArray(lista) ? lista : [];
}

/**
 * Agendamentos que já ocupam a agenda do profissional NAQUELE dia — só os
 * que já viraram compromisso de verdade (ver nota sobre "sem reserva
 * temporária" no topo do arquivo). `aguardando_pagamento` não entra aqui.
 */
async function carregarAgendamentosOcupados(
  db: any,
  uid: string,
  inicioDia: Date,
  fimDia: Date,
  excluirId?: string
): Promise<Array<{ inicio: Date; fim: Date }>> {
  const snap = await db
    .collection("agendamentos")
    .where("userId", "==", uid)
    .where("status", "in", ["confirmado", "a_caminho", "concluido"])
    .get();

  const ocupados: Array<{ inicio: Date; fim: Date }> = [];
  for (const doc of snap.docs) {
    if (excluirId && doc.id === excluirId) continue; // reagendamento: não conta contra si mesmo
    const a = doc.data();
    const inicio = new Date(a.dataHoraInicio);
    const fim = new Date(a.dataHoraFimPrevisto);
    if (isNaN(inicio.getTime()) || isNaN(fim.getTime())) continue;
    if (fim <= inicioDia || inicio >= fimDia) continue; // fora do dia pedido
    ocupados.push({ inicio, fim });
  }
  return ocupados;
}

/**
 * Grade de horários possíveis num dia, cruzando as janelas de disponibilidade
 * com o que já está ocupado (agendamentos + Google Calendar). Passo fixo de
 * 15 minutos, independente da duração do serviço — é o que dá uma grade
 * previsível de se olhar, em vez de horários quebrados tipo 09:47.
 */
function gerarSlots(params: {
  dataISO: string;
  janelas: Janela[];
  duracaoMin: number;
  ocupados: Array<{ inicio: Date; fim: Date }>;
  agora: Date;
}): string[] {
  const PASSO_MS = 15 * 60000;
  const duracaoMs = Math.max(1, params.duracaoMin) * 60000;
  const slots: string[] = [];

  for (const j of params.janelas) {
    const inicioJanela = new Date(`${params.dataISO}T${j.inicio}:00-03:00`);
    const fimJanela = new Date(`${params.dataISO}T${j.fim}:00-03:00`);
    if (isNaN(inicioJanela.getTime()) || isNaN(fimJanela.getTime())) continue;

    for (let cursor = inicioJanela.getTime(); cursor + duracaoMs <= fimJanela.getTime(); cursor += PASSO_MS) {
      if (cursor <= params.agora.getTime()) continue; // não oferece horário que já passou (ou "agora mesmo")
      const fimSlot = cursor + duracaoMs;
      const conflita = params.ocupados.some((o) => cursor < o.fim.getTime() && fimSlot > o.inicio.getTime());
      if (!conflita) slots.push(new Date(cursor).toISOString());
    }
  }

  return slots;
}

/**
 * Recalcula a grade de um dia inteiro — usada por /horarios, para revalidar
 * em /agendar, e para revalidar em /reagendar (com `excluirId`, para o
 * próprio agendamento sendo movido não contar como conflito consigo mesmo).
 */
export async function calcularHorariosDoDia(
  db: any,
  uid: string,
  dataISO: string,
  duracaoMin: number,
  excluirId?: string
): Promise<string[]> {
  const janelas = await carregarJanelasDoDia(db, uid, dataISO);
  if (janelas.length === 0) return [];

  const inicioDia = new Date(`${dataISO}T00:00:00-03:00`);
  const fimDia = new Date(`${dataISO}T23:59:59-03:00`);

  const [ocupadosAgenda, ocupadosGoogle] = await Promise.all([
    carregarAgendamentosOcupados(db, uid, inicioDia, fimDia, excluirId),
    consultarOcupacaoGoogle(db, uid, inicioDia.toISOString(), fimDia.toISOString()),
  ]);

  const ocupados = [
    ...ocupadosAgenda,
    ...ocupadosGoogle
      .map((o) => ({ inicio: new Date(o.inicio), fim: new Date(o.fim) }))
      .filter((o) => !isNaN(o.inicio.getTime()) && !isNaN(o.fim.getTime())),
  ];

  return gerarSlots({ dataISO, janelas, duracaoMin, ocupados, agora: new Date() });
}

/** "2026-08-25" no fuso de Brasília, a partir de um instante qualquer. */
export function dataISOEmBrasilia(instante: Date): string {
  // en-CA sai como AAAA-MM-DD — o único formato de locale que já vem na ordem certa.
  return instante.toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
}

// ============================================================================
// FASE 4 — REGRA DE REAGENDAMENTO/CANCELAMENTO (definida pelo usuário)
// ============================================================================
//
// Reagendar: só até 1 hora antes do horário marcado, E só enquanto o
// profissional não tiver marcado "a caminho". Falhando qualquer uma das duas
// condições, o cliente não reagenda — precisa marcar um agendamento novo (e
// pagar de novo, sem estorno do anterior).
//
// Cancelar: SEM essa trava. Cancelar não pede um novo favor da agenda do
// profissional — ele já foi pago (quando exigia pagamento) e "sem estorno"
// já é a regra combinada, então cancelar tarde não custa nada a mais a
// ninguém além do cliente perder o valor pago. Por isso fica disponível em
// qualquer estado que ainda não seja `concluido`/`cancelado`.
// ============================================================================

const JANELA_REAGENDAMENTO_MS = 60 * 60000; // 1 hora

function checarReagendamento(a: any, agoraMs: number): { permitido: boolean; motivo?: string } {
  if (a.status === "a_caminho") {
    return { permitido: false, motivo: "O profissional já está a caminho — não é mais possível reagendar." };
  }
  if (a.status !== "confirmado") {
    return { permitido: false, motivo: "Este agendamento não pode mais ser reagendado." };
  }
  const inicioMs = new Date(a.dataHoraInicio).getTime();
  if (inicioMs - agoraMs < JANELA_REAGENDAMENTO_MS) {
    return {
      permitido: false,
      motivo: "Faltam menos de 1 hora para o horário marcado — não é mais possível reagendar por aqui.",
    };
  }
  return { permitido: true };
}

// ============================================================================
// ROTAS
// ============================================================================

export function registrarRotasAgendamentoPublico(app: any, db: any) {
  // --------------------------------------------------------------------------
  // PERFIL — nome do profissional + tipos de serviço ativos
  // --------------------------------------------------------------------------
  app.get("/api/agendamento/publico/:uid/perfil", async (req: any, res: any) => {
    try {
      const uid = String(req.params.uid || "");
      if (!uid) return res.status(400).json({ success: false, mensagem: "Link inválido." });

      const [nomeNegocio, tipos] = await Promise.all([carregarNomeNegocio(db, uid), carregarTiposAtivos(db, uid)]);

      res.json({ success: true, nomeNegocio, tipos });
    } catch (err: any) {
      res.status(500).json({ success: false, mensagem: err?.message || "Não foi possível carregar esta página." });
    }
  });

  // --------------------------------------------------------------------------
  // HORÁRIOS DISPONÍVEIS num dia, para um tipo de serviço
  //   ?tipoId=...&data=2026-08-25
  // --------------------------------------------------------------------------
  app.get("/api/agendamento/publico/:uid/horarios", async (req: any, res: any) => {
    try {
      const uid = String(req.params.uid || "");
      const tipoId = String(req.query?.tipoId || "");
      const dataISO = String(req.query?.data || "");

      if (!/^\d{4}-\d{2}-\d{2}$/.test(dataISO)) {
        return res.status(400).json({ success: false, mensagem: "Informe a data no formato AAAA-MM-DD." });
      }

      const tipo = await carregarTipo(db, uid, tipoId);
      if (!tipo) return res.status(404).json({ success: false, mensagem: "Tipo de agendamento não encontrado." });

      // Não oferece dia totalmente no passado — só filtra o dia inteiro; o
      // filtro de horário dentro do dia de hoje já acontece em gerarSlots.
      const hojeISO = dataISOEmBrasilia(new Date());
      if (dataISO < hojeISO) return res.json({ success: true, horarios: [] });

      const horarios = await calcularHorariosDoDia(db, uid, dataISO, tipo.duracaoPadraoMin);
      res.json({ success: true, horarios });
    } catch (err: any) {
      res.status(500).json({ success: false, mensagem: err?.message || "Não foi possível calcular os horários." });
    }
  });

  // --------------------------------------------------------------------------
  // CRIAR AGENDAMENTO
  // --------------------------------------------------------------------------
  app.post("/api/agendamento/publico/:uid/agendar", async (req: any, res: any) => {
    try {
      const uid = String(req.params.uid || "");
      const { tipoId, dataHoraInicio, cliente } = req.body || {};

      const tipo = await carregarTipo(db, uid, String(tipoId || ""));
      if (!tipo) return res.status(404).json({ success: false, mensagem: "Tipo de agendamento não encontrado." });

      const inicio = new Date(String(dataHoraInicio || ""));
      if (isNaN(inicio.getTime())) return res.status(400).json({ success: false, mensagem: "Horário inválido." });
      if (inicio.getTime() < Date.now() - 60000) {
        return res.status(400).json({ success: false, mensagem: "Este horário já passou. Escolha outro." });
      }
      const fim = new Date(inicio.getTime() + tipo.duracaoPadraoMin * 60000);

      const nome = String(cliente?.nome || "").trim();
      if (!nome) return res.status(400).json({ success: false, mensagem: "Informe seu nome." });
      if (nome.length > 120) return res.status(400).json({ success: false, mensagem: "Nome muito longo." });

      const telefone = String(cliente?.telefone || "").replace(/\D/g, "");
      if (telefone.length < 10 || telefone.length > 11) {
        return res.status(400).json({ success: false, mensagem: "Informe um telefone válido, com DDD." });
      }

      const cep = String(cliente?.cep || "").replace(/\D/g, "");
      const numero = String(cliente?.numero || "").trim();
      if (cep.length !== 8) return res.status(400).json({ success: false, mensagem: "Informe um CEP válido." });
      if (!numero) return res.status(400).json({ success: false, mensagem: "Informe o número do endereço." });

      // -------- revalida a grade: o horário pedido precisa continuar livre --------
      const dataISO = dataISOEmBrasilia(inicio);
      const horariosValidos = await calcularHorariosDoDia(db, uid, dataISO, tipo.duracaoPadraoMin);
      if (!horariosValidos.includes(inicio.toISOString())) {
        return res.status(409).json({
          success: false,
          mensagem: "Este horário acabou de deixar de estar disponível. Escolha outro.",
        });
      }

      let documento = "";
      if (tipo.exigePagamento) {
        documento = String(cliente?.documento || "").replace(/\D/g, "");
        if (documento.length !== 11 && documento.length !== 14) {
          return res.status(400).json({
            success: false,
            mensagem: "Para pagar, informe um CPF (11 dígitos) ou CNPJ (14 dígitos) válido.",
          });
        }
      }

      const endereco = {
        cep,
        numero,
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
        `CEP ${cep.slice(0, 5)}-${cep.slice(5)}`,
      ]
        .filter(Boolean)
        .join(" — ");

      const ref = db.collection("agendamentos").doc();
      const registroBase = {
        id: ref.id,
        userId: uid,
        tipoId: tipo.id,
        tipoNome: tipo.nome,
        duracaoMin: tipo.duracaoPadraoMin,
        valor: tipo.valor || 0,
        exigePagamento: tipo.exigePagamento,
        dataHoraInicio: inicio.toISOString(),
        dataHoraFimPrevisto: fim.toISOString(),
        cliente: { nome, telefone, documento: documento || null, ...endereco },
        enderecoTexto,
        googleEventId: null as string | null,
        criadoEm: agora(),
        atualizadoEm: agora(),
      };

      // -------- sem pagamento: confirma na hora --------
      if (!tipo.exigePagamento) {
        const googleEventId = await criarEventoAgendamento(db, uid, {
          titulo: `${tipo.nome} — ${nome}`,
          descricao: `Agendado pelo MEI Flow.\nCliente: ${nome}\nTelefone: ${telefone}\nEndereço: ${enderecoTexto}`,
          local: enderecoTexto,
          inicioISO: inicio.toISOString(),
          fimISO: fim.toISOString(),
        });
        await ref.set({ ...registroBase, status: "confirmado", pagamento: null, googleEventId });
        return res.json({ success: true, agendamentoId: ref.id, status: "confirmado" });
      }

      // -------- exige pagamento: gera a cobrança antes de confirmar --------
      const contaDoProfissional = await lerCredenciaisBanco(db, uid);
      if (contaDoProfissional?.provedor !== "asaas") {
        return res.status(428).json({
          success: false,
          mensagem:
            "Este profissional ainda não habilitou o pagamento por cartão para agendamentos. " +
            "Entre em contato diretamente com ele para marcar o horário.",
        });
      }

      const cobranca = await emitirCartaoAsaas(contaDoProfissional.segredos || {}, contaDoProfissional.ambiente, {
        valor: Number(tipo.valor),
        vencimento: dataISOEmBrasilia(new Date()),
        clienteNome: nome,
        clienteDocumento: documento,
        clienteTelefone: telefone,
        descricao: `Agendamento: ${tipo.nome}`,
        parcelas: 1,
      });

      await ref.set({
        ...registroBase,
        status: "aguardando_pagamento",
        pagamento: {
          obrigatorio: true,
          gateway: "asaas",
          cobrancaId: cobranca.id,
          linkPagamento: cobranca.linkPagamento,
          valor: cobranca.valor,
          criadoEm: agora(),
        },
      });

      // Mesmo formato que efi.ts já grava — assim o painel de Cobranças e a
      // conciliação por leitura (ver GET /agendamento/:id/status) enxergam
      // este registro como qualquer outra cobrança do profissional.
      await db
        .collection("cobrancas")
        .doc(String(cobranca.id))
        .set({
          id: String(cobranca.id),
          userId: uid,
          customerId: "",
          clienteNome: nome,
          clienteDocumento: documento,
          gateway: "asaas",
          formaPagamento: "cartao",
          valor: cobranca.valor,
          vencimento: cobranca.vencimento,
          status: cobranca.status,
          link: cobranca.linkPagamento,
          pdfUrl: "",
          agendamentoId: ref.id,
          criadoEm: agora(),
        });

      res.json({
        success: true,
        agendamentoId: ref.id,
        status: "aguardando_pagamento",
        pagamento: { linkPagamento: cobranca.linkPagamento, valor: cobranca.valor },
      });
    } catch (err: any) {
      console.error("[Agendamento público] Falha ao criar agendamento:", err?.response?.data || err?.message);
      res.status(500).json({ success: false, mensagem: err?.message || "Não foi possível criar o agendamento." });
    }
  });

  // --------------------------------------------------------------------------
  // STATUS — a tela de pagamento pergunta em loop enquanto o cliente paga.
  // É AQUI que a confirmação acontece de verdade, na leitura (ver nota no
  // topo do arquivo sobre por que não existe um webhook novo para isto).
  // --------------------------------------------------------------------------
  app.get("/api/agendamento/publico/agendamento/:id/status", async (req: any, res: any) => {
    try {
      const id = String(req.params.id || "");
      const ref = db.collection("agendamentos").doc(id);
      const snap = await ref.get();
      if (!snap.exists) return res.status(404).json({ success: false, mensagem: "Agendamento não encontrado." });

      let a = snap.data();

      if (a.status === "aguardando_pagamento" && a.pagamento?.cobrancaId) {
        const cSnap = await db.collection("cobrancas").doc(String(a.pagamento.cobrancaId)).get();
        if (cSnap.exists) {
          const c = cSnap.data();
          const situacao = classificar(c.status, diasAte(c.vencimento));

          if (situacao === "pago") {
            const googleEventId = await criarEventoAgendamento(db, a.userId, {
              titulo: `${a.tipoNome} — ${a.cliente?.nome || ""}`,
              descricao:
                `Agendado e pago pelo MEI Flow.\n` +
                `Cliente: ${a.cliente?.nome || ""}\nTelefone: ${a.cliente?.telefone || ""}\n` +
                `Endereço: ${a.enderecoTexto || ""}`,
              local: a.enderecoTexto,
              inicioISO: a.dataHoraInicio,
              fimISO: a.dataHoraFimPrevisto,
            });
            const atualizacao = { status: "confirmado", googleEventId, atualizadoEm: agora() };
            await ref.set(atualizacao, { merge: true });
            a = { ...a, ...atualizacao };
          }
          // "cancelado"/"pendente"/"vencido": segue aguardando_pagamento — o
          // cliente ainda pode concluir o pagamento pelo mesmo linkPagamento.
        }
      }

      res.json({
        success: true,
        status: a.status,
        tipoNome: a.tipoNome,
        dataHoraInicio: a.dataHoraInicio,
        pagamento: a.pagamento ? { linkPagamento: a.pagamento.linkPagamento, valor: a.pagamento.valor } : null,
      });
    } catch (err: any) {
      res.status(500).json({ success: false, mensagem: err?.message || "Algo deu errado." });
    }
  });

  // --------------------------------------------------------------------------
  // FASE 4 — PÁGINA DE ACOMPANHAMENTO (link único, sem login)
  // --------------------------------------------------------------------------

  // DETALHE — o que a página de acompanhamento mostra, incluindo se dá pra
  // reagendar/cancelar agora (a regra mora aqui, não no front, para o cliente
  // não conseguir burlar escondendo/adiantando o relógio do navegador).
  app.get("/api/agendamento/publico/agendamento/:id", async (req: any, res: any) => {
    try {
      const id = String(req.params.id || "");
      const snap = await db.collection("agendamentos").doc(id).get();
      if (!snap.exists) return res.status(404).json({ success: false, mensagem: "Agendamento não encontrado." });

      const a = snap.data();
      const reagendamento = checarReagendamento(a, Date.now());
      const podeCancelar = !["concluido", "cancelado"].includes(a.status);

      res.json({
        success: true,
        status: a.status,
        userId: a.userId,
        tipoId: a.tipoId,
        tipoNome: a.tipoNome,
        duracaoMin: a.duracaoMin,
        dataHoraInicio: a.dataHoraInicio,
        enderecoTexto: a.enderecoTexto || "",
        clienteNome: a.cliente?.nome || "",
        valor: a.valor || 0,
        exigePagamento: !!a.exigePagamento,
        podeReagendar: reagendamento.permitido,
        motivoBloqueioReagendamento: reagendamento.motivo || null,
        podeCancelar,
        canceladoEm: a.canceladoEm || null,
      });
    } catch (err: any) {
      res.status(500).json({ success: false, mensagem: err?.message || "Algo deu errado." });
    }
  });

  // REAGENDAR — cliente escolhe um novo horário livre do mesmo profissional.
  app.post("/api/agendamento/publico/agendamento/:id/reagendar", async (req: any, res: any) => {
    try {
      const id = String(req.params.id || "");
      const ref = db.collection("agendamentos").doc(id);
      const snap = await ref.get();
      if (!snap.exists) return res.status(404).json({ success: false, mensagem: "Agendamento não encontrado." });

      const a = snap.data();
      const check = checarReagendamento(a, Date.now());
      if (!check.permitido) return res.status(409).json({ success: false, mensagem: check.motivo });

      const novoInicio = new Date(String(req.body?.novoDataHoraInicio || ""));
      if (isNaN(novoInicio.getTime())) return res.status(400).json({ success: false, mensagem: "Horário inválido." });
      if (novoInicio.getTime() < Date.now() + 60000) {
        return res.status(400).json({ success: false, mensagem: "Escolha um horário no futuro." });
      }
      const novoFim = new Date(novoInicio.getTime() + Number(a.duracaoMin) * 60000);

      // Revalida contra a grade de verdade, ignorando este mesmo agendamento
      // (que ainda está "confirmado" no horário ANTIGO, e não pode contar
      // como se estivesse ocupando o horário novo escolhido).
      const dataISO = dataISOEmBrasilia(novoInicio);
      const horariosValidos = await calcularHorariosDoDia(db, a.userId, dataISO, Number(a.duracaoMin), id);
      if (!horariosValidos.includes(novoInicio.toISOString())) {
        return res.status(409).json({ success: false, mensagem: "Este horário não está disponível. Escolha outro." });
      }

      if (a.googleEventId) {
        await atualizarEventoAgendamento(db, a.userId, a.googleEventId, {
          inicioISO: novoInicio.toISOString(),
          fimISO: novoFim.toISOString(),
        });
      }

      await ref.set(
        {
          dataHoraInicio: novoInicio.toISOString(),
          dataHoraFimPrevisto: novoFim.toISOString(),
          reagendadoEm: agora(),
          atualizadoEm: agora(),
        },
        { merge: true }
      );

      res.json({ success: true, dataHoraInicio: novoInicio.toISOString() });
    } catch (err: any) {
      res.status(500).json({ success: false, mensagem: err?.message || "Não foi possível reagendar." });
    }
  });

  // CANCELAR — disponível em qualquer estado que ainda não seja
  // concluido/cancelado (ver nota sobre a regra, acima). Sem estorno.
  app.post("/api/agendamento/publico/agendamento/:id/cancelar", async (req: any, res: any) => {
    try {
      const id = String(req.params.id || "");
      const ref = db.collection("agendamentos").doc(id);
      const snap = await ref.get();
      if (!snap.exists) return res.status(404).json({ success: false, mensagem: "Agendamento não encontrado." });

      const a = snap.data();
      if (["concluido", "cancelado"].includes(a.status)) {
        return res.status(409).json({ success: false, mensagem: "Este agendamento já não pode mais ser cancelado." });
      }

      if (a.googleEventId) await excluirEventoAgendamento(db, a.userId, a.googleEventId);

      await ref.set(
        { status: "cancelado", canceladoEm: agora(), canceladoPor: "cliente", atualizadoEm: agora() },
        { merge: true }
      );

      res.json({ success: true, status: "cancelado" });
    } catch (err: any) {
      res.status(500).json({ success: false, mensagem: err?.message || "Não foi possível cancelar." });
    }
  });

  console.log(
    "[Agendamento público] Rotas registradas: /api/agendamento/publico/:uid/perfil, /horarios, /agendar, " +
      "/agendamento/:id (status/detalhe), /agendamento/:id/reagendar, /agendamento/:id/cancelar"
  );
}
