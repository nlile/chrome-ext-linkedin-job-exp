/* LinkedIn Applicants Exporter — content script (navigation-&-null-safe fix 2025-05-09) */
(async () => {
  /* ───────────────────────── 1 · GLOBAL STATE ───────────────────────── */
  if (window.__LI_EXPORT_RUNNING) {
    /* second click while running → request graceful stop + immediate export */
    console.warn("Exporter already running — toggling stop/export.");
    window.__LI_EXPORT_TERMINATE = true;
    if (Array.isArray(window.__LI_EXPORT_DATA) && window.__LI_EXPORT_DATA.length) {
      const copy = JSON.parse(JSON.stringify(window.__LI_EXPORT_DATA));
      if (typeof triggerExport === "function") triggerExport(copy);
    }
    return;
  }

  /* ───────────────────────── 2 · UTILITIES ──────────────────────────── */
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const qs  = (sel, root = document) => root.querySelector(sel);
  const qsa = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  /* ───────────────────────── 3 · EXPORT HELPERS ─────────────────────── */
  const CSV_HEADER = [
    "applicant_id","profile_url","name","connection_degree","headline","location",
    "applied_time","preferred_qualifications_met","preferred_qualifications_total",
    "work_snippet","view_status","rating","experience_items","education_items",
    "resume_download_url","resume_iframe_src","screening_questions",
  ];

  const triggerExport = (rows) => {
    if (window.__LI_EXPORT_COMPLETED) return true;               // avoid double downloads
    if (!Array.isArray(rows) || !rows.length) {
      alert("Export failed: No applicant data could be extracted.");
      return false;
    }

    const csvRows = rows.map(r =>
      CSV_HEADER.map(f => {
        const v = r[f] ?? "";
        return `"${(typeof v === "string" ? v : JSON.stringify(v)).replace(/"/g,'""')}"`;
      }).join(",")
    );
    const blob = new Blob([[CSV_HEADER.join(","), ...csvRows].join("\n")],
                          { type:"text/csv;charset=utf-8;" });
    const url  = URL.createObjectURL(blob);
    const a    = Object.assign(document.createElement("a"),
                 { href:url, download:`linkedin_applicants_${Date.now()}.csv`, style:"display:none" });
    document.body.append(a); a.click(); a.remove(); URL.revokeObjectURL(url);

    alert(`Export complete: ${rows.length} applicants exported.`);
    window.__LI_EXPORT_COMPLETED = true;
    return true;
  };

  /* ─────────────────────── 4 · DOM-WAIT HELPERS ─────────────────────── */
  /**
   * Wait until the detail panel is *reasonably* loaded.
   * - Mandatory: the `<h1>` heading (candidate name) must exist.
   * - Nice-to-have: the “see full profile” link, OR we’ve waited `grace` ms.
   * Always resolves (never rejects) to avoid infinite loops on sparse profiles.
   */
  const waitForDetail = (timeout = 8_000, grace = 2_000) =>
    new Promise((res) => {
      const start = Date.now();
      const isReady = () => {
        const hasH1 = qs("#hiring-detail-root h1");
        if (!hasH1) return false;
        /* either the link is there, or we've given it a small grace period */
        if (qs("#hiring-detail-root .hiring-profile-highlights__see-full-profile a")) return true;
        return Date.now() - start > grace;
      };

      const id = setInterval(() => {
        if (isReady()) {
          clearInterval(id);
          return setTimeout(res, 350);          // small extra buffer
        }
      }, 150);

      /* hard stop — resolve anyway, but never reject */
      setTimeout(() => { clearInterval(id); res(); }, timeout);
    });

  const waitForMutation = (el,
                           opts = { childList:true, subtree:true },
                           timeout = 5_000) =>
    new Promise((res) => {
      if (!el) return res();
      const m = new MutationObserver((_, o)=>{ o.disconnect(); setTimeout(res,200); });
      m.observe(el, opts);
      setTimeout(() => { m.disconnect(); res(); }, timeout);
    });

  /* ─────────────────────── 5 · SECTION EXPANDERS ────────────────────── */
  const clickShowMoreAndWait = async (root, selectors, label) => {
    const fallback = {
      experience:["show more experiences","more experience"],
      education :["show more educations","more education"],
      resume    :["show more resume","show resume","see resume"],
    };
    let btn = null;

    /* a) explicit selectors first */
    for (const sel of selectors) if (btn = qs(sel, root)) break;

    /* b) fallback by text / aria-label phrases */
    if (!btn) {
      const phrases = fallback[label] || [];
      for (const b of qsa("button", root)) {
        const txt = b.innerText.toLowerCase();
        const aria = (b.getAttribute("aria-label") || "").toLowerCase();
        if (phrases.some(p => txt.includes(p) || aria.includes(p))) { btn = b; break; }
      }
    }

    if (!btn || btn.closest("[aria-hidden='true'], .visually-hidden")) return;

    const section   = btn.closest("section") || root;
    const lenBefore = section.innerHTML.length;

    btn.scrollIntoView({ block:"center" }); await sleep(150); btn.click();
    await waitForMutation(section); await sleep(300);

    if (section.innerHTML.length > lenBefore)
      console.log(`Expanded ${label} section`);
  };

  /* ─────────────────────── 6 · DATA EXTRACTOR ───────────────────────── */
  const extract = async () => {
    const root = qs("#hiring-detail-root"); if (!root) return null;

    /* --- expand everything that might be collapsed --- */
    await clickShowMoreAndWait(root,
      ["button[aria-label^='Show'][aria-label$='experiences']","button[aria-label*='experiences']"],
      "experience");
    await clickShowMoreAndWait(root,
      ["button[aria-label^='Show'][aria-label$='educations']","button[aria-label*='educations']"],
      "education");
    await clickShowMoreAndWait(root,
      ["button[aria-label^='Show more'][aria-label*='resume']","button[aria-label*='resume']"],
      "resume");
    /* expand inline “… more” bullets */
    qsa("button.inline-show-more-text__button", root).forEach(b => b.click());

    const txt  = (sel, ctx=root, def=null) => qs(sel, ctx)?.innerText.trim() || def;
    const attr = (sel, a,  ctx=root, def="") => qs(sel, ctx)?.getAttribute(a) || def;

    const applicant_id = location.href.match(/\/applicants\/(\d+)\/detail/)?.[1] || "";
    const nameHeader   = txt("h1");
    const name         = nameHeader?.split(/'s application/i)[0].trim() || nameHeader;

    const ratingNode = qs("div[aria-pressed='true']", root);
    const rating     = ratingNode ? ratingNode.innerText.trim()
                                             .toUpperCase().replace(/\s+/g,"_")
                                 : "UNRATED";

    const makeArray = (heading) => {
      const h3 = [...root.querySelectorAll("h3")]
                 .find(el => el.textContent.trim().toLowerCase() === heading.toLowerCase());
      if (!h3) return [];
      const items=[];
      h3.parentElement.querySelectorAll("li").forEach(li=>{
        if (heading === "Education") {
          const school = txt("p.t-14", li, "");
          const degree = txt("p.t-14.t-black--light", li, "");
          const dates  = txt("p.t-12", li, "");
          if (school || degree || dates) items.push({ school, degree, dates });
        } else {
          const title   = txt("p.t-14", li, "");
          const company = txt("p.t-14.t-black--light", li, "");
          const dates   = txt("p.t-12", li, "");
          if (title || company || dates) items.push({ title, company, dates });
        }
      });
      return items;
    };

    /* preferred-qualification counts */
    const pqTxt = txt(".hiring-screening-questions h3");
    const m     = pqTxt?.match(/(\d+)\s*out of\s*(\d+)/);
    const met   = m ? +m[1] : null;
    const tot   = m ? +m[2] : null;

    /* snippet + view-status from list card */
    const card = qs("li.hiring-applicants__list-item.hiring-applicants-list-item--selected") ||
                 qs("a[aria-current='page']")?.closest("li");
    const work_snippet = card
      ? qsa("ul[aria-label='Work experience'] li span.lt-line-clamp__line", card)
          .map(s => s.innerText.trim()).filter(Boolean)
      : null;
    const view_status  = card?.querySelector(".hiring-people-card__image-dot")
      ? "unviewed" : "viewed";

    return {
      applicant_id,
      profile_url: attr(".hiring-profile-highlights__see-full-profile a","href") || null,
      name,
      connection_degree: txt(".hiring-applicant-header__badge") ??
                         txt(".hiring-applicant-header h1 + span"),
      headline: txt(".hiring-applicant-header > div .t-16:nth-of-type(1)"),
      location: txt(".hiring-applicant-header > div .t-16:nth-of-type(2)"),
      applied_time: txt(".hiring-applicant-header__tidbit"),

      preferred_qualifications_met   : met,
      preferred_qualifications_total : tot,

      work_snippet : work_snippet ? JSON.stringify(work_snippet) : null,
      view_status,
      rating,
      experience_items: (() => {
        const arr = makeArray("Experience");
        return arr.length ? JSON.stringify(arr) : null;
      })(),
      education_items : (() => {
        const arr = makeArray("Education");
        return arr.length ? JSON.stringify(arr) : null;
      })(),
      resume_download_url: attr('.hiring-resume-viewer__resume-wrapper--collapsed a[href*="ambry"]',"href") || null,
      resume_iframe_src : attr(".hiring-resume-viewer__iframe","src") || null,
      screening_questions: JSON.stringify(
        qsa(".hiring-screening-questions ul li", root).map(li => ({
          question : txt("p.t-14:first-of-type", li),
          ideal    : txt("p.t-12 span:nth-of-type(2)", li),
          answer   : txt("p.t-14.t-bold", li),
          met      : !!qs("svg[class$='--succeeded']", li),
        }))
      ),
    };
  };

  /* ─────────────────────── 7 · MAIN SCRAPER LOOP ────────────────────── */
  window.__LI_EXPORT_RUNNING   = true;
  window.__LI_EXPORT_TERMINATE = false;
  window.__LI_EXPORT_COMPLETED = false;
  window.__LI_EXPORT_DATA      = [];

  const scrapedIds   = new Set();                               // keeps IDs even if DOM re-renders
  const listSel      = ".hiring-applicants__list-container";

  while (!window.__LI_EXPORT_TERMINATE) {
    const listContainer = qs(listSel);
    if (!listContainer) break;

    /* step A: pick first UNSEEN candidate on current page */
    const links = qsa("li.hiring-applicants__list-item a[href*='/applicants/']", listContainer);
    const next  = links.find(a => {
      const id = a.href.match(/\/applicants\/(\d+)\//)?.[1];
      return id && !scrapedIds.has(id);
    });

    if (next) {
      next.scrollIntoView({ block:"center" }); await sleep(250); next.click();
      await waitForDetail();

      const data = await extract();
      if (data?.applicant_id && !scrapedIds.has(data.applicant_id)) {
        scrapedIds.add(data.applicant_id);
        window.__LI_EXPORT_DATA.push(data);
      }

      await sleep(650);               // brief pause before next candidate
      continue;                       // back to while-loop → search again on same page
    }

    /* step B: no unseen candidates here → paginate */
    const nextPageBtn = qs("ul.artdeco-pagination__pages li.active + li button");
    if (!nextPageBtn) break;          // last page reached

    const firstIdBefore = qs("li.hiring-applicants__list-item a[href*='/applicants/']")?.href
                            .match(/\/applicants\/(\d+)\//)?.[1] || "";
    nextPageBtn.click();

    /* wait until the list actually changes (avoid racing) */
    let tries = 25;
    while (tries-- && !window.__LI_EXPORT_TERMINATE) {
      await sleep(400);
      const firstNow = qs("li.hiring-applicants__list-item a[href*='/applicants/']")?.href
                         .match(/\/applicants\/(\d+)\//)?.[1] || "";
      if (firstNow && firstNow !== firstIdBefore) break;
    }
  }

  /* ─────────────────────── 8 · FINISH ───────────────────────────────── */
  window.__LI_EXPORT_RUNNING = false;
  triggerExport(window.__LI_EXPORT_DATA);           // will no-op if already exported
})();
