import React, { useState, useEffect } from "react";
import { 
  Wallet, 
  ArrowUpRight, 
  ArrowDownLeft, 
  RefreshCw, 
  CheckCircle, 
  AlertCircle, 
  Key, 
  Send, 
  Loader2,
  Calendar,
  Layers,
  Sparkles,
  Smartphone,
  Eye,
  EyeOff,
  Building,
  ArrowRight,
  TrendingUp,
  Receipt,
  FileCheck
} from "lucide-react";
import { consultarSaldoAsaas, realizarTransferenciaPixAsaas, criarCobrancaAsaas, AsaasCobrancaPayload } from "../asaasService";
import { Plus, Copy, QrCode, ExternalLink, FileText } from "lucide-react";
import { Transacao } from "../types";

interface AsaasWalletModalProps {
  userId: string;
  transactions: Transacao[];
  currentAsaasToken: string;
  onSaveAsaasToken: (newToken: string) => Promise<void>;
  onAddTransaction: (newTx: Omit<Transacao, "id">) => Promise<void>;
  onClose: () => void;
  isInline?: boolean;
  planType?: "free" | "premium";
  onTriggerUpgrade?: () => void;
}

export default function AsaasWalletModal({
  userId,
  transactions,
  currentAsaasToken,
  onSaveAsaasToken,
  onAddTransaction,
  onClose,
  isInline = false,
  planType = "free",
  onTriggerUpgrade,
}: AsaasWalletModalProps) {
  // Configs do Token
  const [tokenInput, setTokenInput] = useState(currentAsaasToken);
  const [isEditingToken, setIsEditingToken] = useState(!currentAsaasToken);
  const [isSavingToken, setIsSavingToken] = useState(false);

  // Estados de Saldo (Asaas API GET)
  const [balance, setBalance] = useState<number | null>(null);
  const [isLoadingBalance, setIsLoadingBalance] = useState(false);
  const [balanceError, setBalanceError] = useState<string | null>(null);
  const [showBalance, setShowBalance] = useState(true);

  // Estados de Transferências Pix (Asaas API POST)
  const [withdrawValue, setWithdrawValue] = useState("");
  const [pixKey, setPixKey] = useState("");
  const [pixKeyType, setPixKeyType] = useState<"CPF" | "CNPJ" | "EMAIL" | "PHONE" | "EVP">("CPF");
  const [isSubmittingPix, setIsSubmittingPix] = useState(false);
  
  // Controle de comprovante estilo neobank
  const [comprovante, setComprovante] = useState<{
    success: boolean;
    txId: string;
    valor: number;
    chave: string;
    tipoChave: string;
    dataHora: string;
  } | null>(null);
  
  const [pixFeedback, setPixFeedback] = useState<{ success: boolean; message: string; submessage?: string } | null>(null);

  // Navegação Interna de Abas de Banco Digital
  // "home" (ver saldo, ações rápidas, extrato recente), "pix" (área pix), "cobrar" (emitir boleto/carnê), "token" (mudar chaves api)
  const [activeMenu, setActiveMenu] = useState<"home" | "pix" | "cobrar" | "token">("home");

  // Estados para Emissão de Cobrança (Boleto, Pix ou Carnê Parcelado)
  const [customerName, setCustomerName] = useState("");
  const [customerCpfCnpj, setCustomerCpfCnpj] = useState("");
  const [customerEmail, setCustomerEmail] = useState("");
  const [cValue, setCValue] = useState("");
  const [cDueDate, setCDueDate] = useState("");
  const [cDescription, setCDescription] = useState("");
  const [cIsInstallment, setCIsInstallment] = useState(false);
  const [cInstallmentCount, setCInstallmentCount] = useState(3);
  
  const [isSubmittingCobranca, setIsSubmittingCobranca] = useState(false);
  const [cobrancaFeedback, setCobrancaFeedback] = useState<{ success: boolean; message: string; submessage?: string } | null>(null);
  const [cobrancaResultado, setCobrancaResultado] = useState<any | null>(null);
  const [copiedPix, setCopiedPix] = useState(false);

  // Busca inicial do saldo
  useEffect(() => {
    if (currentAsaasToken) {
      handleFetchBalance(currentAsaasToken);
    }
  }, [currentAsaasToken]);

  const handleFetchBalance = async (token = currentAsaasToken) => {
    if (!token) return;
    setIsLoadingBalance(true);
    setBalanceError(null);
    const result = await consultarSaldoAsaas(token, false); // sandbox como padrão de segurança nacional
    if (result.success) {
      setBalance(result.balance);
    } else {
      setBalanceError(result.error || "Erro ao consultar saldo.");
      setBalance(null);
    }
    setIsLoadingBalance(false);
  };

  const handleSaveToken = async () => {
    if (!tokenInput.trim()) return;
    setIsSavingToken(true);
    await onSaveAsaasToken(tokenInput.trim());
    setIsSavingToken(false);
    setIsEditingToken(false);
    setActiveMenu("home");
    handleFetchBalance(tokenInput.trim());
  };

  const handleExecutePixTransfer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentAsaasToken) {
      alert("Por favor, configure o Token de Acesso do Asaas antes de transferir.");
      return;
    }

    const valor = parseFloat(withdrawValue.replace(",", "."));
    if (isNaN(valor) || valor <= 0) {
      setPixFeedback({
        success: false,
        message: "Valor Inválido",
        submessage: "Por favor, digite um valor numérico válido para a transferência."
      });
      return;
    }

    if (balance !== null && valor > balance) {
      setPixFeedback({
        success: false,
        message: "Saldo Insuficiente",
        submessage: `Você tentou transferir R$ ${valor.toFixed(2)}, mas seu saldo disponível no Asaas é de R$ ${balance.toFixed(2)}.`
      });
      return;
    }

    setIsSubmittingPix(true);
    setPixFeedback(null);

    // Conecta à API do Asaas para processamento fiscal e transacional do Pix
    const result = await realizarTransferenciaPixAsaas(currentAsaasToken, {
      value: valor,
      pixAddressKey: pixKey,
      pixAddressKeyType: pixKeyType
    }, false); // Padrão sandbox para segurança operacional da demonstração

    setIsSubmittingPix(false);

    if (result.success) {
      // Exibe o comprovante espetacular estilo neobank
      setComprovante({
        success: true,
        txId: result.transferId || `ASAAS-TX-${Math.random().toString(36).substr(2, 9).toUpperCase()}`,
        valor: valor,
        chave: pixKey,
        tipoChave: pixKeyType,
        dataHora: new Date().toLocaleString("pt-BR")
      });

      // Deduz o saldo localmente para feedback dinâmico imediato
      if (balance !== null) {
        setBalance(prev => (prev !== null ? prev - valor : null));
      }

      // Registra a despesa/saida no painel financeiro principal do MEI para fechar o caixa perfeitamente
      await onAddTransaction({
        tipo: "saida",
        valor: valor,
        data: new Date().toLocaleDateString("pt-BR"),
        descricao: `Saque Pix Carteira Asaas (Chave: ${pixKey})`,
        categoria: "Transferência Bancária"
      });

      // Reseta formulário
      setWithdrawValue("");
      setPixKey("");
    } else {
      setPixFeedback({
        success: false,
        message: "Falha na Transação",
        submessage: result.error || "A API do Asaas recusou a operação. Verifique os fundos ou as informações da chave Pix."
      });
    }
  };

  const handleCreateCobranca = async (e: React.FormEvent) => {
    e.preventDefault();
    setCobrancaFeedback(null);
    setCobrancaResultado(null);

    const valor = parseFloat(cValue.replace(",", "."));
    if (isNaN(valor) || valor <= 0) {
      setCobrancaFeedback({
        success: false,
        message: "Valor Inválido",
        submessage: "Por favor, forneça um valor numérico válido maior que zero."
      });
      return;
    }

    if (!customerName.trim() || !customerCpfCnpj.trim()) {
      setCobrancaFeedback({
        success: false,
        message: "Campos Requeridos",
        submessage: "Preencha o Nome do Cliente e o CPF/CNPJ para continuar."
      });
      return;
    }

    if (!cDueDate) {
      setCobrancaFeedback({
        success: false,
        message: "Data de Vencimento Ausente",
        submessage: "Por favor, insira a data do primeiro vencimento."
      });
      return;
    }

    setIsSubmittingCobranca(true);

    try {
      const payload: AsaasCobrancaPayload = {
        customerName: customerName.trim(),
        customerCpfCnpj: customerCpfCnpj.trim(),
        customerEmail: customerEmail.trim() || undefined,
        value: valor,
        dueDate: cDueDate,
        isInstallment: cIsInstallment,
        installmentCount: cIsInstallment ? Number(cInstallmentCount) : undefined,
        description: cDescription.trim() || undefined
      };

      const res = await criarCobrancaAsaas(payload, currentAsaasToken);

      if (res.success) {
        setCobrancaResultado(res);
        setCobrancaFeedback({
          success: true,
          message: cIsInstallment ? "Carnê Parcelado Gerado!" : "Boleto + Pix Gerado!",
          submessage: cIsInstallment 
            ? `Carnê de ${cInstallmentCount} parcelas de R$ ${valor.toLocaleString("pt-BR", { minimumFractionDigits: 2 })} emitido à carteira.`
            : `Um título de R$ ${valor.toLocaleString("pt-BR", { minimumFractionDigits: 2 })} foi criado com link de Boleto PJ ativo.`
        });

        // Agrega no log de receitas
        // Converte data de AAAA-MM-DD para DD/MM/AAAA
        const fDateParts = cDueDate.split("-");
        const formattedDate = fDateParts.length === 3 ? `${fDateParts[2]}/${fDateParts[1]}/${fDateParts[0]}` : new Date().toLocaleDateString("pt-BR");

        await onAddTransaction({
          tipo: "entrada",
          valor: valor * (cIsInstallment ? Number(cInstallmentCount) : 1),
          data: formattedDate,
          descricao: `[Asaas] ${cIsInstallment ? `Carnê ${cInstallmentCount}x` : "Boleto/Pix"} - ${customerName.trim()}`,
          categoria: "Prestação de Serviços",
          clienteNome: customerName.trim(),
          clienteDocumento: customerCpfCnpj.trim()
        });

        // Limpa parcialmente os campos para nova emissão
        setCustomerName("");
        setCustomerCpfCnpj("");
        setCustomerEmail("");
        setCValue("");
        setCDueDate("");
        setCDescription("");
        setCIsInstallment(false);
      } else {
        setCobrancaFeedback({
          success: false,
          message: "Erro na Emissão Asaas",
          submessage: res.mensagem || "Não foi possível emitir no gateway da Asaas. Verifique os dados tributários."
        });
      }
    } catch (err: any) {
      console.error("Erro interno ao tentar emitir:", err);
      setCobrancaFeedback({
        success: false,
        message: "Falha de Conectividade",
        submessage: err.message || "Erro inesperado de comunicação de rede PJ."
      });
    } finally {
      setIsSubmittingCobranca(false);
    }
  };

  // Filtra as entradas recebidas de boletos (representadas pelas transações do tipo 'entrada')
  const extratoEntradas = transactions.filter(tx => tx.tipo === "entrada");
  const extratoSaidas = transactions.filter(tx => tx.tipo === "saida" && tx.descricao.includes("Asaas"));

  // Consolida o histórico cronológico de boletos liquidados e saques correspondentes da carteira
  const extratoCompleto = [...extratoEntradas, ...extratoSaidas].sort((a, b) => {
    return new Date(b.data.split("/").reverse().join("-")).getTime() - new Date(a.data.split("/").reverse().join("-")).getTime();
  });

  const walletContent = (
    <div className={`bg-slate-900 rounded-3xl overflow-hidden shadow-2xl border border-slate-800 max-w-lg w-full ${isInline ? "min-h-[500px]" : "max-h-[92vh]"} flex flex-col text-slate-100`}>
      
      {/* TOP BAR / PHONE BAR NOTIFICATION */}
      <div className="bg-slate-950 px-6 py-2.5 flex items-center justify-between border-b border-slate-800 text-[11px] text-slate-500 font-mono">
          <div className="flex items-center gap-1.5 font-bold">
            <Smartphone className="w-3.5 h-3.5 text-blue-500" />
            <span>MEI BANK APP (ASAAS PLATFORM)</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
            <span>AMB. TESTES (SANDBOX)</span>
          </div>
        </div>

        {/* HEADER PRINCIPAL */}
        <div className="px-6 py-5 bg-gradient-to-b from-slate-950 to-slate-900 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-gradient-to-br from-blue-600 to-indigo-700 rounded-2xl shadow-inner shadow-blue-400/20 text-white">
              <Wallet className="w-5 h-5 text-white animate-pulse" />
            </div>
            <div className="text-left">
              <h3 className="font-extrabold text-sm sm:text-base tracking-tight text-white flex items-center gap-1.5">
                Conta Digital PJ <span className="text-xs bg-blue-500/10 border border-blue-500/20 text-blue-400 px-2 py-0.5 rounded-md font-bold uppercase tracking-wider">Asaas v3</span>
              </h3>
              <p className="text-[10px] text-slate-400">Agência 0001 • Conta 104278-9</p>
            </div>
          </div>
          <button 
            onClick={onClose}
            className="text-slate-400 hover:text-white p-2 rounded-xl hover:bg-slate-800 transition-all font-bold text-sm"
          >
            ✕
          </button>
        </div>

        {/* SECTOR FEEDBACK COMPROVANTE NEOSHOP */}
        {comprovante ? (
          <div className="flex-1 overflow-y-auto p-6 space-y-6 bg-slate-950">
            <div className="max-w-md mx-auto text-center space-y-6 p-6 bg-slate-900 border border-emerald-500/20 rounded-3xl relative overflow-hidden shadow-2xl">
              <div className="absolute top-0 left-0 w-32 h-32 bg-emerald-500/5 rounded-full blur-2xl pointer-events-none"></div>
              
              <div className="flex flex-col items-center">
                <div className="p-3.5 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 rounded-full mb-3 shadow-inner">
                  <FileCheck className="w-8 h-8" />
                </div>
                <span className="text-[10px] text-emerald-400 font-extrabold uppercase tracking-widest bg-emerald-500/10 px-3 py-1 rounded-full">
                  Comprovante de Transferência
                </span>
                <h4 className="text-2xl font-black font-mono mt-4 text-white">
                  R$ {comprovante.valor.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
                </h4>
                <p className="text-xs text-slate-400 mt-1">Enviado via Pix com absoluto sucesso</p>
              </div>

              <div className="border-t border-b border-slate-800 py-4 text-left space-y-3 font-mono text-xs text-slate-300">
                <div className="flex justify-between">
                  <span className="text-slate-500">Tipo de Envio:</span>
                  <span className="font-bold text-white">Pix S.P.B</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500 font-sans">Tipo da Chave:</span>
                  <span className="font-bold text-white uppercase">{comprovante.tipoChave}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Chave Pix:</span>
                  <span className="font-bold text-white max-w-[180px] break-all text-right">{comprovante.chave}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Favorecido:</span>
                  <span className="font-bold text-white">Sua Conta Titular</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500 font-sans">Data da Operação:</span>
                  <span className="font-bold text-white">{comprovante.dataHora}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">ID Autenticação:</span>
                  <span className="font-bold text-slate-400 text-[10px] select-all uppercase">{comprovante.txId}</span>
                </div>
              </div>

              <div className="space-y-2">
                <button
                  onClick={() => {
                    setComprovante(null);
                    setActiveMenu("home");
                    handleFetchBalance();
                  }}
                  className="w-full bg-slate-800 hover:bg-slate-700 border border-slate-700 text-white font-bold py-3 rounded-2xl text-xs transition-all"
                >
                  Fechar Comprovante
                </button>
              </div>
            </div>
          </div>
        ) : (
          <>
            {/* CONTAINER DO SALDO PRINCIPAL COM LAYOUT DIGITAL */}
            <div className="bg-slate-950 p-6 border-b border-slate-800/60 relative overflow-hidden">
              <div className="flex justify-between items-center relative z-10">
                <span className="text-[10px] text-slate-400 uppercase tracking-widest font-extrabold flex items-center gap-1.5">
                  Saldo Líquido p/ Resgate (Asaas)
                </span>
                
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => setShowBalance(!showBalance)}
                    className="p-1.5 bg-slate-900 border border-slate-800 hover:border-slate-700 rounded-xl text-slate-400 hover:text-white transition-all cursor-pointer"
                    title={showBalance ? "Esconder saldo" : "Mostrar saldo"}
                  >
                    {showBalance ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                  </button>
                  <button
                    onClick={() => handleFetchBalance()}
                    disabled={isLoadingBalance}
                    className="p-1.5 bg-slate-900 border border-slate-800 hover:border-slate-700 rounded-xl text-slate-400 hover:text-white transition-all disabled:opacity-50"
                    title="Atualizar saldo"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${isLoadingBalance ? "animate-spin" : ""}`} />
                  </button>
                </div>
              </div>

              {/* VALOR GIANT STYLE NO BANCO */}
              <div className="mt-3 relative z-10 flex items-baseline gap-1.5">
                <span className="text-slate-400 text-sm font-bold font-mono">R$</span>
                {isLoadingBalance ? (
                  <div className="flex items-center gap-2">
                    <Loader2 className="w-5 h-5 animate-spin text-blue-500" />
                    <span className="text-sm text-slate-500 font-mono">Buscando saldo...</span>
                  </div>
                ) : balance !== null ? (
                  showBalance ? (
                    <h2 className="text-3xl sm:text-4xl font-black text-white font-mono tracking-tight leading-none">
                      {balance.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
                    </h2>
                  ) : (
                    <h2 className="text-2xl sm:text-3xl font-black text-slate-500 font-mono tracking-wide leading-none">
                      ••••••
                    </h2>
                  )
                ) : (
                  <div className="text-xs font-semibold text-slate-500 flex items-center gap-1.5">
                    {balanceError ? (
                      <>
                        <AlertCircle className="w-4 h-4 text-rose-500 shrink-0" />
                        <span className="text-rose-400 font-mono break-all">{balanceError}</span>
                      </>
                    ) : (
                      <span className="text-amber-400">Ative sua chave de API Asaas</span>
                    )}
                  </div>
                )}
              </div>

              {/* NAVIGATOR BUTTONS DE ACÕES RÁPIDAS */}
              <div className="grid grid-cols-4 gap-1.5 mt-6 relative z-10">
                <button
                  onClick={() => setActiveMenu("home")}
                  className={`py-2 px-1 rounded-xl text-[10px] sm:text-xs font-bold transition-all flex flex-col items-center justify-center gap-1 ${
                    activeMenu === "home" 
                      ? "bg-blue-600/10 border border-blue-500/30 text-blue-400" 
                      : "bg-slate-900 border border-slate-800 text-slate-400 hover:text-slate-200"
                  }`}
                >
                  <Receipt className="w-3.5 h-3.5" />
                  <span>Extrato</span>
                </button>
                 <button
                  onClick={() => {
                    if (planType === "free") {
                      if (onTriggerUpgrade) onTriggerUpgrade();
                    } else if (!currentAsaasToken) {
                      setActiveMenu("token");
                    } else {
                      setActiveMenu("cobrar");
                    }
                  }}
                  className={`py-2 px-1 rounded-xl text-[10px] sm:text-xs font-bold transition-all flex flex-col items-center justify-center gap-1 ${
                    activeMenu === "cobrar" 
                      ? "bg-blue-600/10 border border-blue-500/30 text-blue-400" 
                      : "bg-slate-900 border border-slate-800 text-slate-400 hover:text-slate-200"
                  }`}
                >
                  <TrendingUp className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Cobrar {planType === "free" ? "🔒" : ""}</span>
                </button>
                <button
                  onClick={() => {
                    if (!currentAsaasToken) {
                      setActiveMenu("token");
                    } else {
                      setActiveMenu("pix");
                    }
                  }}
                  className={`py-2 px-1 rounded-xl text-[10px] sm:text-xs font-bold transition-all flex flex-col items-center justify-center gap-1 ${
                    activeMenu === "pix" 
                      ? "bg-blue-600/10 border border-blue-500/30 text-blue-400" 
                      : "bg-slate-900 border border-slate-800 text-slate-400 hover:text-slate-200"
                  }`}
                >
                  <Send className="w-3.5 h-3.5" />
                  <span>Área Pix</span>
                </button>
                <button
                  onClick={() => setActiveMenu("token")}
                  className={`py-2 px-1 rounded-xl text-[10px] sm:text-xs font-bold transition-all flex flex-col items-center justify-center gap-1 ${
                    activeMenu === "token" 
                      ? "bg-blue-600/10 border border-blue-500/30 text-blue-400" 
                      : "bg-slate-900 border border-slate-800 text-slate-400 hover:text-slate-200"
                  }`}
                >
                  <Key className="w-3.5 h-3.5" />
                  <span>Acesso</span>
                </button>
              </div>
            </div>

            {/* SECTIONS SCROLLABLE DYNAMIC CONTENT */}
            <div className="flex-1 overflow-y-auto p-5 space-y-5 text-left">
              
              {/* ABA 1: HOME & EXTRATO DE BANCO DIGITAL */}
              {activeMenu === "home" && (
                <div className="space-y-4">
                  {/* Informativo de isenção de tarifas do MEI */}
                  <div className="bg-slate-950/60 p-4 rounded-2xl border border-slate-800 flex gap-3 items-start">
                    <Sparkles className="w-4.5 h-4.5 text-blue-400 shrink-0 mt-0.5" />
                    <div className="space-y-1">
                      <span className="text-[10px] font-extrabold uppercase tracking-widest text-slate-300">Isenção Legal de Tarifas</span>
                      <p className="text-[11px] text-slate-400 leading-relaxed">
                        Sua empresa MEI tem direito a transferências Pix e Boleto sem taxas adicionais. O saldo provém de suas vendas emitidas pela plataforma.
                      </p>
                    </div>
                  </div>

                  {/* Lista de Transações */}
                  <div className="space-y-3">
                    <div className="flex justify-between items-center">
                      <h4 className="text-[10px] font-extrabold text-slate-400 uppercase tracking-widest">Extrato de Movimentação</h4>
                      <span className="text-[10px] text-slate-500 font-mono font-bold">Total de {extratoCompleto.length} lançamentos</span>
                    </div>

                    {extratoCompleto.length === 0 ? (
                      <div className="p-8 text-center bg-slate-950/40 border border-dashed border-slate-800 rounded-2xl flex flex-col items-center justify-center space-y-2">
                        <Wallet className="w-7 h-7 text-slate-600" />
                        <p className="text-[11px] font-bold text-slate-500">Nenhum lançamento no extrato.</p>
                        <p className="text-[10px] text-slate-600">Gere boletos para receber pagamentos de clientes.</p>
                      </div>
                    ) : (
                      <div className="divide-y divide-slate-850 border border-slate-800 rounded-2xl overflow-hidden bg-slate-950/20">
                        {extratoCompleto.map((tx) => {
                          const isCredit = tx.tipo === "entrada";
                          return (
                            <div key={tx.id} className="p-3.5 bg-slate-900/40 flex items-center justify-between hover:bg-slate-800/30 transition-all">
                              <div className="flex items-center gap-3 min-w-0">
                                <div className={`p-2.5 rounded-xl shrink-0 ${isCredit ? "bg-emerald-500/10 text-emerald-400" : "bg-rose-500/10 text-rose-400"}`}>
                                  {isCredit ? <ArrowDownLeft className="w-4 h-4" /> : <ArrowUpRight className="w-4 h-4" />}
                                </div>
                                <div className="min-w-0">
                                  <span className="text-xs font-bold text-slate-200 block truncate max-w-[200px] sm:max-w-[260px]">
                                    {tx.descricao}
                                  </span>
                                  <div className="flex items-center gap-2 mt-1 text-[10px] text-slate-500 font-mono">
                                    <span className="flex items-center gap-1">
                                      <Calendar className="w-3 h-3" /> {tx.data}
                                    </span>
                                    <span>•</span>
                                    <span className="uppercase text-[9px] font-bold tracking-wider text-slate-400">
                                      {tx.categoria || "Transação"}
                                    </span>
                                  </div>
                                </div>
                              </div>

                              <div className="text-right shrink-0 pl-2">
                                <span className={`text-xs font-black font-mono tracking-tight block ${isCredit ? "text-emerald-400" : "text-rose-400"}`}>
                                  {isCredit ? "+" : "-"} R$ {tx.valor.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
                                </span>
                                <span className={`text-[8px] font-bold tracking-wider uppercase block ${isCredit ? "text-emerald-500/80" : "text-rose-500/80"}`}>
                                  {isCredit ? "COMPENSADO" : "REAlizado"}
                                </span>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* ABA 2: ÁREA PIX (CONSTRUÇÃO DE TRANSAÇÃO MULTI-SELEÇÃO) */}
              {activeMenu === "pix" && (
                <form onSubmit={handleExecutePixTransfer} className="space-y-4 animate-fade-in">
                  
                  {pixFeedback && (
                    <div className={`p-4 rounded-2xl text-xs flex gap-3 ${
                      pixFeedback.success 
                        ? "bg-emerald-500/10 border border-emerald-500/20 text-emerald-300" 
                        : "bg-rose-500/10 border border-rose-500/20 text-rose-300"
                    }`}>
                      {pixFeedback.success ? (
                        <CheckCircle className="w-4.5 h-4.5 text-emerald-400 shrink-0 mt-0.5" />
                      ) : (
                        <AlertCircle className="w-4.5 h-4.5 text-rose-400 shrink-0 mt-0.5" />
                      )}
                      <div>
                        <span className="font-extrabold block text-sm tracking-tight">{pixFeedback.message}</span>
                        <span className="text-[11px] mt-0.5 leading-relaxed block font-mono">{pixFeedback.submessage}</span>
                      </div>
                    </div>
                  )}

                  <div className="space-y-3">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      {/* Valor Pix */}
                      <div>
                        <label className="block text-[10px] uppercase tracking-widest font-extrabold text-slate-400 mb-1.5">
                          Valor do Resgate (R$)
                        </label>
                        <div className="relative">
                          <span className="absolute left-3.5 top-2.5 text-xs font-bold text-slate-500 font-mono">
                            BRL
                          </span>
                          <input
                            type="text"
                            required
                            value={withdrawValue}
                            onChange={(e) => setWithdrawValue(e.target.value)}
                            placeholder="Ex: 50.00"
                            className="w-full bg-slate-950 border border-slate-800 text-white rounded-xl py-2 px-3 pl-11 text-xs focus:ring-1 focus:ring-blue-500 focus:outline-none focus:border-blue-500 font-mono font-bold"
                          />
                        </div>
                      </div>

                      {/* Tipo da Chave Pix */}
                      <div>
                        <label className="block text-[10px] uppercase tracking-widest font-extrabold text-slate-400 mb-1.5">
                          Tipo de Chave Pix
                        </label>
                        <select
                          value={pixKeyType}
                          onChange={(e) => setPixKeyType(e.target.value as any)}
                          className="w-full bg-slate-950 border border-slate-800 text-white rounded-xl py-2 px-3 text-xs focus:ring-1 focus:ring-blue-500 focus:outline-none focus:border-blue-500 font-sans font-bold"
                        >
                          <option value="CPF">CPF (Apenas números)</option>
                          <option value="CNPJ">CNPJ (Apenas números)</option>
                          <option value="EMAIL">E-mail</option>
                          <option value="PHONE">Telefone / Celular</option>
                          <option value="EVP">Chave Aleatória (EVP)</option>
                        </select>
                      </div>
                    </div>

                    {/* Chave Pix Destino */}
                    <div>
                      <label className="block text-[10px] uppercase tracking-widest font-extrabold text-slate-400 mb-1.5">
                        Chave Pix do Destinatário (Sua Conta Bancária Real)
                      </label>
                      <input
                        type="text"
                        required
                        value={pixKey}
                        onChange={(e) => setPixKey(e.target.value)}
                        placeholder={
                          pixKeyType === "CPF" ? "Apenas números do CPF" :
                          pixKeyType === "CNPJ" ? "Apenas números do CNPJ" :
                          pixKeyType === "EMAIL" ? "Ex: sua.chave@banco.com" :
                          pixKeyType === "PHONE" ? "N° de telefone com DDD" :
                          "A chave EVP aleatória com traços"
                        }
                        className="w-full bg-slate-950 border border-slate-800 text-slate-100 rounded-xl py-2.5 px-3 text-xs focus:ring-1 focus:ring-blue-500 focus:outline-none focus:border-blue-500 font-mono font-bold"
                      />
                    </div>
                  </div>

                  <div className="bg-slate-950/40 p-4 rounded-2xl border border-slate-850 text-[11px] text-slate-400 leading-relaxed">
                    <span className="font-extrabold text-slate-200 block mb-0.5 uppercase text-[9px] tracking-widest">Garantia Transacional</span>
                    O resgate Pix à sua conta corrente ocorre via processamento direto do Asaas e do Banco Central do Brasil em tempo real (24h/7d). O valor debitará instantaneamente do saldo.
                  </div>

                  <button
                    type="submit"
                    disabled={isSubmittingPix || !currentAsaasToken}
                    className="w-full bg-blue-600 hover:bg-blue-500 disabled:bg-slate-800 text-white font-black py-3 px-4 rounded-xl text-xs flex items-center justify-center gap-2 shadow-lg transition-all"
                  >
                    {isSubmittingPix ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin text-white" />
                        Validando Envio Real-Time...
                      </>
                    ) : (
                      <>
                        <Send className="w-3.5 h-3.5 text-white" />
                        Autorizar Transferência Pix
                      </>
                    )}
                  </button>
                </form>
              )}

              {/* ABA DE COBRANÇA (EMISSÃO DE BOLETO/PIX/CARNÊ) */}
              {activeMenu === "cobrar" && (
                <div className="space-y-4 animate-fade-in relative z-10 text-left">
                  
                  {/* CASO A COBRANÇA TENHA SIDO GERADA COM SUCESSO */}
                  {cobrancaResultado ? (
                    <div className="space-y-4 p-5 bg-slate-900 border border-emerald-500/20 rounded-2xl">
                      <div className="text-center space-y-2">
                        <div className="inline-flex p-3 bg-emerald-500/10 text-emerald-400 rounded-full border border-emerald-500/25">
                          <CheckCircle className="w-8 h-8" />
                        </div>
                        <h4 className="text-base font-black text-white">
                          {cobrancaFeedback?.message || "Cobrança Emitida!"}
                        </h4>
                        <p className="text-xs text-slate-400">
                          {cobrancaFeedback?.submessage}
                        </p>
                      </div>

                      {/* DETALHES DA COBRANÇA */}
                      <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 space-y-2.5 font-mono text-xs text-slate-300">
                        <div className="flex justify-between border-b border-slate-800 pb-1.5">
                          <span className="text-slate-500">ID da Cobrança:</span>
                          <span className="text-slate-200 select-all font-bold">{cobrancaResultado.id || "N/A"}</span>
                        </div>
                        <div className="flex justify-between border-b border-slate-800 pb-1.5">
                          <span className="text-slate-500">Sacado/Cliente:</span>
                          <span className="text-slate-200 font-sans font-semibold text-right">{customerName || "Cliente Cadastrado"}</span>
                        </div>
                        {cobrancaResultado.installmentId && (
                          <div className="flex justify-between border-b border-slate-800 pb-1.5">
                            <span className="text-slate-500">ID do Parcelamento:</span>
                            <span className="text-slate-400 text-[10px]">{cobrancaResultado.installmentId}</span>
                          </div>
                        )}
                        <div className="flex justify-between">
                          <span className="text-slate-500">Meio de Recebimento:</span>
                          <span className="text-emerald-400 font-sans font-bold">Boleto + Pix Integrado</span>
                        </div>
                      </div>

                      {/* PIX AREA (IF AVAILABLE) */}
                      {cobrancaResultado.pixQrCode && (
                        <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 text-center space-y-3.5">
                          <span className="text-[10px] font-extrabold uppercase tracking-widest text-blue-400 flex items-center justify-center gap-1.5 font-mono">
                            <QrCode className="w-3.5 h-3.5" /> Pagar Imediatamente via Pix
                          </span>
                          
                          {cobrancaResultado.pixQrCode.encodedImage && (
                            <img 
                              src={`data:image/png;base64,${cobrancaResultado.pixQrCode.encodedImage}`} 
                              alt="Pix QR Code" 
                              className="w-32 h-32 bg-white p-2 rounded-xl mx-auto shadow-lg"
                              referrerPolicy="no-referrer"
                            />
                          )}

                          {cobrancaResultado.pixQrCode.payload && (
                            <div className="space-y-2">
                              <p className="text-[10px] text-slate-500 truncate select-all bg-slate-900 px-3 py-1.5 rounded-lg border border-slate-800 font-mono max-w-full overflow-hidden text-ellipsis">
                                {cobrancaResultado.pixQrCode.payload}
                              </p>
                              <button
                                type="button"
                                onClick={() => {
                                  navigator.clipboard.writeText(cobrancaResultado.pixQrCode.payload);
                                  setCopiedPix(true);
                                  setTimeout(() => setCopiedPix(false), 2000);
                                }}
                                className="w-full bg-slate-900 hover:bg-slate-800 text-slate-300 font-bold py-2 px-3 rounded-lg text-[10px] transition-all flex items-center justify-center gap-1.5 border border-slate-800"
                              >
                                <Copy className="w-3 h-3 text-blue-400" />
                                {copiedPix ? "✓ Código Copiado!" : "Copiar Chave Copia e Cola"}
                              </button>
                            </div>
                          )}
                        </div>
                      )}

                      {/* ACTIONS: DOWNLOAD/VIEW AND RE-EMISSION */}
                      <div className="space-y-2 pt-2">
                        {cobrancaResultado.invoiceUrl && (
                          <a
                            href={cobrancaResultado.invoiceUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="w-full bg-blue-600 hover:bg-blue-500 text-white font-black py-3 px-4 rounded-xl text-xs flex items-center justify-center gap-2 shadow-lg transition-all text-center"
                          >
                            <ExternalLink className="w-3.5 h-3.5 text-white inline-block" />
                            Visualizar Recibo / Fatura Online
                          </a>
                        )}

                        {cobrancaResultado.bankSlipUrl && (
                          <a
                            href={cobrancaResultado.bankSlipUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="w-full bg-slate-800 hover:bg-slate-750 text-slate-200 font-bold py-2.5 px-4 rounded-xl text-xs flex items-center justify-center gap-2 transition-all border border-slate-700 text-center"
                          >
                            <FileText className="w-3.5 h-3.5 text-slate-400 inline-block" />
                            Baixar Boleto Bancário (PDF)
                          </a>
                        )}

                        <button
                          type="button"
                          onClick={() => {
                            setCobrancaResultado(null);
                            setCobrancaFeedback(null);
                          }}
                          className="w-full bg-slate-950 hover:bg-slate-900 text-slate-500 hover:text-slate-400 font-semibold py-2.5 px-4 rounded-xl text-[10px] transition-all"
                        >
                          Emitir Outro Lançamento / Carnê
                        </button>
                      </div>
                    </div>
                  ) : (
                    // FORMULÁRIO DE PREENCHIMENTO DA COBRANÇA
                    <form onSubmit={handleCreateCobranca} className="space-y-4">
                      
                      {/* FEEDBACKS SE EXISTIREM */}
                      {cobrancaFeedback && !cobrancaFeedback.success && (
                        <div className="p-3 bg-rose-500/10 border border-rose-500/20 text-rose-400 rounded-xl flex gap-2.5 items-start">
                          <AlertCircle className="w-4.5 h-4.5 text-rose-400 shrink-0 mt-0.5" />
                          <div className="text-left">
                            <span className="font-extrabold block text-xs tracking-tight">{cobrancaFeedback.message}</span>
                            <span className="text-[10px] mt-0.5 leading-relaxed block font-mono">{cobrancaFeedback.submessage}</span>
                          </div>
                        </div>
                      )}

                      <div className="bg-slate-950 p-4 rounded-2xl border border-slate-850 space-y-3.5">
                        <div className="flex gap-2.5 items-center border-b border-slate-900 pb-2.5 text-left">
                          <Plus className="w-4 h-4 text-blue-400 shrink-0" />
                          <span className="text-[10px] font-extrabold uppercase tracking-widest text-slate-200">Emitir Nova Cobrança PJ</span>
                        </div>

                        {/* Nome do Cliente */}
                        <div className="space-y-1.5 text-left">
                          <label className="block text-[10px] uppercase tracking-widest font-extrabold text-slate-400">
                            Nome Completo do Cliente *
                          </label>
                          <input
                            type="text"
                            required
                            value={customerName}
                            onChange={(e) => setCustomerName(e.target.value)}
                            placeholder="Ex: João da Silva"
                            className="w-full bg-slate-900 border border-slate-850 text-white rounded-xl py-2 px-3 text-xs focus:ring-1 focus:ring-blue-500 focus:outline-none focus:border-blue-500"
                          />
                        </div>

                        {/* CPF ou CNPJ e Email */}
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                          <div className="space-y-1.5 text-left">
                            <label className="block text-[10px] uppercase tracking-widest font-extrabold text-slate-400">
                              CPF ou CNPJ do Cliente *
                            </label>
                            <input
                              type="text"
                              required
                              value={customerCpfCnpj}
                              onChange={(e) => setCustomerCpfCnpj(e.target.value)}
                              placeholder="Apenas números"
                              className="w-full bg-slate-900 border border-slate-850 text-white rounded-xl py-2 px-3 text-xs focus:ring-1 focus:ring-blue-500 focus:outline-none focus:border-blue-500 font-mono"
                            />
                          </div>

                          <div className="space-y-1.5 text-left">
                            <label className="block text-[10px] uppercase tracking-widest font-extrabold text-slate-400">
                              E-mail do Cliente
                            </label>
                            <input
                              type="email"
                              value={customerEmail}
                              onChange={(e) => setCustomerEmail(e.target.value)}
                              placeholder="exemplo@vendas.com"
                              className="w-full bg-slate-900 border border-slate-850 text-white rounded-xl py-2 px-3 text-xs focus:ring-1 focus:ring-blue-500 focus:outline-none focus:border-blue-500"
                            />
                          </div>
                        </div>

                        {/* Valor e Data de Vencimento */}
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                          <div className="space-y-1.5 text-left">
                            <label className="block text-[10px] uppercase tracking-widest font-extrabold text-slate-400">
                               Valor da Cobrança (R$) *
                            </label>
                            <div className="relative">
                              <span className="absolute left-3 top-2 text-slate-500 text-xs font-bold leading-none">R$</span>
                              <input
                                type="text"
                                required
                                value={cValue}
                                onChange={(e) => setCValue(e.target.value)}
                                placeholder="150.00"
                                className="w-full bg-slate-900 border border-slate-850 text-white rounded-xl py-2 px-3 pl-8 text-xs focus:ring-1 focus:ring-blue-500 focus:outline-none focus:border-blue-500 font-mono font-bold"
                              />
                            </div>
                            <span className="text-[9px] text-slate-500 block leading-tight mt-0.5">
                              No caso de carnê, este é o valor de cada parcela individual.
                            </span>
                          </div>

                          <div className="space-y-1.5 text-left">
                            <label className="block text-[10px] uppercase tracking-widest font-extrabold text-slate-400">
                              Data do Vencimento *
                            </label>
                            <input
                              type="date"
                              required
                              value={cDueDate}
                              onChange={(e) => setCDueDate(e.target.value)}
                              className="w-full bg-slate-900 border border-slate-850 text-white rounded-xl py-2 px-3 text-xs focus:ring-1 focus:ring-blue-500 focus:outline-none focus:border-blue-500 font-mono"
                            />
                          </div>
                        </div>

                        {/* Descrição opcional */}
                        <div className="space-y-1.5 text-left">
                          <label className="block text-[10px] uppercase tracking-widest font-extrabold text-slate-400">
                            Descrição do Produto/Serviço
                          </label>
                          <input
                            type="text"
                            value={cDescription}
                            onChange={(e) => setCDescription(e.target.value)}
                            placeholder="Consultoria de Vendas MEI"
                            className="w-full bg-slate-900 border border-slate-850 text-slate-200 rounded-xl py-2 px-3 text-xs focus:ring-1 focus:ring-blue-500 focus:outline-none focus:border-blue-500"
                          />
                        </div>

                        {/* SELETOR DE MODALIDADE */}
                        <div className="pt-3 border-t border-slate-900 space-y-2 text-left">
                          <label className="block text-[10px] uppercase tracking-widest font-extrabold text-slate-400">
                             Tipo de Cobrança
                          </label>
                          <div className="grid grid-cols-2 gap-2">
                            <button
                              type="button"
                              onClick={() => setCIsInstallment(false)}
                              className={`py-2 rounded-xl text-xs font-bold transition-all ${
                                !cIsInstallment
                                  ? "bg-blue-600/10 border border-blue-500/30 text-blue-400"
                                  : "bg-slate-900 border border-slate-800 text-slate-500 hover:text-slate-300"
                              }`}
                            >
                              Boleto Único + Pix
                            </button>
                            <button
                              type="button"
                              onClick={() => setCIsInstallment(true)}
                              className={`py-2 rounded-xl text-xs font-bold transition-all ${
                                cIsInstallment
                                  ? "bg-blue-600/10 border border-blue-500/30 text-blue-400"
                                  : "bg-slate-900 border border-slate-800 text-slate-500 hover:text-slate-300"
                              }`}
                            >
                              Carnê (Parcelado)
                            </button>
                          </div>
                        </div>

                        {/* INPUT QUANTIDADE DE PARCELAS */}
                        {cIsInstallment && (
                          <div className="space-y-1.5 text-left animate-fade-in bg-slate-900 p-3 rounded-xl border border-slate-800">
                            <label className="block text-[10px] uppercase tracking-widest font-extrabold text-slate-400">
                              Quantidade de Parcelas
                            </label>
                            <select
                              value={cInstallmentCount}
                              onChange={(e) => setCInstallmentCount(Number(e.target.value))}
                              className="w-full bg-slate-950 border border-slate-800 text-white rounded-xl py-2 px-3 text-xs focus:ring-1 focus:ring-blue-500 focus:outline-none focus:border-blue-500 font-sans font-bold"
                            >
                              <option value="2">2 boletos sequenciais</option>
                              <option value="3">3 boletos sequenciais</option>
                              <option value="4">4 boletos sequenciais</option>
                              <option value="5">5 boletos sequenciais</option>
                              <option value="6">6 boletos sequenciais</option>
                              <option value="12">12 boletos sequenciais</option>
                            </select>
                            <p className="text-[9px] text-slate-400 leading-normal font-sans mt-1">
                              * O Asaas gerará as parcelas seguintes com intervalo mensal (vencimentos automáticos calculados sucessivamente).
                            </p>
                          </div>
                        )}

                      </div>

                      <button
                        type="submit"
                        disabled={isSubmittingCobranca || !currentAsaasToken}
                        className="w-full bg-blue-600 hover:bg-blue-500 disabled:bg-slate-800 text-neutral-100 font-black py-3 px-4 rounded-xl text-xs flex items-center justify-center gap-2 shadow-lg transition-all cursor-pointer"
                      >
                        {isSubmittingCobranca ? (
                          <>
                            <Loader2 className="w-4 h-4 animate-spin text-white" />
                            Contatando Gateway PJ...
                          </>
                        ) : (
                          <>
                            <TrendingUp className="w-3.5 h-3.5 text-white" />
                            {cIsInstallment ? "Emitir Carnê de Cobrança" : "Gerar Boleto Único + Pix"}
                          </>
                        )}
                      </button>
                      <p className="text-[10px] text-slate-400 font-sans text-center mt-2 mx-1 leading-relaxed">
                        💡 <strong>Regra Asaas:</strong> A taxa fixa de <strong>R$ 2,50</strong> é cobrada <strong>apenas quando o boleto for pago</strong> por seu cliente. Não há tarifa de emissão, baixa ou alteração de vencimento.
                      </p>
                    </form>
                  )}

                </div>
              )}

              {/* ABA 3: CONFIGURAÇÃO DE CREDENCIAIS (TOKEN) */}
              {activeMenu === "token" && (
                <div className="space-y-4 animate-fade-in">
                  <div className="bg-slate-950 p-4 rounded-2xl border border-slate-850 space-y-2">
                    <div className="flex gap-2.5 items-center">
                      <Key className="w-4 h-4 text-amber-500 shrink-0" />
                      <span className="text-[10px] font-extrabold uppercase tracking-widest text-slate-200">Credenciais API de Subconta</span>
                    </div>
                    <p className="text-[11px] text-slate-400 leading-relaxed">
                      Seu Token de API do Asaas (<span className="text-slate-300 font-mono">sk_asaas...</span>) integra as plataformas em tempo real e garante o controle de recebíveis direto na nuvem.
                    </p>
                  </div>

                  <div className="space-y-3">
                    <label className="block text-[10px] uppercase tracking-widest font-extrabold text-slate-400">
                      Token de Acesso do Asaas (Sandbox ou Produção)
                    </label>

                    {isEditingToken ? (
                      <div className="space-y-2.5">
                        <input
                          type="password"
                          value={tokenInput}
                          onChange={(e) => setTokenInput(e.target.value)}
                          placeholder="Cole seu token fornecido (sk_asaas_...)"
                          className="w-full bg-slate-950 border border-slate-800 text-white rounded-xl py-2.5 px-3.5 text-xs font-mono focus:outline-none focus:border-blue-500"
                        />
                        <div className="flex gap-2">
                          <button
                            onClick={handleSaveToken}
                            disabled={isSavingToken}
                            className="bg-blue-600 hover:bg-blue-500 text-white text-xs px-5 py-2 rounded-xl font-bold transition-all flex items-center gap-1.5"
                          >
                            {isSavingToken ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "Gravar Token"}
                          </button>
                          {currentAsaasToken && (
                            <button
                              onClick={() => {
                                setTokenInput(currentAsaasToken);
                                setIsEditingToken(false);
                              }}
                              className="bg-slate-800 hover:bg-slate-750 text-slate-400 hover:text-white text-xs px-4 py-2 rounded-xl"
                            >
                              Cancelar
                            </button>
                          )}
                        </div>
                      </div>
                    ) : (
                      <div className="p-4 bg-slate-950/60 border border-slate-850 rounded-2xl flex items-center justify-between">
                        <div className="space-y-0.5">
                          <span className="text-[9px] uppercase tracking-wider text-slate-500 font-bold">Chave Conectada</span>
                          <span className="text-xs font-mono text-slate-300 block">
                            {currentAsaasToken.substring(0, 10)}...{currentAsaasToken.substring(currentAsaasToken.length - 6)}
                          </span>
                        </div>
                        <button
                          onClick={() => {
                            setIsEditingToken(true);
                            setTokenInput(currentAsaasToken);
                          }}
                          className="bg-blue-600 hover:bg-blue-500 hover:shadow-xs px-3.5 py-1.5 rounded-xl text-neutral-100 font-sans font-black text-xs transition-all"
                        >
                          Alterar
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              )}

            </div>
          </>
        )}

        {/* FOOTER */}
        <div className="px-6 py-4 bg-slate-950 border-t border-slate-850 flex items-center justify-between text-[10px] text-slate-500 font-mono">
          <div className="flex items-center gap-1.5">
            <Building className="w-3.5 h-3.5 text-blue-500" />
            <span>Asaas I.P. S.A. 323</span>
          </div>
          <span>Bacen Regulated • 2026</span>
        </div>

      </div>
    );

    if (isInline) {
      return (
        <div className="w-full max-w-lg mx-auto py-2">
          {walletContent}
        </div>
      );
    }

    return (
      <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-950/80 backdrop-blur-md flex items-center justify-center p-2 sm:p-4 animate-fade-in">
        {walletContent}
      </div>
    );
}
