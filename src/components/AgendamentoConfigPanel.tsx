import React, { useCallback, useEffect, useState } from "react";
import {
  CalendarClock, Plus, Pencil, Trash2, Loader2, AlertTriangle, Save,
  X, Wallet, Clock, Info, CheckCircle2, ExternalLink, Unlink, Mail, ShieldCheck,
  Link2, Copy, Check, Truck, MapPin, Phone, Ban, ClipboardList,
} from "lucide-react";
import { auth } from "../firebase";
import { getApiUrl } from "../utils/nativeFile";

/**
 * ============================================================================
 * AGENDAMENTO — Fase 1: Tipos de Agendamento e Disponibilidade
 * ============================================================================
 *
 * O QUE É ISTO
 *
 * Primeira tela da feature de agendamento com Google Calendar (desenho
 * completo em claude/AGENDAMENTO_GOOGLE_CALENDAR_ESTRUTURA.md, no projeto).
 * Aqui o profissional só CADASTRA: os tipos de serviço que oferece e os
 * horários em que atende. Ainda não tem link público de agendamento, conexão
 * com o Google Calendar, nem relatório — isso chega nas próximas fases.
 *
 * ----------------------------------------------------------------------------
 * DUAS ABAS, UM SÓ DOCUMENTO POR PROFISSIONAL PARA DISPONIBILIDADE
 *
 * Tipos de Agendamento é uma lista (cada um vira um documento). Disponibilidade
 * é um cadastro só — os horários da semana do profissional — por isso salva
 * tudo de uma vez (PUT) em vez de item por item.
 */

interface Props {
  triggerToast?: (msg: string) => void;
}

type TipoAgendamento = {
  id: string;
  nome: string;
  duracaoPadraoMin: number;
  exigePagamento: boolean;
  valor: number | null;
  ativo: boolean;
};

type Janela = { inicio: string; fim: string };
type DiaSemana = "dom" | "seg" | "ter" | "qua" | "qui" | "sex" | "sab";
type Dias = Record<DiaSemana, Janela[]>;

const DIAS_VAZIOS: Dias = { dom: [], seg: [], ter: [], qua: [], qui: [], sex: [], sab: [] };

/** Semana começando na segunda — é como o profissional pensa a agenda de trabalho. */
const ORDEM_DIAS: { chave: DiaSemana; label: string }[] = [
  { chave: "seg", label: "Segunda-feira" },
  { chave: "ter", label: "Terça-feira" },
  { chave: "qua", label: "Quarta-feira" },
  { chave: "qui", label: "Quinta-feira" },
  { chave: "sex", label: "Sexta-feira" },
  { chave: "sab", label: "Sábado" },
  { chave: "dom", label: "Domingo" },
];

async function comToken(): Promise<Record<string, string>> {
  const t = await auth.currentUser?.getIdToken();
  if (!t) throw new Error("Você precisa estar logado.");
  return { Authorization: `Bearer ${t}`, "Content-Type": "application/json" };
}

function formatarDuracao(min: number): string {
  const m = Math.round(Number(min) || 0);
  if (m < 60) return `${m}min`;
  const h = Math.floor(m / 60);
  const resto = m % 60;
  return resto ? `${h}h ${resto}min` : `${h}h`;
}

const TIPO_VAZIO = { nome: "", duracaoPadraoMin: 60, exigePagamento: false, valor: 0 };

function formatarReais(valor: number): string {
  return valor.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

type StatusGoogle = {
  conectado: boolean;
  emailConectado?: string;
  conectadoEm?: string;
  configuradoNoServidor?: boolean;
};

type StatusAgendamento = "aguardando_pagamento" | "confirmado" | "a_caminho" | "concluido" | "cancelado";

type Agendamento = {
  id: string;
  tipoNome: string;
  duracaoMin: number;
  status: StatusAgendamento;
  dataHoraInicio: string;
  enderecoTexto: string;
  clienteNome: string;
  clienteTelefone: string;
  valor: number;
  exigePagamento: boolean;
};

const RUBRICA_STATUS: Record<StatusAgendamento, { rotulo: string; classe: string }> = {
  aguardando_pagamento: { rotulo: "Aguardando pagamento", classe: "bg-amber-100/60 text-amber-700" },
  confirmado: { rotulo: "Confirmado", classe: "bg-indigo-100/60 text-indigo-700" },
  a_caminho: { rotulo: "A caminho", classe: "bg-amber-100/60 text-amber-700" },
  concluido: { rotulo: "Concluído", classe: "bg-emerald-100/60 text-emerald-700" },
  cancelado: { rotulo: "Cancelado", classe: "bg-slate-200/60 text-slate-500" },
};

function dataHoraBR(iso: string): string {
  const d = new Date(iso);
  const data = d.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit" });
  const hora = d.toLocaleTimeString("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" });
  return `${data} às ${hora}`;
}

