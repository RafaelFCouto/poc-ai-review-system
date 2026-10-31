const githubClient  = require('./github-client');
const mcpClient     = require('./mcp-client');
const mongoClient   = require('./mongodb-client');
const bizAgent      = require('./agents/business-logic-agent');
const aggregator    = require('./agents/aggregator');
const { MODEL }     = require('./agents/llm-client');
const { extractIssueKeys } = require('./jira-reference');

const JIRA_PROJECT_KEY = process.env.JIRA_PROJECT_KEY || 'SALA';

async function run({ owner, repo, prNumber, headSha, prDescription = '' }) {
  console.log(`[orchestrator] PR #${prNumber} — ${owner}/${repo}`);
  const startTime = Date.now();
  const jiraIssueKeys = extractIssueKeys(prDescription);
  const rulesSource = jiraIssueKeys.length ? 'pr_description' : 'project_label';
  console.log(`[orchestrator] Jira context: ${jiraIssueKeys.length ? jiraIssueKeys.join(', ') : JIRA_PROJECT_KEY + ' / business-rule'}`);

  const [diff, rulesDocument, retrievedContext] = await Promise.all([
    githubClient.getDiff(owner, repo, prNumber),
    githubClient.getRulesDocument(owner, repo, headSha),
    mcpClient.getBusinessContext(JIRA_PROJECT_KEY, jiraIssueKeys),
  ]);

  if (!retrievedContext.businessRules.trim() || !rulesDocument.trim()) {
    throw new Error('Business-rule review requires non-empty business rules');
  }
  const context = { ...retrievedContext, rules_document: rulesDocument,
    businessRules: `## PRD: docs/regras_negocio.md\n${rulesDocument}\n\n## Jira tasks\n${retrievedContext.businessRules}` };

  const diffText = diff
    .map(f => `### ${f.filename}\n${f.patch}`)
    .join('\n\n');
  console.log(`[orchestrator] MCP ${context.mcp.transport} / ${context.mcp.protocol_version}: ${context.issue_keys.join(', ')}`);
  console.log(`[orchestrator] Review input chars — PRD: ${rulesDocument.length}, Jira: ${retrievedContext.businessRules.length}, diff: ${diffText.length}`);
  const bizRes = await bizAgent.analyze(diffText, context.businessRules);

  const totalTokens = {
    prompt: bizRes.tokens?.prompt ?? 0,
    output: bizRes.tokens?.output ?? 0,
    total:  bizRes.tokens?.total ?? 0,
  };

  console.log(`[orchestrator] PR #${prNumber} — tokens total — prompt: ${totalTokens.prompt}, output: ${totalTokens.output}, total: ${totalTokens.total}`);

  const rulesByKey = new Map(context.rules.map(rule => [rule.key, rule]));
  const knownRuleIds = new Set([...rulesDocument.matchAll(/^## (RN-\d+)\b/gm)].map(match => match[1]));
  const comments = aggregator.consolidate(bizRes.comments).map(comment => {
    const rule = rulesByKey.get(comment.jira_issue_key);
    if (!rule || !knownRuleIds.has(comment.rule_id)) {
      throw new Error('Business-rule finding references a rule or Jira task outside the supplied context');
    }
    return { ...comment, rule_summary: rule.summary, rule_source: rule.source };
  });
  const changedFiles = new Set(diff.map(file => file.filename));
  if (comments.some(comment => !changedFiles.has(comment.file))) {
    throw new Error('Business-rule finding references a file outside the PR diff');
  }

  const review = await githubClient.postReviewComment(owner, repo, prNumber, headSha, comments);

  await mongoClient.saveAuditLog({
    pr_number:   prNumber,
    repo:        `${owner}/${repo}`,
    sha:         headSha,
    model:       MODEL,
    prompt:      bizRes.prompt,
    agents:      ['business_logic'],
    jira_issue_keys: jiraIssueKeys,
    rules_source: rulesSource,
    business_context: context,
    comments,
    review,
    tokens:      totalTokens,
    duration_ms: Date.now() - startTime,
  });

  console.log(`[orchestrator] PR #${prNumber} — ${comments.length} comments posted`);
}

module.exports = { run };
