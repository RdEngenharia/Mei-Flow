import React, { useState } from "react";
import { X, Building, Check, Search, Sparkles, KeyRound, ChevronRight } from "lucide-react";

export interface DadosEndereco {
  cep?: string;
  logradouro?: string;
  numero?: string;
  bairro?: string;
  cidade?: string;
  uf?: string;
}

export interface DadosDaEmpresa {
  name: string;
  cnpj: string;
  inscricao: string;
  telefone: string;
  email: string;
  endereco: DadosEndereco;
  logo?: string;
}

interface MeiConfigModalProps {
  currentName: string;
  currentCnpj: string;
  currentInscricao: string;
  currentTelefone: string;
  currentEmail: string;
  currentEndereco: DadosEndereco;
  planType: "free" | "premium";
  companyLogo: string;
  onClose: () => void;
  /**
   * ⚠️ ASSINATURA EM OBJETO, DE PROPÓSITO.
   *
   * Era uma lista de cinco argumentos posicionais. Acrescentar endereço e
   * e-mail deixaria nove, e trocar dois de lugar por engano gravaria o CEP no
   * campo do telefone sem nenhum erro de compilação. Objeto nomeado não tem
   * esse risco e não obriga a mexer aqui de novo no próximo campo.
   */
  onSave: (dados: DadosDaEmpresa) => Promise<void>;
  onTriggerUpgrade: () => void;
  onOpenChangePassword: () => void;
}

