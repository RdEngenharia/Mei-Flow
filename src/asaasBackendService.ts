import axios, { AxiosError } from "axios";
import { doc, setDoc } from "firebase/firestore";
import { db } from "./firebase";

/**
 * Interface que representa os detalhes cadastrais necessários do MEI
 * para a criação automatizada de uma subconta no Asaas v3.
 */
export interface CadastroSubcontaAsaasPayload {
  name: string;          // Razão social ou nome fantasia do MEI
  email: string;         // Email principal para notificações
  cpfCnpj: string;       // CNPJ ou CPF (apenas números para envio limpo)
  phone?: string;        // Telefone fixo (opcional)
  mobilePhone: string;   // Celular para autorizações e validações (com DDD)
  postalCode: string;    // CEP do endereço empresarial (apenas números)
  address: string;       // Logradouro (Rua, Av, etc)
  addressNumber: string; // Número do imóvel
  complement?: string;   // Complemento de endereço (opcional)
  province: string;      // Bairro
}

/**
 * Interface que espelha os dados retornados com sucesso pela API v3 do Asaas
 * no momento da criação de subcontas.
 */
export interface AsaasSubaccountResponse {
  id: string;            // O ID identificador da subconta (conhecido como walletId)
  name: string;          // Nome ou razão social
  email: string;         // Email
  loginEmail: string;    // Email de login
  cpfCnpj: string;       // CPF/CNPJ limpo
  apiKey: string;        // Chave de API exclusiva e definitiva gerada para esse MEI
  walletId: string;      // Identificador financeiro (redundante ao ID principal)
}

/**
 * Interface padronizada de erro emitido pelo Asaas
 */
interface AsaasApiError {
  code: string;
  description: string;
}

/**
 * FUNÇÃO DE BACKEND (Node.js): Criar Subconta MEI no Asaas & Atualizar status no Firestore
 * 
 * Requisitos de segurança e integridade atendidos:
 * 1. Leitura segura e proteção de credencial mestre via `process.env.ASAAS_API_KEY`.
 * 2. Limpeza/Sanitização de dados cadastrais sensíveis (ex: CPF/CNPJ, CEP).
 * 3. Disparo POST oficial para a API v3 do Asaas (/v3/accounts).
 * 4. Persistência transacional atômica no Firestore para assegurar o isolamento do MEI.
 * 5. Tratamento de erro detalhado com mapeamento amigável para o usuário final.
 * 
 * @param userId ID exclusivo do usuário no Firebase Firestore
 * @param dadosCadastro Payload de captação cadastral do MEI
 * @param useProduction Controla o envio entre Sandbox ou API Real de Produção
 */
