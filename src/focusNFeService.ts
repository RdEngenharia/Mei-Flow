/**
 * Focus NFe v2/nfse - Código de Integração Simplificado para Node.js / TypeScript
 * 
 * Desenvolvido para: MEI Flow
 * Credenciais de Homologação Embutidas Conforme Solicitado.
 */

// Utiliza o fetch nativo e global disponível no Node.js 18+ e navegadores modernos

// Configurações Globais da Focus NFe
// O token de homologação do usuário de acordo com as instruções: "wCTTGnYwEXXqCYskYtswVMBCQIHP8e8w"
const TOKEN_HOMOLOGACAO = "wCTTGnYwEXXqCYskYtswVMBCQIHP8e8w";
const PASSWORD = ""; // Senha deixada em branco conforme instrução

// URL base de homologação para NFS-e v2 da Focus NFe
const BASE_URL_HOMOLOGACAO = "https://homologacao.focusnfe.com.br/v2/nfse";

/**
 * Função utilitária para gerar o Header de Autenticação Basic Auth
 * A API da Focus NFe utiliza Basic Authentication:
 * - Username: Seu token/chave API
 * - Password: Em branco
 * 
 * O header é construído como "Basic " + base64(token + ":")
 */
export function getAuthHeader(): string {
  const credentials = `${TOKEN_HOMOLOGACAO}:${PASSWORD}`;
  // Em ambientes de navegador (React) usamos btoa. Em Node.js usamos Buffer.
  const base64 = typeof window !== "undefined"
    ? btoa(credentials)
    : Buffer.from(credentials).toString("base64");
  return `Basic ${base64}`;
}

export interface NFSePayload {
  cnpj_prestador: string;
  ref: string;
  numero_rps: string;
  serie_rps: string;
  tipo_rps: string;
  valor_servicos: number;
  descricao_servicos?: string;
  codigo_servico?: string;
  cnpj_tomador?: string;
  cpf_tomador?: string;
  email_tomador?: string;
  razao_social_tomador?: string;
}

/**
 * 1. ETAPA DE ENVIO (POST)
 * Envia uma requisição de NFS-e simplificada para a API da Focus NFe.
 * 
 * Retorna status "processando_autorizacao" e a chave "ref" única.
 */
export async function emitirNfse(payload: NFSePayload) {
  const url = BASE_URL_HOMOLOGACAO;
  
  // Monta a estrutura compatível com a v2/nfse da Focus NFe
  // Adaptado de acordo com a documentação para testes
  const bodyData = {
    cnpj_prestador: payload.cnpj_prestador.replace(/\D/g, ""), // Limpa pontos, traços e barras
    ref: payload.ref,
    numero_rps: payload.numero_rps,
    serie_rps: payload.serie_rps,
    tipo_rps: payload.tipo_rps,
    valor_servicos: payload.valor_servicos,
    tomador: {
      cnpj: payload.cnpj_tomador ? payload.cnpj_tomador.replace(/\D/g, "") : undefined,
      cpf: payload.cpf_tomador ? payload.cpf_tomador.replace(/\D/g, "") : undefined,
      razao_social: payload.razao_social_tomador || "Consumidor Final",
      email: payload.email_tomador || undefined,
    },
    servico: {
      aliquota: 0, // Isento ou Simples Nacional
      discriminacao: payload.descricao_servicos || "Prestação de Serviços de Consultoria para MEI",
      codigo_municipio: "3550308", // Código IBGE padrão de São Paulo para testes
      item_lista_servico: payload.codigo_servico || "01.01" // Código padrão da LC 116/03
    }
  };

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": getAuthHeader()
      },
      body: JSON.stringify(bodyData)
    });

    const status = response.status;
    const json: any = await response.json();

    if (status === 201 || status === 200) {
      return {
        success: true,
        httpStatus: status,
        ref: json.ref || payload.ref,
        statusNfe: json.status || "processando_autorizacao",
        data: json
      };
    } else {
      return {
        success: false,
        httpStatus: status,
        error: json.mensagem || json.errors || "Erro desconhecido na emissão",
        data: json
      };
    }
  } catch (error: any) {
    console.error("Erro ao emitir NFS-e:", error);
    return {
      success: false,
      error: error.message || "Erro de rede ao conectar com a Focus NFe"
    };
  }
}

/**
 * 2. ETAPA DE CONSULTA (GET)
 * Consulta o status da emissão da NFS-e usando o "ref" recebido anteriormente.
 */
