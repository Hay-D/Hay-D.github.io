const day = 86400000;
const defaults = ['beeswax', 'bolt', 'plank', 'duct-tape', 'diamond-ring', 'blanket', 'necklace', 'bem-set', 'sem-set', 'lem-set', 'butter', 'cheese', 'help'];

export function cleanUsage(value, now = Date.now()) {
  const result = {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) return result;
  for (const [id, entry] of Object.entries(value).slice(0, 1000)) {
    if (!/^[a-z0-9-]{1,80}$/.test(id) || !entry || !Number.isFinite(entry.count) || !Number.isFinite(entry.last) || entry.count < 1 || entry.last < 0) continue;
    result[id] = {count: Math.min(500, Math.floor(entry.count)), last: Math.min(now, entry.last)};
  }
  return result;
}

export function rememberAddition(value, id, now = Date.now()) {
  const next = cleanUsage(value, now);
  if (/^[a-z0-9-]{1,80}$/.test(id)) next[id] = {count: Math.min(500, (next[id]?.count || 0) + 1), last: now};
  return next;
}

export function rankPicker(items, history = {}, favorites = [], now = Date.now()) {
  const usage = cleanUsage(history, now), starred = new Set(favorites);
  const score = item => {
    const entry = usage[item.id];
    return (entry ? (2 + Math.log2(1 + entry.count)) * Math.pow(.5, (now - entry.last) / (21 * day)) : 0) + (starred.has(item.id) ? 1.5 : 0);
  };
  const initial = id => {const index = defaults.indexOf(id); return index < 0 ? defaults.length : index;};
  return [...items].sort((a, b) => score(b) - score(a) || initial(a.id) - initial(b.id) || a.level - b.level || a.name.localeCompare(b.name));
}
