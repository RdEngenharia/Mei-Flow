import React, { useState, useEffect, useRef } from "react";
import { 
  X, 
  CheckCircle, 
  Sparkles, 
  FileText, 
  ImageIcon, 
  ShieldCheck, 
  Loader2, 
  ArrowRight, 
  CreditCard, 
  ArrowLeft, 
  Clipboard, 
  QrCode, 
  Lock 
} from "lucide-react";
import { auth } from "../firebase";

interface UpgradeModalProps {
  isOpen: boolean;
  onClose: () => void;
  onUpgradeSuccess: () => Promise<void>;
  userId?: string;
  meiName?: string;
  cnpjPrestador?: string;
  email?: string;
  planType?: string;
}

type CheckoutStep = "details" | "payment_method" | "pix" | "card";

export default function UpgradeModal({ 
  isOpen, 
  onClose, 
  onUpgradeSuccess, 
  userId: propUserId,
  meiName,
  cnpjPrestador,
  email,
  planType
}: UpgradeModalProps) {
  // Track component mount status to block setState calls in unmounted callbacks
  const isMounted = useRef(true);

  useEffect(() => {
    isMounted.current = true;
    return () => {
      isMounted.current = false;
    };
  }, []);

  const [checkoutStep, setCheckoutStep] = useState<CheckoutStep>("details");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isCopied, setIsCopied] = useState(false);
  
  // Real Asaas billing state
  const [pixQrCodeBase64, setPixQrCodeBase64] = useState<string | null>(null);
  const [pixPayload, setPixPayload] = useState<string | null>(null);
  const [showQrCode, setShowQrCode] = useState(false);

  // Guard values: If showQrCode is true, we force checkoutStep to stay as "pix" permanently
  useEffect(() => {
    if (showQrCode && checkoutStep !== "pix") {
      setCheckoutStep("pix");
    }
  }, [showQrCode, checkoutStep]);
  
  // Credit Card Form States
  const [cardNumber, setCardNumber] = useState("");
  const [cardName, setCardName] = useState("");
  const [cardExpiry, setCardExpiry] = useState("");
  const [cardCvv, setCardCvv] = useState("");

  const [documentNumber, setDocumentNumber] = useState(cnpjPrestador ? cnpjPrestador.replace(/\D/g, "") : "");

  useEffect(() => {
    if (cnpjPrestador) {
      setDocumentNumber(cnpjPrestador.replace(/\D/g, ""));
    }
  }, [cnpjPrestador]);

  const activeUserId = propUserId || auth.currentUser?.uid || "user_49281";

  const getApiUrl = (path: string): string => {
    // Dynamic absolute resolution for production build / client env compatibility
    if (typeof window !== "undefined" && window.location) {
      return `${window.location.origin}${path}`;
    }
    return `https://mei-flow-flax.vercel.app${path}`;
  };

  // Watch for premium activation in real-time from parent profile listener
  useEffect(() => {
    if (planType === "premium") {
      setSuccess(true);
    }
  }, [planType]);

  if (!isOpen) return null;

  // Real-time Credit Card formatting
  const handleCardNumberChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    let value = e.target.value.replace(/\D/g, "");
    if (value.length > 16) value = value.slice(0, 16);
    const formatted = value.replace(/(\d{4})(?=\d)/g, "$1 ");
    setCardNumber(formatted);
  };

  const handleExpiryChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    let value = e.target.value.replace(/\D/g, "");
    if (value.length > 4) value = value.slice(0, 4);
    if (value.length > 2) {
      value = value.slice(0, 2) + "/" + value.slice(2);
    }
    setCardExpiry(value);
  };

  const handleCvvChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value.replace(/\D/g, "").slice(0, 4);
    setCardCvv(value);
  };

  const handleCopyPix = () => {
    if (pixPayload) {
      navigator.clipboard.writeText(pixPayload);
      setIsCopied(true);
      setTimeout(() => {
        if (isMounted.current && !success) {
          setIsCopied(false);
        }
      }, 2500);
    }
  };

  const handleCancelPix = () => {
    setShowQrCode(false);
    setPixQrCodeBase64(null);
    setPixPayload(null);
    setCheckoutStep("payment_method");
  };

  // 1. Fetch real Pix invoice from Mercado Pago checkout endpoint
  const handleGeneratePix = async () => {
    setIsSubmitting(true);
    setErrorMessage(null);
    try {
      const response = await fetch(getApiUrl("/api/checkout"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: activeUserId,
          name: meiName || "Microempreendedor MEI",
          documentNumber: documentNumber.replace(/\D/g, ""),
          email: email || "contato@meiflow.com",
          paymentMethod: "PIX"
        })
      });
      
      const data = await response.json();
      if (!isMounted.current || success) return;

      if (response.ok && (data.success || data.id || data.status === "pending")) {
        // Clear any previous error messages explicitly
        setErrorMessage(null);

        // Attempt to extract the QR Code Image Base64 from multiple possible formats
        const qrCodeBase64 = data.qrCodeBase64 || 
                             data.pixQrCode?.encodedImage || 
                             data.point_of_interaction?.transaction_data?.qr_code_base64 || 
                             data.transaction_data?.qr_code_base64 || 
                             data.qr_code_base64 ||
                             null;

        // Attempt to extract the Pix Copia e Cola Payload from multiple structures
        const qrCodePayload = data.qrCode || 
                              data.pixQrCode?.payload || 
                              data.point_of_interaction?.transaction_data?.qr_code || 
                              data.qr_code || 
                              data.payload ||
                              null;

        if (qrCodeBase64 || qrCodePayload) {
          setPixQrCodeBase64(qrCodeBase64);
          setPixPayload(qrCodePayload);
          setShowQrCode(true);
          setCheckoutStep("pix");
        } else {
          setErrorMessage("Credenciais ativas, porém o Mercado Pago não retornou os dados de pagamento Pix. Verifique as configurações de Pix no seu painel do Mercado Pago.");
        }
      } else {
        setErrorMessage(data.mensagem || "Falha ao gerar cobrança Pix. Verifique as credenciais no servidor.");
      }
    } catch (err: any) {
      console.error(err);
      if (isMounted.current && !success) {
        setErrorMessage("Erro técnico de rede ao tentar gerar o Pix com o Mercado Pago.");
      }
    } finally {
      if (isMounted.current && !success) {
        setIsSubmitting(false);
      }
    }
  };

  // Escuta em tempo real (Polling) para verificar a aprovação do Pix de forma resiliente e infinita
  useEffect(() => {
    if (!showQrCode || !pixQrCodeBase64 || success) return;

    console.log(`[Pix Polling]: Iniciando loop de checagem infinito e resiliente para o usuário: ${activeUserId}`);

    const intervalId = setInterval(async () => {
      try {
        const response = await fetch(getApiUrl(`/api/user/status?userId=${encodeURIComponent(activeUserId)}`));
        if (!response.ok) {
          console.warn(`[Pix Polling Warning]: API de status retornou erro HTTP ${response.status}. Mantendo o loop de polling ativo.`);
          return;
        }

        const data = await response.json();
        const isApproved = data && (data.isPremium === true || data.status === "approved" || data.planType === "premium");

        if (isApproved) {
          console.log("[Pix Polling SUCCESS]: Confirmação explícita de sucesso do Mercado Pago! Efetuando redirecionamento nativo instantâneo.");
          clearInterval(intervalId);
          // Redirecionamento nativo instantâneo para recarregar o contexto e evitar erros de desmontagem do Virtual DOM do React
          window.location.replace("/");
          return;
        }
      } catch (err) {
        // Ignorar Erros de Conexão no Frontend
        console.warn("Aguardando conexão estável...", err);
      }
    }, 4000);

    return () => {
      console.log(`[Pix Polling]: Limpando intervalo de checagem para: ${activeUserId}`);
      clearInterval(intervalId);
    };
  }, [showQrCode, pixQrCodeBase64, success, activeUserId]);

  // 2. Real Payment via Credit Card with Mercado Pago
  const handleCardSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    setIsSubmitting(true);

    if (cardNumber.length < 19) {
      setErrorMessage("Número de cartão de crédito incompleto ou inválido.");
      setIsSubmitting(false);
      return;
    }
    if (!cardName.trim()) {
      setErrorMessage("Por favor, preencha o nome impresso no cartão.");
      setIsSubmitting(false);
      return;
    }
    if (cardExpiry.length < 5) {
      setErrorMessage("Data de validade inválida (MM/AA requerido).");
      setIsSubmitting(false);
      return;
    }
    if (cardCvv.length < 3) {
      setErrorMessage("Código de segurança (CVV) inválido.");
      setIsSubmitting(false);
      return;
    }

    try {
      const parts = cardExpiry.split("/");
      const expiryMonth = parts[0];
      const expiryYear = "20" + parts[1]; // MM/AA -> MM/20AA

      const response = await fetch(getApiUrl("/api/mercadopago/checkout"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: activeUserId,
          name: meiName || "Microempreendedor MEI",
          cpfCnpj: cnpjPrestador ? cnpjPrestador.replace(/\D/g, "") : "44837190000183",
          email: email || "contato@meiflow.com",
          paymentMethod: "CREDIT_CARD",
          creditCard: {
            holderName: cardName.trim(),
            number: cardNumber.replace(/\s/g, ""),
            expiryMonth,
            expiryYear,
            ccv: cardCvv
          }
        })
      });

      const data = await response.json();
      if (!isMounted.current || success) return;

      if (response.ok && data.success) {
        if (data.planType === "premium" || data.status === "approved") {
          console.log("[Card Payment SUCCESS]: Redirecionando de forma nativa instantaneamente.");
          // Redirecionamento nativo instantâneo para evitar que a árvore do React quebre ao desmontar elementos de forma assíncrona
          window.location.replace("/");
          return;
        } else {
          setErrorMessage("Assinatura enviada, porém o pagamento ainda está pendente ou sob análise de fraude no Mercado Pago.");
        }
      } else {
        setErrorMessage(data.mensagem || "Falha ao processar pagamento via cartão com o Mercado Pago.");
      }
    } catch (err: any) {
      console.error(err);
      if (isMounted.current && !success) {
        setErrorMessage("Erro de rede ao conectar-se ao servidor de pagamentos.");
      }
    } finally {
      if (isMounted.current && !success) {
        setIsSubmitting(false);
      }
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/75 backdrop-blur-md flex items-center justify-center p-4 overflow-y-auto" id="upgrade-modal-overlay">
      <div className="bg-white rounded-3xl max-w-md w-full shadow-2xl border border-slate-200 overflow-hidden text-left flex flex-col animate-scale-in">
        
        {/* Banner Superior Premium */}
        <div className="relative bg-gradient-to-br from-slate-900 via-indigo-950 to-slate-900 text-white p-7 overflow-hidden shrink-0">
          <div className="absolute top-0 right-0 w-32 h-32 bg-blue-500/10 rounded-full blur-2xl"></div>
          <div className="absolute -bottom-8 -left-8 w-24 h-24 bg-indigo-500/15 rounded-full blur-xl"></div>
          
          <button
            onClick={onClose}
            className="absolute top-4 right-4 text-slate-400 hover:text-white p-1.5 rounded-lg hover:bg-white/10 transition-all cursor-pointer"
            id="upgrade-modal-close-btn"
          >
            <X className="w-5 h-5" />
          </button>

          <div className="space-y-2">
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-blue-500/20 text-blue-300 border border-blue-500/30 text-[10px] font-bold uppercase tracking-widest">
              <Sparkles className="w-3 h-3 text-yellow-300 shrink-0" /> Recurso Especial
            </span>
            <h3 className="text-2xl font-extrabold tracking-tight">Ativação de Recursos Premium</h3>
            <p className="text-xs text-slate-300 max-w-sm">
              Gestão MEI profissional e completa para impulsionar seu próprio negócio.
            </p>
          </div>
        </div>

        {/* Persistent Layout Content Container */}
        <div key="persistent-upgrade-container" className="p-6 md:p-8 space-y-6 flex-1 flex flex-col">
          {success ? (
            <div key="checkout-success-container" className="space-y-6 text-center animate-fade-in" id="upgrade-success-view font-sans">
              <div className="w-12 h-12 bg-emerald-50 rounded-2xl flex items-center justify-center text-emerald-600 border border-emerald-100/50 mx-auto">
                <CheckCircle className="w-6 h-6 shrink-0 animate-bounce" />
              </div>
              <div className="space-y-2 max-w-xs mx-auto">
                <span className="text-emerald-700 font-black text-xs uppercase tracking-wide bg-emerald-50 border border-emerald-100 px-3 py-1 rounded-full inline-block">
                  Parabéns! O seu plano Premium está ativo
                </span>
                <h4 className="text-base font-extrabold text-slate-800 tracking-tight">Assinatura Ativada!</h4>
                <p className="text-xs text-slate-500 leading-normal">
                  Identificamos o pagamento com sucesso via sistema de conciliação integrado. Todos os recursos adicionais já foram desbloqueados.
                </p>
                <div className="pt-2 flex items-center justify-center gap-2 text-[11px] text-slate-400 font-medium">
                  <div className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-ping shrink-0" />
                  <span>Redirecionando para a Dashboard...</span>
                </div>
              </div>

              <button
                onClick={onClose}
                className="w-full py-3 bg-slate-900 hover:bg-slate-850 text-white font-extrabold text-xs rounded-xl shadow-xs transition-all cursor-pointer text-center block uppercase tracking-wider"
                id="success-modal-exit-btn"
              >
                Ir para a Dashboard Agora ➔
              </button>
            </div>
          ) : (
            <div key="checkout-forms-wrapper" className="space-y-6 flex-1 flex flex-col">
              
              {/* STEP 1: General Details */}
              {checkoutStep === "details" && (
                <div key="step-details" className="space-y-6 animate-fade-in" id="step-details">
                  <div className="flex items-baseline gap-1.5 justify-center pb-2 border-b border-slate-100">
                    <span className="text-2xl font-extrabold text-slate-900">R$ 29,90</span>
                    <span className="text-xs text-slate-500 font-medium">/ mensal</span>
                  </div>

                  <h4 className="text-[10px] font-extrabold text-slate-400 uppercase tracking-widest">Recursos Ativados imediatamente</h4>

                  <div className="space-y-4">
                    <div className="flex gap-3 text-left">
                      <div className="w-9 h-9 bg-blue-50 text-blue-600 rounded-xl flex items-center justify-center shrink-0 border border-blue-100/50">
                        <FileText className="w-4.5 h-4.5" />
                      </div>
                      <div className="space-y-0.5 min-w-0">
                        <span className="text-xs font-bold text-slate-800 block">Emissão de NFS-e (Até 30 Notas/mês)</span>
                        <p className="text-[11px] text-slate-500 leading-normal">
                          Emita suas notas fiscais de serviço de maneira simplificada diretamente no app, com limite de 30 emissões mensais inclusas.
                        </p>
                      </div>
                    </div>

                    <div className="flex gap-3 text-left">
                      <div className="w-9 h-9 bg-indigo-50 text-indigo-600 rounded-xl flex items-center justify-center shrink-0 border border-indigo-100/50">
                        <ImageIcon className="w-4.5 h-4.5" />
                      </div>
                      <div className="space-y-0.5 min-w-0">
                        <span className="text-xs font-bold text-slate-800 block">Identidade Visual (Logo Própria)</span>
                        <p className="text-[11px] text-slate-500 leading-normal">
                          Adicione o logotipo da sua empresa em todos os recibos, PDF de vendas e no gerador de orçamentos profissionais.
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="p-4 bg-emerald-50 rounded-2xl border border-emerald-100/50 flex items-center gap-3">
                    <div className="text-left leading-normal font-sans text-xs text-emerald-950">
                      <span className="font-extrabold text-emerald-950 block text-sm">Liberação Automatizada</span>
                      Assinatura 100% livre de fidelidade. Você pode cancelar a qualquer momento sem burocracia ou taxas de cancelamento.
                    </div>
                  </div>

                  <div className="space-y-2.5">
                    <button
                      onClick={() => setCheckoutStep("payment_method")}
                      className="w-full bg-slate-900 hover:bg-slate-800 text-white font-extrabold py-3.5 px-4 rounded-xl text-xs flex items-center justify-center gap-2 border border-slate-950 shadow-lg transition-all cursor-pointer active:scale-95"
                      id="upgrade-start-checkout-btn"
                    >
                      <span>Contratar Plano Premium - R$ 29,90/mês</span>
                      <ArrowRight className="w-4 h-4 text-emerald-400" />
                    </button>
                    
                    <button
                      onClick={onClose}
                      className="w-full py-2.5 text-center text-slate-500 hover:text-slate-700 bg-slate-50 rounded-xl font-bold text-xs transition-all cursor-pointer block"
                      id="upgrade-remain-free-btn"
                    >
                      Permanecer no Plano Gratuito
                    </button>
                  </div>
                </div>
              )}

              {/* STEP 2: Payment Method Selection */}
              {checkoutStep === "payment_method" && (
                <div key="step-payment-methods" className="space-y-5 animate-fade-in" id="step-payment-methods">
                  <button 
                    onClick={() => setCheckoutStep("details")} 
                    className="flex items-center gap-1.5 text-xs font-bold text-slate-500 hover:text-slate-800 transition-all cursor-pointer animate-fade-in"
                    id="upgrade-back-to-details-btn"
                  >
                    <ArrowLeft className="w-3.5 h-3.5" /> Voltar
                  </button>

                  <div className="text-center space-y-1">
                    <h4 className="text-sm font-black text-slate-900">Escolha a Forma de Pagamento</h4>
                    <p className="text-xs text-slate-500">Valor da assinatura mensal: R$ 29,90</p>
                  </div>

                  <div className="space-y-3 pt-2">
                    <button
                      onClick={() => setCheckoutStep("pix")}
                      className="w-full p-4 border border-slate-200 hover:border-emerald-500 hover:bg-emerald-50/20 rounded-2xl flex items-center justify-between text-left transition-all cursor-pointer group"
                      id="select-pix-payment"
                    >
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-emerald-50 text-emerald-600 rounded-xl flex items-center justify-center font-bold text-lg shrink-0">
                          ❖
                        </div>
                        <div>
                          <span className="text-xs font-black text-slate-800 block">Pagar via Pix</span>
                          <span className="text-[10px] text-emerald-600 font-bold block">Aprovação em segundos</span>
                        </div>
                      </div>
                      <ArrowRight className="w-4 h-4 text-slate-300 group-hover:text-emerald-500 transition-all" />
                    </button>

                    <button
                      onClick={() => setCheckoutStep("card")}
                      className="w-full p-4 border border-slate-200 hover:border-blue-500 hover:bg-blue-50/20 rounded-2xl flex items-center justify-between text-left transition-all cursor-pointer group"
                      id="select-card-payment"
                    >
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-blue-50 text-blue-600 rounded-xl flex items-center justify-center shrink-0">
                          <CreditCard className="w-5 h-5" />
                        </div>
                        <div>
                          <span className="text-xs font-black text-slate-800 block">Cartão de Crédito</span>
                          <span className="text-[10px] text-blue-600 font-bold block">Renovação segura e mensal</span>
                        </div>
                      </div>
                      <ArrowRight className="w-4 h-4 text-slate-300 group-hover:text-blue-500 transition-all" />
                    </button>
                  </div>

                  <div className="flex items-center justify-center gap-1 text-slate-400 text-[10px] font-bold uppercase tracking-wider justify-center pt-2">
                    <Lock className="w-3.5 h-3.5 text-blue-500" />
                    <span>Ambiente Seguro & Integrado com Mercado Pago</span>
                  </div>
                </div>
              )}

              {/* STEP 3: Pix QR-Code */}
              {checkoutStep === "pix" && (
                <div key="step-pix-checkout" className="space-y-5 animate-fade-in text-center" id="step-pix-checkout">
                  <button 
                    onClick={handleCancelPix} 
                    className="flex items-center gap-1.5 text-xs font-bold text-slate-500 hover:text-slate-800 transition-all cursor-pointer"
                    id="pix-back-btn"
                  >
                    <ArrowLeft className="w-3.5 h-3.5" /> Voltar
                  </button>
 
                  <div className="space-y-1">
                    <h4 className="text-sm font-black text-slate-900">Pagamento via Pix</h4>
                    <p className="text-xs text-slate-500 leading-normal max-w-xs mx-auto">
                      Instante e seguro. O plano Premium é liberado imediatamente.
                    </p>
                  </div>
 
                  {!pixQrCodeBase64 ? (
                    <div className="bg-slate-50/50 border border-slate-200/80 p-5 rounded-2xl max-w-xs mx-auto space-y-4 text-left animate-fade-in">
                      <div className="space-y-1.5">
                        <label className="text-[11px] font-black text-slate-700 uppercase tracking-wider block">
                          Informe o CPF ou CNPJ do comprador
                        </label>
                        <input
                          type="text"
                          placeholder="000.000.000-00 ou 00.000.000/0000-00"
                          value={documentNumber}
                          onChange={(e) => setDocumentNumber(e.target.value)}
                          className="w-full px-3.5 py-2.5 bg-white border border-slate-250 focus:border-emerald-600 focus:ring-1 focus:ring-emerald-600 rounded-xl text-xs font-black text-slate-800 transition-all focus:outline-none placeholder:text-slate-400 placeholder:font-normal text-center"
                          id="pix-document-input"
                        />
                      </div>
 
                      {errorMessage && (
                        <div className="p-3 bg-rose-50 border border-rose-100 rounded-xl">
                          <p className="text-[11px] text-rose-800 font-bold leading-normal">{errorMessage}</p>
                        </div>
                      )}
 
                      <button
                        onClick={handleGeneratePix}
                        disabled={isSubmitting || !documentNumber.replace(/\D/g, "")}
                        className="w-full py-3 bg-slate-900 hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed text-white font-extrabold text-[11px] rounded-xl shadow-md transition-all uppercase tracking-wider flex items-center justify-center gap-2 cursor-pointer active:scale-95"
                        id="pix-submit-btn"
                      >
                        {isSubmitting ? (
                          <>
                            <Loader2 className="w-4 h-4 text-emerald-400 animate-spin" />
                            <span>Gerando Pix...</span>
                          </>
                        ) : (
                          <span>Gerar Código Pix</span>
                        )}
                      </button>
                    </div>
                  ) : (
                    <div key="pix-details-content" className="space-y-4 animate-fade-in">
                      {errorMessage && (
                        <div className="p-3 bg-rose-50 border border-rose-100 rounded-xl max-w-xs mx-auto text-left">
                          <p className="text-[11px] text-rose-800 font-bold leading-normal">{errorMessage}</p>
                        </div>
                      )}
 
                      {/* Visual QR Code representation */}
                      <div className="bg-slate-50 border border-slate-200 p-4 rounded-2xl max-w-[200px] mx-auto space-y-3 relative">
                        <div className="bg-white p-2.5 rounded-xl border border-slate-100 flex items-center justify-center">
                          <img 
                            src={pixQrCodeBase64.startsWith("data:") ? pixQrCodeBase64 : `data:image/png;base64,${pixQrCodeBase64}`} 
                            className="w-36 h-36" 
                            alt="QR Code Pix" 
                            referrerPolicy="no-referrer"
                          />
                        </div>
                        <div className="text-[10px] font-bold text-slate-700 bg-slate-200/50 py-1 px-2 rounded-md">
                          Valor: <strong className="text-emerald-700">R$ 29,90 Por Mês</strong>
                        </div>
                      </div>
 
                      {/* Copia e Cola box */}
                      <div className="space-y-2 max-w-xs mx-auto">
                        <button
                          onClick={handleCopyPix}
                          disabled={!pixPayload}
                          className="w-full py-2.5 px-4 bg-slate-100 hover:bg-slate-200 disabled:opacity-50 disabled:cursor-not-allowed text-slate-800 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-2 cursor-pointer border border-slate-200/50 shadow-sm"
                          id="copy-pix-payload-btn"
                        >
                          <Clipboard className="w-4 h-4 text-slate-600" />
                          <span>{isCopied ? "Pix Copiado!" : "Copiar Código Copia e Cola"}</span>
                        </button>
                      </div>
 
                      <div className="py-3 px-4 bg-emerald-50 border border-emerald-100 rounded-2xl flex items-center justify-center gap-2 max-w-xs mx-auto">
                        <div className="w-2 h-2 bg-emerald-500 rounded-full animate-ping shrink-0" />
                        <span className="text-[11px] text-emerald-950 font-bold">
                          Aguardando pagamento do Mercado Pago...
                        </span>
                      </div>
 
                      <p className="text-[10px] text-slate-400 font-medium">
                        O plano Premium será liberado automaticamente em tela assim que o pagamento for detectado pelo webhook.
                      </p>
                    </div>
                  )}
                </div>
              )}

              {/* STEP 4: Credit Card Form */}
              {checkoutStep === "card" && (
                <div key="step-card-checkout" className="space-y-4 animate-fade-in" id="step-card-checkout">
                  <button 
                    onClick={() => setCheckoutStep("payment_method")} 
                    className="flex items-center gap-1.5 text-xs font-bold text-slate-500 hover:text-slate-800 transition-all cursor-pointer"
                    id="card-back-btn"
                  >
                    <ArrowLeft className="w-3.5 h-3.5" /> Voltar
                  </button>

                  <div className="space-y-1 text-center">
                    <h4 className="text-sm font-black text-slate-900">Cadastro de Cartão</h4>
                    <p className="text-xs text-slate-500">Transação recorrente de R$ 29,90 em ambiente protegido Mercado Pago.</p>
                  </div>

                  <form onSubmit={handleCardSubmit} className="space-y-3.5">
                    <div>
                      <label className="block text-[9px] uppercase tracking-wider font-extrabold text-slate-500 mb-1">
                        Número do Cartão
                      </label>
                      <div className="relative">
                        <input
                          type="text"
                          value={cardNumber}
                          onChange={handleCardNumberChange}
                          placeholder="0000 0000 0000 0000"
                          className="w-full bg-slate-50 border border-slate-200 text-slate-800 rounded-xl py-2 px-3 pl-9 text-xs focus:ring-1 focus:ring-blue-500 focus:outline-none focus:bg-white font-mono"
                          required
                          id="card-number-input"
                        />
                        <CreditCard className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                      </div>
                    </div>

                    <div>
                      <label className="block text-[9px] uppercase tracking-wider font-extrabold text-slate-500 mb-1">
                        Nome Impresso no Cartão
                      </label>
                      <input
                        type="text"
                        value={cardName}
                        onChange={(e) => setCardName(e.target.value.toUpperCase())}
                        placeholder="NOME COMPLETO DO TITULAR"
                        className="w-full bg-slate-50 border border-slate-200 text-slate-800 rounded-xl py-2 px-3 text-xs focus:ring-1 focus:ring-blue-500 focus:outline-none focus:bg-white uppercase"
                        required
                        id="card-holder-name-input"
                      />
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-[9px] uppercase tracking-wider font-extrabold text-slate-500 mb-1">
                          Validade
                        </label>
                        <input
                          type="text"
                          value={cardExpiry}
                          onChange={handleExpiryChange}
                          placeholder="MM/AA"
                          className="w-full bg-slate-50 border border-slate-200 text-slate-800 rounded-xl py-2 px-3 text-xs focus:ring-1 focus:ring-blue-500 focus:outline-none focus:bg-white font-mono"
                          required
                          id="card-expiry-input"
                        />
                      </div>
                      <div>
                        <label className="block text-[9px] uppercase tracking-wider font-extrabold text-slate-500 mb-1">
                          Código CVV
                        </label>
                        <input
                          type="password"
                          value={cardCvv}
                          onChange={handleCvvChange}
                          placeholder="000"
                          className="w-full bg-slate-50 border border-slate-200 text-slate-800 rounded-xl py-2 px-3 text-xs focus:ring-1 focus:ring-blue-500 focus:outline-none focus:bg-white font-mono"
                          required
                          id="card-cvv-input"
                        />
                      </div>
                    </div>

                    {errorMessage && (
                      <div key="card-error-display" className="p-2.5 bg-red-50 border border-red-200 rounded-xl text-red-800 text-[11px] text-center leading-normal" id="card-error-display">
                        {errorMessage}
                      </div>
                    )}

                    <div className="pt-2">
                      <button
                        type="submit"
                        disabled={isSubmitting}
                        className="w-full bg-slate-900 hover:bg-slate-850 disabled:bg-slate-300 text-white font-extrabold py-3.5 px-4 rounded-xl text-xs flex items-center justify-center gap-2 shadow-lg transition-all cursor-pointer active:scale-95 uppercase tracking-wider disabled:cursor-not-allowed"
                        id="submit-card-payment-btn"
                      >
                        {isSubmitting ? (
                          <span key="loading-label" className="flex items-center gap-2">
                            <Loader2 className="w-4 h-4 animate-spin text-white" />
                            <span>Processando Pagamento...</span>
                          </span>
                        ) : (
                          <span key="normal-label" className="flex items-center gap-2">
                            <span>Efetuar Assinatura — R$ 29,90</span>
                            <ShieldCheck className="w-4 h-4 text-emerald-400" />
                          </span>
                        )}
                      </button>
                    </div>
                  </form>

                  <div className="text-[10px] text-slate-400 font-medium text-center flex items-center justify-center gap-1 py-1">
                    <Lock className="w-3 h-3 text-emerald-600" />
                    <span>Criptografia ponta a ponta ativa e robusta</span>
                  </div>
                </div>
              )}

            </div>
          )}
        </div>

      </div>
    </div>
  );
}
