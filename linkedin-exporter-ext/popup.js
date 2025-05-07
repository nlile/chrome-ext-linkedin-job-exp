/* Injects the scraper into the current tab */
document.addEventListener('DOMContentLoaded', async () => {
  const statusElement = document.getElementById("status");
  const exportButton = document.getElementById("export");
  
  // Check current state when popup opens
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) return;
    
    if (tab?.url?.includes("linkedin.com/hiring/jobs/") && tab.url.includes("/applicants")) {
      // Check current state
      const checkResult = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => ({
          isRunning: !!window.__LI_EXPORT_RUNNING,
          hasData: Array.isArray(window.__LI_EXPORT_DATA) && window.__LI_EXPORT_DATA.length > 0,
          dataCount: Array.isArray(window.__LI_EXPORT_DATA) ? window.__LI_EXPORT_DATA.length : 0
        })
      });
      
      const { isRunning, hasData, dataCount } = checkResult[0].result;
      
      if (isRunning) {
        statusElement.textContent = "Scraping in progress. Click to stop and export.";
        exportButton.textContent = "Stop and Export CSV";
      } else if (hasData) {
        statusElement.textContent = `${dataCount} applicants ready to export.`;
        exportButton.textContent = "Export Collected Data";
      } else {
        statusElement.textContent = "Ready to start scraping.";
        exportButton.textContent = "Start Export → CSV";
      }
    } else {
      statusElement.textContent = "Not on LinkedIn applicants page.";
      exportButton.disabled = true;
    }
  } catch (error) {
    console.error("Error checking state:", error);
    statusElement.textContent = "Error checking state.";
  }
});

document.getElementById("export").addEventListener("click", async () => {
  const statusElement = document.getElementById("status");
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return;
  
  // Check if the URL is a LinkedIn job applicants page before injecting
  if (tab?.url?.includes("linkedin.com/hiring/jobs/") && tab.url.includes("/applicants")) {
      statusElement.textContent = "Processing...";
      
      try {
          // First check if the scraper is already running
          const checkResult = await chrome.scripting.executeScript({
              target: { tabId: tab.id },
              func: () => ({
                  isRunning: !!window.__LI_EXPORT_RUNNING,
                  hasData: Array.isArray(window.__LI_EXPORT_DATA) && window.__LI_EXPORT_DATA.length > 0,
                  dataCount: Array.isArray(window.__LI_EXPORT_DATA) ? window.__LI_EXPORT_DATA.length : 0
              })
          });
          
          const { isRunning, hasData, dataCount } = checkResult[0].result;
          
          if (isRunning) {
              // If running, execute script to terminate and export
              statusElement.textContent = "Stopping and exporting...";
              await chrome.scripting.executeScript({
                  target: { tabId: tab.id },
                  func: () => {
                      // Set termination flag to true
                      window.__LI_EXPORT_TERMINATE = true;
                      console.log("LinkedIn Exporter: Termination requested via popup.");
                  }
              });
              window.close(); // Close popup after setting termination flag
          } else if (hasData) {
              // If not running but has data, trigger export
              statusElement.textContent = `Exporting ${dataCount} applicants...`;
              await chrome.scripting.executeScript({
                  target: { tabId: tab.id },
                  func: () => {
                      console.log(`LinkedIn Exporter: Exporting ${window.__LI_EXPORT_DATA.length} previously collected records.`);
                      // Re-use the existing data for export
                      const data = window.__LI_EXPORT_DATA;
                      
                      // Header based on HTML_ELEMENTS_TO_SAVE.md
                      const header = [
                          "applicant_id", "profile_url", "name", "connection_degree", "headline", 
                          "location", "applied_time", "preferred_qualifications_met", 
                          "preferred_qualifications_total", "work_snippet", "view_status", 
                          "rating", "experience_items", "education_items", "resume_download_url", 
                          "resume_iframe_src", "screening_questions"
                      ];
                      
                      // Generate CSV rows
                      const csvRows = data.map(row =>
                          header.map(fieldName => {
                              const value = row[fieldName] ?? "";
                              const stringValue = typeof value === 'string' ? value : JSON.stringify(value);
                              return `"${stringValue.replace(/"/g, '""')}"`;
                          }).join(",")
                      );
                      
                      const csvString = [header.join(","), ...csvRows].join("\n");
                      
                      // Trigger download
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
                          URL.revokeObjectURL(url);
                          console.log("LinkedIn Exporter: CSV download triggered for previously collected data.");
                          alert(`Export complete: ${data.length} applicants exported.`);
                      } catch (error) {
                          console.error("LinkedIn Exporter: Error during CSV download:", error);
                          alert("Failed to trigger CSV download.");
                      }
                  }
              });
              window.close();
          } else {
              // If not running and no data, inject the content script
              statusElement.textContent = "Starting scraper...";
              await chrome.scripting.executeScript({
                  target: { tabId: tab.id },
                  files: ["content.js"]
              });
              window.close(); // Close popup after successful injection
          }
      } catch (error) {
          console.error("Failed to inject content script:", error);
          statusElement.textContent = "Error: Could not inject script.";
          setTimeout(() => window.close(), 2000); // Close after showing error
      }
  } else {
      // Optional: Provide feedback if not on the correct page
      statusElement.textContent = "Not on LinkedIn applicants page.";
      alert("Please navigate to a LinkedIn job applicants page (e.g., linkedin.com/hiring/jobs/.../applicants) before exporting.");
      console.warn("Export button clicked on non-applicant page:", tab.url);
  }
});