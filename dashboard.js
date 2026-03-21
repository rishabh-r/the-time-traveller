/* =====================================================
   CareCord AI – Patient Risk Monitoring Dashboard
   FHIR R4 Data + GPT-4.1-mini Analysis
   ===================================================== */

// ── Config ──────────────────────────────────────────
const FHIR_BASE    = "https://fhirassist.rsystems.com:481";
const OPENAI_MODEL = "gpt-4.1-mini";
const AUTH_TOKEN    = localStorage.getItem("cb_token");
const OAI_KEY       = localStorage.getItem("cb_oai_key");

// ── Read patient ID from URL ────────────────────────
const urlParams = new URLSearchParams(window.location.search);
const PATIENT_ID = urlParams.get("patient");

// ── Auth guard ──────────────────────────────────────
if (!AUTH_TOKEN || !OAI_KEY) {
  window.location.href = "index.html";
}
if (!PATIENT_ID) {
  showError("No patient ID provided. Please launch this dashboard from the CareBridge chatbot.");
}

// ── FHIR Helpers ────────────────────────────────────
function getAuthHeader() {
  return {
    "Authorization": "Bearer " + AUTH_TOKEN,
    "Content-Type": "application/json"
  };
}

function buildUrl(path, params) {
  const url = new URL(FHIR_BASE + path);
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== "") {
      url.searchParams.append(k, v);
    }
  });
  return url.toString();
}

async function callFhirApi(url) {
  const res = await fetch(url, { headers: getAuthHeader() });
  if (res.status === 401) {
    localStorage.removeItem("cb_token");
    localStorage.removeItem("cb_user");
    window.location.href = "index.html";
    throw new Error("Session expired. Please log in again.");
  }
  if (!res.ok) throw new Error("FHIR API error: " + res.status);
  return res.json();
}

// ── Fetch All Patient Data (parallel) ───────────────
async function fetchAllPatientData(patientId) {
  const loincCodes = [
    "718-7",   // Hemoglobin
    "2345-7",  // Glucose
    "2951-2",  // Sodium
    "2823-3",  // Potassium
    "2160-0",  // Creatinine
    "8480-6",  // Systolic BP
    "8462-4",  // Diastolic BP
    "8867-4",  // Heart Rate
    "4548-4",  // HbA1c
    "2090-9"   // LDL Cholesterol
  ];

  const [patientData, conditions, medications, encounters, ...obsResults] = await Promise.all([
    callFhirApi(buildUrl("/baseR4/Patient", { _id: patientId })),
    callFhirApi(buildUrl("/baseR4/Condition", { subject: patientId })),
    callFhirApi(buildUrl("/baseR4/MedicationRequest", { subject: patientId })),
    callFhirApi(buildUrl("/baseR4/Encounter", { subject: patientId })),
    ...loincCodes.map(code =>
      callFhirApi(buildUrl("/baseR4/Observations", { subject: patientId, code, page: 0 }))
    )
  ]);

  // Merge all observation bundles
  const observations = obsResults.flatMap(bundle =>
    (bundle.entry || []).map(e => e.resource)
  );

  return { patientData, conditions, medications, encounters, observations };
}

// ── Strip FHIR metadata to reduce token usage ──────
function stripFhirMeta(bundle) {
  if (!bundle || !bundle.entry) return [];
  return bundle.entry.map(e => {
    const r = { ...e.resource };
    delete r.meta;
    delete r.text;
    delete r.id;
    return r;
  }).slice(0, 30); // Limit to 30 entries max per resource type
}

