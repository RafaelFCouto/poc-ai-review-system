const SEVERITY_ORDER = { high: 0, medium: 1, low: 2 };

function consolidate(comments) {
  const seen    = new Set();
  const unique  = [];

  for (const comment of comments) {
    const key = `${comment.file}:${comment.line}:${comment.body.slice(0, 60)}`;
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(comment);
    }
  }

  return unique.sort((a, b) => {
    const sa = SEVERITY_ORDER[a.severity] ?? 2;
    const sb = SEVERITY_ORDER[b.severity] ?? 2;
    return sa - sb;
  });
}

module.exports = { consolidate };
