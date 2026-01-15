const state = {
  data: null,
  teamToInstitutions: new Map(),
  institutionMeta: new Map(),
  teamMeta: new Map(),
  years: [],
  countries: [],
  formats: [],
  restrictions: [],
  filters: {
    search: "",
    topN: 3,
    yearStart: null,
    yearEnd: null,
    country: "all",
    weightMin: 0,
    formats: new Set(),
    restrictions: new Set(),
  },
};

const elements = {
  dataRange: document.getElementById("data-range"),
  statInstitutions: document.getElementById("stat-institutions"),
  statTeams: document.getElementById("stat-teams"),
  statEvents: document.getElementById("stat-events"),
  statTopN: document.getElementById("stat-topn"),
  summary: document.getElementById("summary"),
  search: document.getElementById("search"),
  topn: document.getElementById("topn"),
  yearStart: document.getElementById("year-start"),
  yearEnd: document.getElementById("year-end"),
  weightMin: document.getElementById("weight-min"),
  country: document.getElementById("country"),
  formatOptions: document.getElementById("format-options"),
  restrictionOptions: document.getElementById("restriction-options"),
  reset: document.getElementById("reset"),
  tableBody: document.getElementById("table-body"),
  jumpTable: document.getElementById("jump-table"),
  jumpMethod: document.getElementById("jump-method"),
};

const formatNumber = (value) => value.toLocaleString("en-US");
const formatWeight = (value) =>
  Number.isInteger(value) ? value.toString() : value.toFixed(1);
const formatPercent = (value) => {
  const percent = value * 100;
  return Number.isInteger(percent) ? percent.toFixed(0) : percent.toFixed(1);
};
const DEFAULT_FORMATS = new Set(["Jeopardy"]);
const DEFAULT_RESTRICTIONS = new Set(["Open"]);

const parseYear = (iso) => {
  if (!iso) return null;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date.getUTCFullYear();
};

const normalizeFormat = (format) => {
  if (!format || !format.trim()) return "Jeopardy";
  return format;
};

const normalizeRestriction = (restriction) => {
  if (!restriction || !restriction.trim()) return "Unknown";
  return restriction;
};

const normalizeCountry = (code) => {
  if (!code) return "Unknown";
  return code.toUpperCase();
};

const buildIndex = (data) => {
  const teamToInstitutions = new Map();
  const institutionMeta = new Map();
  const teamMeta = new Map();
  const countries = new Set();
  let teamCount = 0;

  Object.entries(data.institutions).forEach(([name, info]) => {
    const country = normalizeCountry(info.country);
    countries.add(country);
    const teams = info.teams || [];
    teams.forEach((team) => {
      const existing = teamToInstitutions.get(team.ctftime_id);
      if (existing) {
        existing.add(name);
      } else {
        teamToInstitutions.set(team.ctftime_id, new Set([name]));
        teamMeta.set(team.ctftime_id, {
          name: team.name,
        });
        teamCount += 1;
      }
    });
    institutionMeta.set(name, {
      name,
      country,
      website: info.website,
      teams,
    });
  });

  return {
    teamToInstitutions,
    institutionMeta,
    teamMeta,
    countries: Array.from(countries).sort(),
    teamCount,
  };
};

const computeYears = (events) => {
  const years = new Set();
  events.forEach((event) => {
    const year = parseYear(event.end_time || event.start_time);
    if (year) years.add(year);
  });
  return Array.from(years).sort((a, b) => a - b);
};

const computeFormats = (events) => {
  const formats = new Set();
  events.forEach((event) => {
    if (!event || typeof event !== "object") return;
    formats.add(normalizeFormat(event.format));
  });
  return Array.from(formats).sort((a, b) => a.localeCompare(b));
};

const computeRestrictions = (events) => {
  const restrictions = new Set();
  events.forEach((event) => {
    if (!event || typeof event !== "object") return;
    restrictions.add(normalizeRestriction(event.restrictions));
  });
  return Array.from(restrictions).sort((a, b) => a.localeCompare(b));
};

