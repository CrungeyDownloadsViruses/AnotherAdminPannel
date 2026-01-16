/**
 * Plugin: Auth Bypass
 * Method: Regex Normalization (Handles Non-Breaking Spaces and Newlines)
 */
export default function authBypass({ backend }) {
  let updatedBackend = backend;

  // This Regex looks for the function header and everything inside it 
  // up until 'return true; }'. 
  // \s* matches any whitespace (tabs, spaces, non-breaking spaces, newlines)
  const functionRegex = /function\s+checkPassword\s*\(\s*req\s*,\s*res\s*\)\s*\{[\s\S]*?return\s+true\s*;\s*\}/;

  const bypassedFunction = `function checkPassword(req, res) {
  // Auth Bypassed for testing
  return true;
}`;

  if (functionRegex.test(updatedBackend)) {
    updatedBackend = updatedBackend.replace(functionRegex, bypassedFunction);
    console.log("✅ Successfully found checkPassword using whitespace-insensitive matching.");
  } else {
    console.warn("❌ Could not find checkPassword with Regex.");
    
    // Fallback: Force-clean the entire file's whitespace if regex failed
    console.log("Attempting hard-format of the file...");
    updatedBackend = updatedBackend.replace(/\u00A0/g, " "); // Replace Non-breaking space with space
  }

  // --- Bonus: Handle WebSocket Auth bypass while we're at it ---
  const wsAuthRegex = /if\s*\(\s*data\.type\s*===\s*"auth"\s*\)\s*\{[\s\S]*?return\s*;\s*\}/;
  const bypassedWsAuth = `if (data.type === "auth") {
      isAuthorized = true;
      authorizedClients.add(ws);
      console.log("Authorized client: ", stringtokens);
      ws.send(JSON.stringify({ type: "auth", success: true }));
      return;
    }`;

  if (wsAuthRegex.test(updatedBackend)) {
    updatedBackend = updatedBackend.replace(wsAuthRegex, bypassedWsAuth);
    console.log("✅ Successfully bypassed WebSocket auth.");
  }

  return {
    backend: updatedBackend
  };
}