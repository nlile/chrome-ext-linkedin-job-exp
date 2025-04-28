/* LinkedIn Applicants Exporter — content script */
(async () => {
  // prevent double runs if user clicks multiple times quickly
  if (window.__LI_EXPORT_RUNNING) {
    console.warn("Exporter is already running.");
    return;
  }
  window.__LI_EXPORT_RUNNING = true;
  console.log("linkedin applicants exporter: starting...");

  // --- helpers ---
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const qs = (sel, root = document) => root.querySelector(sel);
  const qsa = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  // --- Enhanced Waits ---

  // waits for the main applicant detail root, H1, and profile link to be present
  const waitForDetailBase = (timeout = 7000) =>
    new Promise((resolve, reject) => {
      const rootSelector = "#hiring-detail-root";
      // Selectors for essential elements to wait for
      const essentialSelectors = [
        `${rootSelector} h1`, // Use template literal here as rootSelector is variable
        `${rootSelector} .hiring-profile-highlights__see-full-profile a` // Use template literal here too
      ];
      const checkInterval = 150;
      let elapsedTime = 0;

      // Use regular string for log message
      console.log('waitForDetailBase: waiting for essential elements...');
      const intervalId = setInterval(() => {
        const allPresent = essentialSelectors.every(sel => qs(sel)); // Check if ALL are present
        if (allPresent) {
          clearInterval(intervalId);
          // Use regular string for log message
          console.log('waitForDetailBase: found all essential elements.');
          // Short delay for final rendering touches after elements appear
          setTimeout(resolve, 350);
        } else {
          elapsedTime += checkInterval;
          if (elapsedTime >= timeout) {
            clearInterval(intervalId);
            const missing = essentialSelectors.filter(sel => !qs(sel));
            // Use template literal here for interpolation
            console.error(`waitForDetailBase: timeout waiting for essential elements. Missing: ${missing.join(', ')}`);
            reject(new Error('Timeout waiting for essential applicant details (H1 or Profile Link).')); // Regular string for error
          }
        }
      }, checkInterval);
    });

  // waits for mutations (e.g., children added) in a specific element after an action
  const waitForMutation = (elementToObserve, options = { childList: true, subtree: true }, timeout = 5000) =>
    new Promise((resolve, reject) => {
      if (!elementToObserve) {
         console.warn("waitForMutation: elementToObserve is null/undefined");
         resolve(); // Resolve immediately if element doesn't exist
         return;
      }
      const observer = new MutationObserver((mutationsList, obs) => {
        // We got a mutation, disconnect and resolve
        console.log(`mutation observed in ${elementToObserve.tagName}`);
        obs.disconnect();
        // Short delay after mutation detected allows rendering
        setTimeout(resolve, 200);
      });

      const timeoutId = setTimeout(() => {
        observer.disconnect();
        console.log(`timeout waiting for mutation in ${elementToObserve.tagName}. Continuing...`);
        resolve(); // Resolve even on timeout, maybe nothing changed
      }, timeout);

      observer.observe(elementToObserve, options);
      console.log(`observing ${elementToObserve.tagName} for mutations...`);
    });

  // helper to click "show more" buttons and wait for potential content changes
  const clickShowMoreAndWait = async (root, buttonSelector, description) => {
    try {
      const button = qs(buttonSelector, root);
      if (button && !button.closest("[aria-hidden='true'], .visually-hidden")) {
        console.log(`clicking "show more ${description}"...`);
        const parentSection = button.closest('section'); // Find parent section
        if (!parentSection) {
            console.warn(`could not find parent section for "show more ${description}" button.`);
            return false; // Cannot proceed without parent section
        }
        button.scrollIntoView({ block: 'center' });
        await sleep(250); // Short delay before click
        button.click();
        // Find the list element within the parent section AFTER clicking
        const listElement = qs('ul', parentSection);
        if (!listElement) {
             console.warn(`could not find list (ul) within parent section for "show more ${description}".`);
             // Still resolve sleep, maybe content appeared without ul mutation
             await sleep(500);
        } else {
            // Wait for mutations in the list element after clicking
            await waitForMutation(listElement);
        }
        return true;
      }
    } catch (error) {
      console.warn(`could not click "show more ${description}" or wait for mutation:`, error);
    }
    return false;
  };

  // extracts data from the currently displayed applicant detail section
  const extract = async () => {
    console.log("--- starting extract function ---");
    const root = qs("#hiring-detail-root");
    if (!root) {
      console.error("extract: could not find #hiring-detail-root. returning null.");
      return null;
    }
    console.log("extract: found #hiring-detail-root element.");

    // Click show more buttons and wait
    await clickShowMoreAndWait(root, "button[aria-label*='more experiences']", "experience");
    await clickShowMoreAndWait(root, "button[aria-label*='more educations']", "education");

    // helper to safely get text content
    const textSafe = (sel, context = root, def = "") => {
        try {
            const element = qs(sel, context);
            const text = element?.innerText?.trim() ?? def;
            return text;
        } catch (e) {
            console.warn(`textSafe: error for selector="${sel}". returning default.`);
            return def;
        }
    };

    // --- Basic Info ---
    const h1Element = qs("h1", root);
    const nameHeader = h1Element?.innerText?.trim() ?? "";
    console.log(`extract: h1 found=${!!h1Element}, nameHeader="${nameHeader}"`);
    const name = nameHeader.split(/['']s application/)[0]?.trim() || nameHeader;
    console.log(`extract: calculated name="${name}"`);

    // Using script's robust selectors based on structure
    const headline = textSafe("h1 + div > div.t-16");
    const location = textSafe("h1 + div > div:nth-child(2)");
    const applied = textSafe(".hiring-applicant-header__tidbit");
    const degree = textSafe(".hiring-applicant-header__badge");

    // Using script's robust selectors
    const profileLinkElement = qs(".hiring-profile-highlights__see-full-profile a", root);
    const profile_url = profileLinkElement?.href ?? "";
    console.log(`extract: profile link found=${!!profileLinkElement}, profile_url="${profile_url}"`);

    const resumeLinkElement = qs('a[href*="ambry"][aria-label^="Download"]', root);
    const resume_url = resumeLinkElement?.href ?? "";
    console.log(`extract: resume link found=${!!resumeLinkElement}, resume_url="${resume_url}"`);

    // --- Refined Experience/Education Section Identification & Scraping ---
    let experiences = [];
    let educations = [];
    const sections = qsa("section", root);
    console.log(`extract: found ${sections.length} sections to check.`);

    for (const section of sections) {
        const h3 = qs("h3.t-bold", section);
        if (!h3) continue; // Skip section if no h3.t-bold found
        const h3Text = h3.innerText.trim();
        const listItems = qsa("ul > li.display-flex", section); // Get li elements within the section's ul

        if (h3Text === 'Experience') {
            console.log(`extract: found experience section with ${listItems.length} potential items.`);
            experiences = listItems.map(li => {
                return {
                    title: textSafe("p.t-14.t-black", li),
                    company: textSafe("p.t-14.t-black--light", li),
                    duration: textSafe("p.t-12.t-black--light span[aria-hidden='true']", li)
                };
            }).filter(exp => exp.title || exp.company);
        } else if (h3Text === 'Education') {
            console.log(`extract: found education section with ${listItems.length} potential items.`);
            educations = listItems.map(li => {
                return {
                    school: textSafe("p.t-14", li),
                    degree_field: textSafe("p.t-12.t-black--light", li),
                    duration: textSafe("p.t-12.t-black--light:nth-of-type(2) span[aria-hidden='true']", li)
                };
            }).filter(edu => edu.school);
        }
    }
    console.log(`extract: processed sections, found ${experiences.length} experiences, ${educations.length} educations.`);


    // Screening Questions Scraping
     const screening = qsa(".job-posting-shared-screening-question-list__list-item", root)
      .map(li => {
         const qElem = qs("p.t-14", li);
         const idealElem = qs("p.t-12 span:nth-of-type(2)", li);
         const ansElem = qs("p.t-14.t-bold", li);
         return {
            q: qElem?.innerText.trim() ?? "",
            ideal: idealElem?.innerText.trim() ?? "",
            ans: ansElem?.innerText.trim() ?? ""
         }
      })
      .filter(s => s.q);
     console.log(`extract: found ${screening.length} screening questions.`);

    const applicantData = {
        name,
        headline,
        location,
        applied,
        degree,
        profile_url,
        resume_url,
        experience_json: experiences.length > 0 ? JSON.stringify(experiences) : "",
        education_json: educations.length > 0 ? JSON.stringify(educations) : "",
        screening_json: screening.length > 0 ? JSON.stringify(screening) : "",
    };

    console.log("extract: returning applicantData:", JSON.stringify(applicantData)); // Stringify for cleaner log
    console.log("--- finished extract function ---");
    return applicantData;
  };

  // ---------- main loop ----------
  const data = [];
  let currentPage = 1;
  // selector for the clickable applicant links in the list
  const applicantLinkSelector = "li.hiring-applicants__list-item a";
  // selector for the list container itself
  const listContainerSelector = ".hiring-applicants__list-container";

  while (true) {
    console.log(`starting page ${currentPage}...`);
    const currentListContainer = qs(listContainerSelector);
    if (!currentListContainer) {
      console.error(`applicant list container "${listContainerSelector}" not found on page ${currentPage}. stopping.`);
      break;
    }

    const applicantLinks = qsa(applicantLinkSelector, currentListContainer);
    if (applicantLinks.length === 0) {
       // if it's the first page and no applicants, alert user
       if (currentPage === 1) {
            console.warn("no applicant rows found on the first page.");
            alert("no applicants found. please ensure you are on the correct linkedin job applicants page and applicants are loaded.");
       } else {
           console.log("no more applicant rows found on page", currentPage);
       }
       break; // stop if no applicants found
    }

    console.log(`found ${applicantLinks.length} applicants on page ${currentPage}.`);

    for (let i = 0; i < applicantLinks.length; i++) {
      const link = applicantLinks[i];
      console.log(`processing applicant ${i + 1}/${applicantLinks.length} on page ${currentPage}...`);
      try {
        // scroll applicant link into view if not fully visible
        const linkRect = link.getBoundingClientRect();
        if (linkRect.top < 0 || linkRect.bottom > window.innerHeight) {
            link.scrollIntoView({ behavior: "smooth", block: "center" });
            await sleep(300); // wait for scroll to settle
        } else {
             await sleep(50); // tiny pause even if already in view
        }

        link.click();
        // Use the enhanced wait for base details
        await waitForDetailBase();

        const applicantData = await extract();
        if (applicantData?.name) { // ensure data & name extracted
          data.push(applicantData);
          console.log(` --> SUCCESSFULLY extracted: ${applicantData.name}`);
        } else {
          console.warn(` --> FAILED to extract valid data (missing name?) for applicant ${i + 1} on page ${currentPage}. Skipping.`);
          // Log the raw object even on failure for debugging
          console.log(" --> Failed extraction object:", applicantData);
        }
        await sleep(1000); // Changed from 750ms
      } catch (error) {
        console.error(`error processing applicant ${i + 1} on page ${currentPage}:`, error);
        // attempt to continue to the next applicant
        await sleep(500); // short pause after error
      }
    } // end loop through applicants on page

    // --- pagination ---
    const nextPageNumber = currentPage + 1;
    const nextButton = qs(`ul.artdeco-pagination__pages button[aria-label='Page ${nextPageNumber}']`);

    // check if next button exists and is not for the current page (which might happen if selectors are off)
    const isActive = nextButton?.closest("li")?.classList.contains("active");

    if (!nextButton || isActive) {
      console.log("no next page button found or detected end of pagination.");
      break; // exit loop if no next page button or it points to current page
    }

    console.log(`navigating to page ${nextPageNumber}...`);
    nextButton.click();
    currentPage = nextPageNumber; // update page number
    await sleep(2500); // longer sleep after page navigation allows content to load
  } // end while loop (pagination)

  // ---------- download ----------
  if (data.length === 0) {
    console.warn("no data extracted. cannot generate csv.");
    alert("export failed: no applicant data could be extracted.");
    window.__LI_EXPORT_RUNNING = false;
    return;
  }

  console.log(`extraction complete. found ${data.length} total applicants. generating csv...`);

  // Updated header order for csv
  const header = [
    "name",
    "headline",
    "location",
    "applied",
    "degree",
    "profile_url",
    "resume_url",
    "experience_json",
    "education_json",
    "screening_json",
  ];

  // generate csv rows, ensuring values are strings and properly quoted/escaped
  const csvRows = data.map(row =>
    header.map(fieldName => {
      const value = row[fieldName] ?? ""; // default to empty string if null/undefined
      const stringValue = typeof value === 'string' ? value : JSON.stringify(value); // ensure string
      // escape double quotes by doubling them, wrap in double quotes
      return `"${stringValue.replace(/"/g, '""')}"`;
    }).join(",")
  );

  const csvString = [header.join(","), ...csvRows].join("\n");

  // trigger download
  try {
      const blob = new Blob([csvString], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.setAttribute("href", url);
      link.setAttribute("download", `linkedin_applicants_${Date.now()}.csv`);
      link.style.visibility = "hidden";
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url); // clean up blob url
      console.log("csv download triggered.");
      alert(`export complete: ${data.length} applicants exported.`);
  } catch (error) {
      console.error("error during csv download:", error);
      alert("failed to trigger csv download.");
  }

  window.__LI_EXPORT_RUNNING = false; // reset flag
  console.log("linkedin applicants exporter: finished.");
})();