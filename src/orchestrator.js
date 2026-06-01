const githubClient  = require('./github-client');
const mcpClient     = require('./mcp-client');
const mongoClient   = require('./mongodb-client');
const bugAgent      = require('./agents/bug-agent');
const smellAgent    = require('./agents/smell-agent');
const optAgent      = require('./agents/optimization-agent');
const bizAgent      = require('./agents/business-logic-agent');
const aggregator    = require('./agents/aggregator');

const JIRA_PROJECT_KEY = process.env.JIRA_PROJECT_KEY || 'SALA';
const LLM_MODEL        = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';

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

  const [bugRes, smellRes, optRes, bizRes] = await Promise.all([
    bugAgent.analyze(diffText, standards),
    smellAgent.analyze(diffText, standards),
    optAgent.analyze(diffText, standards),
    bizAgent.analyze(diffText, businessRules, standards),
  ]);

  const totalTokens = [bugRes, smellRes, optRes, bizRes].reduce((acc, r) => ({
    prompt: acc.prompt + (r.tokens?.prompt ?? 0),
    output: acc.output + (r.tokens?.output ?? 0),
    total:  acc.total  + (r.tokens?.total  ?? 0),
  }), { prompt: 0, output: 0, total: 0 });

  console.log(`[orchestrator] PR #${prNumber} — tokens total — prompt: ${totalTokens.prompt}, output: ${totalTokens.output}, total: ${totalTokens.total}`);

  const comments = aggregator.consolidate([
    ...bugRes.comments,
    ...smellRes.comments,
    ...optRes.comments,
    ...bizRes.comments,
  ]);

  await githubClient.postReviewComment(owner, repo, prNumber, headSha, comments);

  await mongoClient.saveAuditLog({
    pr_number:   prNumber,
    repo:        `${owner}/${repo}`,
    sha:         headSha,
    model:       LLM_MODEL,
    agents:      ['bug', 'code_smell', 'optimization', 'business_logic'],
    comments,
    tokens:      totalTokens,
    duration_ms: Date.now() - startTime,
  });

  console.log(`[orchestrator] PR #${prNumber} — ${comments.length} comments posted`);
}

module.exports = { run };
