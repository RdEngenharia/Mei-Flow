import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  X, Loader2, CalendarClock, Clock, User, MapPin, ChevronDown, Search, CheckCircle2,
} from "lucide-react";
import { auth } from "../firebase";
import { getApiUrl } from "../utils/nativeFile";
import { Cliente } from "../types";

/**
 * ============================================================================
 * MEI FLOW — Agendar (Fase 6)
 * ============================================================================
 *
 * O QUE É ISTO
 *
 * Modal para o PRÓPRIO PROFISSIONAL marcar um horário direto no app,
 * autenticado, sem passar pelo link público — desenhado em conversa com o
 * usuário e documentado em claude/AGENDAMENTO_GOOGLE_CALENDAR_ESTRUTURA.md
 * (projeto "Mei Flow"), Fase 6. Dois casos de uso, o mesmo componente:
 *
 *   1. "Novo agendamento" na aba Agendamentos — para clientes que não sabem
 *      ou não querem usar o link público. `clientes` habilita a busca por um
 *      cliente já cadastrado; sem seleção, os campos ficam em branco para
 *      digitar na hora.
 *   2. "Agendar" dentro de um orçamento aceito — `clientePreenchido` já
 *      chega com o que o orçamento sabe do cliente, e `origemOrcamentoId`
 *      amarra os dois registros.
 *
 * SEMPRE confirma direto, sem pagamento (POST /api/agendamento/criar) — é o
 * profissional falando com o cliente, dinheiro já foi ou será combinado por
 * fora (orçamento/venda). Por isso nenhum dado do cliente é obrigatório além
 * do nome: nem todo cliente passa CPF/CNPJ (isso só é exigido para pagamento
 * e nota fiscal, em outras telas), telefone completo ou endereço.
 */

type Tipo = { id: string; nome: string; duracaoPadraoMin: number };

type Endereco = {
  cep: string; logradouro: string; numero: string; complemento: string;
  bairro: string; cidade: string; uf: string;
};

const ENDERECO_VAZIO: Endereco = { cep: "", logradouro: "", numero: "", complemento: "", bairro: "", cidade: "", uf: "" };

function mascararTelefone(v: string): string {
  const d = v.replace(/\D/g, "").slice(0, 11);
  if (d.length <= 2) return d;
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
}

function mascararCep(v: string): string {
  const d = v.replace(/\D/g, "").slice(0, 8);
  return d.length > 5 ? `${d.slice(0, 5)}-${d.slice(5)}` : d;
}

function mascararDocumentoSimples(v: string): string {
  return v.replace(/[^\dA-Za-z]/g, "").slice(0, 14);
}

/** "2026-08-25" de hoje, no fuso de Brasília — mesmo cálculo do servidor. */
function hojeISOBrasilia(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
}

function horaBR(iso: string): string {
  return new Date(iso).toLocaleTimeString("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" });
}

function dataBRExtenso(iso: string): string {
  return new Date(iso).toLocaleDateString("pt-BR", {
    timeZone: "America/Sao_Paulo", weekday: "short", day: "2-digit", month: "long",
  });
}

async function comToken(): Promise<Record<string, string>> {
  const t = await auth.currentUser?.getIdToken();
  if (!t) throw new Error("Você precisa estar logado.");
  return { Authorization: `Bearer ${t}`, "Content-Type": "application/json" };
}

export interface ClientePreenchido {
  nome: string;
  documento?: string;
  telefone?: string;
  endereco?: Partial<Endereco>;
}

interface AgendarModalProps {
  onClose: () => void;
  onAgendado: (agendamentoId: string) => void;
  triggerToast?: (msg: string) => void;
  /** Modo "Novo agendamento": lista para buscar um cliente já cadastrado. */
  clientes?: Cliente[];
  /** Modo "Agendar" a partir de um orçamento: cliente já vem pronto. */
  clientePreenchido?: ClientePreenchido;
  origemOrcamentoId?: string;
  titulo?: string;
}

