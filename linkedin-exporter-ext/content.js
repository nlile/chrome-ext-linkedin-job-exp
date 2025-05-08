/* LinkedIn Applicants Exporter — content script */
(async () => {
  // prevent double runs if user clicks multiple times quickly
  if (window.__LI_EXPORT_RUNNING) {
    console.warn("Exporter is already running.");
    alert("Exporter is already running. Click again to stop and export current data.");
    
    // Set termination flag
    window.__LI_EXPORT_TERMINATE = true;
    console.log("Termination flag set to true");
    
    // Log current data status
    const dataLength = Array.isArray(window.__LI_EXPORT_DATA) ? window.__LI_EXPORT_DATA.length : 0;
    console.log(`Current data length before forced export: ${dataLength}`);
    
    // Force immediate export if termination is requested
    // Use a longer timeout to ensure the main loop has time to break
    setTimeout(() => {
      console.log("Timeout callback for forced export executing...");
      const currentDataLength = Array.isArray(window.__LI_EXPORT_DATA) ? window.__LI_EXPORT_DATA.length : 0;
      console.log(`Data length in timeout callback: ${currentDataLength}`);
      
      if (window.__LI_EXPORT_DATA && window.__LI_EXPORT_DATA.length > 0) {
        console.log("Forcing export after termination request...");
        // This will trigger the export in the next event loop cycle
        window.__LI_EXPORT_FORCE_EXPORT = true;
        
        // Directly trigger the export function to ensure it happens
        triggerExport(window.__LI_EXPORT_DATA);
      } else {
        console.warn("No data to export after termination.");
      }
    }, 1000);
    
    return;
  }
  window.__LI_EXPORT_FORCE_EXPORT = false;
  
  // Helper function to trigger export
  const triggerExport = (data) => {
    if (!Array.isArray(data) || data.length === 0) {
      console.warn("triggerExport: No data to export.");
      return;
    }
    
    console.log(`triggerExport: Exporting ${data.length} records...`);
    
    // Updated header order for csv based on HTML_ELEMENTS_TO_SAVE.md
    const header = [
      // Basic identifiers
      "applicant_id",
      "profile_url",
      "name",
      
      // Basic profile info
      "connection_degree",
      "headline",
      "location",
      "applied_time",
      
      // Qualifications
      "preferred_qualifications_met",
      "preferred_qualifications_total",
      
      // List view data
      "work_snippet",
      "view_status",
      
      // Detail view data
      "rating",
      "experience_items",
      "education_items",
      "resume_download_url",
      "resume_iframe_src",
      "screening_questions",
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
      console.log("CSV download triggered successfully.");
      alert(`Export complete: ${data.length} applicants exported.`);
      return true;
    } catch (error) {
      console.error("Error during CSV download:", error);
      alert("Failed to trigger CSV download.");
      return false;
    }
  };
  // Set initial state
  window.__LI_EXPORT_RUNNING = true;
  window.__LI_EXPORT_TERMINATE = false;
  
  // Initialize data array and store reference
  const data = [];
  window.__LI_EXPORT_DATA = data;
  
  console.log("LinkedIn applicants exporter: starting...");

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
  const clickShowMoreAndWait = async (root, buttonSelector, description, retryCount = 3) => {
    try {
      const button = qs(buttonSelector, root);
      if (button && !button.closest("[aria-hidden='true'], .visually-hidden")) {
        console.log(`clicking "show more ${description}"...`);
        const parentSection = button.closest('section') || root; // Find parent section or use root as fallback
        
        // Ensure button is visible in viewport
        button.scrollIntoView({ block: 'center', behavior: 'smooth' });
        await sleep(500); // Longer delay before click to ensure UI is ready
        
        // Get content length before click to verify changes after
        const contentBefore = parentSection.innerHTML.length;
        
        // Click the button
        button.click();
        console.log(`clicked "show more ${description}" button`);
        
        // Find the list element within the parent section AFTER clicking
        const listElement = qs('ul', parentSection);
        
        // Wait for either mutations or content length change
        if (listElement) {
            // Wait for mutations in the list element after clicking
            await waitForMutation(listElement, { childList: true, subtree: true, attributes: true }, 3000);
            console.log(`mutation detected in list for "${description}"`);
        } 
        
        // Additional wait to ensure content is loaded
        await sleep(800);
        
        // Verify content changed
        const contentAfter = parentSection.innerHTML.length;
        if (contentBefore === contentAfter && retryCount > 0) {
            console.log(`No content change detected for "${description}", retrying... (${retryCount} attempts left)`);
            return await clickShowMoreAndWait(root, buttonSelector, description, retryCount - 1);
        }
        
        return true;
      }
    } catch (error) {
      console.warn(`could not click "show more ${description}" or wait for mutation:`, error);
      if (retryCount > 0) {
        console.log(`Retrying "show more ${description}"... (${retryCount} attempts left)`);
        await sleep(1000); // Wait a bit longer before retry
        return await clickShowMoreAndWait(root, buttonSelector, description, retryCount - 1);
      }
    }
    return false;
  };
  
  // Helper to wait for an element to appear
  const waitForElement = (selector, root = document, timeout = 5000) => {
    return new Promise((resolve) => {
      if (qs(selector, root)) {
        resolve(qs(selector, root));
        return;
      }
      
      const startTime = Date.now();
      const interval = setInterval(() => {
        const element = qs(selector, root);
        if (element) {
          clearInterval(interval);
          resolve(element);
        } else if (Date.now() - startTime > timeout) {
          clearInterval(interval);
          console.warn(`Timeout waiting for element: ${selector}`);
          resolve(null);
        }
      }, 200);
    });
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

    // Ensure we're at the top of the detail panel for best interaction
    root.scrollIntoView({ block: 'start', behavior: 'smooth' });
    await sleep(500);
    
    // STEP 1: Expand all "Show more" sections as specified in HTML_ELEMENTS_TO_SAVE.md
    console.log("Expanding Experience section...");
    await clickShowMoreAndWait(root, "button[aria-label^='Show'][aria-label$='experiences']", "experience");
    
    console.log("Expanding Education section...");
    await clickShowMoreAndWait(root, "button[aria-label^='Show'][aria-label$='educations']", "education");
    
    console.log("Expanding Resume section...");
    await clickShowMoreAndWait(root, "button[aria-label^='Show more'][aria-label*='resume']", "resume");
    
    // STEP 2: Wait for iframe to load if present
    const resumeIframe = qs(".hiring-resume-viewer__iframe", root);
    if (resumeIframe) {
      console.log("Resume iframe found, waiting for src to be populated...");
      // Wait a bit for the iframe src to be populated
      await sleep(1000);
    }
    
    // STEP 3: Click all inline "show more" text buttons
    console.log("Expanding all inline text buttons...");
    const inlineButtons = qsa("button.inline-show-more-text__button", root);
    console.log(`Found ${inlineButtons.length} inline text expanders`);
    
    for (const button of inlineButtons) {
      try {
        if (button && !button.closest(".inline-show-more-text--is-expanded")) {
          // Scroll to ensure button is visible
          button.scrollIntoView({ block: 'center', behavior: 'smooth' });
          await sleep(300);
          
          console.log("Clicking inline text expander...");
          button.click();
          
          // Wait for the expanded class to appear
          await sleep(500);
          
          // Verify expansion
          const isExpanded = button.closest(".inline-show-more-text--is-expanded");
          if (!isExpanded) {
            console.log("Retrying inline text expansion...");
            button.click();
            await sleep(500);
          }
        }
      } catch (e) {
        console.warn("Failed to expand inline text:", e);
      }
    }
    
    // STEP 4: Check for "More..." dropdown and expand if present
    try {
      const moreButton = await waitForElement("button:has-text('More…')", root, 1000) || 
                          qs("button.artdeco-dropdown__trigger", root);
      
      if (moreButton) {
        console.log("Found More dropdown, expanding...");
        moreButton.scrollIntoView({ block: 'center' });
        await sleep(300);
        moreButton.click();
        await sleep(500); // Wait for dropdown content to appear
      }
    } catch (e) {
      console.warn("Failed to expand More dropdown:", e);
    }

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
    
    // helper to safely get attribute from element
    const attrSafe = (sel, attr, context = root, def = "") => {
        try {
            const element = qs(sel, context);
            const value = element?.[attr] ?? element?.getAttribute(attr) ?? def;
            return value;
        } catch (e) {
            console.warn(`attrSafe: error for selector="${sel}" attr="${attr}". returning default.`);
            return def;
        }
    };
    
    // Extract applicant_id from URL if possible
    const applicant_id = profile_url?.match(/\/applicants\/([0-9]+)\/detail/)?.[1] || "";

    // --- Basic Info ---
    const h1Element = qs("h1", root);
    const nameHeader = h1Element?.innerText?.trim() ?? "";
    console.log(`extract: h1 found=${!!h1Element}, nameHeader="${nameHeader}"`);
    const name = nameHeader.split(/['']s application/)[0]?.trim() || nameHeader;
    console.log(`extract: calculated name="${name}"`);

    // Using robust selectors based on HTML_ELEMENTS_TO_SAVE.md
    const headline = textSafe(".hiring-applicant-header > div .t-16:nth-of-type(1)") || 
                     textSafe("h1 + div > div.t-16");
    const location = textSafe(".hiring-applicant-header > div .t-16:nth-of-type(2)") || 
                     textSafe("h1 + div > div:nth-child(2)");
    const applied_time = textSafe(".hiring-applicant-header__tidbit");
    const connection_degree = textSafe(".hiring-applicant-header__badge") || 
                              textSafe(".hiring-applicant-header h1 + span");

    // Rating extraction
    let rating = "UNRATED";
    const ratingElements = qsa('div.flex-1 > div:nth-of-type(1) > div', root);
    for (const el of ratingElements) {
      if (el.getAttribute('aria-pressed') === 'true') {
        rating = el.innerText.trim().toUpperCase().replace(/\s+/g, '_');
        break;
      }
    }

    // Using script's robust selectors for profile and resume
    const profileLinkElement = qs(".hiring-profile-highlights__see-full-profile a", root);
    const profile_url = profileLinkElement?.href ?? "";
    console.log(`extract: profile link found=${!!profileLinkElement}, profile_url="${profile_url}"`);

    const resumeLinkElement = qs('.hiring-resume-viewer__resume-wrapper--collapsed a[href*="ambry"]', root) || 
                              qs('a[href*="ambry"][aria-label^="Download"]', root);
    const resume_download_url = resumeLinkElement?.href ?? "";
    console.log(`extract: resume link found=${!!resumeLinkElement}, resume_url="${resume_download_url}"`);
    
    // Resume iframe source
    const resume_iframe_src = attrSafe(".hiring-resume-viewer__iframe", "src");

    // --- Refined Experience/Education Section Identification & Scraping ---
    let experience_items = [];
    let education_items = [];
    const sections = qsa("section", root);
    console.log(`extract: found ${sections.length} sections to check.`);

    for (const section of sections) {
        const h3 = qs("h3.t-bold", section);
        if (!h3) continue; // Skip section if no h3.t-bold found
        const h3Text = h3.innerText.trim();
        const listItems = qsa("ul > li.display-flex", section); // Get li elements within the section's ul

        if (h3Text === 'Experience') {
            console.log(`extract: found experience section with ${listItems.length} potential items.`);
            experience_items = listItems.map(li => {
                return {
                    title: textSafe("p.t-14.t-black", li),
                    company: textSafe("p.t-14.t-black--light", li),
                    dates: textSafe("p.t-12.t-black--light span[aria-hidden='true']", li)
                };
            }).filter(exp => exp.title || exp.company);
        } else if (h3Text === 'Education') {
            console.log(`extract: found education section with ${listItems.length} potential items.`);
            education_items = listItems.map(li => {
                return {
                    school: textSafe("p.t-14", li),
                    degree: textSafe("p.t-12.t-black--light", li),
                    dates: textSafe("p.t-12.t-black--light:nth-of-type(2) span[aria-hidden='true']", li)
                };
            }).filter(edu => edu.school);
        }
    }
    console.log(`extract: processed sections, found ${experience_items.length} experiences, ${education_items.length} educations.`);
    
    // Extract work snippet from left column if available
    // First try the specific selector from HTML_ELEMENTS_TO_SAVE.md
    let work_snippet = qsa("ul[aria-label='Work experience'] li span.lt-line-clamp__line", document)
      .map(el => el.innerText.trim())
      .filter(Boolean);
      
    // If nothing found, try alternative selectors that might contain work experience
    if (work_snippet.length === 0) {
      work_snippet = qsa(".artdeco-entity-lockup__metadata li", document)
        .map(el => el.innerText.trim())
        .filter(Boolean);
    }
    
    // Extract preferred qualifications
    let preferred_qualifications_met = null;
    let preferred_qualifications_total = null;
    const prefQualText = textSafe(".hiring-screening-questions h3");
    if (prefQualText) {
      const matches = prefQualText.match(/(\d+)\s*out of\s*(\d+)/);
      if (matches && matches.length >= 3) {
        preferred_qualifications_met = parseInt(matches[1], 10);
        preferred_qualifications_total = parseInt(matches[2], 10);
      }
    }
    
    // View status (viewed/unviewed)
    // This is now captured from the list view before clicking on the applicant
    // See the main loop where we set applicantData.view_status
    let view_status = null;
    
    // Try to extract it from the detail panel if possible
    const viewStatusIndicator = qs(".hiring-applicant-header__viewed-indicator", root) ||
                               qs(".hiring-applicant-header [aria-label*='viewed']", root);
    if (viewStatusIndicator) {
      const viewedText = viewStatusIndicator.innerText.trim().toLowerCase() || 
                        viewStatusIndicator.getAttribute('aria-label')?.toLowerCase();
      if (viewedText && viewedText.includes('unviewed')) {
        view_status = 'unviewed';
      } else if (viewedText) {
        view_status = 'viewed';
      }
    }


    // Screening Questions Scraping - improved based on HTML_ELEMENTS_TO_SAVE.md
    const screening_questions = qsa(".hiring-screening-questions ul li", root)
      .map(li => {
         const qElem = qs("p.t-14:first-of-type", li);
         const idealElem = qs("p.t-12 span:nth-of-type(2)", li);
         const ansElem = qs("p.t-14.t-bold", li);
         const metElem = qs("svg[class$='--succeeded']", li);
         
         return {
            question: qElem?.innerText.trim() ?? "",
            ideal: idealElem?.innerText.trim() ?? "",
            answer: ansElem?.innerText.trim() ?? "",
            met: !!metElem
         };
      })
      .filter(s => s.question);
    console.log(`extract: found ${screening_questions.length} screening questions.`);

    // Build comprehensive applicant data object based on HTML_ELEMENTS_TO_SAVE.md
    const applicantData = {
        // Basic identifiers
        applicant_id,
        profile_url,
        name,
        
        // Basic profile info
        connection_degree,
        headline,
        location,
        applied_time,
        
        // Qualifications
        preferred_qualifications_met,
        preferred_qualifications_total,
        
        // List view data
        work_snippet: work_snippet.length > 0 ? work_snippet.join(" | ") : null,
        view_status,
        
        // Detail view data
        rating,
        experience_items: experience_items.length > 0 ? JSON.stringify(experience_items) : null,
        education_items: education_items.length > 0 ? JSON.stringify(education_items) : null,
        resume_download_url: resume_download_url || null,
        resume_iframe_src: resume_iframe_src || null,
        screening_questions: screening_questions.length > 0 ? JSON.stringify(screening_questions) : null,
    };

    console.log("extract: returning applicantData:", JSON.stringify(applicantData)); // Stringify for cleaner log
    console.log("--- finished extract function ---");
    return applicantData;
  };

  // ---------- main loop ----------
  // data array is already initialized above
  let currentPage = 1;
  // selector for the clickable applicant links in the list
  const applicantLinkSelector = "li.hiring-applicants__list-item a[href*='/applicants/']";
  // selector for the list container itself
  const listContainerSelector = ".hiring-applicants__list-container";

  while (true) {
    // Check for early termination flag at the beginning of each page
    if (window.__LI_EXPORT_TERMINATE) {
      console.log("Early termination requested at page level. Stopping scraping and proceeding to export.");
      break;
    }
    
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
      // Check for early termination flag
      if (window.__LI_EXPORT_TERMINATE) {
        console.log("Early termination requested. Stopping scraping and proceeding to export.");
        break;
      }
      
      const link = applicantLinks[i];
      console.log(`processing applicant ${i + 1}/${applicantLinks.length} on page ${currentPage}...`);
      try {
        // Extract applicant_id from href for list view data
        const applicantIdMatch = link.href.match(/\/applicants\/([0-9]+)\/detail/);
        const applicantId = applicantIdMatch ? applicantIdMatch[1] : "";
        
        // Get view status from list item before clicking
        const listItem = link.closest("li.hiring-applicants__list-item");
        let viewStatus = null;
        if (listItem) {
          const hasDot = !!qs(".hiring-people-card__image-dot", listItem);
          viewStatus = hasDot ? "unviewed" : "viewed";
        }
        
        // scroll applicant link into view if not fully visible
        const linkRect = link.getBoundingClientRect();
        if (linkRect.top < 0 || linkRect.bottom > window.innerHeight) {
            link.scrollIntoView({ behavior: "smooth", block: "center" });
            await sleep(300); // wait for scroll to settle
        } else {
             await sleep(50); // tiny pause even if already in view
        }

        // Check for termination flag right before clicking
        if (window.__LI_EXPORT_TERMINATE) {
          console.log("Early termination requested before clicking applicant. Skipping.");
          break;
        }
        
        link.click();
        // Use the enhanced wait for base details
        await waitForDetailBase();
        
        // Check for termination flag after loading detail view but before extraction
        if (window.__LI_EXPORT_TERMINATE) {
          console.log("Early termination requested after loading detail view. Skipping extraction.");
          break;
        }
        
        // Ensure the detail panel is fully loaded and visible
        await sleep(500); // Additional wait for UI to stabilize
        
        // Scroll to top of detail panel to ensure all elements are properly loaded
        const detailRoot = qs("#hiring-detail-root");
        if (detailRoot) {
          detailRoot.scrollIntoView({ block: 'start', behavior: 'smooth' });
          await sleep(300);
        }

        const applicantData = await extract();
        if (applicantData?.name) { // ensure data & name extracted
          // Add view status from list view if available
          if (viewStatus) {
            applicantData.view_status = viewStatus;
          }
          
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

    // Check for early termination flag before pagination
    if (window.__LI_EXPORT_TERMINATE) {
      console.log("Early termination requested before pagination. Stopping scraping and proceeding to export.");
      break;
    }
    
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
  // Check if we have data to export
  if (data.length === 0) {
    console.warn("No data extracted. Cannot generate CSV.");
    alert("Export failed: No applicant data could be extracted.");
    window.__LI_EXPORT_RUNNING = false;
    window.__LI_EXPORT_TERMINATE = false;
    window.__LI_EXPORT_FORCE_EXPORT = false;
    return;
  }
  
  // Log the final data state
  console.log(`Extraction complete. Found ${data.length} total applicants. Generating CSV...`);
  console.log(`Data array reference check: window.__LI_EXPORT_DATA === data? ${window.__LI_EXPORT_DATA === data}`);
  console.log(`window.__LI_EXPORT_DATA length: ${window.__LI_EXPORT_DATA.length}`);
  
  // Use the triggerExport function to handle the export
  const exportSuccess = triggerExport(data);

  // Reset all flags
  window.__LI_EXPORT_RUNNING = false;
  window.__LI_EXPORT_TERMINATE = false;
  window.__LI_EXPORT_FORCE_EXPORT = false;
  
  // Keep the data available for potential re-export
  // window.__LI_EXPORT_DATA remains set to the data array
  
  console.log("LinkedIn applicants exporter: finished.");
})();