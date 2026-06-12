import React, { useState } from "react";
import { X, CheckCircle, Sparkles, Receipt, FileText, ImageIcon, ShieldCheck, Loader2 } from "lucide-react";

interface UpgradeModalProps {
  isOpen: boolean;
  onClose: () => void;
  onUpgradeSuccess: () => Promise<void>;
}

export default function UpgradeModal({ isOpen, onClose, onUpgradeSuccess }: UpgradeModalProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (!isOpen) return null;

  const handleUpgradeClick = async () => {
    setIsSubmitting(true);
    try {
      // Simula uma requisição segura para o gateway de pagamento ou sincronização premium
      await new Promise((resolve) => setTimeout(resolve, 1500));
      await onUpgradeSuccess();
      onClose();
    } catch (e) {
      console.error("Erro ao ativar premium:", e);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/75 backdrop-blur-md flex items-center justify-center p-4">
      <div className="bg-white rounded-3xl max-w-md w-full shadow-2xl border border-slate-200 overflow-hidden text-left flex flex-col transform transition-all animate-fade-in scale-100">
        
        {/* Banner Superior Premium */}
        <div className="relative bg-gradient-to-br from-slate-900 via-indigo-950 to-slate-900 text-white p-8 overflow-hidden">
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
              <Sparkles className="w-3 h-3 text-yellow-300 shrink-0" /> MEI Flow Premium
            </span>
            <h3 className="text-2xl font-extrabold tracking-tight">Evolua sua Gestão</h3>
            <p className="text-xs text-slate-300 max-w-xs">
              Deixe os processos burocráticos no passado e tenha uma gestão financeira profissional de ponta a ponta.
            </p>
          </div>
        </div>

        {/* Lista de Vantagens e Comparativo */}
        <div className="p-6 md:p-8 space-y-6">
          <h4 className="text-[10px] font-extrabold text-slate-400 uppercase tracking-widest">Vantagens Exclusivas Liberadas</h4>

          <div className="space-y-4">
            {/* Vantagem 1 */}
            <div className="flex gap-3 text-left">
              <div className="w-9 h-9 bg-emerald-50 text-emerald-600 rounded-xl flex items-center justify-center shrink-0 border border-emerald-100/50">
                <Receipt className="w-4.5 h-4.5" />
              </div>
              <div className="space-y-0.5">
                <span className="text-xs font-bold text-slate-800 block">Emissão de Boletos e Carnês (Asaas)</span>
                <p className="text-[11px] text-slate-500 leading-normal">
                  Gere boletos híbridos (Boleto + Pix) e carnês parcelados. Tarifas fixas de apenas <strong>R$ 2,50 por boleto pago</strong>. Sem custos extras!
                </p>
              </div>
            </div>

            {/* Vantagem 2 */}
            <div className="flex gap-3 text-left">
              <div className="w-9 h-9 bg-blue-50 text-blue-600 rounded-xl flex items-center justify-center shrink-0 border border-blue-100/50">
                <FileText className="w-4.5 h-4.5" />
              </div>
              <div className="space-y-0.5">
                <span className="text-xs font-bold text-slate-800 block">Emissão de Notas de Serviço (NFS-e)</span>
                <p className="text-[11px] text-slate-500 leading-normal">
                  Faturamento automatizado com prefeituras via Focus NFe de forma rápida, segura e declarada nos moldes legais do MEI.
                </p>
              </div>
            </div>

            {/* Vantagem 3 */}
            <div className="flex gap-3 text-left">
              <div className="w-9 h-9 bg-indigo-50 text-indigo-600 rounded-xl flex items-center justify-center shrink-0 border border-indigo-100/50">
                <ImageIcon className="w-4.5 h-4.5" />
              </div>
              <div className="space-y-0.5">
                <span className="text-xs font-bold text-slate-800 block">Logotipo Personalizado nos Recibos</span>
                <p className="text-[11px] text-slate-500 leading-normal">
                  Substitua cabeçalhos de texto pela logomarca oficial da sua empresa nos comprovantes profissionais em PDF gerados no aplicativo.
                </p>
              </div>
            </div>
          </div>

          <div className="p-4 bg-slate-50 rounded-2xl border border-slate-200/50 flex items-center gap-3">
            <ShieldCheck className="w-8 h-8 text-indigo-600 shrink-0" />
            <div className="text-left leading-tight">
              <p className="text-xs font-bold text-slate-800">Garantia e Segurança MEI Flow</p>
              <p className="text-[10px] text-slate-400 mt-0.5">Ativação instantânea em ambiente seguro de simulação.</p>
            </div>
          </div>

          {/* CTA Buttons */}
          <div className="space-y-2.5">
            <button
              onClick={handleUpgradeClick}
              disabled={isSubmitting}
              className="w-full bg-indigo-950 hover:bg-slate-900 disabled:bg-slate-300 text-white font-extrabold py-3.5 px-4 rounded-xl text-xs flex items-center justify-center gap-2 shadow-lg transition-all cursor-pointer active:scale-95"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin text-white" />
                  Ativando Assinatura Segura...
                </>
              ) : (
                <>
                  <span>Ativar Licença Premium</span>
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
                </>
              )}
            </button>
            
            <button
              onClick={onClose}
              disabled={isSubmitting}
              className="w-full py-2 bg-slate-100 hover:bg-slate-100 text-slate-500 rounded-xl text-neutral font-bold text-xs transition-all cursor-pointer text-center block"
            >
              Continuar Versão Gratuita (Free)
            </button>
          </div>
        </div>

      </div>
    </div>
  );
}
