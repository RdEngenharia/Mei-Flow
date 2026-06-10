/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export const FIRESTORE_TREE = `db (Root)
├── /users (Coleção)
│   └── /{userId} (Documento - Perfil do MEI)
│       ├── nomeComercial: "João Silva Consultoria"
│       ├── limiteAnual: 81000.00
│       └── faturamentoAcumulado: 32400.00
│
├── /clientes (Coleção Raiz - Ideal para consultar por MEI de forma indexada)
│   └── /{clienteId} (Documento)
│       ├── mei_uid: "USER_UID_AQUI" <── Chave estrangeira de isolamento
│       ├── nome: "Alice Martins"
│       ├── documento: "123.456.789-00"
│       ├── email: "alice@email.com"
│       ├── telefone: "(11) 98765-4321"
│       └── createdAt: "2026-06-10T11:18:49Z"
│
└── /transacoes (Coleção Raiz - Melhores índices compostos de data e tipo)
    └── /{transacaoId} (Documento)
        ├── mei_uid: "USER_UID_AQUI" <── Chave estrangeira de isolamento
        ├── tipo: "entrada" | "saida"
        ├── valor: 1200.00
        ├── data: "2026-06-15"
        ├── descricao: "Consultoria UX"
        ├── categoria: "Consultoria"
        ├── clienteId: "CLIENTE_ID_AQUI" (opcional para Saídas)
        ├── clienteNome: "Alice Martins"
        └── clienteDocumento: "123.456.789-00"`;

export const EXEMPLE_VENDA_JSON = `{
  "id": "vda_789412",
  "mei_uid": "user_49281_joaosilva",
  "tipo": "entrada",
  "valor": 1200.00,
  "data": "2026-06-15",
  "descricao": "Consultoria UX Avançada",
  "categoria": "Prestação de Serviços",
  "tipo_servico": "Serviços de Tecnologia da Informação",
  
  // Dados desnormalizados do Cliente para emissão instantânea de Recibo/Relatório MEI
  "clienteId": "cli_102938",
  "clienteNome": "Alice Martins Ltda",
  "clienteDocumento": "12.345.678/0001-90",
  "clienteEmail": "alice@martins.dev",
  "clienteTelefone": "(11) 98765-4321",
  
  // Campos de controle recomendados
  "updatedAt": "2026-06-10T11:18:49Z",
  "createdAt": "2026-06-10T11:18:49Z"
}`;

export const EXEMPLE_CLIENTE_JSON = `{
  "id": "cli_102938",
  "mei_uid": "user_49281_joaosilva",
  "nome": "Alice Martins Ltda",
  "documento": "12.345.678/0001-90",
  "email": "alice@martins.dev",
  "telefone": "(11) 98765-4321",
  
  // Campos de busca indexada (gerados automaticamente no trigger se necessário)
  "busca_nome": "alice martins ltda",
  "createdAt": "2026-06-10T11:18:49Z"
}`;

export const REGRA_SEGURANCA_FIRESTORE = `rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    
    // 1. Regra de Segurança Geral - Bloqueio por Padrão de Nível Zero-Trust
    match /{document=**} {
      allow read, write: if false;
    }
    
    // Função auxiliar reutilizável para checar autenticação básica e validação do UID
    function isSignedIn() {
      return request.auth != null;
    }
    
    // Função para verificar se o registro pertence estritamente ao usuário autenticado (MEI)
    function isOwner(meiUid) {
      return isSignedIn() && request.auth.uid == meiUid;
    }

    // 2. Proteção para a Coleção de Perfil de Usuários MEI
    match /users/{userId} {
      allow read, write: if isSignedIn() && request.auth.uid == userId;
    }

    // 3. Regras para Clientes (Consultas com Isolação Absoluta)
    match /clientes/{clienteId} {
      // Criação: garante que o mei_uid no payload gravado seja strictly correspondente ao UID do autenticado
      allow create: if isSignedIn() 
        && request.resource.data.mei_uid == request.auth.uid 
        && request.resource.data.nome is string 
        && request.resource.data.nome.size() <= 150;
        
      // Leitura de documento singular e listagens estruturadas
      allow get, list: if isSignedIn() && resource.data.mei_uid == request.auth.uid;
      
      // Atualizações de dados de contato do cliente
      allow update: if isSignedIn() 
        && resource.data.mei_uid == request.auth.uid 
        && request.resource.data.mei_uid == resource.data.mei_uid;
        
      // Deleção permitida apenas pelo próprio MEI cadastrador
      allow delete: if isSignedIn() && resource.data.mei_uid == request.auth.uid;
    }

    // 4. Regras para Transações (Entradas e Saídas Financieras/Fiscais)
    match /transacoes/{transacaoId} {
      // Registro de Venda ou Despesa das sub-contas
      allow create: if isSignedIn() 
        && request.resource.data.mei_uid == request.auth.uid
        && request.resource.data.valor is number
        && request.resource.data.valor > 0;
        
      // Visualizações individuais ou listagem por filtros
      allow get, list: if isSignedIn() && resource.data.mei_uid == request.auth.uid;
      
      // Update controlado (garantindo que não altere a titularidade do MEI originador)
      allow update: if isSignedIn() 
        && resource.data.mei_uid == request.auth.uid 
        && request.resource.data.mei_uid == resource.data.mei_uid;
        
      // Exclusão de lançamentos
      allow delete: if isSignedIn() && resource.data.mei_uid == request.auth.uid;
    }
  }
}`;
