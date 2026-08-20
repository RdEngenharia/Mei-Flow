import React, { useCallback, useEffect, useState } from "react";
import {
  CalendarClock, Plus, Pencil, Trash2, Loader2, AlertTriangle, Save,
  X, Wallet, Clock, Info, CheckCircle2,
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

const TIPO_VAZIO = { nome: "", duracaoPadraoMin: 60, exigePagamento: false };

export default function AgendamentoConfigPanel({ triggerToast }: Props) {
  const [abaInterna, setAbaInterna] = useState<"tipos" | "disponibilidade">("tipos");
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

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
      const [rTipos, rDisp] = await Promise.all([
        fetch(getApiUrl("/api/agendamento/tipos"), { headers: h }),
        fetch(getApiUrl("/api/agendamento/disponibilidade"), { headers: h }),
      ]);

      const dTipos = await rTipos.json();
      if (dTipos?.success) setTipos(dTipos.tipos || []);
      else if (rTipos.status === 401) throw new Error("NAO_AUTENTICADO");

      const dDisp = await rDisp.json();
      if (dDisp?.success) setDias({ ...DIAS_VAZIOS, ...dDisp.dias });
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

  // ---------------------------------------------------------------- Tipos --

  const abrirNovoTipo = () => {
    setEditandoId(null);
    setFormTipo({ ...TIPO_VAZIO });
    setErro(null);
  };

  const abrirEdicaoTipo = (t: TipoAgendamento) => {
    setEditandoId(t.id);
    setFormTipo({ nome: t.nome, duracaoPadraoMin: t.duracaoPadraoMin, exigePagamento: t.exigePagamento });
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
            Esta é a base do agendamento: cadastre os serviços que você oferece e os horários em
            que atende. O link público para o cliente marcar horário, a conexão com o Google
            Calendar e o relatório mensal chegam nas próximas etapas.
          </p>
        </div>

        {erro && (
          <div className="bg-red-50 border border-red-200 rounded-2xl p-4 flex gap-3">
            <AlertTriangle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
            <p className="text-xs text-red-900 leading-relaxed">{erro}</p>
          </div>
        )}

        <div className="flex gap-1.5 bg-slate-100 rounded-2xl p-1 w-fit">
          {(["tipos", "disponibilidade"] as const).map((aba) => (
            <button
              key={aba}
              onClick={() => setAbaInterna(aba)}
              className={`px-4 py-2 rounded-xl text-xs font-bold transition-colors cursor-pointer ${
                abaInterna === aba ? "bg-white text-indigo-700 shadow-xs" : "text-slate-500 hover:text-slate-700"
              }`}
            >
              {aba === "tipos" ? "Tipos de agendamento" : "Disponibilidade"}
            </button>
          ))}
        </div>

        {carregando ? (
          <div className="py-16 flex flex-col items-center gap-3 text-slate-400">
            <Loader2 className="w-6 h-6 animate-spin" />
            <p className="text-xs font-medium">Carregando…</p>
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
                        <Wallet className="w-2.5 h-2.5" /> Exige pagamento
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
