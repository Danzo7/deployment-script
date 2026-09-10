function getCurrentUser() {
  return process.env.DM_REMOTE_USER || "system";
}
function isRemoteSession() {
  return !!process.env.DM_REMOTE_USER;
}
export {
  getCurrentUser,
  isRemoteSession
};
