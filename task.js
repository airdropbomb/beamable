console.log(`
 █████╗ ██████╗ ██████╗     ███╗   ██╗ ██████╗ ██████╗ ███████╗
██╔══██╗██╔══██╗██╔══██╗    ████╗  ██║██╔═══██╗██╔══██╗██╔════╝
███████║██║  ██║██████╔╝    ██╔██╗ ██║██║   ██║██║  ██║█████╗  
██╔══██║██║  ██║██╔══██╗    ██║╚██╗██║██║   ██║██║  ██║██╔══╝  
██║  ██║██████╔╝██████╔╝    ██║ ╚████║╚██████╔╝██████╔╝███████╗
╚═╝  ╚═╝╚═════╝ ╚═════╝     ╚═╝  ╚═══╝ ╚═════╝ ╚═════╝ ╚══════╝
by btctrader
`);

const puppeteer = require('puppeteer');
const fs = require('fs').promises;

// Base URL for the quests page
const QUESTS_URL = 'https://hub.beamable.network/modules/questsold';

// Function to read multiple proxies from proxies.txt (Optional)
async function readProxies() {
  try {
    const data = await fs.readFile('proxies.txt', 'utf8');
    const proxies = data.trim().split('\n').map(proxy => proxy.trim()).filter(proxy => proxy);
    console.log(`Found ${proxies.length} proxies in proxies.txt`);
    return proxies;
  } catch (error) {
    if (error.code === 'ENOENT') {
      console.log('proxies.txt not found. Proceeding without proxies.');
      return [];
    }
    console.error('Error reading proxies.txt:', error.message);
    return [];
  }
}

// Function to read multiple tokens from token.txt
async function readTokens() {
  try {
    const data = await fs.readFile('token.txt', 'utf8');
    const lines = data.trim().split('\n');
    const accounts = [];

    for (const line of lines) {
      const parts = line.trim().split('=');
      if (parts.length !== 3 || parts[1] !== 'harborSession') {
        console.error(`Invalid token format in line: ${line}. Expected format: username=harborSession=token_value`);
        continue;
      }
      const username = parts[0];
      const token = parts[2];
      if (!token) {
        console.error(`Token is empty for username: ${username}`);
        continue;
      }
      accounts.push({ username, token });
      console.log(`Found account - Username: ${username}, Token: ${token}`);
    }

    if (accounts.length === 0) {
      throw new Error('No valid accounts found in token.txt');
    }

    console.log(`Total accounts found: ${accounts.length}`);
    return accounts;
  } catch (error) {
    console.error('Error reading token.txt:', error.message);
    throw new Error('Failed to read tokens');
  }
}

// Function to fetch unclaimed quests using Puppeteer
async function fetchUnclaimedQuests(token, proxy = null) {
  const browserArgs = [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
  ];
  if (proxy) {
    browserArgs.push(`--proxy-server=${proxy}`);
    console.log(`Using proxy: ${proxy}`);
  }

  const browser = await puppeteer.launch({
    headless: true,
    executablePath: '/usr/bin/chromium-browser',
    args: browserArgs,
    protocolTimeout: 60000,
  });
  const page = await browser.newPage();

  try {
    await page.setCookie({
      name: 'harbor-session',
      value: token,
      domain: 'hub.beamable.network',
      path: '/',
      httpOnly: true,
      secure: true,
    });

    console.log('Navigating to quests page:', QUESTS_URL);
    await page.goto(QUESTS_URL, { waitUntil: 'networkidle2', timeout: 60000 });

    await new Promise(resolve => setTimeout(resolve, 15000)); // စာမျက်နှာဖွင့်ပြီး စောင့်ဆိုင်းချိန်ကို တိုးပေးထားပါတယ်

    const currentUrl = page.url();
    console.log('Current URL after navigation:', currentUrl);
    if (currentUrl.includes('/onboarding/login')) {
      console.error('Redirected to login page. Token may be invalid or expired.');
      throw new Error('Authentication failed: Redirected to login page');
    }

    const quests = await page.evaluate(() => {
      const questElements = document.querySelectorAll('div.bg-content a[href*="/modules/questsold"]');
      const unclaimedQuests = [];

      console.log(`Found ${questElements.length} potential quest elements`);

      questElements.forEach((element, index) => {
    // Quest ရဲ့ ခေါင်းစဉ်ကို ရှာတယ်
    const titleElement = element.querySelector('a.h3');
    if (!titleElement) {
      console.log(`Quest ${index}: Missing title, skipping`);
      return;
    }
    const title = titleElement.innerText.trim();

        const claimedElement = parent.querySelector('span.p3');
        const isClaimed = claimedElement && claimedElement.innerText.trim().toLowerCase() === 'claimed';

        const claimableButton = parent.querySelector('button[class*="btn-primary-opacity-40"]'); // ဒီမှာ selector ကို ပြောင်းထားပါတယ်
        const isClaimable = !!claimableButton;

        console.log(`Quest ${index}: Title="${title}", Is Claimed=${isClaimed}, Is Claimable=${isClaimable}`);

        if (!isClaimed) {
          const href = element.getAttribute('href');
          const match = href && href.match(/\/questsold\/(\d+)/);
          const questId = match ? match[1] : index;
          unclaimedQuests.push({ id: questId, title, isClaimable });
        }
      });

      return unclaimedQuests;
    });

    console.log(`Found ${quests.length} unclaimed quests`);
    if (quests.length === 0) {
      console.log('All quests are already claimed or no new quests are available.');
    }
    return quests;
  } catch (error) {
    console.error('Error fetching quests:', error.message);
    throw error;
  } finally {
    await browser.close();
  }
}