// ── GPT Analysis ────────────────────────────────────
async function analyzeWithGPT(fhirData) {
  const today = new Date().toISOString().split("T")[0];

  const systemPrompt = [
    "You are a clinical data analyst for a care coordination platform.",
    "Analyze the provided FHIR patient data and return a JSON object with the exact structure specified.",
    "Use clinical evidence from the data. Do not fabricate values.",
    "Derive age from birthDate. Extract phone and email from Patient telecom array.",
    "For programs: identify care management programs based on conditions (e.g. Diabetes Management, Hypertension Program, CKD Program, Heart Failure Program).",
    "For risk score: compute a 0-100 score based on number and severity of conditions, abnormal observations, medication gaps, and missed encounters.",
    "For alert triggers: identify 2-4 key issues from abnormal observations (worsening trends), on-hold/stopped medications, cancelled/no-show encounters.",
    "For deteriorating trends: focus on BP, HbA1c, LDL, Creatinine, eGFR and compare latest values to clinical targets.",
    "For AI actions: generate 4-6 actionable clinical recommendations with rationale.",
    "Today's date: " + today
  ].join(" ");

  const userPrompt = [
    "Analyze this patient's FHIR data and return ONLY a valid JSON object with this exact structure:",
    "",
    '{',
    '  "patient": {',
    '    "name": "Full Name",',
    '    "initials": "FN",',
    '    "age": 65,',
    '    "mrn": "patient ID",',
    '    "programs": ["Program 1", "Program 2"],',
    '    "riskScore": "32% ASCVD",',
    '    "riskLevel": "High",',
    '    "phone": "(555) 123-4567",',
    '    "email": "patient@email.com",',
    '    "tags": ["High Risk", "Care Gap"]',
    '  },',
    '  "alertTriggers": [',
    '    {',
    '      "title": "Issue Title",',
    '      "description": "Latest: value (Target: target)",',
    '      "priority": "Critical",',
    '      "icon": "heart"',
    '    }',
    '  ],',
    '  "deterioratingTrends": [',
    '    {',
    '      "label": "BP Trend",',
    '      "value": "+17 mmHg systolic (6 weeks)",',
    '      "target": "< 130/80",',
    '      "status": "above"',
    '    }',
    '  ],',
    '  "aiActions": [',
    '    {',
    '      "title": "Action Title",',
    '      "priority": "High Priority",',
    '      "timeframe": "Within 24 hours",',
    '      "description": "What to do",',
    '      "rationale": "Clinical reasoning"',
    '    }',
    '  ]',
    '}',
    "",
    "Priority values for alertTriggers: Critical, High Priority, Medium Priority",
    "Priority values for aiActions: High Priority, Medium Priority, Low Priority",
    "Icon values: heart, pill, calendar, chart, alert, lab",
    "Status values for trends: above, normal, below",
    "Tags should include 'High Risk' if riskLevel is High, and 'Care Gap' if care gaps are detected.",
    "",
    "=== PATIENT DATA ===",
    JSON.stringify(stripFhirMeta(fhirData.patientData), null, 0),
    "",
    "=== CONDITIONS ===",
    JSON.stringify(stripFhirMeta(fhirData.conditions), null, 0),
    "",
    "=== MEDICATIONS ===",
    JSON.stringify(stripFhirMeta(fhirData.medications), null, 0),
    "",
    "=== ENCOUNTERS ===",
    JSON.stringify(stripFhirMeta(fhirData.encounters), null, 0),
    "",
    "=== OBSERVATIONS ===",
    JSON.stringify(fhirData.observations.slice(0, 50).map(o => {
      const r = { ...o };
      delete r.meta;
      delete r.text;
      delete r.id;
      return r;
    }), null, 0)
  ].join("\n");

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": "Bearer " + OAI_KEY,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
      ],
      response_format: { type: "json_object" },
      temperature: 0.3
    })
  });

  if (res.status === 429) {
    throw new Error("AI analysis rate limited. Please wait a moment and try again.");
  }
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error?.message || "GPT analysis failed (" + res.status + ")");
  }

  const data = await res.json();
  const content = data.choices[0].message.content;

  try {
    return JSON.parse(content);
  } catch (e) {
    throw new Error("AI analysis returned invalid data. Please retry.");
  }
}

// ── Icon map ────────────────────────────────────────
const ICONS = {
  heart:    "\u2764\uFE0F",
  pill:     "\uD83D\uDC8A",
  calendar: "\uD83D\uDCC5",
  chart:    "\uD83D\uDCC8",
  alert:    "\u26A0\uFE0F",
  lab:      "\uD83E\uDDEA"
};

