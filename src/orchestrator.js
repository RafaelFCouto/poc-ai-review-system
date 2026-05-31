const githubClient  = require('./github-client');
const mcpClient     = require('./mcp-client');
const mongoClient   = require('./mongodb-client');
const bugAgent      = require('./agents/bug-agent');
const smellAgent    = require('./agents/smell-agent');
const optAgent      = require('./agents/optimization-agent');
const bizAgent      = require('./agents/business-logic-agent');
const aggregator    = require('./agents/aggregator');

const JIRA_PROJECT_KEY = process.env.JIRA_PROJECT_KEY || 'SALA';

async function run({ owner, repo, prNumber, headSha }) {
  console.log(`[orchestrator] PR #${prNumber} — ${owner}/${repo}`);
  const startTime = Date.now();

  const [diff, businessRules, standards] = await Promise.all([
    githubClient.getDiff(owner, repo, prNumber),
    mcpClient.getBusinessRules(JIRA_PROJECT_KEY),
    githubClient.getStandards(owner, repo),
  ]);

  const diffText = diff
    .map(f => `### ${f.filename}\n${f.patch}`)
    .join('\n\n');

  const [bugResults, smellResults, optResults, bizResults] = await Promise.all([
    bugAgent.analyze(diffText, standards),
    smellAgent.analyze(diffText, standards),
    optAgent.analyze(diffText, standards),
    bizAgent.analyze(diffText, businessRules, standards),
  ]);

  const comments = aggregator.consolidate([
    ...bugResults,
    ...smellResults,
    ...optResults,
    ...bizResults,
  ]);

  await githubClient.postReviewComment(owner, repo, prNumber, headSha, comments);

  await mongoClient.saveAuditLog({
    pr_number:  prNumber,
    repo:       `${owner}/${repo}`,
    sha:        headSha,
    agents:     ['bug', 'code_smell', 'optimization', 'business_logic'],
    comments,
    duration_ms: Date.now() - startTime,
  });

  console.log(`[orchestrator] PR #${prNumber} — ${comments.length} comments posted`);
}

module.exports = { run };
