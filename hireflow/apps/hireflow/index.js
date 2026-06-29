      (function () {
        var cfg = window.__LEMMA_CONFIG__ || {};
        var base = (cfg.apiUrl || window.location.origin).replace(/\/$/, "");
        var s = document.createElement("script");
        s.src = base + "/public/sdk/lemma-client.js";
        s.onload = boot;
        s.onerror = function () { fatal("Couldn't load the Lemma SDK from " + s.src); };
        document.head.appendChild(s);
      })();

      var client;
      var cachedCandidates = [];
      var cachedJobs = [];
      var activeTab = "pipeline";
      var pollIntervalId = null;

      function $(id) { return document.getElementById(id); }
      function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) {
        return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
      function fatal(msg) { $("app").innerHTML = '<div class="center-screen"><div><h1>⚠</h1><p style="margin-top:1rem;color:var(--text-secondary)">' + esc(msg) + "</p></div></div>"; }

      // Animated counter helper
      function animateCounter(id, targetVal) {
        const el = $(id);
        if (!el) return;
        const currentVal = parseInt(el.textContent) || 0;
        if (currentVal === targetVal) return;
        
        let start = currentVal;
        const duration = 800; // ms
        const startTime = performance.now();
        
        function update(currentTime) {
          const elapsed = currentTime - startTime;
          const progress = Math.min(elapsed / duration, 1);
          const easeProgress = progress * (2 - progress); // outQuad
          const val = Math.floor(easeProgress * (targetVal - start) + start);
          el.textContent = val;
          
          if (progress < 1) {
            requestAnimationFrame(update);
          } else {
            el.textContent = targetVal;
          }
        }
        requestAnimationFrame(update);
      }

      // SVG Circular Progress Ring helper
      function setProgressRing(percent, scoreColor = "var(--accent-primary)") {
        const circle = $("progressRingCircle");
        if (!circle) return;
        const radius = circle.r.baseVal.value;
        const circumference = radius * 2 * Math.PI;
        
        circle.style.strokeDasharray = `${circumference} ${circumference}`;
        const offset = circumference - (percent / 100) * circumference;
        circle.style.strokeDashoffset = offset;
        circle.style.stroke = scoreColor;
        
        if ($("progressRingScore")) {
          $("progressRingScore").textContent = Math.round(percent);
        } else {
          $("progressRingValue").textContent = `${Math.round(percent)}%`;
        }
      }

      // Collapsible daily digest helpers
      function toggleDigestCollapse() {
        const content = $("digestBannerContent");
        const icon = $("digestToggleIcon");
        const isCollapsed = content.style.display === "none" || !content.classList.contains("show");
        
        if (isCollapsed) {
          content.style.display = "block";
          content.classList.add("show");
          icon.textContent = "▲";
        } else {
          content.style.display = "none";
          content.classList.remove("show");
          icon.textContent = "▼";
        }
      }

      async function loadLatestDigest() {
        try {
          const digestResp = await client.records.list("digests", { limit: 100 });
          const digests = digestResp.items || [];
          if (digests.length > 0) {
            // Sort by date/created_at desc
            digests.sort((a, b) => {
              const dateA = new Date((a.data || a).date || a.created_at);
              const dateB = new Date((b.data || b).date || b.created_at);
              return dateB - dateA;
            });
            const latest = digests[0].data || digests[0];
            $("digestSummaryText").textContent = latest.summary || "No summary today.";
            $("digestFlagsText").textContent = latest.flags || "No flags today.";
            $("digestDateText").textContent = "Digest Date: " + (latest.date || "");
            $("digestBanner").style.display = "block";
          } else {
            $("digestBanner").style.display = "none";
          }
        } catch (e) {
          console.error("Failed to load daily digests:", e);
        }
      }

      // Candidate Edit Mode helpers
      var editSelectedResumeFile = null;
      var editExtractedResumeText = "";
      var originalCandidateData = null;

      function setupEditDragAndDrop() {
        const dropZone = $("editDragDropZone");
        const fileInput = $("editResumeInput");
        const progressDiv = $("editExtractionProgress");
        const dropZoneText = $("editDragDropText");

        if (!dropZone || !fileInput) return;

        dropZone.onclick = function() {
          fileInput.click();
        };

        fileInput.onchange = function() {
          if (fileInput.files.length > 0) {
            handleEditFileSelect(fileInput.files[0]);
          }
        };

        dropZone.ondragover = function(e) {
          e.preventDefault();
          dropZone.style.borderColor = "var(--accent-primary)";
        };

        dropZone.ondragleave = function(e) {
          e.preventDefault();
          dropZone.style.borderColor = "var(--border)";
        };

        dropZone.ondrop = function(e) {
          e.preventDefault();
          dropZone.style.borderColor = "var(--border)";
          if (e.dataTransfer.files.length > 0) {
            handleEditFileSelect(e.dataTransfer.files[0]);
          }
        };

        async function handleEditFileSelect(file) {
          editSelectedResumeFile = file;
          dropZoneText.textContent = `📄 Selected: ${file.name} (${(file.size / 1024).toFixed(1)} KB)`;
          
          progressDiv.style.display = "block";
          progressDiv.style.color = "var(--text-secondary)";
          progressDiv.textContent = "📄 Reading resume...";

          try {
            const extractedText = await extractTextFromFile(file);
            if (extractedText && extractedText.trim().length > 0) {
              editExtractedResumeText = extractedText;
              console.log('Extracted edit resume text:', extractedText.substring(0, 500));
              progressDiv.textContent = "✅ Resume text extracted — ready to save";
              progressDiv.style.color = "var(--accent-green)";
            } else {
              progressDiv.textContent = "⚠️ Could not read file content — score will be based on role title only";
              progressDiv.style.color = "var(--accent-yellow)";
              editExtractedResumeText = "";
            }
          } catch (err) {
            console.error("Text extraction failed:", err);
            progressDiv.textContent = "⚠️ Text extraction failed — score will be based on role title only";
            progressDiv.style.color = "var(--accent-red)";
            editExtractedResumeText = "";
          }
        }
      }

      function enableEditMode() {
        if (!activeModalCandidateId) return;
        var cand = cachedCandidates.find(c => c.id === activeModalCandidateId);
        if (!cand) return;
        var cData = cand.data || cand;
        
        originalCandidateData = cData;
        
        // Populate edit fields
        $("editCandidateName").value = cData.name || "";
        $("editCandidateEmail").value = cData.email || "";
        
        // Populate role dropdown
        const select = $("editCandidateRole");
        select.innerHTML = "";
        cachedJobs.forEach(job => {
          var jData = job.data || job;
          if (jData.status !== "closed" || jData.title === cData.role_applied) {
            var opt = document.createElement("option");
            opt.value = jData.title;
            opt.textContent = jData.title;
            select.appendChild(opt);
          }
        });
        select.value = cData.role_applied || "";
        
        // Reset file input state
        editSelectedResumeFile = null;
        editExtractedResumeText = "";
        $("editDragDropText").textContent = "Drag & drop or click to upload PDF/Text resume";
        $("editExtractionProgress").style.display = "none";
        $("editValidationError").style.display = "none";
        
        // Toggle view visibility
        $("modalHeaderViewContainer").style.display = "none";
        $("modalStatusButtonsContainer").style.display = "none";
        $("modalScoreSection").style.display = "none";
        $("modalSummarySection").style.display = "none";
        $("modalResumeSection").style.display = "none";
        if ($("modalOfferPanel")) $("modalOfferPanel").style.display = "none";
        if ($("modalRejectionPanel")) $("modalRejectionPanel").style.display = "none";
        $("modalActionsSection").style.display = "none";
        
        $("modalHeaderEditContainer").style.display = "flex";
        $("modalEditControls").style.display = "flex";
      }

      function disableEditMode() {
        // Toggle view visibility back
        $("modalHeaderEditContainer").style.display = "none";
        $("modalEditControls").style.display = "none";
        
        $("modalHeaderViewContainer").style.display = "block";
        $("modalStatusButtonsContainer").style.display = "flex";
        $("modalScoreSection").style.display = "block";
        $("modalSummarySection").style.display = "block";
        
        var cand = cachedCandidates.find(c => c.id === activeModalCandidateId);
        if (cand) {
          var cData = cand.data || cand;
          if (cData.resume_url) {
            $("modalResumeSection").style.display = "block";
          }
          updateSmartPanels(cand);
        }
        
        $("modalActionsSection").style.display = "block";
      }

      async function saveEditChanges() {
        if (!activeModalCandidateId) return;
        
        const newName = $("editCandidateName").value.trim();
        const newEmail = $("editCandidateEmail").value.trim();
        const newRole = $("editCandidateRole").value;
        const errDiv = $("editValidationError");
        
        // Validation
        if (!newName || !newEmail) {
          errDiv.textContent = "⚠️ Candidate Name and Email cannot be empty.";
          errDiv.style.display = "block";
          return;
        }
        
        errDiv.style.display = "none";
        
        const saveBtn = document.querySelector("#modalEditControls .btn-submit");
        const cancelBtn = document.querySelector("#modalEditControls .btn-cancel");
        const originalSaveHtml = saveBtn.innerHTML;
        saveBtn.disabled = true;
        cancelBtn.disabled = true;
        saveBtn.innerHTML = "<span>⏳</span> Saving...";
        
        try {
          var payload = {
            name: newName,
            email: newEmail,
            role_applied: newRole
          };
          
          let fileUploaded = false;
          let roleChanged = (originalCandidateData && originalCandidateData.role_applied !== newRole);
          
          if (editSelectedResumeFile) {
            fileUploaded = true;
            
            const reader = new FileReader();
            const base64Promise = new Promise((resolve, reject) => {
              reader.onload = () => resolve(reader.result.split(',')[1]);
              reader.onerror = reject;
            });
            reader.readAsDataURL(editSelectedResumeFile);
            const base64Str = await base64Promise;
            
            payload.resume_content = base64Str;
            payload.resume_filename = editSelectedResumeFile.name;
            payload.resume_text = editExtractedResumeText || "";
            payload.resume_url = "/" + editSelectedResumeFile.name;
          }
          
          const updateResp = await client.records.update("candidates", activeModalCandidateId, payload);
          const freshCand = updateResp.data || updateResp;
          
          const candIndex = cachedCandidates.findIndex(c => c.id === activeModalCandidateId);
          if (candIndex !== -1) {
            cachedCandidates[candIndex] = updateResp;
          }
          
          showToast("Candidate updated successfully");
          
          if (fileUploaded || roleChanged) {
            showToast("Resume or role updated — AI re-scoring in progress...");
            handleReScoreNoOverlay();
          } else {
            $("modalCandidateName").textContent = freshCand.name || "Unnamed Candidate";
            $("modalCandidateRole").textContent = freshCand.role_applied || "No applied role";
            $("modalCandidateEmail").textContent = freshCand.email || "No email";
            
            if (freshCand.resume_url) {
              $("modalResumeSection").style.display = "block";
            } else {
              $("modalResumeSection").style.display = "none";
            }
          }
          
          renderPipeline();
          renderJobs();
          disableEditMode();
          
        } catch (err) {
          console.error("Failed to save edits:", err);
          errDiv.textContent = "❌ Error: " + (err.message || err);
          errDiv.style.display = "block";
        } finally {
          saveBtn.disabled = false;
          cancelBtn.disabled = false;
          saveBtn.innerHTML = originalSaveHtml;
        }
      }
      
      async function handleReScoreNoOverlay() {
        if (!activeModalCandidateId) return;
        const cand = cachedCandidates.find(c => c.id === activeModalCandidateId);
        if (!cand) return;
        
        try {
          await runScorerAgentFrontend(cand);
          
          var freshCand = await client.records.get("candidates", activeModalCandidateId);
          if (freshCand) {
            const candIndex = cachedCandidates.findIndex(c => c.id === activeModalCandidateId);
            if (candIndex !== -1) {
              cachedCandidates[candIndex] = freshCand;
            }
            
            $("modalCandidateName").textContent = (freshCand.data || freshCand).name || "Unnamed Candidate";
            $("modalCandidateRole").textContent = (freshCand.data || freshCand).role_applied || "No applied role";
            $("modalCandidateEmail").textContent = (freshCand.data || freshCand).email || "No email";
            
            updateSmartPanels(freshCand);
            renderModalStatusButtons(freshCand);
          }
          
          renderPipeline();
          renderJobs();
          
          showToast("AI Re-scoring complete");
        } catch (e) {
          console.error("Background re-scoring failed:", e);
          showToast("Background re-scoring failed", true);
        }
      }

      // Add Job modal helpers
      function openHelpModal() {
        const modal = $("helpModal");
        modal.style.display = "flex";
        modal.offsetHeight;
        modal.classList.add("active");
      }
      function closeHelpModal(event) {
        if (event && event.target !== $("helpModal")) return;
        const modal = $("helpModal");
        modal.classList.remove("active");
        setTimeout(() => { modal.style.display = "none"; }, 300);
      }

      function openAddJobModal() {
        const modal = $("addJobModal");
        modal.style.display = "flex";
        modal.offsetHeight;
        modal.classList.add("active");
      }
      function closeAddJobModal(event) {
        if (event && event.target !== $("addJobModal")) return;
        const modal = $("addJobModal");
        modal.classList.remove("active");
        setTimeout(() => { modal.style.display = "none"; }, 300);
      }

      // AI Insights Side Panel helpers
      function openInsightsPanel() {
        const panel = $("insightsPanel");
        panel.classList.add("open");
        runAIInsights();
      }
      function closeInsightsPanel() {
        $("insightsPanel").classList.remove("open");
      }

      function parseInsightsHtml(text) {
        var lines = text.split("\n");
        var html = "";
        var currentSectionContent = [];
        var currentHeader = "";
        
        var borderColors = {
          "🏆 STRONGEST CANDIDATE": "var(--green)",
          "⚠️ ROLE NEEDING MORE SOURCING": "var(--yellow)",
          "⚡ FAST-TRACK RECOMMENDATIONS": "var(--blue)",
          "📋 THIS WEEK'S PRIORITIES": "var(--accent-purple)"
        };

        function flushSection() {
          if (currentHeader) {
            var color = borderColors[currentHeader] || "var(--accent)";
            html += `<div class="insights-section" style="margin-bottom: 1.5rem; border-left: 3px solid ${color}; padding-left: 12px;">
              <div style="font-weight: 700; font-size: 0.95rem; color: ${color}; margin-bottom: 0.5rem; display: flex; align-items: center; gap: 0.5rem; text-transform: uppercase; letter-spacing: 0.05em;">
                ${currentHeader}
              </div>
              <div style="font-size: 0.9rem; line-height: 1.6; color: var(--text-secondary); white-space: pre-wrap;">${currentSectionContent.join("\n").trim()}</div>
            </div>
            <div style="height: 1px; background: var(--border); margin: 1.5rem 0;"></div>`;
          }
          currentSectionContent = [];
          currentHeader = "";
        }
        
        for (var i = 0; i < lines.length; i++) {
          var line = lines[i].trim();
          if (line.includes("🏆 STRONGEST CANDIDATE") || 
              (line.includes("STRONGEST CANDIDATE") && line.includes("🏆"))) {
            flushSection();
            currentHeader = "🏆 STRONGEST CANDIDATE";
          } else if (line.includes("⚠️ ROLE NEEDING MORE SOURCING") || 
                     (line.includes("ROLE NEEDING MORE SOURCING") && line.includes("⚠️"))) {
            flushSection();
            currentHeader = "⚠️ ROLE NEEDING MORE SOURCING";
          } else if (line.includes("⚡ FAST-TRACK RECOMMENDATIONS") || 
                     (line.includes("FAST-TRACK RECOMMENDATIONS") && line.includes("⚡"))) {
            flushSection();
            currentHeader = "⚡ FAST-TRACK RECOMMENDATIONS";
          } else if (line.includes("📋 THIS WEEK'S PRIORITIES") || 
                     (line.includes("THIS WEEK'S PRIORITIES") && line.includes("📋"))) {
            flushSection();
            currentHeader = "📋 THIS WEEK'S PRIORITIES";
          } else {
            if (currentHeader) {
              currentSectionContent.push(lines[i]);
            }
          }
        }
        flushSection();
        
        if (!html) {
          try {
            return marked.parse(text);
          } catch (e) {
            return text;
          }
        }
        
        var lastDividerIndex = html.lastIndexOf('<div class="divider-gradient" style="margin: 1.5rem 0;"></div>');
        if (lastDividerIndex !== -1) {
          html = html.substring(0, lastDividerIndex);
        }
        
        return html;
      }

      async function runAIInsights() {
        $("insightsSpinner").style.display = "flex";
        $("insightsContent").style.display = "none";
        
        let pipelineData = cachedCandidates.map(c => {
          const d = c.data || c;
          return `- Name: ${d.name}, Role: ${d.role_applied}, Status: ${d.status}, Score: ${d.ai_score != null ? d.ai_score : "N/A"}, Summary: ${d.ai_summary || "N/A"}`;
        }).join("\n");
        
        let prompt = `You are a hiring analytics assistant. Analyze the hiring pipeline for a startup founder.
Do NOT output SCORE or SUMMARY fields. Instead output ONLY these 4 sections:

🏆 STRONGEST CANDIDATE
[Name, role, and why they stand out]

⚠️ ROLE NEEDING MORE SOURCING  
[Which role has weakest applicant pool and why]

⚡ FAST-TRACK RECOMMENDATIONS
[Any candidates in New/Screening who should move to Interview immediately]

📋 THIS WEEK'S PRIORITIES
[3 bullet point actions the founder should take this week]

Pipeline data:
${pipelineData}`;
        
        try {
          var resultText = await runAgentPrompt("insights", prompt, 
            function(msg) {
              $("insightsSpinnerText").textContent = msg;
            },
            function(partialText) {
              $("insightsContent").innerHTML = parseInsightsHtml(partialText);
              $("insightsSpinner").style.display = "flex";
              $("insightsContent").style.display = "block";
            }
          );
          $("insightsContent").innerHTML = parseInsightsHtml(resultText);
          $("insightsSpinner").style.display = "none";
          $("insightsContent").style.display = "block";
        } catch (err) {
          console.warn("AI Insights failed or timed out. Showing fallback summary:", err);
          
          const highestScored = cachedCandidates
            .filter(c => (c.data || c).ai_score != null)
            .sort((a, b) => parseFloat((b.data || b).ai_score) - parseFloat((a.data || a).ai_score))[0];
          const hsData = highestScored ? (highestScored.data || highestScored) : null;
          const hsName = hsData ? hsData.name : "None";
          const hsRole = hsData ? hsData.role_applied : "N/A";
          const hsScore = hsData ? Math.round(parseFloat(hsData.ai_score)) : 0;

          const stageCounts = { new: 0, screening: 0, interview: 0, offer: 0, rejected: 0 };
          cachedCandidates.forEach(c => {
            const status = ((c.data ? c.data.status : c.status) || 'new').toLowerCase();
            if (stageCounts[status] !== undefined) stageCounts[status]++;
          });

          const highScoredNew = cachedCandidates
            .filter(c => {
              const d = c.data || c;
              const status = (d.status || 'new').toLowerCase();
              const score = parseFloat(d.ai_score);
              return (status === 'new' || status === 'screening') && score > 70;
            })
            .map(c => `• ${(c.data || c).name} (${Math.round(parseFloat((c.data || c).ai_score))} Match) applied for ${(c.data || c).role_applied}`)
            .join("\n") || "• No candidates above 70% in early stages currently.";

          const fallbackInsights = `
🏆 STRONGEST CANDIDATE
${hsName} (${hsScore}% Match) for ${hsRole}. They have the highest AI match score in the current pipeline.

⚠️ ROLE NEEDING MORE SOURCING
Sourcing Review:
- New: ${stageCounts.new} candidates
- Screening: ${stageCounts.screening} candidates
Review roles with low pipeline volume to increase candidate sourcing.

⚡ FAST-TRACK RECOMMENDATIONS
We recommend moving these high-scoring early-stage candidates directly to interview:
${highScoredNew}

📋 THIS WEEK'S PRIORITIES
- Review early-stage candidates with scores > 70%
- Schedule interviews for candidates in the Interview column (${stageCounts.interview} currently)
- Follow up on offer status for candidates in the Offer column (${stageCounts.offer} currently)
          `;
          
          $("insightsContent").innerHTML = `
            <div style="font-size: 0.85rem; color: var(--accent-yellow); margin-bottom: 1.5rem; font-weight: 500; display: flex; align-items: center; gap: 0.4rem;">
              <span>⚠️</span> Analysis taking longer than usual. Here's a quick summary based on current pipeline data:
            </div>
            ${parseInsightsHtml(fallbackInsights)}
          `;
          $("insightsSpinner").style.display = "none";
          $("insightsContent").style.display = "block";
        }
      }

      // Bulk Candidate Re-scoring logic
      async function runBulkScoreRefresh() {
        const candidatesToScore = cachedCandidates.filter(c => {
          const d = c.data || c;
          return d.status === "new" || d.status === "screening";
        });
        
        if (candidatesToScore.length === 0) {
          showToast("No candidates in New or Screening stages to re-score.");
          return;
        }
        
        const container = $("bulkProgressContainer");
        const text = $("bulkProgressText");
        const count = $("bulkProgressCount");
        const fill = $("bulkProgressBarFill");
        
        container.style.display = "block";
        fill.style.width = "0%";
        
        let completed = 0;
        const total = candidatesToScore.length;
        
        for (const cand of candidatesToScore) {
          const cData = cand.data || cand;
          text.textContent = `Re-scoring ${cData.name}...`;
          count.textContent = `${completed}/${total}`;
          fill.style.width = `${(completed / total) * 100}%`;
          
          try {
            await runScorerAgentFrontend(cand);
          } catch (err) {
            console.error(`Failed to score candidate ${cData.name}:`, err);
          }
          
          completed++;
        }
        
        text.textContent = `✅ ${total}/${total} candidates scored`;
        count.textContent = `${total}/${total}`;
        fill.style.width = "100%";
        
        setTimeout(() => {
          container.style.display = "none";
        }, 4000);
      }

      // Form Progress Indicators
      function updateFormProgress() {
        const name = $("cName").value;
        const email = $("cEmail").value;
        const role = $("cRole").value;
        
        let completed = 0;
        let total = 4;
        
        if (name) completed++;
        if (email) completed++;
        if (role) completed++;
        if (selectedResumeFile) completed++;
        
        const pct = Math.round((completed / total) * 100);
        $("formProgressText").textContent = `${pct}% Complete`;
        $("formProgressBarFill").style.width = `${pct}%`;
      }
      
      function updateCardPreview() {
        const name = $("cName").value || "Candidate Name";
        const role = $("cRole").value || "Selected Role";
        const initials = name.split(" ").map(n => n.charAt(0)).join("").substring(0, 2).toUpperCase();
        
        var firstLetter = name.charAt(0).toUpperCase();
        var avatarBg = "linear-gradient(135deg, #6366f1, #4f46e5)";
        if (firstLetter >= "G" && firstLetter <= "L") {
          avatarBg = "linear-gradient(135deg, #8b5cf6, #7c3aed)";
        } else if (firstLetter >= "M" && firstLetter <= "R") {
          avatarBg = "linear-gradient(135deg, #3b82f6, #2563eb)";
        } else if (firstLetter >= "S" && firstLetter <= "Z") {
          avatarBg = "linear-gradient(135deg, #10b981, #059669)";
        }
        
        $("previewName").textContent = name;
        $("previewRole").textContent = role;
        $("previewAvatar").textContent = initials || "?";
        $("previewAvatar").style.background = avatarBg;
      }

      var notesSaveTimeout = null;
      var onboardingStepAfterJobCreate = false;
      
      function setupNotesAutoSave() {
        const notesArea = $("modalCandidateNotes");
        const statusSpan = $("notesSaveStatus");
        if (!notesArea) return;
        
        notesArea.oninput = function() {
          if (notesSaveTimeout) clearTimeout(notesSaveTimeout);
          statusSpan.style.display = "none";
          
          notesSaveTimeout = setTimeout(async function() {
            var newNotes = notesArea.value;
            if (!activeModalCandidateId) return;
            
            try {
              await client.records.update("candidates", activeModalCandidateId, {
                notes: newNotes
              });
              
              // Update local cache
              var cand = cachedCandidates.find(c => c.id === activeModalCandidateId);
              if (cand) {
                var cData = cand.data || cand;
                cData.notes = newNotes;
              }
              
              // Show saved indicator
              statusSpan.style.display = "inline";
              setTimeout(() => {
                statusSpan.style.display = "none";
              }, 2000);
            } catch (err) {
              console.error("Auto-save notes failed:", err);
            }
          }, 1500);
        };
      }

      function checkOnboarding() {
        var onboarded = localStorage.getItem("hireflow_onboarded");
        if (onboarded) return;
        
        if (cachedCandidates.length === 0 && cachedJobs.length === 0) {
          $("onboardingOverlay").style.display = "flex";
          nextOnboardingStep(1);
        } else {
          localStorage.setItem("hireflow_onboarded", "true");
        }
      }

      function nextOnboardingStep(step) {
        document.querySelectorAll(".onboarding-step").forEach(s => s.style.display = "none");
        if (step === 1) {
          $("onboardingStep1").style.display = "block";
        } else if (step === 2) {
          $("onboardingStep2").style.display = "block";
        } else if (step === 3) {
          $("onboardingStep3").style.display = "block";
        }
      }

      function skipOnboarding() {
        nextOnboardingStep(3);
      }

      function goToOnboardingJobs() {
        $("onboardingOverlay").style.display = "none";
        switchView("jobs", document.querySelectorAll(".nav-item")[1]);
        openAddJobModal();
        onboardingStepAfterJobCreate = true;
      }

      function finishOnboarding() {
        localStorage.setItem("hireflow_onboarded", "true");
        $("onboardingOverlay").style.display = "none";
        switchView("pipeline", document.querySelectorAll(".nav-item")[0]);
      }


      // Display control functions
      function showLoadingScreen() {
        console.log('[Auth] Transition: showing loading screen.');
        $("loading-screen").style.display = 'flex';
        $("landing-screen").style.display = 'none';
        $("main-app").style.display = 'none';
      }

      function showLanding() {
        console.log('[Auth] Transition: showing landing screen.');
        $("loading-screen").style.display = 'none';
        $("landing-screen").style.display = 'flex';
        $("main-app").style.display = 'none';
        
        // Bind landing click handler
        $("get-started-btn").onclick = async () => {
          console.log('[Auth] Get Started clicked.');
          try {
            showLoadingScreen();
            if (client && client.auth && typeof client.auth.login === 'function') {
              await client.auth.login();
            } else if (client && client.auth && typeof client.auth.redirectToAuth === 'function') {
              await client.auth.redirectToAuth();
            } else {
              var cfg = window.__LEMMA_CONFIG__ || {};
              var base = (cfg.apiUrl || window.location.origin).replace(/\/$/, "");
              window.location.href = base + "/auth/login";
            }
          } catch (err) {
            console.error('[Auth] Login error:', err);
            showLanding();
          }
        };

        // Bind Judge Login buttons
        const trigger = $("judge-login-trigger");
        const area = $("judge-login-area");
        const cancel = $("judge-login-cancel");
        const submit = $("judge-login-submit");
        const emailInput = $("judge-email-input");
        const errorDiv = $("judge-login-error");

        if (trigger && area && cancel && submit && emailInput && errorDiv) {
          trigger.onclick = function() {
            trigger.style.display = "none";
            area.style.display = "flex";
            emailInput.focus();
          };

          cancel.onclick = function() {
            area.style.display = "none";
            trigger.style.display = "inline-block";
            errorDiv.style.display = "none";
          };

          submit.onclick = function() {
            const email = emailInput.value.trim().toLowerCase();
            if (!email || !email.includes("@")) {
              errorDiv.textContent = "⚠️ Please enter a valid email address.";
              errorDiv.style.display = "block";
              return;
            }
            
            // Log in as guest
            const name = email.split("@")[0];
            const guestUser = {
              email: email,
              name: name.charAt(0).toUpperCase() + name.slice(1)
            };
            localStorage.setItem('hireflow_guest_user', JSON.stringify(guestUser));
            
            // Reload page to trigger initApp auth check
            location.reload();
          };

          // Press Enter key to submit
          emailInput.onkeydown = function(e) {
            if (e.key === "Enter") {
              submit.click();
            }
          };
        }
      }

      function showApp() {
        console.log('[Auth] Transition: showing main app.');
        $("loading-screen").style.display = 'none';
        $("landing-screen").style.display = 'none';
        $("main-app").style.display = 'flex';
      }

      async function initApp() {
        console.log('[Auth] initApp invoked.');
        try {
          showLoadingScreen();
          
          if (!client) {
            client = new window.LemmaClient.LemmaClient();
          }
          
          console.log('[Auth] Client config:', client.config);

          // Step 1: Detect and handle OAuth callback first
          const urlParams = new URLSearchParams(window.location.search);
          const isCallback = urlParams.has('code') || urlParams.has('token') || 
                             urlParams.has('session') || window.location.hash.includes('access_token');
          
          if (isCallback) {
            console.log('[Auth] Callback detected! Waiting for client to initialize session...');
            try {
              const callbackAuth = await client.initialize();
              console.log('[Auth] Callback init result:', callbackAuth);
            } catch(e) {
              console.warn('[Auth] Callback initialize failed:', e);
            }
            // Small artificial delay to allow storage updates to settle
            await new Promise(r => setTimeout(r, 800));
          }

          // Step 2: Now perform standard auth check
          console.log('[Auth] Running standard client initialize check...');
          let auth = null;
          try {
            auth = await client.initialize();
          } catch (e) {
            console.warn('[Auth] Standard initialize failed, checking guest session next:', e);
          }
          console.log('[Auth] Initialize result:', auth);
          
          let user = null;
          if (auth && auth.status === 'authenticated') {
            user = auth.user;
          }
          
          // Check localStorage guest bypass override
          const guestUserStr = localStorage.getItem('hireflow_guest_user');
          if (guestUserStr) {
            try {
              user = JSON.parse(guestUserStr);
              console.log('[Auth] Guest/Judge override session loaded:', user);
            } catch (e) {
              console.error('[Auth] Failed to parse guest session:', e);
            }
          }
          
          // Verify with fallback getters if initialize status is unauthenticated but token exists
          if (!user) {
            try {
              user = typeof client.getCurrentUser === 'function' ? await client.getCurrentUser() : null;
            } catch(e) {}
          }
          if (!user && client.auth) {
            try {
              user = typeof client.auth.getUser === 'function' ? await client.auth.getUser() : null;
            } catch(e) {}
            if (!user) {
              try {
                user = typeof client.auth.me === 'function' ? await client.auth.me() : null;
              } catch(e) {}
            }
            if (!user) {
              user = client.auth.currentUser;
            }
          }
          
          console.log('[Auth] Resolved user object:', user);

          if (user && (user.id || user.email)) {
            console.log('[Auth] User successfully authenticated. Displaying main app.');
            const loggedInEmail = user.email || user.name || "User";
            const username = loggedInEmail.includes("@") ? loggedInEmail.split("@")[0] : loggedInEmail;
            $("userEmail").textContent = username;
            $("userAvatar").textContent = loggedInEmail.charAt(0).toUpperCase();
            
            // Bind Sign Out
            $("signOutBtn").onclick = async function () {
              console.log('[Auth] Sign out clicked.');
              localStorage.removeItem('hireflow_guest_user');
              try {
                if (client && client.auth && typeof client.auth.logout === 'function') {
                  await client.auth.logout();
                } else if (client && client.auth && typeof client.auth.signOut === 'function') {
                  await client.auth.signOut();
                }
              } catch (e) {
                console.error('[Auth] Sign out SDK call failed:', e);
              }
              localStorage.clear();
              location.reload();
            };

            // Transition to main dashboard
            showApp();
            
            // Load dashboard datasets
            await refreshData();
            
            // Initialize widgets and plugins
            setupNotesAutoSave();
            checkOnboarding();
            setupDragAndDrop();
            setupEditDragAndDrop();
            updateFormProgress();
            updateCardPreview();
            
            $("btnFloatingInsights").style.display = "flex";
            startPolling();
          } else {
            console.log('[Auth] User not authenticated. Displaying landing screen.');
            showLanding();
          }
        } catch (err) {
          console.error('[Auth] initApp error:', err);
          
          // Check for guest override in fallback catch block
          const guestUserStr = localStorage.getItem('hireflow_guest_user');
          if (guestUserStr) {
            try {
              const guestUser = JSON.parse(guestUserStr);
              if (guestUser && guestUser.email) {
                console.log('[Auth] Fallback guest session activation from catch:', guestUser);
                const loggedInEmail = guestUser.email;
                const username = loggedInEmail.includes("@") ? loggedInEmail.split("@")[0] : loggedInEmail;
                $("userEmail").textContent = username;
                $("userAvatar").textContent = loggedInEmail.charAt(0).toUpperCase();
                
                $("signOutBtn").onclick = function () {
                  localStorage.removeItem('hireflow_guest_user');
                  localStorage.clear();
                  location.reload();
                };
                showApp();
                await refreshData();
                return;
              }
            } catch(e) {}
          }

          // Check for stored sessions/tokens in local storage
          const storedToken = localStorage.getItem(`lemma_token_${client ? client.config.podId : ''}`)
                              || localStorage.getItem('lemma_token')
                              || localStorage.getItem('lemma_session');
          if (storedToken) {
            console.log('[Auth] Found stored session token. Attempting fallback display.');
            showApp();
            await refreshData();
          } else {
            showLanding();
          }
        }
      }

      async function boot() {
        console.log('[Auth] boot triggered by script onload.');
        await initApp();
      }

      document.addEventListener('DOMContentLoaded', function() {
        console.log('[Auth] DOMContentLoaded triggered.');
        // Show loading screen immediately
        showLoadingScreen();
      });

      // Tab Swapping
      function switchView(viewName, buttonEl) {
        activeTab = viewName;
        
        const currentActivePanel = document.querySelector(".view-panel.active");
        
        document.querySelectorAll(".nav-item").forEach(i => i.classList.remove("active"));
        if (buttonEl) buttonEl.classList.add("active");
        else {
          // Find nav item by viewName and make active
          var navItems = document.querySelectorAll(".nav-item");
          if (viewName === "pipeline" && navItems[0]) navItems[0].classList.add("active");
          if (viewName === "jobs" && navItems[1]) navItems[1].classList.add("active");
          if (viewName === "add-candidate" && navItems[2]) navItems[2].classList.add("active");
        }
        
        const targetPanel = $("view-" + viewName);
        
        // Update top bar elements dynamically
        if (viewName === "pipeline") {
          $("topBarTitle").textContent = "Hiring Pipeline";
          if ($("topBarReScoreBtn")) $("topBarReScoreBtn").style.display = "flex";
        } else if (viewName === "jobs") {
          $("topBarTitle").textContent = "Job Openings";
          if ($("topBarReScoreBtn")) $("topBarReScoreBtn").style.display = "none";
        } else if (viewName === "add-candidate") {
          $("topBarTitle").textContent = "Add Candidate";
          if ($("topBarReScoreBtn")) $("topBarReScoreBtn").style.display = "none";
        }
        
        // Hide/show FABs
        if (viewName === "pipeline") {
          $("btnFloatingInsights").style.display = "flex";
        } else {
          $("btnFloatingInsights").style.display = "none";
        }

        if (viewName === "jobs") {
          $("addJobFAB").style.display = "flex";
          loadJobs();
        } else {
          $("addJobFAB").style.display = "none";
        }

        if (viewName === "pipeline") {
          startPolling();
        } else {
          stopPolling();
        }

        if (currentActivePanel && currentActivePanel !== targetPanel) {
          currentActivePanel.style.opacity = "0";
          setTimeout(function() {
            currentActivePanel.classList.remove("active");
            currentActivePanel.style.display = "none";
            
            targetPanel.style.display = "block";
            targetPanel.offsetHeight; // reflow
            targetPanel.classList.add("active");
            setTimeout(function() {
              targetPanel.style.opacity = "1";
            }, 20);
          }, 150);
        } else {
          document.querySelectorAll(".view-panel").forEach(p => {
            if (p !== targetPanel) {
              p.classList.remove("active");
              p.style.display = "none";
              p.style.opacity = "0";
            }
          });
          targetPanel.style.display = "block";
          targetPanel.offsetHeight;
          targetPanel.classList.add("active");
          setTimeout(function() {
            targetPanel.style.opacity = "1";
          }, 20);
        }
      }

      // Fetch Live Data
      async function refreshData() {
        try {
          var candResp = await client.records.list("candidates", { limit: 200 });
          cachedCandidates = candResp.items || [];

          await loadJobs();

          loadStats();
          renderPipeline();
          populateRoleDropdown();
          await loadLatestDigest();
        } catch (err) {
          console.error("Error fetching data from pod tables:", err);
        }
      }

      // Polling Logic
      function startPolling() {
        if (pollIntervalId) return;
        pollIntervalId = setInterval(async () => {
          try {
            var candResp = await client.records.list("candidates", { limit: 200 });
            cachedCandidates = candResp.items || [];
            renderPipeline();
          } catch (e) {
            console.error("Polling candidates failed:", e);
          }
        }, 4000);
      }

      // Stop Polling
      function stopPolling() {
        if (pollIntervalId) {
          clearInterval(pollIntervalId);
          pollIntervalId = null;
        }
      }

      // Toast Notifications Helper
      function showToast(message, type = "success") {
        var toast = $("toast");
        toast.textContent = message;
        
        toast.className = "toast";
        if (type === true) type = "error";
        if (type === false) type = "success";
        
        toast.classList.add(type);
        toast.classList.add("show");
        
        setTimeout(function() {
          toast.classList.remove("show");
        }, 3000);
      }

      // Stats Bar Updater
      function loadStats() {
        const getStatus = c => (c.data ? c.data.status : c.status) || 'new';
        const getJobStatus = j => (j.data ? j.data.status : j.status) || 'open';

        var total = cachedCandidates.length;
        var screening = cachedCandidates.filter(c => getStatus(c) === 'screening').length;
        var interview = cachedCandidates.filter(c => getStatus(c) === 'interview').length;
        var offers = cachedCandidates.filter(c => getStatus(c) === 'offer').length;
        var openRoles = cachedJobs.filter(j => getJobStatus(j) === 'open').length;

        animateCounter("stat-total-val", total);
        animateCounter("stat-screening-val", screening);
        animateCounter("stat-interview-val", interview);
        animateCounter("stat-offers-val", offers);
        animateCounter("stat-jobs-val", openRoles);
      }

      // Kanban Board View Pipeline Render
      function renderPipeline() {
        const getStatus = c => (c.data ? c.data.status : c.status) || 'new';
        var statuses = ["new", "screening", "interview", "offer", "rejected"];
        var stageColors = {
          new: "var(--accent-purple)",
          screening: "var(--blue)",
          interview: "var(--yellow)",
          offer: "var(--green)",
          rejected: "var(--red)"
        };
        var containers = {
          new: $("container-new"),
          screening: $("container-screening"),
          interview: $("container-interview"),
          offer: $("container-offer"),
          rejected: $("container-rejected")
        };
        var counts = { new: 0, screening: 0, interview: 0, offer: 0, rejected: 0 };

        // Clear containers
        statuses.forEach(status => {
          containers[status].innerHTML = "";
        });

        cachedCandidates.forEach(cand => {
          var cData = cand.data || cand;
          var status = getStatus(cand);
          if (!containers[status]) status = "new";

          counts[status]++;

          var score = cData.ai_score;
          var badgeClass = "analyzing";
          var badgeText = "Screening…";

          if (score !== undefined && score !== null && score !== "") {
            var numericScore = parseFloat(score);
            badgeText = Math.round(numericScore) + " Match";
            if (numericScore >= 70) badgeClass = "green";
            else if (numericScore >= 40) badgeClass = "yellow";
            else badgeClass = "red";
          }

          var card = document.createElement("div");
          card.className = "candidate-card";
          card.onclick = () => openDetailsModal(cand);
          
          card.style.borderLeft = "3px solid " + (stageColors[status] || "var(--accent)");
          
          var nameVal = cData.name || "Unnamed";
          var initials = nameVal.split(" ").map(n => n.charAt(0)).join("").substring(0, 2).toUpperCase();
          var firstLetter = nameVal.charAt(0).toUpperCase();
          var avatarBg = "linear-gradient(135deg, #6366f1, #4f46e5)";
          if (firstLetter >= "G" && firstLetter <= "L") {
            avatarBg = "linear-gradient(135deg, #8b5cf6, #7c3aed)";
          } else if (firstLetter >= "M" && firstLetter <= "R") {
            avatarBg = "linear-gradient(135deg, #3b82f6, #2563eb)";
          } else if (firstLetter >= "S" && firstLetter <= "Z") {
            avatarBg = "linear-gradient(135deg, #10b981, #059669)";
          }

          card.innerHTML = `
            <div style="display: flex; gap: 0.75rem; align-items: center; width: 100%;">
              <div class="candidate-avatar" style="width: 32px; height: 32px; border-radius: 50%; background: ${avatarBg}; display: flex; align-items: center; justify-content: center; font-weight: 700; color: #fff; font-size: 0.8rem; flex-shrink: 0;">${esc(initials)}</div>
              <div style="display: flex; flex-direction: column; overflow: hidden; flex-grow: 1; min-width: 0; padding-right: 2.2rem;">
                <div class="name" style="font-weight: 700; font-family: var(--font-sans); font-size: 14px; line-height: 1.2; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${esc(cData.name)}</div>
                <div class="role" style="font-size: 12px; color: var(--text-secondary); margin-top: 0.15rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${esc(cData.role_applied)}</div>
              </div>
              <div class="card-actions-wrapper" style="position: absolute; top: 0.75rem; right: 0.75rem; display: flex; gap: 0.35rem; align-items: center; z-index: 5;">
                <button class="card-action-btn edit-card-btn" onclick="openDetailsModal('${cand.id}', true, event)" title="Edit" style="background: none; border: none; cursor: pointer; padding: 4px; border-radius: 4px; display: flex; align-items: center; justify-content: center; font-size: 0.85rem; color: var(--text-secondary); transition: all 0.2s ease;">✏️</button>
                <button class="card-action-btn delete-card-btn" onclick="handleDeleteCandidateClick('${cand.id}', '${esc(cData.name)}', event)" title="Delete" style="background: none; border: none; cursor: pointer; padding: 4px; border-radius: 4px; display: flex; align-items: center; justify-content: center; font-size: 0.85rem; color: var(--text-secondary); transition: all 0.2s ease;">🗑️</button>
              </div>
            </div>
            <div class="card-footer" style="display: flex; justify-content: space-between; align-items: center; margin-top: 0.25rem;">
              <div class="score-badge ${badgeClass}" style="font-family: var(--font-mono); font-size: 0.75rem; border-radius: 99px; padding: 0.25rem 0.55rem;">${badgeText}</div>
            </div>
          `;

          containers[status].appendChild(card);
        });

        // Update counts
        statuses.forEach(status => {
          $("count-" + status).textContent = counts[status];
          if (counts[status] === 0) {
            var dotColor = stageColors[status] || "var(--accent)";
            containers[status].innerHTML = `
              <div style="text-align: center; padding: 2rem 0.5rem; border: 2px dashed var(--border); border-radius: var(--radius); display: flex; flex-direction: column; align-items: center; gap: 0.5rem; justify-content: center;">
                <span style="width: 8px; height: 8px; border-radius: 50%; background-color: ${dotColor}; display: inline-block;"></span>
                <span style="font-size: 0.78rem; font-weight: 600; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.05em;">No candidates here</span>
              </div>
            `;
          }
        });

        // Auto-refresh stats bar
        loadStats();

        if (cachedCandidates.length === 0) {
          $("kanbanBoard").style.display = "none";
          $("pipelineEmptyState").style.display = "flex";
        } else {
          $("kanbanBoard").style.display = "grid";
          $("pipelineEmptyState").style.display = "none";
        }
      }

      // Inline dropdown toggle handler
      var activeDropdownId = null;
      function toggleMoveDropdown(event, candId) {
        if (event) {
          event.stopPropagation();
          event.preventDefault();
        }
        
        var dropdown = $("dropdown-" + candId);
        var wasActive = dropdown.classList.contains("active");
        
        // Hide all active dropdowns
        document.querySelectorAll(".move-dropdown").forEach(d => {
          d.classList.remove("active");
        });
        
        if (!wasActive) {
          var cand = cachedCandidates.find(c => c.id === candId);
          if (cand) {
            var cData = cand.data || cand;
            var currentStatus = cData.status || "new";
            var statuses = [
              { key: "new", label: "New" },
              { key: "screening", label: "Screening" },
              { key: "interview", label: "Interview" },
              { key: "offer", label: "Offer" },
              { key: "rejected", label: "Rejected" }
            ];
            
            dropdown.innerHTML = "";
            statuses.forEach(s => {
              if (s.key !== currentStatus) {
                var btn = document.createElement("button");
                btn.className = "move-dropdown-option";
                btn.textContent = "To " + s.label;
                btn.onclick = (e) => {
                  e.stopPropagation();
                  moveCandidateStatusInline(candId, s.key);
                };
                dropdown.appendChild(btn);
              }
            });
            dropdown.classList.add("active");
            activeDropdownId = candId;
          }
        } else {
          activeDropdownId = null;
        }
      }

      // Close dropdowns on outside click
      window.addEventListener("click", function() {
        document.querySelectorAll(".move-dropdown").forEach(d => {
          d.classList.remove("active");
        });
        activeDropdownId = null;
      });

      // Inline move handler
      async function moveCandidateStatusInline(candId, newStatus) {
        try {
          await client.records.update("candidates", candId, {
            status: newStatus
          });
          
          // Update cached data
          var candIndex = cachedCandidates.findIndex(c => c.id === candId);
          if (candIndex !== -1) {
            var cData = cachedCandidates[candIndex].data || cachedCandidates[candIndex];
            cData.status = newStatus;
          }
          
          renderPipeline();
          showToast("Moved to " + capitalizeFirstLetter(newStatus));
        } catch (err) {
          showToast("Failed to move candidate: " + (err.message || err), true);
        }
      }

      // Inline Delete Handler
      async function handleDeleteCandidateClick(candId, candName, event) {
        if (event) event.stopPropagation();
        if (confirm("Delete " + candName + "? This cannot be undone.")) {
          try {
            await client.records.delete("candidates", candId);
            // Remove immediately from UI cache
            cachedCandidates = cachedCandidates.filter(c => c.id !== candId);
            renderPipeline();
            showToast("Candidate deleted successfully");
          } catch (err) {
            showToast("Error deleting candidate: " + (err.message || err), true);
          }
        }
      }

      // Fetch and Load Jobs
      async function loadJobs() {
        var container = $("jobsListContainer");
        if (!container) return;
        
        // Show loading spinner if container is empty or doesn't have cards
        if (!container.querySelector(".job-card") && !container.querySelector(".add-new-job-card")) {
          container.innerHTML = `
            <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 4rem 2rem; width: 100%;">
              <div class="spinner" style="width: 32px; height: 32px; border-width: 3px; border: 3px solid transparent; border-top-color: var(--accent); border-radius: 50%; animation: spin 1s linear infinite;"></div>
              <div style="color: var(--text-secondary); margin-top: 1rem; font-size: 0.9rem;">Loading job openings...</div>
            </div>
          `;
        }

        try {
          const jobsResp = await client.records.list('jobs', { limit: 200 });
          cachedJobs = jobsResp.items || [];
          renderJobs();
        } catch (err) {
          console.error('Jobs load error:', err);
          container.innerHTML = `
            <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 4rem 2rem; text-align: center; background: var(--bg-card); border: 1px dashed var(--red); border-radius: var(--radius); width: 100%;">
              <div style="font-size: 2rem; margin-bottom: 1rem;">⚠️</div>
              <h2 style="font-family: var(--font-sans); font-size: 1.2rem; font-weight: 700; margin-bottom: 0.5rem; color: var(--red);">Could not load jobs</h2>
              <p style="color: var(--text-secondary); margin-bottom: 1.5rem; font-size: 0.88rem; max-width: 320px; line-height: 1.5;">Please refresh the page or check your connection.</p>
              <button class="btn-submit" onclick="loadJobs()" style="width: fit-content; padding: 0.5rem 1.25rem;">Retry Loading</button>
            </div>
          `;
          showToast("Error loading jobs: " + (err.message || err), true);
        }
      }

      // Jobs View Render
      function renderJobs() {
        var container = $("jobsListContainer");
        container.innerHTML = "";

        if (cachedJobs.length === 0) {
          container.innerHTML = `
            <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 4rem 2rem; text-align: center; background: var(--bg-card); border: 1px dashed var(--border); border-radius: 16px; width: 100%;">
              <svg width="80" height="80" viewBox="0 0 24 24" fill="none" stroke="var(--accent-primary)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="margin-bottom: 1.5rem; filter: drop-shadow(0 0 8px rgba(99, 102, 241, 0.3));">
                <rect x="2" y="7" width="20" height="14" rx="2" ry="2"/>
                <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/>
              </svg>
              <h2 style="font-family: var(--font-sans); font-size: 1.4rem; font-weight: 800; margin-bottom: 0.5rem; color: var(--text-primary); letter-spacing: -0.02em;">No open roles yet</h2>
              <p style="color: var(--text-secondary); margin-bottom: 1.5rem; font-size: 0.9rem; max-width: 320px; line-height: 1.5; margin-left: auto; margin-right: auto;">Post an open position to start tracking applications and define target skills.</p>
              <button class="btn-submit" onclick="openAddJobModal()" style="width: fit-content; padding: 0.6rem 1.5rem; margin: 0 auto;">Post Your First Job →</button>
            </div>
          `;
          return;
        }

        cachedJobs.forEach(job => {
          var jData = job.data || job;
          var id = job.id;
          var isOpen = jData.status !== "closed";
          
          // Count candidates for this job
          var candidateCount = cachedCandidates.filter(c => {
            var cData = c.data || c;
            return cData.role_applied === jData.title;
          }).length;
          
          var skillsHtml = "";
          if (jData.required_skills) {
            skillsHtml = `<div class="skills-tags" style="display: flex; flex-wrap: wrap; gap: 0.4rem; margin-top: 0.75rem;">` + 
              jData.required_skills.split(",").map(s => {
                return `<span style="background-color: rgba(99, 102, 241, 0.1); border: 1px solid var(--border-accent); color: var(--accent); padding: 0.25rem 0.55rem; border-radius: 6px; font-size: 0.74rem; font-weight: 600;">${esc(s.trim())}</span>`;
              }).join("") + 
              `</div>`;
          }

          var card = document.createElement("div");
          card.className = "job-card";
          card.innerHTML = `
            <div class="job-header" style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 0.75rem;">
              <div class="job-title" style="font-family: var(--font-sans); font-size: 18px; font-weight: 700;">${esc(jData.title)}</div>
              <span onclick="toggleJobStatus('${id}', '${isOpen ? 'closed' : 'open'}')" style="${isOpen ? 'background: rgba(16, 185, 129, 0.1); border: 1px solid rgba(16, 185, 129, 0.3); color: var(--green);' : 'background: rgba(255, 255, 255, 0.03); border: 1px solid var(--border); color: var(--text-secondary);'} padding: 4px 10px; border-radius: 99px; font-size: 11px; font-weight: 600; cursor: pointer; display: inline-block; transition: all 0.15s ease;" onmouseover="this.style.opacity='0.8'" onmouseout="this.style.opacity='1'">
                ${isOpen ? '● Open' : '○ Closed'}
              </span>
            </div>
            <div class="job-desc" style="font-size: 0.88rem; color: var(--text-secondary); line-height: 1.5; flex-grow: 1;">${esc(jData.description)}</div>
            ${skillsHtml}
            <div style="display: flex; justify-content: space-between; align-items: center; border-top: 1px solid var(--border); padding-top: 1rem; margin-top: 0.75rem; font-size: 0.8rem; color: var(--text-secondary);">
              <span style="display: flex; align-items: center; gap: 0.35rem; font-weight: 500;">👥 ${candidateCount} candidates</span>
              <span style="color: var(--text-muted); font-weight: 500;">Posted today</span>
            </div>
          `;
          container.appendChild(card);
        });

        // Add New Job Card at the end
        var addCard = document.createElement("div");
        addCard.className = "job-card add-new-job-card";
        addCard.style.border = "2px dashed var(--border)";
        addCard.style.background = "transparent";
        addCard.style.display = "flex";
        addCard.style.flexDirection = "column";
        addCard.style.alignItems = "center";
        addCard.style.justifyContent = "center";
        addCard.style.minHeight = "180px";
        addCard.style.cursor = "pointer";
        addCard.style.transition = "all 0.2s ease";
        addCard.onclick = () => openAddJobModal();
        addCard.onmouseover = function() {
          this.style.borderColor = "var(--accent)";
          this.style.backgroundColor = "var(--bg-elevated)";
        };
        addCard.onmouseout = function() {
          this.style.borderColor = "var(--border)";
          this.style.backgroundColor = "transparent";
        };
        addCard.innerHTML = `
          <div style="font-size: 2rem; color: var(--accent); margin-bottom: 0.5rem; font-weight: 300;">+</div>
          <div style="font-weight: 600; font-size: 0.95rem; color: var(--text-secondary);">Post a New Role</div>
        `;
        container.appendChild(addCard);
      }

      // Populate Candidates Form dropdown
      function populateRoleDropdown() {
        var dropdown = $("cRole");
        dropdown.innerHTML = `<option value="" disabled selected>Select a job posting...</option>`;
        
        cachedJobs.forEach(job => {
          var jData = job.data || job;
          if (jData.status !== "closed") {
            var opt = document.createElement("option");
            opt.value = jData.title;
            opt.textContent = jData.title;
            dropdown.appendChild(opt);
          }
        });
      }

      // Add Job Handler
      async function handleCreateJob(event) {
        event.preventDefault();
        var title = $("jobTitle").value;
        var skills = $("jobSkills").value;
        var desc = $("jobDesc").value;

        try {
          await client.records.create("jobs", {
            title: title,
            required_skills: skills,
            description: desc,
            status: "open"
          });

          $("createJobForm").reset();
          closeAddJobModal();
          await refreshData();
          showToast("Job opening posted successfully");
          
          if (onboardingStepAfterJobCreate) {
            onboardingStepAfterJobCreate = false;
            $("onboardingOverlay").style.display = "flex";
            nextOnboardingStep(3);
          }
        } catch (err) {
          showToast("Error creating job: " + (err.message || err), true);
        }
      }

      // Toggle Job Status
      async function toggleJobStatus(jobId, newStatus) {
        try {
          await client.records.update("jobs", jobId, {
            status: newStatus
          });
          var job = cachedJobs.find(j => j.id === jobId);
          if (job) {
            var jData = job.data || job;
            jData.status = newStatus;
          }
          await refreshData();
          showToast("Job status updated to " + newStatus.toUpperCase());
        } catch (err) {
          showToast("Error updating job status: " + (err.message || err), true);
        }
      }

      // Drag & Drop File Upload State & Helpers
      var selectedResumeFile = null;
      var resetDropZone = null;

      var extractedResumeText = "";

      async function extractTextFromFile(file) {
        return new Promise((resolve) => {
          const reader = new FileReader();
          
          if (file.type === 'application/pdf' || file.name.endsWith('.pdf')) {
            reader.readAsArrayBuffer(file);
            reader.onload = async () => {
              try {
                pdfjsLib.GlobalWorkerOptions.workerSrc = 
                  'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
                const pdf = await pdfjsLib.getDocument({ data: reader.result }).promise;
                let fullText = '';
                for (let i = 1; i <= Math.min(pdf.numPages, 5); i++) {
                  const page = await pdf.getPage(i);
                  const content = await page.getTextContent();
                  fullText += content.items.map(item => item.str).join(' ') + '\n';
                }
                resolve(fullText.trim().slice(0, 4000));
              } catch (err) {
                resolve(`Resume file: ${file.name}`);
              }
            };
          } else {
            reader.readAsText(file);
            reader.onload = () => {
              const text = reader.result;
              if (text && text.startsWith('data:')) {
                const base64 = text.split(',')[1];
                const decoded = atob(base64);
                resolve(decoded.slice(0, 4000));
              } else {
                resolve((text || '').slice(0, 4000));
              }
            };
          }
          
          reader.onerror = () => resolve(`Resume file: ${file.name}`);
        });
      }

      function fileToBase64(file) {
        return new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.readAsDataURL(file);
          reader.onload = () => resolve(reader.result);
          reader.onerror = error => reject(error);
        });
      }

      function setupDragAndDrop() {
        const dropZone = $("resumeDropZone");
        const fileInput = $("cResumeFile");
        const fileInfo = $("dropZoneFileInfo");
        const fileNameSpan = $("dropZoneFileName");
        const removeBtn = $("btnRemoveFile");
        const errorDiv = $("dropZoneError");
        const dropZoneText = dropZone.querySelector(".drop-zone-text");
        const dropZoneSubtext = dropZone.querySelector(".drop-zone-subtext");
        const dropZoneIcon = dropZone.querySelector(".drop-zone-icon");

        const allowedExtensions = [".pdf", ".doc", ".docx", ".txt", ".rtf"];
        const maxSizeBytes = 5 * 1024 * 1024; // 5MB

        dropZone.onclick = function(e) {
          if (e.target === removeBtn || removeBtn.contains(e.target)) {
            return;
          }
          fileInput.click();
        };

        fileInput.onchange = function() {
          if (fileInput.files.length > 0) {
            handleFileSelect(fileInput.files[0]);
          }
        };

        dropZone.ondragover = function(e) {
          e.preventDefault();
          dropZone.classList.add("dragover");
        };

        dropZone.ondragleave = function(e) {
          e.preventDefault();
          dropZone.classList.remove("dragover");
        };

        dropZone.ondrop = function(e) {
          e.preventDefault();
          dropZone.classList.remove("dragover");
          if (e.dataTransfer.files.length > 0) {
            handleFileSelect(e.dataTransfer.files[0]);
          }
        };

        removeBtn.onclick = function(e) {
          e.stopPropagation();
          resetFileState();
        };

        function showExtractionStatus(text, colorClass = "") {
          const statusDiv = $("dropZoneStatus");
          if (!statusDiv) return;
          statusDiv.textContent = text;
          statusDiv.style.display = "block";
          
          if (colorClass === "green") {
            statusDiv.style.color = "var(--accent-green)";
          } else if (colorClass === "yellow") {
            statusDiv.style.color = "var(--accent-yellow)";
          } else {
            statusDiv.style.color = "var(--text-secondary)";
          }
        }
        
        function hideExtractionStatus() {
          const statusDiv = $("dropZoneStatus");
          if (statusDiv) statusDiv.style.display = "none";
        }

        async function handleFileSelect(file) {
          errorDiv.style.display = "none";
          hideExtractionStatus();
          extractedResumeText = "";
          
          const name = file.name;
          const extIndex = name.lastIndexOf(".");
          const ext = extIndex !== -1 ? name.slice(extIndex).toLowerCase() : "";
          
          if (!allowedExtensions.includes(ext)) {
            showError("Invalid file format. Accepted formats: PDF, DOC, DOCX, TXT, RTF");
            return;
          }

          if (file.size > maxSizeBytes) {
            showError("File is too large. Maximum size allowed is 5MB.");
            return;
          }

          selectedResumeFile = file;
          
          fileNameSpan.textContent = file.name;
          updateFormProgress();
          fileInfo.style.display = "flex";
          dropZoneText.style.display = "none";
          dropZoneSubtext.style.display = "none";
          dropZoneIcon.style.display = "none";

          showExtractionStatus("📄 Reading resume...", "gray");
          try {
            extractedResumeText = await extractTextFromFile(file);
            console.log('Extracted resume text:', extractedResumeText.substring(0, 500));
            showExtractionStatus("✅ Resume text extracted — ready to submit", "green");
          } catch (e) {
            console.error("Text extraction failed:", e);
            extractedResumeText = `File: ${file.name} (extraction failed, score based on role title only)`;
            showExtractionStatus("⚠️ Could not read file — score will be based on role title only", "yellow");
          }
        }

        function showError(msg) {
          errorDiv.textContent = msg;
          errorDiv.style.display = "block";
          resetFileState();
        }

        function resetFileState() {
          selectedResumeFile = null;
          fileInput.value = "";
          fileInfo.style.display = "none";
          hideExtractionStatus();
          extractedResumeText = "";
          updateFormProgress();
          dropZoneText.style.display = "block";
          dropZoneSubtext.style.display = "block";
          dropZoneIcon.style.display = "block";
        }

        resetDropZone = resetFileState;
      }

      // Add Candidate Handler
      async function handleAddCandidate(event) {
        event.preventDefault();
        var name = $("cName").value;
        var email = $("cEmail").value;
        var role = $("cRole").value;
        var notes = $("cNotes").value;

        if (!selectedResumeFile) {
          showToast("Please upload a resume file", true);
          return;
        }

        const submitBtn = event.target.querySelector('button[type="submit"]');
        const originalBtnHtml = submitBtn.innerHTML;
        submitBtn.disabled = true;
        submitBtn.innerHTML = `<span class="spinner" style="width: 16px; height: 16px; border-width: 2px; display: inline-block; vertical-align: middle; border: 2px solid transparent; border-top-color: currentColor; border-radius: 50%; animation: spin 1s linear infinite; margin-right: 0.5rem;"></span> Adding candidate...`;

        try {
          // Upload actual file to Lemma files datastore
          const fileResp = await client.files.upload(selectedResumeFile, { name: name + "_resume" });
          const resumeUrl = fileResp.path || fileResp.url || fileResp.id;

          // Convert file to base64 for legacy database compatibility
          const base64Data = await fileToBase64(selectedResumeFile);

          const newCand = await client.records.create("candidates", {
            name: name,
            email: email,
            role_applied: role,
            resume_url: resumeUrl,
            resume_content: base64Data,
            resume_filename: selectedResumeFile.name,
            resume_text: extractedResumeText || "",
            notes: notes,
            status: "new"
          });

          submitBtn.innerHTML = "✅ Candidate Added!";
          await new Promise(resolve => setTimeout(resolve, 800));

          $("addCandidateForm").reset();
          if (resetDropZone) resetDropZone();
          
          switchView("pipeline", document.querySelectorAll(".nav-item")[0]);
          await refreshData();
          showToast("Resume uploaded — AI scoring in progress...");
          
          // Auto-trigger background AI scorer run
          runScorerAgentFrontend(newCand);
        } catch (err) {
          showToast("Error adding candidate: " + (err.message || err), true);
        } finally {
          submitBtn.disabled = false;
          submitBtn.innerHTML = originalBtnHtml;
        }
      }


      // Render Status Buttons in Modal
      function renderModalStatusButtons(cand) {
        var cData = cand.data || cand;
        var currentStatus = cData.status || "new";
        
        var statuses = [
          { key: "new", label: "New" },
          { key: "screening", label: "Screening" },
          { key: "interview", label: "Interview" },
          { key: "offer", label: "Offer" },
          { key: "rejected", label: "Rejected" }
        ];

        var container = $("modalStatusButtons");
        container.innerHTML = "";

        statuses.forEach(s => {
          var btn = document.createElement("button");
          btn.className = "btn-status-stage";
          btn.textContent = s.label;
          
          if (s.key === currentStatus) {
            btn.classList.add("active");
            btn.classList.add("stage-" + s.key);
          } else {
            btn.onclick = async () => {
              await moveCandidateStatusFromModal(cand.id, s.key);
            };
          }
          container.appendChild(btn);
        });
      }

      // Helper to capitalize first letter
      function capitalizeFirstLetter(string) {
        if (!string) return "";
        return string.charAt(0).toUpperCase() + string.slice(1);
      }

      // Move Candidate Status from Modal
      async function moveCandidateStatusFromModal(candId, newStatus) {
        try {
          await client.records.update("candidates", candId, {
            status: newStatus
          });
          
          // Update cached data
          var candIndex = cachedCandidates.findIndex(c => c.id === candId);
          if (candIndex !== -1) {
            var cand = cachedCandidates[candIndex];
            var cData = cand.data || cand;
            cData.status = newStatus;
            
            // Re-render modal buttons to reflect new active status
            renderModalStatusButtons(cand);
            
            // Update smart panels dynamically
            updateSmartPanels(cand);
          }
          
          renderPipeline();
          showToast("Moved to " + capitalizeFirstLetter(newStatus));
        } catch (err) {
          showToast("Failed to move candidate: " + (err.message || err), true);
        }
      }

      // Modal Handling
      var activeModalCandidateId = null;
      async function openDetailsModal(cand, startInEditMode = false, event = null) {
        if (event) {
          event.stopPropagation();
        }
        if (typeof cand === "string") {
          cand = cachedCandidates.find(c => c.id === cand);
        }
        if (!cand) return;
        
        var candId = cand.id;
        activeModalCandidateId = candId;

        // Fetch fresh candidate details
        try {
          var freshCand = await client.records.get("candidates", candId);
          if (freshCand) {
            cand = freshCand;
          }
        } catch (err) {
          console.error("Failed to fetch fresh candidate data on modal load:", err);
        }

        var cData = cand.data || cand;

        var nameVal = cData.name || "Unnamed";
        var initials = nameVal.split(" ").map(n => n.charAt(0)).join("").substring(0, 2).toUpperCase();
        var firstLetter = nameVal.charAt(0).toUpperCase();
        var avatarBg = "linear-gradient(135deg, #6366f1, #4f46e5)";
        if (firstLetter >= "G" && firstLetter <= "L") {
          avatarBg = "linear-gradient(135deg, #8b5cf6, #7c3aed)";
        } else if (firstLetter >= "M" && firstLetter <= "R") {
          avatarBg = "linear-gradient(135deg, #3b82f6, #2563eb)";
        } else if (firstLetter >= "S" && firstLetter <= "Z") {
          avatarBg = "linear-gradient(135deg, #10b981, #059669)";
        }
        
        $("modalCandidateAvatar").textContent = initials;
        $("modalCandidateAvatar").style.background = avatarBg;

        $("modalCandidateName").textContent = cData.name || "Unnamed Candidate";
        $("modalCandidateRole").textContent = cData.role_applied || "No applied role";
        $("modalCandidateEmail").textContent = cData.email || "No email";
        $("modalCandidateNotes").value = cData.notes || "";

        if (cData.resume_url || cData.resume_text || cData.resume_content) {
          $("modalResumeSection").style.display = "block";
          $("modalResumeBtn").onclick = async () => {
            const originalBtnText = $("modalResumeBtn").innerHTML;
            $("modalResumeBtn").disabled = true;
            $("modalResumeBtn").innerHTML = "<span>⏳</span> Downloading...";
            try {
              await downloadResume(cData);
            } finally {
              $("modalResumeBtn").disabled = false;
              $("modalResumeBtn").innerHTML = originalBtnText;
            }
          };
          $("modalResumePDFBtn").onclick = () => {
            downloadResumeAsPDF(cData);
          };
        } else {
          $("modalResumeSection").style.display = "none";
        }



        // Render status badges and movement buttons
        renderModalStatusButtons(cand);

        // Update stage-specific smart panels
        updateSmartPanels(cand);

        // Destructive modal button handler
        $("modalDeleteBtn").onclick = async () => {
          if (confirm("Delete " + (cData.name || "this candidate") + "? This cannot be undone.")) {
            try {
              await client.records.delete("candidates", cand.id);
              closeDetailsModal();
              cachedCandidates = cachedCandidates.filter(c => c.id !== cand.id);
              renderPipeline();
              showToast("Candidate deleted successfully");
            } catch (err) {
              showToast("Error deleting candidate: " + (err.message || err), true);
            }
          }
        };

        const modalOverlay = $("detailsModal");
        modalOverlay.style.display = "flex";
        modalOverlay.offsetHeight;
        modalOverlay.classList.add("active");
        
        if (startInEditMode) {
          enableEditMode();
        }
      }

      async function downloadResume(candidate) {
        try {
          const resumeText = candidate.resume_content || candidate.resume_text || candidate.resume_url || '';
          
          if (!resumeText) {
            showToast('No resume available', 'error');
            return;
          }

          // If it's a URL open in new tab
          if (resumeText.startsWith('http://') || resumeText.startsWith('https://')) {
            window.open(resumeText, '_blank');
            return;
          }

          // If it's a base64 data URL, decode it to binary bytes using its proper MIME type
          if (resumeText.startsWith('data:')) {
            const parts = resumeText.split(',');
            const mimeType = parts[0].split(':')[1].split(';')[0];
            const base64Str = parts[1];
            
            const byteCharacters = atob(base64Str);
            const byteNumbers = new Array(byteCharacters.length);
            for (let i = 0; i < byteCharacters.length; i++) {
              byteNumbers[i] = byteCharacters.charCodeAt(i);
            }
            const byteArray = new Uint8Array(byteNumbers);
            const blob = new Blob([byteArray], { type: mimeType });
            
            // Determine file extension
            let ext = '.txt';
            if (mimeType === 'application/pdf') ext = '.pdf';
            else if (mimeType === 'application/msword') ext = '.doc';
            else if (mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') ext = '.docx';
            else if (mimeType === 'application/rtf') ext = '.rtf';
            
            let filename = (candidate.name || 'candidate').replace(/\s+/g, '_') + '_resume' + ext;
            if (candidate.resume_filename) {
              filename = candidate.resume_filename;
            }

            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            showToast('Resume downloaded', 'success');
            return;
          }

          // Plain text fallback
          const blob = new Blob([resumeText], { type: 'text/plain' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = (candidate.name || 'candidate').replace(/\s+/g, '_') + '_resume.txt';
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          URL.revokeObjectURL(url);
          showToast('Resume downloaded', 'success');

        } catch (err) {
          console.error('Download error:', err);
          showToast('Download failed: ' + err.message, 'error');
        }
      }

      function downloadResumeAsPDF(candidate) {
        try {
          const cData = candidate.data || candidate;
          
          let resumeText = cData.resume_text || cData.resume_content || '';
          
          if (!resumeText) {
            showToast('No resume available to download as PDF', 'error');
            return;
          }

          // If it's a base64 data URL, decode it first
          if (resumeText.startsWith('data:')) {
            const parts = resumeText.split(',');
            const mimeType = parts[0].split(':')[1].split(';')[0];
            const base64Str = parts[1];
            
            // If the original file is already a PDF, download it directly
            if (mimeType === 'application/pdf') {
              downloadResume(candidate);
              return;
            }

            try {
              resumeText = atob(base64Str);
            } catch (e) {
              console.error("Base64 decode failed:", e);
            }
          }

          const headerHtml = `
            <div class="resume-doc-header">
              <h1>${esc(cData.name || 'Candidate')}</h1>
              <div class="resume-meta"><strong>Role Applied:</strong> ${esc(cData.role_applied || 'N/A')}</div>
              <div class="resume-meta"><strong>Email:</strong> ${esc(cData.email || 'N/A')}</div>
              <div class="resume-meta"><strong>Generated on:</strong> ${new Date().toLocaleDateString()}</div>
            </div>
          `;

          const bodyHtml = `
            <div class="resume-content-body">${esc(resumeText || 'No resume text available.')}</div>
          `;

          $("resume-print-area").innerHTML = headerHtml + bodyHtml;
          
          document.body.classList.add("print-resume");
          window.print();
          document.body.classList.remove("print-resume");
          
          $("resume-print-area").innerHTML = "";
          showToast('PDF download started', 'success');
        } catch (err) {
          console.error('PDF download error:', err);
          showToast('Failed to print PDF: ' + err.message, 'error');
        }
      }

      function closeDetailsModal(event) {
        if (event && event.target !== $("detailsModal")) return;
        const modalOverlay = $("detailsModal");
        modalOverlay.classList.remove("active");
        setTimeout(() => { modalOverlay.style.display = "none"; }, 300);
        disableEditMode();
        activeModalCandidateId = null;
      }

      var modalPollInterval = null;
      var activeScoringIds = {};

      function accelerateModalPolling(candidateId) {
        if (modalPollInterval) clearInterval(modalPollInterval);
        modalPollInterval = setInterval(async () => {
          if (!activeModalCandidateId || activeModalCandidateId !== candidateId) {
            clearInterval(modalPollInterval);
            modalPollInterval = null;
            return;
          }
          try {
            var cand = await client.records.get("candidates", candidateId);
            var cData = cand.data || cand;
            if (cData.ai_score !== undefined && cData.ai_score !== null && cData.ai_score !== "") {
              // Update local cache and board card
              var candIndex = cachedCandidates.findIndex(c => c.id === candidateId);
              if (candIndex !== -1) {
                cachedCandidates[candIndex] = cand;
                renderPipeline();
              }
              
              // Update modal smart panels now that score is available
              updateSmartPanels(cand);

              clearInterval(modalPollInterval);
              modalPollInterval = null;
            }
          } catch (e) {
            console.error("Modal polling candidate info failed:", e);
          }
        }, 2000);
      }

      async function runScorerAgentFrontend(cand) {
        var candId = cand.id;
        if (activeScoringIds[candId]) return;
        activeScoringIds[candId] = true;
        
        var cData = cand.data || cand;
        console.log("[Scorer Run] Starting frontend scorer run for candidate:", cData.name);
        
        var matchingJob = cachedJobs.find(function(j) {
          var jData = j.data || j;
          return jData.title === cData.role_applied;
        });
        var requiredSkills = matchingJob && (matchingJob.data || matchingJob).required_skills ? (matchingJob.data || matchingJob).required_skills : "Not specified";
        
        var prompt = `You are evaluating a job candidate. Here is their resume text extracted from a PDF:

---RESUME START---
${cData.resume_text || cData.resume_content || cData.resume_url}
---RESUME END---

Job: ${cData.role_applied}
Required skills: ${requiredSkills}

Read the resume carefully and:
1. List the skills you found that match the required skills
2. Score the candidate 0-100 based on skill match
3. Write a 2-3 sentence recruiter summary

Output EXACTLY:
SCORE: [number]
SUMMARY: [your evaluation]`;
        
        try {
          var resultText = await runAgentPrompt("scorer", prompt, function(msg) {
            console.log("[Scorer Run Progress]", msg);
          });
          
          console.log("[Scorer Run] Agent text output:", resultText);
          
          // Parse score and summary from scorer agent's strict format
          var score = 35; // Default fallback
          var scoreMatch = resultText.match(/SCORE:\s*\*?(\d+)/i) ||
                           resultText.match(/(?:Score|score|Match Score|match score):\s*\*?(\d+)/i) || 
                           resultText.match(/(\d+)\s*\/\s*100/);
          if (scoreMatch) {
            score = parseFloat(scoreMatch[1]);
          }
          
          var summary = "Screening completed. See agent evaluation for details.";
          var summaryMatch = resultText.match(/SUMMARY:\s*\*?([\s\S]+)/i) ||
                             resultText.match(/(?:AI Summary|Summary|Explanation)[^\n]*\n+([\s\S]+?)(?:\n\n|\n\*?\*?Recommended|\n###|\n\*\*|$)/i);
          if (summaryMatch) {
            summary = summaryMatch[1].trim().replace(/^>\s*/gm, "");
          } else {
            var sentences = resultText.match(/[^.!?]+[.!?]+/g);
            if (sentences && sentences.length > 0) {
              summary = sentences.slice(0, 3).join(" ").trim();
            }
          }
          
          console.log("[Scorer Run] Parsed score:", score, "summary:", summary);
          
          // Update the database record directly
          await client.records.update("candidates", candId, {
            ai_score: score,
            ai_summary: summary,
            status: "screening"
          });
          
          // Update local cache and UI
          var candIndex = cachedCandidates.findIndex(c => c.id === candId);
          if (candIndex !== -1) {
            var cachedCand = cachedCandidates[candIndex];
            var cachedData = cachedCand.data || cachedCand;
            cachedData.ai_score = score;
            cachedData.ai_summary = summary;
            cachedData.status = "screening";
            
            if (activeModalCandidateId === candId) {
              updateSmartPanels(cachedCand);
            }
          }
          
          renderPipeline();
          showToast("Scoring completed for " + cData.name);
        } catch (err) {
          console.error("[Scorer Run] Failed to run scorer agent from frontend:", err);
        } finally {
          delete activeScoringIds[candId];
        }
      }

      async function handleReScore() {
        const btn = $("modalReScoreBtn");
        if (!activeModalCandidateId) return;
        
        const originalBtnText = btn.innerHTML;
        btn.disabled = true;
        btn.innerHTML = "<span>⏳</span> Re-scoring...";
        try {
          var cand = cachedCandidates.find(c => c.id === activeModalCandidateId);
          if (cand) {
            await runScorerAgentFrontend(cand);
            
            // Fetch fresh candidate details to update modal display live
            var freshCand = await client.records.get("candidates", activeModalCandidateId);
            if (freshCand) {
              var candIndex = cachedCandidates.findIndex(c => c.id === activeModalCandidateId);
              if (candIndex !== -1) {
                cachedCandidates[candIndex] = freshCand;
              }
              
              $("modalCandidateName").textContent = (freshCand.data || freshCand).name || "Unnamed Candidate";
              $("modalCandidateRole").textContent = (freshCand.data || freshCand).role_applied || "No applied role";
              $("modalCandidateEmail").textContent = (freshCand.data || freshCand).email || "No email";
              $("modalCandidateNotes").value = (freshCand.data || freshCand).notes || "";
              
              updateSmartPanels(freshCand);
              renderModalStatusButtons(freshCand);
            }
            showToast("Re-scoring complete");
          }
        } catch (e) {
          console.error("Re-scoring failed:", e);
          showToast("Re-scoring failed: " + (e.message || e), true);
        } finally {
          btn.disabled = false;
          btn.innerHTML = originalBtnText;
        }
      }

      // Update stage-specific smart panels
      function updateSmartPanels(cand) {
        var cData = cand.data || cand;
        var status = cData.status || "new";
        
        // Hide all smart panels first
        $("modalScoreSection").style.display = "none";
        $("modalSummarySection").style.display = "none";
        $("modalGenerateKitBtn").style.display = "none";
        $("modalOfferPanel").style.display = "none";
        $("modalRejectionPanel").style.display = "none";

        // Reset Offer/Rejection results/spinners on change
        $("offerDraftSpinner").style.display = "none";
        $("offerDraftResultContainer").style.display = "none";
        $("btnGenerateOffer").style.display = "block";
        $("rejectionDraftSpinner").style.display = "none";
        $("rejectionDraftResultContainer").style.display = "none";
        $("btnGenerateRejection").style.display = "block";

        if (status === "new") {
          // No extra panels for new
          return;
        }

        // Show AI Match Score section for all active pipeline stages
        $("modalScoreSection").style.display = "block";
        $("modalSummarySection").style.display = "block";

        var score = cData.ai_score;
        var summary = $("modalCandidateSummary");
        var banner = $("modalSuggestionBanner");

        if (score !== undefined && score !== null && score !== "") {
          var numericScore = parseFloat(score);
          
          // Set SVG Circular Progress Ring
          let scoreColor = "var(--accent-red)";
          if (numericScore >= 70) scoreColor = "var(--accent-green)";
          else if (numericScore >= 40) scoreColor = "var(--accent-yellow)";
          setProgressRing(numericScore, scoreColor);
          $("modalScoreText").textContent = `${Math.round(numericScore)} / 100 Match`;
          summary.textContent = cData.ai_summary || "No screening evaluation written.";
          
          // AI Status Suggestion
          let bannerClass = "";
          let text = "";
          let targetStage = "";
          let actionLabel = "";
          
          if (numericScore >= 80) {
            bannerClass = "green";
            text = "🌟 Strong Match — Consider moving to Interview";
            targetStage = "interview";
            actionLabel = "Move to Interview";
          } else if (numericScore >= 60) {
            bannerClass = "blue";
            text = "✅ Good Match — Review and move to Screening";
            targetStage = "screening";
            actionLabel = "Move to Screening";
          } else if (numericScore >= 40) {
            bannerClass = "yellow";
            text = "⚠️ Partial Match — Manual review recommended";
            targetStage = "screening";
            actionLabel = "Move to Screening";
          } else {
            bannerClass = "red";
            text = "❌ Weak Match — Consider rejecting";
            targetStage = "rejected";
            actionLabel = "Reject Candidate";
          }
          
          banner.className = "suggestion-banner " + bannerClass;
          $("suggestionText").textContent = text;
          
          // Only show action button if candidate is not already in target status
          if (status !== targetStage) {
            $("btnApplySuggestion").style.display = "block";
            $("btnApplySuggestion").textContent = actionLabel;
            $("btnApplySuggestion").onclick = async () => {
              await moveCandidateStatusFromModal(cand.id, targetStage);
            };
          } else {
            $("btnApplySuggestion").style.display = "none";
          }
          banner.style.display = "flex";
        } else {
          setProgressRing(0, "var(--text-secondary)");
          $("modalScoreText").textContent = "Screening in Progress…";
          summary.textContent = "The candidate is currently being evaluated by the scorer AI agent. Please stand by, score updates automatically.";
          banner.style.display = "none";
          
          // Trigger the scorer run from frontend to guarantee it scores successfully
          runScorerAgentFrontend(cand);
        }

        // Show the stage-specific action panel
        if (status === "interview") {
          $("modalGenerateKitBtn").style.display = "block";
          $("modalGenerateKitBtn").onclick = async () => {
            await startInterviewKitGeneration(cand);
          };
        } else if (status === "offer") {
          $("modalOfferPanel").style.display = "block";
          $("btnGenerateOffer").onclick = () => generateOfferSummary(cand);
        } else if (status === "rejected") {
          $("modalRejectionPanel").style.display = "block";
          $("btnGenerateRejection").onclick = () => generateRejectionEmail(cand);
        }
      }

      async function generateOfferSummary(cand) {
        var cData = cand.data || cand;
        var name = cData.name || "Candidate";
        var role = cData.role_applied || "N/A";
        var score = cData.ai_score || "N/A";
        if (score !== "N/A") {
          score = Math.round(parseFloat(score));
        }

        var prompt = `Write a professional offer letter for ${name} who applied for the ${role} position. They scored ${score}/100 in our AI screening. The letter should include: warm congratulations opening, role title and excitement to extend this offer, next steps: (1) Review and sign offer letter within 3 business days (2) Complete background verification (3) Confirm start date with HR, suggested start date within 2-4 weeks from today, a note that full compensation and benefits details will be in the formal offer document, warm closing signed 'The HireFlow Hiring Team'. Keep it professional, warm, and concise. 3-4 short paragraphs.`;

        $("btnGenerateOffer").style.display = "none";
        $("offerDraftSpinner").style.display = "flex";
        $("offerDraftResultContainer").style.display = "none";

        try {
          var resultText = await runAgentPrompt("interviewer", prompt, function(msg) {
            console.log("[Offer Gen]", msg);
          });

          $("offerDraftText").textContent = resultText;
          $("btnCopyOffer").onclick = () => {
            navigator.clipboard.writeText(resultText).then(() => {
              showToast("Offer letter copied!");
            }).catch(err => {
              showToast("Failed to copy text: " + err, true);
            });
          };

          $("offerDraftSpinner").style.display = "none";
          $("offerDraftResultContainer").style.display = "flex";
          showToast("Offer letter drafted!");
        } catch (err) {
          showToast("Failed to draft offer letter: " + (err.message || err), true);
          $("offerDraftSpinner").style.display = "none";
          $("btnGenerateOffer").style.display = "block";
        }
      }

      async function generateRejectionEmail(cand) {
        var cData = cand.data || cand;
        var name = cData.name || "Candidate";
        var role = cData.role_applied || "N/A";

        var prompt = `Write a professional, warm rejection email for ${name} who applied for the ${role} position. Include: personal greeting using their name, genuine thanks for their time and interest, respectful notice that we're moving forward with other candidates whose experience more closely matches current needs, acknowledge their strengths and that they made a strong impression, encourage them to apply for future roles, wish them well in their job search, warm closing signed 'The HireFlow Hiring Team'. Keep it human, respectful and encouraging. Never mention any score. 3-4 short paragraphs.`;

        $("btnGenerateRejection").style.display = "none";
        $("rejectionDraftSpinner").style.display = "flex";
        $("rejectionDraftResultContainer").style.display = "none";

        try {
          var resultText = await runAgentPrompt("interviewer", prompt, function(msg) {
            console.log("[Rejection Gen]", msg);
          });

          $("rejectionDraftText").textContent = resultText;
          $("btnCopyRejection").onclick = () => {
            navigator.clipboard.writeText(resultText).then(() => {
              showToast("Rejection email copied!");
            }).catch(err => {
              showToast("Failed to copy text: " + err, true);
            });
          };

          $("rejectionDraftSpinner").style.display = "none";
          $("rejectionDraftResultContainer").style.display = "flex";
          showToast("Rejection email drafted!");
        } catch (err) {
          showToast("Failed to draft rejection email: " + (err.message || err), true);
          $("rejectionDraftSpinner").style.display = "none";
          $("btnGenerateRejection").style.display = "block";
        }
      }

      var rawMarkdownContent = "";

      function extractTextResult(result) {
        if (!result) return "";
        console.log("[Kit Gen] Extracting text from result:", result);
        if (typeof result === "string") return result;
        if (result.text) return result.text;
        if (result.content) return result.content;
        if (result.output) return result.output;
        if (Array.isArray(result) && result[0]) {
          if (result[0].text) return result[0].text;
          if (result[0].content) return result[0].content;
        }
        return JSON.stringify(result);
      }

      // Reusable agent runner helper
      async function runAgentPrompt(agentName, prompt, progressCallback, partialCallback) {
        progressCallback("Initiating agent run...");
        var conv = await client.agents.run(agentName, prompt);
        console.log(`[Agent Run] Initiated. Conversation ID: ${conv.id}`);
        
        var resultText = "";
        var success = false;
        var startTime = Date.now();
        
        // Loop up to 45 seconds (90 iterations at 500ms intervals)
        for (var i = 0; i < 90; i++) {
          var elapsed = Math.floor((Date.now() - startTime) / 1000);
          
          if (elapsed >= 45) {
            break; // Timeout!
          }

          // Fix 3: Loading message that changes every 5 seconds
          const loadingMsgList = [
            "Analyzing pipeline...",
            "Reading candidate data...",
            "Generating insights...",
            "Almost ready..."
          ];
          const msgIndex = Math.min(Math.floor(elapsed / 5), loadingMsgList.length - 1);
          let progressMsg = loadingMsgList[msgIndex];

          // Fix 2: Still analyzing/generating indicator after 20 seconds
          if (elapsed >= 20) {
            progressMsg += " (Still generating...)";
          }
          progressCallback(progressMsg + ` (${elapsed}s)`);
          
          try {
            var messagesResp = await client.conversations.messages.list(conv.id);
            var messages = [];
            if (messagesResp && Array.isArray(messagesResp.items)) {
              messages = messagesResp.items;
            } else if (messagesResp && Array.isArray(messagesResp)) {
              messages = messagesResp;
            }
            
            // Filter meaningful text messages
            var textMessages = messages.filter(function(m) {
              var role = m.role;
              var type = m.type;
              var matchesRoleOrType = (role === "assistant" || type === "text");
              if (!matchesRoleOrType) return false;
              
              var content = m.content || m.text || extractTextResult(m);
              if (!content) return false;
              
              var lowerContent = content.toLowerCase();
              var containsIgnorePhrases = 
                content.startsWith("I'll") || 
                content.startsWith("I will") || 
                content.startsWith("Let me") || 
                lowerContent.includes("let me") || 
                lowerContent.includes("i'll") || 
                lowerContent.includes("i will") || 
                lowerContent.includes("loading tools") || 
                lowerContent.includes("querying");
                
              return !containsIgnorePhrases;
            });

            // If we have some partial text content, stream it via partialCallback
            if (textMessages.length > 0 && typeof partialCallback === 'function') {
              var lastMsg = textMessages[textMessages.length - 1];
              var currentText = lastMsg.content || lastMsg.text || extractTextResult(lastMsg);
              if (currentText && currentText !== "null" && currentText !== "undefined" && currentText.trim()) {
                partialCallback(currentText);
              }
            }
            
            // Check if conversation is completed or contains final answer metadata
            var currentConv = await client.conversations.get(conv.id);
            var status = (currentConv.status || "").toLowerCase();
            var isDone = status === "completed" || status === "idle" || status === "failed";
            
            var hasFinalMetadata = messages.some(function(m) {
              return m.metadata && m.metadata.is_final_answer === true;
            });
            
            if (isDone || hasFinalMetadata) {
              if (textMessages.length > 0) {
                var lastMsg = textMessages[textMessages.length - 1];
                var finalContent = lastMsg.content || lastMsg.text || extractTextResult(lastMsg);
                if (finalContent && finalContent !== "null" && finalContent !== "undefined") {
                  resultText = finalContent;
                  success = true;
                  break;
                }
              }
            }
          } catch (err) {
            console.warn("[Agent Run] Error in polling loop:", err);
          }
          
          await new Promise(r => setTimeout(r, 500)); // Poll faster (500ms) to ensure low latency!
        }
        
        if (success && resultText.trim()) {
          return resultText;
        } else {
          throw new Error("Generation timed out or incomplete");
        }
      }

      // Interview Kit Generation Flow (calling dedicated 'interviewer' agent)
      async function startInterviewKitGeneration(cand) {
        var cData = cand.data || cand;
        console.log("[Kit Gen] Starting generation for candidate:", cData.name, "ID:", cand.id);
        
        $("kitCandidateHeader").textContent = (cData.name || "Candidate") + " · Applied for " + (cData.role_applied || "N/A");
        $("kitSpinnerMessage").textContent = "Generating interview questions using interviewer AI agent...";
        $("kitSpinnerMessage").style.color = "var(--text-secondary)";
        $("kitRetryBtn").style.display = "none";
        $("kitSpinner").style.display = "flex";
        $("kitContentArea").style.display = "none";
        $("kitModal").classList.add("active");

        closeDetailsModal();

        try {
          var matchingJob = cachedJobs.find(j => {
            var jData = j.data || j;
            return jData.title === cData.role_applied;
          });
          var requiredSkills = matchingJob && (matchingJob.data || matchingJob).required_skills ? (matchingJob.data || matchingJob).required_skills : "Not specified";
          console.log("[Kit Gen] Job required skills:", requiredSkills);

          var prompt = `You are an expert technical interviewer. Given this candidate's AI summary: ${cData.ai_summary || "None available"} and the job requirements: ${requiredSkills}, generate a structured interview kit with:
1. 3 culture fit questions
2. 4 technical questions tailored to the candidate's background
3. 2 situational/behavioural questions
4. A suggested 60-minute interview structure

Format the result as clean markdown:
- Use ## for section headers (do NOT use ===== or ----- style underlines)
- Use numbered lists for questions (1. 2. 3.)
- Use **bold** for question titles
- Use a proper markdown table for the suggested schedule (e.g. columns for "Time", "Activity", and "Focus")
- No horizontal rules made of dashes (e.g. do NOT include lines of --- or ===)
- No "QUESTIONS ----" style text separators. Keep the layout clean and professional.`;

          console.log("[Kit Gen] Calling interviewer agent with prompt...");
          var kitText = await runAgentPrompt("interviewer", prompt, 
            function(msg) {
              $("kitSpinnerMessage").textContent = msg;
            },
            function(partialText) {
              try {
                $("kitText").innerHTML = marked.parse(partialText);
              } catch (e) {
                $("kitText").textContent = partialText;
              }
              $("kitSpinner").style.display = "flex";
              $("kitContentArea").style.display = "flex";
            }
          );
          
          console.log("[Kit Gen] Successfully generated kit. Displaying result.");
          rawMarkdownContent = kitText;
          try {
            $("kitText").innerHTML = marked.parse(kitText);
          } catch (err) {
            console.error("[Kit Gen] Markdown parsing failed:", err);
            $("kitText").textContent = kitText;
          }
          $("kitSpinner").style.display = "none";
          $("kitContentArea").style.display = "flex";
          showToast("Interview Kit generated!");
        } catch (err) {
          console.warn("[Kit Gen] Generation failed or timed out. Showing fallback kit:", err);
          
          const skillsList = requiredSkills && requiredSkills !== "Not specified" ? requiredSkills : "general engineering skills";
          const fallbackKit = `
## Standard Interview Questions for ${esc(cData.name || 'Candidate')}
Could not generate AI kit in time. Here are standard questions for this role based on the required skills (${esc(skillsList)}):

1. **Architecture & Design**: Can you explain a complex system or project you designed? What were the key trade-offs you made, particularly concerning scale, security, or performance?
2. **Core Skills & Tools**: Walk us through how you approach utilizing **${esc(skillsList)}** in your day-to-day work. What is a common pitfall when using these tools, and how do you avoid it?
3. **Problem Solving**: Describe a challenging technical bug or problem you faced recently. What steps did you take to diagnose it, and what did you learn from the resolution?
4. **Collaboration & Culture**: Tell us about a time you had a technical disagreement with a team member. How did you handle the situation, and what was the outcome?
5. **Continuous Learning**: How do you keep your skills up to date, especially with rapidly changing technologies? Can you share something new you've learned recently?

## Suggested 60-Minute Interview Structure

| Time | Activity | Focus |
|---|---|---|
| 00:00 - 00:05 | Intro & Welcome | Candidate rapport, outline process |
| 00:05 - 00:25 | Technical Deep Dive | Architecture design, technical questions |
| 00:25 - 00:45 | Practical Problem Solving | Hands-on scenarios, core skills |
| 00:45 - 00:55 | Situational & Cultural | Past experiences, teamwork |
| 00:55 - 01:00 | Q&A | Candidate questions for the team |
          `;
          
          rawMarkdownContent = fallbackKit;
          try {
            $("kitText").innerHTML = `
              <div style="font-size: 0.85rem; color: var(--accent-yellow); margin-bottom: 1.5rem; font-weight: 500; display: flex; align-items: center; gap: 0.4rem;">
                <span>⚠️</span> Could not generate AI kit in time. Displaying standard fallback kit:
              </div>
              ${marked.parse(fallbackKit)}
            `;
          } catch (e) {
            $("kitText").textContent = fallbackKit;
          }
          $("kitSpinner").style.display = "none";
          $("kitContentArea").style.display = "flex";
          showToast("Standard questions loaded as fallback");
        }
      }

      function copyKitToClipboard() {
        var text = rawMarkdownContent || $("kitText").textContent;
        navigator.clipboard.writeText(text).then(function() {
          showToast("Copied raw markdown to clipboard!");
        }).catch(function(err) {
          showToast("Failed to copy text: " + err, true);
        });
      }

      function downloadKitAsPDF() {
        const cand = cachedCandidates.find(c => c.id === activeModalCandidateId);
        const cData = cand ? (cand.data || cand) : {};
        const candidateName = cData.name || "Candidate";
        const roleApplied = cData.role_applied || "Position";
        const formattedDate = new Date().toLocaleDateString('en-US', {
          year: 'numeric',
          month: 'long',
          day: 'numeric'
        });

        const headerHtml = `
          <div class="kit-doc-header">
            <div class="kit-brand">⚡ HireFlow &middot; Interview Kit</div>
            <h1>${esc(candidateName)} &middot; Applied for ${esc(roleApplied)}</h1>
            <div class="kit-meta">Generated on ${formattedDate} &middot; Confidential — Internal Use Only</div>
          </div>
        `;

        const footerHtml = `
          <div class="kit-footer">
            <span>Generated by HireFlow AI &middot; hireflow.apps.lemma.work</span>
            <span>Confidential</span>
          </div>
        `;

        $("interview-kit-print-area").innerHTML = headerHtml + $("kitText").innerHTML + footerHtml;
        
        window.print();
        
        // Clear after print dialog closes
        $("interview-kit-print-area").innerHTML = "";
      }

      function closeKitModal(event) {
        if (event && event.target !== $("kitModal")) return;
        $("kitModal").classList.remove("active");
      }
