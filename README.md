# AI Review System

PoC de revisão de Pull Requests com **um único agente de regras de negócio**. O serviço recebe o evento do GitHub, obtém o diff e as regras do projeto, chama o modelo, publica os achados e registra a revisão no MongoDB.

## Fluxo implementado

```text
Webhook do GitHub (PR aberto ou atualizado)
  -> Validação HMAC
  -> Orquestrador
       -> GitHub REST: diff do PR
       -> Cliente MCP: conexão e descoberta da ferramenta
            -> Servidor MCP próprio (stdio): get_business_rules
                 -> Jira REST: tarefas indicadas na PR ou regras com label business-rule
       -> Agente de regras de negócio: uma chamada ao modelo
       -> Remoção de duplicatas exatas e ordenação por severidade
       -> GitHub: comentários no PR
       -> MongoDB: registro da revisão
```

**Estado da verificação:** a versão publicada `c2afe60` usa REST direto. A implementação local foi separada em cliente MCP, servidor MCP próprio e provedor Jira. Passaram 38 testes unitários com dependências simuladas e três testes de integração usando o SDK real e transporte stdio, com Jira simulado. A negociação observada utilizou o protocolo `2025-11-25`. A implantação completa com Jira, modelo, GitHub e MongoDB ainda não foi verificada nesta versão.

## Integração MCP preparada localmente

- `src/mcp-client.js` usa o SDK oficial `@modelcontextprotocol/sdk`, versão fixada em `1.29.0`, para iniciar o servidor como processo filho, negociar a sessão, descobrir ferramentas e chamar `get_business_rules`.
- `src/mcp-server.js` expõe essa ferramenta pelo transporte `stdio`, usando JSON-RPC do SDK. Não é o servidor remoto oficial da Atlassian: é um servidor próprio da PoC, como previsto no desenho cliente/servidor do manuscrito.
- `src/jira-client.js` é o único provedor que consulta a API REST do Jira. O orquestrador e o cliente MCP não consultam o Jira diretamente e não fazem fallback silencioso para REST se o MCP falhar.
- O servidor roda no mesmo ambiente do serviço revisor, sem outra porta HTTP. Suas credenciais Jira são recebidas pelo ambiente do processo filho, não por argumentos da ferramenta. Tokens GitHub e Groq não são encaminhados ao servidor MCP.
- O SDK negocia o protocolo durante `initialize`. O cliente registra a versão negociada pelo hook público `setProtocolVersion`, a identidade e as capacidades do servidor, o transporte e a ferramenta chamada. A conexão é encerrada após a consulta, inclusive em falhas.
- O contexto retorna títulos, descrições, chaves, URLs de origem, data de atualização quando disponível e instante de recuperação. O texto fornecido ao agente e esses metadados são incluídos em `business_context` na auditoria.

O uso do SDK e o formato do código não substituem um teste do protocolo. A verificação deve distinguir: testes unitários simulados; handshake, descoberta e chamada com transporte real e Jira simulado; consulta ao Jira real; e revisão completa de um PR.

## Escopo da revisão

O único agente é `src/agents/business-logic-agent.js`, com instruções em `src/agents/prompts/business-logic.md`. Os agentes e prompts antigos de bugs, code smells e otimização foram retirados.

O agente recebe apenas o diff e as regras de negócio recuperadas. Convenções de estilo em `.review-config/standards.md` não são consultadas. As instruções exigem vínculo com uma regra explícita e evidência no diff, sem criar políticas ou tratar sugestões genéricas como violações de negócio.

Cada achado contém `file`, `line`, `rule_id`, `body`, `severity` e a identificação `agent: business_logic`. A explicação é solicitada em português brasileiro. `rule_id` identifica a regra como `RN-01` a `RN-07`, não a task Jira. O comentário destaca a RN e seu título, acompanhados da chave e do link da task Jira correspondente. A origem também permanece no registro interno da auditoria, incluindo `jira_issue_key`.

