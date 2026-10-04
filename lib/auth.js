// Shared authentication middleware.
//
// Both the bank APIs and the Mobile Club Nord APIs hand out a batch of API keys
// (one per trainee/team) so the instructor can tell who is calling and revoke a
// single key without affecting the class. Each service gets its OWN key set, so
// a cohort working on one use case can't accidentally authenticate against the
// other — and keys can be rotated per week.

/**
 * Reads a comma-separated key list from an env var, falling back to defaults.
 */
function loadKeys(envVarName, defaults) {
  return (process.env[envVarName] || defaults.join(","))
    .split(",")
    .map((k) => k.trim())
    .filter(Boolean);
}

/**
 * Builds an x-api-key middleware for a given key set.
 * `label` appears in the error message so trainees can tell which service
 * rejected them when they are wiring up several connectors at once.
 */
function apiKeyGuard(keys, label) {
  return function (req, res, next) {
    const key = req.headers["x-api-key"];
    if (!key || !keys.includes(key)) {
      return res.status(401).json({
        error: "unauthorized",
        message: `Missing or invalid x-api-key header for ${label}`,
      });
    }
    req.apiKey = key;
    next();
  };
}

/** Generates a batch of predictable team keys, e.g. mcn-team01-… */
function teamKeys(prefix, suffixes) {
  return suffixes.map((s, i) => `${prefix}-team${String(i + 1).padStart(2, "0")}-${s}`);
}

module.exports = { loadKeys, apiKeyGuard, teamKeys };
