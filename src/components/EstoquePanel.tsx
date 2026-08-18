import React, { useCallback, useEffect, useState } from "react";
import {
  Boxes, Plus, Search, ArrowDownCircle, ArrowUpCircle, AlertTriangle,
  ChevronDown, ChevronRight, Trash2, X, Cloud, CloudOff, Users, Calendar,
  Package, Loader2,
} from "lucide-react";
import type { Cliente, ItemEstoque, MovimentoEstoque, Transacao, UnidadeEstoque } from "../types";
import {
  fetchEstoqueFromFirebase, saveItemEstoqueToFirebase, deleteItemEstoqueFromFirebase,
} from "../firebase";
import {
  criarItemEstoque, registrarEntrada, registrarSaida, estoqueSuficiente,
  valorEmEstoque, valorTotalEstoque, itensComEstoqueBaixo, buscarItens,
  baixasNoPeriodo, totalBaixasPorCliente,
} from "../utils/estoque";
import { hojeBR, paraISO } from "../utils/recebimentos";

/**
 * ============================================================================
 * ESTOQUE — comprar material, guardar, e dar baixa por cliente
 * ============================================================================
 *
 * TRÊS ABAS, TRÊS MOMENTOS DIFERENTES
 *
 *   Itens       → o que tem guardado agora, e quanto vale.
 *   Consumo     → "usei isso na instalação do Carlos" — a baixa vinculada.
 *   Relatório   → para onde foi cada baixa, por cliente e por período.
 *
 * QUEM CALCULA O QUÊ
 *
 * Todo o número que envolve dinheiro (custo médio ponderado, valor em
 * estoque, o que cada baixa custou) mora em utils/estoque.ts, puro e
 * testado. Este arquivo só busca os dados, monta a tela e chama essas
 * funções — nunca soma quantidade × custo direto no JSX.
 *
 * Este componente é dono dos próprios dados (busca `estoque` na entrada, como
 * PainelAcompanhamento e CobrancasPanel já fazem) — não recebe os itens
 * prontos do App.tsx.
 */

type Aba = "itens" | "consumo" | "relatorio";

const UNIDADES: { valor: UnidadeEstoque; rotulo: string }[] = [
  { valor: "un", rotulo: "Unidade (un)" },
  { valor: "m", rotulo: "Metro (m)" },
  { valor: "kg", rotulo: "Quilo (kg)" },
  { valor: "l", rotulo: "Litro (l)" },
  { valor: "cx", rotulo: "Caixa (cx)" },
  { valor: "rolo", rotulo: "Rolo" },
  { valor: "pc", rotulo: "Peça (pc)" },
];

