import puppeteer from 'puppeteer';
import fs from 'fs';
import { createClient } from '@supabase/supabase-js';
import 'dotenv/config';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

async function coutrywise_export() {
  const browser = await puppeteer.launch({ 
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-popup-blocking']
  });
  const page = await browser.newPage();

  // Prevent new tabs from opening
  await page.evaluateOnNewDocument(() => {
    window.open = function() {
      return window;
    };
  });

  await page.setViewport({ width: 1366, height: 768 });
  await page.setDefaultNavigationTimeout(60000);
  
  await page.goto('https://tradestat.commerce.gov.in/eidb/country_wise_all_commodities_export', {
    waitUntil: 'networkidle2'
  });

  const jsonData = JSON.parse(fs.readFileSync('newCountries.json', 'utf8'));
  
  const waitForLivewireUpdate = () =>
    page.waitForResponse(response =>
      response.url().includes('/livewire/update') &&
      response.status() === 200
    );

  for (let item of jsonData) {
    let value = item;
    const [countryCode, countryNameRaw] = item.split(',');
    const countryName = countryNameRaw.trim().replace(/\s+/g, '_');
    
    const countryData = {
      countryCode,
      countryName: countryNameRaw.trim(),
      data: {}
    };

    console.log("Processing : ", item);

    for (let j = 4; j <= 6; j = j + 2) {
      for (let i = 2021; i <= 2024; i++) {
        try {
          // Refresh page for each year
          await page.goto('https://tradestat.commerce.gov.in/eidb/country_wise_all_commodities_export', {
            waitUntil: 'networkidle2'
          });
          
          await page.waitForSelector('#EidbYearcwace', { timeout: 10000 });
          await page.waitForSelector('#EidbCntcwace', { timeout: 10000 });
          await page.waitForSelector('#EidbReportcwace', { timeout: 10000 });
          await page.waitForSelector('#EidbComLevelcwace', { timeout: 10000 });

          // Select year
          await page.evaluate((year) => {
            document.querySelector('#EidbYearcwace').value = year;
            document.querySelector('#EidbYearcwace').dispatchEvent(new Event('change'));
          }, i.toString());
          // await waitForLivewireUpdate();

          // Select country
          await page.evaluate((country) => {
            document.querySelector('#EidbCntcwace').value = country;
            document.querySelector('#EidbCntcwace').dispatchEvent(new Event('change'));
          }, value);
          // await waitForLivewireUpdate();

          // Select report type
          await page.select('#EidbReportcwace', '1');
          // await waitForLivewireUpdate();

          // Select commodity level
          await page.evaluate((level) => {
            document.querySelector('#EidbComLevelcwace').value = level;
            document.querySelector('#EidbComLevelcwace').dispatchEvent(new Event('change'));
          }, j.toString());
          // await waitForLivewireUpdate();
          
          const buttons = await page.$$('button');
          if (buttons.length >= 3) {
            await buttons[1].click();
          } else {
            console.log('Less than 3 buttons found on the page.');
          }

          await new Promise(resolve => setTimeout(resolve, 10000));

          // Wait for table
          await page.waitForSelector('table.table-bordered.table-striped', { timeout: 15000 });

          const { yearLabels, rowsData } = await page.evaluate(() => {
            const table = document.querySelector('table.table-bordered.table-striped');
            const headerRow = table.querySelectorAll('tr')[1];
            const headers = Array.from(headerRow.querySelectorAll('th')).map(th => th.innerText.trim());

            const yearLabels = headers.slice(3, 5);
            const rowElements = Array.from(table.querySelectorAll('tr')).slice(2);

            const rowsData = rowElements.map(row => {
              const cells = row.querySelectorAll('td');
              if (cells.length >= 5) {
                return {
                  hscode: cells[1].innerText.trim(),
                  commodity: cells[2].innerText.trim(),
                  values: {
                    [yearLabels[0]]: cells[3].innerText.trim(),
                    [yearLabels[1]]: cells[4].innerText.trim()
                  }
                };
              }
              return null;
            }).filter(Boolean);

            return { yearLabels, rowsData };
          });

          if (!countryData.data[j]) {
            countryData.data[j] = [];
          }

          rowsData.forEach(newEntry => {
            const existingEntry = countryData.data[j].find(
              e => e.hscode === newEntry.hscode && e.commodity === newEntry.commodity
            );

            if (existingEntry) {
              Object.assign(existingEntry.values, newEntry.values);
            } else {
              countryData.data[j].push(newEntry);
            }
          });

        } catch (error) {
          console.error(`Error processing ${countryNameRaw.trim()} - Year ${i} - Level ${j}:`, error);
          continue;
        }
      }
    }

    console.log(`✅ Completed processing for country: ${countryName}`);
    
    const supabaseCountryName = countryNameRaw.trim().toUpperCase().replace(/\s+/g, '_');
    
    for (const level of [4, 6]) {
      if (countryData.data[level]) {
        for (const commodity of countryData.data[level]) {
          const hsnCode = parseInt(commodity.hscode);
          if (isNaN(hsnCode)) continue;
          
          const countryDataJson = commodity.values;
          
          try {
            // Check if the HSN code exists
            const { data: existingRecord, error: fetchError } = await supabase
              .from('market_prices')
              .select('hsn_code')
              .eq('hsn_code', hsnCode)
              .single();
            
            if (fetchError && fetchError.code !== 'PGRST116') { // Ignore "not found" error
              throw fetchError;
            }
            
            if (existingRecord) {
              // Update existing record
              const { error: updateError } = await supabase
                .from('market_prices')
                .update({ [supabaseCountryName]: countryDataJson })
                .eq('hsn_code', hsnCode);
              
              if (updateError) throw updateError;
              console.log(`Updated record for HSN ${hsnCode} - ${supabaseCountryName}`);
            } else {
              // Insert new record
              const { error: insertError } = await supabase
                .from('market_prices')
                .insert({ 
                  hsn_code: hsnCode,
                  [supabaseCountryName]: countryDataJson 
                });
              
              if (insertError) throw insertError;
              console.log(`Created new record for HSN ${hsnCode} - ${supabaseCountryName}`);
            }
          } catch (error) {
            console.error(`Error updating Supabase for HSN ${hsnCode} - ${supabaseCountryName}:`, error);
          }
        }
      }
    }
    
    console.log(`✅ Completed Supabase insertion for country: ${countryName}`);
  }

  await browser.close();
}

coutrywise_export();