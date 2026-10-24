import { useState } from "react";
import { createUploadedCase, removeCase } from "./supabase.js";

const caseTypes = ["Profitability", "Market Entry", "Pricing", "M&A and Due Diligence", "Unconventional", "Guesstimates", "Product Design", "App Improvement", "RCA", "Campaign Planning"];
const industries = ["Aerospace & Defence", "Agriculture", "Automotive", "Banking", "Chemicals", "Construction & Real Estate", "Consumer Goods", "Education", "Energy & Utilities", "E-commerce", "Financial Services", "Food & Beverage", "Government & Public Sector", "Healthcare & Pharmaceuticals", "Hospitality", "Insurance", "Logistics & Supply Chain", "Manufacturing", "Media & Entertainment", "Metals & Mining", "Mobility", "Professional Services", "Retail", "SaaS", "Technology", "Telecommunications", "Travel & Tourism"];

export default function CaseAdmin({ caseList, setCaseList }) {
  const [tab, setTab] = useState("add");
  const [mediaTab, setMediaTab] = useState("conversation");
  const [conversationFiles, setConversationFiles] = useState([]);
  const [solutionFiles, setSolutionFiles] = useState([]);
  const [submission, setSubmission] = useState(null);
  const [removingId, setRemovingId] = useState(null);
  const [industry, setIndustry] = useState("Technology");
  const [customIndustry, setCustomIndustry] = useState("");

  const addFiles = (files, setter) => setter(current => [...current, ...Array.from(files)]);
  const files = mediaTab === "conversation" ? conversationFiles : solutionFiles;

  async function addCase(event) {
    event.preventDefault();
    const formElement = event.currentTarget;
    if (!conversationFiles.length || !solutionFiles.length) {
      setSubmission({ state: "error", progress: 0, message: "Add at least one Conversation image and one Solution image." });
      return;
    }
    const form = new FormData(formElement);
    const accessToken = JSON.parse(localStorage.getItem("caseconnect_session") || "{}").accessToken;
    if (!accessToken) {
      setSubmission({ state: "error", progress: 0, message: "Your session has expired. Please sign in again." });
      return;
    }
    setSubmission({ state: "working", progress: 5, message: "Preparing your case…" });
    try {
      const created = await createUploadedCase(accessToken, {
        title: form.get("title"),
        description: form.get("description"),
        company: form.get("company"),
        industry: industry === "Other" ? customIndustry.trim() : industry,
        difficulty: form.get("difficulty"),
        domain: form.get("domain"),
      }, conversationFiles, solutionFiles, (progress, message) => {
        setSubmission({ state: "working", progress, message });
      });
      setCaseList(current => [...current, created]);
      formElement.reset();
      setConversationFiles([]);
      setSolutionFiles([]);
      setIndustry("Technology");
      setCustomIndustry("");
      setSubmission({ state: "success", progress: 100, message: "Case added successfully." });
    } catch (error) {
      setSubmission({ state: "error", progress: 0, message: error.message || "Case could not be saved." });
    }
  }

  async function removeUploadedCase(caseId) {
    const accessToken = JSON.parse(localStorage.getItem("caseconnect_session") || "{}").accessToken;
    if (!accessToken) return alert("Your session has expired. Please sign in again.");
    setRemovingId(caseId);
    try {
      await removeCase(accessToken, caseId);
      setCaseList(current => current.filter(item => item.id !== caseId));
    } catch (error) {
      alert(error.message || "Could not remove the case.");
    } finally {
      setRemovingId(null);
    }
  }

  return <section className="page admin">
    <div className="intro">
      <p className="eyebrow">ADMIN WORKSPACE</p>
      <h1>Add / Remove Case</h1>
      <p>Add the case details and upload the Conversation and Solution images exactly as you want members to see them.</p>
    </div>
    <div className="tabs">
      <button className={tab === "add" ? "selected" : ""} onClick={() => setTab("add")}>Add a case</button>
      <button className={tab === "remove" ? "selected" : ""} onClick={() => setTab("remove")}>Remove case</button>
    </div>
    {tab === "remove" ? <div className="panel remove-list">
      {caseList.map(item => <div key={item.id}>
        <section><b>{item.title}</b><small>{item.type} · {item.domain}</small></section>
        <button className="danger" disabled={removingId === item.id} onClick={() => removeUploadedCase(item.id)}>
          {removingId === item.id ? "Removing…" : "Remove case"}
        </button>
      </div>)}
    </div> : <form className="case-form panel" onSubmit={addCase}>
      <div className="form-grid">
        <label>Case title<input name="title" required placeholder="e.g. Call Center Operations Optimization" /></label>
        <label>Company<input name="company" required placeholder="e.g. Bain & Company" /></label>
        <label>Difficulty level<select name="difficulty" defaultValue="Intermediate"><option>Beginner</option><option>Intermediate</option><option>Advanced</option></select></label>
        <label>Domain<select name="domain"><option>Consulting</option><option>Product Management</option><option>Marketing</option></select></label>
        <label>Industry<select value={industry} onChange={event => setIndustry(event.target.value)}>{industries.map(item => <option key={item}>{item}</option>)}<option>Other</option></select></label>
        {industry === "Other" && <label>Specify industry<input required value={customIndustry} onChange={event => setCustomIndustry(event.target.value)} placeholder="Type the industry" /></label>}
      </div>
      <label>Case statement<textarea name="description" required placeholder="Write the case statement shown to members." /></label>
      <p className="note">Images are preserved as images. No text extraction or OCR is performed.</p>
      <div className="tabs media-tabs">
        <button type="button" className={mediaTab === "conversation" ? "selected" : ""} onClick={() => setMediaTab("conversation")}>Conversation</button>
        <button type="button" className={mediaTab === "solution" ? "selected" : ""} onClick={() => setMediaTab("solution")}>Solution</button>
      </div>
      <div className="upload-zone">
        <h3>{mediaTab === "conversation" ? "Conversation" : "Solution"} images</h3>
        <p>{mediaTab === "conversation" ? "Upload the conversation screenshot as-is. It will be displayed in the Conversation tab." : "Upload solution screenshots as-is. They are shown unchanged in the Solution tab."}</p>
        <input type="file" accept="image/*" multiple disabled={submission?.state === "working" || submission?.state === "success"} onChange={event => addFiles(event.target.files, mediaTab === "conversation" ? setConversationFiles : setSolutionFiles)} />
        <div className="previews">{files.map((file, index) => <img key={`${file.name}-${index}`} src={URL.createObjectURL(file)} alt="Uploaded preview" />)}</div>
      </div>
      {submission && <div className={`submission ${submission.state}`}><div><b>{submission.message}</b><span>{submission.state === "working" ? `${submission.progress}%` : submission.state === "success" ? "100%" : ""}</span></div><i><em style={{ width: `${submission.progress}%` }} /></i></div>}
      <button className="primary" disabled={submission?.state === "working" || submission?.state === "success"}>{submission?.state === "working" ? "Adding case…" : submission?.state === "success" ? "Case added" : "Add case"}</button>
    </form>}
  </section>;
}
