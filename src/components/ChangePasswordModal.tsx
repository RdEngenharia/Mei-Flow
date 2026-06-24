import React, { useState } from "react";
import { KeyRound, Check, AlertCircle, CheckCircle2 } from "lucide-react";

interface ChangePasswordModalProps {
  onClose: () => void;
  onChangePassword: (currentPassword: string, newPassword: string) => Promise<void>;
}

export default function ChangePasswordModal({
  onClose,
  onChangePassword,
}: ChangePasswordModalProps) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (!currentPassword || !newPassword || !confirmPassword) {
      setError("Por favor, preencha todos os campos.");
      return;
    }
    if (newPassword.length < 6) {
      setError("A nova senha deve ter pelo menos 6 caracteres.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("A nova senha e a confirmação não coincidem.");
      return;
    }

    setLoading(true);
    try {
      await onChangePassword(currentPassword, newPassword);
      setSuccess(true);
    } catch (err: any) {
      console.error(err);
      let errMsg = "Não foi possível alterar a senha. Tente novamente.";
      if (err.code === "auth/wrong-password" || err.code === "auth/invalid-credential") {
        errMsg = "A senha atual está incorreta.";
      } else if (err.code === "auth/weak-password") {
        errMsg = "A nova senha é fraca. Digite pelo menos 6 caracteres.";
      } else if (err.code === "auth/too-many-requests") {
        errMsg = "Muitas tentativas. Aguarde um momento e tente novamente.";
      } else if (err.message) {
        errMsg = err.message;
      }
      setError(errMsg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl max-w-sm w-full shadow-2xl border border-slate-200 overflow-hidden text-left flex flex-col">
        {/* Header */}
        <div className="pt-safe px-6 pb-4 bg-slate-900 text-white flex items-center justify-between">
          <div className="flex items-center gap-2">
            <KeyRound className="w-4 h-4 text-blue-400" />
            <h3 className="font-bold text-xs tracking-tight uppercase">Alterar Senha</h3>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white p-1 rounded font-bold text-sm cursor-pointer"
          >
            ✕
          </button>
        </div>

        {/* Conteúdo */}
        {success ? (
          <div className="p-6 space-y-4 text-center">
            <CheckCircle2 className="w-10 h-10 text-emerald-500 mx-auto" />
            <p className="text-xs text-slate-600 leading-relaxed">
              Sua senha foi alterada com sucesso.
            </p>
            <button
              type="button"
              onClick={onClose}
              className="w-full py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold transition-all shadow-sm cursor-pointer"
            >
              Fechar
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="p-6 space-y-4">
            <p className="text-[11px] text-slate-500 leading-relaxed font-medium">
              Por segurança, confirme sua senha atual antes de definir uma nova.
            </p>

            {error && (
              <div className="p-3 bg-red-50 text-red-700 text-xs rounded-xl flex items-center gap-2 border border-red-100">
                <AlertCircle className="w-4 h-4 shrink-0 text-red-500" />
                <span>{error}</span>
              </div>
            )}

            <div>
              <label className="block text-[10px] uppercase tracking-wider font-extrabold text-slate-500 mb-1">
                Senha Atual *
              </label>
              <input
                type="password"
                required
                placeholder="Digite sua senha atual"
                value={currentPassword}
                onFocus={() => setError("")}
                onChange={(e) => setCurrentPassword(e.target.value)}
                className="w-full bg-slate-50 border border-slate-200 text-slate-800 rounded-xl py-2 px-3 text-xs focus:ring-1 focus:ring-blue-500 focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-[10px] uppercase tracking-wider font-extrabold text-slate-500 mb-1">
                Nova Senha *
              </label>
              <input
                type="password"
                required
                placeholder="Mínimo 6 caracteres"
                value={newPassword}
                onFocus={() => setError("")}
                onChange={(e) => setNewPassword(e.target.value)}
                className="w-full bg-slate-50 border border-slate-200 text-slate-800 rounded-xl py-2 px-3 text-xs focus:ring-1 focus:ring-blue-500 focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-[10px] uppercase tracking-wider font-extrabold text-slate-500 mb-1">
                Confirmar Nova Senha *
              </label>
              <input
                type="password"
                required
                placeholder="Repita a nova senha"
                value={confirmPassword}
                onFocus={() => setError("")}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="w-full bg-slate-50 border border-slate-200 text-slate-800 rounded-xl py-2 px-3 text-xs focus:ring-1 focus:ring-blue-500 focus:outline-none"
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
                    <span>Salvar Nova Senha</span>
                  </>
                )}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
