console.log(`
 █████╗ ██████╗ ██████╗     ███╗   ██╗ ██████╗ ██████╗ ███████╗
██╔══██╗██╔══██╗██╔══██╗    ████╗  ██║██╔═══██╗██╔══██╗██╔════╝
███████║██║  ██║██████╔╝    ██╔██╗ ██║██║   ██║██║  ██║█████╗
██╔══██║██║  ██║██╔══██╗    ██║╚██╗██║██║   ██║██║  ██║██╔══╝
██║  ██║██████╔╝██████╔╝    ██║ ╚████║╚██████╔╝██████╔╝███████╗
╚═╝  ╚═╝╚═════╝ ╚═════╝     ╚═╝  ╚═══╝ ╚═════╝ ╚═════╝ ╚══════╝
by btctrader
`);

const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs = require('fs').promises;
const path = require('path');

// Use the stealth plugin to avoid detection
puppeteer.use(StealthPlugin());

const tokenFile = 'token.txt';
const baseCheckinFile = 'last_checkin_time_';
const checkinDir = 'last_checkins';

// Ensure check-in directory exists
async function ensureCheckinDir() {
    const checkinFolder = path.join(checkinDir);
    await fs.mkdir(checkinFolder, { recursive: true });
    return checkinFolder;
}

// Read token data from token.txt
async function getTokenData() {
    try {
        const data = await fs.readFile(tokenFile, 'utf8');
        const lines = data.split('\n').map(line => line.trim()).filter(line => line);
        const tokenData = {};

        for (const line of lines) {
            const parts = line.split('=');
            if (parts.length < 3) {
                console.error(`Invalid line format (not enough parts): ${line}`);
                continue;
            }
            const accountId = parts[0];
            const key = parts[1];
            const value = parts.slice(2).join('=');

            if (key === 'harborSession') {
                tokenData[accountId] = value;
                const maskedValue = value.substring(0, 5) + '****' + value.substring(value.length - 5);
                console.log(`Account ${accountId}: Cookie loaded - ${maskedValue}`);
            } else {
                console.error(`Account ${accountId}: Invalid key (expected harborSession, got ${key})`);
            }
        }

        if (Object.keys(tokenData).length === 0) {
            throw new Error('No valid harbor-session cookies found in token.txt');
        }
        return tokenData;
    } catch (error) {
        console.error(`Error reading token.txt: ${error.message}`);
        process.exit(1);
    }
}

// Get last check-in time for an account
async function getLastCheckinTime(accountId) {
    const checkinFolder = await ensureCheckinDir();
    const fileName = path.join(checkinFolder, `${baseCheckinFile}${accountId}.txt`);
    try {
        const data = await fs.readFile(fileName, 'utf8');
        return parseInt(data, 10) || 0;
    } catch (error) {
        return 0;
    }
}

// Set last check-in time for an account
async function setLastCheckinTime(accountId, timestamp) {
    const checkinFolder = await ensureCheckinDir();
    const fileName = path.join(checkinFolder, `${baseCheckinFile}${accountId}.txt`);
    await fs.writeFile(fileName, timestamp.toString(), 'utf8');
}

// Random delay to mimic human behavior
const randomDelay = (min, max) => {
    const delay = Math.floor(Math.random() * (max - min + 1)) + min;
    return new Promise(resolve => setTimeout(resolve, delay));
};

// Simulate human-like mouse movement
async function simulateMouseMovement(page) {
    const width = 1280;
    const height = 720;
    const x = Math.floor(Math.random() * width);
    const y = Math.floor(Math.random() * height);
    await page.mouse.move(x, y, { steps: 10 });
    await randomDelay(500, 1500);
}

// Simulate human-like scrolling
async function simulateScrolling(page) {
    await page.evaluate(async () => {
        await new Promise(resolve => {
            let totalHeight = 0;
            const distance = 100;
            const timer = setInterval(() => {
                const scrollHeight = document.body.scrollHeight;
                window.scrollBy(0, distance);
                totalHeight += distance;
                if (totalHeight >= scrollHeight) {
                    clearInterval(timer);
                    resolve();
                }
            }, 100);
        });
    });
    await randomDelay(1000, 2000);
}

// Simulate human-like keyboard usage
async function simulateKeyboardUsage(page) {
    await page.keyboard.press('ArrowDown');
    await randomDelay(500, 1000);
    await page.keyboard.press('ArrowUp');
    await randomDelay(500, 1000);
}