export async function consultarNfse(ref: string) {
  const url = `${BASE_URL_HOMOLOGACAO}/${ref}`;

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        "Authorization": getAuthHeader()
      }
    });

    const status = response.status;
    const json: any = await response.json();

    if (status === 200) {
      // Se status mudou para "autorizado"
      return {
        success: true,
        httpStatus: status,
        statusNfe: json.status, // "autorizado", "processando_autorizacao", "erro_autorizacao"
        xmlUrl: json.caminho_xml_nota_fiscal ? `https://homologacao.focusnfe.com.br${json.caminho_xml_nota_fiscal}` : null,
        pdfUrl: json.caminho_pdf_nota_fiscal ? `https://homologacao.focusnfe.com.br${json.caminho_pdf_nota_fiscal}` : null,
        erros: json.erros || null,
        data: json
      };
    } else {
      return {
        success: false,
        httpStatus: status,
        error: json.mensagem || "RPS ou Referência não encontrada",
        data: json
      };
    }
  } catch (error: any) {
    console.error("Erro ao consultar NFS-e:", error);
    return {
      success: false,
      error: error.message || "Erro de rede ao conectar para consulta"
    };
  }
}

export interface CadastroEmpresaPayload {
  cnpj: string;
  razao_social: string;
  nome_fantasia?: string;
  inscricao_municipal?: string;
  email: string;
  telefone?: string;
  regime_tributario: "SIMPLES_NACIONAL" | "SIMPLES_NACIONAL_MEI" | "REGIME_NORMAL" | number;
  logradouro?: string;
  numero?: string;
  complemento?: string;
  bairro?: string;
  municipio?: string;
  uf?: string;
  cep?: string;
  environment?: "homologacao" | "producao";
}

/**
 * 3. CADASTRO DE EMPRESA (POST)
 * Envia os dados cadastrais do MEI para o endpoint /v2/empresas da Focus NFe.
 * Esta etapa é essencial no onboarding de novos usuários para habilitar a emissão de notas.
 */
export async function cadastrarEmpresaFocusNFe(payload: CadastroEmpresaPayload) {
  const isProd = payload.environment === "producao";
  const baseUrl = isProd 
    ? "https://api.focusnfe.com.br/v2/empresas" 
    : "https://homologacao.focusnfe.com.br/v2/empresas";

  // Mapeia regime tributário do MEI conforme especificado pela Focus NFe
  // 1 - Simples Nacional (Padrão para MEI na maioria dos casos)
  // 4 - Simples Nacional - MEI (Regime específico de MEI se suportado pelo município)
  let regimeNumerico = 1;
  if (typeof payload.regime_tributario === "number") {
    regimeNumerico = payload.regime_tributario;
  } else if (payload.regime_tributario === "SIMPLES_NACIONAL_MEI") {
    regimeNumerico = 4;
  } else if (payload.regime_tributario === "REGIME_NORMAL") {
    regimeNumerico = 3;
  } else {
    regimeNumerico = 1; // "SIMPLES_NACIONAL" ou fallback
  }

  // Prepara o corpo da requisição de forma limpa e tipificada
  const bodyData = {
    cnpj: payload.cnpj.replace(/\D/g, ""), // Apenas números
    razao_social: payload.razao_social,
    nome_fantasia: payload.nome_fantasia || payload.razao_social,
    inscricao_municipal: payload.inscricao_municipal?.replace(/\D/g, "") || "",
    email: payload.email,
    telefone: payload.telefone?.replace(/\D/g, "") || "",
    regime_tributario: regimeNumerico,
    enviar_email_tomador: true, // Notificar cliente automaticamente por padrão
    logradouro: payload.logradouro || "Rua Principal",
    numero: payload.numero || "100",
    complemento: payload.complemento || "",
    bairro: payload.bairro || "Centro",
    municipio: payload.municipio || "São Paulo",
    uf: payload.uf?.toUpperCase() || "SP",
    cep: payload.cep?.replace(/\D/g, "") || "01001000"
  };

  try {
    const response = await fetch(baseUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": getAuthHeader()
      },
      body: JSON.stringify(bodyData)
    });

    const status = response.status;
    const data: any = await response.json();

    if (status === 201 || status === 200) {
      return {
        success: true,
        httpStatus: status,
        empresaId: data.id || bodyData.cnpj,
        ambiente: isProd ? "producao" : "homologacao",
        data: data
      };
    } else {
      return {
        success: false,
        httpStatus: status,
        error: data.mensagem || data.errors?.[0]?.mensagem || "Erro na criação da empresa",
        data: data
      };
    }
  } catch (error: any) {
    console.error("Erro ao cadastrar empresa na Focus NFe:", error);
    return {
      success: false,
      error: error.message || "Erro de rede ao conectar à Focus NFe"
    };
  }
}

