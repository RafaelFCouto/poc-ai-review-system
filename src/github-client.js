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
        body:        `**[${comment.agent.toUpperCase()}]** ${comment.body}`,
      });
    } catch {
      await octokit.issues.createComment({
        owner,
        repo,
        issue_number: prNumber,
        body: `**[${comment.agent.toUpperCase()}]** \`${comment.file}\` — ${comment.body}`,
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