// ── Render: Patient Card ────────────────────────────
function renderPatientCard(patient) {
  // Avatar
  const avatar = document.getElementById("patient-avatar");
  avatar.textContent = patient.initials || "??";

  // Name
  document.getElementById("patient-name").textContent = patient.name || "Unknown";

  // Badges
  const badgesEl = document.getElementById("patient-badges");
  badgesEl.innerHTML = "";
  const riskColors = {
    high: { text: "#b91c1c", border: "#fde8e8" },
    critical: { text: "#b91c1c", border: "#fde8e8" },
    medium: { text: "#b45309", border: "#fef3cd" },
    low: { text: "#15803d", border: "#d5f5e3" }
  };
  const riskKey = (patient.riskLevel || "high").toLowerCase();
  const colors = riskColors[riskKey] || riskColors.high;

  (patient.tags || []).forEach(tag => {
    const span = document.createElement("span");
    const tagLower = tag.toLowerCase();
    if (tagLower.includes("high risk") || tagLower.includes("critical")) {
      span.className = "badge badge-high-risk";
    } else if (tagLower.includes("medium risk")) {
      span.className = "badge badge-medium-risk";
    } else if (tagLower.includes("low risk")) {
      span.className = "badge badge-low-risk";
    } else {
      span.className = "badge badge-care-gap";
      span.style.color = colors.text;
      span.style.borderColor = colors.text;
    }
    span.textContent = tag;
    badgesEl.appendChild(span);
  });

  // Details row
  const detailsRow = document.getElementById("patient-details-row");
  detailsRow.innerHTML = "";
  const details = [
    { label: "MRN:", value: patient.mrn || PATIENT_ID },
    { label: "Age:", value: patient.age ? patient.age + " years" : "N/A" },
    { label: "Programs:", value: "Diabetes, Hypertension, Cardiovascular" },
    { label: "Risk Score:", value: patient.riskScore || "N/A", isRisk: true }
  ];
  details.forEach(d => {
    const item = document.createElement("div");
    item.className = "detail-item";
    item.innerHTML = '<span class="detail-label">' + d.label + '</span>' +
      '<span class="detail-value' + (d.isRisk && patient.riskLevel === "High" ? " risk-high" : "") + '">' + d.value + '</span>';
    detailsRow.appendChild(item);
  });

  // Contact row
  const contactRow = document.getElementById("patient-contact-row");
  contactRow.innerHTML = "";
  if (patient.phone) {
    const phoneItem = document.createElement("div");
    phoneItem.className = "contact-item";
    phoneItem.innerHTML = '<span class="contact-icon">&#128222;</span> ' + patient.phone;
    contactRow.appendChild(phoneItem);
  }
  if (patient.email) {
    const emailItem = document.createElement("div");
    emailItem.className = "contact-item";
    emailItem.innerHTML = '<span class="contact-icon">&#9993;</span> ' + patient.email;
    contactRow.appendChild(emailItem);
  }

  // Risk-based card styling (border + background)
  const card = document.getElementById("patient-card");
  if (patient.riskLevel === "High" || patient.riskLevel === "Critical") {
    card.style.borderLeftColor = "var(--red)";
    card.style.background = "var(--red-light)";
    card.style.borderColor = "var(--red-border)";
    card.style.borderLeftColor = "var(--red)";
  } else if (patient.riskLevel === "Medium") {
    card.style.borderLeftColor = "var(--yellow)";
    card.style.background = "var(--yellow-light)";
    card.style.borderColor = "var(--yellow-border)";
    card.style.borderLeftColor = "var(--yellow)";
  } else {
    card.style.borderLeftColor = "var(--green)";
    card.style.background = "var(--green-light)";
    card.style.borderColor = "var(--green-border)";
    card.style.borderLeftColor = "var(--green)";
  }
}

// ── Render: Alert Triggers ──────────────────────────
function renderAlertTriggers(alerts) {
  const container = document.getElementById("alert-cards-container");
  container.innerHTML = "";

  if (!alerts || alerts.length === 0) {
    container.innerHTML = '<p style="color: var(--text-mid);">No alert triggers detected for this patient.</p>';
    return;
  }

  alerts.forEach(alert => {
    const priorityClass = alert.priority.toLowerCase().includes("critical") ? "critical" :
                          alert.priority.toLowerCase().includes("high") ? "high" : "medium";

    const card = document.createElement("div");
    card.className = "alert-card " + priorityClass;
    card.innerHTML =
      '<div class="alert-card-header">' +
        '<span class="alert-card-icon">' + (ICONS[alert.icon] || ICONS.alert) + '</span>' +
        '<span class="alert-card-title">' + escHtml(alert.title) + '</span>' +
      '</div>' +
      '<p class="alert-card-desc">' + escHtml(alert.description) + '</p>' +
      '<span class="priority-badge ' + priorityClass + '">' + escHtml(alert.priority) + '</span>';

    container.appendChild(card);
  });
}

// ── Render: Deteriorating Trends ────────────────────
function renderDeterioratingTrends(trends) {
  const container = document.getElementById("trends-container");
  container.innerHTML = "";

  if (!trends || trends.length === 0) {
    container.innerHTML = '<p style="color: var(--text-mid);">No deteriorating trends detected.</p>';
    return;
  }

  trends.forEach(trend => {
    const item = document.createElement("div");
    item.className = "trend-item";
    item.innerHTML =
      '<div class="trend-label">' + escHtml(trend.label) + ':</div>' +
      '<div class="trend-value ' + (trend.status === "above" ? "above" : trend.status === "normal" ? "normal" : "") + '">' +
        escHtml(trend.value) +
      '</div>' +
      '<div class="trend-target">Target: ' + escHtml(trend.target) + '</div>';
    container.appendChild(item);
  });
}

