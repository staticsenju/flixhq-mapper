require('dotenv').config();
const express = require('express');
const fs = require('fs');
const cors = require('cors');
const axios = require('axios');
const stringSimilarity = require('string-similarity');
const FlixHQ = require('flixhq-api');
const low = require('lowdb');
const FileSync = require('lowdb/adapters/FileSync');

const app = express();
const PORT = 3000;
if (!fs.existsSync('src')) {
  fs.mkdirSync('src');
}

const TMDB_API_KEY = process.env.TMDB_API_KEY;
const ADMIN_KEY = process.env.ADMIN_KEY || 'change-me-in-production';

const mappingsAdapter = new FileSync('src/mappings.json');
const db = low(mappingsAdapter);
db.defaults({ mappings: [] }).write();

const skipAdapter = new FileSync('src/skiptimes.json');
const skipDb = low(skipAdapter);
skipDb.defaults({ episodes: {} }).write();

const flix = new FlixHQ();

app.use(cors());
app.use(express.json());

console.log(`[System] Loaded ${db.get('mappings').size().value()} mappings.`);
console.log(`[System] Loaded skip times for ${Object.keys(skipDb.get('episodes').value()).length} episodes.`);

async function getTmdbMetadata(id, type) {
  try {
    const url = `https://api.themoviedb.org/3/${type}/${id}?api_key=${TMDB_API_KEY}`;
    const { data } = await axios.get(url);
    return {
      title: type === 'movie' ? data.title : data.name,
      year: parseInt((data.release_date || data.first_air_date || '').substring(0, 4)),
    };
  } catch (e) { return null; }
}

async function searchTmdb(title, year, type) {
  try {
    const url = `https://api.themoviedb.org/3/search/${type}?api_key=${TMDB_API_KEY}&query=${encodeURIComponent(title)}`;
    const { data } = await axios.get(url);
    return data.results.find(r => {
      const rYear = parseInt((r.release_date || r.first_air_date || '').substring(0, 4));
      return rYear === year || rYear === year - 1 || rYear === year + 1;
    });
  } catch (e) { return null; }
}

async function findBestMatch(tmdbMeta, type) {
  const candidates = await flix.search(tmdbMeta.title);
  return candidates.find(c => {
    if (c.type !== type) return false;
    const score = stringSimilarity.compareTwoStrings(c.title.toLowerCase(), tmdbMeta.title.toLowerCase());
    const yearMatch = (c.year === tmdbMeta.year) || (c.year === null);
    if (score > 0.95) return true;
    if (score > 0.85 && yearMatch) return true;
    return false;
  });
}

app.get('/home', async (req, res) => {
  console.log('[Home] Fetching homepage data...');
  const data = await flix.fetchHome();
  res.json(data);
});

app.get('/movies', async (req, res) => {
  const page = req.query.page || 1;
  console.log(`[Movies] Fetching page ${page}...`);
  const data = await flix.fetchMovies(page);
  res.json(data);
});

app.get('/tv-shows', async (req, res) => {
  const page = req.query.page || 1;
  console.log(`[TV] Fetching page ${page}...`);
  const data = await flix.fetchTVShows(page);
  res.json(data);
});

app.get('/top-imdb', async (req, res) => {
  const type = req.query.type || 'all';
  const page = req.query.page || 1;
  console.log(`[Top IMDB] Type: ${type}, Page: ${page}`);
  const data = await flix.fetchTopIMDB(type, page);
  res.json(data);
});

app.get('/genres', async (req, res) => {
  console.log('[Genres] Fetching list...');
  const genres = await flix.fetchGenres();
  res.json(genres);
});

app.get('/countries', async (req, res) => {
  console.log('[Countries] Fetching list...');
  const countries = await flix.fetchCountries();
  res.json(countries);
});

app.get('/filters', async (req, res) => {
  console.log('[Filters] Fetching options...');
  const filters = await flix.fetchFilters();
  res.json(filters);
});

app.get('/filter', async (req, res) => {
  const { type, value, page } = req.query;
  console.log(`[Filter] ${type}=${value} Page=${page || 1}`);
  if (!type || !value) return res.status(400).json({ error: "Missing type or value" });
  const results = await flix.filter(type, value, page || 1);
  res.json(results);
});

