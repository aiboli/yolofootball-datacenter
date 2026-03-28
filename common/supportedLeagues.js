const SUPPORTED_LEAGUES = [
  {
    key: "premier-league",
    country: "England",
    name: "Premier League",
  },
  {
    key: "la-liga",
    country: "Spain",
    name: "La Liga",
  },
  {
    key: "ligue-1",
    country: "France",
    name: "Ligue 1",
  },
  {
    key: "bundesliga",
    country: "Germany",
    name: "Bundesliga",
  },
  {
    key: "serie-a",
    country: "Italy",
    name: "Serie A",
  },
  {
    key: "j1-league",
    country: "Japan",
    name: "J1 League",
  },
  {
    key: "k-league-1",
    country: "South-Korea",
    name: "K League 1",
  },
  {
    key: "chinese-super-league",
    country: "China",
    name: "Super League",
  },
];

const normalizeText = (value) =>
  String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const buildLeagueLookupKey = ({ country, name } = {}) =>
  `${normalizeText(country)}::${normalizeText(name)}`;

const supportedLeagueLookup = new Set(
  SUPPORTED_LEAGUES.map((league) => buildLeagueLookupKey(league))
);

const isSupportedLeagueMeta = (leagueMeta) =>
  supportedLeagueLookup.has(buildLeagueLookupKey(leagueMeta));

const isSupportedLeagueEntry = (entry) =>
  isSupportedLeagueMeta({
    country: entry?.league?.country,
    name: entry?.league?.name,
  });

const filterSupportedLeagueEntries = (entries = []) =>
  entries.filter((entry) => isSupportedLeagueEntry(entry));

module.exports = {
  SUPPORTED_LEAGUES,
  isSupportedLeagueMeta,
  isSupportedLeagueEntry,
  filterSupportedLeagueEntries,
};