// ── Render: AI Actions ──────────────────────────────
function renderAIActions(actions) {
  const container = document.getElementById("actions-list");
  container.innerHTML = "";

  if (!actions || actions.length === 0) {
    container.innerHTML = '<p style="color: var(--text-mid);">No AI-recommended actions at this time.</p>';
    return;
  }

  actions.forEach((action, idx) => {
    const priorityClass = action.priority.toLowerCase().includes("high") ? "high" :
                          action.priority.toLowerCase().includes("critical") ? "critical" :
                          action.priority.toLowerCase().includes("medium") ? "medium" : "low";

    const card = document.createElement("div");
    card.className = "action-card";
    card.innerHTML =
      '<div class="action-card-top">' +
        '<input type="checkbox" class="action-checkbox" data-idx="' + idx + '" />' +
        '<div class="action-content">' +
          '<div class="action-title-row">' +
            '<span class="action-title">' + escHtml(action.title) + '</span>' +
            '<span class="priority-badge ' + priorityClass + '">' + escHtml(action.priority) + '</span>' +
            '<span class="timeframe-pill">' + escHtml(action.timeframe) + '</span>' +
          '</div>' +
          '<p class="action-desc">' + escHtml(action.description) + '</p>' +
          '<div class="action-rationale">' +
            '<div class="rationale-label">AI Rationale:</div>' +
            '<div class="rationale-text">' + escHtml(action.rationale) + '</div>' +
          '</div>' +
        '</div>' +
      '</div>';

    // Toggle selected state on card click
    card.addEventListener("click", (e) => {
      const cb = card.querySelector(".action-checkbox");
      if (e.target !== cb) cb.checked = !cb.checked;
      card.classList.toggle("selected", cb.checked);
      updateSelectedCount();
    });

    container.appendChild(card);
  });

  // Checkbox tracking
  container.addEventListener("change", updateSelectedCount);
}

function updateSelectedCount() {
  const checked = document.querySelectorAll(".action-checkbox:checked").length;
  document.getElementById("selected-count").textContent = checked;
  document.getElementById("approve-count").textContent = checked;
}

