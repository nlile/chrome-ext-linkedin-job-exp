/* popup.js – keep-alive patch */
// Cache DOM elements at the highest scope for reuse
let statusElement;
let exportButton;

document.addEventListener('DOMContentLoaded', async () => {
  /* keep popup alive */
  chrome.runtime.connect({ name: "keepAlive" });
  statusElement = document.getElementById("status");
  exportButton = document.getElementById("export");
  
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
  // Using the cached statusElement from higher scope
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return;
  
  // Check if the URL is a LinkedIn job applicants page before injecting
  if (tab?.url?.includes("linkedin.com/hiring/jobs/") && tab.url.includes("/applicants")) {
      statusElement.textContent = "Processing...";
      
      try {
          // First check if the scraper is already running
          const checkResult = await chrome.scripting.executeScript({
              target: { tabId: tab.id },
              func: () => {
                  // Get current state
                  const state = {
                      isRunning: !!window.__LI_EXPORT_RUNNING,
                      hasData: Array.isArray(window.__LI_EXPORT_DATA) && window.__LI_EXPORT_DATA.length > 0,
                      dataCount: Array.isArray(window.__LI_EXPORT_DATA) ? window.__LI_EXPORT_DATA.length : 0,
                      isTerminating: !!window.__LI_EXPORT_TERMINATE,
                      forceExport: !!window.__LI_EXPORT_FORCE_EXPORT
                  };
                  
                  console.log("Current state:", state);
                  return state;
              }
          });
          
          const { isRunning, hasData, dataCount, isTerminating, forceExport } = checkResult[0].result;
          
          if (isRunning) {
              // If already terminating, just wait
              if (isTerminating) {
                  statusElement.textContent = "Already stopping, please wait...";
                  // Removed automatic window closing
                  return;
              }
              
              // If running, execute script to terminate and export
              statusElement.textContent = "Stopping and exporting...";
              await chrome.scripting.executeScript({
                  target: { tabId: tab.id },
                  func: () => {
                      console.log("Termination requested via popup");
                      
                      // Log current data state
                      const dataLength = Array.isArray(window.__LI_EXPORT_DATA) ? window.__LI_EXPORT_DATA.length : 0;
                      console.log(`Current data length: ${dataLength}`);
                      
                      // Set termination flag to true
                      window.__LI_EXPORT_TERMINATE = true;
                      
                      // Force export immediately if we have data
                      if (window.__LI_EXPORT_DATA && window.__LI_EXPORT_DATA.length > 0) {
                          // Create a copy of the data to ensure it's not modified during export
                          const dataCopy = JSON.parse(JSON.stringify(window.__LI_EXPORT_DATA));
                          console.log(`Created data copy with ${dataCopy.length} records`);
                          
                          // Set force export flag
                          window.__LI_EXPORT_FORCE_EXPORT = true;
                          
                          // Use the triggerExport function if it exists
                          if (typeof triggerExport === 'function') {
                              console.log("Calling triggerExport function directly");
                              setTimeout(() => triggerExport(dataCopy), 500);
                          }
                      }
                      
                      return { success: true, message: "Termination initiated" };
                  }
              });
              
              // Update UI and keep popup open so user can see status
              statusElement.textContent = "Scraper stopping and exporting data...";
              
              // Check status periodically
              const checkExportStatus = async () => {
                  try {
                      const result = await chrome.scripting.executeScript({
                          target: { tabId: tab.id },
                          func: () => ({
                              completed: !!window.__LI_EXPORT_COMPLETED,
                              dataLength: Array.isArray(window.__LI_EXPORT_DATA) ? window.__LI_EXPORT_DATA.length : 0
                          })
                      });
                      
                      const { completed, dataLength } = result[0].result;
                      
                      if (completed) {
                          statusElement.textContent = `Export completed with ${dataLength} records.`;
                      } else {
                          statusElement.textContent = `Still exporting ${dataLength} records...`;
                          setTimeout(checkExportStatus, 1000);
                      }
                  } catch (e) {
                      console.error("Error checking export status:", e);
                      statusElement.textContent = "Export in progress...";
                  }
              };
              
              // Start checking status
              setTimeout(checkExportStatus, 1000);
          } else if (hasData) {
              // If not running but has data, trigger export
              statusElement.textContent = `Exporting ${dataCount} applicants...`;
              console.log(`Exporting ${dataCount} previously collected records`);
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
              
              // Inject content script
              await chrome.scripting.executeScript({
                  target: { tabId: tab.id },
                  files: ["content.js"]
              });
              
              // Check if script is running properly after injection
              await new Promise(resolve => setTimeout(resolve, 500));
              
              try {
                  const checkResult = await chrome.scripting.executeScript({
                      target: { tabId: tab.id },
                      func: () => ({
                          isRunning: !!window.__LI_EXPORT_RUNNING,
                          hasStarted: true
                      })
                  });
                  
                  const { isRunning, hasStarted } = checkResult[0].result;
                  
                  if (isRunning) {
                      statusElement.textContent = "Scraper running. This window will stay open.";
                      // Keep the popup open so the user can track progress and stop if needed
                  } else {
                      statusElement.textContent = "Error: Scraper not running properly. Please try again.";
                  }
              } catch (e) {
                  console.error("Error checking if scraper started:", e);
                  statusElement.textContent = "Scraper started. This window will stay open.";
              }
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