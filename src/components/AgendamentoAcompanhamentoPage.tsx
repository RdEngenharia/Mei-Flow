import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  CalendarClock, Loader2, AlertTriangle, Clock, MapPin, CheckCircle2,
  Truck, XCircle, ChevronLeft, RefreshCw, Ban,
} from "lucide-react";

/**
 * ============================================================================
 * MEI FLOW — Página de acompanhamento do agendamento (Fase 4)
 * ============================================================================
 *
 * Página SEM LOGIN, aberta em /acompanhar/{agendamentoId} — o id do próprio
 * documento `agendamentos` (gerado pelo Firestore, já aleatório e não
 * sequencial: é isso que protege o link, ver seção 7 do desenho). O
 * profissional manda este link pro cliente (Mensagem-modelo 2, Fase 5) depois
 * que o agendamento é criado.
 *
 * UMA TELA SÓ, que muda de conteúdo conforme o estado avança — não são
 * páginas separadas: confirmado → a caminho (toggle manual do profissional,
 * Fase 4) → concluído (baixa, Fase 6) ou cancelado a qualquer momento antes.
 *
 * Reagendar/cancelar: a REGRA (1h de antecedência + profissional ainda não a
 * caminho, só pra reagendar) mora no servidor (agendamentoPublico.ts) — aqui
 * a tela só mostra/esconde os botões a partir do que o servidor respondeu,
 * nunca decide sozinha (o cliente não pode burlar adiantando o relógio do
 * celular).
 */

type Detalhe = {
  status: "aguardando_pagamento" | "confirmado" | "a_caminho" | "concluido" | "cancelado";
  userId: string;
  tipoId: string;
  tipoNome: string;
  duracaoMin: number;
  dataHoraInicio: string;
  enderecoTexto: string;
  clienteNome: string;
  valor: number;
  exigePagamento: boolean;
  podeReagendar: boolean;
  motivoBloqueioReagendamento: string | null;
  podeCancelar: boolean;
};

function horaBR(iso: string): string {
  return new Date(iso).toLocaleTimeString("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" });
}

function dataBRExtenso(iso: string): string {
  return new Date(iso).toLocaleDateString("pt-BR", {
    timeZone: "America/Sao_Paulo", weekday: "long", day: "2-digit", month: "long",
  });
}

function hojeISOBrasilia(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
}

/** Contagem regressiva legível: "faltam 2h 14min", "faltam 40min", "é daqui a pouco". */
function contagem(iso: string, agora: number): string {
  const diffMs = new Date(iso).getTime() - agora;
  if (diffMs <= 0) return "é agora";
  const min = Math.floor(diffMs / 60000);
  if (min < 1) return "é daqui a pouco";
  if (min < 60) return `faltam ${min}min`;
  const h = Math.floor(min / 60);
  const resto = min % 60;
  return resto ? `faltam ${h}h ${resto}min` : `faltam ${h}h`;
}

