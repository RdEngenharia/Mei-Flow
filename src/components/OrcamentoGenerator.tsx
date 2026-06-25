import React, { useState, useEffect, useRef } from "react";
import { 
  Sparkles, 
  Plus, 
  Trash2, 
  Loader2, 
  Search, 
  Package, 
  Wrench,
  FileText,
  Calendar,
  DollarSign,
  User,
  CheckCircle2,
  Printer,
  X,
  Building,
  Mail,
  Phone,
  Bookmark,
  Share2
} from "lucide-react";
import { db, auth, handleFirestoreError, OperationType } from "../firebase";
import { collection, getDocs } from "firebase/firestore";
import { saveHtmlElementAsPdf, isNativePlatform } from "../utils/nativeFile";
import { CatalogItem, Cliente, Orcamento } from "../types";

interface OrcamentoGeneratorProps {
  userId: string;
  planType: "free" | "premium";
  companyLogo?: string;
  meiName: string;
  cnpjPrestador?: string;
  inscricaoMunicipal?: string;
  telefonePrestador?: string;
  clientes: Cliente[];
  onTriggerUpgrade: () => void;
  onGoBack: () => void;
  triggerToast: (msg: string) => void;
}

export default function OrcamentoGenerator({
  userId,
  planType,
  companyLogo,
  meiName,
  cnpjPrestador,
  inscricaoMunicipal,
  telefonePrestador,
  clientes,
  onTriggerUpgrade,
  onGoBack,
  triggerToast
}: OrcamentoGeneratorProps) {
  // Navigation inside quote generator
  const [activeTab, setActiveTab] = useState<"criar" | "historico">("criar");
  const [historico, setHistorico] = useState<Orcamento[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);

  // Client dropdown search in Orcamento Form
  const [showClientDropdown, setShowClientDropdown] = useState(false);
  const [selectedClient, setSelectedClient] = useState<Cliente | null>(null);

  // Form Fields
  const [clienteNome, setClienteNome] = useState("");
  const [clienteDocumento, setClienteDocumento] = useState("");
  const [clienteEmail, setClienteEmail] = useState("");
  const [clienteTelefone, setClienteTelefone] = useState("");

  const [itemTipo, setItemTipo] = useState<"produto" | "serviço">("serviço");
  const [itemNome, setItemNome] = useState("");
  const [itemValor, setItemValor] = useState<string>("");
  const [validade, setValidade] = useState(() => {
    // Default validade is 15 days from today
    const date = new Date();
    date.setDate(date.getDate() + 15);
    return date.toISOString().split("T")[0];
  });

  // Catalog Picker Dialog state (Premium Only)
  const [showCatalogModal, setShowCatalogModal] = useState(false);
  const [catalogItems, setCatalogItems] = useState<CatalogItem[]>([]);
  const [loadingCatalog, setLoadingCatalog] = useState(false);
  const [catalogSearch, setCatalogSearch] = useState("");

  // Preview generated quote sheet
  const [activePreviewQuote, setActivePreviewQuote] = useState<Orcamento | null>(null);

  // Load quotes history on mount/change
  const fetchQuotesHistory = () => {
    const key = `meiflow_quotes_${userId || "anonymous"}`;
    const saved = localStorage.getItem(key);
    if (saved) {
      try {
        setHistorico(JSON.parse(saved));
      } catch (e) {
        console.error(e);
      }
    }
  };

  useEffect(() => {
    fetchQuotesHistory();
  }, [userId]);

  // Handle client selection from dropdown
  const selectClientData = (cli: Cliente) => {
    setSelectedClient(cli);
    setClienteNome(cli.nome);
    setClienteDocumento(cli.documento || "");
    setClienteEmail(cli.email || "");
    setClienteTelefone(cli.telefone || "");
    setShowClientDropdown(false);
    triggerToast(`✓ Cliente ${cli.nome} vinculado!`);
  };

  // Open & Load Catalog Modal items (Premium only)
  const handleOpenCatalogPicker = async () => {
    if (planType !== "premium") {
      onTriggerUpgrade();
      return;
    }

    setShowCatalogModal(true);
    setLoadingCatalog(true);
    const path = `users/${userId}/catalog`;
    try {
      const colRef = collection(db, "users", userId, "catalog");
      const snap = await getDocs(colRef);
      const items: CatalogItem[] = snap.docs.map(docSnap => {
        const data = docSnap.data();
        return {
          id: docSnap.id,
          title: data.title || "",
          type: data.type || "serviço",
          price: Number(data.price) || 0
        };
      });
      setCatalogItems(items);
    } catch (err) {
      console.warn("Offline or rule error loading catalog inside picker:", err);
      // Fallback local storage
      const local = localStorage.getItem(`meiflow_catalog_${userId}`);
      if (local) {
        setCatalogItems(JSON.parse(local));
      }
    } finally {
      setLoadingCatalog(false);
    }
  };

  // Select catalog item and auto-fill form fields
  const handleSelectCatalogItem = (item: CatalogItem) => {
    setItemNome(item.title);
    setItemTipo(item.type);
    setItemValor(item.price.toString());
    setShowCatalogModal(false);
    triggerToast(`✓ Item "${item.title}" carregado do catálogo!`);
  };

  // Create new Quote
  const handleCreateOrcamento = (e: React.FormEvent) => {
    e.preventDefault();
    if (!clienteNome.trim() || !itemNome.trim() || !itemValor || !validade) {
      triggerToast("⚠ Certifique-se de preencher todos os campos obrigatórios.");
      return;
    }

    const valorNum = Math.max(0, Number(itemValor));
    if (isNaN(valorNum)) {
      triggerToast("⚠ Valor do item inválido.");
      return;
    }

    const newQuote: Orcamento = {
      id: "orc_" + Date.now(),
      clienteId: selectedClient?.id || "manual_input",
      clienteNome: clienteNome.trim(),
      clienteDocumento: clienteDocumento.trim() || undefined,
      clienteEmail: clienteEmail.trim() || undefined,
      clienteTelefone: clienteTelefone.trim() || undefined,
      itemTipo,
      itemNome: itemNome.trim(),
      itemValor: valorNum,
      validade,
      createdAt: new Date().toISOString()
    };

    const updatedHistory = [newQuote, ...historico];
    setHistorico(updatedHistory);
    localStorage.setItem(`meiflow_quotes_${userId || "anonymous"}`, JSON.stringify(updatedHistory));

    // Open sheet preview modal
    setActivePreviewQuote(newQuote);
    triggerToast("✓ Orçamento gerado com sucesso!");

    // General Reset Form
    setSelectedClient(null);
    setClienteNome("");
    setClienteDocumento("");
    setClienteEmail("");
    setClienteTelefone("");
    setItemNome("");
    setItemValor("");
  };

  // Print function
  const printableRef = useRef<HTMLDivElement>(null);
  const [isSavingQuotePdf, setIsSavingQuotePdf] = useState(false);

  const handlePrintQuote = async () => {
    // window.print() não funciona dentro do WebView do Android (Capacitor) —
    // não há motor de impressão do navegador nesse contexto. Nesse caso,
    // convertemos o próprio elemento visível em PDF (via html2canvas, já
    // incluso no jsPDF) e salvamos direto na pasta de Downloads do celular.
    if (isNativePlatform()) {
      if (!printableRef.current || isSavingQuotePdf) return;
      setIsSavingQuotePdf(true);
      try {
        const fileName = `orcamento_${activePreviewQuote?.cliente?.nome || "mei_flow"}_${Date.now()}.pdf`
          .replace(/\s+/g, "_");
        await saveHtmlElementAsPdf(printableRef.current, fileName);
      } catch (err) {
        console.error("Erro ao gerar PDF do orçamento:", err);
      } finally {
        setIsSavingQuotePdf(false);
      }
      return;
    }
    window.print();
  };

  // Delete quote from history list
  const handleDeleteQuote = (id: string) => {
    const updated = historico.filter(item => item.id !== id);
    setHistorico(updated);
    localStorage.setItem(`meiflow_quotes_${userId || "anonymous"}`, JSON.stringify(updated));
    triggerToast("✓ Orçamento excluído do histórico.");
  };

  return (
    <div className="space-y-8 animate-fade-in text-left font-sans">
      
      {/* Return Row */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <button 
          onClick={onGoBack}
          className="flex items-center gap-1.5 text-xs font-bold text-slate-600 hover:text-slate-950 transition-all bg-white px-4 py-2 border border-slate-200 rounded-xl shadow-xs cursor-pointer"
        >
          <span>&larr; Voltar para o Início (Home)</span>
        </button>

        {/* Option Tabs */}
        <div className="inline-flex gap-1 bg-slate-100 p-1 rounded-xl border border-slate-200/50">
          <button
            onClick={() => setActiveTab("criar")}
            className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
              activeTab === "criar"
                ? "bg-white text-slate-900 shadow-xs"
                : "text-slate-500 hover:text-slate-900"
            }`}
          >
            Emitir Novo Orçamento
          </button>
          <button
            onClick={() => {
              setActiveTab("historico");
              fetchQuotesHistory();
            }}
            className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
              activeTab === "historico"
                ? "bg-white text-slate-900 shadow-xs"
                : "text-slate-500 hover:text-slate-900"
            }`}
          >
            Histórico de Emitidos ({historico.length})
          </button>
        </div>
      </div>

      {/* Header Info */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-6 pb-6 border-b border-slate-100">
        <div>
          <h1 className="text-3xl md:text-4xl font-display font-light text-slate-900 tracking-tight flex items-center gap-2">
            <span>Gerador de Orçamentos Profissionais</span>
            {planType === "premium" && (
              <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-blue-50 text-blue-700 text-[9px] font-extrabold uppercase tracking-widest border border-blue-100">
                Premium Ativo
              </span>
            )}
          </h1>
          <p className="text-xs md:text-sm text-slate-400 mt-1 font-medium">
            Gere orçamentos e propostas comerciais formatadas em segundos com ou sem sua logo personalizada.
          </p>
        </div>
      </div>

      {activeTab === "criar" ? (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
          
          {/* Form Create Quote Container */}
          <form onSubmit={handleCreateOrcamento} className="lg:col-span-8 bg-white p-6 md:p-8 rounded-3xl border border-slate-200/50 shadow-xs space-y-6">
            
            {/* Header Form action row */}
            <div className="flex items-center justify-between border-b border-slate-100 pb-3 flex-wrap gap-2">
              <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
                <FileText className="w-4 h-4 text-blue-500" /> Detalhes da Proposta Comercial
              </h3>

              {planType === "premium" ? (
                <button
                  type="button"
                  onClick={handleOpenCatalogPicker}
                  className="px-3.5 py-1.5 bg-indigo-50/50 border border-indigo-200 hover:bg-indigo-100/60 text-indigo-700 text-[11px] font-bold rounded-xl shadow-2xs flex items-center gap-1.5 transition-all cursor-pointer"
                  title="Abra a lista de itens do seu catálogo permanente para preencher os campos automaticamente"
                >
                  <Sparkles className="w-3.5 h-3.5 text-yellow-500 animate-pulse" />
                  <span>Buscar do Catálogo</span>
                </button>
              ) : (
                <div 
                  onClick={onTriggerUpgrade}
                  className="px-3 py-1 bg-slate-50 border border-slate-200 text-slate-400 text-[10px] font-semibold rounded-lg flex items-center gap-1 cursor-pointer hover:bg-slate-100"
                  title="Navegação em catálogo inteligente é exclusivo para clientes Premium do MEI Flow."
                >
                  <Sparkles className="w-3 h-3 text-slate-400" />
                  <span>Buscar do Catálogo (🔒 Premium)</span>
                </div>
              )}
            </div>

            {/* SEÇÃO 1: DADOS DO CLIENTE */}
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h4 className="text-[10px] font-extrabold text-slate-400 uppercase tracking-widest flex items-center gap-1">
                  <User className="w-3.5 h-3.5" /> 1. Informações do Destinatário (Cliente)
                </h4>
                
                {/* Auto Complete client suggestions */}
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setShowClientDropdown(!showClientDropdown)}
                    className="text-[10.5px] font-bold text-blue-600 hover:text-blue-800 transition-all cursor-pointer hover:underline"
                  >
                    Vincular Cliente Cadastrado &darr;
                  </button>

                  {showClientDropdown && (
                    <div className="absolute right-0 top-6 w-60 bg-white border border-slate-200 rounded-xl shadow-lg z-20 p-2 text-xs divide-y divide-slate-100 max-h-48 overflow-y-auto">
                      {clientes.length === 0 ? (
                        <p className="p-2 text-slate-400 italic text-center">Nenhum cliente cadastrado.</p>
                      ) : (
                        clientes.map(cli => (
                          <div
                            key={cli.id}
                            onClick={() => selectClientData(cli)}
                            className="p-2 hover:bg-slate-50 cursor-pointer rounded-lg text-left truncate"
                          >
                            <span className="font-bold text-slate-800 block truncate">{cli.nome}</span>
                            <span className="text-[10px] text-slate-400 font-mono block">{cli.documento || "Sem documento"}</span>
                          </div>
                        ))
                      )}
                    </div>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-slate-600 uppercase tracking-wider block">Nome ou Razão Social do Cliente *</label>
                  <input
                    type="text"
                    required
                    placeholder="Ex: Ana Souza Martins"
                    value={clienteNome}
                    onChange={(e) => setClienteNome(e.target.value)}
                    className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 text-xs focus:ring-1 focus:ring-blue-500 focus:bg-white outline-hidden"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-slate-600 uppercase tracking-wider block">CPF ou CNPJ do Cliente (Opcional)</label>
                  <input
                    type="text"
                    placeholder="Ex: 123.456.789-00"
                    value={clienteDocumento}
                    onChange={(e) => setClienteDocumento(e.target.value)}
                    className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 text-xs focus:ring-1 focus:ring-blue-500 focus:bg-white outline-hidden font-mono"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-slate-600 uppercase tracking-wider block">E-mail do Cliente (Opcional)</label>
                  <input
                    type="email"
                    placeholder="Ex: cliente@email.com"
                    value={clienteEmail}
                    onChange={(e) => setClienteEmail(e.target.value)}
                    className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 text-xs focus:ring-1 focus:ring-blue-500 focus:bg-white outline-hidden"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-slate-600 uppercase tracking-wider block">Telefone do Cliente (Opcional)</label>
                  <input
                    type="text"
                    placeholder="Ex: (11) 98888-7777"
                    value={clienteTelefone}
                    onChange={(e) => setClienteTelefone(e.target.value)}
                    className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 text-xs focus:ring-1 focus:ring-blue-500 focus:bg-white outline-hidden"
                  />
                </div>
              </div>
            </div>

            {/* SEÇÃO 2: DADOS DO PRODUTO / SERVIÇO */}
            <div className="space-y-4 pt-2 border-t border-slate-50">
              <h4 className="text-[10px] font-extrabold text-slate-400 uppercase tracking-widest flex items-center gap-1">
                <Bookmark className="w-3.5 h-3.5" /> 2. Descrição e Especificação Comercial
              </h4>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                
                {/* Tipo de Item (Selector) */}
                <div className="space-y-1 md:col-span-1">
                  <label className="text-[10px] font-bold text-slate-600 uppercase tracking-wider block">Tipo de Oferta</label>
                  <div className="grid grid-cols-2 gap-1 bg-slate-100 p-1 rounded-xl border border-slate-200/40">
                    <button
                      type="button"
                      onClick={() => setItemTipo("serviço")}
                      className={`py-1.5 rounded-lg font-bold text-xs flex items-center justify-center gap-1 transition-all cursor-pointer ${
                        itemTipo === "serviço" 
                          ? "bg-white text-slate-800 shadow-3xs" 
                          : "text-slate-500 hover:text-slate-800"
                      }`}
                    >
                      <Wrench className="w-3.5 h-3.5" />
                      <span>Serviço</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setItemTipo("produto")}
                      className={`py-1.5 rounded-lg font-bold text-xs flex items-center justify-center gap-1 transition-all cursor-pointer ${
                        itemTipo === "produto" 
                          ? "bg-white text-slate-800 shadow-3xs" 
                          : "text-slate-500 hover:text-slate-800"
                      }`}
                    >
                      <Package className="w-3.5 h-3.5" />
                      <span>Produto</span>
                    </button>
                  </div>
                </div>

                {/* Nome do Item */}
                <div className="space-y-1 md:col-span-2">
                  <label className="text-[10px] font-bold text-slate-600 uppercase tracking-wider block">Nome do Item comercializado *</label>
                  <input
                    type="text"
                    required
                    placeholder="Ex: Desenvolvimento de Site Institucional com 5 páginas"
                    value={itemNome}
                    onChange={(e) => setItemNome(e.target.value)}
                    className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 text-xs focus:ring-1 focus:ring-blue-500 focus:bg-white outline-hidden"
                  />
                </div>

                {/* Valor do Item */}
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-slate-600 uppercase tracking-wider block">Valor do Orçamento (R$) *</label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-xs font-bold">R$</span>
                    <input
                      type="number"
                      step="0.01"
                      required
                      placeholder="0,00"
                      value={itemValor}
                      onChange={(e) => setItemValor(e.target.value)}
                      className="w-full pl-9 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 text-xs focus:ring-1 focus:ring-blue-500 focus:bg-white outline-hidden font-mono"
                    />
                  </div>
                </div>

                {/* Validade do Orçamento */}
                <div className="space-y-1 md:col-span-2">
                  <label className="text-[10px] font-bold text-slate-600 uppercase tracking-wider block">Proposta Válida Até *</label>
                  <div className="relative">
                    <Calendar className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      type="date"
                      required
                      value={validade}
                      onChange={(e) => setValidade(e.target.value)}
                      className="w-full pl-9 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 text-xs focus:ring-1 focus:ring-blue-500 focus:bg-white outline-hidden font-mono"
                    />
                  </div>
                </div>

              </div>
            </div>

            <button
              type="submit"
              className="w-full py-4 bg-slate-950 hover:bg-slate-900 border border-transparent hover:border-slate-800 text-white font-extrabold text-xs rounded-xl shadow-lg transition-all flex items-center justify-center gap-1.5 cursor-pointer uppercase tracking-wider transition-all"
            >
              <FileText className="w-4 h-4 shrink-0" />
              <span>Gerar Proposta Comercial / Salvar PDF</span>
            </button>
          </form>

          {/* Quick Guide tips on side */}
          <div className="lg:col-span-4 bg-slate-50 p-6 rounded-3xl border border-slate-200/40 text-left space-y-4">
            <h4 className="text-[10px] font-extrabold text-slate-400 uppercase tracking-widest flex items-center gap-1">
              <Sparkles className="w-3.5 h-3.5 text-blue-500 animate-pulse" /> Recomendações e Regras
            </h4>
            
            <p className="text-xs text-slate-500 leading-relaxed font-medium">
              Todo orçamento emitido fica armazenado localmente para que você possa reimprimir ou reenviar propostas já estruturadas.
            </p>

            <div className="space-y-2 border-t border-slate-200/50 pt-3">
              <span className="text-[10px] font-bold text-slate-600 uppercase tracking-wider block">Isenção de Marca d'Água:</span>
              <p className="text-[11px] text-slate-500 leading-normal">
                {planType === "premium" 
                  ? "✓ Sua conta é Premium! Seus PDFs não possuem marca d'água da MEI Flow e são impressos com seu logotipo customizado." 
                  : "⚠ Clientes no plano Gratuito terão a chancela de segurança 'Gerado Eletronicamente pelo MEI Flow' impressa no rodapé de cada orçamento em PDF."}
              </p>
            </div>

            <div className="space-y-2 border-t border-slate-200/50 pt-3">
              <span className="text-[10px] font-bold text-slate-600 uppercase tracking-wider block">Dados Cadastrados Relevantes:</span>
              <div className="space-y-1 font-mono text-[10px] text-slate-500 bg-white p-3 rounded-xl border border-slate-200/40">
                <div className="truncate"><strong className="text-slate-700">Emissor:</strong> {meiName}</div>
                <div className="truncate"><strong className="text-slate-700">CNPJ:</strong> {cnpjPrestador || "Não cadastrado"}</div>
                {inscricaoMunicipal && <div className="truncate"><strong className="text-slate-700">Insc. Mun:</strong> {inscricaoMunicipal}</div>}
                {telefonePrestador && <div className="truncate"><strong className="text-slate-700">Fone MEI:</strong> {telefonePrestador}</div>}
              </div>
            </div>
          </div>

        </div>
      ) : (
        /* HISTORICO DE GERADOS SECTION */
        <div className="bg-white p-6 md:p-8 rounded-3xl border border-slate-200/50 shadow-xs space-y-6">
          <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider flex items-center gap-1.5 border-b border-slate-50 pb-3">
            <FileText className="w-4 h-4 text-slate-500" /> Histórico Comercial ({historico.length})
          </h3>

          {historico.length === 0 ? (
            <div className="text-center py-20 bg-slate-50 rounded-2xl border border-dashed border-slate-200 p-8 space-y-2">
              <p className="text-sm text-slate-400 italic">Nenhum orçamento emitido localizado.</p>
              <button
                onClick={() => setActiveTab("criar")}
                className="mt-2 text-xs text-blue-600 hover:text-blue-800 font-bold"
              >
                Gerar minha primeira proposta comercial &rarr;
              </button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs text-slate-600">
                <thead className="bg-slate-50 text-[10px] font-bold text-slate-400 uppercase tracking-wider rounded-lg">
                  <tr>
                    <th scope="col" className="py-3.5 px-4 font-extrabold">Data</th>
                    <th scope="col" className="py-3.5 px-4 font-extrabold">Cliente</th>
                    <th scope="col" className="py-3.5 px-4 font-extrabold">Especificação</th>
                    <th scope="col" className="py-3.5 px-4 font-extrabold">Preço</th>
                    <th scope="col" className="py-3.5 px-4 font-extrabold">Validade</th>
                    <th scope="col" className="py-3.5 px-4 font-extrabold text-right">Ações</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 font-sans">
                  {historico.map((orc) => (
                    <tr key={orc.id} className="group hover:bg-slate-50/50 transition-all">
                      <td className="py-4 px-4 font-mono font-medium text-slate-400">
                        {new Date(orc.createdAt).toLocaleDateString("pt-BR")}
                      </td>
                      <td className="py-4 px-4 font-bold text-slate-800">
                        <div className="flex flex-col">
                          <span>{orc.clienteNome}</span>
                          {orc.clienteDocumento && <span className="text-[10px] text-slate-400 font-normal font-mono">{orc.clienteDocumento}</span>}
                        </div>
                      </td>
                      <td className="py-4 px-4 font-medium text-slate-600 max-w-[180px] truncate" title={orc.itemNome}>
                        <div className="flex items-center gap-1.5">
                          <span className={`w-2 h-2 rounded-full shrink-0 ${orc.itemTipo === "serviço" ? "bg-amber-400" : "bg-emerald-400"}`}></span>
                          <span className="truncate">{orc.itemNome}</span>
                        </div>
                      </td>
                      <td className="py-4 px-4 font-bold text-slate-900 font-mono">
                        R$ {orc.itemValor.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
                      </td>
                      <td className="py-4 px-4 text-slate-400 font-medium">
                        {new Date(orc.validade + "T12:00:00").toLocaleDateString("pt-BR")}
                      </td>
                      <td className="py-4 px-4 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <button
                            onClick={() => setActivePreviewQuote(orc)}
                            className="bg-slate-100 hover:bg-blue-50 text-blue-700 py-1 px-3 font-semibold rounded-lg text-[10.5px] transition-all cursor-pointer"
                          >
                            Visualizar Proposal
                          </button>
                          <button
                            onClick={() => handleDeleteQuote(orc.id)}
                            className="p-1 text-slate-300 hover:text-red-600 hover:bg-red-50 rounded-lg transition-all cursor-pointer"
                            title="Remover Proposta"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* CATALOG AUTO FILL MODAL (Premium item picker) */}
      {showCatalogModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-start sm:items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white rounded-3xl max-w-lg w-full shadow-2xl border border-slate-200 overflow-hidden text-left flex flex-col max-h-[500px] my-auto">
            <div className="pt-safe px-6 pb-4 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
              <h3 className="font-bold text-slate-800 flex items-center gap-2">
                <Sparkles className="w-5 h-5 text-indigo-600 animate-pulse" />
                <span>Escolher do seu Catálogo Comercial</span>
              </h3>
              <button
                onClick={() => setShowCatalogModal(false)}
                className="text-slate-400 hover:text-slate-600 p-1 rounded-lg hover:bg-slate-100 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-4 border-b border-slate-100 bg-slate-50/50">
              <div className="relative">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  placeholder="Pesquisar itens cadastrados..."
                  value={catalogSearch}
                  onChange={(e) => setCatalogSearch(e.target.value)}
                  className="w-full pl-9 pr-4 py-2 bg-white border border-slate-200 rounded-xl text-slate-800 text-xs focus:ring-1 focus:ring-blue-500 outline-hidden"
                />
              </div>
            </div>

            <div className="flex-grow p-4 overflow-y-auto divide-y divide-slate-100">
              {loadingCatalog ? (
                <div className="py-12 flex flex-col items-center justify-center gap-1 text-slate-400">
                  <Loader2 className="w-6 h-6 animate-spin text-indigo-600" />
                  <span className="text-xs">Buscando itens na nuvem...</span>
                </div>
              ) : catalogItems.length === 0 ? (
                <div className="text-center py-10 text-slate-400">
                  <p className="text-xs italic">Você não possui itens cadastrados no catálogo.</p>
                  <p className="text-[10px] mt-1 text-slate-400">Vá no menu 'Catálogo' na tela inicial e configure seus produtos/serviços recorrentes.</p>
                </div>
              ) : (
                catalogItems
                  .filter(item => item.title.toLowerCase().includes(catalogSearch.toLowerCase()))
                  .map(item => (
                    <div
                      key={item.id}
                      onClick={() => handleSelectCatalogItem(item)}
                      className="py-3 flex items-center justify-between gap-4 cursor-pointer hover:bg-slate-50 rounded-lg -mx-1 px-2 transition-all"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 border ${
                          item.type === "serviço" ? "bg-amber-50 text-amber-600 border-amber-100" : "bg-emerald-50 text-emerald-600 border-emerald-100"
                        }`}>
                          {item.type === "serviço" ? <Wrench className="w-3.5 h-3.5" /> : <Package className="w-3.5 h-3.5" />}
                        </div>
                        <span className="text-xs font-bold text-slate-800 truncate block">{item.title}</span>
                      </div>
                      <span className="text-xs font-bold text-slate-900 font-mono">
                        R$ {item.price.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
                      </span>
                    </div>
                  ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* STUNNING HIGH FIDELITY PRINT PREVIEW MODAL */}
      {activePreviewQuote && (
        <div id="print-overlay" className="fixed inset-0 z-50 bg-slate-900/80 backdrop-blur-sm flex justify-center items-start p-4 sm:p-6 md:p-10 overflow-y-auto">
          <div className="bg-white rounded-3xl max-w-2xl w-full shadow-2xl border border-slate-200 overflow-hidden text-left flex flex-col my-4 sm:my-8 animate-scale-up">
            
            {/* Modal Controls Bar (hidden during standard browser print because we configure printable element) */}
            <div className="pt-safe px-6 pb-4 bg-slate-100 border-b border-slate-200 flex items-center justify-between print:hidden">
              <h3 className="font-bold text-slate-800 text-sm flex items-center gap-1.5">
                <CheckCircle2 className="w-5 h-5 text-emerald-500" />
                <span>Visualizador de Proposta Oficial</span>
              </h3>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handlePrintQuote}
                  disabled={isSavingQuotePdf}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-xl shadow-xs transition-all flex items-center gap-2 cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {isSavingQuotePdf ? (
                    <>
                      <Loader2 className="w-4 h-4 text-blue-100 animate-spin" />
                      <span>Salvando PDF...</span>
                    </>
                  ) : (
                    <>
                      <Printer className="w-4 h-4 text-blue-100" />
                      <span>Imprimir / Salvar PDF</span>
                    </>
                  )}
                </button>
                <button
                  onClick={() => setActivePreviewQuote(null)}
                  className="bg-white hover:bg-slate-200 text-slate-600 border border-slate-200 p-2 rounded-xl cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* PRINT CONTAINER SHEET PANEL */}
            <div ref={printableRef} className="p-8 md:p-12 space-y-8 bg-white font-sans text-slate-800 relative bg-[radial-gradient(#f1f5f9_1.2px,transparent_1.2px)] [background-size:16px_16px] print:p-0 print:border-0 print:shadow-none">
              
              {/* Quote Sheet Header */}
              <div className="flex flex-col sm:flex-row justify-between items-start gap-6 border-b border-slate-300/80 pb-6">
                
                <div className="space-y-2.5 max-w-sm text-left">
                  {planType === "premium" && companyLogo ? (
                    <div className="mb-2 shrink-0 max-w-[200px] max-h-14 overflow-hidden rounded-lg">
                      <img 
                        src={companyLogo} 
                        alt="Logomarca Emissor" 
                        referrerPolicy="no-referrer"
                        className="h-10 object-contain block border-0" 
                      />
                    </div>
                  ) : null}

                  <h2 className="text-xl font-bold text-slate-900 tracking-tight leading-none uppercase">
                    {meiName}
                  </h2>
                  
                  <div className="space-y-1 text-slate-500 font-medium text-xs">
                    {cnpjPrestador && <p className="font-mono text-[11px]">CNPJ Emissor: {cnpjPrestador}</p>}
                    {inscricaoMunicipal && <p className="font-mono text-[11px]">Inscrição Municipal: {inscricaoMunicipal}</p>}
                    {telefonePrestador && <p className="flex items-center gap-1.5"><Phone className="w-3 h-3 text-slate-400" /> {telefonePrestador}</p>}
                  </div>
                </div>

                <div className="sm:text-right space-y-2 shrink-0">
                  <div className="inline-block bg-slate-900 text-white font-bold text-[10px] tracking-widest uppercase px-3.5 py-1.5 rounded-md">
                    Orçamento Comercial
                  </div>
                  <p className="text-slate-400 font-mono text-[11px]">ID: {activePreviewQuote.id}</p>
                  <p className="text-slate-500 text-xs font-bold">Gerado em: {new Date(activePreviewQuote.createdAt).toLocaleDateString("pt-BR")}</p>
                </div>
              </div>

              {/* DADOS DO CLIENTE BANNER */}
              <div className="bg-slate-50 p-5 rounded-2xl border border-slate-200/50 space-y-2.5 text-left">
                <span className="text-[9px] font-extrabold text-slate-400 uppercase tracking-widest block">Identificação do Cliente Destinatário</span>
                <h4 className="text-sm font-bold text-slate-800 leading-none">{activePreviewQuote.clienteNome}</h4>
                
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-slate-500 text-xs font-semibold pt-1">
                  {activePreviewQuote.clienteDocumento && (
                    <div>
                      <span className="text-[10px] text-slate-400 block font-normal">CPF / CNPJ:</span>
                      <span className="font-mono text-slate-700 font-bold">{activePreviewQuote.clienteDocumento}</span>
                    </div>
                  )}
                  {activePreviewQuote.clienteEmail && (
                    <div>
                      <span className="text-[10px] text-slate-400 block font-normal">E-mail de Contato:</span>
                      <span className="text-slate-700 truncate block">{activePreviewQuote.clienteEmail}</span>
                    </div>
                  )}
                  {activePreviewQuote.clienteTelefone && (
                    <div>
                      <span className="text-[10px] text-slate-400 block font-normal">Telefone / Celular:</span>
                      <span className="text-slate-700">{activePreviewQuote.clienteTelefone}</span>
                    </div>
                  )}
                </div>
              </div>

              {/* DETALHAMENTO DO PREÇO UNITÁRIO */}
              <div className="space-y-3.5">
                <span className="text-[9px] font-extrabold text-slate-400 uppercase tracking-widest block text-left">Detalhamento dos Serviços e Produtos</span>
                
                <div className="border border-slate-200/80 rounded-2xl overflow-hidden shadow-2xs">
                  <table className="w-full text-left text-xs bg-white text-slate-600">
                    <thead className="bg-slate-50">
                      <tr>
                        <th className="py-3 px-4 font-extrabold text-slate-500 uppercase tracking-wider text-[10px]">Tipo</th>
                        <th className="py-3 px-4 font-extrabold text-slate-500 uppercase tracking-wider text-[10px]">Descrição Comercial</th>
                        <th className="py-3 px-4 font-extrabold text-slate-500 uppercase tracking-wider text-[10px] text-right">Preço de Venda</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 font-semibold text-slate-700">
                      <tr>
                        <td className="py-4.5 px-4">
                          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                            activePreviewQuote.itemTipo === "serviço" 
                              ? "bg-amber-50 text-amber-700 border border-amber-100" 
                              : "bg-emerald-50 text-emerald-700 border border-emerald-100"
                          }`}>
                            {activePreviewQuote.itemTipo}
                          </span>
                        </td>
                        <td className="py-4.5 px-4 font-bold text-slate-800 font-sans break-words max-w-[280px]">
                          {activePreviewQuote.itemNome}
                        </td>
                        <td className="py-4.5 px-4 font-mono font-bold text-right text-slate-950">
                          R$ {activePreviewQuote.itemValor.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>

              {/* TOTAL & VALIDADE HEADER */}
              <div className="flex flex-col sm:flex-row justify-between items-stretch gap-4 bg-slate-900 text-white rounded-3xl p-6 shadow-md text-left">
                <div className="space-y-1">
                  <span className="text-[10px] font-extrabold text-slate-400 uppercase tracking-widest block">Condições de Validade</span>
                  <p className="text-xs text-slate-200">
                    Esta proposta possui validade legal garantida até o dia:
                  </p>
                  <p className="text-sm font-bold text-blue-300 font-mono">
                    {new Date(activePreviewQuote.validade + "T12:00:00").toLocaleDateString("pt-BR")}
                  </p>
                </div>

                <div className="sm:text-right flex flex-col justify-center sm:items-end pt-3 sm:pt-0 border-t sm:border-t-0 border-slate-700">
                  <span className="text-[10px] font-extrabold text-slate-400 uppercase tracking-widest block">Valor Total do Orçamento</span>
                  <span className="text-3xl font-bold font-mono tracking-tight text-white leading-tight">
                    R$ {activePreviewQuote.itemValor.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
                  </span>
                </div>
              </div>

              {/* SIGNATURE PLACEHOLDERS */}
              <div className="grid grid-cols-2 gap-8 pt-10 border-t border-slate-200/80">
                <div className="text-center space-y-12">
                  <div className="border-t border-slate-300 w-full mx-auto max-w-[200px] pt-1.5 text-[10px] text-slate-400 font-bold uppercase tracking-wider">
                    Assinatura do Emissor
                  </div>
                </div>
                <div className="text-center space-y-12">
                  <div className="border-t border-slate-300 w-full mx-auto max-w-[200px] pt-1.5 text-[10px] text-slate-400 font-bold uppercase tracking-wider">
                    Aceite do Cliente
                  </div>
                </div>
              </div>

              {/* FOOTER: CONDITIONAL APP MARKING */}
              <div className="pt-6 border-t border-slate-100 flex items-center justify-center text-center">
                {planType === "premium" ? (
                  <p className="text-[10px] text-slate-400 font-medium">
                    Obrigado por nos escolher! Atenciosamente, {meiName}.
                  </p>
                ) : (
                  <div className="flex flex-col items-center gap-1">
                    <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest flex items-center gap-1">
                      <span>Gerado Eletronicamente via</span>
                      <span className="bg-blue-600 text-white font-extrabold px-1.5 py-0.5 rounded text-[8px] scale-95 uppercase tracking-wider">
                        MEI Flow
                      </span>
                    </p>
                    <p className="text-[9px] text-slate-400 font-medium">
                      Facilite seus recebimentos e faturamento • Ative a conta Premium
                    </p>
                  </div>
                )}
              </div>

            </div>

            {/* In-app bottom modal helper bar (hidden on print) */}
            <div className="px-6 py-4 bg-slate-50 border-t border-slate-200 flex justify-end gap-2.5 print:hidden">
              <button
                onClick={() => setActivePreviewQuote(null)}
                className="px-5 py-2.5 bg-white border border-slate-200 hover:bg-slate-100 text-slate-700 font-bold text-xs rounded-xl shadow-xs cursor-pointer"
              >
                Voltar
              </button>
            </div>

          </div>
        </div>
      )}

    </div>
  );
}