export default function AgendarModal({
  onClose, onAgendado, triggerToast, clientes, clientePreenchido, origemOrcamentoId, titulo,
}: AgendarModalProps) {
  const [tipos, setTipos] = useState<Tipo[]>([]);
  const [carregandoTipos, setCarregandoTipos] = useState(true);
  const [tipoId, setTipoId] = useState("");

  const [dataEscolhida, setDataEscolhida] = useState(hojeISOBrasilia());
  const [horarios, setHorarios] = useState<string[]>([]);
  const [carregandoHorarios, setCarregandoHorarios] = useState(false);
  const [horarioEscolhido, setHorarioEscolhido] = useState<string | null>(null);

  const [nome, setNome] = useState(clientePreenchido?.nome || "");
  const [telefone, setTelefone] = useState(mascararTelefone(clientePreenchido?.telefone || ""));
  const [documento, setDocumento] = useState(mascararDocumentoSimples(clientePreenchido?.documento || ""));
  const [endereco, setEndereco] = useState<Endereco>({ ...ENDERECO_VAZIO, ...(clientePreenchido?.endereco || {}) });
  const [buscandoCep, setBuscandoCep] = useState(false);

  const [buscaCliente, setBuscaCliente] = useState("");
  const [buscaAberta, setBuscaAberta] = useState(false);
  const buscaRef = useRef<HTMLDivElement>(null);

  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const modoOrcamento = !!clientePreenchido;

  // --------------------------------------------------------------- tipos --
  useEffect(() => {
    (async () => {
      setCarregandoTipos(true);
      try {
        const h = await comToken();
        const r = await fetch(getApiUrl("/api/agendamento/tipos"), { headers: h });
        const d = await r.json();
        if (d?.success) setTipos(d.tipos || []);
        else setErro(d?.mensagem || "Não foi possível carregar os tipos de agendamento.");
      } catch (e: any) {
        setErro(e?.message || "Não foi possível carregar os tipos de agendamento.");
      } finally {
        setCarregandoTipos(false);
      }
    })();
  }, []);

  // ------------------------------------------------------------ horários --
  const carregarHorarios = useCallback(async (tId: string, data: string) => {
    if (!tId) { setHorarios([]); return; }
    setCarregandoHorarios(true);
    setHorarioEscolhido(null);
    setErro(null);
    try {
      const h = await comToken();
      const r = await fetch(
        getApiUrl(`/api/agendamento/horarios?tipoId=${encodeURIComponent(tId)}&data=${data}`),
        { headers: h }
      );
      const d = await r.json();
      if (d?.success) setHorarios(d.horarios || []);
      else setErro(d?.mensagem || "Não foi possível carregar os horários.");
    } catch (e: any) {
      setErro(e?.message || "Não foi possível carregar os horários.");
    } finally {
      setCarregandoHorarios(false);
    }
  }, []);

  useEffect(() => {
    carregarHorarios(tipoId, dataEscolhida);
  }, [tipoId, dataEscolhida, carregarHorarios]);

  // ------------------------------------------------------------------ CEP --
  const buscarCep = async (cepDigitado: string) => {
    const d = cepDigitado.replace(/\D/g, "");
    if (d.length !== 8) return;
    setBuscandoCep(true);
    try {
      const r = await fetch(`https://viacep.com.br/ws/${d}/json/`);
      const j = await r.json();
      if (!j?.erro) {
        setEndereco((e) => ({
          ...e,
          logradouro: j.logradouro || e.logradouro,
          bairro: j.bairro || e.bairro,
          cidade: j.localidade || e.cidade,
          uf: j.uf || e.uf,
        }));
      }
    } catch {
      // sem CEP encontrado não trava nada — a pessoa preenche na mão
    } finally {
      setBuscandoCep(false);
    }
  };

  // ----------------------------------------------------- busca de cliente --
  useEffect(() => {
    const fechar = (e: MouseEvent) => {
      if (buscaRef.current && !buscaRef.current.contains(e.target as Node)) setBuscaAberta(false);
    };
    document.addEventListener("mousedown", fechar);
    return () => document.removeEventListener("mousedown", fechar);
  }, []);

  const termo = buscaCliente.trim().toLowerCase();
  const clientesFiltrados = (clientes || []).filter((c) => !termo || c.nome.toLowerCase().includes(termo));

  const selecionarClienteExistente = (c: Cliente) => {
    setNome(c.nome);
    setTelefone(mascararTelefone(c.telefone || ""));
    setDocumento(mascararDocumentoSimples(c.documento || ""));
    setEndereco({
      cep: mascararCep(c.endereco?.cep || ""),
      logradouro: c.endereco?.logradouro || "",
      numero: c.endereco?.numero || "",
      complemento: c.endereco?.complemento || "",
      bairro: c.endereco?.bairro || "",
      cidade: c.endereco?.cidade || "",
      uf: c.endereco?.uf || "",
    });
    setBuscaAberta(false);
    setBuscaCliente("");
  };

  // -------------------------------------------------------------- enviar --
  const confirmar = async () => {
    if (!tipoId) { setErro("Escolha um tipo de agendamento."); return; }
    if (!horarioEscolhido) { setErro("Escolha um horário."); return; }
    if (!nome.trim()) { setErro("Informe o nome do cliente."); return; }

    setEnviando(true);
    setErro(null);
    try {
      const h = await comToken();
      const r = await fetch(getApiUrl("/api/agendamento/criar"), {
        method: "POST",
        headers: h,
        body: JSON.stringify({
          tipoId,
          dataHoraInicio: horarioEscolhido,
          cliente: {
            nome: nome.trim(),
            telefone: telefone.replace(/\D/g, ""),
            documento: documento.replace(/\D/g, "") || undefined,
            cep: endereco.cep.replace(/\D/g, ""),
            logradouro: endereco.logradouro.trim(),
            numero: endereco.numero.trim(),
            complemento: endereco.complemento.trim(),
            bairro: endereco.bairro.trim(),
            cidade: endereco.cidade.trim(),
            uf: endereco.uf.trim(),
          },
          origemOrcamentoId: origemOrcamentoId || undefined,
        }),
      });
      const d = await r.json();
      if (!r.ok || !d?.success) throw new Error(d?.mensagem || "Não foi possível criar o agendamento.");
      triggerToast?.("✓ Agendamento confirmado.");
      onAgendado(d.agendamentoId);
    } catch (e: any) {
      setErro(e?.message || "Não foi possível criar o agendamento.");
    } finally {
      setEnviando(false);
    }
  };

  const tipoEscolhido = tipos.find((t) => t.id === tipoId) || null;

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-white rounded-3xl w-full max-w-lg max-h-[90vh] overflow-y-auto shadow-2xl">
        <div className="sticky top-0 bg-white border-b border-slate-100 px-5 py-4 flex items-center justify-between rounded-t-3xl">
          <div className="flex items-center gap-2">
            <CalendarClock className="w-4 h-4 text-indigo-500" />
            <h3 className="text-sm font-extrabold text-slate-800">
              {titulo || (modoOrcamento ? "Agendar a partir do orçamento" : "Novo agendamento")}
            </h3>
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-slate-100 rounded-lg cursor-pointer">
            <X className="w-4 h-4 text-slate-400" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {erro && (
            <p className="text-xs font-semibold text-rose-600 bg-rose-50 border border-rose-100 rounded-xl px-3.5 py-2.5">
              {erro}
            </p>
          )}

          {/* --------------------------------------------------- tipo -- */}
          <div>
            <label className="text-[10px] font-extrabold uppercase tracking-widest text-slate-400">Tipo de agendamento</label>
            {carregandoTipos ? (
              <p className="text-xs text-slate-400 mt-1.5 flex items-center gap-1.5"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Carregando...</p>
            ) : tipos.length === 0 ? (
              <p className="text-xs text-slate-400 mt-1.5">Cadastre um tipo de agendamento na aba "Tipos" primeiro.</p>
            ) : (
              <select
                value={tipoId}
                onChange={(e) => setTipoId(e.target.value)}
                className="w-full mt-1.5 px-3.5 py-2.5 rounded-xl border border-slate-200 bg-white text-xs text-slate-800 focus:outline-hidden focus:ring-2 focus:ring-indigo-200 focus:border-indigo-400 transition"
              >
                <option value="">Selecione...</option>
                {tipos.map((t) => (
                  <option key={t.id} value={t.id}>{t.nome} ({t.duracaoPadraoMin} min)</option>
                ))}
              </select>
            )}
          </div>

          {/* -------------------------------------------------- data -- */}
          {tipoId && (
            <div>
              <label className="text-[10px] font-extrabold uppercase tracking-widest text-slate-400">Data</label>
              <input
                type="date"
                min={hojeISOBrasilia()}
                value={dataEscolhida}
                onChange={(e) => setDataEscolhida(e.target.value)}
                className="w-full mt-1.5 px-3.5 py-2.5 rounded-xl border border-slate-200 bg-white text-xs text-slate-800 focus:outline-hidden focus:ring-2 focus:ring-indigo-200 focus:border-indigo-400 transition"
              />

              <label className="text-[10px] font-extrabold uppercase tracking-widest text-slate-400 mt-3 block">Horário</label>
              {carregandoHorarios ? (
                <p className="text-xs text-slate-400 mt-1.5 flex items-center gap-1.5"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Carregando horários...</p>
              ) : horarios.length === 0 ? (
                <p className="text-xs text-slate-400 mt-1.5">Nenhum horário livre em {dataBRExtenso(`${dataEscolhida}T12:00:00-03:00`)}.</p>
              ) : (
                <div className="grid grid-cols-4 gap-1.5 mt-1.5">
                  {horarios.map((h) => (
                    <button
                      key={h}
                      type="button"
                      onClick={() => setHorarioEscolhido(h)}
                      className={`py-2 rounded-lg text-xs font-bold cursor-pointer transition ${
                        horarioEscolhido === h
                          ? "bg-indigo-600 text-white"
                          : "bg-slate-50 text-slate-700 hover:bg-slate-100 border border-slate-200"
                      }`}
                    >
                      {horaBR(h)}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ----------------------------------------------- cliente -- */}
          <div className="pt-2 border-t border-slate-100 space-y-3">
            <div className="flex items-center gap-1.5">
              <User className="w-3.5 h-3.5 text-slate-400" />
              <span className="text-[10px] font-extrabold uppercase tracking-widest text-slate-400">Cliente</span>
            </div>

            {!modoOrcamento && clientes && clientes.length > 0 && (
              <div className="relative" ref={buscaRef}>
                <button
                  type="button"
                  onClick={() => setBuscaAberta((a) => !a)}
                  className="w-full bg-slate-50 border border-slate-200 text-slate-500 rounded-xl py-2.5 px-3 text-xs text-left flex items-center justify-between gap-2 cursor-pointer"
                >
                  <span className="flex items-center gap-1.5"><Search className="w-3.5 h-3.5" /> Buscar cliente já cadastrado (opcional)</span>
                  <ChevronDown className="w-3.5 h-3.5 shrink-0" />
                </button>
                {buscaAberta && (
                  <div className="absolute z-10 mt-1 w-full bg-white border border-slate-200 rounded-xl shadow-lg overflow-hidden">
                    <div className="p-2 border-b border-slate-100">
                      <input
                        autoFocus
                        type="text"
                        placeholder="Buscar por nome..."
                        value={buscaCliente}
                        onChange={(e) => setBuscaCliente(e.target.value)}
                        className="w-full px-2.5 py-2 text-xs border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-indigo-400"
                      />
                    </div>
                    <div className="max-h-40 overflow-y-auto">
                      {clientesFiltrados.length === 0 ? (
                        <p className="px-3.5 py-3 text-xs text-slate-400 text-center">Nenhum cliente encontrado.</p>
                      ) : (
                        clientesFiltrados.map((c) => (
                          <div
                            key={c.id}
                            onClick={() => selecionarClienteExistente(c)}
                            className="px-3.5 py-2 text-xs cursor-pointer hover:bg-indigo-50 text-slate-700"
                          >
                            {c.nome}{c.documento ? ` — ${c.documento}` : ""}
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}

            <input
              type="text"
              placeholder="Nome do cliente *"
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 bg-white text-xs text-slate-800 focus:outline-hidden focus:ring-2 focus:ring-indigo-200 focus:border-indigo-400 transition"
            />
            <div className="grid grid-cols-2 gap-2">
              <input
                type="text"
                placeholder="Telefone (opcional)"
                value={telefone}
                onChange={(e) => setTelefone(mascararTelefone(e.target.value))}
                className="px-3.5 py-2.5 rounded-xl border border-slate-200 bg-white text-xs text-slate-800 focus:outline-hidden focus:ring-2 focus:ring-indigo-200 focus:border-indigo-400 transition"
              />
              <input
                type="text"
                placeholder="CPF/CNPJ (opcional)"
                value={documento}
                onChange={(e) => setDocumento(mascararDocumentoSimples(e.target.value))}
                className="px-3.5 py-2.5 rounded-xl border border-slate-200 bg-white text-xs text-slate-800 focus:outline-hidden focus:ring-2 focus:ring-indigo-200 focus:border-indigo-400 transition"
              />
            </div>

            <div className="flex items-center gap-1.5 pt-1">
              <MapPin className="w-3.5 h-3.5 text-slate-400" />
              <span className="text-[10px] font-extrabold uppercase tracking-widest text-slate-400">Endereço (opcional)</span>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div className="relative col-span-1">
                <input
                  type="text"
                  placeholder="CEP"
                  value={endereco.cep}
                  onChange={(e) => setEndereco({ ...endereco, cep: mascararCep(e.target.value) })}
                  onBlur={(e) => buscarCep(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 bg-white text-xs text-slate-800 focus:outline-hidden focus:ring-2 focus:ring-indigo-200 focus:border-indigo-400 transition"
                />
                {buscandoCep && <Loader2 className="w-3.5 h-3.5 animate-spin text-slate-400 absolute right-2.5 top-1/2 -translate-y-1/2" />}
              </div>
              <input
                type="text"
                placeholder="Número"
                value={endereco.numero}
                onChange={(e) => setEndereco({ ...endereco, numero: e.target.value })}
                className="col-span-2 px-3.5 py-2.5 rounded-xl border border-slate-200 bg-white text-xs text-slate-800 focus:outline-hidden focus:ring-2 focus:ring-indigo-200 focus:border-indigo-400 transition"
              />
            </div>
            <input
              type="text"
              placeholder="Rua"
              value={endereco.logradouro}
              onChange={(e) => setEndereco({ ...endereco, logradouro: e.target.value })}
              className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 bg-white text-xs text-slate-800 focus:outline-hidden focus:ring-2 focus:ring-indigo-200 focus:border-indigo-400 transition"
            />
            <div className="grid grid-cols-3 gap-2">
              <input
                type="text"
                placeholder="Bairro"
                value={endereco.bairro}
                onChange={(e) => setEndereco({ ...endereco, bairro: e.target.value })}
                className="col-span-1 px-3.5 py-2.5 rounded-xl border border-slate-200 bg-white text-xs text-slate-800 focus:outline-hidden focus:ring-2 focus:ring-indigo-200 focus:border-indigo-400 transition"
              />
              <input
                type="text"
                placeholder="Cidade"
                value={endereco.cidade}
                onChange={(e) => setEndereco({ ...endereco, cidade: e.target.value })}
                className="col-span-1 px-3.5 py-2.5 rounded-xl border border-slate-200 bg-white text-xs text-slate-800 focus:outline-hidden focus:ring-2 focus:ring-indigo-200 focus:border-indigo-400 transition"
              />
              <input
                type="text"
                placeholder="UF"
                maxLength={2}
                value={endereco.uf}
                onChange={(e) => setEndereco({ ...endereco, uf: e.target.value.toUpperCase() })}
                className="col-span-1 px-3.5 py-2.5 rounded-xl border border-slate-200 bg-white text-xs text-slate-800 focus:outline-hidden focus:ring-2 focus:ring-indigo-200 focus:border-indigo-400 transition"
              />
            </div>
          </div>

          <button
            onClick={confirmar}
            disabled={enviando || !tipoId || !horarioEscolhido || !nome.trim()}
            className="w-full py-3 bg-indigo-600 text-white rounded-2xl text-xs font-bold flex items-center justify-center gap-2 hover:bg-indigo-700 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {enviando ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
            {tipoEscolhido && horarioEscolhido
              ? `Confirmar ${tipoEscolhido.nome} — ${dataBRExtenso(horarioEscolhido)} às ${horaBR(horarioEscolhido)}`
              : "Confirmar agendamento"}
          </button>
        </div>
      </div>
    </div>
  );
}