const computeWeightRange = (events) => {
  const weights = events
    .map((event) => event.ctftime_weight)
    .filter((weight) => typeof weight === "number" && !Number.isNaN(weight));
  if (!weights.length) return { min: 0, max: 100 };
  return {
    min: Math.min(...weights),
    max: Math.max(...weights),
  };
};

const getEventWeight = (event) => {
  const weight = event.ctftime_weight;
  if (typeof weight !== "number" || Number.isNaN(weight)) return 0;
  return weight;
};

const computeScores = ({ events }, teamToInstitutions, teamMeta, filters) => {
  const { topN, yearStart, yearEnd, weightMin, formats, restrictions } = filters;
  const scores = new Map();
  const details = new Map();
  let eligibleEvents = 0;

  events.forEach((event) => {
    const year = parseYear(event.start_time);
    if (!year || year < yearStart || year > yearEnd) return;
    const format = normalizeFormat(event.format);
    if (formats) {
      if (formats.size === 0) return;
      if (!formats.has(format)) return;
    }
    const restriction = normalizeRestriction(event.restrictions);
    if (restrictions) {
      if (restrictions.size === 0) return;
      if (!restrictions.has(restriction)) return;
    }
    const weight = getEventWeight(event);
    if (weight < weightMin) return;
    const academicRankings = (event.rankings || [])
      .filter((entry) => teamToInstitutions.has(entry.ctftime_team_id))
      .sort((a, b) => a.place - b.place);

    if (academicRankings.length === 0) return;
    eligibleEvents += 1;

    academicRankings.slice(0, topN).forEach((entry, index) => {
      const institutions = teamToInstitutions.get(entry.ctftime_team_id);
      if (!institutions || institutions.size === 0) return;
      const splitPoints = 1 / institutions.size;

      const shared = institutions.size > 1;
      institutions.forEach((institution) => {
        const current = scores.get(institution) || {
          points: 0,
          lastYear: 0,
          scoredTeams: new Set(),
        };
        current.points += splitPoints;
        current.scoredTeams.add(entry.ctftime_team_id);
        if (year > current.lastYear) current.lastYear = year;
        scores.set(institution, current);

        const detailList = details.get(institution) || [];
        const team = teamMeta.get(entry.ctftime_team_id);
        detailList.push({
          eventName: event.name,
          eventId: event.ctftime_id,
          weight,
          format,
          restriction,
          endTime: event.end_time || event.start_time || null,
          year,
          academicRank: index + 1,
          place: entry.place,
          teamId: entry.ctftime_team_id,
          teamName: team ? team.name : "Unknown team",
          share: splitPoints,
          shared,
        });
        details.set(institution, detailList);
      });
    });
  });

  return { scores, eligibleEvents, details };
};

const applyFilters = (rows, filters, institutionMeta) => {
  const search = filters.search.trim().toLowerCase();
  const country = filters.country;

  return rows.filter((row) => {
    if (search && !row.name.toLowerCase().includes(search)) return false;
    if (country !== "all") {
      const meta = institutionMeta.get(row.name);
      if (!meta || normalizeCountry(meta.country) !== country) return false;
    }
    return true;
  });
};

const countryFlag = (code) => {
  const normalized = normalizeCountry(code);
  if (!/^[A-Z]{2}$/.test(normalized)) return "🌐";
  const offset = 127397;
  const chars = [...normalized].map((char) =>
    String.fromCodePoint(offset + char.charCodeAt(0))
  );
  return chars.join("");
};

