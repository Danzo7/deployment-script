let activeRl = null;
let rlFactory = null;
let handingOff = false;
function setReplInterface(rl) {
  activeRl = rl;
}
function getActiveRl() {
  return activeRl;
}
function setReplFactory(factory) {
  rlFactory = factory;
}
function isHandingOff() {
  return handingOff;
}
function pauseRepl() {
  if (!activeRl) return;
  handingOff = true;
  activeRl.close();
  activeRl = null;
  if (process.stdin.isTTY) process.stdin.setRawMode?.(false);
}
function resumeRepl() {
  handingOff = false;
  if (!rlFactory) return;
  if (process.stdin.isTTY) process.stdin.setRawMode?.(false);
  process.stdin.resume();
  const rl = rlFactory();
  setReplInterface(rl);
  rl.prompt();
}
export {
  getActiveRl,
  isHandingOff,
  pauseRepl,
  resumeRepl,
  setReplFactory,
  setReplInterface
};