app.get('/getlatest', (req, res) => {
  const type = req.query.type;
  const mappings = db.get('mappings').value();

  if (!mappings || mappings.length === 0) {
    return res.json({ id: 0, found: false });
  }

  const ids = mappings.map(m => m.tmdb_id).sort((a, b) => a - b);

  if (type === 'ascending') {
    return res.json({ id: ids[0] });
  }

  if (type === 'descending') {
    let lastSeq = ids[0];
    for (let i = 0; i < ids.length - 1; i++) {
      if (ids[i+1] !== ids[i] + 1) {
        break;
      }
      lastSeq = ids[i+1];
    }
    return res.json({ id: lastSeq });
  }

  return res.json({ id: ids[ids.length - 1] });
});

app.get('/servers/:id', async (req, res) => {
  const { id } = req.params;
  const { type } = req.query;
  console.log(`[Servers] Fetching for ID: ${id} (Type: ${type})`);
  const servers = await flix.getServers(id, type || 'tv');
  res.json({ found: servers.length > 0, id, type, servers });
});

app.get('/map/tmdb/:id', async (req, res) => {
  const tmdbId = parseInt(req.params.id);
  const type = req.query.type || 'movie';

  const match = db.get('mappings').find({ tmdb_id: tmdbId, type }).value();

  if (match) {
    return res.json({ found: true, ...match, source: 'cache' });
  }

  console.log(`[Mapper] Searching for TMDB ID: ${tmdbId} (${type})`);
  const tmdbMeta = await getTmdbMetadata(tmdbId, type);

  if (!tmdbMeta) return res.status(404).json({ found: false, error: "Invalid TMDB ID" });

  const bestMatch = await findBestMatch(tmdbMeta, type);

  if (bestMatch) {
    console.log(`[Mapper] Match found (${bestMatch.title}). Fetching details...`);
    const details = await flix.getDetails(bestMatch.slug);

    let finalYear = bestMatch.year;
    if (!finalYear && details.released) {
      finalYear = parseInt(details.released.substring(0, 4)) || null;
    }

    const newEntry = {
      tmdb_id: tmdbId,
      tmdb_title: tmdbMeta.title,
      type: type,
      flix_slug: bestMatch.slug,
      flix_id: bestMatch.slug.split('-').pop(),
      flix_title: bestMatch.title,
      flix_year: finalYear,
      flix_url: `${flix.baseUrl}/${bestMatch.slug}`,
      description: details.description,
      released: details.released,
      genres: details.genres
    };

    db.get('mappings').push(newEntry).write();

    return res.json({ found: true, ...newEntry, source: 'live' });
  }

  return res.status(404).json({ found: false, error: "Not found on FlixHQ" });
});

app.get(/\/map\/flix\/(.+)/, async (req, res) => {
  const slug = req.params[0];

  const match = db.get('mappings').find({ flix_slug: slug }).value();
  if (match) {
    return res.json({ found: true, ...match, source: 'cache' });
  }

  console.log(`[Reverse Map] Scraping details for slug: ${slug}`);
  const details = await flix.getDetails(slug);

  if (!details) {
    return res.status(404).json({ found: false, error: "FlixHQ content not found" });
  }

  const type = slug.includes('movie/') ? 'movie' : 'tv';

  console.log(`[Reverse Map] Searching TMDB for: ${details.title} (${details.year})`);
  const tmdbResult = await searchTmdb(details.title, details.year, type);

  if (tmdbResult) {
    const newEntry = {
      tmdb_id: tmdbResult.id,
      tmdb_title: type === 'movie' ? tmdbResult.title : tmdbResult.name,
      type: type,
      flix_slug: slug,
      flix_id: details.id,
      flix_title: details.title,
      flix_year: details.year,
      flix_url: `${flix.baseUrl}/${slug}`,
      description: details.description,
      released: details.released,
      genres: details.genres
    };

    db.get('mappings').push(newEntry).write();

    return res.json({ found: true, ...newEntry, source: 'live_reverse' });
  }

  return res.status(404).json({ found: false, error: "TMDB match not found for this FlixHQ content" });
});

app.get(/\/seasons\/(.+)/, async (req, res) => {
  const slug = req.params[0];
  if (!slug || !slug.includes('tv/')) return res.status(400).json({ error: "Invalid TV slug." });

  console.log(`[Seasons] Request for: ${slug}`);
  const seasons = await flix.getSeasons(slug);
  res.json({ found: seasons.length > 0, slug, total: seasons.length, seasons });
});

