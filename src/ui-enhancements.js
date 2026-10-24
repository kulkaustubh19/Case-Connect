import { deleteManagedUser, getCaseProgress, getManageableUsers, getSecureCaseCatalogue, setManagedUserRole } from "./supabase.js";

const domainLabels = ["Consulting", "Product Management", "Marketing"];
const industryOptions = ["Aerospace & Defence", "Agriculture", "Automotive", "Banking", "Chemicals", "Construction & Real Estate", "Consumer Goods", "Education", "Energy & Utilities", "E-commerce", "Financial Services", "Food & Beverage", "Government & Public Sector", "Healthcare & Pharmaceuticals", "Hospitality", "Insurance", "Logistics & Supply Chain", "Manufacturing", "Media & Entertainment", "Metals & Mining", "Mobility", "Professional Services", "Retail", "SaaS", "Technology", "Telecommunications", "Travel & Tourism"];
const caseTypesByDomain = {
  "Consulting": ["Profitability", "Market Entry", "Pricing", "M&A and Due Diligence", "Unconventional", "Guesstimates"],
  "Product Management": ["Product Design", "App Improvement", "RCA", "Guesstimates"],
  "Marketing": ["Campaign Planning", "Guesstimates", "Market Entry"],
};
let homeRequestKey = "";
let scheduled = false;
const selectedCaseTypeByDomain = {};
const escapeHtml = (value) => String(value).replace(/[&<>"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[character]));

function setReactSelect(select, value) {
  Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set?.call(select, value);
  select.dispatchEvent(new Event("change", { bubbles: true }));
}

function enhancePractice() {
  const heading = [...document.querySelectorAll(".intro h1")].find((element) => /practise cases|saved cases/i.test(element.textContent ?? ""));
  if (!heading) return;
  const page = heading.closest(".page"), domainSelect = page?.querySelector(".filters select:last-child");
  const industrySelect = (page?.querySelectorAll(".filters select") ?? [])[2];
  if (industrySelect && !industrySelect.dataset.expandedIndustries) {
    const current = industrySelect.value || "All industries";
    industrySelect.innerHTML = `<option>All industries</option>${industryOptions.map(item => `<option>${escapeHtml(item)}</option>`).join("")}<option>Other</option>`;
    industrySelect.value = industryOptions.includes(current) ? current : "All industries";
    industrySelect.dataset.expandedIndustries = "true";
  }
  if (!page || !domainSelect || page.querySelector(".case-domain-tabs")) return;
  if (domainSelect.value === "All domains") { setReactSelect(domainSelect, "Consulting"); return; }
  const guidance = page.querySelector(".result span");
  if (guidance) guidance.textContent = "Filter by type, difficulty, company, title or industry";
  const tabs = document.createElement("div");
  tabs.className = "case-domain-tabs";
  domainLabels.forEach((domain) => {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = domain;
    button.className = domainSelect.value === domain || (domainSelect.value === "All domains" && domain === "Consulting") ? "active" : "";
    button.addEventListener("click", () => {
      tabs.querySelectorAll("button").forEach((tab) => tab.classList.toggle("active", tab === button));
      setReactSelect(domainSelect, domain);
      window.setTimeout(() => { enhancePractice(); enhanceDomainCaseTypes(); }, 0);
    });
    tabs.append(button);
  });
  page.querySelector(".intro")?.after(tabs);
}

function enhanceDomainCaseTypes() {
  const heading = [...document.querySelectorAll(".intro h1")].find((element) => /practise cases|saved cases/i.test(element.textContent ?? ""));
  const page = heading?.closest(".page"), aside = page?.querySelector(".catalogue aside"), domainSelect = page?.querySelector(".filters select:last-child");
  if (!page || !aside || !domainSelect) return;
  if (!domainSelect.dataset.domainCaseTypes) {
    domainSelect.dataset.domainCaseTypes = "true";
    domainSelect.addEventListener("change", () => window.setTimeout(enhanceDomainCaseTypes, 0));
  }
  const domain = domainSelect.value;
  const types = caseTypesByDomain[domain];
  if (!types) return;
  let filters = aside.querySelector(".domain-case-types");
  if (!filters) {
    [...aside.querySelectorAll("button, hr, small")].forEach((element) => { element.style.display = "none"; });
    filters = document.createElement("div");
    filters.className = "domain-case-types";
    aside.append(filters);
  }
  const apply = (selected) => {
    selectedCaseTypeByDomain[domain] = selected;
    filters.querySelectorAll("button").forEach((button) => button.classList.toggle("type-selected", button.dataset.type === selected));
    const cards = [...page.querySelectorAll(".card")];
    cards.forEach((card) => { const type = card.querySelector(".badge.blue")?.textContent?.trim(); card.style.display = selected === "All case types" || type === selected ? "" : "none"; });
    const count = cards.filter((card) => card.style.display !== "none").length;
    const result = page.querySelector(".result b");
    if (result) result.textContent = `${count} case${count === 1 ? "" : "s"}`;
  };
  filters.innerHTML = `<h3>Case type</h3>${["All case types", ...types].map((type, index) => `<button type="button" data-type="${escapeHtml(type)}"><span>${index ? index : "•"}</span>${escapeHtml(type)}</button>`).join("")}`;
  filters.querySelectorAll("button").forEach((button) => button.addEventListener("click", () => apply(button.dataset.type)));
  apply(selectedCaseTypeByDomain[domain] ?? "All case types");
}

function enhancePeerSearch() {
  const heading = [...document.querySelectorAll(".intro h1")].find((element) => element.textContent?.trim() === "Peer practice");
  const page = heading?.closest(".page"), search = page?.querySelector(".search input"), grid = page?.querySelector(".peer-grid > div");
  if (!search || !grid) return;
  search.placeholder = "Search with name or email ID";
  if (!grid.querySelector(".peer-empty-default")) {
    const empty = document.createElement("div");
    empty.className = "panel peer-empty-default";
    empty.innerHTML = "<b>No previous peer-practice bookings yet.</b><p class=\"empty-copy\">Search with a member’s name or email ID to send your first request.</p>";
    grid.append(empty);
  }
}

function summaryCard(title, entries) {
  return `<div class="panel stat"><h3>${escapeHtml(title)}</h3>${entries.map(([label, count]) => `<div class="metric"><span>${escapeHtml(label)}</span><b>${count}</b><i><em style="width:${count ? Math.min(100, count * 48) : 0}%"></em></i></div>`).join("")}</div>`;
}

async function enhanceHomeSummary() {
  const hero = document.querySelector(".hero");
  if (!hero || document.querySelector(".shared-profile")) return;
  const session = JSON.parse(localStorage.getItem("caseconnect_session") ?? "null");
  if (!session?.accessToken || !session?.user?.id || homeRequestKey === session.user.id) return;
  homeRequestKey = session.user.id;
  try {
    const [catalogue, progress] = await Promise.all([getSecureCaseCatalogue(session.accessToken), getCaseProgress(session.accessToken, session.user.id)]);
    const complete = new Set(progress.map((item) => item.case_id)), oldStats = hero.parentElement?.querySelector(":scope > .stats");
    if (!oldStats) return;
    oldStats.style.display = "none";
    let container = hero.parentElement?.querySelector("#domain-summaries");
    if (!container) { container = document.createElement("section"); container.id = "domain-summaries"; oldStats.after(container); }
    container.innerHTML = domainLabels.map((domain) => {
      const solved = catalogue.filter((item) => item.domain === domain && complete.has(item.id));
      const source = catalogue.filter((item) => item.domain === domain);
      const companies = [...new Set(source.map((item) => item.company))].slice(0, 3), industries = [...new Set(source.map((item) => item.industry))].slice(0, 3);
      return `<div class="domain-summary"><h2>${escapeHtml(domain)}</h2><p>${solved.length} solved case${solved.length === 1 ? "" : "s"}</p><div class="stats">${summaryCard("By case type", caseTypesByDomain[domain].map((type) => [type, solved.filter((item) => item.type === type).length]))}${summaryCard("By difficulty", ["Beginner", "Intermediate", "Advanced"].map((difficulty) => [difficulty, solved.filter((item) => item.difficulty === difficulty).length]))}${summaryCard("By company", companies.map((company) => [company, solved.filter((item) => item.company === company).length]))}${summaryCard("By industry", industries.map((industry) => [industry, solved.filter((item) => item.industry === industry).length]))}</div></div>`;
    }).join("");
  } catch { homeRequestKey = ""; }
}

let permissionsPanel = null;
function initials(name = "") { return name.split(" ").map(word => word[0]).join("").slice(0, 2).toUpperCase() || "CC"; }
async function enhancePermissions() {
  const heading = [...document.querySelectorAll(".intro h1")].find(element => element.textContent?.trim() === "Manage Permissions");
  const panel = heading?.closest(".page")?.querySelector(".permission-list");
  const session = JSON.parse(localStorage.getItem("caseconnect_session") ?? "null");
  if (!panel || !session?.accessToken || permissionsPanel === panel) return;
  permissionsPanel = panel;
  try {
    const users = await getManageableUsers(session.accessToken);
    const render = () => {
      panel.innerHTML = users.map(user => `<div><span class="avatar">${escapeHtml(initials(user.full_name || user.email))}</span><section><b>${escapeHtml(user.full_name || "Profile incomplete")}</b><small>${escapeHtml(user.email)}</small></section><span class="badge ${user.role === "Admin" ? "blue" : ""}">${escapeHtml(user.role)}</span><button class="secondary" data-role-user="${escapeHtml(user.id)}" data-role="${user.role === "Admin" ? "User" : "Admin"}">${user.role === "Admin" ? "Remove admin" : "Make admin"}</button><button class="danger" data-remove-user="${escapeHtml(user.id)}">Remove user</button></div>`).join("") || "<p class=\"empty-copy\">No members yet.</p>";
      panel.querySelectorAll("[data-role-user]").forEach(button => button.addEventListener("click", async () => {
        button.disabled = true;
        try { await setManagedUserRole(session.accessToken, button.dataset.roleUser, button.dataset.role); const user = users.find(item => item.id === button.dataset.roleUser); if (user) user.role = button.dataset.role; render(); }
        catch (error) { alert(error.message); button.disabled = false; }
      }));
      panel.querySelectorAll("[data-remove-user]").forEach(button => button.addEventListener("click", async () => {
        if (!window.confirm("Remove this user and their access permanently?")) return;
        button.disabled = true;
        try { await deleteManagedUser(session.accessToken, button.dataset.removeUser); const index = users.findIndex(user => user.id === button.dataset.removeUser); if (index >= 0) users.splice(index, 1); render(); }
        catch (error) { alert(error.message); button.disabled = false; }
      }));
    };
    render();
  } catch (error) {
    panel.innerHTML = `<p class="auth-error">${escapeHtml(error.message || "Could not load users.")}</p>`;
  }
}

function profileFieldsMarkup() {
  return `<div class="profile-signup-fields"><label>Work experience — years<input name="workYears" type="number" min="0" max="60" value="0" required></label><label>Work experience — months<input name="workMonths" type="number" min="0" max="11" value="0" required></label><label>Work experience industry<select name="profileIndustry">${industryOptions.map(item => `<option>${escapeHtml(item)}</option>`).join("")}<option>Other</option></select></label><label class="profile-other-industry" hidden>Specify industry<input name="profileIndustryOther" placeholder="Type the industry"></label></div>`;
}
function enhanceSignupProfileFields() {
  const card = document.querySelector(".auth-card"), form = card?.querySelector("form");
  if (!card || !form || !/CREATE YOUR ACCOUNT/i.test(card.querySelector(".eyebrow")?.textContent ?? "")) return;
  if (!form.querySelector(".profile-signup-fields")) {
    // Keep the submit action as the final control in the sign-up flow. The
    // profile information is required before an account can be created.
    const insertionPoint = form.querySelector(".auth-error") || form.querySelector(".primary.full");
    insertionPoint?.insertAdjacentHTML("beforebegin", profileFieldsMarkup());
    const industry = form.querySelector("[name=profileIndustry]"), other = form.querySelector(".profile-other-industry");
    industry.addEventListener("change", () => { other.hidden = industry.value !== "Other"; other.querySelector("input").required = industry.value === "Other"; });
    form.addEventListener("submit", () => {
      const selectedIndustry = industry.value === "Other" ? form.querySelector("[name=profileIndustryOther]").value.trim() : industry.value;
      localStorage.setItem("caseconnect_pending_profile", JSON.stringify({ work_experience: `${form.querySelector("[name=workYears]").value} years, ${form.querySelector("[name=workMonths]").value} months`, industry: selectedIndustry }));
    }, { once: true });
  }
}
let onboardingForUser = "";
async function enhanceProfileOnboarding() {
  const session = JSON.parse(localStorage.getItem("caseconnect_session") ?? "null");
  if (!session?.accessToken || !session?.user?.id || onboardingForUser === session.user.id) return;
  const baseUrl = import.meta.env.VITE_SUPABASE_URL, anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
  if (!baseUrl || !anonKey) return;
  const headers = { apikey: anonKey, Authorization: `Bearer ${session.accessToken}`, "Content-Type": "application/json" };
  try {
    const response = await fetch(`${baseUrl}/rest/v1/profiles?id=eq.${encodeURIComponent(session.user.id)}&select=id,full_name,work_experience,industry`, { headers });
    const [profile] = await response.json();
    if (!profile) return;
    const pending = JSON.parse(localStorage.getItem("caseconnect_pending_profile") ?? "null");
    if (pending?.work_experience && pending?.industry) {
      await fetch(`${baseUrl}/rest/v1/profiles?id=eq.${encodeURIComponent(session.user.id)}`, { method: "PATCH", headers, body: JSON.stringify(pending) });
      localStorage.removeItem("caseconnect_pending_profile");
      onboardingForUser = session.user.id;
      return;
    }
    if (profile.full_name && profile.work_experience && profile.industry) { onboardingForUser = session.user.id; return; }
    if (document.querySelector(".profile-onboarding")) return;
    const overlay = document.createElement("div");
    overlay.className = "overlay profile-onboarding";
    overlay.innerHTML = `<div class="modal"><p class="eyebrow">WELCOME TO CASE CONNECT</p><h2>Complete your profile</h2><p class="note">Please add these details once before you start practising.</p><form><label>Name<input name="fullName" required value="${escapeHtml(profile.full_name || session.user.user_metadata?.full_name || "")}"></label>${profileFieldsMarkup()}<p class="auth-error" hidden></p><button class="primary full">Save and continue</button></form></div>`;
    document.body.append(overlay);
    const form = overlay.querySelector("form"), industry = form.querySelector("[name=profileIndustry]"), other = form.querySelector(".profile-other-industry"), message = form.querySelector(".auth-error");
    industry.addEventListener("change", () => { other.hidden = industry.value !== "Other"; other.querySelector("input").required = industry.value === "Other"; });
    form.addEventListener("submit", async event => {
      event.preventDefault();
      const data = new FormData(form), selectedIndustry = data.get("profileIndustry") === "Other" ? String(data.get("profileIndustryOther")).trim() : data.get("profileIndustry");
      const save = await fetch(`${baseUrl}/rest/v1/profiles?id=eq.${encodeURIComponent(session.user.id)}`, { method: "PATCH", headers, body: JSON.stringify({ full_name: data.get("fullName"), work_experience: `${data.get("workYears")} years, ${data.get("workMonths")} months`, industry: selectedIndustry }) });
      if (!save.ok) { message.textContent = "Could not save your profile. Please try again."; message.hidden = false; return; }
      onboardingForUser = session.user.id;
      overlay.remove();
      window.location.reload();
    });
  } catch { /* A later DOM update retries this harmlessly. */ }
}

function runEnhancements() {
  scheduled = false;
  document.querySelectorAll(".auth-error").forEach((notice) => notice.classList.toggle("auth-success", /^Account created\./.test(notice.textContent?.trim() ?? "")));
  enhancePractice();
  enhanceDomainCaseTypes();
  enhancePeerSearch();
  enhanceHomeSummary();
  enhancePermissions();
  enhanceSignupProfileFields();
  enhanceProfileOnboarding();
}

new MutationObserver(() => { if (!scheduled) { scheduled = true; window.setTimeout(runEnhancements, 0); } }).observe(document.documentElement, { childList: true, subtree: true });

function applyDelegatedCaseTypeFilter(event) {
  const button = event.target instanceof Element ? event.target.closest(".domain-case-types button") : null;
  if (!button) return;
  event.preventDefault();
  event.stopPropagation();
  const page = button.closest(".page"), selected = button.dataset.type;
  if (!page || !selected) return;
  const domain = page.querySelector(".filters select:last-child")?.value;
  if (domain) selectedCaseTypeByDomain[domain] = selected;
  page.querySelectorAll(".domain-case-types button").forEach((item) => item.classList.toggle("type-selected", item === button));
  const cards = [...page.querySelectorAll(".card")];
  cards.forEach((card) => { const type = card.querySelector(".badge.blue")?.textContent?.trim(); card.style.display = selected === "All case types" || type === selected ? "" : "none"; });
  const result = page.querySelector(".result b"), count = cards.filter((card) => card.style.display !== "none").length;
  if (result) result.textContent = `${count} case${count === 1 ? "" : "s"}`;
}

document.addEventListener("pointerdown", applyDelegatedCaseTypeFilter, true);
document.addEventListener("click", applyDelegatedCaseTypeFilter, true);

runEnhancements();