// ── Utility ─────────────────────────────────────────
function escHtml(str) {
  if (!str) return "";
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

// ── UI State ────────────────────────────────────────
function showLoading() {
  document.getElementById("loading-overlay").classList.remove("hidden");
  document.getElementById("dashboard").classList.add("hidden");
  document.getElementById("error-state").classList.add("hidden");
}

function hideLoading() {
  document.getElementById("loading-overlay").classList.add("hidden");
}

function showDashboard() {
  document.getElementById("dashboard").classList.remove("hidden");
}

function showError(message) {
  hideLoading();
  document.getElementById("error-state").classList.remove("hidden");
  document.getElementById("dashboard").classList.add("hidden");
  const msgEl = document.getElementById("error-message");
  if (msgEl) msgEl.textContent = message;
}

// ── Main ────────────────────────────────────────────
async function init() {
  try {
    showLoading();

    // Step 1: Fetch all FHIR data
    const fhirData = await fetchAllPatientData(PATIENT_ID);

    // Check if patient exists
    if (!fhirData.patientData.entry || fhirData.patientData.entry.length === 0) {
      showError("Patient not found (ID: " + PATIENT_ID + "). Please verify the patient ID.");
      return;
    }

    // Update loading text
    document.querySelector(".loading-text").textContent = "Generating AI insights...";
    document.querySelector(".loading-subtext").textContent = "Analyzing clinical patterns and care gaps";

    // Step 2: Send to GPT for analysis
    const analysis = await analyzeWithGPT(fhirData);

    // Step 3: Extract phone/email directly from FHIR data as fallback
    const ptResource = fhirData.patientData.entry[0].resource;
    const telecoms = ptResource.telecom || [];
    const fhirPhone = telecoms.find(t => t.system === "phone");
    const fhirEmail = telecoms.find(t => t.system === "email");
    const patientInfo = analysis.patient || {};
    if (!patientInfo.phone && fhirPhone) patientInfo.phone = fhirPhone.value;
    if (!patientInfo.email && fhirEmail) patientInfo.email = fhirEmail.value;

    // Render everything
    renderPatientCard(patientInfo);
    renderAlertTriggers(analysis.alertTriggers || []);
    renderDeterioratingTrends(analysis.deterioratingTrends || []);
    const aiActions = analysis.aiActions || [];
    renderAIActions(aiActions);
    setupApproveModal(aiActions);

    hideLoading();
    showDashboard();
    setupMarkReviewed();

  } catch (err) {
    console.error("Dashboard error:", err);
    showError(err.message || "An unexpected error occurred. Please try again.");
  }
}

// ── Approve Modal ────────────────────────────────────
let approvedActions = [];

function setupApproveModal(actions) {
  const approveBtn = document.getElementById("approve-btn");
  const overlay = document.getElementById("approve-modal-overlay");
  const closeX = document.getElementById("modal-close-x");
  const cancelBtn = document.getElementById("modal-cancel-btn");
  const confirmBtn = document.getElementById("modal-confirm-btn");

  function openModal() {
    const checked = document.querySelectorAll(".action-checkbox:checked");
    if (checked.length === 0) return;

    const selected = Array.from(checked).map(cb => actions[parseInt(cb.dataset.idx)]);
    document.getElementById("modal-action-count").textContent = selected.length;

    const list = document.getElementById("modal-actions-list");
    list.innerHTML = "";
    selected.forEach(action => {
      const priorityClass = action.priority.toLowerCase().includes("high") ? "high" :
                            action.priority.toLowerCase().includes("medium") ? "medium" : "low";
      const priorityShort = action.priority.replace(" Priority", "").replace(" priority", "");
      const item = document.createElement("div");
      item.className = "modal-action-item";
      item.innerHTML =
        '<span class="modal-action-check">&#10003;</span>' +
        '<div class="modal-action-content">' +
          '<div class="modal-action-title-row">' +
            '<span class="modal-action-name">' + escHtml(action.title) + '</span>' +
            '<span class="modal-priority-pill ' + priorityClass + '">' + escHtml(priorityShort) + '</span>' +
          '</div>' +
          '<p class="modal-action-desc">' + escHtml(action.description) + '</p>' +
        '</div>';
      list.appendChild(item);
    });

    document.getElementById("coordinator-notes").value = "";
    overlay.classList.remove("hidden");
  }

  function closeModal() {
    overlay.classList.add("hidden");
  }

  approveBtn.addEventListener("click", openModal);
  closeX.addEventListener("click", closeModal);
  cancelBtn.addEventListener("click", closeModal);
  overlay.addEventListener("click", (e) => { if (e.target === overlay) closeModal(); });

  confirmBtn.addEventListener("click", () => {
    closeModal();
    // Uncheck all and reset card styles
    document.querySelectorAll(".action-checkbox").forEach(cb => {
      cb.checked = false;
      cb.closest(".action-card").classList.remove("selected");
    });
    updateSelectedCount();
  });
}

// ── Mark as Reviewed ─────────────────────────────────
function setupMarkReviewed() {
  const btn = document.getElementById("mark-reviewed-btn");
  let isReviewed = false;

  btn.addEventListener("click", () => {
    const badgesEl = document.getElementById("patient-badges");

    if (!isReviewed) {
      // Mark as reviewed
      const reviewedBadge = document.createElement("span");
      reviewedBadge.className = "badge badge-reviewed";
      reviewedBadge.innerHTML = "&#128065; Reviewed";
      badgesEl.appendChild(reviewedBadge);

      btn.innerHTML = '<span class="review-icon">&#10004;</span> Reviewed';
      btn.classList.add("reviewed-state");

      // Show toast
      const wrapper = document.createElement("div");
      wrapper.className = "review-toast-wrapper";
      wrapper.innerHTML = '<div class="review-toast"><span>&#10004;</span> Alert marked as reviewed</div>';
      const container = document.querySelector(".page-container");
      const title = document.querySelector(".page-title");
      container.insertBefore(wrapper, title.nextSibling);

      setTimeout(() => {
        wrapper.style.opacity = "0";
        setTimeout(() => wrapper.remove(), 300);
      }, 1000);

      isReviewed = true;
    } else {
      // Revert to original
      const reviewedBadge = badgesEl.querySelector(".badge-reviewed");
      if (reviewedBadge) reviewedBadge.remove();

      btn.innerHTML = '<span class="review-icon">&#128065;</span> Mark as Reviewed';
      btn.classList.remove("reviewed-state");

      isReviewed = false;
    }
  });
}

// ── Start ───────────────────────────────────────────
if (PATIENT_ID) {
  init();
}
