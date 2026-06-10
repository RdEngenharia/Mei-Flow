import React, { useState } from "react";
import { X, Building, Check } from "lucide-react";

interface MeiConfigModalProps {
  currentName: string;
  currentCnpj: string;
  currentInscricao: string;
  currentTelefone: string;
  onClose: () => void;
  onSave: (name: string, cnpj: string, inscricao: string, telefone: string) => Promise<void>;
}

export default function MeiConfigModal({
  currentName,
  currentCnpj,
  currentInscricao,
  currentTelefone,
  onClose,
  onSave,
}: MeiConfigModalProps) {
  const [name, setName] = useState(currentName);
  const [cnpj, setCnpj] = useState(currentCnpj);
  const [inscricao, setInscricao] = useState(currentInscricao);
  const [telefone, setTelefone] = useState(currentTelefone);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    await onSave(name, cnpj, inscricao, telefone);
    setLoading(false);
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl max-w-sm w-full shadow-2xl border border-slate-200 overflow-hidden text-left flex flex-col">
        {/* Header */}
        <div className="px-6 py-4 bg-slate-900 text-white flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Building className="w-4 h-4 text-blue-400" />
            <h3 className="font-bold text-xs tracking-tight uppercase">Configurações da Empresa</h3>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white p-1 rounded font-bold text-sm cursor-pointer"
          >
            ✕
          </button>
        </div>

        {/* Content */}
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <p className="text-[11px] text-slate-500 leading-relaxed font-medium">
            Preencha os dados do seu MEI. Estas informações são utilizadas para emissão de recibos, preenchimento automático das notas fiscais (RPS) e relatórios oficiais.
          </p>

          <div>
            <label className="block text-[9px] uppercase tracking-wider font-extrabold text-slate-500 mb-1">
              Razão Social (Nome da Empresa) *
            </label>
            <input
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ex: João da Silva MEI"
              className="w-full bg-slate-50 border border-slate-200 text-slate-800 rounded-xl py-2 px-3 text-xs focus:ring-1 focus:ring-blue-500 focus:outline-none focus:bg-white"
            />
          </div>

          <div>
            <label className="block text-[9px] uppercase tracking-wider font-extrabold text-slate-500 mb-1">
              CNPJ do Emissor *
            </label>
            <input
              type="text"
              required
              value={cnpj}
              onChange={(e) => setCnpj(e.target.value)}
              placeholder="Ex: 00.000.000/0001-00"
              className="w-full bg-slate-50 border border-slate-200 text-slate-800 rounded-xl py-2 px-3 text-xs focus:ring-1 focus:ring-blue-500 focus:outline-none focus:bg-white font-mono"
            />
          </div>

          <div>
            <label className="block text-[9px] uppercase tracking-wider font-extrabold text-slate-500 mb-1">
              Inscrição Municipal (IM)
            </label>
            <input
              type="text"
              value={inscricao}
              onChange={(e) => setInscricao(e.target.value)}
              placeholder="Ex: 123456-7"
              className="w-full bg-slate-50 border border-slate-200 text-slate-800 rounded-xl py-2 px-3 text-xs focus:ring-1 focus:ring-blue-500 focus:outline-none focus:bg-white font-mono"
            />
          </div>

          <div>
            <label className="block text-[9px] uppercase tracking-wider font-extrabold text-slate-500 mb-1">
              Telefone de Contato / Comercial
            </label>
            <input
              type="text"
              value={telefone}
              onChange={(e) => setTelefone(e.target.value)}
              placeholder="Ex: (11) 99999-9999"
              className="w-full bg-slate-50 border border-slate-200 text-slate-800 rounded-xl py-2 px-3 text-xs focus:ring-1 focus:ring-blue-500 focus:outline-none focus:bg-white font-mono"
            />
          </div>

          <div className="flex gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold transition-all cursor-pointer"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={loading}
              className="flex-1 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold transition-all shadow-sm flex items-center justify-center gap-1.5 disabled:opacity-50 cursor-pointer"
            >
              {loading ? (
                <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
              ) : (
                <>
                  <Check className="w-3.5 h-3.5" />
                  <span>Salvar Alterações</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
