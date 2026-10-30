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

async function getRulesDocument(owner, repo, ref) {
  const { data } = await octokit.repos.getContent({ owner, repo, path: 'docs/regras_negocio.md', ref });
  if (!data || Array.isArray(data) || data.type !== 'file' || data.encoding !== 'base64' || !data.content) {
    throw new Error('Business-rule document is unavailable or invalid');
  }
  return Buffer.from(data.content, 'base64').toString('utf8');
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
    `**Regra de negócio violada:** ${comment.rule_id}${comment.rule_summary ? ` — ${comment.rule_summary}` : ''}`,
    ...(comment.jira_issue_key ? [`**Task Jira:** ${comment.rule_source ? `[${comment.jira_issue_key}](${comment.rule_source})` : comment.jira_issue_key}`] : []),
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

  const { data: review } = await octokit.pulls.createReview({
    owner,
    repo,
    pull_number: prNumber,
    commit_id: headSha,
    event: comments.length ? 'REQUEST_CHANGES' : 'APPROVE',
    body: comments.length
      ? `Foram encontrados ${comments.length} achado(s) de regras de negócio. Consulte os comentários desta revisão para corrigir os pontos identificados.`
      : 'Nenhuma violação de regra de negócio foi identificada nesta análise automatizada. Esta aprovação não substitui uma revisão humana.',
  });
  return { state: comments.length ? 'CHANGES_REQUESTED' : 'APPROVED', id: review?.id ?? null };
}

module.exports = { getDiff, getRulesDocument, postReviewComment };
