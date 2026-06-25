import React, { useState } from "react";
import { X, Copy, ExternalLink, Check, Calendar, HelpCircle } from "lucide-react";

interface DasnModalProps {
  cnpjUsuario: string;
  onClose: () => void;
  triggerToast: (msg: string) => void;
}

export default function DasnModal({ cnpjUsuario, onClose, triggerToast }: DasnModalProps) {
  const [copied, setCopied] = useState(false);

  const cleanCnpj = cnpjUsuario ? cnpjUsuario.replace(/\D/g, "") : "";

  const handleCopyAndRedirect = async () => {
    try {
      if (!cleanCnpj) {
        triggerToast("⚠ Você precisa cadastrar um CNPJ primeiro!");
        return;
      }
      
      // Copy to clipboard
      await navigator.clipboard.writeText(cleanCnpj);
      setCopied(true);
      
      // Trigger success visual toast
      triggerToast("CNPJ copiado com sucesso! Fornecemos o acesso ao portal oficial.");
      
      // Redirect after a short delay/simultaneously in a new tab
      setTimeout(() => {
        window.open(
          "https://www.gov.br/empresas-e-negocios/pt-br/empreendedor/servicos-para-mei/declaracao-anual-de-faturamento",
          "_blank"
        );
      }, 300);

      // Keep visual feedback in modal active for a few seconds
      setTimeout(() => {
        setCopied(false);
      }, 5000);
    } catch (err) {
      console.error("Erro ao copiar CNPJ:", err);
      // Fallback redirect if clipboard API fails
      window.open(
        "https://www.gov.br/empresas-e-negocios/pt-br/empreendedor/servicos-para-mei/declaracao-anual-de-faturamento",
        "_blank"
      );
      triggerToast("Redirecionando para o portal Gov.br...");
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-xs flex items-start sm:items-center justify-center p-4 overflow-y-auto">
      <div className="bg-white rounded-3xl max-w-xl w-full shadow-2xl border border-slate-200/80 overflow-hidden text-left animate-in fade-in zoom-in-95 duration-200 my-auto">
        
        {/* Header */}
        <div className="pt-safe px-6 pb-5 bg-slate-50 border-b border-slate-200/60 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 bg-amber-50 text-amber-600 rounded-xl flex items-center justify-center">
              <Calendar className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-extrabold text-slate-900 text-base leading-tight">Declaração Anual (DASN-SIMEI)</h3>
              <span className="text-xs text-slate-400 font-medium">Envio anual obrigatório do faturamento bruto</span>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 p-1.5 rounded-lg hover:bg-slate-100 transition-all cursor-pointer font-bold"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-6 space-y-6">
          
          {/* Box de CNPJ Autorreprodutivo */}
          <div className="p-4 bg-slate-50/80 rounded-2xl border border-slate-200/60 space-y-2">
            <div className="flex justify-between items-center">
              <span className="text-[10px] text-slate-400 uppercase tracking-widest font-extrabold">Seu CNPJ Cadastrado</span>
              {copied && (
                <span className="inline-flex items-center gap-1 text-[10px] bg-emerald-50 text-emerald-700 border border-emerald-200 font-bold px-2 py-0.5 rounded-full animate-pulse">
                  <Check className="w-2.5 h-2.5" /> Copiado!
                </span>
              )}
            </div>
            <div className="flex items-center justify-between gap-4">
              <span className="font-mono text-lg font-bold text-slate-800 tracking-tight">
                {cnpjUsuario || "Não cadastrado no Perfil"}
              </span>
              <button
                type="button"
                onClick={handleCopyAndRedirect}
                className="p-2 hover:bg-slate-200/65 text-slate-500 hover:text-slate-800 rounded-xl transition-all border border-slate-200/50 hover:border-slate-300"
                title="Copiar CNPJ"
              >
                <Copy className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Passo a Passo Explicativo */}
          <div className="space-y-4">
            <h4 className="text-xs font-extrabold uppercase tracking-widest text-amber-600">Instruções Importantes</h4>
            
            <div className="space-y-3.5">
              {/* Passo 1 */}
              <div className="flex gap-3 text-left">
                <div className="w-6 h-6 rounded-lg bg-amber-50 text-amber-700 flex items-center justify-center font-bold text-xs shrink-0 mt-0.5">
                  1
                </div>
                <div className="space-y-0.5">
                  <strong className="text-xs text-slate-800 block font-bold">Iniciar o serviço no portal</strong>
                  <p className="text-xs text-slate-500 leading-relaxed font-light">
                    No portal do Gov.br, clique na opção para iniciar o serviço da Declaração.
                  </p>
                </div>
              </div>

              {/* Passo 2 */}
              <div className="flex gap-3 text-left">
                <div className="w-6 h-6 rounded-lg bg-amber-50 text-amber-700 flex items-center justify-center font-bold text-xs shrink-0 mt-0.5">
                  2
                </div>
                <div className="space-y-0.5">
                  <strong className="text-xs text-slate-800 block font-bold">Cole o CNPJ copiado</strong>
                  <p className="text-xs text-slate-500 leading-relaxed font-light">
                    Cole o seu CNPJ (que já está copiado) quando solicitado pelo sistema de identificação.
                  </p>
                </div>
              </div>

              {/* Passo 3 */}
              <div className="flex gap-3 text-left">
                <div className="w-6 h-6 rounded-lg bg-amber-50 text-amber-700 flex items-center justify-center font-bold text-xs shrink-0 mt-0.5">
                  3
                </div>
                <div className="space-y-0.5">
                  <strong className="text-xs text-slate-800 block font-bold">Declare o faturamento bruto</strong>
                  <p className="text-xs text-slate-500 leading-relaxed font-light">
                    Escolha o ano-calendário correspondente ao ano passado, informe o seu faturamento bruto e envie de forma segura.
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Call-to-Action Principal */}
          <button
            type="button"
            onClick={handleCopyAndRedirect}
            className="w-full py-3.5 px-5 bg-amber-500 hover:bg-amber-600 text-white font-extrabold text-xs rounded-xl shadow-md tracking-wider transition-all cursor-pointer uppercase flex items-center justify-center gap-2"
          >
            <span>Fazer Declaração Anual (DASN)</span>
            <ExternalLink className="w-4 h-4 text-amber-100" />
          </button>

          {/* Dica de Segurança */}
          <div className="flex items-start gap-2 p-3 bg-amber-50/50 border border-amber-100/40 rounded-xl text-[11px] text-amber-805 leading-relaxed">
            <HelpCircle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
            <p>
              A DASN-SIMEI deve ser entregue anualmente por todos os Microempreendedores Individuais do Brasil, registrando o faturamento acumulado e se houve contratação de funcionário, evitando multas e pendências fiscais federais.
            </p>
          </div>

        </div>

        {/* Footer */}
        <div className="px-6 py-4 bg-slate-50 border-t border-slate-200/60 flex items-center justify-between text-xs">
          <span className="text-slate-400 font-medium">Declaração Anual Consolidada</span>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 bg-white hover:bg-slate-50 border border-slate-200 text-slate-700 font-bold rounded-lg transition-all"
          >
            Fechar Instruções
          </button>
        </div>

      </div>
    </div>
  );
}
