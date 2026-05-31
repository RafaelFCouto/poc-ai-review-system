const https = require('https');

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
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error(`Jira parse error: ${e.message}`)); }
      });
    });

    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function getBusinessRules(projectKey) {
  const data = await jiraPost('/rest/api/3/search/jql', {
    jql:        `project = ${projectKey} AND labels = business-rule ORDER BY key ASC`,
    maxResults: 20,
    fields:     ['summary', 'description'],
  });

  if (!data.issues || data.issues.length === 0) return '';

  return data.issues
    .map(issue => {
      const summary     = issue.fields.summary;
      const description = extractText(issue.fields.description);
      return `${issue.key}: ${summary}\n${description}`;
    })
    .join('\n\n');
}

function extractText(adf) {
  if (!adf || !adf.content) return '';
  const lines = [];
  for (const block of adf.content) {
    if (block.content) {
      lines.push(block.content.map(n => n.text || '').join(''));
    }
  }
  return lines.join('\n');
}

module.exports = { getBusinessRules };