async function api(caminho: string, opcoes?: RequestInit) {
  const r = await fetch(`/api/agendamento/publico${caminho}`, {
    ...opcoes,
    headers: { "Content-Type": "application/json", ...(opcoes?.headers || {}) },
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || !d?.success) throw new Error(d?.mensagem || "Algo deu errado. Tente novamente.");
  return d;
}

const ESTADOS: Record<string, { rotulo: string; icone: React.ReactNode; cor: string }> = {
  confirmado: { rotulo: "Confirmado", icone: <CheckCircle2 className="w-6 h-6" />, cor: "text-indigo-600 bg-indigo-50 border-indigo-100" },
  a_caminho: { rotulo: "Profissional a caminho", icone: <Truck className="w-6 h-6" />, cor: "text-amber-600 bg-amber-50 border-amber-100" },
  concluido: { rotulo: "Serviço concluído", icone: <CheckCircle2 className="w-6 h-6" />, cor: "text-emerald-600 bg-emerald-50 border-emerald-100" },
  cancelado: { rotulo: "Cancelado", icone: <XCircle className="w-6 h-6" />, cor: "text-slate-500 bg-slate-100 border-slate-200" },
  aguardando_pagamento: { rotulo: "Aguardando pagamento", icone: <Clock className="w-6 h-6" />, cor: "text-amber-600 bg-amber-50 border-amber-100" },
};

export default function AgendamentoAcompanhamentoPage() {
  const id = useMemo(() => {
    const m = window.location.pathname.match(/\/acompanhar\/([^/]+)/);
    return m ? decodeURIComponent(m[1]) : "";
  }, []);

  const [carregando, setCarregando] = useState(true);
  const [erroInicial, setErroInicial] = useState<string | null>(null);
  const [d, setD] = useState<Detalhe | null>(null);
  const [agoraTick, setAgoraTick] = useState(Date.now());

  const [modo, setModo] = useState<"ver" | "reagendar">("ver");
  const [dataEscolhida, setDataEscolhida] = useState(hojeISOBrasilia());
  const [horarios, setHorarios] = useState<string[]>([]);
  const [carregandoHorarios, setCarregandoHorarios] = useState(false);
  const [horarioEscolhido, setHorarioEscolhido] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [erroAcao, setErroAcao] = useState<string | null>(null);
  const [confirmandoCancelamento, setConfirmandoCancelamento] = useState(false);

  const carregar = useCallback(async () => {
    try {
      const dados = await api(`/agendamento/${id}`);
      setD(dados);
    } catch (e: any) {
      setErroInicial(e?.message || "Não foi possível carregar este agendamento.");
    } finally {
      setCarregando(false);
    }
  }, [id]);

  useEffect(() => {
    if (!id) {
      setErroInicial("Link inválido.");
      setCarregando(false);
      return;
    }
    carregar();
  }, [id, carregar]);

  // Reconfere periodicamente (o profissional pode marcar "a caminho" a
  // qualquer momento) e sempre que a pessoa volta pra esta aba.
  useEffect(() => {
    const intervalo = setInterval(carregar, 30000);
    const aoFocar = () => carregar();
    window.addEventListener("focus", aoFocar);
    return () => {
      clearInterval(intervalo);
      window.removeEventListener("focus", aoFocar);
    };
  }, [carregar]);

  useEffect(() => {
    const t = setInterval(() => setAgoraTick(Date.now()), 30000);
    return () => clearInterval(t);
  }, []);

  const carregarHorarios = useCallback(
    async (data: string) => {
      if (!d) return;
      setCarregandoHorarios(true);
      setHorarioEscolhido(null);
      setHorarios([]);
      try {
        const dados = await api(`/${d.userId}/horarios?tipoId=${encodeURIComponent(d.tipoId)}&data=${data}`);
        setHorarios(dados.horarios || []);
      } catch (e: any) {
        setErroAcao(e?.message || "Não foi possível carregar os horários.");
      } finally {
        setCarregandoHorarios(false);
      }
    },
    [d]
  );

  useEffect(() => {
    if (modo === "reagendar") carregarHorarios(dataEscolhida);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modo, dataEscolhida]);

  const confirmarReagendamento = async () => {
    if (!horarioEscolhido) return;
    setSalvando(true);
    setErroAcao(null);
    try {
      await api(`/agendamento/${id}/reagendar`, {
        method: "POST",
        body: JSON.stringify({ novoDataHoraInicio: horarioEscolhido }),
      });
      setModo("ver");
      await carregar();
    } catch (e: any) {
      setErroAcao(e?.message || "Não foi possível reagendar.");
    } finally {
      setSalvando(false);
    }
  };

  const cancelar = async () => {
    setSalvando(true);
    setErroAcao(null);
    try {
      await api(`/agendamento/${id}/cancelar`, { method: "POST" });
      await carregar();
    } catch (e: any) {
      setErroAcao(e?.message || "Não foi possível cancelar.");
    } finally {
      setSalvando(false);
      setConfirmandoCancelamento(false);
    }
  };

  if (carregando) {
    return (
      <Central>
        <Loader2 className="w-7 h-7 animate-spin text-indigo-600" />
      </Central>
    );
  }

  if (erroInicial || !d) {
    return (
      <Central>
        <AlertTriangle className="w-8 h-8 text-red-500" />
        <p className="text-sm text-slate-700 mt-3 text-center max-w-sm">{erroInicial}</p>
      </Central>
    );
  }

  const estado = ESTADOS[d.status] || ESTADOS.confirmado;

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col items-center py-8 px-4">
      <div className="w-full max-w-md">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-11 h-11 rounded-2xl bg-indigo-600 text-white flex items-center justify-center shrink-0">
            <CalendarClock className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <p className="text-[10px] font-extrabold uppercase tracking-widest text-slate-400">Seu agendamento</p>
            <h1 className="text-lg font-bold text-slate-900 truncate">{d.tipoNome}</h1>
          </div>
        </div>

        <div className="bg-white border border-slate-200/70 rounded-3xl shadow-xs overflow-hidden p-5 space-y-4">
          <div className={`rounded-2xl border p-4 flex items-center gap-3 ${estado.cor}`}>
            {estado.icone}
            <div className="min-w-0">
              <p className="text-sm font-bold">{estado.rotulo}</p>
              {(d.status === "confirmado" || d.status === "a_caminho") && (
                <p className="text-xs opacity-80 capitalize">{contagem(d.dataHoraInicio, agoraTick)}</p>
              )}
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm text-slate-700">
              <Clock className="w-4 h-4 text-slate-400 shrink-0" />
              <span className="capitalize">{dataBRExtenso(d.dataHoraInicio)}</span>
              <span className="font-bold">às {horaBR(d.dataHoraInicio)}</span>
            </div>
            {d.enderecoTexto && (
              <div className="flex items-start gap-2 text-sm text-slate-700">
                <MapPin className="w-4 h-4 text-slate-400 shrink-0 mt-0.5" />
                <span>{d.enderecoTexto}</span>
              </div>
            )}
          </div>

          {d.status === "concluido" && (
            <p className="text-xs text-slate-500 leading-relaxed pt-2 border-t border-slate-100">
              Obrigado por agendar pelo MEI Flow! Se o profissional pedir uma avaliação, o link
              chega por mensagem separada.
            </p>
          )}

          {d.status === "cancelado" && (
            <p className="text-xs text-slate-500 leading-relaxed pt-2 border-t border-slate-100">
              Este agendamento foi cancelado. Se ainda precisar do serviço, marque um novo horário
              com o profissional.
            </p>
          )}

          {(d.status === "confirmado" || d.status === "a_caminho") && modo === "ver" && (
            <div className="pt-2 border-t border-slate-100 space-y-2.5">
              {d.motivoBloqueioReagendamento && (
                <p className="text-[11px] text-slate-400 leading-relaxed">{d.motivoBloqueioReagendamento}</p>
              )}
              <div className="flex gap-2">
                {d.podeReagendar && (
                  <button
                    onClick={() => {
                      setErroAcao(null);
                      setModo("reagendar");
                    }}
                    className="flex-1 py-2.5 bg-indigo-50 text-indigo-700 border border-indigo-100 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 hover:bg-indigo-100 transition-colors cursor-pointer"
                  >
                    <RefreshCw className="w-3.5 h-3.5" /> Reagendar
                  </button>
                )}
                {d.podeCancelar &&
                  (confirmandoCancelamento ? (
                    <div className="flex-1 flex items-center gap-1.5">
                      <button
                        onClick={cancelar}
                        disabled={salvando}
                        className="flex-1 py-2.5 bg-red-600 text-white rounded-xl text-[11px] font-bold hover:bg-red-700 transition-colors cursor-pointer disabled:opacity-60"
                      >
                        {salvando ? "Cancelando…" : "Confirmar"}
                      </button>
                      <button
                        onClick={() => setConfirmandoCancelamento(false)}
                        className="px-3 py-2.5 bg-slate-100 text-slate-600 rounded-xl text-[11px] font-bold hover:bg-slate-200 transition-colors cursor-pointer"
                      >
                        Voltar
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setConfirmandoCancelamento(true)}
                      className="flex-1 py-2.5 bg-slate-50 text-slate-500 border border-slate-200 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 hover:bg-red-50 hover:text-red-600 hover:border-red-100 transition-colors cursor-pointer"
                    >
                      <Ban className="w-3.5 h-3.5" /> Cancelar
                    </button>
                  ))}
              </div>
              {d.exigePagamento && d.podeCancelar && !confirmandoCancelamento && (
                <p className="text-[10px] text-slate-400">Cancelar não reembolsa o valor já pago.</p>
              )}
            </div>
          )}

          {modo === "reagendar" && (
            <div className="pt-2 border-t border-slate-100 space-y-3">
              <button
                onClick={() => {
                  setModo("ver");
                  setErroAcao(null);
                }}
                className="text-[11px] font-bold text-slate-400 hover:text-slate-600 flex items-center gap-1 cursor-pointer"
              >
                <ChevronLeft className="w-3.5 h-3.5" /> Cancelar reagendamento
              </button>

              <div>
                <label className="block text-[10px] font-extrabold uppercase tracking-widest text-slate-400 mb-1.5">
                  Nova data
                </label>
                <input
                  type="date"
                  min={hojeISOBrasilia()}
                  value={dataEscolhida}
                  onChange={(e) => setDataEscolhida(e.target.value)}
                  className="w-full px-4 py-2.5 rounded-xl border border-slate-200 bg-white text-sm text-slate-800 focus:outline-hidden focus:ring-2 focus:ring-indigo-200 focus:border-indigo-400 transition"
                />
              </div>

              <div>
                <label className="block text-[10px] font-extrabold uppercase tracking-widest text-slate-400 mb-2">
                  Horários disponíveis
                </label>
                {carregandoHorarios ? (
                  <div className="py-8 flex justify-center">
                    <Loader2 className="w-5 h-5 animate-spin text-indigo-600" />
                  </div>
                ) : horarios.length === 0 ? (
                  <p className="text-xs text-slate-400 py-4 text-center">Nenhum horário livre neste dia.</p>
                ) : (
                  <div className="grid grid-cols-3 gap-2">
                    {horarios.map((h) => (
                      <button
                        key={h}
                        onClick={() => setHorarioEscolhido(h)}
                        className={`py-2.5 rounded-xl text-xs font-bold border transition-colors cursor-pointer ${
                          horarioEscolhido === h
                            ? "bg-indigo-600 border-indigo-600 text-white"
                            : "bg-white border-slate-200 text-slate-700 hover:border-indigo-300"
                        }`}
                      >
                        {horaBR(h)}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {erroAcao && (
                <div className="bg-red-50 border border-red-200 rounded-2xl p-3 flex gap-2.5">
                  <AlertTriangle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
                  <p className="text-xs text-red-900 leading-relaxed">{erroAcao}</p>
                </div>
              )}

              <button
                onClick={confirmarReagendamento}
                disabled={!horarioEscolhido || salvando}
                className="w-full py-3 bg-indigo-600 text-white rounded-2xl text-sm font-bold flex items-center justify-center gap-2 hover:bg-indigo-700 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {salvando && <Loader2 className="w-4 h-4 animate-spin" />}
                Confirmar novo horário
              </button>
            </div>
          )}

          {erroAcao && modo === "ver" && (
            <div className="bg-red-50 border border-red-200 rounded-2xl p-3 flex gap-2.5">
              <AlertTriangle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
              <p className="text-xs text-red-900 leading-relaxed">{erroAcao}</p>
            </div>
          )}
        </div>

        <p className="text-center text-[10px] text-slate-400 mt-6">Agendamento via MEI Flow</p>
      </div>
    </div>
  );
}

function Central({ children }: { children: React.ReactNode }) {
  return <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center px-4">{children}</div>;
}
