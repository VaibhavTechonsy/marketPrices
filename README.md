# marketprice.js - Country-Wise Export Data Scraper
This script uses Puppeteer to scrape country-wise export data from the Indian government's TradeStat portal, processes it for multiple years and commodity levels, and stores the structured output in a Supabase database.

## Requirements

- Node.js v20.18+
- Supabase project (with tables: `market_prices`)
- `.env` file containing: supabase credits

## Setup

1. Clone this repository or download the script.

2. Install dependencies:
   npm install

3. Create a .env file in the root folder with the following environment variables:
SUPABASE_URL=your-supabase-url SUPABASE_KEY=your-supabase-key

4. Ensure countries.json exists in the root directory and follows this structure:
  ["002,Afghanistan", "003,Albania", ...]


**How to Run**
  node marketprice.js


**What It Does**
  1. Launches Puppeteer and navigates to the TradeStat country-wise export data page (https://tradestat.commerce.gov.in/eidb/country_wise_all_commodities_export).
  2. Loops through countries and years (2021–2024) for commodity levels 4 and 6.
  3. Scrapes table data for each combination of year and level.
  4. Parses rows to extract:
    - HSN code
    - Commodity name
    - Export values for 2 years at a time
  5. Upserts this structured data into Supabase:
    - If HSN exists: update the corresponding country column.
    - Else: insert a new record.


**Notes**
  1. Designed to avoid popups and handle slow networks with increased timeouts.
  2. Automatically avoids duplicates by matching hsn_code and commodity before insert/update.
  3. Skips records with invalid/non-numeric HSN codes.