export async function criarSubcontaAsaas(
  userId: string,
  dadosCadastro: CadastroSubcontaAsaasPayload,
  useProduction: boolean = false
): Promise<{ success: boolean; walletId?: string; apiKey?: string; error?: string }> {
  
  // 1. OBTENÇÃO SEGURA DA CHAVE MESTRE DO SERVIDOR
  const masterApiKey = process.env.ASAAS_API_KEY;

  if (!masterApiKey) {
    console.error("[ASAAS SERVER ERROR]: Variável de ambiente ASAAS_API_KEY não está configurada.");
    return {
      success: false,
      error: "Erro de infraestrutura do sistema: Chave Master do Asaas não foi configurada nas variáveis de ambiente."
    };
  }

  // 2. SELEÇÃO DE AMBIENTE OPERACIONAL (Sandbox/Homologação por padrão de segurança demonstrativa)
  const baseUrl = useProduction 
    ? "https://api.asaas.com/v3" 
    : "https://sandbox.asaas.com/v3";

  // 3. SANITIZAÇÃO DE DADOS CRÍTICOS (Garante conformidade com os tipos de inputs exigidos pelo Bacen)
  const cpfCnpjLimpo = dadosCadastro.cpfCnpj.replace(/\D/g, "");
  const cepLimpo = dadosCadastro.postalCode.replace(/\D/g, "");
  
  // O Asaas v3 possui regras de companyType para subcontas. Como é focado em MEI, 
  // caso o documento tenha 14 dígitos (CNPJ) definimos como "MEI" ou "INDIVIDUAL", 
  // caso contrário (11 dígitos para CPF) tratamos como Pessoa Física "INDIVIDUAL".
  const companyType = cpfCnpjLimpo.length === 14 ? "MEI" : "INDIVIDUAL";

  // Monta as especificações de payload recomendadas pela documentação da API v3 do Asaas
  const payloadAsaas = {
    name: dadosCadastro.name.trim(),
    email: dadosCadastro.email.trim(),
    loginEmail: dadosCadastro.email.trim(), // Convenção de onboarding direto
    cpfCnpj: cpfCnpjLimpo,
    companyType: companyType,
    phone: dadosCadastro.phone ? dadosCadastro.phone.replace(/\D/g, "") : undefined,
    mobilePhone: dadosCadastro.mobilePhone.replace(/\D/g, ""),
    postalCode: cepLimpo,
    address: dadosCadastro.address.trim(),
    addressNumber: dadosCadastro.addressNumber.trim(),
    complement: dadosCadastro.complement ? dadosCadastro.complement.trim() : undefined,
    province: dadosCadastro.province.trim(),
  };

  try {
    console.log(`[ASAAS BACKEND INTERACTION]: Iniciando criação de subconta para o MEI: ${payloadAsaas.name} (${payloadAsaas.cpfCnpj})`);

    // 4. DISPARO VIA AXIOS PARA O ENDPOINT DO ASAASv3 DE CRIAÇÃO ONDEMAND
    const response = await axios.post<AsaasSubaccountResponse>(
      `${baseUrl}/accounts`,
      payloadAsaas,
      {
        headers: {
          "Content-Type": "application/json",
          "access_token": masterApiKey.trim()
        },
        timeout: 15000 // Timeout de 15 segundos prevenindo atrasos nas operações
      }
    );

    const asaasData = response.data;

    if (!asaasData || !asaasData.id || !asaasData.apiKey) {
      throw new Error("Resposta bem-sucedida, porém dados de identificação da subconta (walletId/apiKey) vieram nulos.");
    }

    console.log(`[ASAAS BACKEND SUCCESS]: Subconta criada com id: ${asaasData.id}. Registrando no Firestore...`);

    // 5. ATUALIZAÇÃO DO PERFIL DO USUÁRIO NO FIRESTORE COM INTEGRALIDADE FISCAL
    const userDocRef = doc(db, "usuarios", userId);
    
    // O Asaas retorna 'apiKey' para a nova subconta gerada. Guardamos a apiKey também como 'asaasAccessToken'
    // para que a interface cliente consiga ler o saldo líquidos e extratos da subconta imediatamente!
    await setDoc(userDocRef, {
      conta_ativa: true,
      walletId: asaasData.id,
      apiKey: asaasData.apiKey,
      asaasAccessToken: asaasData.apiKey,
      updatedAt: new Date().toISOString(),
      onboardedAt: new Date().toISOString()
    }, { merge: true });

    console.log(`[ASAAS BACKEND TRANSACTION]: Conta ativada com sucesso para o usuário ${userId}`);

    return {
      success: true,
      walletId: asaasData.id,
      apiKey: asaasData.apiKey
    };

  } catch (error: any) {
    console.error("[ASAAS SERVER FAILURE]: Houve um erro no processo de ativação automatizada:", error);

    // 6. PROCESSAMENTO ELEGANTE DOS RETORNOS DE ERRO DA API DO ASAAS (Ex: CNPJ Inválido)
    if (axios.isAxiosError(error)) {
      const axiosError = error as AxiosError<{ errors?: AsaasApiError[] }>;
      const asaasErrors = axiosError.response?.data?.errors;

      if (asaasErrors && asaasErrors.length > 0) {
        // Mapeia todas as inconsistências descritas pelo validador do Asaas (Bacen)
        const erroTratado = asaasErrors
          .map((e) => {
            // Conversão de códigos de erro padrão em termos legíveis para microempreendedores MEI
            if (e.code === "invalid.cnpj" || e.code === "invalid.cpfCnpj") {
              return "O CNPJ/CPF informado é inválido ou não foi reconhecido pela Receita Federal.";
            }
            if (e.code === "invalid.email") {
              return "O e-mail informado possui formatação incorreta.";
            }
            if (e.code === "invalid.mobilePhone") {
              return "O número de telefone celular é inválido ou incompleto (inclua DDD).";
            }
            if (e.code === "invalid.postalCode") {
              return "O CEP informado não foi encontrado pelo validador postal.";
            }
            return e.description;
          })
          .join(" ");

        return {
          success: false,
          error: `Erro na validação Cadastral da API: ${erroTratado}`
        };
      }

      // Outros códigos HTTP de barreira externa
      const httpStatus = axiosError.response?.status;
      if (httpStatus === 401) {
        return {
          success: false,
          error: "Erro de Permissão: A chave master ASAAS_API_KEY do servidor não possui autorização ou é inválida."
        };
      }
      if (httpStatus === 400) {
        return {
          success: false,
          error: "Requisição inválida: Dados preenchidos não atendem os critérios do gateway de pagamentos."
        };
      }

      return {
        success: false,
        error: `Falha de rede com o Asaas: ${axiosError.message}`
      };
    }

    // Exceções locais ou de escrita do banco Firestore
    return {
      success: false,
      error: error.message || "Exceção inesperada ao registrar subconta de pagamento."
    };
  }
}

