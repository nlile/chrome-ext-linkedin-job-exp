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

The exported CSV columns (as of your current extension output) are:

- `applicant_id`
- `profile_url`
- `name`
- `connection_degree`
- `headline`
- `location`
- `applied_time`
- `preferred_qualifications_met`
- `preferred_qualifications_total`
- `work_snippet`
- `view_status`
- `rating`
- `experience_items` (JSON array)
- `education_items` (JSON array)
- `resume_download_url`
- `resume_iframe_src`
- `screening_questions` (JSON array)

**Note:**
- This schema reflects the actual output of the extension as of your last export. If you update the extension or its code, the columns may change. If in doubt, check the export logic in `content.js` or test a fresh export.
