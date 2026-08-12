import React, { useState, useEffect, useCallback } from "react";
import { Users, Trash2, Loader2, AlertTriangle, Plus, Crown, Clock, ShieldCheck } from "lucide-react";
import { auth } from "../firebase";
import { getApiUrl } from "../utils/nativeFile";

/**
 * ============================================================================
 * USUÁRIOS DA EMPRESA
 * ============================================================================
 *
 * Quem contrata um ajudante não tinha saída além de emprestar a própria senha.
 * Emprestar senha não é permissão: é abrir tudo e torcer. Aqui o dono cria um
 * login próprio para cada pessoa e marca o que ela enxerga.
 *
 * ⚠️ ESCONDER NA TELA É A PRIMEIRA CAMADA, NUNCA A ÚNICA.
 *
 * Tudo que este painel faz o servidor confere de novo: quem não é dono não
 * cria usuário, não muda permissão e não remove ninguém — mesmo chamando a
 * rota na mão. A tela existe para ser clara, não para ser a fechadura.
 */

interface Props {
  planType?: "free" | "premium";
  onTriggerUpgrade?: () => void;
  triggerToast?: (msg: string) => void;
}

type Area = { id: string; nome: string; descricao: string };
type Membro = {
  uid: string;
  nome: string;
  email: string;
  papel: "mestre" | "membro";
  permissoes?: Record<string, boolean>;
  criadoEm?: string;
};

async function comToken(): Promise<Record<string, string>> {
  const t = await auth.currentUser?.getIdToken();
  if (!t) throw new Error("Você precisa estar logado.");
  return { Authorization: `Bearer ${t}`, "Content-Type": "application/json" };
}

