import React, { useState, useEffect } from "react";
import { X, CheckCircle, Sparkles, Receipt, FileText, ImageIcon, ShieldCheck, Loader2, CreditCard, Banknote, QrCode, ClipboardCheck, ClipboardCopy, AlertOctagon, HelpCircle } from "lucide-react";
import { auth, db } from "../firebase";
import { doc, getDoc } from "firebase/firestore";

interface UpgradeModalProps {
  isOpen: boolean;
  onClose: () => void;
  onUpgradeSuccess: () => Promise<void>;
  userId?: string;
}

export default function UpgradeModal({ isOpen, onClose, onUpgradeSuccess, userId: propUserId }: UpgradeModalProps) {
  const [step, setStep] = useState<"benefits" | "checkout" | "payment_status">("benefits");
  const [paymentMethod, setPaymentMethod] = useState<"PIX" | "BOLETO" | "CREDIT_CARD">("PIX");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSimulating, setIsSimulating] = useState<string | null>(null);

  // Form Fields
  const [nome, setNome] = useState("");
  const [cpfCnpj, setCpfCnpj] = useState("");
  const [email, setEmail] = useState("");

  // Card Fields
  const [cardNumber, setCardNumber] = useState("");
  const [cardHolder, setCardHolder] = useState("");
  const [cardExpiry, setCardExpiry] = useState("");
  const [cardCvv, setCardCvv] = useState("");

  // API response state
  const [subscriptionInfo, setSubscriptionInfo] = useState<{
    subscriptionId: string;
    invoiceUrl: string;
    bankSlipUrl: string;
    status: string;
    pixQrCode?: {
      encodedImage: string;
      payload: string;
    };
  } | null>(null);

  const [copied, setCopied] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  
  // Resolve active userId
  const activeUserId = propUserId || auth.currentUser?.uid || "user_49281";

  // Pre-fill user information from Auth/Firestore on load
  useEffect(() => {
    if (isOpen) {
      setNome(auth.currentUser?.displayName || "");
      setEmail(auth.currentUser?.email || "");
      
      // Attempt to load CPF from Firestore if exists
      const loadProfile = async () => {
        if (auth.currentUser?.uid) {
          try {
            const docRef = doc(db, "users", auth.currentUser.uid);
            const docSnap = await getDoc(docRef);
            if (docSnap.exists()) {
              const data = docSnap.data();
              if (data.cpfCnpj || data.cnpjPrestador) {
                setCpfCnpj(data.cpfCnpj || data.cnpjPrestador || "");
              }
              if (data.name || data.meiName) {
                setNome(data.name || data.meiName || auth.currentUser?.displayName || "");
              }
            }
          } catch (e) {
            console.warn("Could not preload user profile profile:", e);
          }
        }
      };
      loadProfile();
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleCopyPix = () => {
    if (subscriptionInfo?.pixQrCode?.payload) {
      navigator.clipboard.writeText(subscriptionInfo.pixQrCode.payload);
      setCopied(true);
      setTimeout(() => setCopied(false), 3000);
    }
  };

  const handleConfirmCheckout = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    setIsSubmitting(true);

    if (!nome.trim() || !cpfCnpj.trim() || !email.trim()) {
      setErrorMessage("Por favor, preencha todos os campos obrigatórios.");
      setIsSubmitting(false);
      return;
    }

    // Card validation
    if (paymentMethod === "CREDIT_CARD") {
      if (!cardNumber || !cardHolder || !cardExpiry || !cardCvv) {
        setErrorMessage("Por favor, preencha todos os campos do cartão.");
        setIsSubmitting(false);
        return;
      }
    }

    try {
      const [expiryMonth, expiryYear] = cardExpiry.split("/");
      
      const payload = {
        userId: activeUserId,
        name: nome,
        cpfCnpj: cpfCnpj.replace(/\D/g, ""),
        email: email,
        paymentMethod,
        creditCard: paymentMethod === "CREDIT_CARD" ? {
          holderName: cardHolder,
          number: cardNumber.replace(/\D/g, ""),
          expiryMonth: expiryMonth || "12",
          expiryYear: expiryYear ? `20${expiryYear}` : "2030",
          ccv: cardCvv
        } : undefined
      };

      const response = await fetch("/api/asaas/subscription", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      const data = await response.json();

      if (response.ok && data.success) {
        setSubscriptionInfo(data);
        if (paymentMethod === "CREDIT_CARD" && data.planType === "premium") {
          // Card succeeded immediately! Trigger parent upgrade succession
          await onUpgradeSuccess();
        }
        setStep("payment_status");
      } else {
        setErrorMessage(data.mensagem || "Não foi possível processar sua assinatura com o Asaas.");
      }
    } catch (err: any) {
      console.error(err);
      setErrorMessage("Falha de rede ou de comunicação com o servidor e Asaas.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSimulateWebhook = async (targetEvent: "PAYMENT_RECEIVED" | "SUB_OVERDUE") => {
    setIsSimulating(targetEvent);
    setErrorMessage(null);
    try {
      const res = await fetch("/api/simulate/webhook", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          event: targetEvent,
          userId: activeUserId
        })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        await onUpgradeSuccess();
        if (targetEvent === "PAYMENT_RECEIVED") {
          setIsSimulating("success_received");
        } else {
          setIsSimulating("success_overdue");
        }
        setTimeout(() => setIsSimulating(null), 3500);
      } else {
        setErrorMessage(data.mensagem || "Erro ao simular webhook.");
        setIsSimulating(null);
      }
    } catch (err: any) {
      console.error(err);
      setErrorMessage("Erro de conexao no simulador.");
      setIsSimulating(null);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/75 backdrop-blur-md flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-white rounded-3xl max-w-xl w-full shadow-2xl border border-slate-200 overflow-hidden text-left flex flex-col my-8 animate-fade-in">
        
        {/* Banner Superior Premium */}
        <div className="relative bg-gradient-to-br from-slate-900 via-indigo-950 to-slate-900 text-white p-7 overflow-hidden">
          <div className="absolute top-0 right-0 w-32 h-32 bg-blue-500/10 rounded-full blur-2xl"></div>
          <div className="absolute -bottom-8 -left-8 w-24 h-24 bg-indigo-500/15 rounded-full blur-xl"></div>
          
          <button
            onClick={onClose}
            className="absolute top-4 right-4 text-slate-400 hover:text-white p-1.5 rounded-lg hover:bg-white/10 transition-all cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>

          <div className="space-y-2">
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-blue-500/20 text-blue-300 border border-blue-500/30 text-[10px] font-bold uppercase tracking-widest">
              <Sparkles className="w-3 h-3 text-yellow-300 shrink-0 animate-pulse" /> Plano Premium
            </span>
            <h3 className="text-2xl font-extrabold tracking-tight">Assinatura MEI Flow</h3>
            <p className="text-xs text-slate-300 max-w-sm">
              Gestão financeira estruturada e automatizada para alavancar seu negócio.
            </p>
          </div>
        </div>

        {/* STEP 1: BENEFITS */}
        {step === "benefits" && (
          <div className="p-6 md:p-8 space-y-6">
            <h4 className="text-[10px] font-extrabold text-slate-400 uppercase tracking-widest">Recursos e ferramentas liberados</h4>

            <div className="space-y-4">
              <div className="flex gap-3 text-left">
                <div className="w-9 h-9 bg-emerald-50 text-emerald-600 rounded-xl flex items-center justify-center shrink-0 border border-emerald-100/50">
                  <Receipt className="w-4.5 h-4.5" />
                </div>
                <div className="space-y-0.5 min-w-0">
                  <span className="text-xs font-bold text-slate-800 block">Emissão de Boletos e Carnês (Asaas)</span>
                  <p className="text-[11px] text-slate-500 leading-normal">
                    Gere cobranças híbridas em segundos. O cliente paga como preferir: boleto bancário tradicional ou Pix. Tarifa de apenas R$ 2,50 por boleto liquidado.
                  </p>
                </div>
              </div>

              <div className="flex gap-3 text-left">
                <div className="w-9 h-9 bg-blue-50 text-blue-600 rounded-xl flex items-center justify-center shrink-0 border border-blue-100/50">
                  <FileText className="w-4.5 h-4.5" />
                </div>
                <div className="space-y-0.5 min-w-0">
                  <span className="text-xs font-bold text-slate-800 block">Emissão de NFS-e (Notas Fiscais)</span>
                  <p className="text-[11px] text-slate-500 leading-normal">
                    Emita notas fiscais de serviço diretamente pelo app através da nossa integração homologada Focus NFe. Sem burocracia e totalmente legalizado.
                  </p>
                </div>
              </div>

              <div className="flex gap-3 text-left">
                <div className="w-9 h-9 bg-indigo-50 text-indigo-600 rounded-xl flex items-center justify-center shrink-0 border border-indigo-100/50">
                  <ImageIcon className="w-4.5 h-4.5" />
                </div>
                <div className="space-y-0.5 min-w-0">
                  <span className="text-xs font-bold text-slate-800 block">Identidade Visual (Logo própria)</span>
                  <p className="text-[11px] text-slate-500 leading-normal">
                    Faça o upload do logo do seu MEI para personalizar recibos de venda em PDF, aumentando a credibilidade das suas cobranças frente aos clientes.
                  </p>
                </div>
              </div>
            </div>

            <div className="p-4 bg-indigo-50/50 rounded-2xl border border-indigo-100/50 flex items-center gap-3">
              <div className="text-left leading-normal font-sans text-xs text-indigo-900">
                <span className="font-extrabold text-indigo-950 block text-sm">Apenas R$ 29,90 / mês</span>
                Cobrança recorrente mensal sem fidelidade ou taxas de cancelamento. Ative agora!
              </div>
            </div>

            <div className="space-y-2.5">
              <button
                onClick={() => setStep("checkout")}
                className="w-full bg-indigo-950 hover:bg-slate-900 text-white font-extrabold py-3.5 px-4 rounded-xl text-xs flex items-center justify-center gap-2 shadow-lg transition-all cursor-pointer active:scale-95"
              >
                <span>Prosseguir para o Pagamento</span>
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
              </button>
              
              <button
                onClick={onClose}
                className="w-full py-2.5 text-center text-slate-500 hover:text-slate-700 bg-slate-50 rounded-xl font-bold text-xs transition-all cursor-pointer block"
              >
                Permanecer no Plano Gratuito (Limitado)
              </button>
            </div>
          </div>
        )}

        {/* STEP 2: CHECKOUT FORM */}
        {step === "checkout" && (
          <form onSubmit={handleConfirmCheckout} className="p-6 md:p-8 space-y-6">
            <h4 className="text-[10px] font-extrabold text-slate-400 uppercase tracking-widest border-b border-slate-100 pb-2">Preencha seus dados de assinatura</h4>
            
            {errorMessage && (
              <div className="p-3.5 bg-red-50 border border-red-200 rounded-xl text-red-700 text-xs flex items-start gap-2.5">
                <AlertOctagon className="w-4 h-4 shrink-0 mt-0.5" />
                <p className="leading-normal">{errorMessage}</p>
              </div>
            )}

            {/* User Identity Info */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="md:col-span-2 space-y-1">
                <label className="text-[10px] font-extrabold text-slate-600 uppercase tracking-wider block">Nome Completo (ou Razão Social) *</label>
                <input
                  type="text"
                  required
                  placeholder="Ex: João Silva S/A"
                  value={nome}
                  onChange={(e) => setNome(e.target.value)}
                  className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 text-xs focus:ring-1 focus:ring-indigo-500 focus:bg-white outline-hidden"
                />
              </div>

              <div className="space-y-1">
                <label className="text-[10px] font-extrabold text-slate-600 uppercase tracking-wider block">CPF ou CNPJ *</label>
                <input
                  type="text"
                  required
                  placeholder="Ex: 000.000.000-00"
                  value={cpfCnpj}
                  onChange={(e) => setCpfCnpj(e.target.value)}
                  className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 text-xs focus:ring-1 focus:ring-indigo-500 focus:bg-white outline-hidden"
                />
              </div>

              <div className="space-y-1">
                <label className="text-[10px] font-extrabold text-slate-600 uppercase tracking-wider block">E-mail para Recibo *</label>
                <input
                  type="email"
                  required
                  placeholder="Ex: meugmail@email.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 text-xs focus:ring-1 focus:ring-indigo-500 focus:bg-white outline-hidden"
                />
              </div>
            </div>

            {/* Payment Metod tabs */}
            <div className="space-y-2">
              <label className="text-[10px] font-extrabold text-slate-600 uppercase tracking-wider block">Forma de pagamento da Assinatura</label>
              <div className="grid grid-cols-3 gap-2">
                <button
                  type="button"
                  onClick={() => setPaymentMethod("PIX")}
                  className={`py-3 px-3 rounded-xl border flex flex-col items-center justify-center gap-1.5 cursor-pointer hover:bg-slate-50 transition-all ${
                    paymentMethod === "PIX" 
                      ? "border-indigo-600 bg-indigo-50/20 text-indigo-950 font-bold" 
                      : "border-slate-200 bg-white text-slate-600"
                  }`}
                >
                  <QrCode className="w-5 h-5 shrink-0" />
                  <span className="text-[10px] uppercase tracking-wider">Pix</span>
                </button>

                <button
                  type="button"
                  onClick={() => setPaymentMethod("BOLETO")}
                  className={`py-3 px-3 rounded-xl border flex flex-col items-center justify-center gap-1.5 cursor-pointer hover:bg-slate-50 transition-all ${
                    paymentMethod === "BOLETO" 
                      ? "border-indigo-600 bg-indigo-50/20 text-indigo-950 font-bold" 
                      : "border-slate-200 bg-white text-slate-600"
                  }`}
                >
                  <Banknote className="w-5 h-5 shrink-0" />
                  <span className="text-[10px] uppercase tracking-wider">Boleto</span>
                </button>

                <button
                  type="button"
                  onClick={() => setPaymentMethod("CREDIT_CARD")}
                  className={`py-3 px-3 rounded-xl border flex flex-col items-center justify-center gap-1.5 cursor-pointer hover:bg-slate-50 transition-all ${
                    paymentMethod === "CREDIT_CARD" 
                      ? "border-indigo-600 bg-indigo-50/20 text-indigo-950 font-bold" 
                      : "border-slate-200 bg-white text-slate-600"
                  }`}
                >
                  <CreditCard className="w-5 h-5 shrink-0" />
                  <span className="text-[10px] uppercase tracking-wider">Cartão s</span>
                </button>
              </div>
            </div>

            {/* Credit Card Details Form */}
            {paymentMethod === "CREDIT_CARD" && (
              <div className="p-4 bg-slate-50 rounded-2xl border border-slate-200/60 space-y-3 animate-fade-in text-left">
                <h5 className="text-[10px] font-extrabold text-slate-600 uppercase tracking-widest flex items-center gap-1.5">
                  <CreditCard className="w-3.5 h-3.5 text-indigo-600" /> Detalhes do Cartão de Crédito
                </h5>

                <div className="space-y-2">
                  <div className="space-y-1">
                    <label className="text-[9px] font-bold text-slate-500 uppercase">Número do Cartão *</label>
                    <input
                      type="text"
                      placeholder="4444 5555 6666 7777"
                      value={cardNumber}
                      onChange={(e) => setCardNumber(e.target.value)}
                      className="w-full bg-white px-3 py-2 border border-slate-200 rounded-xl text-slate-800 text-xs focus:outline-hidden focus:ring-1 focus:ring-indigo-500"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-[9px] font-bold text-slate-500 uppercase">Nome Impresso no Cartão *</label>
                    <input
                      type="text"
                      placeholder="JOAO H SILVA"
                      value={cardHolder}
                      onChange={(e) => setCardHolder(e.target.value.toUpperCase())}
                      className="w-full bg-white px-3 py-2 border border-slate-200 rounded-xl text-slate-800 text-xs focus:outline-hidden focus:ring-1 focus:ring-indigo-500"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1">
                      <label className="text-[9px] font-bold text-slate-500 uppercase">Validade (MM/AA) *</label>
                      <input
                        type="text"
                        placeholder="12/30"
                        value={cardExpiry}
                        onChange={(e) => setCardExpiry(e.target.value)}
                        className="w-full bg-white px-3 py-2 border border-slate-200 rounded-xl text-slate-800 text-xs focus:outline-hidden focus:ring-1 focus:ring-indigo-500"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[9px] font-bold text-slate-500 uppercase">CVV *</label>
                      <input
                        type="text"
                        placeholder="123"
                        value={cardCvv}
                        onChange={(e) => setCardCvv(e.target.value)}
                        className="w-full bg-white px-3 py-2 border border-slate-200 rounded-xl text-slate-800 text-xs focus:outline-hidden focus:ring-1 focus:ring-indigo-500"
                      />
                    </div>
                  </div>
                </div>
              </div>
            )}

            <div className="space-y-2.5 pt-2">
              <button
                type="submit"
                disabled={isSubmitting}
                className="w-full bg-indigo-950 hover:bg-slate-900 disabled:bg-slate-300 text-white font-extrabold py-3.5 px-4 rounded-xl text-xs flex items-center justify-center gap-2 shadow-lg transition-all cursor-pointer active:scale-95"
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin text-white" />
                    Gerando Assinatura no Asaas...
                  </>
                ) : (
                  <>
                    <span>Confirmar R$ 29,90/mês</span>
                    <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0" />
                  </>
                )}
              </button>

              <button
                type="button"
                onClick={() => setStep("benefits")}
                className="w-full py-2 text-center text-slate-500 hover:text-slate-700 bg-slate-50 rounded-xl font-bold text-xs transition-all cursor-pointer block"
              >
                Voltar à tela de benefícios
              </button>
            </div>
          </form>
        )}

        {/* STEP 3: PAYMENT STATUS & WEBHOOK SIMULATION */}
        {step === "payment_status" && (
          <div className="p-6 md:p-8 space-y-6">
            <div className="text-center space-y-2.5 max-w-sm mx-auto">
              <div className="w-12 h-12 bg-emerald-50 rounded-2xl flex items-center justify-center text-emerald-600 border border-emerald-100/50 mx-auto">
                <CheckCircle className="w-6 h-6 shrink-0" />
              </div>
              <h4 className="text-lg font-extrabold text-slate-800 tracking-tight">Assinatura Criada com Sucesso!</h4>
              {paymentMethod === "CREDIT_CARD" ? (
                <p className="text-xs text-slate-500 leading-normal">
                  Seu pagamento via Cartão de Crédito foi processado pelo Asaas e o plano **Premium** já está liberado na sua conta!
                </p>
              ) : (
                <p className="text-xs text-slate-500 leading-normal">
                  Sua cobrança recorrente foi gerada na API do Asaas. Realize o pagamento de ativação da primeira fatura para liberar o Premium automaticamente.
                </p>
              )}
            </div>

            {/* Payment Elements (Pix/Boleto details) */}
            {paymentMethod !== "CREDIT_CARD" && subscriptionInfo && (
              <div className="p-5 bg-slate-50 rounded-2xl border border-slate-200/60 space-y-4">
                
                {paymentMethod === "PIX" && subscriptionInfo.pixQrCode && (
                  <div className="flex flex-col items-center space-y-3">
                    <span className="text-[10px] font-extrabold text-slate-600 uppercase tracking-wider block">Código QR Pix</span>
                    <div className="p-3 bg-white border border-slate-200 rounded-2xl shrink-0 shadow-xs">
                      <img
                        src={`data:image/png;base64,${subscriptionInfo.pixQrCode.encodedImage}`}
                        alt="QR Code Pix Asaas"
                        className="w-36 h-36 border-0 block"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={handleCopyPix}
                      className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-white hover:bg-slate-50 border border-slate-200 text-slate-700 font-bold text-xs rounded-xl shadow-xs transition-all cursor-pointer"
                    >
                      {copied ? (
                        <>
                          <ClipboardCheck className="w-4 h-4 text-emerald-600 shrink-0" />
                          <span>Código Copiado!</span>
                        </>
                      ) : (
                        <>
                          <ClipboardCopy className="w-4 h-4 text-slate-400 shrink-0" />
                          <span>Copiar Chave Pix</span>
                        </>
                      )}
                    </button>
                  </div>
                )}

                <div className="space-y-2.5 pt-2 border-t border-slate-200/40">
                  <h5 className="text-[9px] font-extrabold text-slate-400 uppercase tracking-widest text-center">Ações de Cobrança</h5>
                  <div className="grid grid-cols-2 gap-2">
                    <a
                      href={subscriptionInfo.invoiceUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="py-2.5 px-3 bg-white hover:bg-slate-50 border border-slate-200 text-slate-700 text-center font-bold text-xs rounded-xl shadow-xs block"
                    >
                      Fatura no Asaas ➔
                    </a>
                    
                    <a
                      href={subscriptionInfo.bankSlipUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="py-2.5 px-3 bg-indigo-950 hover:bg-slate-900 text-white text-center font-bold text-xs rounded-xl shadow-xs block"
                    >
                      Ver Boleto PDF 📄
                    </a>
                  </div>
                </div>
              </div>
            )}

            {/* WEBHOOK SIMULATOR - EXTREMELY HELPFUL IN SANDBOX PREVIEW */}
            <div className="p-4 bg-amber-50/50 border border-amber-200 rounded-2xl space-y-3.5 text-left font-sans">
              <div className="flex items-start gap-2.5">
                <ShieldCheck className="w-5 h-5 text-amber-600 shrink-0 mt-0.5 animate-pulse" />
                <div className="space-y-0.5">
                  <span className="text-xs font-bold text-amber-900 block">Console do Simulador Webhook de Testes</span>
                  <p className="text-[11px] text-amber-700 leading-normal">
                    Como estamos no ambiente de Preview, os servidores do Asaas podem não conseguir atingir sua rota de Webhook pública local. Use os botões abaixo para simular as notificações que o Asaas enviará e validar instantaneamente a ativação e bloqueios de tela!
                  </p>
                </div>
              </div>

              {errorMessage && (
                <p className="text-[10px] text-red-600 font-semibold">{errorMessage}</p>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1 border-t border-amber-200/40">
                <button
                  type="button"
                  disabled={isSimulating !== null}
                  onClick={() => handleSimulateWebhook("PAYMENT_RECEIVED")}
                  className="w-full py-2 px-3 bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-300 text-white font-extrabold text-[10px] uppercase tracking-wider rounded-xl shadow-xs transition-all flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  {isSimulating === "PAYMENT_RECEIVED" && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  {isSimulating === "success_received" ? "✓ Pago Sincronizado!" : "💳 Simular Pagamento Organico (Premium)"}
                </button>

                <button
                  type="button"
                  disabled={isSimulating !== null}
                  onClick={() => handleSimulateWebhook("SUB_OVERDUE")}
                  className="w-full py-2 px-3 bg-rose-600 hover:bg-rose-700 disabled:bg-slate-300 text-white font-extrabold text-[10px] uppercase tracking-wider rounded-xl shadow-xs transition-all flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  {isSimulating === "SUB_OVERDUE" && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  {isSimulating === "success_overdue" ? "✓ Bloqueio Concluido!" : "🚫 Simular Atraso Fatura (Bloqueia)"}
                </button>
              </div>
            </div>

            <button
              onClick={onClose}
              className="w-full py-3 bg-slate-100 hover:bg-slate-200 text-slate-800 font-extrabold text-xs rounded-xl shadow-xs transition-all cursor-pointer text-center block uppercase tracking-wider"
            >
              Fechar Checkout e Ver App ➔
            </button>
          </div>
        )}

      </div>
    </div>
  );
}