app.get('/episodes/:seasonId', async (req, res) => {
  const { seasonId } = req.params;
  console.log(`[Episodes] Request for Season ID: ${seasonId}`);
  const episodes = await flix.getEpisodes(seasonId);
  res.json({ found: episodes.length > 0, season_id: seasonId, total: episodes.length, episodes });
});

app.get('/source/:serverId', async (req, res) => {
  const { serverId } = req.params;
  console.log(`[Source] Fetching stream for server ID: ${serverId}`);

  const sourceData = await flix.fetchSource(serverId);

  if (sourceData) {
    res.json({ found: true, server_id: serverId, ...sourceData });
  } else {
    res.status(500).json({ found: false, error: "Failed to extract video source. Key extraction might be outdated." });
  }
});

function parseTime(value) {
  if (typeof value === 'number') {
    return value;
  }

  if (typeof value === 'string') {
    const parts = value.split(':');

    if (parts.length === 3) {
      const hours = parseInt(parts[0]) || 0;
      const minutes = parseInt(parts[1]) || 0;
      const seconds = parseInt(parts[2]) || 0;
      return hours * 3600 + minutes * 60 + seconds;
    }

    if (parts.length === 2) {
      const minutes = parseInt(parts[0]) || 0;
      const seconds = parseInt(parts[1]) || 0;
      return minutes * 60 + seconds;
    }

    const num = parseFloat(value);
    if (!isNaN(num)) {
      return num;
    }
  }

  return null;
}

app.get('/skip/:tmdbId/:season/:episode', (req, res) => {
  const { tmdbId, season, episode } = req.params;
  const episodeKey = `tmdb_${tmdbId}_s${season}_e${episode}`;

  const submissions = skipDb.get(`episodes.${episodeKey}`).value() || [];

  const filtered = submissions.filter(s => s.votes > -2);

  if (filtered.length === 0) {
    return res.json({ found: false, episodeKey, submissions: [] });
  }

  const best = filtered.reduce((max, current) => current.votes > max.votes ? current : max);

  res.json({ found: true, episodeKey, best, all: filtered });
});

