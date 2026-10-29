// One-time tokens arrive in emailed links. They are read once at load and removed from the address bar
// immediately, so they don't linger in history, screenshots or Referer headers.
//   new links:      /#reset=<token>   /#verify=<token>   (fragments are never sent to any server)
//   links emailed by older versions:  /?reset=<token>     (still honoured while they are valid)
function takeUrlTokens() {
  const fromHash = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  const fromQuery = new URLSearchParams(window.location.search);
  const reset = fromHash.get('reset') || fromQuery.get('reset') || '';
  const verify = fromHash.get('verify') || '';
  if (reset || verify) window.history.replaceState({}, '', window.location.pathname);
  return { reset, verify };
}

export const URL_TOKENS = takeUrlTokens();
