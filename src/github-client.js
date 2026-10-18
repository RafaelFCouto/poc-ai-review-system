const { Octokit } = require('@octokit/rest');

const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });

async function getDiff(owner, repo, prNumber) {
  const { data: files } = await octokit.pulls.listFiles({
    owner,
    repo,
    pull_number: prNumber,
  });

  return files.map(f => ({
    filename: f.filename,
    status:   f.status,
    patch:    f.patch || '',
  }));
}

const AGENT_LABEL = '📋 Business Rules';

const SEVERITY_LABEL = {
  high:   '🔴 High',
  medium: '🟡 Medium',
  low:    '🟢 Low',
};

const LLM_MODEL = () => process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';

function formatBody(comment) {
  const severity = SEVERITY_LABEL[comment.severity]  || comment.severity;
  return [
    `> 🤖 **AI Code Review** — ${AGENT_LABEL} | Rule: \`${comment.rule_id}\` | Severity: ${severity} | Model: \`${LLM_MODEL()}\``,
    '',
    comment.body,
  ].join('\n');
}

async function postReviewComment(owner, repo, prNumber, headSha, comments) {
  for (const comment of comments) {
    try {
      await octokit.pulls.createReviewComment({
        owner,
        repo,
        pull_number: prNumber,
        commit_id:   headSha,
        path:        comment.file,
        line:        comment.line,
        body:        formatBody(comment),
      });
    } catch {
      await octokit.issues.createComment({
        owner,
        repo,
        issue_number: prNumber,
        body: `${formatBody(comment)}\n\n> \`${comment.file}\``,
      });
    }
  }
}

module.exports = { getDiff, postReviewComment };
