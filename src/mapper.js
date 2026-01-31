require('dotenv').config();
const fs = require('fs');
const axios = require('axios');
const readline = require('readline');
const stringSimilarity = require('string-similarity');
const FlixHQ = require('flixhq-api');

const TMDB_API_KEY = process.env.TMDB_API_KEY;
const DATA_FILE = 'mappings.json';
const DELAY_MS = 1200;

const flix = new FlixHQ();

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

let mappings = [];
try {
  if (fs.existsSync(DATA_FILE)) {
    mappings = JSON.parse(fs.readFileSync(DATA_FILE));
  }
} catch (e) {
  console.error("Error loading cache");
}

const ask = (query) => new Promise((resolve) => rl.question(query, resolve));

async function getTmdb(id, type) {
  try {
    const url = `https://api.themoviedb.org/3/${type}/${id}?api_key=${TMDB_API_KEY}`;
    const { data } = await axios.get(url);
    return {
      id: data.id,
      title: type === 'movie' ? data.title : data.name,
      year: parseInt((data.release_date || data.first_air_date || '').substring(0, 4)),
      popularity: data.popularity,
      status: data.status 
    };
  } catch (e) {
    if (e.response && e.response.status === 404) return null; 
    return 'error';
  }
}

async function findMatch(meta, type) {
  const candidates = await flix.search(meta.title);
  
  return candidates.find(c => {
    if (c.type !== type) return false;

    const score = stringSimilarity.compareTwoStrings(c.title.toLowerCase(), meta.title.toLowerCase());
    
    const yearMatch = (c.year === meta.year) || (c.year === meta.year - 1) || (c.year === meta.year + 1) || (c.year === null);

    if (score > 0.98) return true; 
    if (score > 0.90 && yearMatch) return true; 
    
    return false;
  });
}

async function main() {
  console.log('\n--- FlixHQ Bulk Mapper ---\n');

  console.log('1. Start from ID 1 (Fill Gaps)');
  console.log('2. Start from Latest Mapped ID (Resume)');
  const modeAns = await ask('Select Mode [1/2]: ');
  const mode = modeAns.trim() === '2' ? 'latest' : 'one';

  console.log('\n1. Movies');
  console.log('2. TV Shows');
  const typeAns = await ask('Select Content Type [1/2]: ');
  const type = typeAns.trim() === '2' ? 'tv' : 'movie';

  let currentId = 1;
  
  if (mode === 'latest') {
    const typeIds = mappings
      .filter(m => m.type === type)
      .map(m => m.tmdb_id)
      .sort((a, b) => a - b);
    
    if (typeIds.length > 0) {
      const maxId = typeIds[typeIds.length - 1];
      console.log(`\nFound ${typeIds.length} mapped ${type}s.`);
      console.log(`Latest ID is ${maxId}. Resuming from ${maxId + 1}...`);
      currentId = maxId + 1;
    } else {
      console.log(`\nNo mapped ${type}s found. Starting from 1.`);
    }
  } else {
    console.log(`\nStarting fresh from ID 1...`);
  }

  rl.close(); 

  console.log(`\n[System] Starting Crawler: ${type.toUpperCase()} from ID ${currentId}`);
  console.log(`[System] Delay set to ${DELAY_MS}ms to prevent IP bans.\n`);

  while (true) {
    try {
      const exists = mappings.find(m => m.tmdb_id === currentId && m.type === type);
      if (exists) {
        currentId++;
        continue; 
      }

      const meta = await getTmdb(currentId, type);

      if (meta === null) {
      } else if (meta === 'error') {
        console.log(`[Error] TMDB API Error on ID ${currentId}. Retrying in 5s...`);
        await new Promise(r => setTimeout(r, 5000));
        continue; 
      } else {
        const label = `[${type.toUpperCase()}] ${currentId.toString().padEnd(7)} | ${meta.title.substring(0, 30).padEnd(30)} | ${meta.year || '----'}`;

        if (meta.popularity < 0.6) {
          console.log(`${label} | SKIP (Low Pop: ${meta.popularity})`);
        } else {
          const match = await findMatch(meta, type);

          if (match) {
            console.log(`${label} | ✅ MATCH: ${match.slug}`);
            
            const details = await flix.getDetails(match.slug);
            
            const newEntry = {
              tmdb_id: currentId,
              tmdb_title: meta.title,
              type: type,
              flix_slug: match.slug,
              flix_id: details ? details.id : match.slug.split('-').pop(),
              flix_title: match.title,
              flix_year: match.year || meta.year,
              flix_url: `${flix.baseUrl}/${match.slug}`,
              description: details ? details.description : '',
              released: details ? details.released : '',
              genres: details ? details.genres : [],
              poster: details ? details.poster : match.poster
            };

            mappings.push(newEntry);
            fs.writeFileSync(DATA_FILE, JSON.stringify(mappings, null, 2));
          } else {
            console.log(`${label} | ❌ No Match`);
          }
          
          await new Promise(r => setTimeout(r, DELAY_MS));
        }
      }

      currentId++;

    } catch (err) {
      console.error(`[Fatal] Crash on ID ${currentId}:`, err.message);
      await new Promise(r => setTimeout(r, 2000));
    }
  }
}

main();
