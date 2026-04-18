// ─── CONFIG ───────────────────────────────────────────────
// Replace with your actual Supabase project URL and anon key
const SUPABASE_URL = "https://rsxphzwtwybrcmiudmnv.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJzeHBoend0d3licmNtaXVkbW52Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY1MzU3MzIsImV4cCI6MjA5MjExMTczMn0.5pjW5cy7pCDE7Fm4z80zLrgmxuh9aRUQSNY9vljfFfg";
 
// Get your free Gemini API Key from: https://aistudio.google.com/
const GEMINI_API_KEY = "AIzaSyBU-_7HaLP_cgEaXZJZ6i36PVptg3Ddk_g";
 
// ─── STATE ────────────────────────────────────────────────
let resumeText = "";
let resumeFileName = "";
 
// ─── DOM ELEMENTS ─────────────────────────────────────────
const fileInput      = document.getElementById("resumeUpload");
const fileNameEl     = document.getElementById("fileName");
const analyzeBtn     = document.getElementById("analyzeBtn");
const resultSection  = document.getElementById("resultSection");
const loadingSection = document.getElementById("loadingSection");
const loadingText    = document.getElementById("loadingText");
const resultContent  = document.getElementById("resultContent");
const errorMsg       = document.getElementById("errorMsg");
 
// ─── LOADING MESSAGES ─────────────────────────────────────
const loadingMessages = [
  "Reading your resume…",
  "Matching skills against the job…",
  "Identifying gaps and strengths…",
  "Crafting personalized suggestions…"
];
 
// ─── FILE UPLOAD ──────────────────────────────────────────
fileInput.addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;
 
  resumeFileName = file.name;
  fileNameEl.textContent = `✔ ${file.name}`;
 
  resumeText = await readFileAsText(file);
});
 
function readFileAsText(file) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload  = (e) => resolve(e.target.result);
    reader.onerror = ()  => resolve("");
    // For PDFs we get base64; for text-based files we get plain text
    if (file.type === "application/pdf") {
      reader.readAsDataURL(file);
    } else {
      reader.readAsText(file);
    }
  });
}
 
// ─── ERROR DISPLAY ────────────────────────────────────────
function showError(msg) {
  errorMsg.textContent = msg;
  errorMsg.style.display = "block";
  setTimeout(() => (errorMsg.style.display = "none"), 4000);
}
 
// ─── MAIN ANALYZE FUNCTION ────────────────────────────────
async function analyzeResume() {
  const jobDesc = document.getElementById("jobDescription").value.trim();
 
  if (!resumeText)  { showError("Please upload your resume first.");       return; }
  if (!jobDesc)     { showError("Please paste the job description.");       return; }
 
  // UI state: loading
  analyzeBtn.disabled = true;
  resultSection.style.display  = "block";
  loadingSection.style.display = "flex";
  resultContent.style.display  = "none";
  errorMsg.style.display       = "none";
 
  // Rotate loading messages
  let msgIdx = 0;
  const msgInterval = setInterval(() => {
    msgIdx = (msgIdx + 1) % loadingMessages.length;
    loadingText.textContent = loadingMessages[msgIdx];
  }, 1800);
 
  try {
    // 1. Call your backend API (which holds your Anthropic key securely)
    const result = await callAnalysisAPI(resumeText, jobDesc);
 
    clearInterval(msgInterval);
 
    // 2. Save result to Supabase
    await saveToDatabase({
      resume_name:    resumeFileName,
      job_description: jobDesc.slice(0, 500),
      score:          result.score,
      matched_skills: result.matched_skills,
      missing_skills: result.missing_skills,
      suggestions:    result.suggestions,
      summary:        result.overall_summary,
    });
 
    // 3. Render results
    renderResult(result);
 
  } catch (err) {
    clearInterval(msgInterval);
    loadingSection.style.display = "none";
    showError("Something went wrong. Please try again.");
    console.error(err);
  } finally {
    analyzeBtn.disabled = false;
  }
}
 