export default function MeiConfigModal({
  currentName,
  currentCnpj,
  currentInscricao,
  currentTelefone,
  currentEmail,
  currentEndereco,
  planType,
  companyLogo,
  onClose,
  onSave,
  onTriggerUpgrade,
  onOpenChangePassword,
}: MeiConfigModalProps) {
  const [name, setName] = useState(currentName);
  const [cnpj, setCnpj] = useState(currentCnpj);
  const [inscricao, setInscricao] = useState(currentInscricao);
  const [telefone, setTelefone] = useState(currentTelefone);
  const [email, setEmail] = useState(currentEmail || "");
  /**
   * ENDEREÇO DA EMPRESA.
   *
   * Faltava por completo — e por isso não saía nem no orçamento nem em lugar
   * nenhum. Um orçamento sem o endereço de quem está propondo passa a impressão
   * de improviso, ainda mais em obra, onde o cliente quer saber onde a empresa
   * fica.
   */
  const [cep, setCep] = useState(currentEndereco?.cep || "");
  const [logradouro, setLogradouro] = useState(currentEndereco?.logradouro || "");
  const [numero, setNumero] = useState(currentEndereco?.numero || "");
  const [bairro, setBairro] = useState(currentEndereco?.bairro || "");
  const [cidade, setCidade] = useState(currentEndereco?.cidade || "");
  const [uf, setUf] = useState(currentEndereco?.uf || "");
  const [logoBase64, setLogoBase64] = useState(companyLogo);
  const [loading, setLoading] = useState(false);
  const [searchingCnpj, setSearchingCnpj] = useState(false);
  const [searchError, setSearchError] = useState("");

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (file.size > 2 * 1024 * 1024) {
        alert("A imagem de logo deve possuir menos de 2 MB.");
        return;
      }
      const reader = new FileReader();
      reader.onloadend = () => {
        if (typeof reader.result === "string") {
          setLogoBase64(reader.result);
        }
      };
      reader.readAsDataURL(file);
    }
  };

  const handleLookupCnpj = async () => {
    const cleaned = cnpj.replace(/\D/g, "");
    if (cleaned.length !== 14) {
      setSearchError("Por favor, digite um CNPJ válido com 14 dígitos.");
      return;
    }
    setSearchingCnpj(true);
    setSearchError("");

    try {
      // Consulta via rota própria do backend (em vez de chamar BrasilAPI/Speedio
      // diretamente do navegador), porque dentro do APK (Capacitor) a origem
      // "https://localhost" é bloqueada pelo CORS dessas APIs externas, sobre o
      // qual não temos controle. Nossa rota faz essa consulta servidor-a-servidor.
      const isNative = typeof window !== "undefined" && !!(window as any).Capacitor?.isNativePlatform?.();
      const apiBase = isNative ? "https://meiflow.rdhomologacao.com.br" : window.location.origin;
      const response = await fetch(`${apiBase}/api/cnpj/lookup?cnpj=${cleaned}`);
      const data = await response.json();

      if (response.ok && data.success) {
        const finalName = data.nome_fantasia || data.razao_social;
        if (finalName) {
          setName(finalName);
        }
        if (data.ddd_telefone_1) {
          const rawTel = data.ddd_telefone_1.replace(/\D/g, "");
          if (rawTel.length >= 10) {
            setTelefone(`(${rawTel.substring(0, 2)}) ${rawTel.substring(2, 6)}-${rawTel.substring(6)}`);
          } else {
            setTelefone(data.ddd_telefone_1);
          }
        }
        /**
         * A consulta do CNPJ já devolve o endereço completo. Antes ele era
         * jogado fora: só nome e telefone eram aproveitados, e o usuário
         * digitava o resto à mão — ou, como aconteceu, não digitava.
         */
        if (data.logradouro) setLogradouro(String(data.logradouro));
        if (data.numero) setNumero(String(data.numero));
        if (data.bairro) setBairro(String(data.bairro));
        if (data.municipio || data.cidade) setCidade(String(data.municipio || data.cidade));
        if (data.uf) setUf(String(data.uf).toUpperCase().slice(0, 2));
        if (data.cep) {
          const c = String(data.cep).replace(/\D/g, "");
          setCep(c.length === 8 ? `${c.slice(0, 5)}-${c.slice(5)}` : String(data.cep));
        }
        if (data.email) setEmail(String(data.email).toLowerCase());

        if (!finalName) {
          setSearchError("Dados obtidos incompletos, preencha manualmente.");
        }
      } else {
        setSearchError("Não foi possível buscar automaticamente. Por favor, digite os dados abaixo.");
      }
    } catch (err: any) {
      console.warn("[MeiConfig lookup bypassed gracefully]");
      setSearchError("Não foi possível buscar automaticamente. Por favor, digite os dados abaixo.");
    } finally {
      setSearchingCnpj(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    await onSave({
      name, cnpj, inscricao, telefone, email,
      endereco: { cep, logradouro, numero, bairro, cidade, uf },
      logo: logoBase64,
    });
    setLoading(false);
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-start sm:items-center justify-center p-4 overflow-y-auto">
      <div className="bg-white rounded-2xl max-w-sm w-full shadow-2xl border border-slate-200 overflow-hidden text-left flex flex-col my-auto">
        {/* Header */}
        <div className="pt-safe px-6 pb-4 bg-slate-900 text-white flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Building className="w-4 h-4 text-blue-400" />
            <h3 className="font-bold text-xs tracking-tight uppercase">Configurações do MEI</h3>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white p-1 rounded font-bold text-sm cursor-pointer"
          >
            âœ•
          </button>
        </div>

        {/* Content */}
        <form onSubmit={handleSubmit} className="p-6 space-y-4 max-h-[80vh] overflow-y-auto">
          <p className="text-[11px] text-slate-500 leading-relaxed font-medium">
            Preencha os dados do seu CNPJ MEI. Estas informações são utilizadas para a identificação da sua atividade em recibos, relatórios e emissões de notas fiscais.
          </p>

          {/* AUTO LOOKUP CNPJ PANEL */}
          <div className="p-3 bg-gradient-to-br from-blue-50 to-indigo-50 border border-blue-100/60 rounded-xl space-y-2">
            <div className="flex items-center gap-1.5 text-blue-800 font-bold text-[10px] uppercase tracking-wide">
              <Sparkles className="w-3.5 h-3.5 text-blue-600 animate-pulse" />
              <span>Consulta de CNPJ Automática</span>
            </div>
            
            <div className="flex gap-1.5">
              <input
                type="text"
                value={cnpj}
                onChange={(e) => setCnpj(e.target.value)}
                placeholder="Digite o CNPJ"
                className="flex-1 bg-white border border-blue-200 text-slate-800 rounded-lg px-2.5 py-1.5 text-xs focus:ring-1 focus:ring-blue-500 focus:outline-none font-mono"
              />
              <button
                type="button"
                onClick={handleLookupCnpj}
                disabled={searchingCnpj}
                className="bg-blue-600 hover:bg-blue-700 text-white font-bold px-3 rounded-lg text-xs flex items-center gap-1 transition-all disabled:opacity-50 cursor-pointer"
              >
                {searchingCnpj ? (
                  <div className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                ) : (
                  <>
                    <Search className="w-3 h-3" />
                    <span>Buscar</span>
                  </>
                )}
              </button>
            </div>
            
            {searchError ? (
              <p className="text-[9px] text-rose-500 font-bold leading-tight">{searchError}</p>
            ) : (
              <p className="text-[9px] text-slate-400 font-medium leading-tight">
                Insira apenas números e clique em buscar para preencher Razão Social e Telefone de forma instantânea.
              </p>
            )}
          </div>

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

          {/* ENDEREÇO DA EMPRESA — sai no orçamento e nos documentos */}
          <div className="pt-2 border-t border-slate-100 space-y-2">
            <label className="block text-[9px] uppercase tracking-wider font-extrabold text-slate-500">
              Endereço da empresa
            </label>

            <div className="grid grid-cols-3 gap-2">
              <input
                type="text" value={cep} onChange={(e) => setCep(e.target.value)}
                placeholder="CEP"
                className="w-full bg-slate-50 border border-slate-200 text-slate-800 rounded-xl py-2 px-3 text-xs focus:ring-1 focus:ring-blue-500 focus:outline-none focus:bg-white font-mono"
              />
              <input
                type="text" value={logradouro} onChange={(e) => setLogradouro(e.target.value)}
                placeholder="Rua / Avenida"
                className="col-span-2 w-full bg-slate-50 border border-slate-200 text-slate-800 rounded-xl py-2 px-3 text-xs focus:ring-1 focus:ring-blue-500 focus:outline-none focus:bg-white"
              />
            </div>

            <div className="grid grid-cols-3 gap-2">
              <input
                type="text" value={numero} onChange={(e) => setNumero(e.target.value)}
                placeholder="Número"
                className="w-full bg-slate-50 border border-slate-200 text-slate-800 rounded-xl py-2 px-3 text-xs focus:ring-1 focus:ring-blue-500 focus:outline-none focus:bg-white font-mono"
              />
              <input
                type="text" value={bairro} onChange={(e) => setBairro(e.target.value)}
                placeholder="Bairro"
                className="col-span-2 w-full bg-slate-50 border border-slate-200 text-slate-800 rounded-xl py-2 px-3 text-xs focus:ring-1 focus:ring-blue-500 focus:outline-none focus:bg-white"
              />
            </div>

            <div className="grid grid-cols-4 gap-2">
              <input
                type="text" value={cidade} onChange={(e) => setCidade(e.target.value)}
                placeholder="Cidade"
                className="col-span-3 w-full bg-slate-50 border border-slate-200 text-slate-800 rounded-xl py-2 px-3 text-xs focus:ring-1 focus:ring-blue-500 focus:outline-none focus:bg-white"
              />
              <input
                type="text" value={uf} maxLength={2}
                onChange={(e) => setUf(e.target.value.toUpperCase().replace(/[^A-Z]/g, ""))}
                placeholder="UF"
                className="w-full bg-slate-50 border border-slate-200 text-slate-800 rounded-xl py-2 px-3 text-xs focus:ring-1 focus:ring-blue-500 focus:outline-none focus:bg-white font-mono uppercase"
              />
            </div>

            <input
              type="email" value={email} onChange={(e) => setEmail(e.target.value)}
              placeholder="E-mail comercial"
              className="w-full bg-slate-50 border border-slate-200 text-slate-800 rounded-xl py-2 px-3 text-xs focus:ring-1 focus:ring-blue-500 focus:outline-none focus:bg-white"
            />

            <p className="text-[9px] text-slate-400 leading-relaxed">
              Aparece no cabeçalho dos seus orçamentos. Buscar pelo CNPJ acima já preenche tudo isto.
            </p>
          </div>

          {/* LOGOTIPO DA EMPRESA */}
          <div className="pt-2 border-t border-slate-100">
            <label className="block text-[9px] uppercase tracking-wider font-extrabold text-slate-500 mb-1 flex items-center justify-between">
              <span>Logotipo da Empresa {planType === "free" ? "🔒" : ""}</span>
              {planType === "free" && (
                <span className="text-[8px] text-blue-600 font-bold lowercase bg-blue-50 px-1.5 py-0.5 rounded-full">premium</span>
              )}
            </label>
            
            {planType === "free" ? (
              <div 
                onClick={onTriggerUpgrade}
                className="w-full bg-slate-50 border border-dashed border-slate-200 text-slate-400 rounded-xl py-3 px-3 text-center text-xs cursor-pointer hover:bg-blue-50/50 hover:border-blue-200 transition-all flex flex-col items-center gap-1"
                id="logo-upload-locked-trigger"
              >
                <div className="font-bold text-xs text-slate-600">🔒 Configurar Logo Personalizada</div>
                <div className="text-[9px] text-slate-400">Exclusivo para usuários Premium</div>
              </div>
            ) : (
              <div className="space-y-2">
                {logoBase64 ? (
                  <div className="flex items-center gap-3 bg-slate-50 border border-slate-200 p-2.5 rounded-xl">
                    <img src={logoBase64} alt="Logotipo" className="h-10 w-10 object-contain rounded-md bg-white border border-slate-100" />
                    <div className="flex-1 min-w-0 text-left">
                      <p className="text-[10px] text-slate-400 truncate font-semibold">Logo Configurada</p>
                      <button 
                        type="button" 
                        onClick={() => setLogoBase64("")}
                        className="text-[9px] text-rose-500 font-bold hover:underline"
                      >
                        Remover Logo
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="relative">
                    <input
                      type="file"
                      accept="image/png, image/jpeg, image/jpg"
                      onChange={handleFileChange}
                      className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                    />
                    <div className="w-full bg-slate-50 border border-dashed border-slate-200 text-slate-500 rounded-xl py-3 px-3 text-center text-xs hover:bg-slate-100/50 transition-all cursor-pointer">
                      Selecione um arquivo PNG ou JPG
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* SEGURANÇA DA CONTA */}
          <div className="pt-2 border-t border-slate-100">
            <label className="block text-[9px] uppercase tracking-wider font-extrabold text-slate-500 mb-1">
              Segurança da Conta
            </label>
            <button
              type="button"
              onClick={onOpenChangePassword}
              className="w-full bg-slate-50 hover:bg-slate-100 border border-slate-200 text-slate-700 rounded-xl py-2.5 px-3 text-xs font-bold transition-all cursor-pointer flex items-center justify-between"
            >
              <span className="flex items-center gap-2">
                <KeyRound className="w-3.5 h-3.5 text-slate-500" />
                <span>Alterar Senha</span>
              </span>
              <ChevronRight className="w-3.5 h-3.5 text-slate-400" />
            </button>
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

