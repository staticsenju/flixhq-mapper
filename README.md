# FlixHQ to TMDB Mapper API

A specialized Node.js API that maps movie and TV data between The Movie Database (TMDB) and FlixHQ using advanced string similarity algorithms.

## Features

- Map TMDB IDs to FlixHQ content automatically
- Advanced string similarity analysis with year verification
- Reverse mapping (FlixHQ Slug -> TMDB ID)
- Get streaming links with required headers
- Fetch seasons and episodes for TV shows
- Built-in caching system (`mappings.json`) to speed up requests

## Installation

```bash
# Clone the repository
git clone [https://github.com/yourusername/flixhq-mapper.git](https://github.com/yourusername/flixhq-mapper.git)
cd flixhq-mapper

# Install dependencies
npm install

# Create a .env file and add your TMDB Key
echo "TMDB_API_KEY=your_key_here" > .env

# Start the server
npm start

```

## API Endpoints

### Mapping Endpoints

#### Map TMDB ID to FlixHQ

```
GET /map/tmdb/:id

```

Maps a TMDB ID to its corresponding FlixHQ content. It checks the local cache first; if missing, it scrapes FlixHQ live.

Parameters:

* `type` (optional): Content type (`movie` or `tv`). Default: `movie`

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

Parameters:

* `type` (optional): `movie` or `tv`. Default: `tv`

#### Get Streaming Sources

```
GET /source/:serverId

```

Returns the actual video source URL (m3u8) for a specific server ID.

**Note:** This endpoint performs the decryption required to get the direct stream.

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
User-Agent: Mozilla/5.0 ... (Standard Browser UA)

```

### Example Implementation

```javascript
// Video.js player example
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

## Mapping Approach

The API uses a rigorous matching process to ensure accuracy:

1. **Cache Check:** Checks `mappings.json` for instant results.
2. **TMDB Lookup:** Fetches official metadata (Title, Year) from TMDB.
3. **FlixHQ Search:** Searches FlixHQ for the exact title.
4. **Similarity Scoring:**
* Strict type matching (Movie vs TV).
* String similarity score > 0.95 (Exact match).
* String similarity score > 0.85 + Year match (Fuzzy match).



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
  "source": "live"
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

