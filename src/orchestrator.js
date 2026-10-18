const githubClient  = require('./github-client');
const mcpClient     = require('./mcp-client');
const mongoClient   = require('./mongodb-client');
const bizAgent      = require('./agents/business-logic-agent');
const aggregator    = require('./agents/aggregator');
const { MODEL }     = require('./agents/llm-client');

const JIRA_PROJECT_KEY = process.env.JIRA_PROJECT_KEY || 'SALA';

async function run({ owner, repo, prNumber, headSha }) {
  console.log(`[orchestrator] PR #${prNumber} — ${owner}/${repo}`);
  const startTime = Date.now();

  const [diff, businessRules] = await Promise.all([
    githubClient.getDiff(owner, repo, prNumber),
    mcpClient.getBusinessRules(JIRA_PROJECT_KEY),
  ]);

  const diffText = diff
    .map(f => `### ${f.filename}\n${f.patch}`)
    .join('\n\n');

  const bizRes = await bizAgent.analyze(diffText, businessRules);

  const totalTokens = {
    prompt: bizRes.tokens?.prompt ?? 0,
    output: bizRes.tokens?.output ?? 0,
    total:  bizRes.tokens?.total ?? 0,
  };

  console.log(`[orchestrator] PR #${prNumber} — tokens total — prompt: ${totalTokens.prompt}, output: ${totalTokens.output}, total: ${totalTokens.total}`);

  const comments = aggregator.consolidate(bizRes.comments);
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
    comments,
    tokens:      totalTokens,
    duration_ms: Date.now() - startTime,
  });

  console.log(`[orchestrator] PR #${prNumber} — ${comments.length} comments posted`);
}

module.exports = { run };