O catálogo `src/business-rules.json` relaciona as sete RNs da API às tasks. Ele corresponde a `docs/business-rules.json` da API; ambos devem ser atualizados juntos quando esse vínculo mudar. O catálogo fornece identidade e título, enquanto o conteúdo detalhado continua sendo recuperado via MCP/Jira. Somente as RNs cujas tasks foram efetivamente recuperadas entram no contexto enviado ao modelo. Tasks sem mapeamento e achados que citam uma task em lugar da RN, uma RN inexistente ou uma RN não consultada interrompem a revisão antes da publicação. Essa validação estrutural não comprova a correção semântica do achado.

A consolidação remove apenas repetições exatas de arquivo, linha, regra e explicação, e ordena por severidade. É um procedimento determinístico; não há LLM-as-a-Judge nem comparação entre modelos.

## Referência ao Jira na descrição da PR

Antes de abrir a PR, inserir uma linha com a chave da tarefa:

```text
Jira: TCC-9
```

Para várias tarefas, separar as chaves por vírgulas:

```text
Jira: TCC-5, TCC-3
```

O webhook encaminha a descrição para o orquestrador. O serviço solicita ao servidor MCP somente as tarefas indicadas; o provedor desse servidor consulta o Jira e retorna títulos e descrições ao agente. Nesse modo, a chave identifica o projeto e não é exigida a label `business-rule`. Aceitam-se até 20 chaves distintas; maiúsculas/minúsculas são normalizadas e repetições são removidas.

Sem a linha `Jira:`, permanece a busca por até 20 regras com label `business-rule` no projeto `JIRA_PROJECT_KEY`. Se a linha for preenchida com um valor inválido ou alguma tarefa selecionada não for retornada pelo Jira, a revisão falha sem substituir silenciosamente a seleção por todas as regras.

O workflow atual dispara ao abrir a PR ou enviar um novo commit. Editar apenas a descrição não dispara outra execução. Preencher o campo antes da abertura ou, depois de corrigir a descrição, enviar um novo commit para que o evento atualizado seja recebido.

Mapeamento encontrado no documento local `docs/regras_negocio.md` da API (o conteúdo atual ainda deve ser conferido no Jira):

| Task | Regra |
| :--- | :--- |
| `TCC-5` | RN-01: conflito de horários. |
| `TCC-3` | RN-02: antecedência mínima de 24 horas. |
| `TCC-6` | RN-03: duração por perfil. |
| `TCC-7` | RN-04: limite de reservas ativas do estudante. |
| `TCC-8` | RN-05: cancelamento somente de reservas pendentes. |
| `TCC-9` | RN-06: restrições de salas em manutenção. |
| `TCC-10` | RN-07: cadastro de salas e capacidade. |

## Modelo e dependências

- Node.js e Express.
- API Groq pelo cliente compatível com OpenAI (`openai`).
- Modelo padrão no código: `llama-3.3-70b-versatile`, substituível por `GROQ_MODEL`; temperatura `0.1`.
- Octokit para o GitHub, HTTPS para o Jira e cliente MongoDB para auditoria.

Esses itens descrevem o código local. A disponibilidade do modelo, o acesso às contas e o funcionamento das integrações reais ainda precisam ser verificados para a nova PoC.

## Configuração local

```powershell
npm install
Copy-Item .env.example .env
```

Preencher `.env` com a configuração local. O aplicativo não carrega esse arquivo automaticamente. Com o Node disponível neste ambiente, iniciar usando:

```powershell
node --env-file=.env src/app.js
```

Se as variáveis já estiverem definidas no ambiente do processo, usar `npm start` ou `npm run dev`. O arquivo `.env` não deve ser versionado.

| Variável | Uso no código |
| :--- | :--- |
| `GITHUB_TOKEN` | Autenticação do cliente GitHub, com acesso ao repositório-alvo e permissão para comentar. |
| `GITHUB_WEBHOOK_SECRET` | Segredo usado na assinatura HMAC do evento. |
| `GROQ_API_KEY` | Credencial da API Groq. |
| `GROQ_MODEL` | Modelo utilizado; o padrão é definido em `src/agents/llm-client.js`. |
| `JIRA_BASE_URL` | Endereço da instância Jira, como `https://example.atlassian.net`. |
| `JIRA_EMAIL` | E-mail da conta Jira usada pelo cliente REST atual. |
| `JIRA_API_TOKEN` | Token da conta Jira. |
| `JIRA_PROJECT_KEY` | Projeto consultado quando a PR não informa tarefas. O exemplo usa `TCC`; sem configuração, o código usa `SALA`. |
| `MONGODB_URI` | Conexão com o MongoDB. |
| `PORT` | Porta HTTP; padrão `4000`. |

