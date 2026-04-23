// ─── CONFIG ───────────────────────────────────────────────
// Replace with your actual Supabase project URL and anon key
const SUPABASE_URL = "https://rsxphzwtwybrcmiudmnv.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJzeHBoend0d3licmNtaXVkbW52Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY1MzU3MzIsImV4cCI6MjA5MjExMTczMn0.5pjW5cy7pCDE7Fm4z80zLrgmxuh9aRUQSNY9vljfFfg";

/**
 * 🔒 SECURITY NOTE: 
 * To prevent your API key from being revealed, you should move the Gemini call 
 * to a Supabase Edge Function. For now, I've added a fallback.
 */
 
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
  "Checking for previous analysis…",
  "Matching skills against the job…",
  "Identifying gaps and strengths…",
  "Crafting personalized suggestions…"
];

// ─── UTILS: HASHING FOR CACHING ──────────────────────────
async function generateHash(text) {
  const msgUint8 = new TextEncoder().encode(text);
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgUint8);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}
 
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
    // 1. GENERATE HASH FOR CACHING
    const contentToHash = resumeText + jobDesc;
    const contentHash = await generateHash(contentToHash);

    // 2. CHECK CACHE (Supabase)
    loadingText.textContent = "Checking for previous analysis...";
    const cachedData = await getFromCache(contentHash);
    
    if (cachedData) {
      console.log("Cache hit! Restoring previous analysis.");
      clearInterval(msgInterval);
      renderResult(cachedData);
      return;
    }

    // 3. CALL API
    loadingText.textContent = "Analyzing with AI...";
    const result = await callAnalysisAPI(resumeText, jobDesc);
 
    clearInterval(msgInterval);
 
    // 4. SAVE TO DB
    await saveToDatabase({
      resume_name:    resumeFileName,
      job_description: jobDesc.slice(0, 500),
      score:          result.score,
      score_label:    result.score_label,
      matched_skills: result.matched_skills,
      missing_skills: result.missing_skills,
      suggestions:    result.suggestions,
      summary:        result.overall_summary,
      content_hash:   contentHash
    });
 
    // 5. RENDER RESULTS
    renderResult(result);
 
  } catch (err) {
    clearInterval(msgInterval);
    loadingSection.style.display = "none";
    showError(err.message || "Something went wrong. Please try again.");
    console.error(err);
  } finally {
    analyzeBtn.disabled = false;
  }
}

// ─── CACHE HELPER ─────────────────────────────────────────
async function getFromCache(hash) {
  try {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/resume_analyses?content_hash=eq.${hash}&select=*`, {
      method: "GET",
      headers: {
        "apikey": SUPABASE_ANON_KEY,
        "Authorization": `Bearer ${SUPABASE_ANON_KEY}`
      }
    });
    if (!response.ok) return null;
    const data = await response.json();
    if (data && data.length > 0) {
        const d = data[0];
        return {
            score: d.score,
            score_label: d.score_label,
            overall_summary: d.summary,
            matched_skills: d.matched_skills,
            missing_skills: d.missing_skills,
            suggestions: d.suggestions
        };
    }
    return null;
  } catch (e) {
    console.warn("Cache check failed", e);
    return null;
  }
}
 
// ─── API CALL (Supabase Edge Function) ─────────────────────────────
async function callAnalysisAPI(resume, jobDesc) {
  const functionUrl = `${SUPABASE_URL}/functions/v1/analyze-resume`;
  
  try {
    const response = await fetch(functionUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${SUPABASE_ANON_KEY}`
      },
      body: JSON.stringify({ resume, jobDesc })
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error || "Analysis failed via Edge Function");
    }

    const data = await response.json();
    return data;
  } catch (error) {
    console.error("Edge Function Error:", error);
    throw new Error("Failed to process resume. Ensure your Edge Function is deployed.");
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