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

// ... (အထက်က code တွေ အတူတူပဲ)

// Function to process each unclaimed quest using Puppeteer
async function processQuest(token, quest) {
  const browserArgs = ['--no-sandbox', '--disable-setuid-sandbox', '--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'];
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
    console.log(`Navigating to quest details: ${questDetailsUrl}`);
    await page.goto(questDetailsUrl, { waitUntil: 'networkidle2', timeout: 30000 });
    await new Promise(resolve => setTimeout(resolve, 5000));
    const pageContent = await page.content();
    console.log('Quest details page content:', pageContent);

    if (!quest.isClaimable) {
      console.log('Quest is not claimable yet. Attempting to complete required steps...');
      console.log('Looking for "Click the Link" button');
      const clickLinkButton = await waitForSelectorWithRetry(page, 'a.btn-accent');
      if (clickLinkButton) {
        const buttonText = await page.evaluate(el => el.textContent.trim(), clickLinkButton);
        if (buttonText === 'Click the Link') {
          await clickLinkButton.click();
          console.log('Clicked "Click the Link" button');
          const contentAfterClick = await page.content();
          console.log('Page content after clicking:', contentAfterClick);
          await new Promise(resolve => setTimeout(resolve, 10000));
        } else {
          console.log('Found element does not have the text "Click the Link":', buttonText);
        }
      } else {
        console.log('Could not find "Click the Link" button');
      }
    }

    console.log('Navigating back to quests page');
    await page.goto(QUESTS_URL, { waitUntil: 'networkidle2', timeout: 30000 });

    await new Promise(resolve => setTimeout(resolve, 30000)); // 30 စက္ကန့် စောင့်တယ်
    const questsPageContent = await page.content();
    console.log('Quests page content after navigation:', questsPageContent);

    console.log('Checking if quest is now claimable...');
    // Try to find all quest containers and loop through them
    const allQuestContainers = await page.$$('div.bg-content');
    console.log(`Found ${allQuestContainers.length} quest containers with class "bg-content"`);
    
    let claimButtonFound = false;
    for (const container of allQuestContainers) {
      // Check if this container is for the current quest
      const hrefElement = await container.$('a[href*="/questsold/"]');
      if (hrefElement) {
        const href = await page.evaluate(el => el.getAttribute('href'), hrefElement);
        if (href && href.includes(`/questsold/${quest.id}`)) {
          console.log(`Found matching quest container for ID ${quest.id}`);
          
          // Try to find the "Claim Reward" button
          const claimButton = await container.$('button.btn-primary.opacity-100');
          if (claimButton) {
            const buttonText = await page.evaluate(el => el.textContent.trim(), claimButton);
            if (buttonText === 'Claim Reward') {
              console.log('Found "Claim Reward" button');
              await claimButton.click();
              console.log(`Claimed quest: ${quest.title} (ID: ${quest.id})`);
              await new Promise(resolve => setTimeout(resolve, 10000));
              claimButtonFound = true;
              break;
            } else {
              console.log('Found button but text does not match "Claim Reward":', buttonText);
            }
          } else {
            console.log('Could not find "Claim Reward" button in this container');
            // Try alternative selector
            const alternativeClaimButton = await container.$('button[class*="btn-primary"]');
            if (alternativeClaimButton) {
              const altButtonText = await page.evaluate(el => el.textContent.trim(), alternativeClaimButton);
              if (altButtonText === 'Claim Reward') {
                console.log('Found "Claim Reward" button with alternative selector');
                await alternativeClaimButton.click();
                console.log(`Claimed quest with alternative selector: ${quest.title} (ID: ${quest.id})`);
                await new Promise(resolve => setTimeout(resolve, 10000));
                claimButtonFound = true;
                break;
              }
            }
          }
        }
      }
    }

    if (!claimButtonFound) {
      console.log(`Quest "${quest.title}" (ID: ${quest.id}) is still not claimable or already claimed.`);
    }
  } catch (error) {
    console.error(`Error processing quest ${quest.title} (ID: ${quest.id}):`, error.message);
  } finally {
    await browser.close();
  }
}
// ... (main function နဲ့ ကျန်တဲ့ code က အတူတူပဲ)

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