const renderTable = (rows, institutionMeta, details, teamToInstitutions) => {
  if (!rows.length) {
    elements.tableBody.innerHTML =
      '<tr><td colspan="3" class="loading">No institutions match these filters.</td></tr>';
    return;
  }

  elements.tableBody.innerHTML = rows
    .map((row, index) => {
      const meta = institutionMeta.get(row.name) || {};
      const flag = countryFlag(meta.country);
      const site = meta.website
        ? `<a class="link" href="${meta.website}" target="_blank" rel="noopener">${row.name}</a>`
        : row.name;
      const detailId = `detail-${index}`;
      const teamLinks = (meta.teams || [])
        .map((team) => {
          const institutions = teamToInstitutions.get(team.ctftime_id);
          const sharedCount = institutions ? institutions.size : 1;
          const shareLabel =
            sharedCount > 1 ? ` (${formatPercent(1 / sharedCount)}%)` : "";
          return `<a class="link" href="https://ctftime.org/team/${team.ctftime_id}" target="_blank" rel="noopener">${team.name}</a>${shareLabel}`;
        })
        .join(", ");
      const eventRows = (details.get(row.name) || [])
        .sort((a, b) => {
          const aTime = a.endTime ? new Date(a.endTime).getTime() : 0;
          const bTime = b.endTime ? new Date(b.endTime).getTime() : 0;
          return bTime - aTime || a.eventName.localeCompare(b.eventName);
        })
        .map((event) => {
          const eventLink = event.eventId
            ? `<a class="link" href="https://ctftime.org/event/${event.eventId}" target="_blank" rel="noopener">${event.eventName}</a>`
            : event.eventName;
          return `
            <tr>
              <td>${eventLink}</td>
              <td>${event.academicRank}</td>
              <td><a class="link" href="https://ctftime.org/team/${event.teamId}" target="_blank" rel="noopener">${event.teamName}</a></td>
              <td>${event.place}</td>
              <td>${formatWeight(event.weight)}</td>
              <td>${event.format}</td>
              <td>${event.restriction}</td>
              <td>${event.year}</td>
            </tr>
          `;
        })
        .join("");
      const detailContent =
        eventRows.length > 0
          ? `
            <div class="detail-block">
              <div class="detail-section">
                <span class="detail-label">Teams</span>
                <div class="detail-value">${teamLinks || "No teams listed"}</div>
              </div>
              <div class="detail-section">
                <span class="detail-label">Scored CTFs</span>
                <div class="detail-table-wrap">
                  <table class="detail-table">
                    <thead>
                      <tr>
                        <th>CTF</th>
                        <th>Academic rank</th>
                        <th>Team</th>
                        <th>Place</th>
                        <th>Weight</th>
                        <th>Format</th>
                        <th>Restrictions</th>
                        <th>Year</th>
                      </tr>
                    </thead>
                    <tbody>
                      ${eventRows}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          `
          : `
            <div class="detail-block">
              <div class="detail-section">
                <span class="detail-label">Teams</span>
                <div class="detail-value">${teamLinks || "No teams listed"}</div>
              </div>
              <div class="detail-section detail-muted">No scored events for these filters.</div>
            </div>
          `;

      return `
        <tr data-detail="${detailId}">
          <td>${index + 1}</td>
          <td><span class="flag">${flag}</span>${site}</td>
          <td>${formatNumber(row.points)}</td>
        </tr>
        <tr id="${detailId}" class="detail-row">
          <td colspan="3">
            ${detailContent}
          </td>
        </tr>
      `;
    })
    .join("");
};

const renderSummary = (rows, eligibleEvents, filters) => {
  elements.summary.textContent = `${rows.length} institutions listed · ${formatNumber(
    eligibleEvents
  )} eligible CTFs · top ${filters.topN} academic finishers · weight ≥ ${formatWeight(
    filters.weightMin
  )}`;
};

const renderStats = (institutionCount, teamCount, eligibleEvents, latestDate) => {
  elements.statInstitutions.textContent = formatNumber(institutionCount);
  elements.statTeams.textContent = formatNumber(teamCount);
  elements.statEvents.textContent = formatNumber(eligibleEvents);
  elements.statTopN.textContent = state.filters.topN;
  elements.dataRange.textContent = latestDate
    ? `Data through ${latestDate}`
    : "Dataset loaded";
};

const renderDataNote = (latestDate) => {
  const note = document.getElementById("data-note");
  if (!note) return;
  const base = `Data sourced from <a class="link" href="https://ctftime.org" target="_blank" rel="noopener">CTFTime</a>`;
  note.innerHTML = `${base}.`;
};

const getLatestEventDate = (events) => {
  if (!events.length) return null;
  const latest = events
    .map((event) => event.end_time || event.start_time)
    .filter(Boolean)
    .map((iso) => new Date(iso))
    .filter((date) => !Number.isNaN(date.getTime()))
    .sort((a, b) => b - a)[0];
  if (!latest) return null;
  return latest.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
};