// Function to wait for an element with retries
async function waitForSelectorWithRetry(page, selector, maxAttempts = 5, timeout = 60000) {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      console.log(`Attempt ${attempt}: Waiting for selector "${selector}"`);
      const element = await page.waitForSelector(selector, { timeout });
      return element;
    } catch (error) {
      console.log(`Attempt ${attempt} failed: ${error.message}`);
      if (attempt === maxAttempts) {
        throw error;
      }
      console.log('Retrying after 15 seconds...'); // စောင့်ဆိုင်းချိန်ကို တိုးပေးထားပါတယ်
      await new Promise(resolve => setTimeout(resolve, 15000));
    }
  }
}

// Function to process each unclaimed quest using Puppeteer
async function processQuest(token, quest, proxy = null) {
  const browserArgs = [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
  ];
  if (proxy) {
    browserArgs.push(`--proxy-server=${proxy}`);
    console.log(`Using proxy: ${proxy}`);
  }

  const browser = await puppeteer.launch({
    headless: true,
    executablePath: '/usr/bin/chromium-browser',
    args: browserArgs,
    protocolTimeout: 60000,
  });
  const page = await browser.newPage();

  try {
    await page.setCookie({
      name: 'harbor-session',
      value: token,
      domain: 'hub.beamable.network',
      path: '/',
      httpOnly: true,
      secure: true,
    });

    const questDetailsUrl = `${QUESTS_URL}/${quest.id}`;
    console.log(`Quest စာမျက်နှာကို သွားနေပါတယ်: ${questDetailsUrl}`);
    await page.goto(questDetailsUrl, { waitUntil: 'networkidle2', timeout: 60000 });
    await new Promise(resolve => setTimeout(resolve, 15000)); // စာမျက်နှာဖွင့်ပြီး စောင့်ဆိုင်းချိန်ကို တိုးပေးထားပါတယ်

    // အဆင့် ၁: "Click the Link" ခလုတ်ကို ရှာပြီး နှိပ်မယ်
    console.log('Looking for "Click the Link" button');
    const clickLinkButton = await waitForSelectorWithRetry(page, 'button[class*="btn-primary-opacity-40"]'); // Selector ကို ပြောင်းထားပါတယ်
    if (clickLinkButton) {
      const linkButtonText = await page.evaluate(el => el.textContent.trim(), clickLinkButton);
      const linkButtonClasses = await page.evaluate(el => el.className, clickLinkButton);
      console.log(`Found "Click the Link" button with text: "${linkButtonText}" and classes: "${linkButtonClasses}"`);
      
      if (linkButtonText.toLowerCase().includes('click the link')) {
        await clickLinkButton.click();
        console.log('Clicked "Click the Link" button');
        await new Promise(resolve => setTimeout(resolve, 20000)); // နှိပ်ပြီး စောင့်ဆိုင်းချိန်ကို တိုးပေးထားပါတယ်

        // စာမျက်နှာကို ၁ ကြိမ်ပဲ Reload လုပ်မယ်
        console.log('Reloading the current quest page (Attempt 1/1)...');
        await page.reload({ waitUntil: 'networkidle2', timeout: 60000 });
        await new Promise(resolve => setTimeout(resolve, 30000)); // Reload ပြီး စောင့်ဆိုင်းချိန်ကို တိုးပေးထားပါတယ်
      } else {
        console.log(`Found element does not have the text "Click the Link": "${linkButtonText}". Skipping to Claim Reward...`);
      }
    } else {
      console.log('Could not find "Click the Link" button with selector "button[class*="btn-primary-opacity-40"]"');
    }

    // အဆင့် ၂: Reload ၁ ကြိမ်ပြီးမှ "Claim Reward" ခလုတ်ကို ရှာပြီး နှိပ်မယ်
    let claimButton = null;
    for (let attempt = 1; attempt <= 3; attempt++) {
      console.log(`Attempt ${attempt}: Looking for "Claim Reward" button after 1 reload...`);
      try {
        claimButton = await waitForSelectorWithRetry(page, 'button[class*="btn-primary"][class*="rounded-full"]'); // "Claim Reward" ခလုတ်အတွက် selector ကို ပိုတိကျအောင် လုပ်ထားပါတယ်
        break;
      } catch (error) {
        console.log(`Attempt ${attempt} failed to find "Claim Reward" button: ${error.message}`);
        if (attempt === 3) {
          console.log(`Failed: Could not find "Claim Reward" button after 3 attempts for quest: ${quest.title} (ID: ${quest.id})`);
          return;
        }
        console.log('Reloading the page to try again...');
        await page.reload({ waitUntil: 'networkidle2', timeout: 60000 });
        await new Promise(resolve => setTimeout(resolve, 30000));
      }
    }

    if (claimButton) {
      const buttonText = await page.evaluate(btn => btn.textContent.trim(), claimButton);
      const buttonClasses = await page.evaluate(btn => btn.className, claimButton);
      console.log(`Found "Claim Reward" button with text: "${buttonText}" and classes: "${buttonClasses}"`);

      if (buttonText.toLowerCase().includes('claim')) {
        const isDisabled = await page.evaluate(btn => btn.disabled, claimButton);
        if (!isDisabled) {
          await claimButton.click();
          console.log(`Quest ကို Claim လုပ်လိုက်ပါပြီ: ${quest.title} (ID: ${quest.id})`);
          console.log(`Successfully claimed the reward for quest: ${quest.title} (ID: ${quest.id})!`);
          await new Promise(resolve => setTimeout(resolve, 15000)); // Claim ပြီး စောင့်ဆိုင်းချိန်ကို တိုးပေးထားပါတယ်
        } else {
          console.log(`Failed: Claim button is disabled for quest: ${quest.title} (ID: ${quest.id})`);
        }
      } else {
        console.log(`Found element does not have the text "Claim": "${buttonText}". Skipping...`);
      }
    } else {
      console.log(`Failed: Could not find "Claim Reward" button for quest: ${quest.title} (ID: ${quest.id})`);
    }
  } catch (error) {
    console.error(`Quest ကို လုပ်ဆောင်ရာမှာ အမှားဖြစ်သွားပါတယ် ${quest.title} (ID: ${quest.id}):`, error.message);
  } finally {
    await browser.close();
  }
}

