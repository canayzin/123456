function createMetrics() {
  return {
    control_orgs_total: 0,
    control_projects_total: 0,
    control_apikeys_total: 0,
    control_soft_deletes_total: 0,
    control_plan_changes_total: 0
  };
}

module.exports = { createMetrics };
