import React, { useEffect, useState } from "react";
import { CalendarClock, Clock, ArrowRight } from "lucide-react";
import { auth } from "../firebase";
import { getApiUrl } from "../utils/nativeFile";

/**
 * ============================================================================
 * CARD "AGENDAMENTOS DE HOJE" — atalho da Visão Geral pra dentro do Agendamento
 * ============================================================================
 *
 * POR QUE ELE EXISTE
 *
 * A tela de Agendamento fica escondida no menu lateral — quem não abre ela
 * todo dia esquece que tem compromisso marcado. Este card busca a lista
 * (mesma rota GET /api/agendamento/lista que a própria tela usa), filtra só
 * o dia de hoje em horário de Brasília, e mostra na Visão Geral, que é a
 * primeira tela que a pessoa vê ao abrir o app.
 *
 * DIFERENTE DE CardBoletosAReceber: NUNCA SOME
 *
 * Aquele card é financeiro e some quando não há nada pendente — faz sentido
 * porque "nada a receber" não pede atenção nenhuma. Aqui é o oposto: um dia
 * sem agendamento nenhum também é uma informação útil ("nada marcado hoje"),
 * e o card continua servindo de atalho pra criar um novo. Por isso ele
 * ocupa o espaço ao lado do painel "A Receber" (que aí sim some sozinho
 * quando vazio) — ver o prop `slotSecundario` em PainelAReceber.tsx.
 */

type StatusAgendamento = "aguardando_pagamento" | "confirmado" | "a_caminho" | "concluido" | "cancelado";

type AgendamentoResumo = {
  id: string;
  tipoNome: string;
  status: StatusAgendamento;
  dataHoraInicio: string;
  clienteNome: string;
};

const RUBRICA: Record<StatusAgendamento, { rotulo: string; classe: string }> = {
  aguardando_pagamento: { rotulo: "Aguardando pagamento", classe: "bg-amber-100/60 text-amber-700" },
  confirmado: { rotulo: "Confirmado", classe: "bg-indigo-100/60 text-indigo-700" },
  a_caminho: { rotulo: "A caminho", classe: "bg-amber-100/60 text-amber-700" },
  concluido: { rotulo: "Concluído", classe: "bg-emerald-100/60 text-emerald-700" },
  cancelado: { rotulo: "Cancelado", classe: "bg-slate-200/60 text-slate-500" },
};

const hojeEmBrasilia = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });

const horaBR = (iso: string) =>
  new Date(iso).toLocaleTimeString("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" });

async function comToken(): Promise<Record<string, string>> {
  const t = await auth.currentUser?.getIdToken();
  if (!t) throw new Error("Você precisa estar logado.");
  return { Authorization: `Bearer ${t}` };
}

export default function CardAgendamentosDoDia({
  userId,
  onAbrir,
}: {
  userId?: string | null;
  onAbrir: () => void;
}) {
  const [carregado, setCarregado] = useState(false);
  const [hoje, setHoje] = useState<AgendamentoResumo[]>([]);

  useEffect(() => {
    if (!userId) return;
    let cancelado = false;
    (async () => {
      try {
        const r = await fetch(getApiUrl("/api/agendamento/lista"), { headers: await comToken() });
        const d = await r.json();
        if (cancelado || !d?.success) return;
        const dataAlvo = hojeEmBrasilia();
        const doDia = (d.agendamentos || [])
          .filter((a: AgendamentoResumo) => a.status !== "cancelado")
          .filter(
            (a: AgendamentoResumo) =>
              a.dataHoraInicio &&
              new Date(a.dataHoraInicio).toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" }) === dataAlvo
          )
          .sort((x: AgendamentoResumo, y: AgendamentoResumo) => x.dataHoraInicio.localeCompare(y.dataHoraInicio));
        setHoje(doDia);
        setCarregado(true);
      } catch {
        // Sem Agendamento configurado, ou sem internet: o card mostra o
        // estado vazio — não é um erro que mereça travar a Visão Geral.
        setCarregado(true);
      }
    })();
    return () => {
      cancelado = true;
    };
  }, [userId]);

  const visiveis = hoje.slice(0, 4);
  const excedente = hoje.length - visiveis.length;

  return (
    <div className="bg-white rounded-3xl border border-slate-200/60 shadow-xs overflow-hidden">
      <div
        onClick={onAbrir}
        className="px-6 py-5 border-b border-slate-100 flex items-start justify-between gap-4 cursor-pointer hover:bg-slate-50/50 transition-colors"
        title="Clique para abrir a agenda"
      >
        <div>
          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest flex items-center gap-1.5">
            <CalendarClock className="w-3.5 h-3.5 text-indigo-500" />
            Agendamentos de hoje
          </span>
          <h3 className="text-3xl font-display font-light text-slate-900 tracking-tight mt-1">
            {carregado ? hoje.length : "—"}
          </h3>
        </div>
        <span className="text-indigo-600 font-semibold text-[11px] flex items-center gap-1 shrink-0 mt-1">
          Ver agenda <ArrowRight className="w-3 h-3" />
        </span>
      </div>

      {!carregado ? (
        <div className="px-6 py-8 text-center">
          <p className="text-xs text-slate-400">Carregando…</p>
        </div>
      ) : visiveis.length === 0 ? (
        <div className="px-6 py-8 text-center space-y-2">
          <p className="text-xs text-slate-400">Nenhum agendamento marcado pra hoje.</p>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onAbrir();
            }}
            className="text-[11px] font-bold text-indigo-600 hover:text-indigo-700 cursor-pointer"
          >
            + Novo agendamento
          </button>
        </div>
      ) : (
        <div className="divide-y divide-slate-100">
          {visiveis.map((a) => (
            <div key={a.id} className="px-6 py-3.5 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-slate-800 truncate">{a.clienteNome || "Cliente"}</p>
                <p className="text-[11px] text-slate-400 truncate">{a.tipoNome}</p>
              </div>
              <div className="text-right shrink-0">
                <p className="text-xs font-bold text-slate-700 flex items-center gap-1 justify-end">
                  <Clock className="w-3 h-3 text-slate-300" /> {horaBR(a.dataHoraInicio)}
                </p>
                <span className={`inline-block mt-1 px-2 py-0.5 rounded-md text-[9px] font-extrabold uppercase ${RUBRICA[a.status].classe}`}>
                  {RUBRICA[a.status].rotulo}
                </span>
              </div>
            </div>
          ))}
          {excedente > 0 && (
            <div className="px-6 py-2.5 text-center text-[11px] text-indigo-600 font-semibold">
              +{excedente} {excedente === 1 ? "agendamento" : "agendamentos"}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
