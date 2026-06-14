import React, { useState, useEffect } from "react";
import { X, CheckCircle, Sparkles, FileText, ImageIcon, ShieldCheck, Loader2, ArrowRight } from "lucide-react";
import { auth, db } from "../firebase";
import { doc, getDoc, setDoc } from "firebase/firestore";

interface UpgradeModalProps {
  isOpen: boolean;
  onClose: () => void;
  onUpgradeSuccess: () => Promise<void>;
  userId?: string;
}

export default function UpgradeModal({ isOpen, onClose, onUpgradeSuccess, userId: propUserId }: UpgradeModalProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  
  const activeUserId = propUserId || auth.currentUser?.uid || "user_49281";

  if (!isOpen) return null;

  const handleInstantActivate = async () => {
    setErrorMessage(null);
    setIsSubmitting(true);

    try {
      if (auth.currentUser) {
        // Persistir no Firestore diretamente para seguranca de multi-usuario ativa
        const userDocRef = doc(db, "users", auth.currentUser.uid);
        await setDoc(userDocRef, {
          planType: "premium",
          updatedAt: new Date().toISOString()
        }, { merge: true });

        const legacyDocRef = doc(db, "usuarios", auth.currentUser.uid);
        await setDoc(legacyDocRef, {
          planType: "premium",
          updatedAt: new Date().toISOString()
        }, { merge: true });
      } else {
        localStorage.setItem("meiflow_plan_type", "premium");
      }

      // Ativa sucesso no pai
      await onUpgradeSuccess();
      setSuccess(true);
    } catch (err: any) {
      console.error(err);
      setErrorMessage("Erro ao atualizar o plano de assinatura na nuvem: " + err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/75 backdrop-blur-md flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-white rounded-3xl max-w-md w-full shadow-2xl border border-slate-200 overflow-hidden text-left flex flex-col animate-fade-in">
        
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
              <Sparkles className="w-3 h-3 text-yellow-300 shrink-0" /> Recurso Especial
            </span>
            <h3 className="text-2xl font-extrabold tracking-tight">Ativação de Recursos Premium</h3>
            <p className="text-xs text-slate-300 max-w-sm">
              Gestão MEI profissional e desimpedida para o seu crescimento.
            </p>
          </div>
        </div>

        {/* CONTENT CHANNELS */}
        {!success ? (
          <div className="p-6 md:p-8 space-y-6">
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
                    Emita suas notas fiscais de serviço de maneira simplificada diretamente no app, com limite de 30 emissões mensais.
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
                    Adicione o logotipo da sua empresa em todos os recibos, PDF de vendas e no gerador de orçamentos profesionales.
                  </p>
                </div>
              </div>
            </div>

            {errorMessage && (
              <div className="p-3.5 bg-red-50 border border-red-200 rounded-xl text-red-700 text-xs text-center leading-normal">
                {errorMessage}
              </div>
            )}

            <div className="p-4 bg-emerald-50 rounded-2xl border border-emerald-100/50 flex items-center gap-3">
              <div className="text-left leading-normal font-sans text-xs text-emerald-900">
                <span className="font-extrabold text-emerald-950 block text-sm">Liberação Imediata</span>
                Acesso total ativado para emissão de notas fiscais, catálogo inteligente, remoção de marcas d'água e relatórios mensais.
              </div>
            </div>

            <div className="space-y-2.5">
              <button
                onClick={handleInstantActivate}
                disabled={isSubmitting}
                className="w-full bg-slate-900 hover:bg-slate-800 disabled:bg-slate-300 text-white font-extrabold py-3.5 px-4 rounded-xl text-xs flex items-center justify-center gap-2 border border-slate-950 shadow-lg transition-all cursor-pointer active:scale-95"
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin text-white" />
                    Ativando Recursos Premium...
                  </>
                ) : (
                  <>
                    <span>Assinar Plano Premium - R$ 29,90/mês</span>
                    <ArrowRight className="w-4 h-4 text-emerald-400" />
                  </>
                )}
              </button>
              
              <button
                onClick={onClose}
                className="w-full py-2.5 text-center text-slate-500 hover:text-slate-700 bg-slate-50 rounded-xl font-bold text-xs transition-all cursor-pointer block"
              >
                Permanecer no Plano Gratuito
              </button>
            </div>
          </div>
        ) : (
          <div className="p-6 md:p-8 space-y-6 text-center">
            <div className="w-12 h-12 bg-emerald-50 rounded-2xl flex items-center justify-center text-emerald-600 border border-emerald-100/50 mx-auto">
              <CheckCircle className="w-6 h-6 shrink-0" />
            </div>
            <div className="space-y-1 max-w-xs mx-auto">
              <h4 className="text-base font-extrabold text-slate-800 tracking-tight">Premium Ativado com Sucesso!</h4>
              <p className="text-xs text-slate-500 leading-normal">
                Parabéns! Sua conta foi atualizada e todos os privilégios extras já estão ativos.
              </p>
            </div>

            <button
              onClick={onClose}
              className="w-full py-3 bg-slate-900 hover:bg-slate-850 text-white font-extrabold text-xs rounded-xl shadow-xs transition-all cursor-pointer text-center block uppercase tracking-wider"
            >
              Começar a Usar Recursos Premium ➔
            </button>
          </div>
        )}

      </div>
    </div>
  );
}
