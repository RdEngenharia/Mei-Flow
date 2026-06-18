import React, { useState } from "react";
import { Building2, Search, CheckCircle, Sparkles, AlertCircle, ArrowRight, Play } from "lucide-react";

interface CnpjOnboardingProps {
  onSave: (name: string, cnpj: string, inscricao: string, telefone: string) => Promise<void>;
  onSkipWithDemo: () => void;
  userEmail: string;
}

export default function CnpjOnboarding({ onSave, onSkipWithDemo, userEmail }: CnpjOnboardingProps) {
  const [cnpjInput, setCnpjInput] = useState("");
  const [step, setStep] = useState<1 | 2>(1); // 1: Input CNPJ, 2: Confirm Information
  
  // Fetched data
  const [meiName, setMeiName] = useState("");
  const [telefone, setTelefone] = useState("");
  const [inscricaoMunicipal, setInscricaoMunicipal] = useState("");
  
  const [searching, setSearching] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [saving, setSaving] = useState(false);

  const formatCnpj = (val: string) => {
    const raw = val.replace(/\D/g, "");
    if (raw.length <= 14) {
      return raw
        .replace(/^(\d{2})(\d)/, "$1.$2")
        .replace(/^(\d{2})\.(\d{3})(\d)/, "$1.$2.$3")
        .replace(/\.(\d{3})(\d)/, ".$1/$2")
        .replace(/(\d{4})(\d)/, "$1-$2");
    }
    return val;
  };

  const handleCnpjChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setCnpjInput(formatCnpj(e.target.value));
  };

  const handleLookup = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanCnpj = cnpjInput.replace(/\D/g, "");
    if (cleanCnpj.length !== 14) {
      setErrorMsg("O CNPJ deve conter exatamente 14 dígitos.");
      return;
    }
    setSearching(true);
    setErrorMsg("");

    try {
      let data: any = null;
      let ok = false;
      
      try {
        const response = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${cleanCnpj}`);
        if (response.ok) {
          data = await response.json();
          ok = true;
        }
      } catch (e) {
        console.warn("[CNPJ Fetch] BrasilAPI bypassed:", e);
      }

      if (!ok) {
        // Try fallback with Speedio API
        try {
          const response = await fetch(`https://api-publica.speedio.com.br/buscarcnpj?cnpj=${cleanCnpj}`);
          if (response.ok) {
            const speedioData = await response.json();
            if (speedioData && !speedioData.error) {
              data = {
                nome_fantasia: speedioData["NOME FANTASIA"] || speedioData["RAZAO SOCIAL"],
                razao_social: speedioData["RAZAO SOCIAL"],
                ddd_telefone_1: speedioData["TELEFONE"] || ""
              };
              ok = true;
            }
          }
        } catch (e) {
          console.warn("[CNPJ Fetch] Speedio API bypassed:", e);
        }
      }

      if (ok && data) {
        if (data.razao_social || data.nome_fantasia) {
          setMeiName(data.nome_fantasia || data.razao_social);
          
          if (data.ddd_telefone_1) {
            const rawTel = data.ddd_telefone_1.replace(/\D/g, "");
            if (rawTel.length >= 10) {
              setTelefone(`(${rawTel.substring(0, 2)}) ${rawTel.substring(2, 6)}-${rawTel.substring(6)}`);
            } else {
              setTelefone(data.ddd_telefone_1);
            }
          } else {
            setTelefone("");
          }
          
          setStep(2); // Go to verification step
        } else {
          setErrorMsg("Dados obtidos incompletos, preencha manualmente.");
          setMeiName("");
          setTelefone("");
          setStep(2);
        }
      } else {
        // Set error message peacefully without writing to console.error
        setErrorMsg("CNPJ não localizado automaticamente nas bases federais. Digite os dados abaixo manualmente:");
        setMeiName("");
        setTelefone("");
        setStep(2);
      }
    } catch (err: any) {
      console.warn("[CNPJ Onboarding lookup bypassed gracefully (expected developer preview limit)]");
      setErrorMsg("CNPJ não encontrado nas bases públicas ou serviço temporariamente indisponível. Preencha manualmente para prosseguir.");
      setMeiName("");
      setTelefone("");
      setStep(2);
    } finally {
      setSearching(false);
    }
  };

  const handleFinalSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!meiName.trim()) {
      setErrorMsg("Insira a Razão Social ou Nome do Emissor.");
      return;
    }
    setSaving(true);
    try {
      await onSave(meiName.trim(), cnpjInput, inscricaoMunicipal, telefone);
    } catch (err) {
      console.error(err);
      setErrorMsg("Erro ao salvar perfil do MEI.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="w-full max-w-lg mx-auto bg-white rounded-3xl border border-slate-100 shadow-2xl overflow-hidden p-6 md:p-8 space-y-6 animate-fade-in my-10 relative">
      <div className="absolute top-0 right-0 p-4 opacity-5">
        <Building2 className="w-32 h-32 text-slate-900" />
      </div>

      {/* Header */}
      <div className="space-y-2 text-center relative z-10">
        <div className="inline-flex items-center gap-1 bg-blue-50 text-blue-600 font-bold text-[10px] uppercase tracking-widest px-3 py-1.5 rounded-full shadow-xs">
          <Sparkles className="w-3.5 h-3.5 text-blue-500 animate-pulse" />
          <span>Configuração Cadastral Inicial</span>
        </div>
        <h2 className="text-2xl md:text-3xl font-display font-light text-slate-900 tracking-tight">
          Pronto para decolar, <span className="font-semibold text-blue-600 truncate max-w-[200px] inline-block align-bottom">{userEmail.split("@")[0]}</span>? 🚀
        </h2>
        <p className="text-xs text-slate-400 max-w-md mx-auto leading-relaxed">
          Como criamos uma conta segura no Mei Flow, precisamos apenas do CNPJ do seu MEI para carregar seus dados e configurar todas as emissões automaticamente.
        </p>
      </div>

      {/* Steps indicator */}
      <div className="flex items-center justify-center gap-6 py-2">
        <div className="flex items-center gap-2">
          <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${step === 1 ? "bg-blue-600 text-white" : "bg-emerald-500 text-white"}`}>
            {step === 1 ? "1" : "✓"}
          </div>
          <span className={`text-[11px] font-bold ${step === 1 ? "text-slate-800" : "text-emerald-600"}`}>Buscar CNPJ</span>
        </div>
        <div className="h-px bg-slate-200 w-12"></div>
        <div className="flex items-center gap-2">
          <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${step === 2 ? "bg-blue-600 text-white" : "bg-slate-200 text-slate-500"}`}>
            2
          </div>
          <span className={`text-[11px] font-bold ${step === 2 ? "text-slate-800" : "text-slate-400"}`}>Confirmar Informações</span>
        </div>
      </div>

      {/* Main Forms */}
      {step === 1 ? (
        <form onSubmit={handleLookup} className="space-y-4 pt-2 relative z-10">
          <div className="space-y-1">
            <label className="block text-[10px] uppercase tracking-wider font-extrabold text-slate-500">
              Digite o CNPJ do seu MEI *
            </label>
            <div className="relative">
              <input
                required
                type="text"
                value={cnpjInput}
                onChange={handleCnpjChange}
                placeholder="00.000.000/0001-00"
                className="w-full bg-slate-50 border border-slate-200 hover:border-slate-300 text-slate-800 rounded-2xl py-3 px-4 text-sm font-mono focus:ring-2 focus:ring-blue-500/20 focus:outline-none focus:bg-white transition-all text-center tracking-widest"
              />
            </div>
          </div>

          {errorMsg && (
            <div className="p-3 bg-rose-50 border border-rose-100/50 rounded-xl flex gap-2 items-start text-rose-700 text-xs">
              <AlertCircle className="w-4 h-4 text-rose-500 shrink-0 mt-0.5" />
              <span>{errorMsg}</span>
            </div>
          )}

          <div className="flex flex-col gap-3 pt-2">
            <button
              type="submit"
              disabled={searching}
              className="w-full py-3 px-6 bg-blue-600 hover:bg-blue-700 text-white rounded-2xl text-xs font-bold transition-all shadow-md hover:shadow-lg flex items-center justify-center gap-2 disabled:opacity-50 cursor-pointer"
            >
              {searching ? (
                <div className="flex items-center gap-2">
                  <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                  <span>Localizando MEI no governo...</span>
                </div>
              ) : (
                <>
                  <span>Configurar Automaticamente</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </>
              )}
            </button>

            <button
              type="button"
              onClick={onSkipWithDemo}
              className="w-full py-2.5 bg-slate-50 hover:bg-slate-100 text-slate-500 border border-slate-200/50 rounded-2xl text-[10px] font-bold transition-all flex items-center justify-center gap-1.5 cursor-pointer"
            >
              <Play className="w-3 h-3 text-slate-400" />
              <span>Experimentar aplicativo com MEI de Demonstração</span>
            </button>
          </div>
        </form>
      ) : (
        <form onSubmit={handleFinalSave} className="space-y-4 pt-2 relative z-10">
          {errorMsg && (
            <div className="p-3 bg-rose-50 border border-rose-100/50 rounded-xl flex gap-2 items-start text-rose-700 text-xs text-left">
              <AlertCircle className="w-4 h-4 text-rose-500 shrink-0 mt-0.5" />
              <span>{errorMsg}</span>
            </div>
          )}

          <div className="p-4 bg-emerald-50/80 border border-emerald-100 rounded-2xl text-emerald-800 text-xs font-medium space-y-1 text-left">
            <div className="flex items-center gap-1 bg-emerald-100 px-2 py-0.5 rounded-full font-bold uppercase text-[8px] w-fit">
              <CheckCircle className="w-2.5 h-2.5" />
              <span>Dados consultados com sucesso</span>
            </div>
            <p className="text-[11px] leading-relaxed mt-1">
              Encontramos os detalhes do seu cadastro! Você pode ajustar os campos abaixo ou preenchê-los manualmente caso algo esteja incorreto.
            </p>
          </div>

          <div className="space-y-4 text-left">
            <div>
              <label className="block text-[9px] uppercase tracking-wider font-extrabold text-slate-500 mb-1">
                CNPJ do Emissor MEI
              </label>
              <input
                disabled
                type="text"
                value={cnpjInput}
                className="w-full bg-slate-100/70 border border-slate-200 text-slate-500 rounded-xl py-2 px-3 text-xs font-mono outline-none"
              />
            </div>

            <div>
              <label className="block text-[9px] uppercase tracking-wider font-extrabold text-slate-500 mb-1">
                Razão Social (Nome da Empresa) *
              </label>
              <input
                type="text"
                required
                value={meiName}
                onChange={(e) => setMeiName(e.target.value)}
                placeholder="Ex: João da Silva MEI"
                className="w-full bg-slate-50 border border-slate-200 text-slate-800 rounded-xl py-2 px-3 text-xs focus:ring-1 focus:ring-blue-500"
              />
            </div>

            <div>
              <label className="block text-[9px] uppercase tracking-wider font-extrabold text-slate-500 mb-1">
                Inscrição Municipal (Opcional)
              </label>
              <input
                type="text"
                value={inscricaoMunicipal}
                onChange={(e) => setInscricaoMunicipal(e.target.value)}
                placeholder="Ex: 12345-6 (Necessária para NFS-e)"
                className="w-full bg-slate-50 border border-slate-200 text-slate-800 rounded-xl py-2 px-3 text-xs font-mono focus:ring-1 focus:ring-blue-500"
              />
            </div>

            <div>
              <label className="block text-[9px] uppercase tracking-wider font-extrabold text-slate-500 mb-1">
                Telefone Comercial
              </label>
              <input
                type="text"
                value={telefone}
                onChange={(e) => setTelefone(e.target.value)}
                placeholder="Ex: (11) 99999-9999"
                className="w-full bg-slate-50 border border-slate-200 text-slate-800 rounded-xl py-2 px-3 text-xs font-mono focus:ring-1 focus:ring-blue-500"
              />
            </div>
          </div>

          <div className="flex gap-2.5 pt-2">
            <button
              type="button"
              onClick={() => setStep(1)}
              className="flex-1 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold transition-all cursor-pointer"
            >
              Voltar
            </button>
            <button
              type="submit"
              disabled={saving}
              className="flex-1 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold transition-all shadow-md flex items-center justify-center gap-1.5 disabled:opacity-50 cursor-pointer"
            >
              {saving ? (
                <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
              ) : (
                <>
                  <CheckCircle className="w-3.5 h-3.5" />
                  <span>Ativar Mei Flow</span>
                </>
              )}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
