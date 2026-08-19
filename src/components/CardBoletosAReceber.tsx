import React, { useEffect, useState } from "react";
import { Receipt, AlertOctagon } from "lucide-react";
import { auth } from "../firebase";
import { getApiUrl } from "../utils/nativeFile";

/**
 * CARD "BOLETOS A RECEBER" — o dinheiro já cobrado que ainda não caiu.
 *
 * POR QUE ELE EXISTE SEPARADO DO "A RECEBER" (PainelAReceber.tsx)
 *
 * Aquele painel mostra o que vem de venda a prazo/crediário, guardado direto
 * nas transações do app. Boleto é outra fonte: mora na Efí, e só entrava na
 * tela quando a pessoa clicava em "Cobranças" — foi exatamente o que o
 * usuário notou ("só consigo ver se eu entrar na aba boleto"). Este card
 * busca o resumo (/api/cobrancas/painel) sozinho, ao entrar na Visão Geral,
 * sem depender de a gaveta de Cobranças estar aberta.
 *
 * Os dois números continuam separados de propósito — venda a prazo e boleto
 * são compromissos diferentes com o cliente, e somar os dois esconderia qual
 * dos dois está atrasado.
 *
 * SOME SOZINHO QUANDO NÃO HÁ NADA
 *
 * Mesma regra do PainelAReceber: usuário sem boleto emitido (ou no plano
 * gratuito, que nem chega a emitir) recebe o resumo zerado do servidor, e o
 * card não ocupa espaço à toa.
 */

const emReais = (n: number) =>
  Number(n || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

async function comToken(): Promise<Record<string, string>> {
  const t = await auth.currentUser?.getIdToken();
  if (!t) throw new Error("Você precisa estar logado.");
  return { Authorization: `Bearer ${t}` };
}

interface ResumoBoletos {
  aReceber: number;
  vencido: number;
}

export default function CardBoletosAReceber({
  userId,
  onAbrir,
}: {
  userId?: string | null;
  onAbrir: () => void;
}) {
  const [resumo, setResumo] = useState<ResumoBoletos | null>(null);

  useEffect(() => {
    if (!userId) return;
    let cancelado = false;
    (async () => {
      try {
        const r = await fetch(getApiUrl("/api/cobrancas/painel"), { headers: await comToken() });
        const d = await r.json();
        if (!cancelado && d.success) setResumo(d.resumo);
      } catch {
        /* Sem Efí configurada, ou sem internet: o card simplesmente não aparece. */
      }
    })();
    return () => {
      cancelado = true;
    };
  }, [userId]);

  if (!resumo || (!resumo.aReceber && !resumo.vencido)) return null;

  return (
    <div
      onClick={onAbrir}
      className="mt-8 bg-white rounded-3xl border border-slate-200/60 shadow-xs overflow-hidden cursor-pointer hover:border-emerald-300 hover:shadow-md transition-all duration-300"
      title="Clique para ver os boletos em detalhe"
    >
      <div className="px-6 py-5 flex items-start justify-between gap-4 flex-wrap">
        <div>
          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest flex items-center gap-1.5">
            <Receipt className="w-3.5 h-3.5 text-emerald-500" />
            Boletos a receber
          </span>
          <h3 className="text-3xl font-display font-light text-slate-900 tracking-tight mt-1">
            {emReais(resumo.aReceber)}
          </h3>
          <p className="text-[11px] text-slate-400 font-medium mt-1">
            cobranças emitidas, aguardando pagamento
          </p>
        </div>

        {resumo.vencido > 0 && (
          <div className="flex items-center gap-1.5 bg-rose-50 text-rose-600 px-3 py-1.5 rounded-full text-[11px] font-bold shrink-0 self-center">
            <AlertOctagon className="w-3.5 h-3.5" />
            {emReais(resumo.vencido)} vencido
          </div>
        )}
      </div>
    </div>
  );
}
