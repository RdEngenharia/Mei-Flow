import React from "react";
import {
  LayoutDashboard, Users, BookOpen, FileText, Package,
  Building, Calendar, Receipt, X, Crown,
} from "lucide-react";

/**
 * ============================================================================
 * MENU LATERAL — a navegação sai do corpo da página e vem para cá
 * ============================================================================
 *
 * POR QUE ESTA TELA MUDOU
 *
 * A navegação morava dentro do conteúdo: oito botões numa fileira no topo da
 * Visão Geral, misturando coisas de naturezas diferentes — "Registrar Venda"
 * (ação que abre uma janelinha) ao lado de "Gerador Orçamentos" (ir para outra
 * tela) e de "Catálogo" (idem). Fileira longa demais para escolher rápido, e o
 * usuário precisava voltar para o início toda vez que quisesse trocar de tela,
 * porque só de lá dava para navegar. Três botões "Voltar para o Início"
 * existiam só por causa disso.
 *
 * Aqui a regra fica clara e vale para sempre:
 *   • MENU LATERAL   → para ONDE eu vou (telas)
 *   • TOPO DA TELA   → o que eu FAÇO ali (ações daquela tela)
 *
 * ----------------------------------------------------------------------------
 * ESTE COMPONENTE NÃO PENSA
 *
 * Ele recebe qual aba está ativa e avisa quando alguém clica. Quem guarda a
 * tela atual é o App — e isso não é preferência de estilo: é o que faz o botão
 * voltar do navegador continuar funcionando, porque existe UM lugar só que
 * decide qual tela aparece.
 */

export type TelaMeiFlow = "home" | "clientes" | "financeiro" | "orcamentos" | "catalogo";

interface Props {
  ativa: TelaMeiFlow;
  onSelecionar: (tela: TelaMeiFlow) => void;

  /** Números ao lado de cada item. Ajudam a decidir sem entrar na tela. */
  totalClientes: number;
  totalLancamentos: number;

  planType?: "free" | "premium";
  onUpgrade?: () => void;

  /** Obrigações do MEI — são ações recorrentes, não telas. */
  onDas?: () => void;
  onDasn?: () => void;

  /** Rodapé: a empresa. */
  meiName?: string;
  cnpj?: string;
  onConfig?: () => void;

  /** No celular o menu é uma gaveta. No computador, fica sempre visível. */
  aberto?: boolean;
  onFechar?: () => void;
}

type ItemMenu = {
  id: TelaMeiFlow;
  rotulo: string;
  icone: any;
  contador?: number;
  /** Premium: mostra cadeado e leva para o upgrade em vez de abrir. */
  bloqueado?: boolean;
};

