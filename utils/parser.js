// Scraper, runs on the job page
export function scrapePageContent() {
  try {
    const hostname = window.location.hostname;
    let jobSignalFound = false;

    function capitalize(str) {
      return str.charAt(0).toUpperCase() + str.slice(1);
    }

    // Get JSON-LD structured data
    function getJsonLd() {
      try {
        const scripts = document.querySelectorAll('script[type="application/ld+json"]');
        for (const script of scripts) {
          const data = JSON.parse(script.textContent);
          const items = Array.isArray(data) ? data : [data];
          for (const item of items) {
            if (item['@type'] === 'JobPosting') {
              jobSignalFound = true;
              return item;
            }
          }
        }
      } catch (e) {}
      return null;
    }

    // Detect company name
    function detectCompany() {
      const knownSites = ['linkedin', 'handshake', 'indeed', 'glassdoor', 'ziprecruiter'];
      const isJobBoard = knownSites.some(s => hostname.includes(s));

      // use JSON-LD hiringOrganization only on job boards — company career sites can have verbose legal names
      if (isJobBoard) {
        const ld = getJsonLd();
        if (ld?.hiringOrganization?.name) return ld.hiringOrganization.name;
      }

      if (hostname.includes('linkedin.com')) {
        // multiple selectors because LinkedIn has changed their HTML structure several times
        const selectors = [
          '.job-details-jobs-unified-top-card__company-name a',
          '.job-details-jobs-unified-top-card__company-name',
          '.jobs-unified-top-card__company-name a',
          '.jobs-unified-top-card__company-name',
          '.topcard__org-name-link',
          '.topcard__flavor a',
          '[data-tracking-control-name*="company"]',
        ];
        for (const sel of selectors) {
          const el = document.querySelector(sel);
          const text = el?.innerText?.trim();
          if (text && !knownSites.some(s => text.toLowerCase() === s)) return text;
        }
        // fallback: title formats are "Role | Company | LinkedIn" or "Role at Company | LinkedIn"
        const title = document.title;
        const titleParts = title.split(/\s*\|\s*/);
        if (titleParts.length >= 2) {
          const company = titleParts[titleParts.length - 2].trim();
          if (company && !knownSites.some(s => company.toLowerCase() === s)) return company;
        }
        if (title.includes(' at ')) {
          const company = title.split(' at ').slice(1).join(' at ').split(/\s*\|/)[0].trim();
          if (company && !knownSites.some(s => company.toLowerCase() === s)) return company;
        }
      }

      if (hostname.includes('handshake.com')) {
        const selectors = [
          '[data-hook="employer-profile-name"]',
          '[data-hook="employer-name"]',
          '.employer-profile--name',
          '.employer-name',
          '[class*="employer-name"]',
          '[class*="company-name"]',
        ];
        for (const sel of selectors) {
          const el = document.querySelector(sel);
          const text = el?.innerText?.trim();
          if (text && !knownSites.some(s => text.toLowerCase() === s)) return text;
        }
        // title formats: "Role at Company | Handshake" or "Role | Company | Handshake"
        const title = document.title;
        const titleParts = title.split(/\s*\|\s*/);
        if (titleParts.length >= 2) {
          const company = titleParts[titleParts.length - 2].trim();
          if (company && !knownSites.some(s => company.toLowerCase() === s)) return company;
        }
        if (title.includes(' at ')) {
          const company = title.split(' at ').slice(1).join(' at ').split(/\s*\|/)[0].trim();
          if (company && !knownSites.some(s => company.toLowerCase() === s)) return company;
        }
      }

      // fallback 1: og:site_name — skip if it looks like a raw domain or job board
      const ogSite = document.querySelector('meta[property="og:site_name"]');
      const ogVal = ogSite?.content?.trim();
      if (ogVal && !ogVal.includes('.') && !knownSites.some(s => ogVal.toLowerCase().includes(s))) return ogVal;

      // fallback 2: ATS-hosted pages (e.g. google.myworkdayjobs.com) — company is the first subdomain
      const hostParts = hostname.split('.');
      const atsDomains = ['myworkdayjobs', 'greenhouse', 'lever', 'taleo', 'icims', 'jobvite'];
      if (atsDomains.some(ats => hostname.includes(ats))) return capitalize(hostParts[0]);

      // fallback 3: strip common career subdomains (careers.ibm.com → "Ibm", jobs.amazon.com → "Amazon")
      const cleaned = hostname.replace(/^(www|careers|jobs|work)\./i, '');
      return capitalize(cleaned.split('.')[0]);
    }

    // Detect job title
    function detectRole() {
      // JSON-LD first — most accurate, avoids h1s that contain the company name
      const ld = getJsonLd();
      if (ld?.title) return ld.title;

      // job-specific selectors — a match here also confirms we're on a job page
      const specificSelectors = [
        '.job-details-jobs-unified-top-card__job-title h1',
        '.jobs-unified-top-card__job-title h1',
        '.topcard__title',
        '[data-hook="job-name"]',
        '.job-name',
        '[class*="job-title"] h1',
      ];
      for (const sel of specificSelectors) {
        const el = document.querySelector(sel);
        if (el?.innerText?.trim()) {
          jobSignalFound = true;
          return el.innerText.trim();
        }
      }
      // fallback: longest h1 — brand headings are short, job titles are long
      const allH1s = [...document.querySelectorAll('h1')];
      const longestH1 = allH1s.reduce((best, el) => {
        const t = el.innerText.trim();
        return t.length > best.length ? t : best;
      }, '');
      if (longestH1.length > 4) return longestH1;

      const stripBadge = t => t.replace(/^\(\d+\)\s*/, ''); // strip notification badges like "(3) "
      const splitTitle = t => t.split(/\s*\|\s*|\s[-–—]\s/)[0].trim(); // cut after separator, preserves hyphens in "Co-Op"

      // fallback: og:title
      const ogTitle = document.querySelector('meta[property="og:title"]');
      if (ogTitle?.content) {
        const t = stripBadge(ogTitle.content);
        if (t.includes(' at ')) return t.split(' at ')[0].trim(); // handle "Role at Company" format
        return splitTitle(t);
      }
      // last resort: raw page title
      return splitTitle(stripBadge(document.title));
    }

    // Detect job location
    function detectLocation() {
      const US_STATES = new Set([
        'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA',
        'KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ',
        'NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT',
        'VA','WA','WV','WI','WY','DC',
      ]);

      // JSON-LD first
      const ld = getJsonLd();
      if (ld?.jobLocation) {
        const locs = Array.isArray(ld.jobLocation) ? ld.jobLocation : [ld.jobLocation];
        if (locs.length > 1) return 'Multiple Locations';
        const addr = locs[0]?.address;
        if (addr) {
          const parts = [addr.addressLocality, addr.addressRegion].filter(Boolean);
          if (parts.length) return parts.join(', ');
        }
      }

      const mainText = (document.querySelector('main') || document.body).innerText;

      if (hostname.includes('linkedin.com')) {
        // LinkedIn shows "City, ST ·" near the job title — state is in group 2 for validation
        const cityMatch = mainText.match(/([A-Z][a-z]+(?: [A-Z][a-z]+)?,\s*([A-Z]{2}))\s*·/);
        if (cityMatch && US_STATES.has(cityMatch[2])) return cityMatch[1].trim();
        const workMatch = mainText.match(/\b(Remote|Hybrid|On-site)\b/);
        if (workMatch) return workMatch[1];
        return '';
      }

      if (hostname.includes('handshake.com')) {
        const basedInMatch = mainText.match(/based in ([A-Za-z\s]+,\s*([A-Z]{2}))/i);
        if (basedInMatch && US_STATES.has(basedInMatch[2])) return basedInMatch[1].trim();
        const cityMatch = mainText.match(/\b([A-Z][a-z]+(?: [A-Z][a-z]+)?,\s*([A-Z]{2}))\b/);
        if (cityMatch && US_STATES.has(cityMatch[2])) return cityMatch[1].trim();
        return '';
      }

      // generic: try common location selectors
      for (const sel of ['[data-hook="job-location"]', '.job-location', '[class*="job-location"]']) {
        const el = document.querySelector(sel);
        const text = el?.innerText?.trim().split('\n')[0].trim();
        if (text && text.length < 100) return text;
      }

      // Amazon jobs format: "USA, TX, Austin" → reformat to "Austin, TX"
      const usaMatch = mainText.match(/\bUSA,\s*([A-Z]{2}),\s*([A-Za-z][A-Za-z\s]+)/);
      if (usaMatch && US_STATES.has(usaMatch[1])) return `${usaMatch[2].trim()}, ${usaMatch[1]}`;

      // IBM and similar sites list many cities below the h1 without "City, ST" format —
      // 4+ commas in a line after the title is a reliable signal for multiple locations
      const allH1s = [...document.querySelectorAll('h1')];
      const longestTitle = allH1s.reduce((best, el) => {
        const t = el.innerText.trim();
        return t.length > best.length ? t : best;
      }, '');
      if (longestTitle) {
        const titleIdx = mainText.indexOf(longestTitle);
        if (titleIdx >= 0) {
          const afterTitle = mainText.substring(titleIdx + longestTitle.length, titleIdx + longestTitle.length + 600);
          for (const line of afterTitle.split('\n').map(l => l.trim()).filter(Boolean)) {
            if ((line.match(/,/g) || []).length >= 4) return 'Multiple Locations';
          }
          if ((afterTitle.match(/,/g) || []).length >= 6) return 'Multiple Locations';
        }
      }
      // fallback: scan the first 1000 chars for comma-dense lines
      for (const line of mainText.substring(0, 1000).split('\n').map(l => l.trim()).filter(Boolean)) {
        if ((line.match(/,/g) || []).length >= 4) return 'Multiple Locations';
      }

      // scan top of page for validated city/state pairs
      const topText = mainText.substring(0, 1500);
      const cityMatches = [...topText.matchAll(/\b([A-Z][a-z]+(?: [A-Z][a-z]+)?,\s*([A-Z]{2}))\b/g)]
        .filter(m => US_STATES.has(m[2]));
      if (cityMatches.length > 1) return 'Multiple Locations';
      if (cityMatches.length === 1) return cityMatches[0][1].trim();

      // international: "City, Region, Country"
      const intlMatch = topText.match(
        /\b([A-Z][a-z]+(?: [A-Z][a-z]+)?,\s*[A-Z][a-z]+(?: [A-Z][a-z]+)?,\s*[A-Z][a-z]+(?: [A-Z][a-z]+)*)\b/
      );
      if (intlMatch) return intlMatch[1].trim();

      return '';
    }

    // Detect posting source
    function detectSource() {
      if (hostname.includes('linkedin.com'))  return 'LinkedIn';
      if (hostname.includes('handshake.com')) return 'Handshake';
      return 'Company Website';
    }

    // Get job description text
    function getDescriptionText() {
      // ordered most-specific to least — 'main' and body are last-resort fallbacks
      const selectors = [
        '.jobs-description__content',
        '.jobs-box__html-content',
        '.show-more-less-html',
        '[data-hook="job-description"]',
        '.job-description',
        '#job-description',
        '[class*="description"]',
        'main',
      ];
      for (const sel of selectors) {
        const el = document.querySelector(sel);
        if (el?.innerText?.trim()) return el.innerText;
      }
      return document.body.innerText;
    }

    // Detect salary / compensation
    function detectCompensation() {
      // JSON-LD baseSalary is only present when the employer explicitly listed it
      const ld = getJsonLd();
      if (ld?.baseSalary?.value) {
        const v = ld.baseSalary.value;
        const period = v.unitText === 'HOUR' ? '/hr' : v.unitText === 'YEAR' ? '/yr' : '';
        if (v.minValue && v.maxValue) return `$${v.minValue}${period} - $${v.maxValue}${period}`;
        if (v.value) return `$${v.value}${period}`;
      }

      if (hostname.includes('linkedin.com')) {
        // scan only the first ~1500 chars to avoid the AI "Salary insights" section lower on the page
        const mainText = (document.querySelector('main') || document.body).innerText.slice(0, 1500);
        const salaryPatterns = [
          /\$[\d,.]+\s*\/\s*(?:hr|hour)\s*[-–]\s*\$[\d,.]+\s*\/\s*(?:hr|hour)/i,
          /\$[\d,.]+k?\s*\/\s*(?:yr|year|annually)\s*[-–]\s*\$[\d,.]+k?\s*\/\s*(?:yr|year|annually)/i,
          /\$[\d,.]+k?\s*[-–]\s*\$[\d,.]+k?\s*\/\s*(?:hr|hour|yr|year|annually)/i,
          /\$[\d,.]+k?\s*\/\s*(?:hr|hour|yr|year|annually)/i,
        ];
        for (const pat of salaryPatterns) {
          const m = mainText.match(pat);
          if (m) return m[0].trim();
        }
        return '';
      }

      if (hostname.includes('handshake.com')) {
        // scan only the top of the page — "Paid"/"Unpaid" with no dollar amount returns empty
        const topText = (document.querySelector('main') || document.body).innerText.slice(0, 1500);
        const salaryPatterns = [
          /\$[\d,.]+\s*\/\s*(?:hr|hour)\s*[-–]\s*\$[\d,.]+\s*\/\s*(?:hr|hour)/i,
          /\$[\d,.]+k?\s*\/\s*(?:yr|year|annually)\s*[-–]\s*\$[\d,.]+k?\s*\/\s*(?:yr|year|annually)/i,
          /\$[\d,.]+k?\s*[-–]\s*\$[\d,.]+k?\s*\/\s*(?:hr|hour|yr|year|annually)/i,
          /\$[\d,.]+k?\s*[-–]\s*[\d,.]+k?\s*\/\s*(?:hr|hour|yr|year|annually)/i,
          /\$[\d,.]+k?\s*\/\s*(?:hr|hour|yr|year|annually)/i,
        ];
        for (const pat of salaryPatterns) {
          const m = topText.match(pat);
          if (m) return m[0].trim();
        }
        return '';
      }

      const compEl = document.querySelector('[class*="salary"], [class*="compensation"]');
      if (compEl?.innerText?.includes('$')) return compEl.innerText.trim();
      const text = getDescriptionText();
      const patterns = [
        // "$48/hr - $50/hr"
        /\$[\d,]+(?:\.\d+)?\s*\/\s*(?:hr|hour)\s*[-–]\s*\$[\d,]+(?:\.\d+)?\s*\/\s*(?:hr|hour)/i,
        // "$48,000/yr - $50,000/yr"
        /\$[\d,]+(?:\.\d+)?k?\s*\/\s*(?:yr|year|annually)\s*[-–]\s*\$[\d,]+(?:\.\d+)?k?\s*\/\s*(?:yr|year|annually)/i,
        // "$48,000 - $50,000/yr" or "$48k - $50k/yr"
        /\$[\d,]+(?:\.\d+)?k?\s*[-–]\s*\$[\d,]+(?:\.\d+)?k?\s*\/\s*(?:hr|hour|yr|year|annually)/i,
        // "$25–35/hr" or "$25,000–50,000/yr" ($ only before first number)
        /\$[\d,]+(?:\.\d+)?k?\s*[-–]\s*[\d,]+(?:\.\d+)?k?\s*\/\s*(?:hr|hour|yr|year|annually)/i,
        // "$48,000 - $50,000" (no unit)
        /\$[\d,]+(?:\.\d+)?k?\s*[-–]\s*\$[\d,]+(?:\.\d+)?k?/i,
        // "$25–50k" (no unit, $ only before first)
        /\$[\d,]+(?:\.\d+)?k?\s*[-–]\s*[\d,]+(?:\.\d+)?k/i,
        // single value "$48/hr"
        /\$[\d,]+(?:\.\d+)?k?\s*\/\s*(?:hr|hour|yr|year|annually)/i,
      ];
      for (const pattern of patterns) {
        const match = text.match(pattern);
        if (match) return match[0].trim();
      }
      return '';
    }

    const company      = detectCompany();
    const role         = detectRole();
    const location     = detectLocation();
    const source       = detectSource();
    const compensation = detectCompensation();

    // prevent false saves on search results or profile pages
    const isJobPage = jobSignalFound
      || (hostname.includes('linkedin.com') && window.location.pathname.includes('/jobs/view'))
      || (hostname.includes('handshake.com') && window.location.pathname.includes('/jobs/'))
      || hostname.includes('job')
      || window.location.pathname.toLowerCase().includes('/job');

    return { company, position: role, location, source, link: window.location.href, compensation, isJobPage };

  } catch (e) {
    return { error: e.message, stack: e.stack };
  }
}
