const q = new URLSearchParams(location.search);
const labels = { navigate: "navigate", read_page_content: "read the page", click: "click", type: "type text", execute_javascript: "run JavaScript", upload: "upload a file" };
document.getElementById("type").textContent = labels[q.get("type")] || q.get("type");
document.getElementById("host").textContent = q.get("host");
document.getElementById("detail").textContent = q.get("detail") || q.get("url");
for (const choice of ["once", "always", "always_site", "deny"]) {
  document.getElementById(choice).addEventListener("click", () => {
    chrome.runtime.sendMessage({ type: "TCA_PERMISSION_ANSWER", id: q.get("id"), choice });
  });
}
window.__tcaReady = true;
