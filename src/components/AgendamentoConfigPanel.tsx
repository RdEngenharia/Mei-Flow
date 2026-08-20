import React, { useCallback, useEffect, useState } from "react";
import {
  CalendarClock, Plus, Pencil, Trash2, Loader2, AlertTriangle, Save,
  X, Wallet, Clock, Info, CheckCircle2, ExternalLink, Unlink, Mail, ShieldCheck,
  Link2, Copy, Check, Truck, MapPin, Phone, Ban, ClipboardList, FileText,
  BarChart3, Download, MessageSquareText,
} from "lucide-react";
import { auth } from "../firebase";
import { getApiUrl, savePdfCrossPlatform, isNativePlatform } from "../utils/nativeFile";
import { carregarLogoBase64 } from "../utils/logoImagem";
import { desenharRelatorioAgendamento, nomeArquivoRelatorioAgendamento } from "../utils/agendamentoRelatorioPdf";
import { Cliente } from "../types";
import AgendarModal from "./AgendarModal";

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
  /** Fase 6 — lista de clientes já cadastrados, para o "Novo agendamento" buscar em vez de digitar do zero. */
  clientes?: Cliente[];
  /**
   * Fase 6 — chamado quando o profissional clica "Gerar orçamento" num
   * agendamento. Quem cria o Cliente/Orçamento (sempre pelo SDK do cliente,
   * nunca pelo servidor) e marca a baixa é o App.tsx — este painel só pede e
   * recarrega a lista quando a Promise resolve `true`.
   */
  onGerarOrcamento?: (agendamento: Agendamento) => Promise<boolean>;
  // Fase 6b — mesmos dados que já alimentam o cabeçalho do PDF do orçamento
  // (OrcamentoGenerator), reaproveitados aqui pro cabeçalho do PDF do
  // relatório mensal. Nenhum é obrigatório: sem eles o PDF só sai mais simples.
  planType?: "free" | "premium";
  companyLogo?: string;
  meiName?: string;
  cnpjPrestador?: string;
  telefonePrestador?: string;
  emailPrestador?: string;
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
  tipoId?: string | null;
  tipoNome: string;
  duracaoMin: number;
  status: StatusAgendamento;
  dataHoraInicio: string;
  enderecoTexto: string;
  clienteNome: string;
  clienteTelefone: string;
  // CPF/CNPJ é opcional — nem todo agendamento tem um (só é pedido quando o
  // link público exigiu pagamento). `null` é normal.
  clienteDocumento?: string | null;
  endereco?: {
    cep?: string; logradouro?: string; numero?: string; complemento?: string;
    bairro?: string; cidade?: string; uf?: string;
  };
  valor: number;
  exigePagamento: boolean;
  // Fase 6 — vínculo com Orçamento (ver claude/AGENDAMENTO_GOOGLE_CALENDAR_ESTRUTURA.md).
  origemOrcamentoId?: string | null;
  orcamentoGeradoId?: string | null;
  // Fase 6b — horário real de início (marcado em "a caminho") e descrição do
  // que foi feito, editável a qualquer momento depois da baixa.
  aCaminhoEm?: string | null;
  descricaoServico?: string | null;
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

/**
 * FASE 6b — conversão ISO ⇄ <input type="datetime-local">, sempre em
 * horário de Brasília (mesma convenção fixa -03:00 usada no resto da
 * feature, nunca `new Date(texto)` cru).
 */
function isoParaDatetimeLocal(iso?: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const partes = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false,
  })
    .formatToParts(d)
    .reduce((acc: Record<string, string>, p) => { if (p.type !== "literal") acc[p.type] = p.value; return acc; }, {});
  return `${partes.year}-${partes.month}-${partes.day}T${partes.hour}:${partes.minute}`;
}

function datetimeLocalParaIso(valor: string): string | null {
  if (!valor) return null;
  const d = new Date(`${valor}:00-03:00`);
  return isNaN(d.getTime()) ? null : d.toISOString();
}

function formatarDuracaoAtendimento(min?: number | null): string {
  const m = Math.round(Number(min) || 0);
  if (m <= 0) return "—";
  return formatarDuracao(m);
}

const MESES_NOME = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
];

type RelatorioAtendimento = {
  id: string;
  clienteNome: string;
  dataHoraInicio: string;
  aCaminhoEm: string | null;
  concluidoEm: string;
  duracaoMin: number;
  valor: number;
  descricaoServico: string;
  origemOrcamentoId: string | null;
  orcamentoGeradoId: string | null;
};

type RelatorioMensal = {
  mes: number;
  ano: number;
  totalAgendados: number;
  totalConcluidos: number;
  duracaoMediaMin: number;
  valorRecebido: number;
  valorPorHora: number;
  atendimentos: RelatorioAtendimento[];
};

type Mensagens = { convite: string; confirmacao: string; avaliacao: string; linkAvaliacaoGoogle: string };

