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

const AGENT_LABEL = {
  bug:            '🐛 Bug Detection',
  code_smell:     '🔍 Code Smell',
  optimization:   '⚡ Optimization',
  business_logic: '📋 Business Logic',
};

const SEVERITY_LABEL = {
  high:   '🔴 High',
  medium: '🟡 Medium',
  low:    '🟢 Low',
};

function formatBody(comment) {
  const agent    = AGENT_LABEL[comment.agent]    || comment.agent.toUpperCase();
  const severity = SEVERITY_LABEL[comment.severity] || comment.severity;
  return [
    `> 🤖 **AI Code Review** — ${agent} | Severity: ${severity}`,
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

async function getStandards(owner, repo) {
  try {
    const { data } = await octokit.repos.getContent({
      owner,
      repo,
      path: '.review-config/standards.md',
    });
    return Buffer.from(data.content, 'base64').toString('utf8');
  } catch {
    return '';
  }
}

module.exports = { getDiff, postReviewComment, getStandards };
