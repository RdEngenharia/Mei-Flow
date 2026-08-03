/**
 * Asaas Finance Integration Service
 * 
 * Desenvolvido para: MEI Flow
 * Especializado em consultas de saldo de subconta e liquidação via Pix de valores para a conta do MEI.
 */

export interface AsaasBalanceResponse {
  balance: number;
}

export interface AsaasTransferPayload {
  value: number; // Valor a transferir (Mínimo recomendado pela integradora: R$ 5,00)
  pixAddressKey: string; // Chave Pix de destino (CPF, CNPJ, Email, Telefone, EVP)
  pixAddressKeyType: "CPF" | "CNPJ" | "EMAIL" | "PHONE" | "EVP"; // Tipo de chave Pix do recebedor
}

export interface AsaasTransferResponse {
  success: boolean;
  httpStatus: number;
  transferId?: string;
  pixTransactionId?: string;
  status?: string;
  fee?: number;
  error?: string;
  raw?: any;
}

/**
 * 1. CONSULTA DE SALDO DISPONÍVEL (GET /v3/finance/balance)
 * 
 * Obtém o saldo financeiro da subconta do MEI. Apenas o saldo líquido e disponível para saque/TED/Pix.
 * 
 * @param accessToken Chave de autenticação privada da subconta do MEI (Asaas API Token)
 * @param useProduction Toggle para definir se as chamadas atingirão o ambiente de produção
 */
export async function consultarSaldoAsaas(
  accessToken: string,
  useProduction: boolean = false
): Promise<{ success: boolean; balance: number; error?: string }> {
  const baseUrl = useProduction 
    ? "https://api.focusnfe.com.br/v1" // URL mock / ou Asaas normal
    : "https://sandbox.asaas.com/v3";
  
  // URL real do Asaas para saldo financeiro
  const actualUrl = useProduction
    ? "https://api.asaas.com/v3/finance/balance"
    : "https://sandbox.asaas.com/v3/finance/balance";

  if (!accessToken || accessToken.trim() === "") {
    return {
      success: false,
      balance: 0,
      error: "Token de acesso do Asaas não configurado ou inválido."
    };
  }

  try {
    const response = await fetch(actualUrl, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        "access_token": accessToken.trim()
      }
    });

    const status = response.status;
    const data = await response.json();

    if (status === 200) {
      return {
        success: true,
        balance: Number(data.balance || 0)
      };
    } else {
      return {
        success: false,
        balance: 0,
        error: data.errors?.[0]?.description || `Falha ao obter saldo (Status ${status})`
      };
    }
  } catch (error: any) {
    console.error("Erro ao consultar saldo no Asaas:", error);
    return {
      success: false,
      balance: 0,
      error: error.message || "Erro de rede ao conectar à API do Asaas."
    };
  }
}

/**
 * 2. TRANSFERÊNCIA E SAQUE VIA PIX (POST /v3/transfers)
 * 
 * Efetua a transferência de parte ou todo o saldo disponível de volta à conta real do MEI via Pix instantâneo.
 * Implementa validação estrita de segurança financeira no input (prevenção de saques nulos ou negativos).
 * 
 * @param accessToken Chave de autenticação privada da subconta do MEI (Asaas API Token)
 * @param payload Dados da transação (valor, chave pix, tipo de chave)
 * @param useProduction Toggle de sandbox/produção para o roteamento correto no Asaas
 */
export async function realizarTransferenciaPixAsaas(
  accessToken: string,
  payload: AsaasTransferPayload,
  useProduction: boolean = false
): Promise<AsaasTransferResponse> {
  const actualUrl = useProduction
    ? "https://api.asaas.com/v3/transfers"
    : "https://sandbox.asaas.com/v3/transfers";

  // --- TRATATIVA DE SEGURANÇA FISCAL E FINANCEIRA ---
  if (!accessToken || accessToken.trim() === "") {
    return { success: false, httpStatus: 401, error: "Chave do Asaas ausente." };
  }

  if (payload.value <= 1.0) {
    return {
      success: false,
      httpStatus: 400,
      error: "O valor mínimo de saque Pix permitido é de R$ 1,00 para garantir a cobertura operacional."
    };
  }

  // Higieniza chaves Pix de telefone e documentos para manter integridade no Asaas
  let cleanedPixKey = payload.pixAddressKey.trim();
  if (payload.pixAddressKeyType === "CPF" || payload.pixAddressKeyType === "CNPJ") {
    cleanedPixKey = cleanedPixKey.replace(/\D/g, ""); // Apenas números para chaves CPF/CNPJ
  }

  // Corpo da requisição da API de Transferência do Asaas (Saque Pix para Chave Pix de outra instituição)
  const bodyData = {
    value: payload.value,
    pixAddressKey: cleanedPixKey,
    pixAddressKeyType: payload.pixAddressKeyType,
    operationType: "PIX" // Define saques instantâneos via Pix
  };

  try {
    const response = await fetch(actualUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "access_token": accessToken.trim()
      },
      body: JSON.stringify(bodyData)
    });

    const status = response.status;
    const data = await response.json();

    if (status === 200 || status === 201) {
      return {
        success: true,
        httpStatus: status,
        transferId: data.id,
        pixTransactionId: data.transactionReceiptUrl || data.endToEndIdentifier,
        status: data.status || "PENDING",
        fee: data.transferFee || 0,
        raw: data
      };
    } else {
      return {
        success: false,
        httpStatus: status,
        error: data.errors?.[0]?.description || `Erro operacional ${status} ao requisitar transferência.`,
        raw: data
      };
    }
  } catch (error: any) {
    console.error("Erro ao executar transferência Pix:", error);
    return {
      success: false,
      httpStatus: 500,
      error: error.message || "Exceção de timeout ou falha de conexão com a API do Asaas."
    };
  }
}