app.post('/skip/:tmdbId/:season/:episode', (req, res) => {
  const { tmdbId, season, episode } = req.params;
  const { intro, outro } = req.body;

  if (!intro || !outro || intro.start == null || intro.end == null ||
      outro.start == null || outro.end == null) {
    return res.status(400).json({ error: "Missing intro or outro timestamps" });
  }

  const introStart = parseTime(intro.start);
  const introEnd = parseTime(intro.end);
  const outroStart = parseTime(outro.start);
  const outroEnd = parseTime(outro.end);

  if (introStart === null || introEnd === null || outroStart === null || outroEnd === null) {
    return res.status(400).json({
      error: "Invalid time format. Use seconds (90) or time string ('00:01:30')"
    });
  }

  if (introStart < 0 || introEnd < 0 || outroStart < 0 || outroEnd < 0) {
    return res.status(400).json({ error: "Time values cannot be negative" });
  }

  if (introStart >= introEnd || outroStart >= outroEnd) {
    return res.status(400).json({ error: "Start time must be before end time" });
  }

  const normalizedIntro = { start: introStart, end: introEnd };
  const normalizedOutro = { start: outroStart, end: outroEnd };

  const episodeKey = `tmdb_${tmdbId}_s${season}_e${episode}`;

  const submissions = skipDb.get(`episodes.${episodeKey}`).value() || [];
  let initialVotes = 0;

  const verifiedSubs = submissions.filter(s => s.verified);
  const usableForAvg = verifiedSubs.length >= 1 ? verifiedSubs : submissions.filter(s => s.votes >= 3);

  if (usableForAvg.length >= 3) {
    const avgIntroStart = usableForAvg.reduce((sum, s) => sum + s.intro.start, 0) / usableForAvg.length;
    const avgIntroEnd = usableForAvg.reduce((sum, s) => sum + s.intro.end, 0) / usableForAvg.length;
    const avgOutroStart = usableForAvg.reduce((sum, s) => sum + s.outro.start, 0) / usableForAvg.length;
    const avgOutroEnd = usableForAvg.reduce((sum, s) => sum + s.outro.end, 0) / usableForAvg.length;

    const isOutlier =
      Math.abs(normalizedIntro.start - avgIntroStart) > 30 ||
      Math.abs(normalizedIntro.end - avgIntroEnd) > 30 ||
      Math.abs(normalizedOutro.start - avgOutroStart) > 30 ||
      Math.abs(normalizedOutro.end - avgOutroEnd) > 30;

    if (isOutlier) {
      initialVotes = -1;
    }
  }

  const submissionId = `${episodeKey}-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

  const newSubmission = {
    id: submissionId,
    intro: normalizedIntro,
    outro: normalizedOutro,
    votes: initialVotes,
    verified: false,
    submittedAt: new Date().toISOString()
  };

  if (!skipDb.has(`episodes.${episodeKey}`).value()) {
    skipDb.set(`episodes.${episodeKey}`, []).write();
  }

  skipDb.get(`episodes.${episodeKey}`)
    .push(newSubmission)
    .write();

  res.json({ success: true, submission: newSubmission });
});

app.post('/skip/vote/:submissionId', (req, res) => {
  const { submissionId } = req.params;
  const { vote } = req.body;

  if (vote !== 'upvote' && vote !== 'downvote') {
    return res.status(400).json({ error: "Invalid vote type" });
  }

  let found = false;
  let updatedSubmission = null;
  const episodes = skipDb.get('episodes').value();

  for (const episodeKey in episodes) {
    const submission = skipDb.get(`episodes.${episodeKey}`).find({ id: submissionId }).value();
    if (submission) {
      skipDb.get(`episodes.${episodeKey}`)
        .find({ id: submissionId })
        .assign({ votes: submission.votes + (vote === 'upvote' ? 1 : -1) })
        .write();

      updatedSubmission = skipDb.get(`episodes.${episodeKey}`).find({ id: submissionId }).value();
      found = true;
      break;
    }
  }

  if (!found) {
    return res.status(404).json({ error: "Submission not found" });
  }

  res.json({ success: true, submission: updatedSubmission });
});

app.post('/skip/admin/verify/:submissionId', (req, res) => {
  const { submissionId } = req.params;
  const { adminKey } = req.body;

  if (adminKey !== ADMIN_KEY) {
    return res.status(403).json({ error: "Invalid admin key" });
  }

  let found = false;
  let updatedSubmission = null;
  const episodes = skipDb.get('episodes').value();

  for (const episodeKey in episodes) {
    const submission = skipDb.get(`episodes.${episodeKey}`).find({ id: submissionId }).value();
    if (submission) {
      skipDb.get(`episodes.${episodeKey}`)
        .find({ id: submissionId })
        .assign({ verified: true })
        .write();

      updatedSubmission = skipDb.get(`episodes.${episodeKey}`).find({ id: submissionId }).value();
      found = true;
      break;
    }
  }

  if (!found) {
    return res.status(404).json({ error: "Submission not found" });
  }

  res.json({ success: true, message: "Submission verified", submission: updatedSubmission });
});

app.delete('/skip/admin/purge/:tmdbId/:season/:episode', (req, res) => {
  const { tmdbId, season, episode } = req.params;
  const { adminKey } = req.body;

  if (adminKey !== ADMIN_KEY) {
    return res.status(403).json({ error: "Invalid admin key" });
  }

  const episodeKey = `tmdb_${tmdbId}_s${season}_e${episode}`;
  const submissions = skipDb.get(`episodes.${episodeKey}`).value();

  if (!submissions) {
    return res.status(404).json({ error: "Episode not found" });
  }

  const count = submissions.length;
  skipDb.unset(`episodes.${episodeKey}`).write();

  res.json({
    success: true,
    message: `Purged ${count} submission(s) for ${episodeKey}`,
    episodeKey,
    count
  });
});

app.delete('/skip/admin/purge-all', (req, res) => {
  const { adminKey } = req.body;

  if (adminKey !== ADMIN_KEY) {
    return res.status(403).json({ error: "Invalid admin key" });
  }

  const episodes = skipDb.get('episodes').value();
  const episodeCount = Object.keys(episodes).length;
  let totalSubmissions = 0;

  for (const episodeKey in episodes) {
    totalSubmissions += episodes[episodeKey].length;
  }

  skipDb.set('episodes', {}).write();

  res.json({
    success: true,
    message: "All skip times purged",
    episodesPurged: episodeCount,
    submissionsPurged: totalSubmissions
  });
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