export default function Sidebar({
  ativa, onSelecionar, totalClientes, totalLancamentos,
  planType = "free", onUpgrade, onDas, onDasn,
  meiName, cnpj, onConfig, aberto = false, onFechar,
}: Props) {
  /**
   * A lista como DADO, e não como um bloco visual repetido oito vezes.
   *
   * Acrescentar uma tela passa a ser uma linha aqui. E esconder um item por
   * regra de negócio é um campo, não um `{condição && (<button>…</button>)}`
   * envolvendo trinta linhas de JSX duplicado.
   */
  const itens: ItemMenu[] = [
    { id: "home", rotulo: "Visão Geral", icone: LayoutDashboard },
    { id: "financeiro", rotulo: "Livro Caixa", icone: BookOpen, contador: totalLancamentos },
    { id: "clientes", rotulo: "Clientes", icone: Users, contador: totalClientes },
    { id: "orcamentos", rotulo: "Orçamentos", icone: FileText },
    { id: "catalogo", rotulo: "Catálogo", icone: Package, bloqueado: planType === "free" },
  ];

  const abrir = (item: ItemMenu) => {
    if (item.bloqueado) return onUpgrade?.();
    onSelecionar(item.id);
    onFechar?.();
  };

  const conteudo = (
    <div className="flex flex-col h-full">
      <nav className="p-3 space-y-1">
        {itens.map((item) => {
          const Icone = item.icone;
          const ativo = ativa === item.id && !item.bloqueado;
          return (
            <button
              key={item.id}
              onClick={() => abrir(item)}
              className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-sm font-medium transition-all cursor-pointer ${
                ativo
                  ? "bg-slate-900 text-white font-semibold shadow-xs"
                  : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
              }`}
            >
              <span className="flex items-center gap-2.5 min-w-0">
                {/*
                  Ícone com cor própria quando ativo. Detalhe pequeno que dá
                  contraste sem precisar de mais um fundo colorido na tela.
                */}
                <Icone className={`w-4 h-4 shrink-0 ${ativo ? "text-blue-400" : "text-slate-400"}`} />
                <span className="truncate">{item.rotulo}</span>
                {item.bloqueado && <Crown className="w-3 h-3 text-amber-500 shrink-0" />}
              </span>

              {typeof item.contador === "number" && item.contador > 0 && (
                /*
                  O número acompanha o estado do botão. Se ficasse com a mesma
                  cor sempre, pareceria colado por cima quando o item está ativo.
                */
                <span
                  className={`px-2 py-0.5 rounded-full text-[10px] font-bold shrink-0 ${
                    ativo ? "bg-slate-800 text-blue-300" : "bg-slate-100 text-slate-500"
                  }`}
                >
                  {item.contador}
                </span>
              )}
            </button>
          );
        })}
      </nav>

      {/*
        OBRIGAÇÕES — separadas de propósito.

        DAS e Declaração Anual não são telas: são deveres com prazo. Misturá-las
        com a navegação faria a pessoa procurá-las como se fossem seções, e
        deixá-las no meio dos botões da Visão Geral fazia elas sumirem no
        amontoado. Aqui ficam sempre à vista, sem competir com o resto.
      */}
      <div className="px-3 pt-4 pb-2">
        <p className="text-[10px] font-extrabold uppercase tracking-widest text-slate-400 px-3 pb-2">
          Obrigações do MEI
        </p>
        <div className="space-y-1">
          <button
            onClick={() => { onDas?.(); onFechar?.(); }}
            className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-sm text-slate-600 hover:bg-slate-100 hover:text-slate-900 transition-all cursor-pointer"
          >
            <Receipt className="w-4 h-4 text-slate-400 shrink-0" />
            <span className="truncate">Guia mensal (DAS)</span>
          </button>
          <button
            onClick={() => { onDasn?.(); onFechar?.(); }}
            className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-sm text-slate-600 hover:bg-slate-100 hover:text-slate-900 transition-all cursor-pointer"
          >
            <Calendar className="w-4 h-4 text-slate-400 shrink-0" />
            <span className="truncate">Declaração anual</span>
          </button>
        </div>
      </div>

      <div className="flex-1" />

      {/*
        A EMPRESA NO PÉ, E NÃO NO CABEÇALHO.

        Nome e CNPJ são identidade, não ação: a pessoa olha uma vez para
        conferir que está na conta certa. No topo, ocupavam o espaço mais caro
        da tela o tempo inteiro.
      */}
      {onConfig && (
        <button
          onClick={() => { onConfig(); onFechar?.(); }}
          className="m-3 p-3 rounded-xl border border-slate-200 bg-slate-50/60 hover:bg-white hover:border-slate-300 transition-all text-left flex items-center gap-2.5 cursor-pointer group"
          title="Dados da sua empresa"
        >
          <div className="w-8 h-8 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center shrink-0 group-hover:bg-blue-600 group-hover:text-white transition-all">
            <Building className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <p className="text-xs font-bold text-slate-800 truncate">{meiName || "Sua empresa"}</p>
            <p className="text-[10px] text-slate-400 font-mono truncate">
              {cnpj || "CNPJ não cadastrado"}
            </p>
          </div>
        </button>
      )}

      {planType === "free" && onUpgrade && (
        <button
          onClick={() => { onUpgrade(); onFechar?.(); }}
          className="mx-3 mb-4 px-3 py-2.5 rounded-xl bg-slate-900 text-white text-xs font-bold hover:bg-slate-800 transition-all cursor-pointer flex items-center justify-center gap-2"
        >
          <Crown className="w-3.5 h-3.5 text-amber-400" />
          Conhecer o Premium
        </button>
      )}
    </div>
  );

  return (
    <>
      {/*
        No computador: coluna fixa, sempre visível.
        `shrink-0` impede o flexbox de espremer o menu quando a tabela ao lado
        for larga — sem isso, os rótulos quebram linha em telas apertadas.
      */}
      <aside className="hidden md:flex md:w-60 shrink-0 bg-white border-r border-slate-200/80 flex-col">
        <div className="sticky top-20 max-h-[calc(100vh-5rem)] overflow-y-auto flex flex-col flex-1">
          {conteudo}
        </div>
      </aside>

      {/*
        No celular: gaveta. Empilhar o menu inteiro acima do conteúdo — que é o
        caminho mais simples — empurraria o painel financeiro para baixo da
        dobra, e a primeira coisa que a pessoa veria ao abrir o sistema seria
        uma lista de links.
      */}
      {aberto && (
        <div className="md:hidden fixed inset-0 z-50 flex">
          <div className="w-72 max-w-[85%] bg-white h-full shadow-2xl flex flex-col animate-fade-in">
            <div className="h-16 px-4 flex items-center justify-between border-b border-slate-100 shrink-0">
              <span className="text-sm font-bold text-slate-800">Menu</span>
              <button
                onClick={onFechar}
                className="w-9 h-9 rounded-xl bg-slate-100 text-slate-500 flex items-center justify-center cursor-pointer"
                aria-label="Fechar menu"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto">{conteudo}</div>
          </div>
          <div className="flex-1 bg-slate-900/40 backdrop-blur-xs" onClick={onFechar} />
        </div>
      )}
    </>
  );
}