// Function to process all accounts for one run
async function processAllAccounts(accounts, proxies) {
  for (let i = 0; i < accounts.length; i++) {
    const { username, token } = accounts[i];
    const proxy = proxies.length > 0 ? proxies[i % proxies.length] : null;
    console.log(`=== Processing account: ${username}${proxy ? ` with proxy: ${proxy}` : ' without proxy'} ===`);

    try {
      const unclaimedQuests = await fetchUnclaimedQuests(token, proxy);
      console.log(`Found ${unclaimedQuests.length} unclaimed quests for ${username}`);

      for (const quest of unclaimedQuests) {
        console.log(`Processing quest for ${username}: ${quest.title} (ID: ${quest.id}, Claimable: ${quest.isClaimable})`);
        await processQuest(token, quest, proxy);
        console.log('Waiting 15 seconds before processing the next quest...');
        await new Promise(resolve => setTimeout(resolve, 15000));
      }

      console.log(`All unclaimed quests processed for ${username}!`);
    } catch (error) {
      console.error(`Failed to process quests for ${username}:`, error.message);
      if (error.message.includes('Authentication failed')) {
        console.log(`Please check the token for ${username} in token.txt. It might be invalid or expired.`);
        console.log('You may need to log in manually to get a new token and update token.txt.');
      }
    }

    console.log('Waiting 20 seconds before processing the next account...');
    await new Promise(resolve => setTimeout(resolve, 20000));
  }
}

// Main function to run the script for multiple accounts with auto-retry
async function main() {
  try {
    console.log('Make sure you have activated the virtual environment with: source venv/bin/activate');

    const accounts = await readTokens();
    const proxies = await readProxies();

    const maxRuns = 2; // အကောင့်အကုန်လုံး ပြီးရင် နောက်တစ်ကြိမ် ထပ် Run မယ်
    for (let run = 1; run <= maxRuns; run++) {
      console.log(`=== Starting Run ${run} of ${maxRuns} ===`);
      await processAllAccounts(accounts, proxies);
      if (run < maxRuns) {
        console.log(`Run ${run} completed. Starting the next run in 30 seconds...`);
        await new Promise(resolve => setTimeout(resolve, 30000));
      }
    }

    console.log('All runs completed! Script has finished.');
  } catch (error) {
    console.error('Script failed:', error.message);
  }
}

// Run the script
main();