const MENSAGENS_VAZIAS: Mensagens = { convite: "", confirmacao: "", avaliacao: "", linkAvaliacaoGoogle: "" };

/** Troca {chave} pelo valor correspondente — sobra {chave} sem valor não vira erro, só fica visível. */
function substituirPlaceholders(modelo: string, valores: Record<string, string>): string {
  return Object.entries(valores).reduce((txt, [chave, valor]) => txt.split(`{${chave}}`).join(valor), modelo);
}

export default function AgendamentoConfigPanel({
  triggerToast, clientes, onGerarOrcamento,
  planType, companyLogo, meiName, cnpjPrestador, telefonePrestador, emailPrestador,
}: Props) {
  const [abaInterna, setAbaInterna] = useState<
    "agendamentos" | "google" | "tipos" | "disponibilidade" | "mensagens" | "relatorio"
  >("agendamentos");
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

  // -------------------------------------------------------------- Mensagens --
  const [mensagens, setMensagens] = useState<Mensagens>(MENSAGENS_VAZIAS);
  const [formMensagens, setFormMensagens] = useState<Mensagens>(MENSAGENS_VAZIAS);
  const [salvandoMensagens, setSalvandoMensagens] = useState(false);
  const [mensagensAlteradas, setMensagensAlteradas] = useState(false);
  const [convitecopiado, setConviteCopiado] = useState(false);

  const copiarConvite = async () => {
    if (!linkPublico) return;
    try {
      const texto = substituirPlaceholders(mensagens.convite, { link: linkPublico });
      await navigator.clipboard.writeText(texto);
      setConviteCopiado(true);
      setTimeout(() => setConviteCopiado(false), 2000);
    } catch {
      triggerToast?.("Não foi possível copiar. Tente novamente.");
    }
  };

  const copiarMensagemAgendamento = async (
    tipo: "confirmacao" | "avaliacao",
    a: Agendamento
  ): Promise<void> => {
    if (tipo === "avaliacao" && !mensagens.linkAvaliacaoGoogle) {
      triggerToast?.("Configure seu link de avaliação do Google na aba Modelos de mensagem primeiro.");
      return;
    }
    const link =
      tipo === "confirmacao" ? `${window.location.origin}/acompanhar/${a.id}` : mensagens.linkAvaliacaoGoogle;
    const texto = substituirPlaceholders(mensagens[tipo], {
      nome_do_cliente: a.clienteNome || "cliente",
      data_hora: dataHoraBR(a.dataHoraInicio),
      link,
    });
    try {
      await navigator.clipboard.writeText(texto);
      triggerToast?.(tipo === "confirmacao" ? "Mensagem de confirmação copiada." : "Mensagem de avaliação copiada.");
    } catch {
      triggerToast?.("Não foi possível copiar. Tente novamente.");
    }
  };

  const salvarMensagens = async () => {
    setSalvandoMensagens(true);
    setErro(null);
    try {
      const h = await comToken();
      const r = await fetch(getApiUrl("/api/agendamento/mensagens"), {
        method: "PUT",
        headers: h,
        body: JSON.stringify(formMensagens),
      });
      const d = await r.json();
      if (!r.ok || !d?.success) throw new Error(d?.mensagem || "Não foi possível guardar os modelos.");
      const atualizado = {
        convite: d.convite,
        confirmacao: d.confirmacao,
        avaliacao: d.avaliacao,
        linkAvaliacaoGoogle: d.linkAvaliacaoGoogle || "",
      };
      setMensagens(atualizado);
      setFormMensagens(atualizado);
      setMensagensAlteradas(false);
      triggerToast?.("Modelos de mensagem guardados.");
    } catch (e: any) {
      setErro(e?.message || "Não foi possível guardar.");
    } finally {
      setSalvandoMensagens(false);
    }
  };

  // ----------------------------------------------------------- Agendamentos --
  const [agendamentos, setAgendamentos] = useState<Agendamento[]>([]);
  const [marcandoACaminhoId, setMarcandoACaminhoId] = useState<string | null>(null);
  const [confirmandoCancelamentoId, setConfirmandoCancelamentoId] = useState<string | null>(null);
  const [cancelandoId, setCancelandoId] = useState<string | null>(null);
  const [linkCopiadoId, setLinkCopiadoId] = useState<string | null>(null);
  // Fase 6 — Gerar orçamento / Novo agendamento manual / Concluir simples.
  const [gerandoOrcamentoId, setGerandoOrcamentoId] = useState<string | null>(null);
  const [mostrarNovoAgendamento, setMostrarNovoAgendamento] = useState(false);
  const [concluindoId, setConcluindoId] = useState<string | null>(null);
  const [confirmandoExclusaoAgendamentoId, setConfirmandoExclusaoAgendamentoId] = useState<string | null>(null);
  const [excluindoAgendamentoId, setExcluindoAgendamentoId] = useState<string | null>(null);

  // Fase 6b — editar baixa (horário de conclusão + descrição do serviço).
  const [editandoBaixaId, setEditandoBaixaId] = useState<string | null>(null);
  const [formBaixaConcluidoEm, setFormBaixaConcluidoEm] = useState("");
  const [formBaixaDescricao, setFormBaixaDescricao] = useState("");
  const [salvandoBaixa, setSalvandoBaixa] = useState(false);

  // Fase 6b — relatório mensal.
  const agora6b = new Date();
  const [relatorioMes, setRelatorioMes] = useState(agora6b.getMonth() + 1);
  const [relatorioAno, setRelatorioAno] = useState(agora6b.getFullYear());
  const [relatorioDados, setRelatorioDados] = useState<RelatorioMensal | null>(null);
  const [carregandoRelatorio, setCarregandoRelatorio] = useState(false);
  const [erroRelatorio, setErroRelatorio] = useState<string | null>(null);
  const [gerandoPdfRelatorio, setGerandoPdfRelatorio] = useState(false);
  const [logoRelatorioPronta, setLogoRelatorioPronta] = useState<string | undefined>(undefined);

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
      const [rAgendamentos, rTipos, rDisp, rGoogle, rMensagens] = await Promise.all([
        fetch(getApiUrl("/api/agendamento/lista"), { headers: h }),
        fetch(getApiUrl("/api/agendamento/tipos"), { headers: h }),
        fetch(getApiUrl("/api/agendamento/disponibilidade"), { headers: h }),
        fetch(getApiUrl("/api/agendamento/google/status"), { headers: h }),
        fetch(getApiUrl("/api/agendamento/mensagens"), { headers: h }),
      ]);

      const dAgendamentos = await rAgendamentos.json();
      if (dAgendamentos?.success) setAgendamentos(dAgendamentos.agendamentos || []);

      const dMensagens = await rMensagens.json();
      if (dMensagens?.success) {
        const carregado = {
          convite: dMensagens.convite,
          confirmacao: dMensagens.confirmacao,
          avaliacao: dMensagens.avaliacao,
          linkAvaliacaoGoogle: dMensagens.linkAvaliacaoGoogle || "",
        };
        setMensagens(carregado);
        setFormMensagens(carregado);
      }

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

  // Excluir de vez — pensado pra limpar agendamento de teste. Diferente de
  // cancelar: apaga o documento (e o evento do Google Calendar e o
  // lançamento correspondente no Livro Caixa, se houver — o servidor cuida
  // dos dois), some da lista, funciona em qualquer status.
  const excluirAgendamento = async (id: string) => {
    setExcluindoAgendamentoId(id);
    setErro(null);
    try {
      const h = await comToken();
      const r = await fetch(getApiUrl(`/api/agendamento/${id}`), { method: "DELETE", headers: h });
      const d = await r.json();
      if (!r.ok || !d?.success) throw new Error(d?.mensagem || "Não foi possível excluir.");
      setAgendamentos((lista) => lista.filter((a) => a.id !== id));
      setConfirmandoExclusaoAgendamentoId(null);
      triggerToast?.("Agendamento excluído.");
    } catch (e: any) {
      setErro(e?.message || "Não foi possível excluir.");
    } finally {
      setExcluindoAgendamentoId(null);
    }
  };

  // Fase 6 — baixa simples: só marca "concluído", sem gerar orçamento nenhum.
  // É a opção certa pra um atendimento comum (não uma visita de orçamento) e
  // é a ÚNICA opção pra quem já nasceu de um orçamento aceito (ver
  // `origemOrcamentoId` mais abaixo, no botão) — gerar um orçamento novo a
  // partir de um agendamento que já veio de um orçamento seria dar mais uma
  // volta no mesmo cliente à toa.
  const concluirAgendamento = async (id: string) => {
    setConcluindoId(id);
    setErro(null);
    try {
      const h = await comToken();
      const r = await fetch(getApiUrl(`/api/agendamento/${id}/concluir`), { method: "POST", headers: h });
      const d = await r.json();
      if (!r.ok || !d?.success) throw new Error(d?.mensagem || "Não foi possível concluir o agendamento.");
      setAgendamentos((lista) => lista.map((a) => (a.id === id ? { ...a, status: "concluido" } : a)));
      triggerToast?.("Agendamento concluído.");
    } catch (e: any) {
      setErro(e?.message || "Não foi possível concluir o agendamento.");
    } finally {
      setConcluindoId(null);
    }
  };

  // Fase 6 — a visita virou orçamento: quem cria o Cliente/Orçamento e marca
  // a baixa é o App.tsx (onGerarOrcamento), porque é lá que mora o cadastro
  // de clientes e a gravação de orçamentos. Este painel só pede e, se deu
  // certo, recarrega para já ver o status "Concluído" e o botão sumir.
  const gerarOrcamento = async (a: Agendamento) => {
    if (!onGerarOrcamento) {
      triggerToast?.("Recurso indisponível no momento.");
      return;
    }
    if (a.orcamentoGeradoId) {
      triggerToast?.("Este agendamento já gerou um orçamento.");
      return;
    }
    setGerandoOrcamentoId(a.id);
    setErro(null);
    try {
      const ok = await onGerarOrcamento(a);
      if (ok) await carregar();
    } catch (e: any) {
      setErro(e?.message || "Não foi possível gerar o orçamento.");
    } finally {
      setGerandoOrcamentoId(null);
    }
  };

  // -------------------------------------------------------- Editar baixa (6b) --

  const abrirEdicaoBaixa = (a: Agendamento) => {
    setEditandoBaixaId(a.id);
    setFormBaixaConcluidoEm(isoParaDatetimeLocal(a.concluidoEm));
    setFormBaixaDescricao(a.descricaoServico || "");
    setErro(null);
  };

  const cancelarEdicaoBaixa = () => {
    setEditandoBaixaId(null);
    setFormBaixaConcluidoEm("");
    setFormBaixaDescricao("");
  };

  const salvarBaixa = async (id: string) => {
    const concluidoEm = datetimeLocalParaIso(formBaixaConcluidoEm);
    if (formBaixaConcluidoEm && !concluidoEm) {
      setErro("Horário de conclusão inválido.");
      return;
    }
    setSalvandoBaixa(true);
    setErro(null);
    try {
      const h = await comToken();
      const r = await fetch(getApiUrl(`/api/agendamento/${id}/baixa`), {
        method: "PUT",
        headers: h,
        body: JSON.stringify({ concluidoEm, descricaoServico: formBaixaDescricao }),
      });
      const d = await r.json();
      if (!r.ok || !d?.success) throw new Error(d?.mensagem || "Não foi possível salvar a baixa.");
      setAgendamentos((lista) =>
        lista.map((a) => (a.id === id ? { ...a, ...d.agendamento } : a))
      );
      cancelarEdicaoBaixa();
      triggerToast?.("Baixa atualizada.");
    } catch (e: any) {
      setErro(e?.message || "Não foi possível salvar a baixa.");
    } finally {
      setSalvandoBaixa(false);
    }
  };

  // -------------------------------------------------------- Relatório mensal (6b) --

  const carregarRelatorio = useCallback(async (mes: number, ano: number) => {
    setCarregandoRelatorio(true);
    setErroRelatorio(null);
    try {
      const h = await comToken();
      const r = await fetch(getApiUrl(`/api/agendamento/relatorio?mes=${mes}&ano=${ano}`), { headers: h });
      const d = await r.json();
      if (!r.ok || !d?.success) throw new Error(d?.mensagem || "Não foi possível carregar o relatório.");
      setRelatorioDados(d);
    } catch (e: any) {
      setErroRelatorio(e?.message || "Não foi possível carregar o relatório.");
      setRelatorioDados(null);
    } finally {
      setCarregandoRelatorio(false);
    }
  }, []);

  useEffect(() => {
    if (abaInterna === "relatorio") carregarRelatorio(relatorioMes, relatorioAno);
  }, [abaInterna, relatorioMes, relatorioAno, carregarRelatorio]);

  // Pré-carrega a logo assim que houver uma — mesmo padrão do OrcamentoGenerator,
  // pra não fazer o profissional esperar a baixa no momento de gerar o PDF.
  useEffect(() => {
    let vivo = true;
    if (planType === "premium" && companyLogo) {
      carregarLogoBase64(companyLogo).then((b64) => { if (vivo) setLogoRelatorioPronta(b64); });
    }
    return () => { vivo = false; };
  }, [planType, companyLogo]);

  const baixarRelatorioPdf = async () => {
    if (!relatorioDados || gerandoPdfRelatorio) return;
    setGerandoPdfRelatorio(true);
    try {
      const { jsPDF } = await import("jspdf");
      const doc = new jsPDF({ unit: "mm", format: "a4" });
      desenharRelatorioAgendamento(doc, relatorioDados, {
        meiName,
        cnpjPrestador,
        telefonePrestador,
        emailPrestador,
        logoBase64: logoRelatorioPronta || (planType === "premium" ? await carregarLogoBase64(companyLogo) : undefined),
        premium: planType === "premium",
      });
      await savePdfCrossPlatform(doc, nomeArquivoRelatorioAgendamento(relatorioDados));
      triggerToast?.(isNativePlatform() ? "✓ PDF salvo em Downloads." : "✓ PDF gerado.");
    } catch (e) {
      triggerToast?.("⚠ Não consegui gerar o PDF.");
    } finally {
      setGerandoPdfRelatorio(false);
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
            <div className="shrink-0 flex items-center gap-1.5">
              <button
                onClick={copiarLinkPublico}
                className="px-3 py-2 bg-slate-100 text-slate-600 rounded-xl text-[11px] font-bold flex items-center gap-1.5 hover:bg-slate-200 transition-colors cursor-pointer"
                title="Copia só o endereço do link"
              >
                {linkCopiado ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                {linkCopiado ? "Copiado" : "Link"}
              </button>
              <button
                onClick={copiarConvite}
                className="px-3 py-2 bg-indigo-50 text-indigo-700 border border-indigo-100 rounded-xl text-[11px] font-bold flex items-center gap-1.5 hover:bg-indigo-100 transition-colors cursor-pointer"
                title="Copia a mensagem de convite pronta, com o link dentro"
              >
                {convitecopiado ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                {convitecopiado ? "Copiado" : "Mensagem"}
              </button>
            </div>
          </div>
        )}

        <div className="flex gap-1.5 bg-slate-100 rounded-2xl p-1 w-fit overflow-x-auto">
          {(["agendamentos", "google", "tipos", "disponibilidade", "mensagens", "relatorio"] as const).map((aba) => (
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
                : aba === "disponibilidade"
                ? "Disponibilidade"
                : aba === "mensagens"
                ? "Modelos de mensagem"
                : "Relatório mensal"}
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
            <div className="flex justify-end">
              <button
                onClick={() => setMostrarNovoAgendamento(true)}
                className="px-3.5 py-2 bg-indigo-600 text-white rounded-xl text-[11px] font-bold flex items-center gap-1.5 hover:bg-indigo-700 transition-colors cursor-pointer"
                title="Para clientes que não sabem ou não querem usar o link público"
              >
                <Plus className="w-3.5 h-3.5" /> Novo agendamento
              </button>
            </div>
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

                  {/* Fase 6b — duração real, descrição do serviço e o lembrete visual quando falta escrever. */}
                  {a.status === "concluido" && (
                    <div className="flex flex-col gap-1 pt-1 border-t border-slate-100">
                      <div className="flex items-center gap-3 flex-wrap">
                        <span className="inline-flex items-center gap-1.5 text-[11px] text-slate-400">
                          <Clock className="w-3 h-3" /> {formatarDuracaoAtendimento(
                            a.concluidoEm
                              ? Math.round(
                                  (new Date(a.concluidoEm).getTime() -
                                    new Date(a.aCaminhoEm || a.dataHoraInicio).getTime()) /
                                    60000
                                )
                              : 0
                          )}
                        </span>
                        {a.descricaoServico ? (
                          <span className="inline-flex items-start gap-1.5 text-[11px] text-slate-500">
                            <MessageSquareText className="w-3 h-3 shrink-0 mt-0.5" /> {a.descricaoServico}
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 bg-amber-100/60 text-amber-700 px-1.5 py-0.5 rounded text-[9px] font-extrabold uppercase">
                            <AlertTriangle className="w-2.5 h-2.5" /> Descrição pendente
                          </span>
                        )}
                      </div>
                    </div>
                  )}

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

                    {(a.status === "confirmado" || a.status === "a_caminho" || a.status === "concluido") && (
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

                    {(a.status === "confirmado" || a.status === "a_caminho" || a.status === "concluido") && (
                      <button
                        onClick={() => copiarMensagemAgendamento("confirmacao", a)}
                        className="px-3 py-1.5 bg-slate-100 text-slate-600 rounded-lg text-[10px] font-bold flex items-center gap-1.5 hover:bg-slate-200 transition-colors cursor-pointer"
                      >
                        <Copy className="w-3 h-3" /> Msg. confirmação
                      </button>
                    )}

                    {a.status === "concluido" && (
                      <button
                        onClick={() => copiarMensagemAgendamento("avaliacao", a)}
                        className="px-3 py-1.5 bg-emerald-50 text-emerald-700 border border-emerald-100 rounded-lg text-[10px] font-bold flex items-center gap-1.5 hover:bg-emerald-100 transition-colors cursor-pointer"
                      >
                        <Copy className="w-3 h-3" /> Msg. avaliação
                      </button>
                    )}

                    {/* Fase 6b — corrige o horário de conclusão e escreve/edita a descrição do serviço. */}
                    {a.status === "concluido" && editandoBaixaId !== a.id && (
                      <button
                        onClick={() => abrirEdicaoBaixa(a)}
                        className="px-3 py-1.5 bg-slate-100 text-slate-600 rounded-lg text-[10px] font-bold flex items-center gap-1.5 hover:bg-slate-200 transition-colors cursor-pointer"
                        title="Ajustar o horário em que o serviço terminou e escrever o que foi feito"
                      >
                        <Pencil className="w-3 h-3" /> Editar baixa
                      </button>
                    )}

                    {/*
                      Um agendamento que já NASCEU de um orçamento aceito
                      (origemOrcamentoId) não pode gerar outro — seria dar
                      mais uma volta no mesmo cliente à toa. Pra esse caso o
                      único próximo passo é concluir simples, mais abaixo.
                    */}
                    {(a.status === "confirmado" || a.status === "a_caminho") &&
                      !a.orcamentoGeradoId &&
                      !a.origemOrcamentoId && (
                        <button
                          onClick={() => gerarOrcamento(a)}
                          disabled={gerandoOrcamentoId === a.id}
                          title="Marca este agendamento como concluído e já abre um orçamento novo com os dados do cliente"
                          className="px-3 py-1.5 bg-violet-50 text-violet-700 border border-violet-100 rounded-lg text-[10px] font-bold flex items-center gap-1.5 hover:bg-violet-100 transition-colors cursor-pointer disabled:opacity-60"
                        >
                          {gerandoOrcamentoId === a.id ? (
                            <Loader2 className="w-3 h-3 animate-spin" />
                          ) : (
                            <FileText className="w-3 h-3" />
                          )}
                          Gerar orçamento
                        </button>
                      )}
                    {a.orcamentoGeradoId && (
                      <span className="px-3 py-1.5 bg-violet-50 text-violet-600 rounded-lg text-[10px] font-bold flex items-center gap-1.5">
                        <FileText className="w-3 h-3" /> Orçamento gerado
                      </span>
                    )}

                    {/* Baixa simples — sempre disponível, com ou sem orçamento envolvido. */}
                    {(a.status === "confirmado" || a.status === "a_caminho") && (
                      <button
                        onClick={() => concluirAgendamento(a.id)}
                        disabled={concluindoId === a.id}
                        title="Marca este agendamento como concluído, sem gerar orçamento"
                        className="px-3 py-1.5 bg-emerald-50 text-emerald-700 border border-emerald-100 rounded-lg text-[10px] font-bold flex items-center gap-1.5 hover:bg-emerald-100 transition-colors cursor-pointer disabled:opacity-60"
                      >
                        {concluindoId === a.id ? (
                          <Loader2 className="w-3 h-3 animate-spin" />
                        ) : (
                          <CheckCircle2 className="w-3 h-3" />
                        )}
                        Concluir
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

                    {/*
                      Excluir é diferente de Cancelar: apaga o registro de vez
                      (pensado pra limpar agendamento de teste), funciona em
                      qualquer status, e some da tela — não fica marcado como
                      cancelado no histórico.
                    */}
                    {confirmandoExclusaoAgendamentoId === a.id ? (
                      <span className="inline-flex items-center gap-1.5">
                        <button
                          onClick={() => excluirAgendamento(a.id)}
                          disabled={excluindoAgendamentoId === a.id}
                          className="px-2.5 py-1.5 bg-red-600 text-white rounded-lg text-[10px] font-bold hover:bg-red-700 transition-colors cursor-pointer disabled:opacity-60"
                        >
                          {excluindoAgendamentoId === a.id ? "Excluindo…" : "Excluir de vez"}
                        </button>
                        <button
                          onClick={() => setConfirmandoExclusaoAgendamentoId(null)}
                          className="px-2.5 py-1.5 bg-slate-100 text-slate-600 rounded-lg text-[10px] font-bold hover:bg-slate-200 transition-colors cursor-pointer"
                        >
                          Voltar
                        </button>
                      </span>
                    ) : (
                      <button
                        onClick={() => setConfirmandoExclusaoAgendamentoId(a.id)}
                        title="Apaga este agendamento de vez — não aparece mais em nenhuma lista"
                        className="w-7 h-7 rounded-lg bg-white text-slate-300 border border-slate-200 flex items-center justify-center hover:bg-red-50 hover:text-red-500 hover:border-red-100 transition-colors cursor-pointer"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    )}
                  </div>

                  {/* Fase 6b — formulário de edição da baixa, aberto por "Editar baixa" acima. */}
                  {editandoBaixaId === a.id && (
                    <div className="pt-2 mt-1 border-t border-slate-100 space-y-2.5">
                      <div>
                        <label className="block text-[10px] font-extrabold uppercase tracking-widest text-slate-400 mb-1.5">
                          Horário em que o serviço terminou
                        </label>
                        <input
                          type="datetime-local"
                          value={formBaixaConcluidoEm}
                          onChange={(e) => setFormBaixaConcluidoEm(e.target.value)}
                          className="w-full px-3.5 py-2 rounded-xl border border-slate-200 bg-white text-xs text-slate-800 focus:outline-hidden focus:ring-2 focus:ring-indigo-200 focus:border-indigo-400 transition"
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] font-extrabold uppercase tracking-widest text-slate-400 mb-1.5">
                          Descrição do serviço realizado
                        </label>
                        <textarea
                          value={formBaixaDescricao}
                          onChange={(e) => setFormBaixaDescricao(e.target.value)}
                          rows={2}
                          maxLength={2000}
                          placeholder="Ex.: Troca da resistência do chuveiro e teste de funcionamento."
                          className="w-full px-3.5 py-2 rounded-xl border border-slate-200 bg-white text-xs text-slate-800 focus:outline-hidden focus:ring-2 focus:ring-indigo-200 focus:border-indigo-400 transition resize-y"
                        />
                      </div>
                      <div className="flex gap-2">
                        <button
                          onClick={() => salvarBaixa(a.id)}
                          disabled={salvandoBaixa}
                          className="flex-1 py-2 bg-indigo-600 text-white rounded-xl text-xs font-bold flex items-center justify-center gap-2 hover:bg-indigo-700 transition-colors cursor-pointer disabled:opacity-60"
                        >
                          {salvandoBaixa ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                          Salvar
                        </button>
                        <button
                          onClick={cancelarEdicaoBaixa}
                          disabled={salvandoBaixa}
                          className="px-4 py-2 bg-slate-100 text-slate-600 rounded-xl text-xs font-bold hover:bg-slate-200 transition-colors cursor-pointer"
                        >
                          Cancelar
                        </button>
                      </div>
                    </div>
                  )}
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
        ) : abaInterna === "disponibilidade" ? (
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
        ) : abaInterna === "mensagens" ? (
          <div className="space-y-4">
            <div className="bg-indigo-50/60 border border-indigo-100 rounded-2xl p-4 flex gap-3">
              <Info className="w-4 h-4 text-indigo-600 shrink-0 mt-0.5" />
              <p className="text-xs text-indigo-900/80 leading-relaxed">
                Como o envio é manual (você quem cola no seu WhatsApp), estas mensagens não passam
                pela API oficial — edite à vontade. <span className="font-mono">{"{link}"}</span>,{" "}
                <span className="font-mono">{"{nome_do_cliente}"}</span> e{" "}
                <span className="font-mono">{"{data_hora}"}</span> são preenchidos sozinhos na hora
                de copiar.
              </p>
            </div>

            {(
              [
                { chave: "convite" as const, titulo: "Convite para agendamento", dica: "Usa {link} — o seu link fixo de agendamento. Fica pronta para copiar no card acima." },
                { chave: "confirmacao" as const, titulo: "Confirmação de agendamento", dica: "Usa {nome_do_cliente}, {data_hora} e {link} — o link de acompanhamento daquele agendamento. Botão \"Msg. confirmação\" no card do agendamento." },
                { chave: "avaliacao" as const, titulo: "Pedido de avaliação", dica: "Usa {nome_do_cliente} e {link} — o link de avaliação do Google configurado abaixo. Botão \"Msg. avaliação\" aparece no card só depois que o serviço é concluído." },
              ] as const
            ).map(({ chave, titulo, dica }) => (
              <div key={chave} className="bg-white border border-slate-200/70 rounded-2xl p-4 space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-[10px] font-extrabold uppercase tracking-widest text-slate-400">
                    {titulo}
                  </label>
                  <button
                    onClick={() => {
                      setFormMensagens((f) => ({ ...f, [chave]: MODELOS_PADRAO[chave] }));
                      setMensagensAlteradas(true);
                    }}
                    className="text-[10px] font-bold text-slate-400 hover:text-slate-600 cursor-pointer"
                  >
                    Restaurar padrão
                  </button>
                </div>
                <textarea
                  value={formMensagens[chave]}
                  onChange={(e) => {
                    setFormMensagens({ ...formMensagens, [chave]: e.target.value });
                    setMensagensAlteradas(true);
                  }}
                  rows={3}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 bg-white text-xs text-slate-800 focus:outline-hidden focus:ring-2 focus:ring-indigo-200 focus:border-indigo-400 transition resize-y"
                />
                <p className="text-[10px] text-slate-400">{dica}</p>
              </div>
            ))}

            <div className="bg-white border border-slate-200/70 rounded-2xl p-4 space-y-2">
              <label className="text-[10px] font-extrabold uppercase tracking-widest text-slate-400">
                Link de avaliação do Google
              </label>
              <input
                value={formMensagens.linkAvaliacaoGoogle}
                onChange={(e) => {
                  setFormMensagens({ ...formMensagens, linkAvaliacaoGoogle: e.target.value });
                  setMensagensAlteradas(true);
                }}
                placeholder="https://g.page/r/.../review"
                className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 bg-white text-xs text-slate-800 focus:outline-hidden focus:ring-2 focus:ring-indigo-200 focus:border-indigo-400 transition"
              />
              <p className="text-[10px] text-slate-400">
                Vai direto pra tela de avaliação do Google, sem passar por nenhuma tela do MEI Flow.
              </p>
            </div>

            <button
              onClick={salvarMensagens}
              disabled={salvandoMensagens || !mensagensAlteradas}
              className="w-full py-3 bg-indigo-600 text-white rounded-2xl text-xs font-bold flex items-center justify-center gap-2 hover:bg-indigo-700 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed sticky bottom-4"
            >
              {salvandoMensagens ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : mensagensAlteradas ? (
                <Save className="w-4 h-4" />
              ) : (
                <CheckCircle2 className="w-4 h-4" />
              )}
              {mensagensAlteradas ? "Salvar modelos" : "Modelos salvos"}
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <input
                type="month"
                value={`${relatorioAno}-${String(relatorioMes).padStart(2, "0")}`}
                onChange={(e) => {
                  const [ano, mes] = e.target.value.split("-").map(Number);
                  if (ano && mes) { setRelatorioAno(ano); setRelatorioMes(mes); }
                }}
                className="px-3.5 py-2.5 rounded-xl border border-slate-200 bg-white text-sm text-slate-800 focus:outline-hidden focus:ring-2 focus:ring-indigo-200 focus:border-indigo-400 transition"
              />
              <button
                onClick={baixarRelatorioPdf}
                disabled={!relatorioDados || carregandoRelatorio || gerandoPdfRelatorio}
                className="ml-auto px-3.5 py-2.5 bg-indigo-600 text-white rounded-xl text-xs font-bold flex items-center gap-2 hover:bg-indigo-700 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {gerandoPdfRelatorio ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                Baixar PDF
              </button>
            </div>

            {erroRelatorio && (
              <div className="bg-red-50 border border-red-200 rounded-2xl p-4 flex gap-3">
                <AlertTriangle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
                <p className="text-xs text-red-900 leading-relaxed">{erroRelatorio}</p>
              </div>
            )}

            {carregandoRelatorio ? (
              <div className="py-16 flex flex-col items-center gap-3 text-slate-400">
                <Loader2 className="w-6 h-6 animate-spin" />
                <p className="text-xs font-medium">Carregando…</p>
              </div>
            ) : relatorioDados ? (
              <>
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-2.5">
                  {[
                    ["Agendados", String(relatorioDados.totalAgendados)],
                    ["Concluídos", String(relatorioDados.totalConcluidos)],
                    ["Tempo médio", formatarDuracaoAtendimento(relatorioDados.duracaoMediaMin)],
                    ["Valor recebido", formatarReais(relatorioDados.valorRecebido)],
                    ["R$ / hora", formatarReais(relatorioDados.valorPorHora)],
                  ].map(([rot, val]) => (
                    <div key={rot} className="bg-white border border-slate-200/70 rounded-2xl p-3.5">
                      <p className="text-[9px] font-extrabold uppercase tracking-widest text-slate-400">{rot}</p>
                      <p className="text-sm font-bold text-slate-800 mt-1">{val}</p>
                    </div>
                  ))}
                </div>

                <p className="text-[10px] text-slate-400 leading-relaxed px-1">
                  Valor recebido considera só o pagamento feito direto pelo link de agendamento (cartão via
                  Asaas) — esse mesmo valor já entra no Livro Caixa sozinho, na data em que foi pago. Serviço
                  que veio de um orçamento tem o faturamento dele contado na tela de Orçamentos/Livro Caixa,
                  não aqui, pra não somar o mesmo dinheiro duas vezes.
                </p>

                <div className="space-y-2.5">
                  {relatorioDados.atendimentos.length === 0 ? (
                    <div className="py-10 flex flex-col items-center gap-2.5 text-center">
                      <BarChart3 className="w-8 h-8 text-slate-300" />
                      <p className="text-xs text-slate-400 max-w-xs">
                        Nenhum atendimento concluído em {MESES_NOME[relatorioMes - 1]}/{relatorioAno}.
                      </p>
                    </div>
                  ) : (
                    relatorioDados.atendimentos.map((a) => (
                      <div key={a.id} className="bg-white border border-slate-200/70 rounded-2xl p-4 space-y-1.5">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="text-sm font-bold text-slate-800 truncate">{a.clienteNome || "—"}</p>
                            <p className="text-[11px] text-slate-500 mt-0.5">{dataHoraBR(a.concluidoEm)}</p>
                          </div>
                          <span className="shrink-0 text-xs font-bold text-indigo-600">{formatarReais(a.valor)}</span>
                        </div>
                        <div className="flex items-center gap-3 flex-wrap">
                          <span className="inline-flex items-center gap-1.5 text-[11px] text-slate-400">
                            <Clock className="w-3 h-3" /> {formatarDuracaoAtendimento(a.duracaoMin)}
                          </span>
                          {a.descricaoServico ? (
                            <span className="text-[11px] text-slate-500">{a.descricaoServico}</span>
                          ) : (
                            <span className="text-[11px] text-slate-400 italic">Sem descrição</span>
                          )}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </>
            ) : null}
          </div>
        )}
      </div>

      {mostrarNovoAgendamento && (
        <AgendarModal
          clientes={clientes}
          triggerToast={triggerToast}
          onClose={() => setMostrarNovoAgendamento(false)}
          onAgendado={() => {
            setMostrarNovoAgendamento(false);
            carregar();
          }}
        />
      )}
    </div>
  );
}