// Function to click "Show More" buttons
async function clickShowMoreButton(page, accountId, maxAttempts = 5) {
    let attempts = 0;
    let showMoreFound = false;

    while (attempts < maxAttempts) {
        try {
            await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
            await randomDelay(3000, 5000);

            const showMoreButton = await page.evaluateHandle(() => {
                const buttons = document.querySelectorAll('button, [role="button"], [class*="show-more"], [class*="load-more"]');
                for (const button of buttons) {
                    const text = button.textContent.trim().toLowerCase();
                    const hasShowMoreText = text.includes('show more') || text.includes('load more');
                    const hasShowMoreClass = button.className.toLowerCase().includes('show-more') || button.className.toLowerCase().includes('load-more');
                    if (hasShowMoreText || hasShowMoreClass) {
                        return button;
                    }
                }
                return null;
            });

            if (showMoreButton.asElement()) {
                console.log(`Account ${accountId}: Found "Show More" button, clicking...`);
                await page.evaluate(el => el.scrollIntoView({ behavior: 'smooth', block: 'center' }), showMoreButton);
                await simulateMouseMovement(page);
                await simulateKeyboardUsage(page);
                await showMoreButton.click();
                await randomDelay(5000, 7000);
                showMoreFound = true;
                attempts = 0;
            } else {
                console.log(`Account ${accountId}: No "Show More" button found on attempt ${attempts + 1}.`);
                break;
            }
        } catch (error) {
            console.error(`Account ${accountId}: Error while trying to click "Show More" button: ${error.message}`);
            break;
        }
        attempts++;
    }

    if (showMoreFound) {
        console.log(`Account ${accountId}: Successfully clicked all "Show More" buttons.`);
    } else {
        console.log(`Account ${accountId}: No more "Show More" buttons to click.`);
    }
}

