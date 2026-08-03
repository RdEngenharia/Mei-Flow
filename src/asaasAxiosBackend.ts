import axios, { AxiosError } from "axios";

/**
 * Interface que representa a resposta de saldo emitida pela API v3 do Asaas.
 */
export interface AsaasBalance {
  balance: number;
}

/**
 * SERVIÇO DE CONEXÃO E AUTENTICAÇÃO SEGURA COM ASAAS API V3
 * (Focado em ambientes de produção backend Node.js)
 * 
 * Requisitos de Segurança Atendidos:
 * 1. Isolamento de credenciais via variáveis de ambiente (process.env.ASAAS_API_KEY).
 * 2. Headers de autenticação em conformidade com as regras de subcontas e conta raiz do Asaas (access_token).
 * 3. Tratamento estrito de erros transacionais e de rede com Axios para capturar falhas de integridade.
 * 
 * @returns {Promise<number>} Retorna o saldo disponível líquido para transferência.
 */
export async function obterSaldoProducaoAsaas(): Promise<number> {
  // 1. CARREGAMENTO E VALIDAÇÃO DA CREDENCIAL PRIVADA
  // O token de acesso NUNCA deve ser exposto diretamente no código estático.
  const asaasToken = process.env.ASAAS_API_KEY;

  if (!asaasToken) {
    throw new Error(
      "IMPOSSÍVEL PROSSEGUIR: A variável de ambiente 'ASAAS_API_KEY' não está configurada no servidor. " +
      "Defina-a nas configurações de ambiente antes de realizar chamadas financeiras."
    );
  }

  // 2. ENDPOINT OFICIAL DE CONSULTA EM PRODUÇÃO (API v3)
  const productionUrl = "https://api.asaas.com/v3/finance/balance";

  try {
    // 3. EXECUÇÃO DA REQUISIÇÃO AXIOS COM HEADERS DE SEGURANÇA
    const response = await axios.get<AsaasBalance>(productionUrl, {
      headers: {
        "Content-Type": "application/json",
        // O Asaas exige a autenticação através do header 'access_token'
        "access_token": asaasToken.trim(),
      },
      // Timeout de 10 segundos para prevenir conexões pendentes em background (Hanging requests)
      timeout: 10000, 
    });

    // 4. RETORNO DO ATRIBUTO DE SALDO CONVERTIDO E VALIDADO
    if (response.data && typeof response.data.balance === "number") {
      return response.data.balance;
    }

    throw new Error("Formato de resposta inesperado da API do Asaas.");

  } catch (error: any) {
    // 5. TRATAMENTO CRÍTICO E IDENTIFICAÇÃO DE ERROS DE CONEXÃO OU CREDENCIAL
    if (axios.isAxiosError(error)) {
      const axiosError = error as AxiosError<any>;
      const status = axiosError.response?.status;
      const responseData = axiosError.response?.data;

      // Log detalhado e mascarado no servidor para debug sem vazar credenciais
      console.error(`[SAÍDA ASAAS ERROR] HTTP Status: ${status || "N/A"}`);

      if (status === 401) {
        throw new Error(
          "Não autorizado (401): O Token de API fornecido é inválido, expirou ou não possui privilégios de produção."
        );
      }

      if (status === 400 || status === 403) {
        const errorDescription = responseData?.errors?.[0]?.description || "Acesso recusado.";
        throw new Error(`Erro operacional Asaas (${status}): ${errorDescription}`);
      }
      
      const serverMsg = responseData?.errors?.[0]?.description || axiosError.message;
      throw new Error(`Falha de comunicação com gateway de pagamento Asaas: ${serverMsg}`);
    }

    // Erros genéricos de código ou runtime
    console.error("Exceção imprevista de controle financeiro:", error);
    throw new Error(`Exceção interna do servidor: ${error.message || error}`);
  }
}