Endpoints: `GET /health`, `GET /health-db` e `POST /webhook`. O handler aceita eventos `pull_request` com ações `opened` e `synchronize`. O workflow do repositório-alvo ou um webhook configurado deve encaminhar o evento assinado para `/webhook`.

## Validação e auditoria

Contexto de regras vazio interrompe a análise antes da chamada ao modelo. Falhas HTTP do Jira e tarefas indicadas que não foram retornadas geram erro. A extração da descrição preserva textos em listas e parágrafos aninhados do formato ADF do Jira. Assinaturas HMAC ausentes, malformadas ou incorretas retornam 401. JSON inválido, saída que não seja um array, campos obrigatórios inválidos ou arquivos fora do diff interrompem a revisão antes da publicação. Um array válido `[]` representa ausência de violações demonstráveis reportadas pelo modelo; não comprova conformidade do código nem suficiência do contexto.

As validações verificam o formato e alguns vínculos estruturais. Não comprovam que a regra citada foi interpretada corretamente ou que o achado é tecnicamente válido. Essa avaliação continua humana.

Após a publicação, o registro em `poc_review.audit_logs` contém PR, repositório, SHA informado pelo evento, modelo, `agents: ["business_logic"]`, comentários, tokens somente desse agente, duração e timestamp. O campo `jira_issue_keys` registra as chaves indicadas na descrição; `rules_source` distingue `pr_description` de `project_label`. No modo por projeto, a lista de referências explícitas fica vazia, mas `business_context.issue_keys` identifica as tarefas efetivamente recuperadas. `business_context` preserva o conteúdo usado e os metadados da conexão MCP. A captura do prompt versionado, das falhas e do resultado individual de publicação permanece pendente.

## Testes locais

```powershell
npm test
```

Os 38 testes unitários usam as implementações de orquestração, agente, parser, consolidação, seleção de tarefas Jira, limites MCP, webhook e formatação com clientes externos simulados. Não precisam de credenciais ou rede e não iniciam o servidor. Verificam o uso de um agente, tokens e auditoria, escopo do contexto, saídas inválidas, consulta de tarefas, falhas HTTP, assinaturas, separação entre cliente e servidor e publicação simulada. Eles não comprovam o protocolo.

Depois de instalar as dependências, executar separadamente:

```powershell
npm run test:mcp
```

Os três testes desse comando passaram localmente. Usam o SDK real, iniciam um servidor filho por stdio e testam `initialize`, descoberta e chamada de ferramenta, incluindo o retorno de erro. O ensaio com o orquestrador confirma também que o contexto recuperado por MCP chega ao agente e à auditoria. O provedor Jira, o modelo, o GitHub e o MongoDB são simulados conforme o teste, sem credenciais nem acesso à rede. O comando falha se o SDK estiver ausente; não há skip automático. Esses testes não comprovam acesso ao Jira real ou publicação no GitHub.

O lockfile herdado não refletia a dependência `openai` do `package.json`. Foi regenerado após a instalação feita por Rafael, e a correspondência entre as dependências declaradas, o lockfile e o SDK instalado `1.29.0` foi conferida. O congelamento completo da configuração da pesquisa ainda depende das verificações com os serviços reais.

Referências: [cliente MCP e stdio no SDK v1](https://ts.sdk.modelcontextprotocol.io/client#stdio-transport), [servidor MCP](https://ts.sdk.modelcontextprotocol.io/server#stdio) e [busca de issues na documentação do Jira](https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-issue-search/#api-rest-api-3-search-jql-post).

Antes da coleta, ainda é necessário verificar o acesso ao Jira real e o fluxo completo após deploy, consolidar as regras e os casos, tratar os demais erros de integração identificados e congelar a configuração utilizada. Esta atualização local não executa deploy nem altera PRs remotos.