const emReais = (n: number) => (Number(n) || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const campo = "w-full border border-slate-200 rounded-xl py-2.5 px-3.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500";
const rotuloCampo = "block text-[10px] font-bold text-slate-500 uppercase tracking-wide mb-1";

type LinhaConsumo = { id: string; itemId: string; quantidade: string };

const novaLinhaConsumo = (): LinhaConsumo => ({
  id: `lc_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
  itemId: "",
  quantidade: "",
});

export default function EstoquePanel({
  userId,
  clientes,
  transacoes,
  onGoBack,
  triggerToast,
}: {
  userId: string;
  clientes: Cliente[];
  transacoes: Transacao[];
  onGoBack: () => void;
  triggerToast: (msg: string) => void;
}) {
  const [itens, setItens] = useState<ItemEstoque[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [naNuvem, setNaNuvem] = useState<boolean | null>(null);
  const [aba, setAba] = useState<Aba>("itens");

  const carregar = useCallback(async () => {
    if (!userId) { setCarregando(false); return; }
    setCarregando(true);
    try {
      const lista = await fetchEstoqueFromFirebase(userId);
      setItens(lista);
      setNaNuvem(true);
    } catch (err) {
      console.warn("Estoque: não consegui carregar da nuvem.", err);
      setNaNuvem(false);
    } finally {
      setCarregando(false);
    }
  }, [userId]);

  useEffect(() => { carregar(); }, [carregar]);

  /** Grava um item (novo ou alterado) na nuvem e substitui no estado local. */
  const persistirItem = async (item: ItemEstoque) => {
    setItens((atual) => {
      const semDuplicata = atual.filter((i) => i.id !== item.id);
      return [...semDuplicata, item].sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
    });
    try {
      await saveItemEstoqueToFirebase(userId, item);
    } catch (err) {
      console.error("Estoque: falha ao gravar item.", err);
      triggerToast("⚠ Não consegui salvar na nuvem. Tente de novo.");
    }
  };

  const estoqueBaixo = itensComEstoqueBaixo(itens);

  return (
    <div className="space-y-8 animate-fade-in text-left font-sans">
      {/* ------------------------------------------------------------- topo */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <button
          onClick={onGoBack}
          className="flex items-center gap-1.5 text-xs font-bold text-slate-600 hover:text-slate-950 transition-all bg-white px-4 py-2 border border-slate-200 rounded-xl shadow-xs cursor-pointer"
        >
          <span>&larr; Voltar para o Início (Home)</span>
        </button>

        <div className="inline-flex gap-1 bg-slate-100 p-1 rounded-xl border border-slate-200/50">
          {([
            ["itens", "Itens"],
            ["consumo", "Consumo de Material"],
            ["relatorio", "Relatório"],
          ] as [Aba, string][]).map(([id, rotulo]) => (
            <button
              key={id}
              onClick={() => setAba(id)}
              className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                aba === id ? "bg-white text-slate-900 shadow-xs" : "text-slate-500 hover:text-slate-900"
              }`}
            >
              {rotulo}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-6 pb-6 border-b border-slate-100">
        <div>
          <h1 className="text-3xl md:text-4xl font-display font-light text-slate-900 tracking-tight flex items-center gap-2 flex-wrap">
            <Boxes className="w-7 h-7 text-blue-600" />
            <span>Estoque</span>
          </h1>
          <p className="text-xs md:text-sm text-slate-400 mt-1 font-medium">
            {aba === "itens" && "O material que você comprou e ainda tem guardado."}
            {aba === "consumo" && "Dê baixa no que foi usado numa instalação, vinculado ao cliente."}
            {aba === "relatorio" && "Para onde foi cada baixa, por cliente e por período."}
          </p>
        </div>
        <div className="shrink-0">
          {naNuvem === false ? (
            <span className="inline-flex items-center gap-1.5 text-[10px] font-bold text-amber-700 bg-amber-50 border border-amber-200 px-2.5 py-1.5 rounded-lg">
              <CloudOff className="w-3.5 h-3.5" /> Sem conexão com a nuvem agora
            </span>
          ) : naNuvem ? (
            <span className="inline-flex items-center gap-1.5 text-[10px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2.5 py-1.5 rounded-lg">
              <Cloud className="w-3.5 h-3.5" /> Sincronizado na nuvem
            </span>
          ) : null}
        </div>
      </div>

      {carregando ? (
        <div className="flex items-center justify-center py-24 text-slate-400 gap-2">
          <Loader2 className="w-5 h-5 animate-spin" />
          <span className="text-sm font-medium">Carregando estoque...</span>
        </div>
      ) : (
        <>
          {aba === "itens" && (
            <AbaItens
              itens={itens}
              estoqueBaixo={estoqueBaixo}
              persistirItem={persistirItem}
              userId={userId}
              setItens={setItens}
              triggerToast={triggerToast}
            />
          )}
          {aba === "consumo" && (
            <AbaConsumo
              itens={itens}
              clientes={clientes}
              transacoes={transacoes}
              persistirItem={persistirItem}
              triggerToast={triggerToast}
            />
          )}
          {aba === "relatorio" && <AbaRelatorio itens={itens} clientes={clientes} />}
        </>
      )}
    </div>
  );
}

/* ============================================================================
   ABA 1 — ITENS: a lista, a busca, criar item novo, registrar compra
   ============================================================================ */

