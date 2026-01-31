# FlixHQ to TMDB Mapper API

A specialized Node.js API that maps movie and TV data between The Movie Database (TMDB) and FlixHQ using advanced string similarity algorithms.

## Features

- **Automated Database Builder:** Includes a CLI tool to scrape and map thousands of items automatically.
- **Smart Matching:** Uses string similarity + year verification to link TMDB IDs to FlixHQ slugs.
- **Instant Cache:** Prioritizes the local `mappings.json` database for sub-millisecond responses.
- **Live Fallback:** If an item isn't cached, it scrapes FlixHQ in real-time.
- **Streaming Ready:** Extracts direct `m3u8` streaming links with required headers.
- **Crowdsourced Skip Times:** Community-driven intro/outro timestamps with voting, outlier detection, and anti-troll protection.

## Installation

```bash
# Clone the repository
git clone https://github.com/staticsenju/flixhq-mapper
cd flixhq-mapper

# Install dependencies
npm install

# Create a .env file and add your keys
echo "TMDB_API_KEY=your_key_here" > .env
echo "ADMIN_KEY=your-secure-admin-key-here" >> .env

# Start the server
npm start

```

## Database Population (Mapper)

The core strength of this API is its ability to build a persistent map between TMDB and FlixHQ. This is handled by `src/mapper.js`.

### How to Run

```bash
npm run map

```

### How it Works

The mapper is an interactive CLI tool that populates `mappings.json`. When you run it:

1. **Interactive Setup:** It asks if you want to map **Movies** or **TV Shows**, and whether to **Resume** from the last ID or **Start Fresh**.
2. **TMDB Iteration:** It loops through TMDB IDs sequentially (e.g., ID 100, 101, 102...).
3. **Cross-Reference:** For every valid TMDB ID, it searches FlixHQ for the exact title.
4. **Verification:** It uses a strict matching algorithm:
* **Exact Match:** Title similarity > 98%.
* **Fuzzy Match:** Title similarity > 90% **AND** Release Year must match.


5. **Save:** Valid matches are appended to `src/mappings.json` instantly.

*Note: The mapper includes a built-in delay (1.2s) to prevent your IP from being rate-limited by FlixHQ.*

## API Endpoints

### Mapping Endpoints

#### Map TMDB ID to FlixHQ

```
GET /map/tmdb/:id

```

Maps a TMDB ID to its corresponding FlixHQ content.

* **Logic:** Checks `mappings.json` first. If found, returns cached data. If not, performs a live scrape.

Parameters:

* `type` (optional): `movie` or `tv`. Default: `movie`

Example:

```
GET /map/tmdb/1399?type=tv

```

#### Reverse Map (FlixHQ to TMDB)

```
GET /map/flix/:slug

```

Maps a known FlixHQ slug back to its TMDB metadata.

Example:

```
GET /map/flix/tv/game-of-thrones-39546

```

### Content & Streaming Endpoints

#### Get Seasons (TV Only)

```
GET /seasons/:slug

```

Returns all available seasons for a TV show slug.

#### Get Episodes

```
GET /episodes/:seasonId

```

Returns all episodes for a specific season ID.

#### Get Streaming Servers

```
GET /servers/:id

```

Get available streaming servers for a movie or episode ID.

#### Get Streaming Sources

```
GET /source/:serverId

```

Returns the actual video source URL (m3u8) for a specific server ID.

**Note:** This endpoint performs the decryption required to get the direct stream.

### Skip Times Endpoints (Crowdsourced)

The Skip Times API provides community-sourced intro/outro timestamps for TV episodes with anti-troll protection through voting, outlier detection, and admin verification.

#### Get Skip Times for Episode

```
GET /skip/:tmdbId/:season/:episode

```

Retrieves the best skip time submission for a specific episode.

* **Filtering:** Only returns submissions with votes > -2
* **Selection:** Returns the submission with the highest vote count

Parameters:

* `tmdbId`: TMDB TV show ID
* `season`: Season number
* `episode`: Episode number

Example:

```
GET /skip/1399/1/1

```

Response:

```json
{
  "found": true,
  "episodeKey": "tmdb_1399_s1_e1",
  "best": {
    "id": "tmdb_1399_s1_e1-1234567890-abc123",
    "intro": { "start": 10, "end": 90 },
    "outro": { "start": 3200, "end": 3280 },
    "votes": 15,
    "verified": false,
    "submittedAt": "2026-01-31T12:00:00.000Z"
  },
  "all": [...]
}

```