const updateView = () => {
  if (!state.data) return;
  const { scores, eligibleEvents, details } = computeScores(
    state.data,
    state.teamToInstitutions,
    state.teamMeta,
    state.filters
  );

  const rows = Array.from(scores.entries())
    .map(([name, stat]) => ({
      name,
      points: stat.points,
      lastYear: stat.lastYear,
    }))
    .sort((a, b) => b.points - a.points || a.name.localeCompare(b.name));

  const filtered = applyFilters(rows, state.filters, state.institutionMeta);
  renderTable(filtered, state.institutionMeta, details, state.teamToInstitutions);
  renderSummary(filtered, eligibleEvents, state.filters);
  renderStats(state.institutionMeta.size, state.teamCount, eligibleEvents, state.latestDate);
};

const setYearOptions = (years) => {
  elements.yearStart.innerHTML = years
    .map((year) => `<option value="${year}">${year}</option>`)
    .join("");
  elements.yearEnd.innerHTML = years
    .map((year) => `<option value="${year}">${year}</option>`)
    .join("");

  elements.yearStart.value = years[0];
  elements.yearEnd.value = years[years.length - 1];
  state.filters.yearStart = years[0];
  state.filters.yearEnd = years[years.length - 1];
};

const setWeightOptions = (range) => {
  elements.weightMin.min = range.min;
  elements.weightMin.max = range.max;
  elements.weightMin.value = range.min;
  state.filters.weightMin = range.min;
};

const setCountryOptions = (countries) => {
  elements.country.innerHTML =
    '<option value="all">All countries</option>' +
    countries.map((code) => `<option value="${code}">${code}</option>`).join("");
};

const setFormatOptions = (formats) => {
  elements.formatOptions.innerHTML = formats
    .map(
      (format) => `
        <label>
          <input type="checkbox" value="${format}" ${
            DEFAULT_FORMATS.has(format) ? "checked" : ""
          } />
          ${format}
        </label>
      `
    )
    .join("");
  state.filters.formats = new Set(
    formats.filter((format) => DEFAULT_FORMATS.has(format))
  );
};

const setRestrictionOptions = (restrictions) => {
  elements.restrictionOptions.innerHTML = restrictions
    .map(
      (restriction) => `
        <label>
          <input type="checkbox" value="${restriction}" ${
            DEFAULT_RESTRICTIONS.has(restriction) ? "checked" : ""
          } />
          ${restriction}
        </label>
      `
    )
    .join("");
  state.filters.restrictions = new Set(
    restrictions.filter((restriction) => DEFAULT_RESTRICTIONS.has(restriction))
  );
};

const syncFormatFilters = () => {
  const checked = Array.from(
    elements.formatOptions.querySelectorAll('input[type="checkbox"]:checked')
  ).map((input) => input.value);
  state.filters.formats = new Set(checked);
};

const syncRestrictionFilters = () => {
  const checked = Array.from(
    elements.restrictionOptions.querySelectorAll('input[type="checkbox"]:checked')
  ).map((input) => input.value);
  state.filters.restrictions = new Set(checked);
};

