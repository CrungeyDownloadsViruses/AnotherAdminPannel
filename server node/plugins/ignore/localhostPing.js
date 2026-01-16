/**
 * Plugin: Modify Ping & Localize IP
 * Method: String replacement with space normalization
 */
export default function modifyPing({ backend }) {
  // 1. Normalize the backend first to handle the \xa0 (non-breaking spaces)
  let updatedBackend = backend.replace(/\u00A0/g, " ");

  // --- PART 1: Localize getPublicIP ---
  const originalGetIP = `async function getPublicIP() {
  const response = await fetch("https://api.ipify.org");
  return await response.text();
}`;

  const localGetIP = `async function getPublicIP() {
  // Bypassed by plugin for testing
  return "localhost";
}`;

  if (updatedBackend.includes(originalGetIP)) {
    updatedBackend = updatedBackend.split(originalGetIP).join(localGetIP);
    console.log("✅ getPublicIP() redirected to localhost.");
  } else {
    // Fallback in case spacing inside the function is different
    const getIPRegex = /async function getPublicIP\(\) \{[\s\S]*?return await response\.text\(\);\s*\}/;
    updatedBackend = updatedBackend.replace(getIPRegex, localGetIP);
    console.log("✅ getPublicIP() redirected via Regex fallback.");
  }

  // --- PART 2: Update Node IP References ---
  const replacements = [
    { target: "nodes[i].ip", replacement: "(nodes[i].isMain ? 'localhost:' + PORT : nodes[i].ip)" },
    { target: "n.ip", replacement: "(n.isMain ? 'localhost:' + PORT : n.ip)" }
  ];

  replacements.forEach(({ target, replacement }) => {
    if (updatedBackend.includes(target)) {
      updatedBackend = updatedBackend.split(target).join(replacement);
      console.log(`✅ Injected isMain logic for: ${target}`);
    }
  });

  return {
    backend: updatedBackend
  };
}