export default function EquipePanel({ planType = "free", onTriggerUpgrade, triggerToast }: Props) {
  const [areas, setAreas] = useState<Area[]>([]);
  const [equipe, setEquipe] = useState<Membro[]>([]);
  const [limite, setLimite] = useState(2);
  const [papel, setPapel] = useState<"mestre" | "membro">("mestre");
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  const [criando, setCriando] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [form, setForm] = useState<{ nome: string; email: string; senha: string; permissoes: Record<string, boolean> }>({
    nome: "", email: "", senha: "", permissoes: {},
  });

  const carregar = useCallback(async () => {
    setCarregando(true);
    setErro(null);
    try {
      const h = await comToken();
      const [rAreas, rEquipe] = await Promise.all([
        fetch(getApiUrl("/api/equipe/areas"), { headers: h }),
        fetch(getApiUrl("/api/equipe"), { headers: h }),
      ]);
      const dAreas = await rAreas.json();
      if (dAreas?.success) { setAreas(dAreas.areas || []); setLimite(dAreas.limite || 2); }
      const dEquipe = await rEquipe.json();
      if (dEquipe?.success) { setEquipe(dEquipe.equipe || []); setPapel(dEquipe.papel || "mestre"); }
      else setErro(dEquipe?.mensagem || null);
    } catch (e: any) {
      setErro(e?.message || "Não foi possível carregar.");
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => { carregar(); }, [carregar]);

  const membros = equipe.filter((m) => m.papel === "membro");
  const podeCriar = membros.length < limite;

  const criar = async () => {
    if (planType === "free") return onTriggerUpgrade?.();
    setSalvando(true);
    setErro(null);
    try {
      const r = await fetch(getApiUrl("/api/equipe"), {
        method: "POST",
        headers: await comToken(),
        body: JSON.stringify(form),
      });
      const d = await r.json();
      if (!r.ok || !d?.success) throw new Error(d?.mensagem || "Não foi possível criar.");
      triggerToast?.(d.mensagem);
      setForm({ nome: "", email: "", senha: "", permissoes: {} });
      setCriando(false);
      await carregar();
    } catch (e: any) {
      setErro(e?.message);
    } finally {
      setSalvando(false);
    }
  };

  const salvarPermissoes = async (m: Membro, permissoes: Record<string, boolean>) => {
    setEquipe((atual) => atual.map((x) => (x.uid === m.uid ? { ...x, permissoes } : x)));
    try {
      const r = await fetch(getApiUrl(`/api/equipe/${m.uid}`), {
        method: "PUT",
        headers: await comToken(),
        body: JSON.stringify({ permissoes }),
      });
      const d = await r.json();
      if (!r.ok || !d?.success) throw new Error(d?.mensagem || "Não salvou.");
      triggerToast?.(d.mensagem);
    } catch (e: any) {
      setErro(e?.message);
      await carregar();
    }
  };

  const remover = async (m: Membro) => {
    if (!window.confirm(`Remover ${m.nome}? Ele perde o acesso na hora.`)) return;
    try {
      const r = await fetch(getApiUrl(`/api/equipe/${m.uid}`), { method: "DELETE", headers: await comToken() });
      const d = await r.json();
      if (!r.ok || !d?.success) throw new Error(d?.mensagem || "Não removeu.");
      triggerToast?.(d.mensagem);
      await carregar();
    } catch (e: any) {
      setErro(e?.message);
    }
  };

  const Caixa = ({ marcado, onToggle, area }: any) => (
    <label className="flex items-start gap-2.5 p-2.5 rounded-xl hover:bg-slate-50 cursor-pointer transition">
      <input
        type="checkbox"
        checked={!!marcado}
        onChange={onToggle}
        className="mt-0.5 w-4 h-4 rounded border-slate-300 text-slate-900 focus:ring-slate-400 cursor-pointer"
      />
      <span className="min-w-0">
        <span className="block text-xs font-bold text-slate-800">{area.nome}</span>
        <span className="block text-[11px] text-slate-400 leading-snug">{area.descricao}</span>
      </span>
    </label>
  );

  return (
    <div className="space-y-6 animate-fade-in text-left">
      <div className="pb-4 border-b border-slate-100">
        <h1 className="text-3xl md:text-4xl font-display font-light text-slate-900 tracking-tight">Usuários</h1>
        <p className="text-xs md:text-sm text-slate-400 mt-1 font-medium">
          Dê acesso a quem trabalha com você, sem entregar a sua senha.
        </p>
      </div>

      {erro && (
        <div className="bg-red-50 border border-red-200 rounded-2xl p-4 flex gap-3">
          <AlertTriangle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
          <p className="text-xs text-red-900 leading-relaxed">{erro}</p>
        </div>
      )}

      {papel === "membro" && (
        <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 text-xs text-slate-600 leading-relaxed">
          Só o dono da conta gerencia os usuários. Você está vendo a equipe, mas não pode alterá-la.
        </div>
      )}

      {carregando ? (
        <div className="py-16 flex flex-col items-center gap-3 text-slate-400">
          <Loader2 className="w-6 h-6 animate-spin" />
          <p className="text-xs font-medium">Carregando…</p>
        </div>
      ) : (
        <>
          <div className="space-y-3">
            {equipe.map((m) => (
              <div key={m.uid} className="bg-white rounded-2xl border border-slate-200/70 p-5">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
                      m.papel === "mestre" ? "bg-amber-50 text-amber-600" : "bg-slate-100 text-slate-500"
                    }`}>
                      {m.papel === "mestre" ? <Crown className="w-5 h-5" /> : <Users className="w-5 h-5" />}
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-bold text-slate-800 truncate">{m.nome || "Sem nome"}</p>
                      <p className="text-[11px] text-slate-400 truncate">{m.email}</p>
                    </div>
                  </div>

                  {m.papel === "mestre" ? (
                    <span className="text-[10px] font-extrabold uppercase tracking-widest text-amber-600 shrink-0 pt-1">
                      Dono
                    </span>
                  ) : papel === "mestre" ? (
                    <button
                      onClick={() => remover(m)}
                      className="w-9 h-9 rounded-xl border border-red-200 text-red-600 flex items-center justify-center hover:bg-red-50 transition shrink-0 cursor-pointer"
                      title="Remover"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  ) : null}
                </div>

                {m.papel === "mestre" ? (
                  <p className="text-[11px] text-slate-400 mt-3 pl-13">
                    O dono enxerga tudo, sempre — inclusive o certificado digital e a conta bancária,
                    que nunca são delegados.
                  </p>
                ) : (
                  <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-0.5">
                    {areas.map((a) => (
                      <Caixa
                        key={a.id}
                        area={a}
                        marcado={m.permissoes?.[a.id]}
                        onToggle={() =>
                          papel === "mestre" &&
                          salvarPermissoes(m, { ...(m.permissoes || {}), [a.id]: !m.permissoes?.[a.id] })
                        }
                      />
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>

          {papel === "mestre" && (
            criando ? (
              <div className="bg-white rounded-2xl border border-slate-200/70 p-5 space-y-4">
                <h4 className="text-xs font-extrabold uppercase tracking-widest text-slate-500">Novo usuário</h4>

                {[
                  { id: "nome", label: "Nome", tipo: "text", dica: "" },
                  { id: "email", label: "E-mail de acesso", tipo: "email", dica: "É com ele que a pessoa entra." },
                  { id: "senha", label: "Senha", tipo: "password", dica: "Pelo menos 8 caracteres. Combine com ela." },
                ].map((c) => (
                  <div key={c.id}>
                    <label className="block text-[10px] font-extrabold uppercase tracking-widest text-slate-400 mb-1.5">
                      {c.label}
                    </label>
                    <input
                      type={c.tipo}
                      autoComplete="new-password"
                      value={(form as any)[c.id]}
                      onChange={(e) => setForm({ ...form, [c.id]: e.target.value })}
                      className="w-full px-4 py-2.5 rounded-xl border border-slate-200 bg-white text-sm focus:outline-hidden focus:ring-2 focus:ring-slate-200 focus:border-slate-400 transition"
                    />
                    {c.dica && <p className="text-[10px] text-slate-400 mt-1">{c.dica}</p>}
                  </div>
                ))}

                <div>
                  <p className="text-[10px] font-extrabold uppercase tracking-widest text-slate-400 mb-1">
                    O que essa pessoa pode acessar
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-0.5">
                    {areas.map((a) => (
                      <Caixa
                        key={a.id}
                        area={a}
                        marcado={form.permissoes[a.id]}
                        onToggle={() =>
                          setForm({ ...form, permissoes: { ...form.permissoes, [a.id]: !form.permissoes[a.id] } })
                        }
                      />
                    ))}
                  </div>
                </div>

                <div className="flex gap-3">
                  <button
                    onClick={criar}
                    disabled={salvando}
                    className="flex-1 bg-slate-900 text-white font-bold text-sm rounded-2xl py-3 hover:bg-slate-800 disabled:opacity-50 transition cursor-pointer flex items-center justify-center gap-2"
                  >
                    {salvando && <Loader2 className="w-4 h-4 animate-spin" />}
                    Criar usuário
                  </button>
                  <button
                    onClick={() => setCriando(false)}
                    className="px-5 rounded-2xl border border-slate-200 text-slate-600 text-sm font-bold hover:bg-slate-50 transition cursor-pointer"
                  >
                    Cancelar
                  </button>
                </div>
              </div>
            ) : (
              <button
                onClick={() => (planType === "free" ? onTriggerUpgrade?.() : podeCriar ? setCriando(true) : null)}
                disabled={!podeCriar && planType !== "free"}
                className="w-full border border-dashed border-slate-300 rounded-2xl py-4 text-sm font-bold text-slate-600 hover:bg-slate-50 hover:border-slate-400 transition cursor-pointer flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Plus className="w-4 h-4" />
                {planType === "free"
                  ? "Criar usuários é um recurso do Premium"
                  : podeCriar
                    ? "Adicionar usuário"
                    : `Limite de ${limite} usuários atingido`}
              </button>
            )
          )}

          {/*
            O ATRASO DO TOKEN — a única surpresa deste sistema, dita na cara.

            As permissões viajam dentro do login da pessoa, e esse login só é
            renovado de tempos em tempos. Sem este aviso, a dúvida é sempre a
            mesma: "mudei e não aconteceu nada, será que salvou?".
          */}
          <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 flex gap-3">
            <Clock className="w-4 h-4 text-slate-400 shrink-0 mt-0.5" />
            <p className="text-[11px] text-slate-500 leading-relaxed">
              Mudança de permissão vale quando a pessoa <strong>sair e entrar de novo</strong>. Remover
              o usuário, ao contrário, tira o acesso na hora.
            </p>
          </div>

          <div className="bg-white border border-slate-200/70 rounded-2xl p-4 flex gap-3">
            <ShieldCheck className="w-4 h-4 text-slate-400 shrink-0 mt-0.5" />
            <p className="text-[11px] text-slate-500 leading-relaxed">
              O certificado digital e as credenciais do banco <strong>nunca</strong> são delegados. Um
              ajudante pode emitir nota e boleto; trocar a conta que recebe o dinheiro, ou o certificado
              que assina no seu CNPJ, só você.
            </p>
          </div>
        </>
      )}
    </div>
  );
}