// ─── API CALL (Gemini Integration) ─────────────────────────────
async function callAnalysisAPI(resume, jobDesc) {
  if (GEMINI_API_KEY === "YOUR_GEMINI_API_KEY_HERE" || !GEMINI_API_KEY) {
      throw new Error("Please insert your Gemini API Key at the top of script.js");
  }

  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`;
  
  const promptText = `
You are an expert ATS (Applicant Tracking System) and AI Resume Analyzer.
Analyze the following resume against the provided job description.
Return ONLY a valid JSON object with the following exact structure, no markdown, no other text:
{
  "score": (number between 0 and 100 based on match),
  "score_label": ("Excellent Match", "Good Match", "Fair Match", etc.),
  "overall_summary": (1-2 sentence summary of fit),
  "matched_skills": [array of skills],
  "missing_skills": [array of skills],
  "suggestions": [array of actionable resume tips]
}

Job Description:
${jobDesc}
`;

  let parts = [];
  
  // If the resume is a DataURL (e.g., from a PDF), we send it as an inline file
  if (resume.startsWith("data:")) {
    const mimeType = resume.split(';')[0].split(':')[1];
    const base64Data = resume.split(',')[1];
    parts.push({
      inlineData: { mimeType: mimeType, data: base64Data }
    });
    parts.push({ text: promptText + "\n\n(Resume is provided as an attached document above.)" });
  } else {
    // If it's pure text, just append it
    parts.push({ text: promptText + "\n\nResume:\n" + resume });
  }

  try {
    const response = await fetch(endpoint, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: parts }],
        generationConfig: { temperature: 0.2 },
      }),
    });

    if (!response.ok) throw new Error("API call failed: " + await response.text());

    const data = await response.json();
    const rawText = data.candidates[0].content.parts[0].text;
    
    // Clean up markdown code blocks if the AI returns them
    const jsonText = rawText.replace(/```json/g, '').replace(/```/g, '').trim();
    
    return JSON.parse(jsonText);
  } catch (error) {
    console.error("Gemini Error:", error);
    throw new Error("Failed to process resume with Gemini.");
  }
} 
// ─── SUPABASE SAVE ────────────────────────────────────────
async function saveToDatabase(record) {
  try {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/resume_analyses`, {
      method:  "POST",
      headers: {
        "Content-Type":  "application/json",
        "apikey":        SUPABASE_ANON_KEY,
        "Authorization": `Bearer ${SUPABASE_ANON_KEY}`,
        "Prefer":        "return=minimal",
      },
      body: JSON.stringify(record),
    });
 
    if (!response.ok) {
      console.warn("Database save failed:", await response.text());
    } else {
      console.log("Result saved to database.");
    }
  } catch (err) {
    console.warn("Could not reach database:", err);
    // Non-fatal — don't block the UI
  }
}
 
// ─── SCORE COLOR HELPER ───────────────────────────────────
function scoreColor(score) {
  if (score >= 75) return { bg: "#f0fff4", color: "#276749" };
  if (score >= 50) return { bg: "#fffbeb", color: "#92400e" };
  return                  { bg: "#fff5f5", color: "#c53030" };
}
 
// ─── RENDER RESULTS ───────────────────────────────────────
function renderResult(d) {
  loadingSection.style.display = "none";
 
  const sc          = scoreColor(d.score);
  const matchedHtml = (d.matched_skills || [])
    .map((s) => `<span class="pill pill-green">${s}</span>`)
    .join("");
  const missingHtml = (d.missing_skills || [])
    .map((s) => `<span class="pill pill-red">${s}</span>`)
    .join("");
  const suggestHtml = (d.suggestions || [])
    .map((s) => `<li><div class="dot"></div><span>${s}</span></li>`)
    .join("");
 
  resultContent.innerHTML = `
    <div class="score-row">
      <div class="score-circle" style="background:${sc.bg};color:${sc.color}">
        ${d.score}
      </div>
      <div>
        <div class="score-label">Match score</div>
        <div class="score-title">${d.score_label}</div>
        <div class="score-summary">${d.overall_summary}</div>
      </div>
    </div>
 
    ${matchedHtml ? `
    <div class="section-block">
      <div class="section-block-title">Matched skills</div>
      <div class="pill-row">${matchedHtml}</div>
    </div>` : ""}
 
    ${missingHtml ? `
    <div class="section-block">
      <div class="section-block-title">Missing / strengthen</div>
      <div class="pill-row">${missingHtml}</div>
    </div>` : ""}
 
    ${suggestHtml ? `
    <div class="section-block">
      <div class="section-block-title">Suggestions</div>
      <ul class="suggestion-list">${suggestHtml}</ul>
    </div>` : ""}
  `;
 
  resultContent.style.display = "block";
}