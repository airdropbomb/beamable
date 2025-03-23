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
    const username = parts[0]; // Extract the username (e.g., yannaingkoko or lcho)
    const token = parts[2]; // Extract the token value
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
  const browser = await puppeteer.launch({
  headless: true,
  executablePath: '/usr/bin/chromium-browser', // Contabo VPS မှာ Chromium ရဲ့ path
  args: browserArgs,
});
  const page = await browser.newPage();

  try {
    // Set the token in cookies
    await page.setCookie({
      name: 'harbor-session',
      value: token,
      domain: 'hub.beamable.network',
      path: '/',
      httpOnly: true,
      secure: true,
    });

    // Navigate to the quests page
    console.log('Navigating to quests page:', QUESTS_URL);
    await page.goto(QUESTS_URL, { waitUntil: 'networkidle2', timeout: 30000 });

    // Wait for the page to fully load (increased to 10 seconds for dynamic content)
    await new Promise(resolve => setTimeout(resolve, 10000));

    // Check if the page redirected to the login page
    const currentUrl = page.url();
    console.log('Current URL after navigation:', currentUrl);
    if (currentUrl.includes('/onboarding/login')) {
      console.error('Redirected to login page. Token may be invalid or expired.');
      const pageContent = await page.content();
      console.log('Login page content:', pageContent);
      throw new Error('Authentication failed: Redirected to login page');
    }

    // Log the page content for debugging
    const pageContent = await page.content();
    console.log('Quests page content:', pageContent);

    // Find all quest elements with a more specific selector
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
const browser = await puppeteer.launch({
  headless: true,
  executablePath: '/usr/bin/chromium-browser', // Contabo VPS မှာ Chromium ရဲ့ path
  args: browserArgs,
});
  const page = await browser.newPage();

  try {
    // Set the token in cookies
    await page.setCookie({
      name: 'harbor-session',
      value: token,
      domain: 'hub.beamable.network',
      path: '/',
      httpOnly: true,
      secure: true,
    });

    // Navigate to the quest details page
    const questDetailsUrl = `${QUESTS_URL}/${quest.id}`;
    console.log(`Navigating to quest details: ${questDetailsUrl}`);
    await page.goto(questDetailsUrl, { waitUntil: 'networkidle2', timeout: 30000 });

    // If the quest is not claimable, complete the required steps
    if (!quest.isClaimable) {
      console.log('Quest is not claimable yet. Attempting to complete required steps...');
      // Click the "Click the Link" button if available
      console.log('Looking for "Click the Link" button');
      const clickLinkButton = await waitForSelectorWithRetry(page, 'button.btn-primary');
      if (clickLinkButton) {
        await clickLinkButton.click();
        console.log('Clicked "Click the Link" button');
        // Wait for any redirect or page load
        await new Promise(resolve => setTimeout(resolve, 5000));
      } else {
        console.log('Could not find "Click the Link" button');
      }
    }

    // Navigate back to the quests page
    console.log('Navigating back to quests page');
    await page.goto(QUESTS_URL, { waitUntil: 'networkidle2', timeout: 30000 });

    // Wait for the page to fully load
    await new Promise(resolve => setTimeout(resolve, 5000));

    // Check if the quest is now claimable and claim it
    console.log('Checking if quest is now claimable...');
    // Use the quest ID to find the specific quest container
    const questContainerSelector = `div.bg-content a[href*="/questsold/${quest.id}"]`;
    const questContainer = await page.$(questContainerSelector);
    if (!questContainer) {
      console.log(`Could not find quest container for ID ${quest.id}`);
      return;
    }

    // Find the "Claim Reward" button within the quest container
    const claimButtonSelector = 'button.btn-accent:not(:disabled)';
    const claimButton = await questContainer.evaluateHandle((container, selector) => {
      return container.closest('div.bg-content').querySelector(selector);
    }, claimButtonSelector);

    if (claimButton.asElement()) {
      console.log('Found "Claim Reward" button');
      await claimButton.click();
      console.log(`Claimed quest: ${quest.title} (ID: ${quest.id})`);
      await new Promise(resolve => setTimeout(resolve, 10000)); // Wait for the claim action to complete
    } else {
      console.log(`Quest "${quest.title}" (ID: ${quest.id}) is still not claimable or already claimed.`);
    }
  } catch (error) {
    console.error(`Error processing quest ${quest.title} (ID: ${quest.id}):`, error.message);
  } finally {
    await browser.close();
  }
}

// Main function to run the script
async function main() {
  try {
    // Ensure the script is running in the virtual environment
    console.log('Make sure you have activated the virtual environment with: source venv/bin/activate');

    // Read the token
    const { username, token } = await readToken();
    console.log(`Token retrieved for ${username}: ${token}`);

    // Fetch unclaimed quests
    const unclaimedQuests = await fetchUnclaimedQuests(token);
    console.log(`Found ${unclaimedQuests.length} unclaimed quests`);

    // Process each unclaimed quest
    for (const quest of unclaimedQuests) {
      console.log(`Processing quest: ${quest.title} (ID: ${quest.id}, Claimable: ${quest.isClaimable})`);
      await processQuest(token, quest);
      console.log('Waiting 5 seconds before processing the next quest...');
      await new Promise(resolve => setTimeout(resolve, 5000)); // 5-second delay to avoid rate limiting
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
