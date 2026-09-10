const REGISTRY = /* @__PURE__ */ new Map();
function registerHandler(handler) {
  REGISTRY.set(handler.typeKey, handler);
}
function getHandler(projectType) {
  const handler = REGISTRY.get(projectType);
  if (!handler) {
    const registered = Array.from(REGISTRY.keys()).join(", ");
    throw new Error(
      `Unknown project type: "${projectType}". Registered types: ${registered}`
    );
  }
  return handler;
}
function getRegisteredTypes() {
  return Array.from(REGISTRY.keys());
}
async function detectAppType(dir) {
  const scores = [];
  for (const [projectType, handler] of REGISTRY) {
    const score = await handler.detect(dir);
    scores.push({ projectType, score });
  }
  scores.sort((a, b) => b.score - a.score);
  const top = scores[0];
  const second = scores[1];
  if (!top || top.score <= 50) {
    return { projectType: null, score: top?.score ?? 0, ambiguous: false };
  }
  const ambiguous = second !== void 0 && second.score > 50 && top.score - second.score <= 10;
  return {
    projectType: top.projectType,
    score: top.score,
    ambiguous,
    ...ambiguous ? { candidates: [top, second] } : {}
  };
}
export {
  detectAppType,
  getHandler,
  getRegisteredTypes,
  registerHandler
};
