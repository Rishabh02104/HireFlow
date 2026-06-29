# HireFlow Screen Recording Demo Script

This voiceover script is structured for a **3 to 4-minute screen recording** showing HireFlow in action. It is designed to walk judges through the core features, AI capabilities, and premium design features of the application.

---

## 🎬 Section 1: Introduction (0:00 - 0:30)
**Visual**: Show the sleek, dark-themed landing page of HireFlow (`https://hireflow.apps.lemma.work`) with the two authentication options.

*   **Voiceover**:
    > "Welcome to HireFlow, an advanced AI-powered hiring pipeline designed to automate candidate screening and streamline recruitment workflows. 
    > 
    > Built for the Gappy AI Hackathon, HireFlow integrates seamlessly with the Lemma SDK. On our landing screen, you'll see a dual-access authentication system: a primary secure sign-in for the pipeline owner, and a dedicated, isolated sandbox for judges to explore using pre-seeded demo data."

---

## 🚀 Section 2: Entering Judge/Guest Mode (0:30 - 1:00)
**Visual**: Hover over **Explore as Judge / Guest** and click it. The dashboard immediately transitions to the Kanban board showing Vikram Nair, Arjun Mehta, and other pre-loaded candidates. Hover over the yellow Guest Mode warning banner at the top of the dashboard.

*   **Voiceover**:
    > "Let's click 'Explore as Judge / Guest' to enter the isolated sandbox. The app transitions instantly. Notice the top banner alerting us that we're in Guest Mode—allowing us to add, edit, or delete candidates safely without touching the owner's real database.
    > 
    > Our dashboard features a premium dark theme. On the left is our navigation sidebar, and in the main view, we have our visual statistics counters and a fully responsive Kanban board showing candidates at different stages of the funnel."

---

## 📋 Section 3: The Kanban Board & AI Match Scores (1:00 - 1:45)
**Visual**: Hover over the candidate card score pills (e.g. Vikram Nair's 92%). Drag Sneha Patel from 'Interview' to 'Offer'. Click on Vikram Nair's card to open his candidate details modal.

*   **Voiceover**:
    > "Each candidate card highlights their name, applied role, and a color-coded AI Match Score calculated by our dedicated AI Scorer agent. The Kanban board supports responsive drag-and-drop actions. For instance, we can drag Sneha Patel to the 'Offer' stage.
    > 
    > Let's open Vikram Nair's profile. Inside the candidate modal, we see a match-progress ring showing **92%**, alongside a comprehensive AI summary generated directly from his resume contents. Notice the status recommendation banner at the bottom advising us to move him forward, which we can do with a single click."

---

## 📝 Section 4: Editable Notes & Candidate Editing (1:45 - 2:30)
**Visual**: Scroll to the Notes area in the modal, type *"Met Vikram. Excellent communication skills. Ready for onboarding."*, and pause. Watch the notes save indicator change to a green **✓ Saved**. Then, click **Edit Candidate**, show the form fields, change the role, upload a dummy PDF, and click **Save Changes**.

*   **Voiceover**:
    > "HireFlow supports inline, auto-saving notes. As I type a note and pause, the system automatically triggers a debounced auto-save directly to our local memory cache.
    > 
    > We can also edit candidates dynamically. Clicking 'Edit Candidate' lets us change names, emails, or applied roles. The app features a client-side PDF text extraction pipeline. When you upload a resume, the browser extracts the raw text directly from the file to feed into the AI Scorer, triggering a background re-scoring instantly."

---

## 💼 Section 5: Jobs Board & slide-up modal (2:30 - 3:00)
**Visual**: Swap tabs to the **Jobs** page. Show the grid layout of jobs and the candidate count badges. Click the **+ Post Opening** floating button. Show the slide-up job creation modal.

*   **Voiceover**:
    > "Next, let's look at the **Jobs** tab. Jobs are rendered in a sleek, responsive grid layout showing candidate counts for each position.
    > 
    > By clicking the floating action button at the bottom-right, we trigger a premium slide-up modal. Here we can post a new opening by typing the title, required skills, and description. In Guest Mode, posting a job updates our isolated sandbox instantly."

---

## 🤖 Section 6: AI Insights & Interview Kits (3:00 - 3:45)
**Visual**: Click the **AI Insights** floating button at the bottom-right. The side drawer opens, loading the parsed sections. Swap back to Vikram Nair's modal, click **Structured Interview Kit**, and watch the kit load with questions and schedules.

*   **Voiceover**:
    > "Now, let's explore our dedicated AI Agents. Clicking the floating 'AI Insights' button calls our specialized Insights agent. It reviews our active jobs and candidate pipeline, parsing analytics into clear bold headings: our Strongest Candidates, Sourcing Priorities, and weekly recommendations.
    > 
    > For candidates ready for structured evaluations, we can generate a customized **Interview Kit**. On click, our Interviewer agent processes the candidate's resume and target job requirements, outputting tailored technical and behavioral questions, culture fit queries, and a suggested 60-minute interview schedule—ready to be printed or downloaded."

---

## 🎬 Section 7: Workflows & Conclusion (3:45 - 4:00)
**Visual**: Scroll to the top and highlight the Daily digest collapsible banner, then click **Sign Out** or **Sign in for full access** to return to the landing screen.

*   **Voiceover**:
    > "We also have automated cron workflows: a daily digester agent runs every morning to compile pipeline summaries and flag candidates stuck in stages.
    > 
    > Clicking 'Sign Out' returns us to our landing page. HireFlow combines premium, modern design aesthetics with robust data isolation and powerful multi-agent automations. Thank you!"