// Process a single account with retries
async function processTokenWithRetry(accountId, harborSession, maxRetries = 3) {
    const lastCheckinTime = await getLastCheckinTime(accountId);
    const now = Date.now();
    const twentyFourHours = 24 * 60 * 60 * 1000;

    if (now - lastCheckinTime < twentyFourHours) {
        const timeLeft = twentyFourHours - (now - lastCheckinTime);
        const hoursLeft = Math.floor(timeLeft / (1000 * 60 * 60));
        const minutesLeft = Math.floor((timeLeft % (1000 * 60 * 60)) / (1000 * 60));
        console.log(`Account ${accountId}: Daily check-in already completed. Please wait ${hoursLeft}h ${minutesLeft}m before next attempt.`);
        return false;
    }

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        console.log(`Account ${accountId} - Attempt ${attempt}/${maxRetries}`);

        let browser;
        try {
            browser = await puppeteer.launch({
                headless: true,
                args: [
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-gpu',
                    '--disable-dev-shm-usage',
                    '--window-size=1280,720',
                ],
                timeout: 60000
            });
            const page = await browser.newPage();

            await page.setViewport({ width: 1280, height: 720, deviceScaleFactor: 1 });

            console.log(`Account ${accountId}: Setting cookie...`);
            await page.setCookie({
                name: 'harbor-session',
                value: harborSession,
                domain: 'hub.beamable.network',
                path: '/',
                httpOnly: true,
                secure: true
            });

            console.log(`Account ${accountId}: Checking cookie expiration...`);
            await page.goto('https://hub.beamable.network/modules/aprildailies', { waitUntil: 'networkidle2', timeout: 180000 });

            const cookies = await page.cookies();
            const harborCookie = cookies.find(cookie => cookie.name === 'harbor-session');
            if (harborCookie) {
                if (harborCookie.expires && harborCookie.expires !== -1) {
                    const expireDate = new Date(harborCookie.expires * 1000);
                    const now = Date.now();
                    const timeLeft = harborCookie.expires * 1000 - now;
                    console.log(`Account ${accountId}: Cookie expires on ${expireDate.toLocaleString()}`);
                    if (timeLeft <= 0) {
                        console.log(`Account ${accountId}: Cookie has already expired!`);
                        await browser.close();
                        return false;
                    } else {
                        const daysLeft = Math.floor(timeLeft / (1000 * 60 * 60 * 24));
                        const hoursLeft = Math.floor((timeLeft % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
                        console.log(`Account ${accountId}: Cookie will expire in ${daysLeft} days and ${hoursLeft} hours`);
                    }
                } else {
                    console.log(`Account ${accountId}: No expiration set or invalid expiration (session cookie)`);
                }
            } else {
                console.log(`Account ${accountId}: harbor-session cookie not found on page`);
            }

            await page.setExtraHTTPHeaders({
                'Accept-Language': 'en-US,en;q=0.9',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                'Referer': 'https://hub.beamable.network/onboarding/login',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36'
            });

            console.log(`Account ${accountId}: Navigating to Daily Checkin page...`);
            await randomDelay(5000, 8000);
            await simulateMouseMovement(page);
            await simulateScrolling(page);
            await simulateKeyboardUsage(page);

            let currentUrl = page.url();
            console.log(`Account ${accountId}: Current URL: ${currentUrl}`);

            const forbiddenError = await page.evaluate(() => {
                return document.body.innerText.includes('403 Forbidden');
            });

            if (forbiddenError) {
                console.log(`Account ${accountId}: 403 forbidden error detected.`);
                await browser.close();
                if (attempt === maxRetries) {
                    console.log(`Account ${accountId}: Max retries reached. Pausing for 1 hour...`);
                    await randomDelay(3600000, 3660000);
                    return false;
                }
                continue;
            }

            const suspiciousActivity = await page.evaluate(() => {
                return document.body.innerText.includes('Suspicious Activity Detected');
            });

            if (suspiciousActivity) {
                console.log(`Account ${accountId}: Suspicious activity detected.`);
                await browser.close();
                if (attempt === maxRetries) {
                    console.log(`Account ${accountId}: Max retries reached. Pausing for 1 hour...`);
                    await randomDelay(3600000, 3660000);
                    return false;
                }
                continue;
            }

            if (currentUrl.includes('/onboarding/login') || currentUrl.includes('/onboarding/confirm')) {
                console.log(`Account ${accountId}: Session expired. Please update harborSession cookie manually in token.txt using login link from email.`);
                await browser.close();
                return false;
            }

            console.log(`Account ${accountId}: Waiting for sidebar to load...`);
            const sidebarSelector = '.sidebar, [class*="sidebar"], nav, [role="navigation"]';
            try {
                await page.waitForSelector(sidebarSelector, { timeout: 120000 });
                console.log(`Account ${accountId}: Sidebar found. Attempting to open if collapsed...`);
                await page.evaluate(() => {
                    const sidebar = document.querySelector('.sidebar, [class*="sidebar"], nav, [role="navigation"]');
                    if (sidebar && window.getComputedStyle(sidebar).transform.includes('translateX(-100%)')) {
                        const toggle = document.querySelector('label[for="sidebarOpen"], button[class*="toggle"], [aria-label*="menu"]');
                        if (toggle) toggle.click();
                    }
                });
                await randomDelay(5000, 7000);
                await simulateMouseMovement(page);
                await simulateScrolling(page);
                await simulateKeyboardUsage(page);
            } catch (error) {
                console.error(`Account ${accountId}: Failed to find sidebar: ${error.message}`);
                await browser.close();
                return false;
            }

            if (!currentUrl.includes('/modules/aprildailies')) {
                console.log(`Account ${accountId}: Unexpected URL after navigation. Expected /modules/aprildailies, got ${currentUrl}. Skipping...`);
                await browser.close();
                return false;
            }

            console.log(`Account ${accountId}: Checking for Show More button...`);
            await clickShowMoreButton(page, accountId);

            console.log(`Account ${accountId}: Checking for Claim button...`);
            let claimButtonFound = false;

            try {
                // Wait for the widget container to load
                await page.waitForSelector('#widget-467', { timeout: 120000 });
                await page.waitForNetworkIdle({ timeout: 60000, idleTime: 1000 });

                // Simplified selector for potential Claim buttons
                const potentialButtonsSelector = '#widget-467 button';
                const maxAttempts = 3;

                for (let attempt = 1; attempt <= maxAttempts; attempt++) {
                    console.log(`Account ${accountId}: Attempt ${attempt}/${maxAttempts} to find and click Claim button...`);

                    // Find all buttons within the widget
                    const buttons = await page.$$(potentialButtonsSelector);
                    console.log(`Account ${accountId}: Found ${buttons.length} potential buttons.`);

                    for (let i = 0; i < buttons.length; i++) {
                        const button = buttons[i];
                        const text = await button.evaluate(el => el.textContent.trim().toLowerCase());
                        const isClaimButton = text.includes('claim');
                        const isDisabled = await button.evaluate(el => el.hasAttribute('disabled') || el.className.includes('opacity-50') || el.className.includes('disabled'));
                        const isVisible = await button.evaluate(el => {
                            const style = window.getComputedStyle(el);
                            return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
                        });

                        console.log(`Account ${accountId}: Button ${i + 1} - Text: ${text}, Claim: ${isClaimButton}, Disabled: ${isDisabled}, Visible: ${isVisible}`);

                        if (isClaimButton && !isDisabled && isVisible) {
                            // Scroll to the button
                            await page.evaluate(el => el.scrollIntoView({ behavior: 'smooth', block: 'center' }), button);
                            await randomDelay(1000, 2000); // Wait for DOM to settle

                            // Verify clickability
                            const boundingBox = await button.boundingBox();
                            if (!boundingBox) {
                                console.log(`Account ${accountId}: Claim button is not clickable (no bounding box).`);
                                continue;
                            }

                            console.log(`Account ${accountId}: Claim button bounding box: ${JSON.stringify(boundingBox)}`);

                            // Save a screenshot before clicking
                            await page.screenshot({ path: `before_click_${accountId}_${now}_attempt_${attempt}.png` });
                            console.log(`Account ${accountId}: Screenshot saved before clicking.`);

                            // Attempt to click using multiple methods
                            try {
                                // Method 1: Puppeteer click with force
                                await button.click({ delay: 100, force: true });
                                console.log(`Account ${accountId}: Clicked Claim button using Puppeteer click.`);

                                // Verify click by waiting for network activity or DOM change
                                await page.waitForNetworkIdle({ timeout: 10000, idleTime: 500 }).catch(() => {
                                    console.log(`Account ${accountId}: No network activity after click, proceeding...`);
                                });

                                // Check if the button text or state changed (e.g., "Claim" to "Claimed")
                                const newText = await button.evaluate(el => el.textContent.trim().toLowerCase());
                                if (!newText.includes('claim')) {
                                    console.log(`Account ${accountId}: Button text changed to "${newText}", assuming click was successful.`);
                                    claimButtonFound = true;
                                    break;
                                }

                                // Method 2: JavaScript click as fallback
                                await page.evaluate(el => el.click(), button);
                                console.log(`Account ${accountId}: Clicked Claim button using JavaScript click.`);

                                // Verify again
                                await page.waitForNetworkIdle({ timeout: 10000, idleTime: 500 }).catch(() => {});
                                const finalText = await button.evaluate(el => el.textContent.trim().toLowerCase());
                                if (!finalText.includes('claim')) {
                                    console.log(`Account ${accountId}: Button text changed to "${finalText}", assuming click was successful.`);
                                    claimButtonFound = true;
                                    break;
                                }

                                console.log(`Account ${accountId}: Click attempt completed, but button state did not change. Assuming success.`);
                                claimButtonFound = true;
                                break;
                            } catch (clickError) {
                                console.error(`Account ${accountId}: Failed to click Claim button: ${clickError.message}`);
                                await page.screenshot({ path: `click_error_${accountId}_${now}_attempt_${attempt}.png` });
                                console.log(`Account ${accountId}: Screenshot saved after click failure.`);
                            }
                        }
                    }

                    if (claimButtonFound) {
                        await setLastCheckinTime(accountId, now);
                        break;
                    } else {
                        console.log(`Account ${accountId}: No clickable Claim button found on attempt ${attempt}. Retrying after delay...`);
                        await simulateScrolling(page);
                        await randomDelay(5000, 10000);
                    }
                }

                if (!claimButtonFound) {
                    console.log(`Account ${accountId}: No clickable Claim button found after all attempts.`);

                    // Save a screenshot and page source for debugging
                    await page.screenshot({ path: `error_screenshot_${accountId}_${now}.png` });
                    await fs.writeFile(`error_page_source_${accountId}_${now}.html`, await page.content());
                    console.log(`Account ${accountId}: Saved screenshot and page source for debugging.`);
                }
            } catch (error) {
                console.error(`Account ${accountId}: Error while checking for Claim button: ${error.message}`);
                await page.screenshot({ path: `error_screenshot_${accountId}_${now}.png` });
                await fs.writeFile(`error_page_source_${accountId}_${now}.html`, await page.content());
                console.log(`Account ${accountId}: Saved screenshot and page source for debugging.`);
            }

            await browser.close();
            return claimButtonFound;
        } catch (error) {
            console.error(`Account ${accountId} - Attempt ${attempt} failed: ${error.message}`);
            if (browser) await browser.close();
            if (attempt === maxRetries) {
                console.error(`Account ${accountId}: Max retries reached. Pausing for 1 hour...`);
                await randomDelay(3600000, 3660000);
                return false;
            }
            await randomDelay(10000, 15000);
        }
    }
    return false;
}

// Main function to process all accounts
async function processToken() {
    const tokenData = await getTokenData();

    while (true) {
        let allAccountsProcessed = true;

        for (const accountId in tokenData) {
            console.log(`Processing account: ${accountId}`);
            const success = await processTokenWithRetry(accountId, tokenData[accountId]);
            if (success) {
                console.log(`Account ${accountId}: Successfully claimed. Waiting for next cycle...`);
            } else {
                console.log(`Account ${accountId}: No action taken or failed. Will check again in next cycle...`);
                allAccountsProcessed = false;
            }
            await randomDelay(10000, 20000);
        }

        const waitTime = 24 * 60 * 60 * 1000;
        console.log(`All accounts processed. Waiting ${waitTime / (60 * 60 * 1000)} hours before next check...`);
        await randomDelay(waitTime, waitTime + 600000);
    }
}

// Start the script
processToken().catch(error => {
    console.error(`Fatal error: ${error.message}`);
    process.exit(1);
});
