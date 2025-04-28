/* Injects the scraper into the current tab */
document.getElementById("export").addEventListener("click", async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return;
  // Check if the URL is a LinkedIn job applicants page before injecting
  if (tab?.url?.includes("linkedin.com/hiring/jobs/") && tab.url.includes("/applicants")) {
      try {
          await chrome.scripting.executeScript({
              target: { tabId: tab.id },
              files: ["content.js"]
          });
          window.close(); // Close popup after successful injection
      } catch (error) {
          console.error("Failed to inject content script:", error);
          // Optional: Display an error message to the user in the popup
          // document.body.innerHTML = `<p style="color:red;">Error: Could not inject script. Check console.</p>`;
      }
  } else {
      // Optional: Provide feedback if not on the correct page
      alert("Please navigate to a LinkedIn job applicants page (e.g., linkedin.com/hiring/jobs/.../applicants) before exporting.");
      console.warn("Export button clicked on non-applicant page:", tab.url);
  }
});