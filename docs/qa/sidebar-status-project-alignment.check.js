// Run this read-only browser check in an isolated pnpm dev instance.
// Expand a project containing a root parent with a visible child and a root leaf.
globalThis.checkSidebarStatusProjectAlignment = function (
  projectId,
  parentFeatureId,
  leafFeatureId,
) {
  const requireElement = (selector, root = document) => {
    const element = root.querySelector(selector);
    if (!element) throw new Error(`Missing QA element: ${selector}`);
    return element;
  };
  const featureRow = (id) => requireElement(`[data-nav-type="feature"][data-nav-id="${id}"]`);
  const center = (element) => {
    const rect = element.getBoundingClientRect();
    if (!rect.width || !rect.height) throw new Error("QA element has no visible layout");
    return rect.x + rect.width / 2;
  };
  const assertAligned = (actual, expected, label) => {
    if (Math.abs(actual - expected) > 0.5) {
      throw new Error(`${label}: ${actual}px instead of ${expected}px`);
    }
  };
  const parent = featureRow(parentFeatureId);
  const leaf = featureRow(leafFeatureId);
  for (const row of [parent, leaf]) {
    if (row.dataset.featureDepth !== "0" || row.dataset.navProjectId !== String(projectId)) {
      throw new Error("QA requires two root conversations in the same project");
    }
  }
  const parentGutter = requireElement("[data-feature-hierarchy-gutter]", parent);
  const leafGutter = requireElement("[data-feature-hierarchy-gutter]", leaf);
  requireElement('button[aria-label="Collapse child sessions"]', parentGutter);
  if (leafGutter.childElementCount) throw new Error("QA requires an empty leaf gutter");

  const parentWidth = parentGutter.getBoundingClientRect().width;
  const leafWidth = leafGutter.getBoundingClientRect().width;
  if (!leafWidth) throw new Error("The empty leaf gutter no longer reserves space");
  assertAligned(leafWidth, parentWidth, "Parent/leaf gutter widths");
  const parentCenter = center(requireElement("[data-sidebar-status]", parent));
  const leafCenter = center(requireElement("[data-sidebar-status]", leaf));
  assertAligned(leafCenter, parentCenter, "Parent/leaf status centers");

  const project = requireElement(`[data-nav-type="project"][data-nav-id="${projectId}"]`);
  // Inspect the project badge itself, never the trailing provider identity slot.
  const badge = requireElement("[data-sidebar-project-badge]", project).firstElementChild;
  if (!badge) throw new Error("Missing project badge");
  const projectCenter = center(badge);
  assertAligned(parentCenter, projectCenter, "Parent status/project badge centers");
  assertAligned(leafCenter, projectCenter, "Leaf status/project badge centers");
  return { projectCenter, parentCenter, leafCenter, parentWidth, leafWidth };
};
