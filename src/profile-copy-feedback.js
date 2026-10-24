// The existing profile-menu button is rendered inside the application shell.
// Capture this one action so copying stays quiet and gives inline confirmation.
document.addEventListener("click", (event) => {
  const target = event.target instanceof Element ? event.target.closest(".profile-menu button") : null;
  if (!target) return;
  if (target.textContent?.trim() === "Log out") {
    localStorage.removeItem("caseconnect_refresh_session");
    return;
  }
  if (target.textContent?.trim() !== "Copy profile URL") return;

  event.preventDefault();
  event.stopPropagation();

  const stored = localStorage.getItem("caseconnect_session");
  const userId = stored ? JSON.parse(stored)?.user?.id : null;
  if (!userId) return;

  navigator.clipboard.writeText(`${window.location.origin}?profile=${userId}`).then(
    () => showCopyState(target, "Copied"),
    () => showCopyState(target, "Could not copy"),
  );
}, true);

function showCopyState(button, message) {
  let status = button.querySelector(".copy-status");
  if (!status) {
    status = document.createElement("small");
    status.className = "copy-status";
    button.append(status);
  }
  status.textContent = message;
  window.setTimeout(() => status?.remove(), 1800);
}
