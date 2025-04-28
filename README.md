# LinkedIn Applicants Exporter (Chrome Extension)

Exports applicant data from a LinkedIn job posting's applicant view to a CSV file.

**Note:** _This is currently in development. Known bugs & formatting issues exist. Use with caution and verify the output._

## Installation

1.  Download or clone this repository.
2.  Open Chrome/Chromium browser, navigate to `chrome://extensions`.
3.  Enable "Developer mode" (usually a toggle in the top right).
4.  Click "Load unpacked".
5.  Select the `linkedin-exporter-ext` folder.

## Usage

1.  Navigate to a specific LinkedIn job's applicant page (e.g., `https://www.linkedin.com/hiring/jobs/.../applicants/...`).
2.  Click the extension's icon in the Chrome toolbar.
3.  Click the "Export Applicants → CSV" button in the popup.
4.  Wait for the process to complete (it iterates through all applicants and pages).
5.  A CSV file named `linkedin_applicants_<timestamp>.csv` will be downloaded.

## Output CSV Columns

-   `name`
-   `headline`
-   `location`
-   `applied` (timestamp)
-   `degree` (connection degree, e.g., 1st, 2nd, 3rd)
-   `profile_url`
-   `resume_url` (if available)
-   `experience_json` (JSON array of {title, company, duration})
-   `education_json` (JSON array of {school, degree_field, duration})
-   `screening_json` (JSON array of {q, ideal, ans})