export default function AgendamentoConfigPanel({ triggerToast }: Props) {
  const [abaInterna, setAbaInterna] = useState<"agendamentos" | "google" | "tipos" | "disponibilidade">(
    "agendamentos"
  );
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  // ------------------------------------------------------------ Google Calendar --
  const [googleStatus, setGoogleStatus] = useState<StatusGoogle>({ conectado: false });
  const [conectandoGoogle, setConectandoGoogle] = useState(false);
  const [desconectandoGoogle, setDesconectandoGoogle] = useState(false);
  const [confirmandoDesconexao, setConfirmandoDesconexao] = useState(false);

  const [linkCopiado, setLinkCopiado] = useState(false);
  const linkPublico = auth.currentUser?.uid ? `${window.location.origin}/agendar/${auth.currentUser.uid}` : "";

  const copiarLinkPublico = async () => {
    if (!linkPublico) return;
    try {
      await navigator.clipboard.writeText(linkPublico);
      setLinkCopiado(true);
      setTimeout(() => setLinkCopiado(false), 2000);
    } catch {
      triggerToast?.("Não foi possível copiar. Selecione o link manualmente.");
    }
  };

  // ----------------------------------------------------------- Agendamentos --
  const [agendamentos, setAgendamentos] = useState<Agendamento[]>([]);
  const [marcandoACaminhoId, setMarcandoACaminhoId] = useState<string | null>(null);
  const [confirmandoCancelamentoId, setConfirmandoCancelamentoId] = useState<string | null>(null);
  const [cancelandoId, setCancelandoId] = useState<string | null>(null);
  const [linkCopiadoId, setLinkCopiadoId] = useState<string | null>(null);

  // ---------------------------------------------------------------- Tipos --
  const [tipos, setTipos] = useState<TipoAgendamento[]>([]);
  const [formTipo, setFormTipo] = useState<typeof TIPO_VAZIO | null>(null);
  const [editandoId, setEditandoId] = useState<string | null>(null);
  const [confirmandoExclusao, setConfirmandoExclusao] = useState<string | null>(null);
  const [salvandoTipo, setSalvandoTipo] = useState(false);

  // ---------------------------------------------------------- Disponibilidade --
  const [dias, setDias] = useState<Dias>(DIAS_VAZIOS);
  const [salvandoDisponibilidade, setSalvandoDisponibilidade] = useState(false);
  const [disponibilidadeAlterada, setDisponibilidadeAlterada] = useState(false);

  const carregar = useCallback(async () => {
    setCarregando(true);
    setErro(null);
    try {
      const h = await comToken();
      const [rAgendamentos, rTipos, rDisp, rGoogle] = await Promise.all([
        fetch(getApiUrl("/api/agendamento/lista"), { headers: h }),
        fetch(getApiUrl("/api/agendamento/tipos"), { headers: h }),
        fetch(getApiUrl("/api/agendamento/disponibilidade"), { headers: h }),
        fetch(getApiUrl("/api/agendamento/google/status"), { headers: h }),
      ]);

      const dAgendamentos = await rAgendamentos.json();
      if (dAgendamentos?.success) setAgendamentos(dAgendamentos.agendamentos || []);

      const dTipos = await rTipos.json();
      if (dTipos?.success) setTipos(dTipos.tipos || []);
      else if (rTipos.status === 401) throw new Error("NAO_AUTENTICADO");

      const dDisp = await rDisp.json();
      if (dDisp?.success) setDias({ ...DIAS_VAZIOS, ...dDisp.dias });

      const dGoogle = await rGoogle.json();
      if (dGoogle?.success) {
        setGoogleStatus({
          conectado: !!dGoogle.conectado,
          emailConectado: dGoogle.emailConectado || "",
          conectadoEm: dGoogle.conectadoEm || undefined,
          configuradoNoServidor: dGoogle.configuradoNoServidor !== false,
        });
      }
    } catch (e: any) {
      setErro(
        e?.message === "NAO_AUTENTICADO"
          ? "Faça login para ver seus agendamentos."
          : e?.message || "Não foi possível carregar."
      );
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => {
    carregar();
  }, [carregar]);

  /**
   * A conexão com o Google acontece numa aba separada (o navegador sai do
   * MEI Flow para a tela de consentimento do Google e volta). Duas formas de
   * saber que terminou, porque nenhuma das duas é 100% garantida sozinha:
   * a aba de callback avisa por postMessage assim que fecha, e — reforço,
   * caso o postMessage falhe por algum motivo — recarrega o status sempre
   * que esta janela ganha foco de novo (a pessoa fechou a aba do Google e
   * voltou pra cá).
   */
  useEffect(() => {
    const aoReceberMensagem = (e: MessageEvent) => {
      if (e.origin !== window.location.origin) return;
      if (e.data?.tipo === "meiflow-google-calendar") carregar();
    };
    const aoFocar = () => carregar();
    window.addEventListener("message", aoReceberMensagem);
    window.addEventListener("focus", aoFocar);
    return () => {
      window.removeEventListener("message", aoReceberMensagem);
      window.removeEventListener("focus", aoFocar);
    };
  }, [carregar]);

  const conectarGoogle = async () => {
    setConectandoGoogle(true);
    setErro(null);
    try {
      const h = await comToken();
      const r = await fetch(getApiUrl("/api/agendamento/google/conectar"), { headers: h });
      const d = await r.json();
      if (!r.ok || !d?.success) throw new Error(d?.mensagem || "Não foi possível iniciar a conexão.");

      const popup = window.open(d.url, "_blank", "width=520,height=650");
      if (!popup) {
        setErro("O navegador bloqueou a janela de conexão. Habilite pop-ups para este site e tente de novo.");
      }
    } catch (e: any) {
      setErro(e?.message || "Não foi possível iniciar a conexão.");
    } finally {
      setConectandoGoogle(false);
    }
  };

  const desconectarGoogle = async () => {
    setDesconectandoGoogle(true);
    setErro(null);
    try {
      const h = await comToken();
      const r = await fetch(getApiUrl("/api/agendamento/google/credenciais"), { method: "DELETE", headers: h });
      const d = await r.json();
      if (!r.ok || !d?.success) throw new Error(d?.mensagem || "Não foi possível desconectar.");
      setGoogleStatus((s) => ({ ...s, conectado: false, emailConectado: "", conectadoEm: undefined }));
      setConfirmandoDesconexao(false);
      triggerToast?.("Google Calendar desconectado.");
    } catch (e: any) {
      setErro(e?.message || "Não foi possível desconectar.");
    } finally {
      setDesconectandoGoogle(false);
    }
  };

  // ----------------------------------------------------------- Agendamentos --

  const marcarACaminho = async (id: string) => {
    setMarcandoACaminhoId(id);
    setErro(null);
    try {
      const h = await comToken();
      const r = await fetch(getApiUrl(`/api/agendamento/${id}/a-caminho`), { method: "POST", headers: h });
      const d = await r.json();
      if (!r.ok || !d?.success) throw new Error(d?.mensagem || "Não foi possível marcar como a caminho.");
      setAgendamentos((lista) => lista.map((a) => (a.id === id ? { ...a, status: "a_caminho" } : a)));
      triggerToast?.("Marcado como a caminho.");
    } catch (e: any) {
      setErro(e?.message || "Não foi possível marcar como a caminho.");
    } finally {
      setMarcandoACaminhoId(null);
    }
  };

  const cancelarAgendamento = async (id: string) => {
    setCancelandoId(id);
    setErro(null);
    try {
      const h = await comToken();
      const r = await fetch(getApiUrl(`/api/agendamento/${id}/cancelar`), { method: "POST", headers: h });
      const d = await r.json();
      if (!r.ok || !d?.success) throw new Error(d?.mensagem || "Não foi possível cancelar.");
      setAgendamentos((lista) => lista.map((a) => (a.id === id ? { ...a, status: "cancelado" } : a)));
      setConfirmandoCancelamentoId(null);
      triggerToast?.("Agendamento cancelado.");
    } catch (e: any) {
      setErro(e?.message || "Não foi possível cancelar.");
    } finally {
      setCancelandoId(null);
    }
  };

  const copiarLinkAcompanhamento = async (id: string) => {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/acompanhar/${id}`);
      setLinkCopiadoId(id);
      setTimeout(() => setLinkCopiadoId(null), 2000);
    } catch {
      triggerToast?.("Não foi possível copiar. Tente novamente.");
    }
  };

  // ---------------------------------------------------------------- Tipos --

  const abrirNovoTipo = () => {
    setEditandoId(null);
    setFormTipo({ ...TIPO_VAZIO });
    setErro(null);
  };

  const abrirEdicaoTipo = (t: TipoAgendamento) => {
    setEditandoId(t.id);
    setFormTipo({
      nome: t.nome,
      duracaoPadraoMin: t.duracaoPadraoMin,
      exigePagamento: t.exigePagamento,
      valor: t.valor || 0,
    });
    setErro(null);
  };

  const cancelarFormTipo = () => {
    setEditandoId(null);
    setFormTipo(null);
  };

  const salvarTipo = async () => {
    if (!formTipo) return;
    if (!formTipo.nome.trim()) {
      setErro("Informe o nome do serviço.");
      return;
    }
    if (formTipo.exigePagamento && (!formTipo.valor || formTipo.valor <= 0)) {
      setErro("Informe o valor do serviço — ele é cobrado do cliente ao confirmar o agendamento.");
      return;
    }
    setSalvandoTipo(true);
    setErro(null);
    try {
      const h = await comToken();
      const url = editandoId
        ? getApiUrl(`/api/agendamento/tipos/${editandoId}`)
        : getApiUrl("/api/agendamento/tipos");
      const r = await fetch(url, {
        method: editandoId ? "PUT" : "POST",
        headers: h,
        body: JSON.stringify(formTipo),
      });
      const d = await r.json();
      if (!r.ok || !d?.success) throw new Error(d?.mensagem || "Não foi possível guardar o tipo de agendamento.");

      triggerToast?.(editandoId ? "Tipo de agendamento atualizado." : "Tipo de agendamento criado.");
      cancelarFormTipo();
      carregar();
    } catch (e: any) {
      setErro(e?.message || "Não foi possível guardar.");
    } finally {
      setSalvandoTipo(false);
    }
  };

  const excluirTipo = async (id: string) => {
    setSalvandoTipo(true);
    setErro(null);
    try {
      const h = await comToken();
      const r = await fetch(getApiUrl(`/api/agendamento/tipos/${id}`), { method: "DELETE", headers: h });
      const d = await r.json();
      if (!r.ok || !d?.success) throw new Error(d?.mensagem || "Não foi possível excluir.");
      triggerToast?.("Tipo de agendamento excluído.");
      setConfirmandoExclusao(null);
      carregar();
    } catch (e: any) {
      setErro(e?.message || "Não foi possível excluir.");
    } finally {
      setSalvandoTipo(false);
    }
  };

  // --------------------------------------------------------- Disponibilidade --

  const adicionarJanela = (dia: DiaSemana) => {
    setDias((d) => ({ ...d, [dia]: [...d[dia], { inicio: "08:00", fim: "18:00" }] }));
    setDisponibilidadeAlterada(true);
  };

  const removerJanela = (dia: DiaSemana, idx: number) => {
    setDias((d) => ({ ...d, [dia]: d[dia].filter((_, i) => i !== idx) }));
    setDisponibilidadeAlterada(true);
  };

  const alterarJanela = (dia: DiaSemana, idx: number, campo: "inicio" | "fim", valor: string) => {
    setDias((d) => ({
      ...d,
      [dia]: d[dia].map((j, i) => (i === idx ? { ...j, [campo]: valor } : j)),
    }));
    setDisponibilidadeAlterada(true);
  };

  const salvarDisponibilidade = async () => {
    setSalvandoDisponibilidade(true);
    setErro(null);
    try {
      const h = await comToken();
      const r = await fetch(getApiUrl("/api/agendamento/disponibilidade"), {
        method: "PUT",
        headers: h,
        body: JSON.stringify({ dias }),
      });
      const d = await r.json();
      if (!r.ok || !d?.success) throw new Error(d?.mensagem || "Não foi possível guardar a disponibilidade.");
      setDias({ ...DIAS_VAZIOS, ...d.dias });
      setDisponibilidadeAlterada(false);
      triggerToast?.("Disponibilidade guardada.");
    } catch (e: any) {
      setErro(e?.message || "Não foi possível guardar.");
    } finally {
      setSalvandoDisponibilidade(false);
    }
  };

  // ------------------------------------------------------------------ UI --

  const campoTexto = (
    label: string,
    valor: string,
    onChange: (v: string) => void,
    tipo: "text" | "number" = "text",
    dica?: string
  ) => (
    <div>
      <label className="block text-[10px] font-extrabold uppercase tracking-widest text-slate-400 mb-1.5">
        {label}
      </label>
      <input
        type={tipo}
        value={valor}
        onChange={(e) => onChange(e.target.value)}
        className="w-full px-4 py-2.5 rounded-xl border border-slate-200 bg-white text-sm text-slate-800 focus:outline-hidden focus:ring-2 focus:ring-indigo-200 focus:border-indigo-400 transition"
      />
      {dica && <p className="text-[10px] text-slate-400 mt-1">{dica}</p>}
    </div>
  );

  return (
    <div className="w-full animate-fade-in">
      <div className="pt-safe bg-white border-b border-slate-100 px-6 pb-5 flex items-center justify-between sticky top-0 z-10">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-indigo-50 text-indigo-600 rounded-xl flex items-center justify-center border border-indigo-100">
            <CalendarClock className="w-5 h-5" />
          </div>
          <div className="text-left">
            <h3 className="font-bold text-xl text-slate-900 tracking-tight">Agendamento</h3>
            <p className="text-[10px] text-slate-400 font-medium uppercase tracking-widest mt-0.5">
              Tipos de serviço e horários de atendimento
            </p>
          </div>
        </div>
      </div>

      <div className="p-6 space-y-5 max-w-3xl">
        <div className="bg-indigo-50/60 border border-indigo-100 rounded-2xl p-4 flex gap-3">
          <Info className="w-4 h-4 text-indigo-600 shrink-0 mt-0.5" />
          <p className="text-xs text-indigo-900/80 leading-relaxed">
            Cadastre os serviços que você oferece e os horários em que atende. A partir daqui, o
            cliente marca horário sozinho pelo seu link público (abaixo), o agendamento confirmado
            já aparece no seu Google Calendar (se conectado), e — se o serviço exigir pagamento —
            o cliente paga no cartão antes de confirmar. As mensagens prontas para o WhatsApp e o
            relatório mensal chegam nas próximas etapas.
          </p>
        </div>

        {erro && (
          <div className="bg-red-50 border border-red-200 rounded-2xl p-4 flex gap-3">
            <AlertTriangle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
            <p className="text-xs text-red-900 leading-relaxed">{erro}</p>
          </div>
        )}

        {linkPublico && (
          <div className="bg-white border border-slate-200/70 rounded-2xl p-4 flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center border border-indigo-100 shrink-0">
              <Link2 className="w-4 h-4" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[10px] font-extrabold uppercase tracking-widest text-slate-400">
                Seu link de agendamento
              </p>
              <p className="text-xs text-slate-700 truncate font-mono">{linkPublico}</p>
            </div>
            <button
              onClick={copiarLinkPublico}
              className="shrink-0 px-3 py-2 bg-slate-100 text-slate-600 rounded-xl text-[11px] font-bold flex items-center gap-1.5 hover:bg-slate-200 transition-colors cursor-pointer"
            >
              {linkCopiado ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
              {linkCopiado ? "Copiado" : "Copiar"}
            </button>
          </div>
        )}

        <div className="flex gap-1.5 bg-slate-100 rounded-2xl p-1 w-fit overflow-x-auto">
          {(["agendamentos", "google", "tipos", "disponibilidade"] as const).map((aba) => (
            <button
              key={aba}
              onClick={() => setAbaInterna(aba)}
              className={`px-4 py-2 rounded-xl text-xs font-bold transition-colors cursor-pointer whitespace-nowrap ${
                abaInterna === aba ? "bg-white text-indigo-700 shadow-xs" : "text-slate-500 hover:text-slate-700"
              }`}
            >
              {aba === "agendamentos"
                ? "Agendamentos"
                : aba === "google"
                ? "Google Calendar"
                : aba === "tipos"
                ? "Tipos de agendamento"
                : "Disponibilidade"}
            </button>
          ))}
        </div>

        {carregando ? (
          <div className="py-16 flex flex-col items-center gap-3 text-slate-400">
            <Loader2 className="w-6 h-6 animate-spin" />
            <p className="text-xs font-medium">Carregando…</p>
          </div>
        ) : abaInterna === "agendamentos" ? (
          <div className="space-y-3">
            {agendamentos.length === 0 ? (
              <div className="py-10 flex flex-col items-center gap-2.5 text-center">
                <ClipboardList className="w-8 h-8 text-slate-300" />
                <p className="text-xs text-slate-400 max-w-xs">
                  Nenhum agendamento ainda. Assim que um cliente marcar horário pelo seu link
                  público, ele aparece aqui.
                </p>
              </div>
            ) : (
              agendamentos.map((a) => (
                <div key={a.id} className="bg-white border border-slate-200/70 rounded-2xl p-4 space-y-2.5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-bold text-slate-800 truncate">{a.tipoNome}</p>
                      <p className="text-[11px] text-slate-500 mt-0.5">{dataHoraBR(a.dataHoraInicio)}</p>
                    </div>
                    <span
                      className={`shrink-0 px-2 py-1 rounded-lg text-[9px] font-extrabold uppercase ${RUBRICA_STATUS[a.status].classe}`}
                    >
                      {RUBRICA_STATUS[a.status].rotulo}
                    </span>
                  </div>

                  <div className="flex flex-col gap-1">
                    {a.clienteNome && (
                      <span className="text-xs text-slate-600">{a.clienteNome}</span>
                    )}
                    {a.clienteTelefone && (
                      <span className="inline-flex items-center gap-1.5 text-[11px] text-slate-400">
                        <Phone className="w-3 h-3" /> {a.clienteTelefone}
                      </span>
                    )}
                    {a.enderecoTexto && (
                      <span className="inline-flex items-start gap-1.5 text-[11px] text-slate-400">
                        <MapPin className="w-3 h-3 shrink-0 mt-0.5" /> {a.enderecoTexto}
                      </span>
                    )}
                    {a.exigePagamento && (
                      <span className="inline-flex items-center gap-1.5 text-[11px] font-bold text-indigo-600">
                        <Wallet className="w-3 h-3" /> {formatarReais(a.valor)}
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-1.5 pt-1 flex-wrap">
                    {a.status === "confirmado" && (
                      <button
                        onClick={() => marcarACaminho(a.id)}
                        disabled={marcandoACaminhoId === a.id}
                        className="px-3 py-1.5 bg-amber-50 text-amber-700 border border-amber-100 rounded-lg text-[10px] font-bold flex items-center gap-1.5 hover:bg-amber-100 transition-colors cursor-pointer disabled:opacity-60"
                      >
                        {marcandoACaminhoId === a.id ? (
                          <Loader2 className="w-3 h-3 animate-spin" />
                        ) : (
                          <Truck className="w-3 h-3" />
                        )}
                        Marcar a caminho
                      </button>
                    )}

                    {(a.status === "confirmado" || a.status === "a_caminho") && (
                      <button
                        onClick={() => copiarLinkAcompanhamento(a.id)}
                        className="px-3 py-1.5 bg-slate-100 text-slate-600 rounded-lg text-[10px] font-bold flex items-center gap-1.5 hover:bg-slate-200 transition-colors cursor-pointer"
                      >
                        {linkCopiadoId === a.id ? (
                          <Check className="w-3 h-3 text-emerald-600" />
                        ) : (
                          <Copy className="w-3 h-3" />
                        )}
                        {linkCopiadoId === a.id ? "Copiado" : "Link do cliente"}
                      </button>
                    )}

                    {(a.status === "confirmado" || a.status === "a_caminho") &&
                      (confirmandoCancelamentoId === a.id ? (
                        <span className="inline-flex items-center gap-1.5">
                          <button
                            onClick={() => cancelarAgendamento(a.id)}
                            disabled={cancelandoId === a.id}
                            className="px-2.5 py-1.5 bg-red-600 text-white rounded-lg text-[10px] font-bold hover:bg-red-700 transition-colors cursor-pointer"
                          >
                            Confirmar
                          </button>
                          <button
                            onClick={() => setConfirmandoCancelamentoId(null)}
                            className="px-2.5 py-1.5 bg-slate-100 text-slate-600 rounded-lg text-[10px] font-bold hover:bg-slate-200 transition-colors cursor-pointer"
                          >
                            Voltar
                          </button>
                        </span>
                      ) : (
                        <button
                          onClick={() => setConfirmandoCancelamentoId(a.id)}
                          className="px-3 py-1.5 bg-white text-slate-400 border border-slate-200 rounded-lg text-[10px] font-bold flex items-center gap-1.5 hover:bg-red-50 hover:text-red-600 hover:border-red-100 transition-colors cursor-pointer"
                        >
                          <Ban className="w-3 h-3" /> Cancelar
                        </button>
                      ))}
                  </div>
                </div>
              ))
            )}
          </div>
        ) : abaInterna === "google" ? (
          <div className="space-y-3">
            {googleStatus.configuradoNoServidor === false ? (
              <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 flex gap-3">
                <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                <p className="text-xs text-amber-900 leading-relaxed">
                  O MEI Flow ainda não configurou a integração com o Google Calendar neste servidor.
                  Isto não depende de você — avise o suporte.
                </p>
              </div>
            ) : googleStatus.conectado ? (
              <div className="bg-white border border-slate-200/70 rounded-2xl p-5 space-y-4">
                <div className="flex items-center gap-3">
                  <div className="w-11 h-11 rounded-2xl bg-emerald-50 text-emerald-600 flex items-center justify-center border border-emerald-100 shrink-0">
                    <ShieldCheck className="w-5 h-5" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-slate-800">Google Calendar conectado</p>
                    {googleStatus.emailConectado && (
                      <p className="text-xs text-slate-500 flex items-center gap-1.5 mt-0.5 truncate">
                        <Mail className="w-3 h-3 shrink-0" /> {googleStatus.emailConectado}
                      </p>
                    )}
                  </div>
                </div>

                <p className="text-xs text-slate-400 leading-relaxed">
                  A partir da próxima fase, os agendamentos confirmados vão aparecer sozinhos nesta
                  agenda. Por enquanto, a conexão já está pronta e sendo guardada com segurança.
                </p>

                {confirmandoDesconexao ? (
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-slate-600">Desconectar o Google Calendar?</span>
                    <button
                      onClick={desconectarGoogle}
                      disabled={desconectandoGoogle}
                      className="px-3 py-1.5 bg-red-600 text-white rounded-lg text-[11px] font-bold hover:bg-red-700 transition-colors cursor-pointer"
                    >
                      {desconectandoGoogle ? "Desconectando…" : "Sim, desconectar"}
                    </button>
                    <button
                      onClick={() => setConfirmandoDesconexao(false)}
                      className="px-3 py-1.5 bg-slate-100 text-slate-600 rounded-lg text-[11px] font-bold hover:bg-slate-200 transition-colors cursor-pointer"
                    >
                      Cancelar
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setConfirmandoDesconexao(true)}
                    className="text-[11px] font-bold text-red-500 flex items-center gap-1.5 hover:text-red-600 transition-colors cursor-pointer"
                  >
                    <Unlink className="w-3.5 h-3.5" /> Desconectar
                  </button>
                )}
              </div>
            ) : (
              <div className="bg-white border border-slate-200/70 rounded-2xl p-5 space-y-4 text-center">
                <div className="w-12 h-12 rounded-2xl bg-indigo-50 text-indigo-600 flex items-center justify-center border border-indigo-100 mx-auto">
                  <CalendarClock className="w-6 h-6" />
                </div>
                <div>
                  <p className="text-sm font-bold text-slate-800">Nenhuma conta do Google conectada</p>
                  <p className="text-xs text-slate-400 mt-1 leading-relaxed max-w-sm mx-auto">
                    Conecte sua agenda do Google para que os agendamentos confirmados apareçam nela
                    automaticamente, nas próximas fases desta função.
                  </p>
                </div>
                <button
                  onClick={conectarGoogle}
                  disabled={conectandoGoogle}
                  className="inline-flex items-center gap-2 px-5 py-2.5 bg-indigo-600 text-white rounded-xl text-xs font-bold hover:bg-indigo-700 transition-colors cursor-pointer disabled:opacity-60"
                >
                  {conectandoGoogle ? <Loader2 className="w-4 h-4 animate-spin" /> : <ExternalLink className="w-4 h-4" />}
                  Conectar Google Calendar
                </button>
              </div>
            )}
          </div>
        ) : abaInterna === "tipos" ? (
          <div className="space-y-3">
            {!formTipo && (
              <button
                onClick={abrirNovoTipo}
                className="w-full py-3 rounded-2xl border-2 border-dashed border-indigo-200 text-indigo-600 text-xs font-bold flex items-center justify-center gap-2 hover:bg-indigo-50 transition-colors cursor-pointer"
              >
                <Plus className="w-4 h-4" /> Novo tipo de agendamento
              </button>
            )}

            {formTipo && (
              <div className="bg-white border border-indigo-200 rounded-2xl p-5 space-y-4 shadow-xs">
                <h4 className="text-sm font-bold text-slate-800">
                  {editandoId ? "Editar tipo de agendamento" : "Novo tipo de agendamento"}
                </h4>

                {campoTexto("Nome do serviço", formTipo.nome, (v) => setFormTipo({ ...formTipo, nome: v }), "text", "Ex.: Visita técnica, Troca de resistência")}

                <div>
                  <label className="block text-[10px] font-extrabold uppercase tracking-widest text-slate-400 mb-1.5">
                    Duração padrão (minutos)
                  </label>
                  <input
                    type="number"
                    min={5}
                    max={480}
                    step={5}
                    value={formTipo.duracaoPadraoMin}
                    onChange={(e) => setFormTipo({ ...formTipo, duracaoPadraoMin: Number(e.target.value) })}
                    className="w-full px-4 py-2.5 rounded-xl border border-slate-200 bg-white text-sm text-slate-800 focus:outline-hidden focus:ring-2 focus:ring-indigo-200 focus:border-indigo-400 transition"
                  />
                  <p className="text-[10px] text-slate-400 mt-1">
                    = {formatarDuracao(formTipo.duracaoPadraoMin)} — usado pra checar disponibilidade na grade.
                  </p>
                </div>

                <label className="flex items-center gap-2.5 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={formTipo.exigePagamento}
                    onChange={(e) => setFormTipo({ ...formTipo, exigePagamento: e.target.checked })}
                    className="w-4 h-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-400"
                  />
                  <span className="text-xs font-semibold text-slate-700 flex items-center gap-1.5">
                    <Wallet className="w-3.5 h-3.5 text-slate-400" />
                    Exige pagamento para confirmar
                  </span>
                </label>

                {formTipo.exigePagamento && (
                  <div>
                    <label className="block text-[10px] font-extrabold uppercase tracking-widest text-slate-400 mb-1.5">
                      Valor do serviço (R$)
                    </label>
                    <input
                      type="number"
                      min={0.01}
                      step={0.01}
                      value={formTipo.valor || ""}
                      onChange={(e) => setFormTipo({ ...formTipo, valor: Number(e.target.value) })}
                      placeholder="0,00"
                      className="w-full px-4 py-2.5 rounded-xl border border-slate-200 bg-white text-sm text-slate-800 focus:outline-hidden focus:ring-2 focus:ring-indigo-200 focus:border-indigo-400 transition"
                    />
                    <p className="text-[10px] text-slate-400 mt-1">
                      Cobrado do cliente no cartão de crédito ao confirmar o agendamento pelo link
                      público. Exige a Asaas conectada em Configurações → Banco.
                    </p>
                  </div>
                )}

                <div className="flex gap-2 pt-1">
                  <button
                    onClick={salvarTipo}
                    disabled={salvandoTipo}
                    className="flex-1 py-2.5 bg-indigo-600 text-white rounded-xl text-xs font-bold flex items-center justify-center gap-2 hover:bg-indigo-700 transition-colors cursor-pointer disabled:opacity-60"
                  >
                    {salvandoTipo ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                    Salvar
                  </button>
                  <button
                    onClick={cancelarFormTipo}
                    disabled={salvandoTipo}
                    className="px-4 py-2.5 bg-slate-100 text-slate-600 rounded-xl text-xs font-bold hover:bg-slate-200 transition-colors cursor-pointer"
                  >
                    Cancelar
                  </button>
                </div>
              </div>
            )}

            {!carregando && tipos.length === 0 && !formTipo && (
              <p className="text-xs text-slate-400 text-center py-6">
                Nenhum tipo de agendamento cadastrado ainda.
              </p>
            )}

            {tipos.map((t) => (
              <div
                key={t.id}
                className="bg-white border border-slate-200/70 rounded-2xl p-4 flex items-center justify-between gap-3"
              >
                <div className="min-w-0">
                  <p className="text-sm font-bold text-slate-800 truncate">{t.nome}</p>
                  <div className="flex items-center gap-2 mt-1 flex-wrap">
                    <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-slate-500">
                      <Clock className="w-3 h-3" /> {formatarDuracao(t.duracaoPadraoMin)}
                    </span>
                    {t.exigePagamento && (
                      <span className="inline-flex items-center gap-1 bg-emerald-100/60 text-emerald-700 px-1.5 py-0.5 rounded text-[9px] font-extrabold uppercase">
                        <Wallet className="w-2.5 h-2.5" /> {t.valor ? formatarReais(t.valor) : "sem valor definido"}
                      </span>
                    )}
                  </div>
                </div>

                {confirmandoExclusao === t.id ? (
                  <div className="flex items-center gap-1.5 shrink-0">
                    <span className="text-[10px] font-semibold text-slate-500">Excluir?</span>
                    <button
                      onClick={() => excluirTipo(t.id)}
                      disabled={salvandoTipo}
                      className="px-2.5 py-1.5 bg-red-600 text-white rounded-lg text-[10px] font-bold hover:bg-red-700 transition-colors cursor-pointer"
                    >
                      Sim
                    </button>
                    <button
                      onClick={() => setConfirmandoExclusao(null)}
                      className="px-2.5 py-1.5 bg-slate-100 text-slate-600 rounded-lg text-[10px] font-bold hover:bg-slate-200 transition-colors cursor-pointer"
                    >
                      Não
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      onClick={() => abrirEdicaoTipo(t)}
                      className="w-8 h-8 rounded-lg bg-slate-100 text-slate-500 flex items-center justify-center hover:bg-slate-200 transition-colors cursor-pointer"
                      title="Editar"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => setConfirmandoExclusao(t.id)}
                      className="w-8 h-8 rounded-lg bg-slate-100 text-red-500 flex items-center justify-center hover:bg-red-50 transition-colors cursor-pointer"
                      title="Excluir"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        ) : (
          <div className="space-y-3">
            <div className="space-y-2.5">
              {ORDEM_DIAS.map(({ chave, label }) => (
                <div key={chave} className="bg-white border border-slate-200/70 rounded-2xl p-4">
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-xs font-bold text-slate-700">{label}</p>
                    <button
                      onClick={() => adicionarJanela(chave)}
                      className="text-[10px] font-bold text-indigo-600 flex items-center gap-1 hover:text-indigo-700 transition-colors cursor-pointer"
                    >
                      <Plus className="w-3 h-3" /> Horário
                    </button>
                  </div>

                  {dias[chave].length === 0 ? (
                    <p className="text-[11px] text-slate-400">Fechado</p>
                  ) : (
                    <div className="space-y-1.5">
                      {dias[chave].map((j, idx) => (
                        <div key={idx} className="flex items-center gap-2">
                          <input
                            type="time"
                            value={j.inicio}
                            onChange={(e) => alterarJanela(chave, idx, "inicio", e.target.value)}
                            className="px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-xs text-slate-800 focus:outline-hidden focus:ring-2 focus:ring-indigo-200 focus:border-indigo-400 transition"
                          />
                          <span className="text-[10px] text-slate-400 font-semibold">até</span>
                          <input
                            type="time"
                            value={j.fim}
                            onChange={(e) => alterarJanela(chave, idx, "fim", e.target.value)}
                            className="px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-xs text-slate-800 focus:outline-hidden focus:ring-2 focus:ring-indigo-200 focus:border-indigo-400 transition"
                          />
                          <button
                            onClick={() => removerJanela(chave, idx)}
                            className="w-7 h-7 rounded-lg bg-slate-100 text-slate-400 flex items-center justify-center hover:bg-red-50 hover:text-red-500 transition-colors cursor-pointer ml-auto"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>

            <button
              onClick={salvarDisponibilidade}
              disabled={salvandoDisponibilidade || !disponibilidadeAlterada}
              className="w-full py-3 bg-indigo-600 text-white rounded-2xl text-xs font-bold flex items-center justify-center gap-2 hover:bg-indigo-700 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed sticky bottom-4"
            >
              {salvandoDisponibilidade ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : disponibilidadeAlterada ? (
                <Save className="w-4 h-4" />
              ) : (
                <CheckCircle2 className="w-4 h-4" />
              )}
              {disponibilidadeAlterada ? "Salvar disponibilidade" : "Disponibilidade salva"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