function AbaItens({
  itens,
  estoqueBaixo,
  persistirItem,
  userId,
  setItens,
  triggerToast,
}: {
  itens: ItemEstoque[];
  estoqueBaixo: ItemEstoque[];
  persistirItem: (item: ItemEstoque) => Promise<void>;
  userId: string;
  setItens: React.Dispatch<React.SetStateAction<ItemEstoque[]>>;
  triggerToast: (msg: string) => void;
}) {
  const [busca, setBusca] = useState("");
  const [expandido, setExpandido] = useState<string | null>(null);

  const [showNovoItem, setShowNovoItem] = useState(false);
  const [nomeNovo, setNomeNovo] = useState("");
  const [unidadeNova, setUnidadeNova] = useState<UnidadeEstoque>("un");
  const [categoriaNova, setCategoriaNova] = useState("");
  const [minimoNovo, setMinimoNovo] = useState("");

  const [itemEntrada, setItemEntrada] = useState<ItemEstoque | null>(null);
  const [qtdEntrada, setQtdEntrada] = useState("");
  const [custoEntrada, setCustoEntrada] = useState("");
  const [dataEntrada, setDataEntrada] = useState(hojeBR());

  const listaFiltrada = buscarItens(itens, busca);
  const valorTotal = valorTotalEstoque(itens);

  const handleCriarItem = (e: React.FormEvent) => {
    e.preventDefault();
    if (!nomeNovo.trim()) return;
    if (itens.some((i) => i.nome.trim().toLowerCase() === nomeNovo.trim().toLowerCase())) {
      triggerToast("⚠ Já existe um item com esse nome.");
      return;
    }
    const novo = criarItemEstoque({
      nome: nomeNovo,
      unidade: unidadeNova,
      categoria: categoriaNova || undefined,
      estoqueMinimo: minimoNovo ? Number(minimoNovo) : undefined,
    });
    persistirItem(novo);
    triggerToast(`✓ "${novo.nome}" cadastrado no estoque.`);
    setNomeNovo(""); setCategoriaNova(""); setMinimoNovo(""); setUnidadeNova("un");
    setShowNovoItem(false);
  };

  const handleRegistrarEntrada = (e: React.FormEvent) => {
    e.preventDefault();
    if (!itemEntrada) return;
    const quantidade = Number(String(qtdEntrada).replace(",", "."));
    const custoUnitario = Number(String(custoEntrada).replace(",", "."));
    if (!quantidade || quantidade <= 0) { triggerToast("⚠ Informe a quantidade comprada."); return; }
    if (!custoUnitario || custoUnitario <= 0) { triggerToast("⚠ Informe quanto pagou por unidade."); return; }

    const atualizado = registrarEntrada(itemEntrada, { quantidade, custoUnitario, data: dataEntrada });
    persistirItem(atualizado);
    triggerToast(`✓ +${quantidade} ${itemEntrada.unidade} de "${itemEntrada.nome}" no estoque.`);
    setItemEntrada(null); setQtdEntrada(""); setCustoEntrada(""); setDataEntrada(hojeBR());
  };

  const handleExcluirItem = async (item: ItemEstoque) => {
    if (item.movimentos.length > 0) {
      triggerToast("⚠ Este item já tem movimentação — não dá para excluir, só zerar com um ajuste.");
      return;
    }
    setItens((atual) => atual.filter((i) => i.id !== item.id));
    try {
      await deleteItemEstoqueFromFirebase(userId, item.id);
    } catch {
      triggerToast("⚠ Não consegui excluir na nuvem.");
    }
  };

  return (
    <div className="space-y-6">
      {/* Resumo + busca + ações */}
      <div className="flex flex-col lg:flex-row gap-4 lg:items-center lg:justify-between">
        <div className="bg-slate-900 text-white rounded-2xl p-5 flex items-center gap-4 shrink-0">
          <div className="w-11 h-11 rounded-xl bg-white/10 flex items-center justify-center shrink-0">
            <Boxes className="w-5 h-5 text-blue-300" />
          </div>
          <div>
            <span className="text-[10px] font-extrabold uppercase tracking-widest text-slate-400 block">
              Valor parado em estoque
            </span>
            <span className="text-2xl font-bold font-mono tracking-tight">{emReais(valorTotal)}</span>
          </div>
        </div>

        <div className="flex-1 flex flex-col sm:flex-row gap-2">
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="text" placeholder="Buscar item por nome..."
              value={busca} onChange={(e) => setBusca(e.target.value)}
              className={`${campo} pl-10`}
            />
          </div>
          <button
            type="button"
            onClick={() => setShowNovoItem(true)}
            className="px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs rounded-xl flex items-center justify-center gap-1.5 cursor-pointer transition-all shrink-0"
          >
            <Plus className="w-4 h-4" /> Novo item
          </button>
        </div>
      </div>

      {/* Aviso de estoque baixo */}
      {estoqueBaixo.length > 0 && (
        <div className="rounded-2xl bg-amber-50 border border-amber-200 p-4 flex items-start gap-3">
          <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
          <p className="text-xs text-amber-800 font-semibold leading-relaxed">
            {estoqueBaixo.length === 1
              ? `"${estoqueBaixo[0].nome}" está no limite mínimo — hora de comprar mais.`
              : `${estoqueBaixo.length} itens estão no limite mínimo ou abaixo: ${estoqueBaixo.map((i) => i.nome).join(", ")}.`}
          </p>
        </div>
      )}

      {/* Lista de itens */}
      <div className="bg-white rounded-3xl border border-slate-200/60 shadow-xs overflow-hidden">
        {listaFiltrada.length === 0 ? (
          <div className="text-center py-16 text-slate-400">
            <Package className="w-8 h-8 mx-auto mb-2 text-slate-300" />
            <p className="text-sm font-medium">
              {itens.length === 0 ? "Nenhum item cadastrado ainda." : "Nada encontrado para essa busca."}
            </p>
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {listaFiltrada.map((item) => {
              const baixo = typeof item.estoqueMinimo === "number" && item.quantidadeAtual <= item.estoqueMinimo;
              const aberto = expandido === item.id;
              const ultimosMovimentos = [...item.movimentos].reverse().slice(0, 6);
              return (
                <div key={item.id}>
                  <div
                    className="px-6 py-4 flex items-center justify-between gap-4 hover:bg-slate-50/50 transition-all cursor-pointer"
                    onClick={() => setExpandido(aberto ? null : item.id)}
                  >
                    <div className="min-w-0 flex items-center gap-2">
                      {aberto ? <ChevronDown className="w-3.5 h-3.5 text-slate-400 shrink-0" /> : <ChevronRight className="w-3.5 h-3.5 text-slate-400 shrink-0" />}
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-slate-800 truncate flex items-center gap-1.5">
                          {item.nome}
                          {baixo && (
                            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-amber-50 text-amber-700 text-[9px] font-bold uppercase tracking-wide">
                              <AlertTriangle className="w-2.5 h-2.5" /> Baixo
                            </span>
                          )}
                        </p>
                        <p className="text-[11px] text-slate-400">
                          {item.categoria ? `${item.categoria} · ` : ""}
                          {item.quantidadeAtual} {item.unidade} · custo médio {emReais(item.custoMedio)}/{item.unidade}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-3 shrink-0">
                      <div className="text-right">
                        <p className="text-sm font-bold text-slate-900">{emReais(valorEmEstoque(item))}</p>
                        <p className="text-[10px] text-slate-400">em estoque</p>
                      </div>
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); setItemEntrada(item); }}
                        className="px-2.5 py-1.5 rounded-lg bg-emerald-50 hover:bg-emerald-100 text-emerald-700 text-[10px] font-bold flex items-center gap-1 transition-all"
                        title="Registrar compra"
                      >
                        <ArrowDownCircle className="w-3.5 h-3.5" /> Comprei mais
                      </button>
                      {item.movimentos.length === 0 && (
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); handleExcluirItem(item); }}
                          className="p-1.5 text-slate-300 hover:text-red-600 hover:bg-red-50 rounded-lg transition-all"
                          title="Excluir item (sem movimentação)"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>

                  {aberto && (
                    <div className="px-6 pb-4 bg-slate-50/60">
                      {ultimosMovimentos.length === 0 ? (
                        <p className="text-[11px] text-slate-400 py-2">Nenhuma movimentação ainda.</p>
                      ) : (
                        <div className="space-y-1 pt-2">
                          {ultimosMovimentos.map((m) => (
                            <MovimentoLinha key={m.id} m={m} unidade={item.unidade} />
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Modal: novo item */}
      {showNovoItem && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-start sm:items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl max-w-md w-full shadow-2xl border border-slate-200 overflow-hidden my-auto">
            <div className="px-6 pt-5 pb-4 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
              <h3 className="font-bold text-slate-800">Novo item no estoque</h3>
              <button onClick={() => setShowNovoItem(false)} className="text-slate-400 hover:text-slate-600 p-1.5 rounded-lg hover:bg-slate-100">
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleCriarItem} className="p-6 space-y-4">
              <div>
                <label className={rotuloCampo}>Nome do item</label>
                <input type="text" required autoFocus placeholder="Ex.: Disjuntor 20A"
                  value={nomeNovo} onChange={(e) => setNomeNovo(e.target.value)} className={campo} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={rotuloCampo}>Unidade</label>
                  <select value={unidadeNova} onChange={(e) => setUnidadeNova(e.target.value as UnidadeEstoque)} className={`${campo} bg-white`}>
                    {UNIDADES.map((u) => <option key={u.valor} value={u.valor}>{u.rotulo}</option>)}
                  </select>
                </div>
                <div>
                  <label className={rotuloCampo}>Categoria (opcional)</label>
                  <input type="text" placeholder="Ex.: Elétrica" value={categoriaNova} onChange={(e) => setCategoriaNova(e.target.value)} className={campo} />
                </div>
              </div>
              <div>
                <label className={rotuloCampo}>Estoque mínimo (opcional)</label>
                <input type="number" step="0.01" min="0" placeholder="Avisa quando chegar aqui" value={minimoNovo} onChange={(e) => setMinimoNovo(e.target.value)} className={campo} />
              </div>
              <button type="submit" className="w-full py-3 bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs rounded-xl transition-all cursor-pointer uppercase tracking-wider">
                Cadastrar item
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Modal: registrar entrada (compra) */}
      {itemEntrada && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-start sm:items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl max-w-md w-full shadow-2xl border border-slate-200 overflow-hidden my-auto">
            <div className="px-6 pt-5 pb-4 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
              <div>
                <h3 className="font-bold text-slate-800">Registrar compra</h3>
                <p className="text-[11px] text-slate-400">{itemEntrada.nome}</p>
              </div>
              <button onClick={() => setItemEntrada(null)} className="text-slate-400 hover:text-slate-600 p-1.5 rounded-lg hover:bg-slate-100">
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleRegistrarEntrada} className="p-6 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={rotuloCampo}>Quantidade comprada ({itemEntrada.unidade})</label>
                  <input type="number" step="0.01" min="0" required autoFocus value={qtdEntrada} onChange={(e) => setQtdEntrada(e.target.value)} className={`${campo} font-bold`} />
                </div>
                <div>
                  <label className={rotuloCampo}>Custo por {itemEntrada.unidade} (R$)</label>
                  <input type="number" step="0.01" min="0" required value={custoEntrada} onChange={(e) => setCustoEntrada(e.target.value)} className={`${campo} font-bold`} />
                </div>
              </div>
              <div>
                <label className={rotuloCampo}>Data da compra</label>
                <input type="text" placeholder="dd/mm/aaaa" value={dataEntrada} onChange={(e) => setDataEntrada(e.target.value)} className={`${campo} font-mono`} />
              </div>
              {itemEntrada.quantidadeAtual > 0 && (
                <p className="text-[11px] text-slate-400">
                  Já tem {itemEntrada.quantidadeAtual} {itemEntrada.unidade} a {emReais(itemEntrada.custoMedio)}/{itemEntrada.unidade}. O custo médio será recalculado com esta compra.
                </p>
              )}
              <button type="submit" className="w-full py-3 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs rounded-xl transition-all cursor-pointer uppercase tracking-wider">
                Adicionar ao estoque
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

function MovimentoLinha({ m, unidade }: { m: MovimentoEstoque; unidade: string }) {
  const entrada = m.tipo === "entrada";
  return (
    <div className="flex items-center justify-between gap-3 text-[11px] py-1.5">
      <div className="flex items-center gap-2 min-w-0">
        {entrada ? <ArrowDownCircle className="w-3.5 h-3.5 text-emerald-600 shrink-0" /> : <ArrowUpCircle className="w-3.5 h-3.5 text-rose-500 shrink-0" />}
        <span className="font-mono text-slate-400 shrink-0">{m.data}</span>
        <span className="text-slate-600 truncate">
          {entrada ? `+${m.quantidade} ${unidade} comprado` : `-${m.quantidade} ${unidade} usado${m.clienteNome ? ` — ${m.clienteNome}` : ""}`}
        </span>
      </div>
      <span className={`font-bold shrink-0 ${entrada ? "text-emerald-700" : "text-rose-600"}`}>
        {entrada ? "" : "−"}{emReais(m.valorTotal)}
      </span>
    </div>
  );
}

/* ============================================================================
   ABA 2 — CONSUMO: a baixa vinculada a um cliente (e opcionalmente a uma venda)
   ============================================================================ */

function AbaConsumo({
  itens,
  clientes,
  transacoes,
  persistirItem,
  triggerToast,
}: {
  itens: ItemEstoque[];
  clientes: Cliente[];
  transacoes: Transacao[];
  persistirItem: (item: ItemEstoque) => Promise<void>;
  triggerToast: (msg: string) => void;
}) {
  const [clienteId, setClienteId] = useState("");
  const [vendaId, setVendaId] = useState("");
  const [data, setData] = useState(hojeBR());
  const [linhas, setLinhas] = useState<LinhaConsumo[]>([novaLinhaConsumo()]);
  const [enviando, setEnviando] = useState(false);

  const clienteSelecionado = clientes.find((c) => c.id === clienteId);
  const vendasDoCliente = transacoes.filter((t) => t.tipo === "entrada" && (!clienteId || t.clienteId === clienteId));

  const alterarLinha = (id: string, mudanca: Partial<LinhaConsumo>) => {
    setLinhas((atual) => atual.map((l) => (l.id === id ? { ...l, ...mudanca } : l)));
  };
  const removerLinha = (id: string) => {
    setLinhas((atual) => (atual.length <= 1 ? atual : atual.filter((l) => l.id !== id)));
  };

  const linhasValidas = linhas
    .map((l) => ({ ...l, item: itens.find((i) => i.id === l.itemId), qtd: Number(String(l.quantidade).replace(",", ".")) }))
    .filter((l) => l.item && l.qtd > 0);

  const totalConsumo = linhasValidas.reduce((s, l) => s + (l.item ? l.qtd * l.item.custoMedio : 0), 0);

  const handleRegistrar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!clienteSelecionado) { triggerToast("⚠ Selecione o cliente."); return; }
    if (linhasValidas.length === 0) { triggerToast("⚠ Adicione ao menos um item com quantidade."); return; }

    setEnviando(true);
    try {
      for (const l of linhasValidas) {
        if (!l.item) continue;
        const atualizado = registrarSaida(l.item, {
          quantidade: l.qtd,
          data,
          clienteId: clienteSelecionado.id,
          clienteNome: clienteSelecionado.nome,
          vendaId: vendaId || undefined,
        });
        await persistirItem(atualizado);
      }
      triggerToast(`✓ Consumo registrado para ${clienteSelecionado.nome} — ${emReais(totalConsumo)} em material.`);
      setClienteId(""); setVendaId(""); setData(hojeBR()); setLinhas([novaLinhaConsumo()]);
    } finally {
      setEnviando(false);
    }
  };

  return (
    <form onSubmit={handleRegistrar} className="max-w-3xl bg-white p-6 md:p-8 rounded-3xl border border-slate-200/50 shadow-xs space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className={rotuloCampo}><Users className="w-3 h-3 inline mr-1 -mt-0.5" />Cliente</label>
          <select required value={clienteId} onChange={(e) => { setClienteId(e.target.value); setVendaId(""); }} className={`${campo} bg-white`}>
            <option value="">Selecione o cliente</option>
            {clientes.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
          </select>
        </div>
        <div>
          <label className={rotuloCampo}>Venda vinculada (opcional)</label>
          <select value={vendaId} onChange={(e) => setVendaId(e.target.value)} className={`${campo} bg-white`} disabled={!clienteId}>
            <option value="">Nenhuma — só o cliente</option>
            {vendasDoCliente.map((t) => (
              <option key={t.id} value={t.id}>{t.data} — {t.descricao.slice(0, 40)}</option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <label className={rotuloCampo}><Calendar className="w-3 h-3 inline mr-1 -mt-0.5" />Data do consumo</label>
        <input type="text" placeholder="dd/mm/aaaa" value={data} onChange={(e) => setData(e.target.value)} className={`${campo} font-mono max-w-[10rem]`} />
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <label className={rotuloCampo + " mb-0"}>Itens usados</label>
          <button type="button" onClick={() => setLinhas((a) => [...a, novaLinhaConsumo()])} className="px-2.5 py-1 bg-blue-50 hover:bg-blue-100 text-blue-700 text-[10px] font-bold rounded-lg flex items-center gap-1 cursor-pointer">
            <Plus className="w-3 h-3" /> Adicionar item
          </button>
        </div>

        {linhas.map((linha) => {
          const item = itens.find((i) => i.id === linha.itemId);
          const qtd = Number(String(linha.quantidade).replace(",", "."));
          const suficiente = !item || !qtd || estoqueSuficiente(item, qtd);
          return (
            <div key={linha.id} className="bg-slate-50 border border-slate-200/70 rounded-2xl p-3.5 space-y-2">
              <div className="grid grid-cols-1 sm:grid-cols-[1fr_8rem] gap-2.5 items-end">
                <div>
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block mb-1">Item</label>
                  <select value={linha.itemId} onChange={(e) => alterarLinha(linha.id, { itemId: e.target.value })} className={`${campo} bg-white`}>
                    <option value="">Selecione...</option>
                    {itens.map((i) => (
                      <option key={i.id} value={i.id}>{i.nome} — {i.quantidadeAtual} {i.unidade} disponível</option>
                    ))}
                  </select>
                </div>
                <div className="flex items-end gap-2">
                  <div className="flex-1">
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block mb-1">Qtd.</label>
                    <input type="number" step="0.01" min="0" placeholder="0" value={linha.quantidade}
                      onChange={(e) => alterarLinha(linha.id, { quantidade: e.target.value })} className={`${campo} font-mono font-bold`} />
                  </div>
                  {linhas.length > 1 && (
                    <button type="button" onClick={() => removerLinha(linha.id)} className="p-2.5 text-slate-300 hover:text-red-600 hover:bg-red-50 rounded-lg shrink-0">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>
              {item && qtd > 0 && (
                <div className="flex items-center justify-between text-[11px]">
                  <span className={suficiente ? "text-slate-400" : "text-amber-700 font-bold flex items-center gap-1"}>
                    {!suficiente && <AlertTriangle className="w-3 h-3" />}
                    {suficiente ? `Custo médio ${emReais(item.custoMedio)}/${item.unidade}` : `Só tem ${item.quantidadeAtual} ${item.unidade} — vai ficar negativo`}
                  </span>
                  <span className="font-bold text-slate-700">{emReais(qtd * item.custoMedio)}</span>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="flex items-center justify-between bg-slate-900 text-white rounded-2xl p-4">
        <span className="text-[10px] font-extrabold uppercase tracking-widest text-slate-400">Total do consumo</span>
        <span className="text-xl font-bold font-mono">{emReais(totalConsumo)}</span>
      </div>

      <button
        type="submit"
        disabled={enviando}
        className="w-full py-4 bg-blue-600 hover:bg-blue-700 text-white font-extrabold text-xs rounded-xl shadow-lg transition-all cursor-pointer uppercase tracking-wider disabled:opacity-60"
      >
        {enviando ? "Registrando..." : "Registrar consumo"}
      </button>
    </form>
  );
}

/* ============================================================================
   ABA 3 — RELATÓRIO: para onde foi cada baixa
   ============================================================================ */

function AbaRelatorio({ itens, clientes }: { itens: ItemEstoque[]; clientes: Cliente[] }) {
  const [de, setDe] = useState("");
  const [ate, setAte] = useState("");
  const [clienteFiltro, setClienteFiltro] = useState("");

  const todasBaixas = baixasNoPeriodo(itens, paraISO(de) || undefined, paraISO(ate) || undefined);
  const baixas = clienteFiltro ? todasBaixas.filter((l) => l.movimento.clienteId === clienteFiltro) : todasBaixas;
  const porCliente = totalBaixasPorCliente(baixas);
  const totalGeral = baixas.reduce((s, l) => s + l.movimento.valorTotal, 0);

  return (
    <div className="space-y-6">
      <div className="bg-white p-5 rounded-2xl border border-slate-200/60 shadow-xs flex flex-col sm:flex-row gap-3 sm:items-end">
        <div className="flex-1">
          <label className={rotuloCampo}>De</label>
          <input type="date" value={de} onChange={(e) => setDe(e.target.value)} className={campo} />
        </div>
        <div className="flex-1">
          <label className={rotuloCampo}>Até</label>
          <input type="date" value={ate} onChange={(e) => setAte(e.target.value)} className={campo} />
        </div>
        <div className="flex-1">
          <label className={rotuloCampo}>Cliente</label>
          <select value={clienteFiltro} onChange={(e) => setClienteFiltro(e.target.value)} className={`${campo} bg-white`}>
            <option value="">Todos</option>
            {clientes.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="bg-slate-900 text-white rounded-2xl p-5">
          <span className="text-[10px] font-extrabold uppercase tracking-widest text-slate-400 block">Total baixado no período</span>
          <span className="text-2xl font-bold font-mono">{emReais(totalGeral)}</span>
          <p className="text-[11px] text-slate-400 mt-1">{baixas.length} {baixas.length === 1 ? "baixa" : "baixas"}</p>
        </div>
        <div className="bg-white rounded-2xl border border-slate-200/60 p-5">
          <span className="text-[10px] font-extrabold uppercase tracking-widest text-slate-400 block mb-2">Por cliente</span>
          {porCliente.length === 0 ? (
            <p className="text-xs text-slate-400">Nenhuma baixa no período.</p>
          ) : (
            <div className="space-y-1.5 max-h-32 overflow-y-auto">
              {porCliente.map((c) => (
                <div key={c.clienteId || c.clienteNome} className="flex items-center justify-between text-xs">
                  <span className="text-slate-600 font-medium truncate">{c.clienteNome}</span>
                  <span className="font-bold text-slate-800 shrink-0 ml-2">{emReais(c.total)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="bg-white rounded-3xl border border-slate-200/60 shadow-xs overflow-hidden">
        {baixas.length === 0 ? (
          <div className="text-center py-16 text-slate-400">
            <Package className="w-8 h-8 mx-auto mb-2 text-slate-300" />
            <p className="text-sm font-medium">Nenhuma baixa encontrada para este filtro.</p>
          </div>
        ) : (
          <div className="divide-y divide-slate-100 max-h-[32rem] overflow-y-auto">
            {baixas.map(({ item, movimento }) => (
              <div key={movimento.id} className="px-6 py-3.5 flex items-center justify-between gap-4 hover:bg-slate-50/50">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-slate-800 truncate">{movimento.clienteNome || "Sem cliente"}</p>
                  <p className="text-[11px] text-slate-400 truncate">
                    {movimento.data} · {item.nome} · {movimento.quantidade} {item.unidade}
                  </p>
                </div>
                <span className="text-sm font-bold text-rose-600 shrink-0">−{emReais(movimento.valorTotal)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
