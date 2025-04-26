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
const readline = require('readline');

// Use the stealth plugin to avoid detection
puppeteer.use(StealthPlugin());

const tokenFile = 'token.txt';
const baseCheckinFile = 'last_checkin_time_';
const checkinDir = 'last_checkins';

// Create readline interface for user input
const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

// Ensure check-in directory exists (for Daily Claim)
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
                console.error(`Invalid line format: ${line}`);
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

// Get last check-in time for an account (for Daily Claim)
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

// Set last check-in time for an account (for Daily Claim)
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

// Click "Show More" buttons (for Daily Claim)
async function clickShowMoreButton(page, accountId, maxAttempts = 5) {
    let attempts = 0;
    let showMoreFound = false;

    while (attempts < maxAttempts) {
        try {
            await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
            await randomDelay(3000, 5000);

            const showMoreButton = await page.evaluateHandle(() => {
                const buttons = document.querySelectorAll('button');
                for (const button of buttons) {
                    const text = button.textContent.trim().toLowerCase();
                    if (text === 'show more') {
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
            console.error(`Account ${accountId}: Error while clicking "Show More": ${error.message}`);
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

// Process a single account for Daily Claim
async function processDailyClaim(accountId, harborSession, maxRetries = 3) {
    const lastCheckinTime = await getLastCheckinTime(accountId);
    const now = Date.now();
    const twentyFourHours = 24 * 60 * 60 * 1000;

    if (now - lastCheckinTime < twentyFourHours) {
        const timeLeft = twentyFourHours - (now - lastCheckinTime);
        const hoursLeft = Math.floor(timeLeft / (1000 * 60 * 60));
        const minutesLeft = Math.floor((timeLeft % (1000 * 60 * 60)) / (1000 * 60));
        console.log(`Account ${accountId}: Daily check-in already completed. Wait ${hoursLeft}h ${minutesLeft}m.`);
        return false;
    }

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        console.log(`Account ${accountId} - Attempt ${attempt}/${maxRetries} (Daily Claim)`);
        let browser;
        try {
            browser = await puppeteer.launch({
                headless: true,
                args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu', '--disable-dev-shm-usage', '--window-size=1280,720'],
                timeout: 60000
            });
            const page = await browser.newPage();
            await page.setViewport({ width: 1280, height: 720, deviceScaleFactor: 1 });

            await page.setCookie({
                name: 'harbor-session',
                value: harborSession,
                domain: 'hub.beamable.network',
                path: '/',
                httpOnly: true,
                secure: true
            });

            console.log(`Account ${accountId}: Navigating to Daily Checkin page...`);
            await page.goto('https://hub.beamable.network/modules/aprildailies', { waitUntil: 'networkidle2', timeout: 180000 });

            await randomDelay(5000, 8000);
            await simulateMouseMovement(page);
            await simulateScrolling(page);
            await simulateKeyboardUsage(page);

            let currentUrl = page.url();
            console.log(`Account ${accountId}: Current URL: ${currentUrl}`);

            if (currentUrl.includes('/onboarding/login') || currentUrl.includes('/onboarding/confirm')) {
                console.log(`Account ${accountId}: Session expired. Update harborSession cookie in token.txt.`);
                await browser.close();
                return false;
            }

            await clickShowMoreButton(page, accountId);

            console.log(`Account ${accountId}: Checking for Claim button...`);
            let claimButtonFound = false;

            await page.waitForSelector('#widget-467', { timeout: 180000 });
            await page.waitForNetworkIdle({ timeout: 120000, idleTime: 1000 });

            const buttons = await page.$$('#widget-467 button');
            console.log(`Account ${accountId}: Found ${buttons.length} buttons.`);

            for (let i = 0; i < buttons.length; i++) {
                const button = buttons[i];
                const text = await button.evaluate(el => el.textContent.trim().toLowerCase());
                const isClaimButton = text.includes('claim');
                const isDisabled = await button.evaluate(el => el.hasAttribute('disabled') || el.className.includes('opacity-50') || el.className.includes('disabled'));
                const isVisible = await button.evaluate(el => {
                    const style = window.getComputedStyle(el);
                    return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
                });

                const dayLabel = await button.evaluateHandle(el => {
                    let parent = el.parentElement;
                    while (parent) {
                        const label = parent.querySelector('div, span, p');
                        if (label && label.textContent.match(/Day \d+/)) {
                            return label;
                        }
                        parent = parent.parentElement;
                    }
                    return null;
                });

                const dayText = dayLabel.asElement() ? await dayLabel.evaluate(el => el.textContent.trim()) : `Button ${i + 1}`;

                if (isClaimButton && !isDisabled && isVisible) {
                    await page.evaluate(el => el.scrollIntoView({ behavior: 'smooth', block: 'center' }), button);
                    await randomDelay(1000, 2000);
                    await button.click({ delay: 100 });
                    console.log(`Account ${accountId}: Clicked Claim button for ${dayText}.`);

                    await page.waitForNetworkIdle({ timeout: 15000, idleTime: 500 }).catch(() => {});
                    const newText = await button.evaluate(el => el.textContent.trim().toLowerCase());
                    if (newText.includes('claim')) {
                        await page.evaluate(el => el.click(), button);
                        await page.waitForNetworkIdle({ timeout: 15000, idleTime: 500 }).catch(() => {});
                    }

                    console.log(`Account ${accountId}: Claimed reward for ${dayText}.`);
                    await setLastCheckinTime(accountId, now);
                    claimButtonFound = true;
                    break;
                }
            }

            if (!claimButtonFound) {
                console.log(`Account ${accountId}: No claimable button found.`);
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

// Process a single account for Box Open
async function processBoxOpen(accountId, harborSession, maxRetries = 3) {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        console.log(`Account ${accountId} - Attempt ${attempt}/${maxRetries} (Box Open)`);
        let browser;
        try {
            browser = await puppeteer.launch({
                headless: true,
                args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu', '--disable-dev-shm-usage', '--window-size=1280,720'],
                timeout: 60000
            });
            const page = await browser.newPage();
            await page.setViewport({ width: 1280, height: 720, deviceScaleFactor: 1 });

            await page.setCookie({
                name: 'harbor-session',
                value: harborSession,
                domain: 'hub.beamable.network',
                path: '/',
                httpOnly: true,
                secure: true
            });

            console.log(`Account ${accountId}: Navigating to Profile page...`);
            await page.goto('https://hub.beamable.network/modules/profile/5456', { waitUntil: 'networkidle2', timeout: 180000 });

            await randomDelay(5000, 8000);
            await simulateMouseMovement(page);
            await simulateScrolling(page);
            await simulateKeyboardUsage(page);

            let currentUrl = page.url();
            console.log(`Account ${accountId}: Current URL: ${currentUrl}`);

            if (currentUrl.includes('/onboarding/login') || currentUrl.includes('/onboarding/confirm')) {
                console.log(`Account ${accountId}: Session expired. Update harborSession cookie in token.txt.`);
                await browser.close();
                return false;
            }

            await page.waitForFunction(() => document.body.innerText.includes('BMB Box'), { timeout: 60000 });
            const quantity = await page.evaluate(() => {
                const quantityElement = Array.from(document.querySelectorAll('div')).find(el => el.innerText.includes('Quantity:'));
                return quantityElement ? parseInt(quantityElement.innerText.match(/Quantity:\s*(\d+)/)?.[1] || 0, 10) : 0;
            });
            console.log(`Account ${accountId}: Found quantity: ${quantity}`);

            if (quantity === 0) {
                console.log(`Account ${accountId}: No BMB Boxes available.`);
                await browser.close();
                return true;
            }

            let inputElement;
            const maxElementRetries = 3;
            for (let elementAttempt = 1; elementAttempt <= maxElementRetries; elementAttempt++) {
                try {
                    inputElement = await page.waitForSelector('input[type="number"].btn-primary.max-w-24', { timeout: 40000 });
                    break;
                } catch (error) {
                    if (elementAttempt === maxElementRetries) {
                        await page.reload({ waitUntil: 'networkidle2', timeout: 60000 });
                        try {
                            inputElement = await page.waitForSelector('input[type="number"].btn-primary.max-w-24', { timeout: 40000 });
                            break;
                        } catch (refreshError) {
                            await page.screenshot({ path: `error_${accountId}_input.png` });
                            await fs.writeFile(`error_${accountId}_input.html`, await page.content());
                            throw new Error('Open Amount input not found');
                        }
                    }
                    await randomDelay(5000, 10000);
                }
            }

            await page.evaluate(el => el.scrollIntoView({ behavior: 'smooth', block: 'center' }), inputElement);
            await inputElement.click();
            await page.evaluate((qty) => {
                const input = document.querySelector('input[type="number"].btn-primary.max-w-24');
                input.value = Math.min(qty, parseInt(input.getAttribute('max') || 999999, 10));
                input.dispatchEvent(new Event('input', { bubbles: true }));
                input.dispatchEvent(new Event('change', { bubbles: true }));
            }, quantity);
            console.log(`Account ${accountId}: Set Open Amount to ${quantity}.`);

            let buttonElement;
            for (let elementAttempt = 1; elementAttempt <= maxElementRetries; elementAttempt++) {
                try {
                    buttonElement = await page.waitForSelector('div.opacity-100.bg-black\\/50.h3.rounded-full.text-center.py-5.px-10.flex.gap-2.items-center.cursor-pointer', { timeout: 50000 });
                    break;
                } catch (error) {
                    if (elementAttempt === maxElementRetries) {
                        await page.screenshot({ path: `error_${accountId}_button.png` });
                        await fs.writeFile(`error_${accountId}_button.html`, await page.content());
                        throw new Error('Open button not found');
                    }
                    await randomDelay(5000, 10000);
                }
            }

            await page.evaluate(el => el.scrollIntoView({ behavior: 'smooth', block: 'center' }), buttonElement);
            await page.evaluate(el => {
                ['mouseover', 'mousedown', 'mouseup', 'click'].forEach(eventType => {
                    el.dispatchEvent(new Event(eventType, { bubbles: true }));
                });
            }, buttonElement);
            console.log(`Account ${accountId}: Clicked the Open button.`);

            let newQuantity = quantity;
            const maxQuantityCheckAttempts = 10;
            for (let quantityCheckAttempts = 0; quantityCheckAttempts < maxQuantityCheckAttempts; quantityCheckAttempts++) {
                await randomDelay(2000, 4000);
                newQuantity = await page.evaluate(() => {
                    const quantityElement = Array.from(document.querySelectorAll('div')).find(el => el.innerText.includes('Quantity:'));
                    return quantityElement ? parseInt(quantityElement.innerText.match(/Quantity:\s*(\d+)/)?.[1] || 0, 10) : 0;
                });
                if (newQuantity < quantity) {
                    console.log(`Account ${accountId}: Quantity decreased to ${newQuantity}.`);
                    break;
                }
            }

            if (newQuantity >= quantity) {
                await page.screenshot({ path: `error_${accountId}_action.png` });
                await fs.writeFile(`error_${accountId}_action.html`, await page.content());
                throw new Error('Action did not register');
            }

            console.log(`Account ${accountId}: Successfully opened boxes.`);
            await browser.close();
            return true;
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
async function processToken(mode) {
    const tokenData = await getTokenData();

    if (mode === 'daily') {
        while (true) {
            let allAccountsProcessed = true;
            for (const accountId in tokenData) {
                console.log(`Processing account: ${accountId} (Daily Claim)`);
                const success = await processDailyClaim(accountId, tokenData[accountId]);
                if (success) {
                    console.log(`Account ${accountId}: Claimed successfully.`);
                } else {
                    console.log(`Account ${accountId}: No action taken or failed.`);
                    allAccountsProcessed = false;
                }
                await randomDelay(10000, 20000);
            }
            const waitTime = 24 * 60 * 60 * 1000;
            console.log(`Waiting ${waitTime / (60 * 60 * 1000)} hours before next check...`);
            await randomDelay(waitTime, waitTime + 600000);
        }
    } else if (mode === 'box') {
        for (const accountId in tokenData) {
            console.log(`Processing account: ${accountId} (Box Open)`);
            const success = await processBoxOpen(accountId, tokenData[accountId]);
            if (success) {
                console.log(`Account ${accountId}: Processed successfully.`);
            } else {
                console.log(`Account ${accountId}: Failed to process.`);
            }
            await randomDelay(10000, 20000);
        }
        console.log(`All accounts processed. Script completed.`);
    }
}

// Prompt user to select mode
function promptMode() {
    rl.question('Select mode (1 for Daily Claim, 2 for Box Open): ', (answer) => {
        const mode = answer.trim() === '1' ? 'daily' : answer.trim() === '2' ? 'box' : null;
        if (!mode) {
            console.log('Invalid selection. Please enter 1 or 2.');
            promptMode();
        } else {
            rl.close();
            processToken(mode).catch(error => {
                console.error(`Fatal error: ${error.message}`);
                process.exit(1);
            });
        }
    });
}

// Start the script
promptMode();
