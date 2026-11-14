# GeoRush v0.1

A five-round daily locality game. This is the first implementation foundation, not yet a public competitive release.

## What is included

- Five 25-second rounds; scoring is 1, 1, 3, 3, 5 points per accepted locality.
- Country-by-country locality files generated from **all GeoNames records with feature class `P`** (not the population-limited `cities15000` subset).
- ASCII/transliterated names from the main GeoNames extract and non-historic, non-colloquial English alternate names from `alternateNamesV2`.
- Exact normalized matching and conservative edit-distance typo tolerance; accepted aliases map back to GeoNames IDs to prevent duplicate scoring.
- Country globe, round HUD, score animation, and compact answer input.
- GitHub Actions workflow to build the dataset on demand and refresh it monthly.

## Important limitations in v0.1

- GeoNames is not a guarantee of every real-world locality; it is the coverage of the GeoNames gazetteer, provided as-is.
- The current country difficulty bands are based on the number of GeoNames populated-place records. They are a first-pass proxy, not calibrated difficulty.
- Answer validation runs in the browser and country data is public. A determined player can inspect it. Do not use this version for prizes or a serious leaderboard.
- A same-name locality ambiguity is intentionally not auto-awarded by fuzzy matching when the closest spelling ties. Exact common names award one unclaimed matching GeoNames ID.
- The globe and its world map data load from public CDNs and require an internet connection.
- No accounts, persistence, cross-player statistics, anti-cheat, or global leaderboard yet.

## Build the GeoNames data

The data builder downloads the official GeoNames files:

- `allCountries.zip`
- `alternateNamesV2.zip`
- `countryInfo.txt`

It writes one JSON file per country/territory plus `public/data/manifest.json`. The raw downloads are cached in `.geonames-cache/` and are not committed.

### Easiest route: GitHub Actions

1. Create a new GitHub repository and upload the contents of this folder.
2. In the repository, open **Actions** and enable workflows if GitHub asks.
3. Select **Build GeoNames data** in the left sidebar.
4. Click **Run workflow** and confirm.
5. Wait for the workflow to finish. It will commit the generated `public/data` files.

The workflow also refreshes the data monthly. It may take several minutes and creates a large set of country JSON files.

### Local route

Requires Python 3.10+ and internet access:

```bash
python scripts/build_geonames.py
```

Then install dependencies and run:

```bash
npm install
npm run dev
```

## Deploy to Vercel

Import the GitHub repository into Vercel. Use the defaults for a Vite project:

- Framework preset: Vite
- Build command: `npm run build`
- Output directory: `dist`

Deploy only after the GeoNames data workflow has completed and `public/data/manifest.json` exists in the repository.

## Attribution

This product uses GeoNames geographical data, available under Creative Commons Attribution 4.0. Credit: [GeoNames](https://www.geonames.org/). GeoNames provides the data as-is without warranty of accuracy, timeliness, or completeness.