/**
 * =========================================================================
 * EXPRESS ROUTER PORT: Roteador HTTP Integrador (Opcional, Pronto para Uso)
 * =========================================================================
 * 
 * Esse bloco de código implementa um roteador Express completo. Você pode
 * importá-lo diretamente no seu arquivo de inicialização do servidor (ex: server.ts).
 * 
 * Exemplo de uso no seu server.ts:
 *   import { asaasRouter } from "./src/asaasBackendService";
 *   app.use("/api/asaas", asaasRouter);
 */
import { Router, Request, Response } from "express";

export const asaasRouter = Router();

// Endpoint POST: /api/asaas/criar-subconta
asaasRouter.post(
  "/criar-subconta",
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { userId, dadosCadastro } = req.body;

      // 1. VALIDAÇÃO PRIMÁRIA DE ENTRADA DO CONTROLLER
      if (!userId) {
        res.status(400).json({
          success: false,
          error: "O campo 'userId' é obrigatório no corpo da requisição."
        });
        return;
      }

      if (!dadosCadastro || typeof dadosCadastro !== "object") {
        res.status(400).json({
          success: false,
          error: "O objeto 'dadosCadastro' com informações do MEI é obrigatório."
        });
        return;
      }

      // 2. VALIDAÇÃO DE CAMPOS INTERNOS REQUERIDOS
      const { name, email, cpfCnpj, mobilePhone, postalCode, address, addressNumber, province } = dadosCadastro;
      const camposFaltantes: string[] = [];

      if (!name) camposFaltantes.push("name");
      if (!email) camposFaltantes.push("email");
      if (!cpfCnpj) camposFaltantes.push("cpfCnpj");
      if (!mobilePhone) camposFaltantes.push("mobilePhone");
      if (!postalCode) camposFaltantes.push("postalCode");
      if (!address) camposFaltantes.push("address");
      if (!addressNumber) camposFaltantes.push("addressNumber");
      if (!province) camposFaltantes.push("province");

      if (camposFaltantes.length > 0) {
        res.status(400).json({
          success: false,
          error: `Campos cadastrais obrigatórios ausentes: ${camposFaltantes.join(", ")}`
        });
        return;
      }

      console.log(`[ASAAS ROUTER]: Requisição de Onboarding recebida para o userId: ${userId}`);

      // 3. EXECUÇÃO INTEGRAL DA SUBCONTA COM PERSISTÊNCIA NO FIRESTORE
      // Você pode definir o terceiro parâmetro como 'true' caso queira forçar a criação em Produção real
      const resultado = await criarSubcontaAsaas(userId, dadosCadastro, false);

      if (resultado.success) {
        // Retorno 201 Created com os dados gerados com segurança
        res.status(201).json({
          success: true,
          message: "Conta digital criada e ativada com sucesso!",
          walletId: resultado.walletId,
          apiKey: resultado.apiKey
        });
      } else {
        // Erro retornado pela API do Asaas (ex: CNPJ inválido) ou segurança
        res.status(422).json({
          success: false,
          error: resultado.error
        });
      }

    } catch (routeError: any) {
      console.error("[ASAAS ROUTE EXCEPTION]: Erro inesperado na rota express:", routeError);
      res.status(500).json({
        success: false,
        error: `Falha interna no processamento do onboarding: ${routeError.message || routeError}`
      });
    }
  }
);

