const puppeteer = require('puppeteer');
const fs = require('fs').promises;

// Base URL for the quests page
const QUESTS_URL = 'https://hub.beamable.network/modules/questsold';

// Function to read the token from token.txt
async function readToken() {
  try {
    const data = await fs.readFile('token.txt', 'utf8');
    const parts = data.trim().split('=');
    if (parts.length !== 3 || parts[1] !== 'harborSession') {
      throw new Error('Invalid token format in token.txt. Expected format: username=harborSession=token_value');
    }
    const username = parts[0];
    const token = parts[2];
    if (!token) {
      throw new Error('Token is empty or not found in token.txt');
    }
    console.log(`Username: ${username}`);
    return { username, token };
  } catch (error) {
    console.error('Error reading token.txt:', error.message);
    throw new Error('Failed to read token');
  }
}

// Function to fetch unclaimed quests using Puppeteer
async function fetchUnclaimedQuests(token) { // Function အနေနဲ့ ပြန်သတ်မှတ်တယ်
  const browserArgs = ['--no-sandbox', '--disable-setuid-sandbox'];
  const browser = await puppeteer.launch({
    headless: true,
    executablePath: '/usr/bin/chromium-browser', // Contabo VPS မှာ Chromium ရဲ့ path
    args: browserArgs,
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
    await page.goto(QUESTS_URL, { waitUntil: 'networkidle2', timeout: 30000 });

    await new Promise(resolve => setTimeout(resolve, 10000));

    const currentUrl = page.url();
    console.log('Current URL after navigation:', currentUrl);
    if (currentUrl.includes('/onboarding/login')) {
      console.error('Redirected to login page. Token may be invalid or expired.');
      const pageContent = await page.content();
      console.log('Login page content:', pageContent);
      throw new Error('Authentication failed: Redirected to login page');
    }

    const pageContent = await page.content();
    console.log('Quests page content:', pageContent);

    const quests = await page.evaluate(() => {
      const questElements = document.querySelectorAll('div.bg-content a[href*="/modules/questsold"]');
      const unclaimedQuests = [];

      console.log(`Found ${questElements.length} potential quest elements`);

      questElements.forEach((element, index) => {
        const parent = element.closest('div.bg-content');
        const titleElement = parent.querySelector('div.h3');
        if (!titleElement) {
          console.log(`Quest ${index}: Missing title, skipping`);
          return;
        }
        const title = titleElement.innerText.trim();

        const claimedElement = parent.querySelector('span.p3');
        const isClaimed = claimedElement && claimedElement.innerText.trim().toLowerCase() === 'claimed';

        const claimableButton = parent.querySelector('button.btn-accent');
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
async function waitForSelectorWithRetry(page, selector, maxAttempts = 3, timeout = 10000) {
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
      console.log('Retrying after 5 seconds...');
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
  }
}

// Function to process each unclaimed quest using Puppeteer
async function processQuest(token, quest) {
  const browserArgs = ['--no-sandbox', '--disable-setuid-sandbox'];
  const browser = await puppeteer.launch({
    headless: true,
    executablePath: '/usr/bin/chromium-browser',
    args: browserArgs,
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
    await page.goto(questDetailsUrl, { waitUntil: 'networkidle2', timeout: 30000 });
    await new Promise(resolve => setTimeout(resolve, 5000));
    const pageContent = await page.content();
    console.log('Quest details page content:', pageContent);

    // အရင်ဆုံး Claim Reward ခလုတ်ရှိမရှိ စစ်မယ်
    let claimButton = await page.$('button.btn.btn-primary');
    let buttonText = claimButton ? await page.evaluate(btn => btn.textContent.trim(), claimButton) : null;

    if (claimButton && buttonText.toLowerCase().includes('claim')) {
      console.log('Claim Reward ခလုတ်ရှိပြီးသားပါ၊ Click the Link ကို ကျော်ပါမယ်');
    } else {
      // Claim Reward ခလုတ်မရှိရင် Click the Link ကို ရှာပြီး နှိပ်မယ်
      console.log('Quest is not claimable yet. Attempting to complete required steps...');
      console.log('Looking for "Click the Link" button');
      const clickLinkButton = await waitForSelectorWithRetry(page, 'a.btn-accent');
      if (clickLinkButton) {
        const linkButtonText = await page.evaluate(el => el.textContent.trim(), clickLinkButton);
        if (linkButtonText === 'Click the Link') {
          await clickLinkButton.click();
          console.log('Clicked "Click the Link" button');
          const contentAfterClick = await page.content();
          console.log('Page content after clicking:', contentAfterClick);
          await new Promise(resolve => setTimeout(resolve, 10000));

          // Quest စာမျက်နှာကို ပြန်မသွားဘဲ လက်ရှိစာမျက်နှာကို Reload လုပ်မယ်
          console.log('Reloading the current page...');
          await page.reload({ waitUntil: 'networkidle2', timeout: 30000 });
          await new Promise(resolve => setTimeout(resolve, 5000));
          const reloadedPageContent = await page.content();
          console.log('Page content after reload:', reloadedPageContent);
        } else {
          console.log('Found element does not have the text "Click the Link":', linkButtonText);
        }
      } else {
        console.log('Could not find "Click the Link" button');
      }

      // Reload လုပ်ပြီးရင် Claim Reward ခလုတ်ကို ထပ်ရှာမယ်
      claimButton = await page.$('button.btn.btn-primary');
      buttonText = claimButton ? await page.evaluate(btn => btn.textContent.trim(), claimButton) : null;
    }

    // Claim Reward ခလုတ်ကို နှိပ်မယ်
    if (claimButton && buttonText.toLowerCase().includes('claim')) {
      const isDisabled = await page.evaluate(btn => btn.disabled, claimButton);
      if (!isDisabled) {
        await claimButton.click();
        console.log(`Quest ကို Claim လုပ်လိုက်ပါပြီ: ${quest.title} (ID: ${quest.id})`);
        await new Promise(resolve => setTimeout(resolve, 30000)); // 30 စက္ကန့် စောင့်ပါ
      } else {
        console.log(`Claim ခလုတ်က မနှိပ်လို့မရပါ: ${quest.title} (ID: ${quest.id})`);
      }
    } else {
      console.log(`Claim ခလုတ်ကို ရှာမတွေ့ပါ: ${quest.title} (ID: ${quest.id})`);
    }
  } catch (error) {
    console.error(`Quest ကို လုပ်ဆောင်ရာမှာ အမှားဖြစ်သွားပါတယ် ${quest.title} (ID: ${quest.id}):`, error.message);
  } finally {
    await browser.close();
  }
}

// Main function to run the script
async function main() {
  try {
    console.log('Make sure you have activated the virtual environment with: source venv/bin/activate');

    const { username, token } = await readToken();
    console.log(`Token retrieved for ${username}: ${token}`);

    const unclaimedQuests = await fetchUnclaimedQuests(token);
    console.log(`Found ${unclaimedQuests.length} unclaimed quests`);

    for (const quest of unclaimedQuests) {
      console.log(`Processing quest: ${quest.title} (ID: ${quest.id}, Claimable: ${quest.isClaimable})`);
      await processQuest(token, quest);
      console.log('Waiting 5 seconds before processing the next quest...');
      await new Promise(resolve => setTimeout(resolve, 5000));
    }

    console.log('All unclaimed quests processed!');
  } catch (error) {
    console.error('Script failed:', error.message);
    if (error.message.includes('Authentication failed')) {
      console.log('Please check your token in token.txt. It might be invalid or expired.');
      console.log('You may need to log in manually to get a new token and update token.txt.');
    }
  }
}

// Run the script
main();
