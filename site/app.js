const state = {
  data: null,
  teamToInstitution: new Map(),
  institutionMeta: new Map(),
  teamMeta: new Map(),
  years: [],
  countries: [],
  filters: {
    search: "",
    topN: 3,
    yearStart: null,
    yearEnd: null,
    country: "all",
    weightMin: 0,
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
  reset: document.getElementById("reset"),
  tableBody: document.getElementById("table-body"),
  jumpTable: document.getElementById("jump-table"),
  jumpMethod: document.getElementById("jump-method"),
};

const formatNumber = (value) => value.toLocaleString("en-US");
const formatWeight = (value) =>
  Number.isInteger(value) ? value.toString() : value.toFixed(1);

const parseYear = (iso) => {
  if (!iso) return null;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date.getUTCFullYear();
};

const normalizeCountry = (code) => {
  if (!code) return "Unknown";
  return code.toUpperCase();
};

const buildIndex = (data) => {
  const teamToInstitution = new Map();
  const institutionMeta = new Map();
  const teamMeta = new Map();
  const countries = new Set();
  let teamCount = 0;

  Object.entries(data.institutions).forEach(([name, info]) => {
    const country = normalizeCountry(info.country);
    countries.add(country);
    const teams = info.teams || [];
    teams.forEach((team) => {
      teamToInstitution.set(team.ctftime_id, name);
      teamMeta.set(team.ctftime_id, {
        name: team.name,
        institution: name,
      });
    });
    teamCount += teams.length;
    institutionMeta.set(name, {
      name,
      country,
      website: info.website,
      teams,
    });
  });

  return {
    teamToInstitution,
    institutionMeta,
    teamMeta,
    countries: Array.from(countries).sort(),
    teamCount,
  };
};

const computeYears = (events) => {
  const years = new Set();
  events.forEach((event) => {
    const year = parseYear(event.start_time);
    if (year) years.add(year);
  });
  return Array.from(years).sort((a, b) => a - b);
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

const computeScores = ({ events }, teamToInstitution, teamMeta, filters) => {
  const { topN, yearStart, yearEnd, weightMin } = filters;
  const scores = new Map();
  const details = new Map();
  let eligibleEvents = 0;

  events.forEach((event) => {
    const year = parseYear(event.start_time);
    if (!year || year < yearStart || year > yearEnd) return;
    const weight = getEventWeight(event);
    if (weight < weightMin) return;
    const academicRankings = (event.rankings || [])
      .filter((entry) => teamToInstitution.has(entry.ctftime_team_id))
      .sort((a, b) => a.place - b.place);

    if (academicRankings.length === 0) return;
    eligibleEvents += 1;

    academicRankings.slice(0, topN).forEach((entry, index) => {
      const institution = teamToInstitution.get(entry.ctftime_team_id);
      const current = scores.get(institution) || {
        points: 0,
        lastYear: 0,
        scoredTeams: new Set(),
      };
      current.points += 1;
      current.scoredTeams.add(entry.ctftime_team_id);
      if (year > current.lastYear) current.lastYear = year;
      scores.set(institution, current);

      const detailList = details.get(institution) || [];
      const team = teamMeta.get(entry.ctftime_team_id);
      detailList.push({
        eventName: event.name,
        eventId: event.ctftime_id,
        weight,
        year,
        academicRank: index + 1,
        place: entry.place,
        teamId: entry.ctftime_team_id,
        teamName: team ? team.name : "Unknown team",
      });
      details.set(institution, detailList);
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

const renderTable = (rows, institutionMeta, details) => {
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
        .map(
          (team) =>
            `<a class="link" href="https://ctftime.org/team/${team.ctftime_id}" target="_blank" rel="noopener">${team.name}</a>`
        )
        .join(", ");
      const eventRows = (details.get(row.name) || [])
        .sort((a, b) => b.year - a.year || a.eventName.localeCompare(b.eventName))
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
  note.textContent = latestDate
    ? `Data sourced from ctfrankings.json (latest event: ${latestDate}).`
    : "Data sourced from ctfrankings.json.";
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
    state.teamToInstitution,
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
  renderTable(filtered, state.institutionMeta, details);
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

  elements.reset.addEventListener("click", () => {
    state.filters.search = "";
    state.filters.topN = 3;
    state.filters.country = "all";
    state.filters.yearStart = state.years.includes(2023) ? 2023 : state.years[0];
    state.filters.yearEnd = state.years[state.years.length - 1];
    state.filters.weightMin = state.weightRange.max >= 75 ? 75 : state.weightRange.min;

    elements.search.value = "";
    elements.topn.value = "3";
    elements.country.value = "all";
    elements.yearStart.value = state.filters.yearStart;
    elements.yearEnd.value = state.filters.yearEnd;
    elements.weightMin.value = state.filters.weightMin;
    elements.statTopN.textContent = state.filters.topN;
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
    state.teamToInstitution = index.teamToInstitution;
    state.institutionMeta = index.institutionMeta;
    state.teamMeta = index.teamMeta;
    state.teamCount = index.teamCount;

    state.years = computeYears(data.events);
    setYearOptions(state.years);
    if (state.years.includes(2023)) {
      state.filters.yearStart = 2023;
      elements.yearStart.value = "2023";
    }
    state.weightRange = computeWeightRange(data.events);
    setWeightOptions(state.weightRange);
    if (state.weightRange.max >= 75) {
      state.filters.weightMin = 75;
      elements.weightMin.value = "75";
    }
    setCountryOptions(index.countries);

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
