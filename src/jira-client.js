const https = require('https');
const { normalizeIssueKeys } = require('./jira-reference');

const JIRA_BASE_URL = process.env.JIRA_BASE_URL;
const JIRA_EMAIL    = process.env.JIRA_EMAIL;
const JIRA_TOKEN    = process.env.JIRA_API_TOKEN;

function jiraPost(path, payload) {
  return new Promise((resolve, reject) => {
    const auth = Buffer.from(`${JIRA_EMAIL}:${JIRA_TOKEN}`).toString('base64');
    const url  = new URL(path, JIRA_BASE_URL);
    const body = JSON.stringify(payload);

    const options = {
      method: 'POST',
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    };

    const req = https.request(url.toString(), options, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          reject(new Error(`Jira request failed (HTTP ${res.statusCode})`));
          return;
        }
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error(`Jira parse error: ${e.message}`)); }
      });
    });

    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function getBusinessContext(projectKey, issueKeys = []) {
  const keys = normalizeIssueKeys(issueKeys);
  const project = typeof projectKey === 'string' ? projectKey.trim().toUpperCase() : '';
  if (!keys.length && !/^[A-Z][A-Z0-9_]*$/.test(project)) {
    throw new Error('Invalid JIRA_PROJECT_KEY');
  }
  const jql = keys.length
    ? `key in (${keys.map(key => '"' + key + '"').join(', ')}) ORDER BY key ASC`
    : `project = ${project} AND labels = business-rule ORDER BY key ASC`;
  const data = await jiraPost('/rest/api/3/search/jql', {
    jql,
    maxResults: keys.length || 20,
    fields:     ['summary', 'description', 'updated'],
  });

  if (!data || !Array.isArray(data.issues)) throw new Error('Invalid Jira response: expected issues array');
  if (data.issues.some(issue => !issue || typeof issue.key !== 'string' ||
      typeof issue.fields?.summary !== 'string')) {
    throw new Error('Invalid Jira issue: expected key and summary');
  }
  let issues = data.issues;
  if (keys.length) {
    const byKey = new Map(issues.map(issue => [issue.key, issue]));
    const missing = keys.filter(key => !byKey.has(key));
    if (missing.length) throw new Error('Jira tasks not found or not accessible: ' + missing.join(', '));
    issues = keys.map(key => byKey.get(key));
  }

  const retrievedAt = new Date().toISOString();
  const rules = issues.map(issue => ({
    key: issue.key,
    summary: issue.fields.summary,
    description: extractText(issue.fields.description),
    source: new URL('/browse/' + encodeURIComponent(issue.key), new URL(JIRA_BASE_URL).origin).toString(),
    updated: issue.fields.updated || null,
  }));
  return {
    businessRules: rules.map(rule => `${rule.key}: ${rule.summary}\n${rule.description}`).join('\n\n'),
    rules,
    retrieved_at: retrievedAt,
    rules_source: keys.length ? 'pr_description' : 'project_label',
    issue_keys: rules.map(rule => rule.key),
  };
}

async function getBusinessRules(projectKey, issueKeys = []) {
  return (await getBusinessContext(projectKey, issueKeys)).businessRules;
}

function extractText(adf) {
  function visit(node) {
    if (typeof node === 'string') return node;
    if (!node) return '';
    if (node.type === 'text') return node.text || '';
    if (node.type === 'hardBreak') return '\n';
    if (!Array.isArray(node.content)) return '';
    const text = node.content.map(visit).join('');
    return ['paragraph', 'heading'].includes(node.type) ? text + '\n' : text;
  }
  return visit(adf).trim();
}

module.exports = { getBusinessRules, getBusinessContext };
