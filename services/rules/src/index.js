export function evaluateRules({ rules, request }) {
  const matched = rules.find((rule) => request.path.startsWith(rule.path));
  if (!matched) return { allow: false, reason: 'no_rule' };

  const requiresAuth = matched.auth === 'required';
  if (requiresAuth && !request.auth?.uid) return { allow: false, reason: 'auth_required' };

  if (matched.ownerField && request.method !== 'read') {
    const owner = request.data?.[matched.ownerField] ?? request.existing?.[matched.ownerField];
    if (owner && owner !== request.auth?.uid) return { allow: false, reason: 'owner_mismatch' };
  }

  if (matched.validation) {
    for (const [field, config] of Object.entries(matched.validation)) {
      const value = request.data?.[field];
      if (config.required && (value === undefined || value === null || value === '')) {
        return { allow: false, reason: `missing_${field}` };
      }
      if (config.type && value !== undefined && typeof value !== config.type) {
        return { allow: false, reason: `invalid_type_${field}` };
      }
      if (config.maxLength && typeof value === 'string' && value.length > config.maxLength) {
        return { allow: false, reason: `max_length_${field}` };
      }
    }
  }

  return { allow: matched.allow !== false, reason: 'ok' };
}

export function runRuleTests({ rules, tests }) {
  return tests.map((testCase) => {
    const result = evaluateRules({ rules, request: testCase.request });
    return {
      name: testCase.name,
      expected: testCase.expectAllow,
      actual: result.allow,
      passed: result.allow === testCase.expectAllow,
      reason: result.reason
    };
  });
}
