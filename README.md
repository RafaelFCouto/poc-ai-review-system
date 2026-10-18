# AI Review System

PoC de revisão de Pull Requests com **um único agente de regras de negócio**. O serviço recebe o evento do GitHub, obtém o diff e as regras do projeto, chama o modelo, publica os achados e registra a revisão no MongoDB.

## Fluxo implementado

```text
Webhook do GitHub (PR aberto ou atualizado)
  -> Validação HMAC
  -> Orquestrador
       -> GitHub REST: diff do PR
       -> Jira REST: regras com label business-rule
       -> Agente de regras de negócio: uma chamada ao modelo
       -> Remoção de duplicatas exatas e ordenação por severidade
       -> GitHub: comentários no PR
       -> MongoDB: registro da revisão
```

O arquivo `src/mcp-client.js` ainda acessa diretamente a API REST do Jira. O nome do arquivo e a dependência do SDK MCP não significam que o protocolo MCP esteja implementado. A integração MCP prevista no TCC continua pendente.

## Escopo da revisão

O único agente é `src/agents/business-logic-agent.js`, com instruções em `src/agents/prompts/business-logic.md`. Os agentes e prompts antigos de bugs, code smells e otimização foram retirados.

O agente recebe apenas o diff e as regras de negócio recuperadas. Convenções de estilo em `.review-config/standards.md` não são consultadas. As instruções exigem vínculo com uma regra explícita e evidência no diff, sem criar políticas ou tratar sugestões genéricas como violações de negócio.

Cada achado contém `file`, `line`, `rule_id`, `body`, `severity` e a identificação `agent: business_logic`. A explicação é solicitada em português brasileiro. A identificação da regra é apresentada no comentário publicado.

A consolidação remove apenas repetições exatas de arquivo, linha, regra e explicação, e ordena por severidade. É um procedimento determinístico; não há LLM-as-a-Judge nem comparação entre modelos.

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
| `JIRA_PROJECT_KEY` | Projeto consultado. O exemplo usa `TCC`; sem configuração, o código usa `SALA`. |
| `MONGODB_URI` | Conexão com o MongoDB. |
| `PORT` | Porta HTTP; padrão `4000`. |

Endpoints: `GET /health`, `GET /health-db` e `POST /webhook`. O handler aceita eventos `pull_request` com ações `opened` e `synchronize`. O workflow do repositório-alvo ou um webhook configurado deve encaminhar o evento assinado para `/webhook`.

## Validação e auditoria

Contexto de regras vazio interrompe a análise antes da chamada ao modelo. JSON inválido, saída que não seja um array, campos obrigatórios inválidos ou arquivos fora do diff interrompem a revisão antes da publicação. Um array válido `[]` representa ausência de violações demonstráveis reportadas pelo modelo; não comprova conformidade do código nem suficiência do contexto.

As validações verificam o formato e alguns vínculos estruturais. Não comprovam que a regra citada foi interpretada corretamente ou que o achado é tecnicamente válido. Essa avaliação continua humana.

Após a publicação, o registro em `poc_review.audit_logs` contém PR, repositório, SHA informado pelo evento, modelo, `agents: ["business_logic"]`, comentários, tokens somente desse agente, duração e timestamp. A captura de regras e prompt versionados, das falhas e do resultado individual de publicação permanece pendente.

## Testes locais

```powershell
npm test
```

Os 15 testes usam as implementações de orquestração, agente, parser, consolidação e formatação com clientes externos simulados. Não precisam de credenciais ou rede e não iniciam o servidor. Verificam o uso de um agente, tokens e auditoria, escopo do contexto, saídas inválidas e publicação simulada.

Antes da coleta, ainda é necessário verificar o fluxo real, consolidar as regras e os casos, implementar MCP, tratar os demais erros de integração identificados e congelar a configuração utilizada. Esta atualização local não executa deploy nem altera PRs remotos.
