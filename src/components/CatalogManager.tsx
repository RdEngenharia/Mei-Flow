import React, { useState, useEffect } from "react";
import { 
  Sparkles, 
  Plus, 
  Trash2, 
  Loader2, 
  Search, 
  Package, 
  Scissors,
  Wrench,
  TrendingUp,
  AlertCircle
} from "lucide-react";
import { db, auth, handleFirestoreError, OperationType } from "../firebase";
import { collection, getDocs, addDoc, doc, deleteDoc, query } from "firebase/firestore";
import { CatalogItem } from "../types";

interface CatalogManagerProps {
  userId: string;
  planType: "free" | "premium";
  onTriggerUpgrade: () => void;
  onGoBack: () => void;
  triggerToast: (msg: string) => void;
}

export default function CatalogManager({ 
  userId, 
  planType, 
  onTriggerUpgrade, 
  onGoBack, 
  triggerToast 
}: CatalogManagerProps) {
  const [items, setItems] = useState<CatalogItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [adding, setAdding] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  // Form states
  const [title, setTitle] = useState("");
  const [type, setType] = useState<"produto" | "serviço">("serviço");
  const [price, setPrice] = useState<string>("");

  // Fetch catalog items from Firestore
  const fetchCatalog = async () => {
    if (!userId || planType !== "premium") return;
    setLoading(true);
    const path = `users/${userId}/catalog`;
    try {
      const colRef = collection(db, "users", userId, "catalog");
      const snap = await getDocs(colRef);
      const fetchedItems: CatalogItem[] = snap.docs.map(docSnap => {
        const data = docSnap.data();
        return {
          id: docSnap.id,
          title: data.title || "",
          type: data.type || "serviço",
          price: Number(data.price) || 0
        };
      });
      setItems(fetchedItems);
    } catch (err) {
      console.error("Error fetching catalog:", err);
      // Fallback local persistence if offline
      const local = localStorage.getItem(`meiflow_catalog_${userId}`);
      if (local) {
        setItems(JSON.parse(local));
      } else {
        handleFirestoreError(err, OperationType.LIST, path);
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchCatalog();
  }, [userId, planType]);

  // Handle adding new item
  const handleAddItem = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !price || isNaN(Number(price))) {
      triggerToast("⚠ Por favor, preencha todos os campos corretamente.");
      return;
    }

    if (planType !== "premium") {
      onTriggerUpgrade();
      return;
    }

    setAdding(true);
    const itemPrice = Math.max(0, Number(price));
    const path = `users/${userId}/catalog`;

    try {
      const colRef = collection(db, "users", userId, "catalog");
      const payload = {
        title: title.trim(),
        type,
        price: itemPrice,
        createdAt: new Date().toISOString()
      };
      
      const docRef = await addDoc(colRef, payload);
      
      const newItem: CatalogItem = {
        id: docRef.id,
        title: title.trim(),
        type,
        price: itemPrice
      };

      const updatedItems = [newItem, ...items];
      setItems(updatedItems);
      localStorage.setItem(`meiflow_catalog_${userId}`, JSON.stringify(updatedItems));

      setTitle("");
      setPrice("");
      triggerToast("✓ Item adicionado ao catálogo com sucesso!");
    } catch (err) {
      console.error("Error adding item:", err);
      handleFirestoreError(err, OperationType.WRITE, path);
    } finally {
      setAdding(false);
    }
  };

  // Handle deleting item
  const handleDeleteItem = async (itemId: string) => {
    const path = `users/${userId}/catalog/${itemId}`;
    try {
      const docRef = doc(db, "users", userId, "catalog", itemId);
      await deleteDoc(docRef);

      const updatedItems = items.filter(item => item.id !== itemId);
      setItems(updatedItems);
      localStorage.setItem(`meiflow_catalog_${userId}`, JSON.stringify(updatedItems));
      
      triggerToast("✓ Item removido do catálogo.");
    } catch (err) {
      console.error("Error deleting catalog item:", err);
      handleFirestoreError(err, OperationType.DELETE, path);
    }
  };

  // Pre-configured lock screen for free users
  if (planType !== "premium") {
    return (
      <div className="space-y-8 animate-fade-in text-left">
        <div className="flex items-center gap-2 mb-2">
          <button 
            onClick={onGoBack}
            className="flex items-center gap-1.5 text-xs font-bold text-slate-600 hover:text-slate-950 transition-all bg-white px-4 py-2 border border-slate-200 rounded-xl shadow-xs cursor-pointer"
          >
            <span>&larr; Voltar para o Início (Home)</span>
          </button>
        </div>

        <div className="bg-white rounded-3xl border border-slate-200/50 shadow-md p-10 md:p-16 text-center max-w-2xl mx-auto space-y-6">
          <div className="w-16 h-16 bg-blue-50 text-blue-600 rounded-3xl flex items-center justify-center mx-auto border border-blue-100 shadow-xs">
            <Sparkles className="w-8 h-8 text-indigo-600 animate-pulse" />
          </div>

          <div className="space-y-2">
            <h2 className="text-2xl md:text-3xl font-display font-light text-slate-900 tracking-tight">
              Recurso Exclusivo do Plano Premium
            </h2>
            <p className="text-sm text-slate-500 leading-relaxed max-w-md mx-auto">
              O **Catálogo de Serviços e Produtos recorrentes** permite cadastrar de forma permanente seus itens mais vendidos para preencher orçamentos com apenas um clique!
            </p>
          </div>

          <div className="p-5 bg-slate-50 rounded-2xl border border-slate-200/40 text-left space-y-3">
            <h4 className="text-xs font-bold text-slate-700 uppercase tracking-wider">Benefícios do Catálogo Automático:</h4>
            <ul className="text-xs text-slate-600 space-y-1.5 list-disc list-inside">
              <li>Cadastre produtos ou serviços com valores padronizados.</li>
              <li>Busca integrada e preenchimento instantâneo no gerador de orçamento.</li>
              <li>Evite erros manuais de digitação ou cálculo.</li>
              <li>Emissão de orçamentos e comprovantes personalizados sem selo MEI Flow.</li>
            </ul>
          </div>

          <div className="pt-4 flex flex-col sm:flex-row gap-3 justify-center">
            <button
              onClick={onTriggerUpgrade}
              className="px-8 py-3.5 bg-slate-950 hover:bg-slate-900 text-white rounded-xl font-bold text-xs transition-all tracking-wider uppercase cursor-pointer shadow-lg"
            >
              Liberar Catálogo com Premium (R$ 29,90/mês) ✨
            </button>
            <button
              onClick={onGoBack}
              className="px-8 py-3.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl font-bold text-xs transition-all cursor-pointer"
            >
              Permanecer no Plano Livre
            </button>
          </div>
        </div>
      </div>
    );
  }

  const filteredItems = items.filter(item => 
    item.title.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="space-y-8 animate-fade-in text-left">
      <div className="flex items-center gap-2 mb-2">
        <button 
          onClick={onGoBack}
          className="flex items-center gap-1.5 text-xs font-bold text-slate-600 hover:text-slate-950 transition-all bg-white px-4 py-2 border border-slate-200 rounded-xl shadow-xs cursor-pointer"
        >
          <span>&larr; Voltar para o Início (Home)</span>
        </button>
      </div>

      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-6 pb-6 border-b border-slate-100">
        <div>
          <h1 className="text-3xl md:text-4xl font-display font-light text-slate-900 tracking-tight flex items-center gap-2">
            <span>Catálogo de Itens</span>
            <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-blue-50 text-blue-700 text-[10px] font-bold uppercase tracking-wider border border-blue-100">
              Premium
            </span>
          </h1>
          <p className="text-xs md:text-sm text-slate-400 mt-1 font-medium">
            Cadastre seus serviços e produtos de alta frequência para preenchimento ágil de orçamentos.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        
        {/* Adicionar Novo Item Form */}
        <div className="bg-white p-6 rounded-3xl border border-slate-200/50 shadow-sm space-y-4 h-fit">
          <h3 className="text-sm font-bold text-slate-800 uppercase tracking-wider flex items-center gap-1.5 pb-2 border-b border-slate-50">
            <Plus className="w-4 h-4 text-blue-600" /> Cadastrar Novo Item
          </h3>

          <form onSubmit={handleAddItem} className="space-y-4">
            <div className="space-y-1">
              <label className="text-[10px] font-extrabold text-slate-500 uppercase tracking-wider block">Nome do Produto ou Serviço *</label>
              <input
                type="text"
                required
                placeholder="Ex: Consultoria em TI 1h, Peça de Motor"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 text-xs focus:ring-1 focus:ring-blue-500 focus:bg-white outline-hidden"
              />
            </div>

            <div className="space-y-1">
              <label className="text-[10px] font-extrabold text-slate-500 uppercase tracking-wider block">Tipo de Item</label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setType("serviço")}
                  className={`py-2 px-3 rounded-xl border font-bold text-xs flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
                    type === "serviço" 
                      ? "border-blue-600 bg-blue-50/30 text-blue-700" 
                      : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                  }`}
                >
                  <Wrench className="w-3.5 h-3.5" />
                  <span>Serviço</span>
                </button>
                <button
                  type="button"
                  onClick={() => setType("produto")}
                  className={`py-2 px-3 rounded-xl border font-bold text-xs flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
                    type === "produto" 
                      ? "border-blue-600 bg-blue-50/30 text-blue-700" 
                      : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                  }`}
                >
                  <Package className="w-3.5 h-3.5" />
                  <span>Produto</span>
                </button>
              </div>
            </div>

            <div className="space-y-1">
              <label className="text-[10px] font-extrabold text-slate-500 uppercase tracking-wider block font-sans">Valor Unitário Padrão (R$) *</label>
              <div className="relative">
                <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 text-xs font-bold">R$</span>
                <input
                  type="number"
                  step="0.01"
                  required
                  placeholder="0,00"
                  value={price}
                  onChange={(e) => setPrice(e.target.value)}
                  className="w-full pl-10 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 text-xs focus:ring-1 focus:ring-blue-500 focus:bg-white outline-hidden font-mono"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={adding}
              className="w-full py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-200 text-white font-extrabold text-xs rounded-xl shadow-md transition-all flex items-center justify-center gap-1.5 cursor-pointer uppercase tracking-wider"
            >
              {adding ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin text-white" />
                  <span>Cadastrando...</span>
                </>
              ) : (
                <>
                  <Plus className="w-4 h-4 shrink-0" />
                  <span>Adicionar ao Catálogo</span>
                </>
              )}
            </button>
          </form>
        </div>

        {/* Catalog Items Listing */}
        <div className="lg:col-span-2 bg-white p-6 rounded-3xl border border-slate-200/50 shadow-sm space-y-6">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4 pb-4 border-b border-slate-100">
            <h3 className="text-sm font-bold text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
              <Package className="w-4 h-4 text-slate-500" /> Seus Itens Cadastrados ({items.length})
            </h3>
            
            <div className="relative w-full sm:w-60">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                placeholder="Buscar itens..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-9 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 text-xs focus:ring-1 focus:ring-blue-500 focus:bg-white outline-hidden"
              />
            </div>
          </div>

          {loading ? (
            <div className="py-20 flex flex-col items-center justify-center gap-2 text-slate-400">
              <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
              <p className="text-xs font-semibold">Carregando catálogo...</p>
            </div>
          ) : filteredItems.length === 0 ? (
            <div className="text-center py-16 bg-slate-50 rounded-2xl border border-dashed border-slate-200 p-8 space-y-2">
              <p className="text-sm text-slate-400 italic">Nenhum item localizado no catálogo.</p>
              <p className="text-[11px] text-slate-400">Cadastre suas mercadorias ou serviços frequentes no painel lateral.</p>
            </div>
          ) : (
            <div className="divide-y divide-slate-100 max-h-[480px] overflow-y-auto pr-1">
              {filteredItems.map((item) => (
                <div 
                  key={item.id} 
                  className="py-4 flex items-center justify-between gap-4 group hover:bg-slate-50/50 -mx-2 px-2 rounded-xl transition-all"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className={`w-8.5 h-8.5 rounded-lg flex items-center justify-center shrink-0 shadow-xs border ${
                      item.type === "serviço" 
                        ? "bg-amber-50 text-amber-600 border-amber-100" 
                        : "bg-emerald-50 text-emerald-600 border-emerald-100"
                    }`}>
                      {item.type === "serviço" ? <Wrench className="w-4 h-4" /> : <Package className="w-4 h-4" />}
                    </div>
                    <div className="min-w-0 text-left">
                      <span className="text-xs font-bold text-slate-800 block truncate">{item.title}</span>
                      <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">
                        {item.type === "serviço" ? "Serviço" : "Produto"}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center gap-4 shrink-0">
                    <span className="text-xs font-bold text-slate-900 font-mono">
                      R$ {item.price.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
                    </span>
                    <button
                      onClick={() => handleDeleteItem(item.id)}
                      className="p-1 px-1.5 text-slate-300 hover:text-red-600 hover:bg-red-50 rounded-lg transition-all cursor-pointer"
                      title="Excluir item do catálogo"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

        </div>

      </div>
    </div>
  );
}
