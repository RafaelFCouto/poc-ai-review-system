const githubClient  = require('./github-client');
const mcpClient     = require('./mcp-client');
const mongoClient   = require('./mongodb-client');
const bizAgent      = require('./agents/business-logic-agent');
const aggregator    = require('./agents/aggregator');
const { MODEL }     = require('./agents/llm-client');
const { extractIssueKeys } = require('./jira-reference');
const businessRules = require('./business-rules.json');

const JIRA_PROJECT_KEY = process.env.JIRA_PROJECT_KEY || 'SALA';

async function run({ owner, repo, prNumber, headSha, prDescription = '' }) {
  console.log(`[orchestrator] PR #${prNumber} — ${owner}/${repo}`);
  const startTime = Date.now();
  const jiraIssueKeys = extractIssueKeys(prDescription);
  const rulesSource = jiraIssueKeys.length ? 'pr_description' : 'project_label';
  console.log(`[orchestrator] Jira context: ${jiraIssueKeys.length ? jiraIssueKeys.join(', ') : JIRA_PROJECT_KEY + ' / business-rule'}`);

  const [diff, retrievedContext] = await Promise.all([
    githubClient.getDiff(owner, repo, prNumber),
    mcpClient.getBusinessContext(JIRA_PROJECT_KEY, jiraIssueKeys),
  ]);

  if (!retrievedContext.businessRules.trim()) {
    throw new Error('Business-rule review requires non-empty business rules');
  }
  // The catalog supplies stable RN identities; rule details still come from Jira via MCP.
  const catalogByKey = new Map(businessRules.map(rule => [rule.jira_key, rule]));
  const rules = retrievedContext.rules.map(rule => {
    const catalogRule = catalogByKey.get(rule.key);
    if (!catalogRule) throw new Error('Jira task has no RN mapping in business-rules.json: ' + rule.key);
    return { ...rule, id: catalogRule.id, title: catalogRule.title };
  });
  const context = { ...retrievedContext, rules,
    businessRules: rules.map(rule => `${rule.id}: ${rule.title}\nJira: ${rule.key}\n${rule.summary}\n${rule.description || ''}`).join('\n\n') };

  const diffText = diff
    .map(f => `### ${f.filename}\n${f.patch}`)
    .join('\n\n');

  console.log(`[orchestrator] MCP ${context.mcp.transport} / ${context.mcp.protocol_version}: ${context.issue_keys.join(', ')}`);
  const bizRes = await bizAgent.analyze(diffText, context.businessRules);

  const totalTokens = {
    prompt: bizRes.tokens?.prompt ?? 0,
    output: bizRes.tokens?.output ?? 0,
    total:  bizRes.tokens?.total ?? 0,
  };

  console.log(`[orchestrator] PR #${prNumber} — tokens total — prompt: ${totalTokens.prompt}, output: ${totalTokens.output}, total: ${totalTokens.total}`);

  const rulesById = new Map(context.rules.map(rule => [rule.id, rule]));
  const comments = aggregator.consolidate(bizRes.comments).map(comment => {
    const rule = rulesById.get(comment.rule_id);
    if (!rule) {
      throw new Error('Business-rule finding references a rule outside the Jira context: ' + comment.rule_id);
    }
    return { ...comment, rule_summary: rule.title, rule_source: rule.source, jira_issue_key: rule.key };
  });
  const changedFiles = new Set(diff.map(file => file.filename));
  if (comments.some(comment => !changedFiles.has(comment.file))) {
    throw new Error('Business-rule finding references a file outside the PR diff');
  }

  await githubClient.postReviewComment(owner, repo, prNumber, headSha, comments);

  await mongoClient.saveAuditLog({
    pr_number:   prNumber,
    repo:        `${owner}/${repo}`,
    sha:         headSha,
    model:       MODEL,
    agents:      ['business_logic'],
    jira_issue_keys: jiraIssueKeys,
    rules_source: rulesSource,
    business_context: context,
    comments,
    tokens:      totalTokens,
    duration_ms: Date.now() - startTime,
  });

  console.log(`[orchestrator] PR #${prNumber} — ${comments.length} comments posted`);
}

module.exports = { run };
