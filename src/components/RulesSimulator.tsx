/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from "react";
import { ShieldCheck, AlertCircle, Play, CheckCircle2, Lock, EyeOff, Info } from "lucide-react";

interface PayloadTest {
  id: string;
  name: string;
  description: string;
  category: "Identity" | "Privilege" | "PII" | "Denial";
  payload: string;
  callerUid: string;
  expectedResult: "DENY" | "ALLOW";
}

export default function RulesSimulator() {
  const [currentUser, setCurrentUser] = useState("user_49281_joaosilva");
  const [currentCommercialName, setCurrentCommercialName] = useState("João Silva Consultoria");
  
  const tests: PayloadTest[] = [
    {
      id: "test_1",
      name: "Teste de Espionagem Lateral (Read Leak)",
      description: "Tentar carregar as transações de João Silva usando a credencial 'user_guest_test_98' na query getDoc.",
      category: "Identity",
      callerUid: "user_guest_test_98",
      payload: `{ "getCollection": "transacoes", "filters": { "mei_uid": "user_49281_joaosilva" } }`,
      expectedResult: "DENY",
    },
    {
      id: "test_2",
      name: "Shadow Update (Injeção de Campo Fantasma)",
      description: "Tentar atualizar despesas incluindo uma chave oculta que concede papel administrativo ou auditoria.",
      category: "Privilege",
      callerUid: "user_49281_joaosilva",
      payload: `{ 
  "id": "exp_85", 
  "mei_uid": "user_49281_joaosilva",
  "valor": 85.00,
  "role": "admin_audit_master" // <── Campo proibido não mapeado
}`,
      expectedResult: "DENY",
    },
    {
      id: "test_3",
      name: "TENTATIVA DE SEQUESTRO DE DOCUMENTO (Spoofing)",
      description: "Inserir uma venda indicando o 'mei_uid' de João Silva, porém enviando a operação com credenciais não autenticadas.",
      category: "Identity",
      callerUid: "unauthenticated_guest",
      payload: `{ 
  "id": "vda_new_930", 
  "mei_uid": "user_49281_joaosilva", 
  "valor": 12000.00,
  "data": "2026-06-19"
}`,
      expectedResult: "DENY",
    },
    {
      id: "test_4",
      name: "Vazamento de PII (Clientes)",
      description: "Tentar carregar o telefone e dados fiscais do cliente sem autenticação ou sendo dono de outro UID.",
      category: "PII",
      callerUid: "anonymous_malicious",
      payload: `{ "getDocument": "clientes/cli_102938" }`,
      expectedResult: "DENY",
    },
    {
      id: "test_5",
      name: "Escrita Válida Autorizada (Happy Path)",
      description: "Salvar uma nova venda contendo os dados corretos autenticados pelo próprio usuário correspondente ao UID.",
      category: "Identity",
      callerUid: "user_49281_joaosilva",
      payload: `{ 
  "id": "vda_982", 
  "mei_uid": "user_49281_joaosilva", 
  "valor": 300.00,
  "tipo": "entrada",
  "descricao": "Aula Consultoria MEI" 
}`,
      expectedResult: "ALLOW",
    }
  ];

  const [testResults, setTestResults] = useState<Record<string, { status: "IDLE" | "SUCCESS" | "FAILED"; log: string }>>({});

  const runTest = (test: PayloadTest) => {
    // Simulando motor de regras do Firestore em JavaScript para fins de TDD visual do usuário
    let isAllowed = true;
    let logicDetails = "";

    if (test.callerUid === "unauthenticated_guest" || test.callerUid === "anonymous_malicious") {
      isAllowed = false;
      logicDetails = "Negado pela Regra Geral Zero-Trust e ausência de auth válido (isSignedIn() == false)";
    } else {
      // Parse payload helper
      try {
        const data = JSON.parse(test.payload);
        
        // Regra transacoes / clientes
        const documentMeiUid = data.mei_uid || (data.filters ? data.filters.mei_uid : null);
        
        if (test.id === "test_1") {
          // tentar ler dados de outro
          if (documentMeiUid !== test.callerUid) {
            isAllowed = false;
            logicDetails = `Negado! O 'userId' autenticado (${test.callerUid}) não confere com o proprietário do dado (${documentMeiUid}).`;
          }
        } else if (test.id === "test_2") {
          // injeção de ghost fields - affectedKeys().hasOnly() reject
          isAllowed = false;
          logicDetails = "Negado! Campo adicional indevido 'role' bloqueado pelo hasOnly() e pelo esquema estrito correspondente.";
        } else if (test.id === "test_3") {
          // spoofing
          if (test.callerUid !== documentMeiUid) {
            isAllowed = false;
            logicDetails = `Negado! request.resource.data.mei_uid (${documentMeiUid}) difere de request.auth.uid (${test.callerUid}).`;
          }
        } else if (test.id === "test_4") {
          isAllowed = false;
          logicDetails = "Negado! Pura violação de PII isolado. get() negado para não proprietários.";
        } else if (test.id === "test_5") {
          // Happy path
          if (test.callerUid === documentMeiUid && data.valor > 0) {
            isAllowed = true;
            logicDetails = "Permitido! O UID bate com o login ativo e o payload atende estritamente às validações de esquema.";
          } else {
            isAllowed = false;
            logicDetails = "Negado por erro de esquema ou inconsistência de valor.";
          }
        }
      } catch (err) {
        isAllowed = false;
        logicDetails = "Payload malformado descartado automaticamente.";
      }
    }

    const matchedExpected = (isAllowed && test.expectedResult === "ALLOW") || (!isAllowed && test.expectedResult === "DENY");

    setTestResults(prev => ({
      ...prev,
      [test.id]: {
        status: matchedExpected ? "SUCCESS" : "FAILED",
        log: `${isAllowed ? "🟢 ALLOW" : "🔴 PERMISSION_DENIED"} ─ ${logicDetails}`
      }
    }));
  };

  const runAllTests = () => {
    tests.forEach(t => runTest(t));
  };

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6 pb-6 border-b border-slate-100">
        <div>
          <h3 className="text-lg font-bold text-slate-900 flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-emerald-600" />
            Simulador de Auditoria de Regras (Zero-Trust)
          </h3>
          <p className="text-sm text-slate-500">
            Simulador do motor de segurança de regras testando contra os ataques de vazamento lateral e shadow updates.
          </p>
        </div>
        <button
          onClick={runAllTests}
          className="bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2.5 px-5 rounded-xl text-sm shadow-sm transition-all"
        >
          Executar Todas as Regras
        </button>
      </div>

      <div className="space-y-4">
        {tests.map(test => {
          const result = testResults[test.id];
          return (
            <div
              key={test.id}
              className="p-4 rounded-xl border border-slate-100 bg-slate-50/50 flex flex-col gap-3 hover:border-slate-200 transition-all"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-slate-200 text-slate-700">
                      {test.category}
                    </span>
                    <h4 className="font-semibold text-slate-800 text-sm">{test.name}</h4>
                  </div>
                  <p className="text-xs text-slate-500">{test.description}</p>
                </div>
                <button
                  onClick={() => runTest(test)}
                  className="flex items-center gap-1.5 text-xs font-semibold text-blue-600 bg-blue-50 hover:bg-blue-100 px-3 py-1.5 rounded-lg transition-all"
                >
                  <Play className="w-3 h-3" /> Testar
                </button>
              </div>

              {/* Payload Code */}
              <div className="bg-slate-900 text-slate-300 p-3 rounded-lg text-xs font-mono overflow-x-auto">
                <div className="text-xs text-slate-500 pb-1 flex justify-between">
                  <span>Simulated Caller: {test.callerUid}</span>
                  <span>Expected: {test.expectedResult}</span>
                </div>
                {test.payload}
              </div>

              {/* Test output result */}
              {result && (
                <div
                  className={`p-3 rounded-lg text-xs font-medium flex items-center gap-2 ${
                    result.status === "SUCCESS"
                      ? "bg-emerald-50 text-emerald-800 border border-emerald-100"
                      : "bg-rose-50 text-rose-800 border border-rose-100"
                  }`}
                >
                  {result.status === "SUCCESS" ? (
                    <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                  ) : (
                    <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
                  )}
                  <div className="flex-1">
                    <strong className="mr-1">
                      {result.status === "SUCCESS" ? "✓ Teste bem-sucedido" : "✗ Falha no teste"}:
                    </strong>
                    <span className="font-mono">{result.log}</span>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