#### Submit Skip Times

```
POST /skip/:tmdbId/:season/:episode

```

Submit new intro/outro timestamps for an episode.

* **Outlier Detection:** If 3+ submissions exist, new submissions differing >30 seconds from the average start at -1 votes
* **Smart Baseline:** Uses verified submissions (if any) or highly-voted submissions (≥3 votes) for outlier detection

Request Body:

```json
{
  "intro": { "start": 10, "end": 90 },
  "outro": { "start": 3200, "end": 3280 }
}

```

Response:

```json
{
  "success": true,
  "submission": {
    "id": "tmdb_1399_s1_e1-1234567890-abc123",
    "intro": { "start": 10, "end": 90 },
    "outro": { "start": 3200, "end": 3280 },
    "votes": 0,
    "verified": false,
    "submittedAt": "2026-01-31T12:00:00.000Z"
  }
}

```

#### Vote on Submission

```
POST /skip/vote/:submissionId

```

Upvote or downvote a specific skip time submission.

Request Body:

```json
{
  "vote": "upvote"
}

```

or

```json
{
  "vote": "downvote"
}

```

Response:

```json
{
  "success": true,
  "submission": {
    "id": "tmdb_1399_s1_e1-1234567890-abc123",
    "votes": 16,
    ...
  }
}

```

#### Admin Verify Submission

```
POST /skip/admin/verify/:submissionId

```

Mark a submission as verified (admin only). Verified submissions become the baseline for outlier detection.

* **Auth Required:** Must include `ADMIN_KEY` from `.env` in request body

Request Body:

```json
{
  "adminKey": "your-secure-admin-key-here"
}

```

Response:

```json
{
  "success": true,
  "message": "Submission verified",
  "submission": {
    "verified": true,
    ...
  }
}

```

**Anti-Troll Protection:**

* Vote Filtering: Submissions with ≤-2 votes excluded from results
* Outlier Detection: >30s deviation from average starts at -1 votes
* Smart Baseline: Uses verified or highly-voted (≥3) submissions only
* Admin Verification: Lock in accurate timestamps as truth baseline

### Discovery Endpoints

#### Get Latest Movies/TV

```
GET /movies?page=1
GET /tv-shows?page=1

```

Returns the latest content from FlixHQ.

#### Search

```
GET /filter

```

Search or filter content.

Parameters:

* `type`: Category to filter (e.g., `movie`, `tv`)
* `value`: The search term or filter value
* `page`: Page number

Example:

```
GET /filter?type=search&value=batman&page=1

```

## Handling 403 Errors

When accessing the streaming URLs returned by `/source/:serverId`, you **must** include the proper headers. The streams are protected by Referer checks.

### Required Headers for Streaming

```
Referer: [https://flixhq.to/](https://flixhq.to/)
User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ...

```

### Example Implementation (Video.js)

```javascript
const player = videojs('my-player', {
  html5: {
    hls: {
      overrideNative: true,
      xhr: {
        beforeRequest: function(options) {
          options.headers = {
            ...options.headers,
            'Referer': '[https://flixhq.to/](https://flixhq.to/)'
          };
          return options;
        }
      }
    }
  }
});

```

## Response Format Examples

### Mapping Response

```json
{
  "found": true,
  "tmdb_id": 1399,
  "tmdb_title": "Game of Thrones",
  "type": "tv",
  "flix_slug": "tv/game-of-thrones-39546",
  "flix_id": "39546",
  "flix_title": "Game of Thrones",
  "flix_year": 2011,
  "flix_url": "[https://flixhq.to/tv/game-of-thrones-39546](https://flixhq.to/tv/game-of-thrones-39546)",
  "source": "cache" 
}

```

### Source Response

```json
{
  "found": true,
  "server_id": "12345",
  "source": "[https://url.to/master.m3u8](https://url.to/master.m3u8)",
  "type": "hls",
  "encrypted": false
}

```

## Dependencies

* Express.js - Web framework
* flixhq-api - Core scraping logic
* string-similarity - Fuzzy matching algorithms
* axios - HTTP requests
* lowdb - Lightweight JSON database with better concurrency handling

```

```