const wireEvents = () => {
  elements.search.addEventListener("input", (event) => {
    state.filters.search = event.target.value;
    updateView();
  });

  elements.topn.addEventListener("change", (event) => {
    state.filters.topN = Number(event.target.value);
    elements.statTopN.textContent = state.filters.topN;
    updateView();
  });

  elements.yearStart.addEventListener("change", (event) => {
    state.filters.yearStart = Number(event.target.value);
    if (state.filters.yearStart > state.filters.yearEnd) {
      state.filters.yearEnd = state.filters.yearStart;
      elements.yearEnd.value = state.filters.yearEnd;
    }
    updateView();
  });

  elements.yearEnd.addEventListener("change", (event) => {
    state.filters.yearEnd = Number(event.target.value);
    if (state.filters.yearEnd < state.filters.yearStart) {
      state.filters.yearStart = state.filters.yearEnd;
      elements.yearStart.value = state.filters.yearStart;
    }
    updateView();
  });

  elements.weightMin.addEventListener("input", (event) => {
    const value = Number(event.target.value);
    state.filters.weightMin = Number.isFinite(value)
      ? value
      : state.weightRange.min;
    updateView();
  });

  elements.country.addEventListener("change", (event) => {
    state.filters.country = event.target.value;
    updateView();
  });

  elements.formatOptions.addEventListener("change", (event) => {
    if (event.target && event.target.matches('input[type="checkbox"]')) {
      syncFormatFilters();
      updateView();
    }
  });

  elements.restrictionOptions.addEventListener("change", (event) => {
    if (event.target && event.target.matches('input[type="checkbox"]')) {
      syncRestrictionFilters();
      updateView();
    }
  });

  elements.reset.addEventListener("click", () => {
    state.filters.search = "";
    state.filters.topN = 3;
    state.filters.country = state.countries.includes("US") ? "US" : "all";
    state.filters.yearStart = state.years.includes(2023) ? 2023 : state.years[0];
    state.filters.yearEnd = state.years[state.years.length - 1];
    state.filters.weightMin = state.weightRange.max >= 75 ? 75 : state.weightRange.min;
    state.filters.formats = new Set(DEFAULT_FORMATS);
    state.filters.restrictions = new Set(DEFAULT_RESTRICTIONS);

    elements.search.value = "";
    elements.topn.value = "3";
    elements.country.value = state.filters.country;
    elements.yearStart.value = state.filters.yearStart;
    elements.yearEnd.value = state.filters.yearEnd;
    elements.weightMin.value = state.filters.weightMin;
    elements.statTopN.textContent = state.filters.topN;
    elements.formatOptions
      .querySelectorAll('input[type="checkbox"]')
      .forEach((input) => {
        input.checked = DEFAULT_FORMATS.has(input.value);
      });
    elements.restrictionOptions
      .querySelectorAll('input[type="checkbox"]')
      .forEach((input) => {
        input.checked = DEFAULT_RESTRICTIONS.has(input.value);
      });
    updateView();
  });

  elements.jumpTable.addEventListener("click", () => {
    document.getElementById("leaderboard").scrollIntoView({ behavior: "smooth" });
  });

  elements.jumpMethod.addEventListener("click", () => {
    document.getElementById("methodology").scrollIntoView({ behavior: "smooth" });
  });

  elements.tableBody.addEventListener("click", (event) => {
    if (event.target.closest("a")) return;
    const row = event.target.closest("tr[data-detail]");
    if (!row) return;
    const detailId = row.dataset.detail;
    const detailRow = document.getElementById(detailId);
    if (!detailRow) return;
    const isOpen = detailRow.classList.toggle("open");
    row.classList.toggle("open", isOpen);
  });
};

const init = async () => {
  try {
    const response = await fetch("ctfrankings.json");
    if (!response.ok) throw new Error("Failed to load ctf.json");
    const data = await response.json();
    state.data = data;

    const index = buildIndex(data);
    state.teamToInstitutions = index.teamToInstitutions;
    state.institutionMeta = index.institutionMeta;
    state.teamMeta = index.teamMeta;
    state.teamCount = index.teamCount;
    state.countries = index.countries;

    state.years = computeYears(data.events);
    setYearOptions(state.years);
    if (state.years.includes(2023)) {
      state.filters.yearStart = 2023;
      elements.yearStart.value = "2023";
    }
    state.formats = computeFormats(data.events);
    setFormatOptions(state.formats);
    state.restrictions = computeRestrictions(data.events);
    setRestrictionOptions(state.restrictions);
    state.weightRange = computeWeightRange(data.events);
    setWeightOptions(state.weightRange);
    if (state.weightRange.max >= 75) {
      state.filters.weightMin = 75;
      elements.weightMin.value = "75";
    }
    setCountryOptions(state.countries);
    state.filters.country = state.countries.includes("US") ? "US" : "all";
    elements.country.value = state.filters.country;

    state.latestDate = getLatestEventDate(data.events);
    renderDataNote(state.latestDate);

    updateView();
  } catch (error) {
    elements.tableBody.innerHTML = `<tr><td colspan="3" class="loading">${error.message}</td></tr>`;
    elements.summary.textContent = "Unable to load data.";
    console.error(error);
  }
};

wireEvents();
init();
