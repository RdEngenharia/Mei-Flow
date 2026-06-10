# Especificação de Segurança NoSQL (Zero-Trust) - MEI Flow

Este documento serve para documentar as regras de acesso e de governança do banco de dados Cloud Firestore do aplicativo **MEI Flow**, garantindo isolamento total por usuário autenticado (UID).

## 1. Invariantes de Dados

1. **Titularidade Absoluta (MEI Isolation):** Nenhuma transação ou cliente pode ser criado ou consultado sem um `mei_uid` correspondente.
2. **Imutabilidade de Dono:** Uma vez criado, o campo `mei_uid` de uma transação ou de um cliente nunca poderá ser alterado por nenhuma requisição de atualização.
3. **Validação Sanitizada de Valor:** Valores decimais devem ser maiores que zero.
4. **Isolamento de PII:** Dados pessoais de contato do tomador do serviço (Ex: telefone, email, CPF/CNPJ) estão encapsulados de forma isolada e seus métodos de query de lista (`list`) exigem filtragem estrita pelo `mei_uid` do próprio usuário autenticado.

---

## 2. Operações Maliciosas ("Dirty Dozen") Rejeitadas

Abaixo constam as 12 payloads de testes adversários projetadas para tentar quebrar a integridade ou vazar dados laterais, todas blindadas pelas regras do Firestore:

### Ataque 1: Alteração de Titularidade (Identity Theft)
Tentar atualizar uma transação válida alterando o ID do proprietário para roubar o faturamento de outro MEI.
* **Payload:** `{"id": "tx_abc", "mei_uid": "user_novo_invasor"}`
* **Resultado:** `PERMISSION_DENIED` (Pelas regras de imutabilidade de `mei_uid`).

### Ataque 2: Injeção de Campo Fantasma (Shadow Update)
Incluir campos corrompidos adicionais como `"isAdmin": true` no perfil de usuário para tentar escalação de privilégios.
* **Payload:** `{"uid": "user_49281", "isAdmin": true}`
* **Resultado:** `PERMISSION_DENIED` (Rejeitado pela ausência de role admin declarada ou trigger central).

### Ataque 3: Registro de Entrada com Valor Negativo (Data Poisoning)
Passar valor negativo para burlar o limite do faturamento bruto do MEI.
* **Payload:** `{"tipo": "entrada", "valor": -5000.00}`
* **Resultado:** `PERMISSION_DENIED` (Rejeitado pelo validador `request.resource.data.valor > 0`).

### Ataque 4: Consulta Sem Filtros de Isolação (PII Leak list)
Consultar a coleção inteira de dezenas de milhares de clientes cadastrados no banco sem passar a cláusula `where("mei_uid", "==", uid)`.
* **Payload:** `getDocs(collection(db, "clientes"))`
* **Resultado:** `PERMISSION_DENIED` (Rejeitado por violar a checagem `resource.data.mei_uid == request.auth.uid` nas listagens).

### Ataque 5: Injeção de Strings Gigantes na Chave ID (Denial of Wallet)
Submeter uma string ID de documento com 1MB para forçar buffer overflow ou inflar os custos de operação do banco.
* **Payload:** `setDoc(doc(db, "transacoes", "A" * 50000))`
* **Resultado:** `PERMISSION_DENIED` (Tratado pelo utilitário `isValidId()` limitando o tamanho a 128 bytes e caracteres alfanuméricos).

### Ataque 6: Execução de Operações como Convidado Não-Autenticado
Enviar requisição direto da API Web sem cabeçalho JWT de autenticação do Firebase.
* **Payload:** `{ "tipo": "entrada", "valor": 500.00 }` (Com `request.auth == null`)
* **Resultado:** `PERMISSION_DENIED` (Tratado pelo helper `isSignedIn()`).

### Ataque 7: Sequestro de Email Desavisado (Spoofing)
Tentar se autenticar informando um e-mail idêntico ao administrador do MEI sem comprovação de que o e-mail foi verificado pelo Firebase.
* **Payload:** `{ "email": "jhon.ostentacao@gmail.com", "email_verified": false }`
* **Resultado:** `PERMISSION_DENIED` (Tratado pela verificação estrita `request.auth.token.email_verified == true`).

### Ataque 8: Modificação das Chaves Originais (Atributos Imutáveis)
Tentar atualizar a data de criação original `createdAt` para simular uma venda retroativa.
* **Payload:** `{"id": "tx_abc", "createdAt": "2020-01-01T00:00:00Z"}`
* **Resultado:** `PERMISSION_DENIED` (Bloqueado pela regra que garante `incoming().createdAt == existing().createdAt`).

### Ataque 9: Consulta Cruzada de Perfil de Usuários
Tentar ler os dados cadastrais da empresa de outro MEI consultando `users/userId_de_outrem`.
* **Payload:** `getDoc(doc(db, "users", "user_outrem_99"))`
* **Resultado:** `PERMISSION_DENIED` (Bloqueado por `request.auth.uid == userId`).

### Ataque 10: Criação de Clientes sem Nome
Tentar registrar clientes com campos faltantes fundamentais para corromper relatórios fiscais do MEI.
* **Payload:** `{"documento": "12.345.678/0001-90", "mei_uid": "user_49281_joaosilva"}`
* **Resultado:** `PERMISSION_DENIED` (O validador obriga a presença de `nome is string`).

### Ataque 11: Inserção de Tipos Inválidos
Salvar o campo `valor` como string em vez de valor decimal para inutilizar fórmulas de adição.
* **Payload:** `{"valor": "Um Mil e Duzentos Reais", "mei_uid": "user_49281_joaosilva"}`
* **Resultado:** `PERMISSION_DENIED` (O validador proíbe através da regra `request.resource.data.valor is number`).

### Ataque 12: Deleção de Dados por Não-Proprietário
Tentar apagar uma transação pertencente a João Silva usando uma ID secundária.
* **Payload:** `deleteDoc(doc(db, "transacoes", "tx_joao_123"))` executado por `user_invasor`
* **Resultado:** `PERMISSION_DENIED` (Pelo helper de checagem do dono do recurso original).
