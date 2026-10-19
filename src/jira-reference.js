const ISSUE_KEY = /^[A-Z][A-Z0-9_]*-[1-9]\d*$/;
const MAX_ISSUE_KEYS = 20;

function normalizeIssueKeys(keys) {
  if (!Array.isArray(keys)) throw new Error('Jira references must be an array');
  const normalized = keys.map(key => {
    if (typeof key !== 'string' || !ISSUE_KEY.test(key.trim().toUpperCase())) {
      throw new Error('Invalid Jira reference: use Jira: TCC-9 or Jira: TCC-5, TCC-3');
    }
    return key.trim().toUpperCase();
  });
  const unique = [...new Set(normalized)];
  if (unique.length > MAX_ISSUE_KEYS) throw new Error('Use at most ' + MAX_ISSUE_KEYS + ' Jira references');
  return unique;
}

function extractIssueKeys(description = '') {
  if (description === null) return [];
  if (typeof description !== 'string') throw new Error('PR description must be a string');
  const matches = [...description.matchAll(/^\s*Jira:[ \t]*(.*)$/gim)];
  if (matches.length === 0) return [];
  return normalizeIssueKeys(matches.flatMap(match => match[1].split(',')));
}

module.exports = { extractIssueKeys, normalizeIssueKeys };
