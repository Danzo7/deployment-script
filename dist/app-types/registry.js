const REGISTRY = new Map();
/**
 * Register a handler using its own typeKey.
 * The handler declares its own key — callers just pass the handler object.
 */
export function registerHandler(handler) {
    REGISTRY.set(handler.typeKey, handler);
}
/**
 * Returns the handler for the given projectType key.
 * Throws a descriptive error if the type is not registered.
 */
export function getHandler(projectType) {
    const handler = REGISTRY.get(projectType);
    if (!handler) {
        const registered = Array.from(REGISTRY.keys()).join(', ');
        throw new Error(`Unknown project type: "${projectType}". Registered types: ${registered}`);
    }
    return handler;
}
/**
 * Returns all registered project type keys.
 */
export function getRegisteredTypes() {
    return Array.from(REGISTRY.keys());
}
/**
 * Runs every registered handler's detect() against the given directory
 * and returns the best match as a DetectionResult.
 */
export async function detectAppType(dir) {
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
    const ambiguous = second !== undefined &&
        second.score > 50 &&
        top.score - second.score <= 10;
    return {
        projectType: top.projectType,
        score: top.score,
        ambiguous,
        ...(ambiguous ? { candidates: [top, second] } : {}),
    };
}
